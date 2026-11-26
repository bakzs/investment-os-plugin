---
name: investment-os
description: Multi-currency Institutional Quantamental Personal-CIO workflow for Antigravity: drive the Investment OS v0.7 sidecar dashboard, run Black-Litterman Brier-calibrated & Politis-Romano Block Bootstrap portfolio forecasts with CVaR, PCA Effective Bets & HRP sizing, conduct 3-lens adversarial deep company research, onboard residency/tax/benchmark profiles, sync read-only broker holdings and market intelligence, automate SEC XBRL (Owner Earnings, ROIC, Sloan Accruals), Form 4 insider flows, and quiet delta-only Watchdog sweeps, maintain the 3-layer research graph (Shared Themes + Living Dossiers + PIT Ledger), and run FX-aware Deflated Sharpe deterministic backtests. Trigger whenever the user discusses their portfolio, forward wealth forecast, action simulation, Black-Litterman, PCA factor risk, HRP sizing, brokerage sync, deep company research, stock dossiers, themes, valuations, backtests, SEC filings, insider flows, buy/trim zones, or asks to open/update Investment OS.
---

# Investment OS — Institutional Quantamental Personal CIO Workflow (`v0.7`)

Your job is to automate data ingestion, live valuation & quality checks, institutional forward portfolio forecasting, deep company research, and structured 3-layer research graph updates so the user never edits raw YAML/JSON files by hand. Keep all brokerage interactions strictly **read-only** (never place, modify, cancel orders, or initiate fund transfers).

## 1. Drive the Sidecar Automatically

- Server name: `investment-os_dashboard` (UI resource `ui://investment-os/v7/dashboard.html`).
- Tabs available:
  - `overview` — Executive Cockpit (unified wealth hero, single macro bar, Priority Action Plan, Top-5 high-signal inbox only, Look-Through exposure & breached risk guardrails).
  - `forecast` — Institutional Forward Forecast & Action Simulator (Black-Litterman Brier-calibrated posterior vs Raw Dossier toggle, Politis-Romano Stationary Block Bootstrap vs Student-t crash engine, P10/P50/P90 wealth cone + CVaR 10% + Max DD P95, PCA Latent Factors & Meucci Effective Bets, toggleable swaps/exits/trims/buys, before-vs-after estate tax & cap breaches, Marginal Risk Contribution, Quarter-Kelly & HRP cluster-balanced sizing).
  - `holdings` — Multi-currency Positions, True ETF Look-Through, Quality grades, and collapsible Outside Wealth Stress-Tester.
  - `theses` — Living Research Dossiers (Active / Bench / Passed) + Shared Research Themes strip.
  - `edgar` — Full SEC Filing Archive, Catalysts, Gates & Watchdog Signal Log (routine `info` filings like `8-K:5.02` live here and in agent metadata, never cluttering Overview).
  - `lab` — 4-Check Dip Triage Queue, FX-Aware Historical Backtester (with Deflated Sharpe Ratio multiple-testing filter, weekly CVaR 95%, skewness/kurtosis & transaction-cost slippage drag), Matured Forward Scorecard & Brier Calibration.
- Whenever the user asks to view, forecast, refresh, research, or update their portfolio, themes, dossiers, signals, triggers, backtests, or catalysts, call `open_dashboard` or `simulate_portfolio_forecast` so the sidecar updates in real time.

## 2. Guided Onboarding When Uninitialized

- If `open_dashboard` reports `initialized: false` (fresh `${PLUGIN_DATA}`), help the user set up cleanly:
  1. Ask for **base reporting currency** (`USD`, `SGD`, `EUR`, `GBP`, `AUD`, etc.), **tax residency / US NRA estate tax flag** and `estate_tax_drag_mode` (`hedge` default `35 bps/yr` vs. `amortized`), **opportunity-cost benchmark & alpha hurdle** (default `VWRA.L`, `8.0%` + `2.5%` = `10.5%`), optional **external/employer equity** and **near-term cash reserve**, and **risk caps** -> `update_profile`.
  2. Collect holdings read-only from a connected broker MCP or user statement/CSV -> `update_portfolio_positions` (and optional `update_etf_weights`).
  3. Remind the user they can preview v0.7 immediately in Demo Mode without writing to disk.

## 3. Forward Portfolio Forecasting & Action Simulation (`simulate_portfolio_forecast`)

