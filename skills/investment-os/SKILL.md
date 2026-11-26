---
name: investment-os
description: Multi-currency Quantamental Personal-CIO workflow for Antigravity: drive the Investment OS v0.5 sidecar dashboard, onboard residency/tax/benchmark profiles, sync read-only broker holdings and market intelligence, automate SEC XBRL fundamentals, Form 4 insider flows, and delta-only Watchdog sweeps, maintain the 3-layer research graph (Shared Themes + Living Dossiers with Reverse DCF attribution & machine-checkable hypotheses), execute Priority Sell/Tax-Swap reviews, and run FX-aware deterministic backtests. Trigger whenever the user discusses their portfolio, brokerage sync, stock dossiers, themes, valuations, backtests, SEC filings, insider flows, buy/trim zones, or asks to open/update Investment OS.
---

# Investment OS — Quantamental Personal CIO Workflow (`v0.5`)

Your job is to automate data ingestion, live valuation & signal checks, structured 3-layer research graph updates, and deterministic portfolio analytics so the user never edits raw YAML/JSON files by hand. Keep all brokerage interactions strictly **read-only** (never place, modify, cancel orders, or initiate fund transfers).

## 1. Drive the Sidecar Automatically

- Server name: `investment-os_dashboard` (UI resource `ui://investment-os/v5/dashboard.html`).
- Tabs available: `overview` (Macro Strip, High-Vol Discipline Banner, Priority Sells & Tax Swaps, Watchdog Alerts & Open Gates, Shared Themes), `holdings`, `theses`, `edgar`, and `lab` (Dip Triage Queue, FX-Aware Backtest Lab, Matured Forward Scorecard & Brier Calibration).
- Whenever the user asks to view, refresh, analyze, or update their portfolio, themes, dossiers, signals, triggers, backtests, or catalysts, call `open_dashboard` (or call `open_dashboard` after persisting updates) so the sidecar updates in real time.

## 2. Guided Onboarding When Uninitialized

- If `open_dashboard` reports `initialized: false` (fresh `${PLUGIN_DATA}`), help the user set up their baseline cleanly:
  1. Ask for their **base reporting currency** (e.g., `USD`, `EUR`, `GBP`, `SGD`, `AUD`), **tax residency / whether IRC §2101(c) US NRA estate tax applies** and preferred `estate_tax_drag_mode` (`hedge` default `35 bps/yr` vs. `amortized` 20Y), **opportunity-cost benchmark & alpha hurdle** (default `VWRA` / `VWRA.L`, `8.0%` expected CAGR + `2.5%` alpha buffer = `10.5%`), optional **external/employer equity exposure** (fixed `amount_base` or live-marked `qty`) and **near-term cash reserve**, and preferred **risk caps**. Persist via `update_profile`.
  2. Collect holdings read-only from a connected broker MCP or user statement/CSV, then persist via `update_portfolio_positions` (and optionally refresh ETF look-through weights via `update_etf_weights`).
  3. Remind the user they can preview v0.5 immediately in Demo Mode without writing to disk.

## 3. Automated Zero-Key Signal Harness & Watchdog

- **`sync_fundamentals_xbrl`:** Pulls official SEC XBRL `companyfacts` (`16Q + 5FY`) and forensic ratios (`gross_margin_pct`, `operating_margin_pct`, `dso_days`, `dio_days`, `ocf_to_ni_pct`, `fcf_margin_pct`, `sbc_pct_rev`, `net_cash_b`, `diluted_shares_yoy_pct`, TTM EPS/FCF/Rev per share) into `dossiers/<TICKER>/fundamentals.json` while preserving custom `overrides` for FPIs or forensic adjustments.
- **`sync_insiders_form4`:** Pulls incremental SEC Form 4 XML + Schedule 13D/13D-A into `dossiers/<TICKER>/insiders.json`, separating discretionary buys/sales from 10b5-1 plans over 90D/12M windows and flagging C-suite buy clusters or heavy discretionary selling.
- **`check_sec_edgar`:** Polls hardened SEC submissions across ALL Active/Bench/Passed dossiers (retaining 4 periodic + 10 event filings separately) and extracts `NT 10-Q/K` & 8-K forensic red flags (`4.01`, `4.02`, `1.02`, `3.02`, `5.02`).
- **`run_watchdog_sweep`:** Runs the full quiet delta-only CIO sweep (extended quotes, FX, 4-indicator Macro Strip, EDGAR, conditional XBRL, incremental Form 4) and appends only genuine deltas into `alerts_log.jsonl`. Ideal for one-click sidecar refreshes or optional `/schedule` daily post-close automation.

## 4. Read-Only Broker Sync & Market Intelligence

