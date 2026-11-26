# Changelog

All notable changes to **Investment OS** are documented in this file.
Versions stay aligned across `plugin.json`, `package.json`, and `src/server/index.ts`.

## [0.7.0] - 2026-11-26

### Added
- **Zero-Dependency Institutional Quantitative Core (`src/server/quant_sota.ts`):**
  - **Black-Litterman Posterior Expected Returns:** Conjugate Bayesian blend combining market-equilibrium implied returns (`Π = δ Σ w_mkt`) with 5Y dossier scenarios, automatically scaling view uncertainty `Ω` via empirical Hypothesis Brier Calibration and GIGO `valuation_warnings`. Toggleable side-by-side (`return_model: "black_litterman" | "raw_dossier"`).
  - **Jacobi PCA Latent Factor Risk & Meucci Effective Bets (`N_eff`):** Exact symmetric eigendecomposition of the Ledoit-Wolf shrunk covariance matrix exposing Top-3 orthogonal variance drivers (auto-labeled by driving tickers), Market Beta (`β`), Systematic vs. Idiosyncratic risk split, and Effective Number of Independent Bets (`exp(-Σ p_k ln p_k)`).
  - **Politis-Romano Stationary Block Bootstrap + CVaR (Expected Shortfall):** Multivariate geometric-block weekly resampling (`L=6w`, auto-falling back to correlated Student-t `df=6` if `<80w` aligned history) preserving crash persistence and cross-asset tail co-skewness, plus Terminal `CVaR 10%` and simulated Path Max-Drawdown (`P50`/`P95`).
  - **López de Prado Hierarchical Risk Parity (HRP):** Correlation-distance UPGMA clustering + tree-respecting recursive inverse-variance bisection with cap-bounded water-filling redistribution surfaced alongside Quarter-Kelly sizing.
  - **Bailey & López de Prado Deflated Sharpe Ratio (DSR) + Transaction-Cost Slippage:** Upgraded Backtest Lab (`run_portfolio_backtest` / `app_run_backtest`) with configurable `tx_cost_bps` (default `10 bps`), `trials_tested` (`M`), realized turnover & annualized slippage drag, weekly `CVaR 95%`, skewness, excess kurtosis, and multiple-testing-adjusted DSR probability.

### Changed
- Bumped MCP App resource URI (`APP_URI`) to `ui://investment-os/v7/dashboard.html`, Server version to `0.7.0`, and outbound Yahoo/SEC User-Agent strings to `0.7.0`.
- Upgraded Forecast UI toolbar and Lab Backtest diagnostics while keeping `dist/dashboard.html` well within the 1 MB bundle budget.

## [0.6.0] - 2026-11-26

### Added
- **Portfolio Forward Forecast & Interactive Action Simulator (`src/server/forecast.ts`, `simulate_portfolio_forecast`, `app_simulate_forecast`):**
  - Seeded 1,500-path correlated Student-t (`df=6`) Monte Carlo wealth engine using Ledoit-Wolf shrunk historical covariance (`λ=0.25`) blended with 5Y after-tax dossier models (`P10`/`P25`/`P50`/`P75`/`P90` wealth cone vs. benchmark).
  - Interactive **Forecast** tab allowing users to toggle UCITS tax swaps, mandatory exits, cap trims, custom planned buys, benchmark cash deployment, horizon (`1Y`–`10Y`), and volatility regime multiplier (`0.8x`–`1.5x`) with instant Before vs. After comparisons for median wealth, estate tax saved, annual WHT saved, cured risk caps, Marginal Risk Contribution %, Correlation-Adjusted Hurdles, and Quarter-Kelly sizing.
- **SOTA Quantamental Quality & Expectations Signals (`src/server/{xbrl,quant,schema}.ts`):**
  - SEC XBRL extraction of Total Assets and Stockholders' Equity to compute **Owner Earnings (`FCF − SBC`)**, **Owner Earnings Margin**, **Invested Capital**, **ROIC**, **Incremental ROIC**, **Sloan Accruals Ratio**, **TTM Owner Earnings / Share**, and deterministic **Composite Quality Grade (`A`–`D`)** with diagnostic `quality_flags[]`.
  - Reverse DCF **Street Consensus Snapshot & Expectations Gap** (`consensus_rev_growth_pct`, `expectations_gap_vs_consensus_pct`), Owner-Earnings SBC divergence warning (`>= 8pp`), and mechanical `owner_earnings_margin_pct` hypothesis rules.
