# 002. Local Vault Isolation (`${PLUGIN_ROOT}` vs. `${PLUGIN_DATA}`)

- **Status:** Accepted

## Context
Dogfooding a Personal-CIO plugin inside the same repository used for open-source development creates a constant risk of committing private account balances, holdings, tax details, or exported statements into public Git history. Conversely, separate forks for code vs. personal use cause drift and break easy sharing.

## Decision
Maintain one generic public codebase (`${PLUGIN_ROOT}`) and isolate 100% of mutable user files inside `${PLUGIN_DATA}` (`INVESTMENT_OS_DATA_DIR`):
1. Every personal file (`profile.yaml`, `portfolio.json`, `etf_weights.json`, `catalysts.yaml`, `theses/*.md`, `test_log.jsonl`, `notes/`, and quote/filing caches) lives strictly outside the repository with `0700` directory and `0600` file permissions.
2. Fresh installs start cleanly in Onboarding / in-memory Demo Preview mode with zero sample user files persisted to disk.
3. Backward compatibility is preserved for existing `${PLUGIN_DATA}` schemas across minor version upgrades.

## Consequences
- **Safe public dogfooding:** The same local code workspace can display live portfolio state in the sidecar and still be pushed cleanly to public GitHub.
- **Automated enforcement:** Hardened `.gitignore`, `.githooks/pre-commit`, `.githooks/pre-push`, and `scripts/privacy-check.mjs` block personal files, OS paths, and credentials from being staged, committed, or staged into runtime plugin bundles.
