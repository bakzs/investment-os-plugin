# Investment OS (`v0.3`)

An open-source, strictly read-only **Personal-CIO** plugin and MCP App sidecar for **Google Antigravity**.

Investment OS turns Antigravity from an ephemeral chat window into a stateful institutional portfolio workstation. It pairs a zero-dependency local Node MCP server (`dist/server.cjs` via built-in `agy-node`) with a high-density, Linear-minimalist monochrome sidecar UI (`ui://investment-os/v3/dashboard.html`)—giving individual investors true ETF look-through math, multi-currency balance-sheet normalization, cross-border tax visibility, and systematic falsifiable thesis testing without leaking personal data into plugin code.

## Core Pillars

- **Monochrome Finance Hub Sidecar (`open_dashboard`):** Renders live in Antigravity's auxiliary pane (`aux_pane`) and left sidebar (`global`). Syncs automatically with host light/dark themes, supports `/` quick ticker filtering, hover/click Inspection Drawers, interactive Stress-Test sliders, and zero-clutter Swiss hairline risk tables.
- **Systematic Thesis Testing Engine (`record_thesis_test`):** Replaces static narrative bull notes with explicit falsifiable hypotheses (`supported`, `weakened`, `falsified`, `untested`), steelmanned bear cases, hard kill-switches, conviction verdicts (`HIGH_CONVICTION`, `WATCH`, `PROBATION`, `EXIT`), and an immutable `${PLUGIN_DATA}/test_log.jsonl` audit ledger.
- **Multi-Currency & True ETF Look-Through Engine:** Values every position in both local trading currency and any configured `base_currency` (`USD`, `SGD`, `EUR`, `GBP`, `AUD`, `JPY`, etc.), while dissolving index/thematic ETFs into underlying single-name weights alongside direct stock holdings.
- **External Equity & Cash Runway Simulator:** Models unvested/vested external stock concentration and short-term liquidity reserves against brokerage NAV to reveal true deployable capital and single-cluster exposure.
- **Optional Cross-Border Tax Module:** Includes an exact IRC §2101(c) US Non-Resident Alien (NRA) progressive estate tax calculator (`18%`–`40%` above US\$60,000) and UCITS Irish-domicile swap savings estimator when enabled in `profile.yaml`.
- **SEC EDGAR Catalyst Gates (`check_sec_edgar`):** Polls public `data.sec.gov` submissions for `10-K`, `10-Q`, `8-K`, `20-F`, `6-K`, and `DEF 14A` filings to track binary event gates automatically.
- **Strictly Read-Only & Broker-Agnostic:** Works alongside connected broker MCP servers (such as Interactive Brokers `ibkr_ibkr-mcp`), pasted brokerage CSV/statement exports, or built-in Demo Mode. Contains zero order-submission or funds-transfer capabilities.

## Privacy & Local Isolation Model

- **Code vs. Data Separation:** Immutable plugin code lives under `${PLUGIN_ROOT}`. Every personal file (`profile.yaml`, `portfolio.json`, `etf_weights.json`, `catalysts.yaml`, `theses/*.md`, `test_log.jsonl`, and quote/filing caches) is isolated inside `${PLUGIN_DATA}` (`0700` directory, `0600` file modes; overridable via `INVESTMENT_OS_DATA_DIR`).
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

Then ask Antigravity:

> *"Open my Investment OS dashboard and help me onboard my portfolio."*

## MCP Tool Surface

### Agent-Facing Tools

| Tool | Purpose |
| :--- | :--- |
| `open_dashboard` | Render or refresh the MCP App sidecar (`overview`, `holdings`, `theses`, `edgar`), optional live Yahoo quotes, or Demo preview |
| `update_profile` | Configure `base_currency`, timezone, tax residency flags, external equity exposure, cash reserves, and risk caps |
| `update_portfolio_positions` | Upsert or prune multi-currency positions, cash balance, accruals, and FX rates |
| `update_external_wealth` | Update external compensation exposure or near-term reserve buffers |
| `update_thesis` | Create or update living thesis markdown (`theses/<TICKER>.md`), buy/trim zones, kill-switches, and hypotheses |
| `record_thesis_test` | Execute and score a Red-Team hypothesis challenge, set conviction verdict, and append to `test_log.jsonl` |
| `manage_catalysts` | Add, remove, or replace dated catalysts and SEC filing gates |
| `check_sec_edgar` | Poll live `data.sec.gov` filings and evaluate open/cleared catalyst gates |

### App-Only UI Tools (`visibility: ["app"]`)

`app_get_dashboard`, `app_save_external_wealth`, `app_save_trigger`, `app_upsert_hypothesis`, and `app_check_edgar` power direct UI interactions inside the sidecar without polluting the chat transcript.

## Documentation Index

- **[Vision & Product Philosophy](docs/VISION.md):** Why Investment OS exists, core design principles, explicit non-goals, and roadmap.
- **[Architecture & Design](docs/DESIGN.md):** System topology, `${PLUGIN_ROOT}` vs. `${PLUGIN_DATA}` schema isolation, look-through math, Linear monochrome token system, and security model.
- **[Systematic Thesis Testing Manual](docs/THESIS_TESTING.md):** The 4-step falsification methodology, hypothesis schema, verdict taxonomy, and generic walkthrough.
- **[Architecture Decision Records](docs/adr/README.md):** Core governance invariants (`Read-Only Sovereignty`, `Local Vault Isolation`, `Monochrome UI`).
- **[Changelog](CHANGELOG.md):** Release history across `0.2.0` and `0.3.0`.
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