- **Executive Cockpit & 3-Tier Human-vs-Agent Signal Hygiene (`src/server/{edgar,watchdog}.ts`, `src/ui/{styles.css,main.ts}`):**
  - Re-architected **Overview** into a calm, spacious executive cockpit showing only Top-5 urgent signals, a single consolidated Macro Regime strip, a 5Y Projected Wealth pill, concise Priority Rotations, and breached-only Risk Caps (passing caps collapsed by default).
  - Upgraded SEC EDGAR filing alerts to 3 tiers (`high`: `NT 10-Q/K`, `8-K:1.03/2.06/3.01/4.01/4.02`; `medium`: `8-K:1.02/3.02`; `info`: routine `8-K:5.02` officer/board comp notices kept in backend metadata and collapsed inside **SEC & Alerts**).
  - Watchdog suppresses `info` filings, stale SEC alerts (`>90d` high / `>45d` medium), and audit drift on `passed` dossiers.
- **4-Sub-Tab Institutional Stock Research Drawer & 3-Lens Deep Dive:**
  - Redesigned `#stock-inspector` into `Summary`, `Deep Memo`, `Valuation & Quality`, and `Signals & Audit` tabs with spacious prose typography, `Side Agent` vs. `This Chat` dispatch toggle, and a primary **Deep Research** CTA running the 3-Lens Institutional Deep Dive protocol.

### Changed
- Bumped MCP App resource URI (`APP_URI`) to `ui://investment-os/v6/dashboard.html`, Server version to `0.6.0`, and outbound Yahoo/SEC User-Agent strings to `0.6.0`.
- Refined UI theme palette (Slate + Indigo primary + Emerald/Amber/Rose semantic indicators) with generous spacing and cleaner hierarchy across all 6 tabs (`Overview`, `Forecast`, `Holdings`, `Research`, `SEC & Alerts`, `Lab`).
- Refreshed `README.md` to accurately document `v0.6.0` capabilities, tool surface, and 60-second installation.

## [0.5.0] - 2026-11-26

### Added
- **Automated Zero-Key Signal Harness (`src/server/{xbrl,insiders,edgar,market,watchdog}.ts`):**
  - `sync_fundamentals_xbrl`: Pulls official SEC XBRL `companyfacts` (`16Q + 5FY`), derives YTD-differenced quarterly cash flows and forensic ratios (`gross_margin_pct`, `operating_margin_pct`, `dso_days`, `dio_days`, `ocf_to_ni_pct`, `fcf_margin_pct`, `sbc_pct_rev`, `net_cash_b`, `diluted_shares_yoy_pct`, TTM EPS/FCF/Rev per share), and preserves custom `overrides`.
  - `sync_insiders_form4`: Parses SEC Form 4 XML and Schedule 13D/13D-A incrementally, separating discretionary open-market buys/sales from Rule 10b5-1 plans across 90D/12M windows with C-suite buy-cluster and heavy-selling flags.
  - Hardened SEC EDGAR polling retaining **4 periodic + 10 event** filings separately per ticker across all Active/Bench/Passed dossiers plus `extractSecRedFlags` (`NT 10-Q/K`, 8-K items `4.01`, `4.02`, `1.02`, `3.02`, `5.02`).
  - Extended-hours Yahoo quote capture (`regular_price`, `extended_price`, `market_state`, `quote_time`, 52W range), persisted `fx_rates`, and 4-indicator Macro Regime strip (`^VIX`, `^TNX`, `^IRX`, `HYG`/`IEF`, `DX-Y.NYB` -> `macro/regimes.yaml`).
  - Quiet delta-only CIO Watchdog (`run_watchdog_sweep`, `app_run_watchdog`, `app_ack_alert`, `alerts_log.jsonl`) detecting newly cleared SEC gates, 8-K/NT red flags, XBRL rule breaches, Passed re-entry hits, `>= 15%` audit drift, insider flags, and newly breached risk caps.
- **3-Layer Shared Research Graph & Governance (`themes/<slug>.{yaml,md}`):**
  - `upsert_theme` and `app_get_theme_detail` linking first-class macro/sector themes across stock dossiers (`theme_refs[]`), flagging `theme_updated_after_audit` -> `needs_retest`.
  - `update_etf_weights` for Zod-validated look-through map updates, append-only `dossiers/<TICKER>/intel_history.jsonl`, Point-in-Time `pit_snapshot` + `benchmark_price_at_test` in `record_thesis_test`, and immutable `event_type: "rule_change"` logging with rationale on trigger/gate/model edits.
