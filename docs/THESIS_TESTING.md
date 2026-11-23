# Systematic Thesis Testing Methodology

Investment research typically breaks down in one of two ways: either thesis documents turn into stale, write-once essays nobody revisits during drawdowns, or portfolio reviews rely on ad-hoc chat prompts that anchor to recent price action and confirm existing bias.

**Investment OS (`v0.3`)** enforces a scientific, falsifiable hypothesis workflow directly inside each stock thesis card (`${PLUGIN_DATA}/theses/<TICKER>.md`) backed by an append-only audit ledger (`${PLUGIN_DATA}/test_log.jsonl`).

## Anatomy of a Falsifiable Thesis Card

Each single-stock or core ETF markdown file combines structured YAML frontmatter with narrative synthesis:

- **Execution Guardrails:** `buy_zone_low`, `buy_zone_high`, `trim_zone`, `max_weight_pct`, and `gated` (blocks opportunistic adds until a binary milestone resolves).
- **Conviction Verdict (`verdict`):**
  - `HIGH_CONVICTION` — Key hypotheses empirically supported; thesis intact and resilient to bear assumptions.
  - `WATCH` — Core thesis intact, but one or more hypotheses show mixed evidence or valuation discipline requires patience.
  - `PROBATION` — Critical hypothesis weakened or macro/execution drift narrows margin of safety; freeze incremental capital.
  - `EXIT` — Core hypothesis falsified or hard kill-switch triggered; prepare systematic capital exit.
- **Steelman Bear Case (`bear_case_summary`):** Concise strongest disconfirming argument currently challenging ownership.
- **Hypotheses (`hypotheses[]`):** Individual falsifiable claims tracked independently:
  - `id` — Stable kebab-case identifier (e.g., `cloud-margin-floor`) so repeated tests update history cleanly.
  - `claim` — Concrete causal assertion that future evidence could refute.
  - `metric` — Quantitative observable pass/fail bar (e.g., `Cloud revenue YoY > 22% with flat+ operating margin`).
  - `status` — `untested`, `supported`, `weakened`, or `falsified`.
  - `confidence` — `low`, `medium`, or `high`.
  - `evidence` — Dated empirical observation or filing reference supporting the current score.
  - `last_tested` — `YYYY-MM-DD` timestamp of latest verification.
  - `source_url` — Optional verified `https://` link (such as an SEC filing URL).

## The 4-Step Systematic Falsification Protocol

Whenever you click **Run Systematic Thesis Test** in the Stock Inspector (or ask Antigravity to test a holding), the agent executes four disciplined steps:

1. **Primary Evidence Gather:** Pull fresh official filings via `check_sec_edgar` (`10-K`, `10-Q`, `8-K`, `20-F`, `6-K`) alongside primary earnings releases and live price action relative to pre-set buy/trim zones.
2. **Adversarial Red-Team Challenge:** Construct the sharpest disconfirming bear case from primary evidence—specifically probing working capital cash conversion, capital intensity, competitive erosion, or regulatory exposure without anchoring to historical purchase price.
3. **Hypothesis Scoring & Audit Persistence:** Evaluate each hypothesis objectively (`supported`, `weakened`, or `falsified`), verify whether any **Hard Kill-Switch** fired, and call `record_thesis_test`. This atomically:
   - Merges updated `hypotheses[]`, `verdict`, `bear_case_summary`, and `last_tested_date` into `${PLUGIN_DATA}/theses/<TICKER>.md`.
   - Prepends a timestamped summary bullet to the Markdown `## 4. Decision Log`.
   - Appends an immutable structured JSON record to `${PLUGIN_DATA}/test_log.jsonl`.
4. **Sidecar Sync:** Refreshes `open_dashboard` (`tab="theses"`), updating Hypothesis Health counts on thesis cards, Overview's **Thesis & Catalyst Action Queue** alerts, and the drawer's **Test Audit Ledger**.

## Generic Example Walkthrough (`MSFT`)

Suppose an investor holds a sample position in **MSFT** (`Enterprise Compounder`) with buy zone US\$420–455 and trim target US\$530. Before earnings, they define two falsifiable claims—either via chat (`update_thesis`) or directly inside the Inspector Drawer's **Add / Update Hypothesis** form:

```yaml
verdict: WATCH
bear_case_summary: "Rising AI data-center capex outpaces seat-based software ARPU uplift if autonomous agents compress legacy licenses."
last_tested_date: "2026-11-23"
hypotheses:
  - id: azure-ai-margin
    claim: "Cloud backlog converts into accelerating gross-profit growth above capex depreciation drag"
    metric: "Cloud revenue YoY > 22% with flat+ operating margin"
    status: supported
    confidence: high
    evidence: "Quarterly cloud growth held mid-20s with commercial RPO expanding."
    last_tested: "2026-11-23"
  - id: seat-pricing-resilience
    claim: "AI agent workflows expand per-user enterprise revenue rather than cannibalizing seat licenses"
    metric: "Productivity suite ARPU + net seat retention >= 100%"
    status: weakened
    confidence: medium
    evidence: "Enterprise pilot upgrades show mixed displacement vs. copilot upsell across knowledge workers."
    last_tested: "2026-11-23"
```

After a quarterly filing drops:

1. `check_sec_edgar` confirms the new `10-Q` is filed on `data.sec.gov`.
2. The agent challenges both hypotheses against actual cloud gross margins, depreciation growth, and productivity seat counts.
3. Calling `record_thesis_test` logs whether `seat-pricing-resilience` recovered to `supported` (`verdict: "HIGH_CONVICTION"`) or deteriorated to `falsified` (`verdict: "PROBATION"` or `"EXIT"`), preserving the price at test (`price_at_test: 495`) inside `test_log.jsonl` so hindsight cannot rewrite history later.

## Rules of Discipline

- **Never Edit Logs Retrospectively:** `test_log.jsonl` is append-only. If a thesis pivots, record a new test showing *why* prior beliefs changed.
- **No Unfalsifiable Claims:** Replace vague statements like *"Strong management team"* with observable hypotheses such as *"ROIC stays above 18% without net debt rising above 1.5x EBITDA."*
- **Respected Kill-Switches:** When `kill_switch_triggered: true` is recorded alongside a `falsified` core hypothesis, treat the position as `EXIT` or `PROBATION` in Overview's Action Queue until explicitly resolved.
