# Investment OS — Repository & Agent Governance

This repository (`${PLUGIN_ROOT}`) contains strictly generic, open-source code, tests, UI assets, and documentation for the Investment OS Antigravity MCP App plugin.

## Non-Negotiable Invariants

1. **Zero Personal Data Inside the Repo:**
   - Never store, copy, or commit personal holdings, balances, account IDs, CSV/PDF/XLSX brokerage exports, API keys, local OS home directory paths, or private research memos inside this repository.
   - All mutable user state (`profile.yaml`, `portfolio.json`, `etf_weights.json`, `catalysts.yaml`, `theses/*.md`, `test_log.jsonl`, caches, and personal `notes/`) lives strictly inside `${PLUGIN_DATA}` (`INVESTMENT_OS_DATA_DIR`).
   - Run `npm run privacy-check` before staging or pushing any changes, and also run it against the staged target (`node scripts/privacy-check.mjs <staged_dir>`).

2. **Strictly Read-Only Architecture (See `docs/adr/001-read-only-sovereignty.md`):**
   - Never add order-placement, order-modification, order-cancellation, or funds-transfer tools to `src/server/index.ts`.
   - Broker synchronization happens through read-only queries against external broker MCPs (such as `ibkr_ibkr-mcp`) or user-provided snapshots persisted locally in `${PLUGIN_DATA}`.

3. **Schema & Cache Hygiene:**
   - Preserve backward compatibility for existing files in `${PLUGIN_DATA}`. Never break or silently wipe user data across plugin upgrades.
   - Keep `plugin.json` version, `package.json` version, `Server` version in `src/server/index.ts`, and `CHANGELOG.md` synchronized on every release.
   - When changing the dashboard UI contract or busting Antigravity's hosted iframe cache, bump `APP_URI` (`ui://investment-os/vX/dashboard.html`) identically across `src/server/index.ts`, `skills/investment-os/SKILL.md`, and `tests/mcp_stdio.test.ts`.

4. **Pre-Commit Verification & Dogfooding Workflow:**
   - Always run `npm run verify` (`typecheck`, `build`, `verify-bundle`, `test`, `privacy-check`) after edits and before committing. Prebuilt `dist/server.cjs` and `dist/dashboard.html` artifacts must match `src/` cleanly (`git diff --exit-code dist/`).
   - To dogfood local changes against your private vault, stage cleanly via `npm run stage-plugin` (never point Antigravity's live plugin config straight at raw dev folders containing temporary artifacts).
