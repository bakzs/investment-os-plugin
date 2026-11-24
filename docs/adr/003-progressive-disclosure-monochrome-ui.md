# 003. Progressive-Disclosure Monochrome UI & Self-Contained Bundle

- **Status:** Accepted

## Context
Right-hand IDE sidecars operate in narrow viewports alongside active conversations. Rainbow financial widgets create visual fatigue, slow scannability, and collide with host light/dark themes, while external CDN scripts violate MCP App CSP boundaries and host caching keeps stale iframe HTML active unless resource URIs advance on UI contract changes.

## Decision
1. **Linear-Minimalist Monochrome Hierarchy:** Use neutral zinc/slate tokens driven by `light-dark()` and `color-mix(in oklab, ...)`, reserving semantic accents (`--ok`, `--warn`, `--bad`) solely for financial deltas, trigger hits, cap breaches, and falsified claims. Never reintroduce legacy rainbow hexes (`#3b82f6`, `#ec4899`, `#10b981`, `#38bdf8`).
2. **Progressive Disclosure:** Surface 10-second executive signals upfront (verdict, price vs. buy/trim zone, compact metrics, action queue) and tuck full hypotheses, forms, audit ledgers, and memos inside `#stock-inspector` and collapsible drawers.
3. **Self-Contained & Cache-Versioned Delivery:** Bundle UI assets into a single offline `< 1 MB` `dist/dashboard.html` with zero external script/style requests, bumping the versioned MCP resource URI (`ui://investment-os/vX/dashboard.html`) whenever UI contracts change.

## Consequences
- **Automated enforcement:** `scripts/verify-bundle.mjs` checks `dist/dashboard.html` byte budget, inline script VM syntax, zero external CDNs, zero banned hexes, and version/`APP_URI` alignment across manifests and skills.
- **Zero-build installs:** Prebuilt `dist/` artifacts stay committed and verified via `git diff --exit-code dist/` in `npm run verify:ci`.