- **Quantitative Engine & Behavioral Discipline Upgrades (`src/server/quant.ts`):**
  - `computeCapitalRotationQueue`: Ranked **Priority Sells & Tax Swaps** (Tier 1: US-ETF -> UCITS tax-arbitrage swaps with shares, estate tax saved, auto-cured caps; Tier 2: Mandatory Held Exits even when `tier === "passed"`; Tier 3: Cap-driven trims net of swap/exit relief).
  - `computeValuationBands` (5Y `P/E`, `P/FCF`, `P/S` `p10`/`median`/`p90`) and `evaluateHypothesisRule` (mechanical XBRL/EDGAR/Insiders/Market auto-eval with anti-softening warnings).
  - Reverse DCF EV (`net_cash_b`) & dilution (`annual_dilution_pct`) 3-part attribution bridge (`Multiple` + `Margin` + `Residual Rev` vs. `Constant-Multiple Baseline`), coupled dividend total-return + accumulating ETF WHT handling, mode-selectable NRA estate-tax drag (`"hedge"` default `35 bps/yr` vs. `"amortized"`), expected-wealth vs. standalone Kelly CAGR separation, and outside-view GIGO `valuation_warnings`.
  - Dip Triage dual headroom (`single_name_room_pct` vs. `portfolio_cap_room_pct`), direct ETF weight fallback, benchmark `CORE_ANCHOR` exemption, `GATED` prioritized ahead of `CAP_BLOCKED`, funding-paired tranche sizing, and `VIX >= 28` High-Vol Staged annotations.
  - Matured Forward Judgment Scorecard (`<30d` marked `PENDING`, 30d dedup, daily benchmark history, directional verdict hit signs, `90d`/`180d`/`1Y` buckets, and Hypothesis Brier Calibration).
  - FX-converted Backtest Lab with hybrid drift rebalance band `max(2%, targetW * band)`, risk-free rate cash yield (`rf_pct`), `sharpe_se`, `rebalance_count`, max 1-week carry-forward gap, incomplete-week drop, and `include_external_wealth` toggle.
- **Non-Interrupting Background Side-Agent UX:** Sidecar action buttons launch background conversations (`target: "new"`) with silent `updateModelContext()` sync plus an explicit **Discuss Here** option.

### Changed
- Bumped MCP App resource URI (`APP_URI`) to `ui://investment-os/v5/dashboard.html`, Server version to `0.5.0`, and outbound Yahoo/SEC User-Agent strings to `0.5.0`.
- Fixed `latest_decision` in `engine.ts` to read the **last** (newest) bullet in `## 4. Decision Log`, fixed `marginalEstateRatePct === 0` falsy fallback bug, and added live external equity marking when `external_exposure.qty` is set.
- Enriched Demo Mode with generic v0.5 sample Shared Theme (`cloud-capex-vs-software-roi`), XBRL fundamentals, Form 4 insider flows, Macro Strip, Priority Sells & Tax Swaps, and Watchdog alerts.

## [0.4.0] - 2026-11-25

### Added
- **Living Research Dossiers & Hybrid Vault Storage:** Extended `theses/<TICKER>.md` frontmatter (`tier`: `active`/`bench`/`passed`, `action_verdict`: `GO`/`WAIT`/`PASS`, 3-line `takeaway`, `last_audited_date`, `price_at_audit`, `sources[]`, `rejection_reason`, `reentry_trigger`, `reentry_price`) paired with per-ticker `dossiers/<TICKER>/{model.json, memo.md, intel.json}` sidecars, `history_cache.json`, and `pa_performance.json`.
- **Deterministic Quant & Backtesting Engine (`src/server/quant.ts`):**
  - `computeAfterTaxHurdle`: Benchmark CAGR + alpha buffer + dividend WHT drag + amortized US NRA estate-tax drag for US-situs securities.
  - `computeScenarioSummary`: 5Y Bear/Base/Bull geometric after-tax CAGR expectation and spread vs. benchmark & hurdle.
  - `computeReverseDcf`: Implied 5Y FCF/EPS and revenue CAGR required at current price to beat the after-tax hurdle, linked to falsifiable hypothesis IDs.
  - `computeDipTriage`: 4-check readiness engine (Risk-Cap Headroom, Binary/SEC Gate, After-Tax Hurdle, Staged Tranche Plan) plus Passed Re-Entry Trigger alerting.
  - `computeForwardScorecard`: Evaluates `test_log.jsonl` verdicts against live prices and benchmark returns with per-verdict alpha and hit-rate metrics.
  - `runDeterministicBacktest`: 5Y weekly portfolio-impact simulator (`cash`, `pro_rata`, or `swap:<TICKER>` funding with threshold drift rebalancing), Sharpe/Sortino/Max-DD/Rolling-3Y metrics, historical regime breakdown, and portfolio/cluster correlations.
