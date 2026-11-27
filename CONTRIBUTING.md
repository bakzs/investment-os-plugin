# Contributing to Investment OS

Thank you for contributing to Investment OS!

## Privacy & Security Rules (Strict)

1. **Zero Personal Particulars:** Never commit personal account balances, quantities, broker account IDs, tax filings, private employer names, or local machine home-directory paths.
2. **Read-Only Brokerage Design:** This plugin never implements order placement, cancellation, modification, or funds-transfer tools. Pull requests adding execution/trading capabilities will be rejected.
3. **Runtime State Lives Outside the Repo:** All mutable user data (`profile.yaml`, `portfolio.json`, `dossiers/`, `themes/`, `macro/`, `theses/*.md`, caches) must live under `${PLUGIN_DATA}` (or `INVESTMENT_OS_DATA_DIR`), never inside `${PLUGIN_ROOT}`.
4. **Local Personal Denylist (`privacy-denylist.json`):** Keep personal regex guards inside `${PLUGIN_DATA}/privacy-denylist.json` (`0600` mode, `{ "rules": [{ "name", "pattern", "flags?" }] }`, never committed to Git). `npm run privacy-check` loads it automatically alongside the built-in generic path/credential/account-ID rules.

## Development Workflow

```bash
npm ci            # Activates .githooks/ (pre-commit privacy check & pre-push verify:ci)
npm run verify    # Typecheck, build, bundle/contract validation, tests, and privacy scan
```

- Versioned Git hooks under `.githooks/` activate automatically via `npm run setup-hooks` (`prepare`), blocking private file extensions (`.csv`, `.pdf`, `.xlsx`) or vault files before commit and running `npm run verify:ci` before push.
- If you modify anything under `src/`, commit the rebuilt `dist/server.cjs` and `dist/dashboard.html` artifacts so users installing the plugin directly via GitHub do not need a build step. Before opening a pull request, confirm `git diff --exit-code dist/` passes cleanly.