- Whenever the user asks *"what happens to my portfolio if I do X?"*, *"forecast my holdings over 5 years"*, or *"how should I deploy freed cash?"*, call `simulate_portfolio_forecast`:
  - Supports `apply_recommended_rotations: true` (auto-applies Tier 1 UCITS tax swaps + Tier 2 mandatory exits + Tier 3 cap trims) plus explicit `actions[]`: `tax_swap`, `sell`, `buy`, and `park_cash_in_benchmark`.
  - Supports `return_model: "black_litterman" | "raw_dossier"` (default `"black_litterman"`, calibrating view uncertainty Ω from empirical Hypothesis Brier Score & GIGO valuation warnings) and `simulation_engine: "block_bootstrap" | "student_t"` (default `"block_bootstrap"`, Politis-Romano stationary weekly block bootstrap with `block_length_weeks=6` falling back cleanly to Student-t df=6 if `<80w` aligned history).
  - Reports before-vs-after P10 / P50 / P90 wealth, Terminal CVaR 10%, simulated Max Drawdown P50/P95, Jacobi PCA top latent factors & Meucci Effective Bets (`N_eff`), Market Beta, estate tax & WHT savings, cured risk caps, Marginal Risk Contribution %, correlation-adjusted required hurdles, Quarter-Kelly, and López de Prado HRP cluster-balanced sizing.

## 4. Deep Institutional Company Research Protocol (3-Lens Adversarial Deep Dive)

When the user triggers **Deep Research** on a ticker (or asks for a deep dive into a company), execute a structured 3-lens institutional synthesis before persisting:

1. **Lens 1 — Business Quality, Moat & Value Chain:** Pull primary SEC filings (`check_sec_edgar`), official XBRL (`sync_fundamentals_xbrl`), Form 4 insiders (`sync_insiders_form4`), and read-only broker intel (`ingest_research_intel` including `consensus` NTM revenue/EPS & revisions if available). Evaluate unit economics, pricing power, ROIC & incremental ROIC, SBC-adjusted Owner Earnings (`FCF - SBC`), Sloan Accruals quality, and shared theme linkages (`upsert_theme`).
2. **Lens 2 — Expectations Investing (Reverse DCF vs. Street vs. Base Case):** Decompose what the current stock price implies (`Multiple` + `Margin` + `Residual Revenue CAGR` net of dilution & cash), compare against Street consensus growth and Mauboussin corporate base rates, and check 5Y historical valuation bands (`P/E`, `P/FCF`, `P/S`).
3. **Lens 3 — Steelman Bear Case & Falsifiable Kill-Switches:** Construct the strongest possible bear thesis (avoiding cushioned `> -10%` single-stock bear cases), attach machine-checkable `rule` predicates (`owner_earnings_margin_pct`, `roic_pct`, `gross_margin_pct`, `dso_days`, `accruals_ratio_pct`, `sbc_pct_rev`, `ocf_to_ni_pct`, EDGAR/Form 4 rules) with `is_core: true`, and score honestly.
4. **Persist Cleanly:** Save the full structured primary-source memo (`memo_md`), 5Y valuation model (`model`), 3-line executive `takeaway`, provenance `sources`, buy/trim zones, and `theme_refs` via `upsert_dossier`, and log the scored test via `record_thesis_test`.

## 5. Automated Zero-Key Signal Harness & Strict Human-vs-Agent Signal Hygiene

- **`sync_fundamentals_xbrl`:** Pulls official SEC XBRL `companyfacts` (`16Q + 5FY`) including **Owner Earnings (`FCF - SBC`)**, **ROIC & Incremental ROIC**, **Sloan Accruals Ratio**, **Quality Grade (`A`–`D`)**, GM%, OM%, DSO, DIO, OCF/NI, SBC%, Net Cash, and TTM per-share metrics into `dossiers/<TICKER>/fundamentals.json` while preserving `overrides`.
- **`sync_insiders_form4`:** Incremental Form 4 XML + Schedule 13D/A separating discretionary buys/sales from 10b5-1 plans over 90D/12M windows.
- **`check_sec_edgar` & `run_watchdog_sweep`:** Strict 3-tier signal hygiene:
  - **Tier 1 (`high`):** `NT 10-Q/K`, `8-K:4.01` (auditor change), `4.02` (restatement), `1.03` (bankruptcy), `2.06` (impairment), `3.01` (delisting), core hypothesis breaches, SEC gate clearances, newly breached caps, C-suite buy clusters.
  - **Tier 2 (`medium`):** Recent (`<=45d`) `8-K:1.02` / `3.02` on held/active names, Passed re-entry hits, `>=15%` audit drift on active/bench names.
  - **Tier 3 (`info`, Agent Backend Metadata):** Routine `8-K:5.02` (officer/board appointments & comp) and older filings remain fully preserved in `edgar_cache.json` and the `SEC & Alerts` archive for agents without spamming Overview.

## 6. Read-Only Broker Sync & Analytical Discipline

- If Interactive Brokers (`ibkr_ibkr-mcp`) or another read-only broker MCP is connected, pull positions, cash, accruals, FX, earnings insights, options IV, and weekly price history read-only into `update_portfolio_positions` and `ingest_research_intel`.
- Always report retrieval timestamps, separate trading currency from `base_currency`, distinguish RTH close from extended hours, never double-count liquidity pools, heed `valuation_warnings` (including Owner Earnings vs headline FCF SBC divergence), and never count `<30d PENDING` calls as matured hit rates.
