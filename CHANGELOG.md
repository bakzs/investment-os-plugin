# Changelog

All notable changes to **Investment OS** are documented in this file.
Versions stay aligned across `plugin.json`, `package.json`, and `src/server/index.ts`.

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
