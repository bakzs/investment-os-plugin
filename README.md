# Investment OS (Antigravity MCP App Plugin)

An open-source, read-only Personal-CIO sidecar dashboard plugin for **Google Antigravity**.

It bundles an interactive right-hand MCP App UI (`ui://investment-os/dashboard.html`) and a zero-dependency Node server (`dist/server.cjs`, executed via Antigravity's built-in `agy-node`) so any user can track true look-through single-name exposure, multi-currency portfolio valuation, configurable risk caps, living investment theses, and SEC EDGAR filings without Python environments or hardcoded machine paths.

## Key Capabilities

- **Interactive MCP App Sidecar (`open_dashboard`):** Opens in Antigravity's right-hand auxiliary pane (`aux_pane`) and left sidebar (`global`), auto-syncing with host light/dark themes.
- **Multi-Currency Portfolio & ETF Look-Through:** Evaluates holdings in both trading currency and any configured `base_currency` (`USD`, `EUR`, `GBP`, `SGD`, `AUD`, `JPY`, etc.), combining direct positions with underlying ETF constituent weights.
- **Optional Non-Resident Alien (NRA) US Estate Tax Module:** Exact IRC §2101(c) progressive schedule (`18%`–`40%` above US$60,000) and non-US-situs UCITS ETF comparison, toggled by residency settings in `profile.yaml`.
- **Interactive External Wealth & Reserve Simulator:** Stress-test concentrated external holdings (such as employer stock) and near-term cash reserves dynamically from the UI.
- **Living Stock Theses & SEC EDGAR Catalysts:** Maintain pre-set buy/trim zones, kill-switches, dated decision logs (`theses/*.md`), and live `data.sec.gov` filing gates for any US-listed ticker.
- **Broker-Agnostic Design:** Works seamlessly alongside connected broker MCP servers (such as Interactive Brokers `ibkr-mcp`), manual agent imports, CSV/statement extraction, or built-in demo mode. Strictly **read-only**—contains no order-placement or money-transfer tools.

## Privacy & Local Storage Model

- All mutable personal data (`profile.yaml`, `portfolio.json`, `etf_weights.json`, `catalysts.yaml`, `theses/*.md`, and caches) lives strictly inside `${PLUGIN_DATA}` (created with `0700` directory and `0600` file permissions; override via `INVESTMENT_OS_DATA_DIR`).
- Zero personal holdings, credentials, or balances ship in this plugin repository. Fresh installs start cleanly in **Onboarding / Demo Preview** mode.

## Quick Install (Zero Build Needed)

Because prebuilt `dist/server.cjs` and `dist/dashboard.html` artifacts are included:

1. Copy or clone this repository into `~/.gemini/config/plugins/investment-os` (or run `node scripts/stage-plugin.mjs ~/.gemini/config/plugins/investment-os`).
2. Antigravity discovers the plugin automatically and expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` on launch.
3. Ask the agent: *"Open my Investment OS dashboard and help me onboard my portfolio"*.

## Development & Verification

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run privacy-check
```

## License

MIT
