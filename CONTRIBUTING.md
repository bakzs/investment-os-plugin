# Contributing to Investment OS

Thank you for contributing to Investment OS!

## Privacy & Security Rules (Strict)

1. **Zero Personal Particulars:** Never commit personal account balances, quantities, broker account IDs, tax filings, private employer names, or local machine home-directory paths.
2. **Read-Only Brokerage Design:** This plugin never implements order placement, cancellation, modification, or funds-transfer tools. Pull requests adding execution/trading capabilities will be rejected.
3. **Runtime State Lives Outside the Repo:** All mutable user data (`profile.yaml`, `portfolio.json`, `theses/*.md`, caches) must live under `${PLUGIN_DATA}` (or `INVESTMENT_OS_DATA_DIR`), never inside `${PLUGIN_ROOT}`.

## Development Workflow

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run privacy-check
```

If you modify anything under `src/`, commit the rebuilt `dist/server.cjs` and `dist/dashboard.html` artifacts so users installing the plugin directly via GitHub do not need a build step. CI enforces `git diff --exit-code dist/`.
