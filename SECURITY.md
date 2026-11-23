# Security & Privacy Policy

## Design Principles

1. **Read-Only By Architecture:** Investment OS only provides read-only analytics, local portfolio persistence, live quote fetching (Yahoo Finance public chart endpoint), and SEC EDGAR public filing lookups. It contains no order-submission or fund-transfer tools.
2. **Strict Local Isolation (`${PLUGIN_DATA}`):** User profiles, portfolio holdings, thesis notes, and SEC lookup caches are stored locally inside the plugin data directory (`${PLUGIN_DATA}` or `INVESTMENT_OS_DATA_DIR`), created with restrictive directory permissions (`0700`) and file permissions (`0600`). No telemetry or portfolio data is sent to third-party servers.
3. **Path-Traversal & Schema Hardening:** All file reads/writes resolve strictly inside `${PLUGIN_DATA}` with path-containment assertions, ticker regex validation, and Zod schema bounds.
4. **Content Security Policy (CSP):** The MCP App UI (`dist/dashboard.html`) ships as a single self-contained HTML bundle requiring zero external scripts, styles, or `connectDomains`. External filing links open only after verifying an `https://` URL prefix.

## Reporting a Vulnerability

Please open a private security advisory on GitHub rather than filing a public issue with exploit details.
