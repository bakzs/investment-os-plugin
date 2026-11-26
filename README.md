# Investment OS (`v0.6`)

An open-source, strictly read-only **Quantamental Personal-CIO** plugin and MCP App sidecar for **Google Antigravity**.

Investment OS turns Antigravity into a stateful institutional portfolio workstation. It pairs a zero-dependency local Node MCP server (`dist/server.cjs` via built-in `agy-node`) with a calm, spacious executive sidecar (`ui://investment-os/v6/dashboard.html`)—combining ETF look-through math, multi-currency balance-sheet normalization, cross-border tax visibility, zero-key SEC XBRL & Form 4 signal harvesting, correlated fat-tail portfolio forecasting, and adversarial deep company research without leaking a byte of personal data into plugin code.

## What's Inside (`v0.6`)

- **Executive Cockpit & Human-vs-Agent Signal Hygiene (`Overview` & `SEC & Alerts`):** Separates urgent human decisions (top-5 priority alerts, macro stress strip, 5Y projected wealth delta, Priority Sells & Tax Swaps, and breached caps) from noisy routine filings (such as `8-K:5.02` executive/board comp notices), which stay archived in backend metadata for agents and inside `SEC & Alerts`.
- **Interactive Portfolio Forward Forecast & Action Simulator (`Forecast` / `simulate_portfolio_forecast`):** Simulates **Current Path vs. Your Action Plan** over 1–10 years using 1,500 seeded correlated Student-t (`df=6`) Monte Carlo paths with Ledoit-Wolf shrunk covariance (`λ=0.25`) blended with your 5Y after-tax dossier models. Toggle UCITS tax swaps, mandatory exits, cap trims, custom planned buys, and benchmark cash deployment to inspect Before/After wealth cones (`P10`/`P50`/`P90`), estate tax saved, cured risk caps, Marginal Risk Contribution %, Correlation-Adjusted Hurdles, and Quarter-Kelly sizing.
- **SOTA Quantamental Fundamentals & Quality Engine (`sync_fundamentals_xbrl`):** Pulls official SEC XBRL `companyfacts` (`16Q + 5FY`) with zero API keys, deriving **Owner Earnings (`FCF − SBC`)**, **ROIC & Incremental ROIC**, **Sloan Accruals Ratio**, **Composite Quality Grade (`A`–`D`)**, DSO/DIO working-capital alerts, dilution trends, and Reverse DCF **Expectations Gap vs. Street Consensus**.
- **3-Layer Research Graph & 4-Tab Stock Dossier (`Research` / `upsert_theme` / `upsert_dossier`):** Connects reusable macro/sector **Shared Themes** (`themes/<slug>.{yaml,md}`) to tiered stock dossiers (`active`, `bench`, `passed`), each opening in a clean 4-sub-tab drawer (`Summary` · `Deep Memo` · `Valuation & Quality` · `Signals & Audit`) with one-click **Deep Research** (3-Lens Institutional Deep Dive) dispatched cleanly to a background **Side Agent** or **This Chat**.
- **Zero-Key SEC, Insider & Watchdog Pipeline:** Tracks Form 4 discretionary open-market buys/sales vs. Rule 10b5-1 plans (`sync_insiders_form4`), Schedule 13D activist stakes, 3-tier SEC EDGAR filing alerts (`check_sec_edgar`), 4-indicator Macro Regime (`^VIX`, `^TNX`/`^IRX`, `HYG`/`IEF`, `DXY`), and delta-only CIO Watchdog sweeps (`run_watchdog_sweep`).
- **Multi-Currency, True ETF Look-Through & Backtest Lab (`Holdings` & `Lab`):** Dissolves ETFs into true single-name weights alongside direct equities and external employer equity (RSUs/options), includes an optional IRC §2101(c) US Non-Resident Alien estate tax & UCITS tax-swap calculator, and ships a 5Y FX-aware deterministic Backtest Lab + Forward Judgment Scorecard with Hypothesis Brier Calibration.
- **Strictly Read-Only & Broker-Agnostic:** Works seamlessly alongside connected broker MCP servers (such as Interactive Brokers `ibkr_ibkr-mcp`), pasted brokerage CSV/statement snapshots, or built-in Demo Mode. Contains zero order-submission or funds-transfer tools.

## Privacy & Local Isolation Model

- **Code vs. Data Separation:** Immutable plugin code lives under `${PLUGIN_ROOT}`. Every personal file (`profile.yaml`, `portfolio.json`, `etf_weights.json`, `catalysts.yaml`, `themes/`, `theses/`, `dossiers/`, `macro/`, `test_log.jsonl`, `alerts_log.jsonl`, and caches) is isolated inside `${PLUGIN_DATA}` (`0700` directory, `0600` file modes; overridable via `INVESTMENT_OS_DATA_DIR`).
- **Safe to Open-Source & Fork:** Fresh installs ship with zero user holdings and boot directly into an interactive Onboarding / Sample Demo Preview flow. Automated `npm run privacy-check` guards against accidentally staging or committing personal paths, account IDs, or credentials.

## 60-Second Install