- **New MCP Tools & Lab Tab:**
  - Agent + UI tools: `upsert_dossier`, `ingest_research_intel`, `run_portfolio_backtest`.
  - App-Only UI tools: `app_get_dossier_detail` (lazy drawer loading), `app_save_dossier_model`, `app_run_backtest`.
  - 5th dashboard tab (`lab`) housing the Portfolio-Impact Backtester, 4-Check Dip Triage Queue, and Forward Judgment Scorecard, plus progressive-disclosure `<details>` inspector drawers and Provenance / Needs-Re-Test auditing.
- **Yahoo Weekly History Cache (`fetchYahooHistory` / `ensureHistorySeries`):** Concurrent 5Y weekly adjusted-close history fetcher preserving fresh broker-ingested (`ibkr`) weekly bars.

### Changed
- Bumped MCP App resource URI (`APP_URI`) to `ui://investment-os/v4/dashboard.html`, Server version to `0.4.0`, and outbound Yahoo/SEC User-Agent strings to `0.4.0`.
- Added optional `use_cache` flag on dashboard refresh and save endpoints so UI edits preserve live cached prices during an active live session while maintaining exact snapshot NAV reconciliation on `live: false`.
- Enriched Demo Mode with tiered Active, Bench (`ACME`), and Passed (`HYPE`, with triggered re-entry alert) dossiers, Reverse DCF + Bear/Base/Bull models, primary-source memos, broker intel, and offline synthetic 5Y weekly histories for instant demo backtesting.

## [0.3.0] - 2026-11-24

### Added
- **Systematic Thesis Testing Engine:** Added `record_thesis_test` (agent tool), `app_upsert_hypothesis` (app-only UI tool), Zod schemas for falsifiable claims (`supported`, `weakened`, `falsified`, `untested`) and verdicts (`HIGH_CONVICTION`, `WATCH`, `PROBATION`, `EXIT`), plus append-only `${PLUGIN_DATA}/test_log.jsonl` audit persistence.
- **Monochrome Overview & Inspector Surfaces:** Replaced the duplicate Overview donut card with a clickable **Thesis & Catalyst Action Queue**, added conviction verdicts and Hypothesis Health lines to Thesis cards, and added Falsifiable Hypotheses + Test Audit Ledger + Add Hypothesis controls to `#stock-inspector`.
- **Open-Source Architecture Documentation:** Added [docs/VISION.md](docs/VISION.md), [docs/DESIGN.md](docs/DESIGN.md), and [docs/THESIS_TESTING.md](docs/THESIS_TESTING.md), and staged `docs/` cleanly in `scripts/stage-plugin.mjs`.
- **Governance & Guardrails:** Added workspace rules (`AGENTS.md`, `src/ui/AGENTS.md`), hardened `.gitignore`, `.githooks/` (`pre-commit` / `pre-push`), `scripts/verify-bundle.mjs`, `npm run verify`, and initial Architecture Decision Records (`docs/adr/`).

### Changed
- Bumped MCP App resource URI (`APP_URI`) to `ui://investment-os/v3/dashboard.html` so Antigravity loads the updated Linear-minimalist monochrome sidecar cleanly.
- Refined Risk Guardrails into flat hairline rows (`3px` meter, muted crimson only on breaches) and tightened sticky header density with a subtle `v0.3` version badge.

## [0.2.0] - 2026-11-23

### Added
- Initial open-source release of Investment OS as a zero-dependency Node MCP App plugin (`dist/server.cjs` + `dist/dashboard.html`).
- Multi-currency portfolio valuation, ETF constituent look-through aggregation, configurable risk caps, optional IRC §2101(c) US NRA estate tax calculator, External Wealth & Liquidity Reserve stress-tester, and SEC EDGAR catalyst gate polling (`data.sec.gov`).
- Strict `${PLUGIN_ROOT}` vs. `${PLUGIN_DATA}` isolation with `0700`/`0600` permissions, path-traversal guards, Demo Preview mode, and automated `scripts/privacy-check.mjs`.
