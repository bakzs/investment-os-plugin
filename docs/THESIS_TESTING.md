# Systematic Thesis Testing Methodology (`v0.5`)

Investment research breaks down when thesis documents turn into static write-once essays or when ad-hoc chats anchor to recent price action and rationalize away broken assumptions.

**Investment OS (`v0.5`)** enforces a scientific, machine-verifiable falsification loop across each stock dossier (`${PLUGIN_DATA}/theses/<TICKER>.md` + `dossiers/<TICKER>/*`), shared **Theme Objects** (`themes/<slug>.yaml`), and an immutable Point-in-Time audit ledger (`${PLUGIN_DATA}/test_log.jsonl`).

## Anatomy of a Machine-Verifiable Thesis Card

- **Execution Guardrails & Shared Graph Links:** `buy_zone_low`, `buy_zone_high`, `trim_zone`, `max_weight_pct`, `gated`, and `theme_refs[]` (linking Layer-1 themes; whenever a linked theme updates after `last_audited_date`, `provenance.theme_updated_after_audit` flags the stock as `needs_retest`).
- **Conviction Verdict (`verdict`):**
  - `HIGH_CONVICTION` — Core hypotheses supported; thesis intact and resilient to bear stress.
  - `WATCH` — Thesis intact, but mixed evidence or valuation discipline requires patience.
  - `PROBATION` — Critical hypothesis weakened or margin of safety compressed; blocked from `READY` dip triage.
  - `EXIT` — Core hypothesis falsified or kill-switch fired; held shares surface automatically in **Priority Sells & Tax Swaps -> Mandatory Exits** even if `tier === "passed"`.
- **Machine-Checkable Hypotheses (`hypotheses[]`):**
  - `id`, `claim`, `metric`, `status` (`untested`/`supported`/`weakened`/`falsified`), `confidence` (`low`/`medium`/`high`), `evidence`, `last_tested`, `source_url`.
  - `is_core` — Marks structural thesis pillars that require explicit falsification or a dated `waiver_reason` + `waiver_expires` if breached.
  - `rule` — Optional deterministic predicate evaluated automatically against synced data:
    ```yaml
    rule:
      source: xbrl      # xbrl | edgar | market | insiders
      metric: dso_days  # e.g., gross_margin_pct, ocf_to_ni_pct, sbc_pct_rev, net_cash_b, filing_10q_on_time, disc_sell_90d_usd
      op: "<="          # <= | < | >= | > | ==
      threshold: 65
      period: latest_q  # latest_q | ttm | latest_fy
    ```

## Anti-Softening Enforcement & Immutable Rule-Change Ledger

1. **Automated Rule Evaluation (`auto_eval`):** Whenever `fundamentals.json` (SEC XBRL), `edgar_latest.json`, `insiders.json` (Form 4), or `market_cache.json` updates, Investment OS evaluates every rule-backed hypothesis deterministically (`AUTO-VERIFIED` vs. `AUTO-BREACHED`).
2. **Anti-Softening Warnings (`observed_breach_softened`):** If observed primary data breaches a hypothesis's `rule` while its human/agent label remains `supported` or `weakened`, the engine raises a prominent `SOFTENING WARNING` banner so broken metrics cannot be quietly rationalized.
3. **Rule-Change Audit Events (`event_type: "rule_change"`):** Editing buy/trim zones, toggling `gated`, changing `max_weight_pct`/`reentry_price`, or revising `model.json` valuations automatically appends an immutable `rule_change` line to `test_log.jsonl` (capturing the required 1-line `rationale`), separate from scored `thesis_test` calls.

## Point-in-Time (`pit_snapshot`) & Matured Scorecard Rules

Every `record_thesis_test` call automatically freezes context at decision time inside `test_log.jsonl`:

- `price_at_test` and exact `benchmark_price_at_test` (never backfilled as `0%` on Day 0).
- `pit_snapshot`: `vix`, `us10y_pct`, `expected_after_tax_cagr_pct`, `hurdle_cagr_pct`, `implied_revenue_cagr_pct`, `portfolio_weight_pct`, and latest `fundamentals_period`.

When computing the **Forward Judgment Scorecard** (`computeForwardScorecard`):

1. **30-Day Maturity Gate:** Entries with `days_elapsed < 30` are marked `maturity: "PENDING"` and excluded from hit-rate percentages so Day-0 noise never inflates accuracy.
2. **30-Day Deduplication:** Repeated calls on the same `ticker + verdict` within 30 days are deduplicated chronologically so re-running the same test cannot double-count hits.
3. **Daily Benchmark Alignment:** Benchmark return uses `benchmark_price_at_test` first, falling back to cached daily benchmark history (`daily:<SYM>`), never hardcoding `benchRet = 0`.
4. **Directional Hit Rules:**
   - `HIGH_CONVICTION` / `GO`: Hit when `alpha_pct > 0`.
   - `EXIT` / `PROBATION` / `PASS`: Hit when `alpha_pct <= 0`.
   - `WATCH`: Hit when `stock_return_pct <= 0` (patience improved entry price).
5. **Horizon Buckets & Brier Calibration:** Aggregates matured alpha and hit rates across `90d`, `180d`, and `1Y` horizons, and computes **Hypothesis Brier Calibration** across resolved `supported`/`falsified` claims grouped by `high` (0.80), `medium` (0.60), and `low` (0.40) confidence.

## Generic Example Walkthrough (`MSFT`)

```yaml
verdict: WATCH
theme_refs:
  - "cloud-capex-vs-software-roi"
hypotheses:
  - id: azure-ai-margin
    claim: "Cloud backlog sustains GAAP gross margin >= 65% despite AI capex depreciation"
    metric: "GAAP gross_margin_pct >= 65%"
    status: supported
    confidence: high
    is_core: true
    rule:
      source: xbrl
      metric: gross_margin_pct
      op: ">="
      threshold: 65
      period: latest_q
    evidence: "Latest 10-Q XBRL confirmed 68.8% GAAP gross margin."
    last_tested: "2026-11-23"
```

1. `run_watchdog_sweep` (or `sync_fundamentals_xbrl` + `sync_insiders_form4`) ingests the newly filed `10-Q` and evaluates `azure-ai-margin` mechanically against XBRL facts.
2. If gross margin drops to `63.5%`, `auto_eval.passed` flips to `false`, raising a `hypothesis_rule_breach` delta alert and an anti-softening warning until a Red-Team audit calls `record_thesis_test` to re-score the hypothesis and log the new Point-in-Time decision.