Prebuilt `dist/server.cjs` and `dist/dashboard.html` bundles ship in the repository, so end users do **not** need to compile anything:

```bash
# Clone into Antigravity's local plugins directory
git clone https://github.com/bakzs/investment-os-plugin ~/.gemini/config/plugins/investment-os
```

Or from a local checkout, stage only clean redistributable runtime assets:

```bash
npm ci
npm run stage-plugin
```

Then restart/refresh plugins in Antigravity and ask:

> *"Open my Investment OS dashboard and help me onboard my portfolio."*

## MCP Tool Surface

### Agent-Facing Tools

| Tool | Purpose |
| :--- | :--- |
| `open_dashboard` | Render or refresh the 6-tab MCP App sidecar (`overview`, `forecast`, `holdings`, `theses`, `edgar`, `lab`), optional live quotes, or Demo preview |
| `simulate_portfolio_forecast` | Run correlated fat-tail Monte Carlo forward forecast comparing Current Path vs. toggled swaps, exits, trims, and planned buys |
| `update_profile` | Configure `base_currency`, timezone, benchmark, tax residency flags, external equity exposure, cash reserves, and risk caps |
| `update_portfolio_positions` | Upsert or prune multi-currency positions, cash balance, accruals, and FX rates |
| `update_etf_weights` | Update ETF constituent look-through weights and domicile/OCF metadata |
| `update_external_wealth` | Update external compensation exposure (RSUs/options) or near-term reserve buffers |
| `upsert_theme` | Create or update a shared macro/sector theme (`themes/<slug>.{yaml,md}`) with linked stock stances and signposts |
| `upsert_dossier` | Create or update a living stock dossier (`theses/<TICKER>.md` + `dossiers/<TICKER>/{model.json, memo.md}`) with zones, 5Y scenarios, Reverse DCF, and hypotheses |
| `update_thesis` | Lightweight wrapper for updating thesis markdown, buy/trim zones, kill-switches, and hypotheses |
| `ingest_research_intel` | Persist structured broker/research snapshots (`earnings_insight`, `consensus`, `themes`, `pa_performance`) and append to `intel_history.jsonl` |
| `sync_fundamentals_xbrl` | Pull SEC XBRL `companyfacts` (`16Q + 5FY`) and derive Owner Earnings, ROIC, Sloan Accruals, Quality Grade (`A`–`D`), and forensic ratios |
| `sync_insiders_form4` | Parse SEC Form 4 XML & Schedule 13D filings incrementally, separating discretionary insider trades from 10b5-1 plans |
| `check_sec_edgar` | Poll live `data.sec.gov` filings, evaluate catalyst SEC gates, and classify 3-tier SEC red flags |
| `run_watchdog_sweep` | Run a quiet delta-only CIO Watchdog sweep across quotes, macro regime, SEC gates, XBRL rules, insiders, and risk caps |
| `record_thesis_test` | Execute and score a Red-Team hypothesis challenge, set conviction verdict, and append Point-in-Time audit record to `test_log.jsonl` |
| `run_portfolio_backtest` | Run a 5Y FX-aware deterministic portfolio-impact backtest (`cash`, `pro_rata`, or `swap:<TICKER>`) with correlations and regime splits |
| `manage_catalysts` | Add, remove, or replace dated catalysts and binary SEC filing gates |

### App-Only UI Tools (`visibility: ["app"]`)

`app_get_dashboard`, `app_simulate_forecast`, `app_get_dossier_detail`, `app_get_theme_detail`, `app_save_external_wealth`, `app_save_trigger`, `app_upsert_hypothesis`, `app_save_dossier_model`, `app_check_edgar`, `app_run_watchdog`, `app_ack_alert`, and `app_run_backtest` power instant interactive controls inside the sidecar without cluttering chat.

## Documentation Index

- **[Vision & Product Philosophy](docs/VISION.md):** Why Investment OS exists, core design principles, explicit non-goals, and roadmap.
- **[Architecture & Design](docs/DESIGN.md):** System topology, `${PLUGIN_ROOT}` vs. `${PLUGIN_DATA}` schema isolation, look-through math, UI token system, and security model.
- **[Systematic Thesis Testing Manual](docs/THESIS_TESTING.md):** Falsification methodology, hypothesis schema, verdict taxonomy, and walkthrough.
- **[Architecture Decision Records](docs/adr/README.md):** Core governance invariants (`Read-Only Sovereignty`, `Local Vault Isolation`, `Monochrome UI`).
- **[Changelog](CHANGELOG.md):** Full release history through `0.6.0`.
- **[Contributing Guidelines](CONTRIBUTING.md):** Development setup, automated git hooks, verification gates, and strict privacy rules.
- **[Security & Privacy Policy](SECURITY.md):** Vulnerability reporting and sandboxing guarantees.

## Development & Verification

```bash
npm ci                 # Also activates .githooks/ via prepare script
npm run verify         # typecheck + build + bundle/contract checks + tests + privacy scan
npm run stage-plugin   # Stage clean runtime bundle locally for dogfooding
```

## License

MIT
