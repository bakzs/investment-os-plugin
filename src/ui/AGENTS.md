# UI & Sidecar Design Governance (`src/ui/`)

Changes in `src/ui/` compile directly into the standalone single-file MCP App bundle (`dist/dashboard.html`). Follow these rules strictly:

1. **Linear-Minimalist Monochrome & Progressive Disclosure:**
   - Maintain a calm monochrome surface hierarchy (`light-dark()`, semantic surface tokens, `tabular-nums` alignment).
   - Reserve green/amber/crimson semantic accents (`--ok`, `--warn`, `--bad`) solely for financial deltas, trigger hits, cap breaches, and falsified claims.
   - Never reintroduce banned legacy rainbow hexes (`#3b82f6`, `#ec4899`, `#10b981`, `#38bdf8`).
   - Favor progressive disclosure: clean 10-second summary surfaces first, expandable deep-dive panels in drawers/collapsible sections.

2. **Modern Web Platform Discipline:**
   - Use perceptual OKLab mixes (`color-mix(in oklab, ...)` only) and preserve `color-scheme: light dark`, `html { container-type: scroll-state; }`, `@container` responsive tables, `focusgroup` tablists, `hidden="until-found"` panels, `@media (forced-colors: active)`, and `prefers-reduced-motion`.
   - Keep `<dialog id="stock-inspector">` modal layout rules scoped to `:is(dialog#stock-inspector[open])` with `overscroll-behavior: contain` on modal & backdrop and separate `transition-behavior: allow-discrete`.

3. **Offline Bundle & Link Security:**
   - `dist/dashboard.html` must stay strictly `< 1 MB` and load zero third-party `<script>` or external stylesheet CDNs.
   - All outbound `app.openLink` actions must validate `https://` prefixes explicitly (and `https://www.sec.gov/` for SEC filings).