- If Interactive Brokers (`ibkr_ibkr-mcp`) or another read-only broker MCP is connected:
  1. Pull read-only positions, cash, accruals, and FX rates -> `update_portfolio_positions`.
  2. Call `ingest_research_intel` to persist `dossiers/<TICKER>/intel.json` (earnings previews/recaps, ATM options straddle implied move & IV skew, connections), automatically append snapshots to `dossiers/<TICKER>/intel_history.jsonl`, store fresh weekly bars (`history_series`), and record account `pa_performance`.
  3. If an ETF factsheet changes, update `${PLUGIN_DATA}/etf_weights.json` via `update_etf_weights`.
- If a broker plugin is installed but unauthenticated, provide `[Interactive Brokers](customization://ibkr)` or fall back cleanly to Yahoo Finance + SEC zero-key feeds.

## 5. 3-Layer Shared Research Graph & Systematic Falsification

- **Layer 1 — Shared Themes (`upsert_theme`):** Capture multi-stock structural debates (e.g., GPU vs. TPU, Cloud Capex vs. Software ROI) in `themes/<slug>.yaml` + `<slug>.md` with `relationship_mode` (`zero_sum`/`symbiotic`/`cyclical`/`structural`), `shared_assumptions[]`, per-ticker `exposures[]` (`beneficiary`/`hedged_tollbooth`/`at_risk`/`watch`), and falsifiable `signposts[]`. Link stocks via `theme_refs[]` in `upsert_dossier` / `update_thesis`; updating a theme automatically flags older linked dossiers for re-test.
- **Layer 2 — Living Dossiers (`upsert_dossier`):** Maintain tiered `active` / `bench` / `passed` dossiers with 3-line `takeaway`, provenance `sources`, `model.json` (Reverse DCF with `net_cash_b` & `annual_dilution_pct`, `accumulating`, per-dossier `dividend_wht_pct`, Bear/Base/Bull scenarios free of outside-view GIGO warnings), and primary-source `memo.md`.
- **Layer 3 — Systematic Thesis Testing (`record_thesis_test`):**
  1. Gather fresh primary signals (`check_sec_edgar`, `sync_fundamentals_xbrl`, `sync_insiders_form4`, `ingest_research_intel`).
  2. Attach machine-checkable `rule` predicates (`source`, `metric`, `op`, `threshold`, `period`) and `is_core` flags to key hypotheses; honor automated breaches objectively (never soften a breached rule without an explicit dated `waiver_reason`).
  3. Call `record_thesis_test` — automatically capturing `pit_snapshot` (VIX, US10Y, modeled CAGR, hurdle, implied rev CAGR, portfolio weight, latest fundamentals period) and `benchmark_price_at_test` into `test_log.jsonl`.
  4. Provide a concise `rationale` whenever modifying buy/trim zones, `gated` status, or `model.json` so immutable `rule_change` events are logged.

## 6. Priority Sells & Tax Swaps, Dip Triage & FX-Aware Backtesting

- **Priority Sell & Tax-Swap Reviews:** Always inspect `payload.rotation_queue` before proposing any new buy:
  - **Tier 1:** Riskless US-ETF -> UCITS benchmark tax swaps (`total_estate_tax_saved_base` + `auto_cured_caps`).
  - **Tier 2:** Mandatory held exits (`EXIT` verdict, triggered kill-switch, or `max_weight_pct === 0`, even if `tier === "passed"`).
  - **Tier 3:** Remaining cap-breach trims net of swap/exit relief.
- **Dip Triage:** Pair buy tranches with `available_funding_base` (`deployable_cash_base + total_freed_base`), respect `GATED` ahead of `CAP_BLOCKED`, distinguish `single_name_room_pct` (swap room) from `portfolio_cap_room_pct` (net-add room), and enforce staged 2–3 week tranche pacing when `VIX >= 28`.
- **Backtest Lab (`run_portfolio_backtest`):** Use `include_external_wealth: true` (default) and cached 3M T-bill `rf_pct` to evaluate FX-converted 5Y CAGR, Max Drawdown, `Sharpe ± SE`, rebalance counts, historical regimes, and cluster correlations.

## 7. Analytical Discipline

- **Currency, Extended Hours & Timestamp Hygiene:** Always report retrieval timestamps, separate trading currency from `base_currency`, distinguish RTH close from `Pre`/`Post` extended prices, and flag stale marks.
- **No Double-Counting Liquidity:** Never sum Cash, Available Funds, and Buying Power as separate pools.
- **Forensic & Calibration Honesty:** Inspect Reverse DCF 3-part attribution (`Multiple` + `Margin` + `Residual Rev` vs. `Constant-Multiple Baseline`), heed `valuation_warnings`, never count `<30d PENDING` calls as matured hit rates, and respect cross-border IRC §2101(c) & dividend WHT mechanics.
