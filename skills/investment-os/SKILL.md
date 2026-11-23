---
name: investment-os
description: Multi-currency Personal-CIO workflow for Antigravity: drive the Investment OS sidecar dashboard, onboard user residency/tax profiles, sync read-only broker holdings, track ETF look-through concentration and risk caps, maintain living stock theses, and monitor SEC EDGAR filings. Trigger whenever the user discusses their portfolio, brokerage sync, external wealth/cash reserves, buy/trim trigger zones, or asks to open/update Investment OS.
---

# Investment OS — Personal CIO Workflow

Your job is to handle data updates, live valuation checks, and research automatically so the user never has to run manual scripts or edit raw YAML/JSON files. Keep all brokerage interactions strictly **read-only** (never place, modify, cancel orders, or initiate fund transfers).

## 1. Drive the Sidecar Automatically

- Server name: `investment-os_dashboard` (UI resource `ui://investment-os/dashboard.html`).
- Whenever the user asks to view, refresh, analyze, or update their portfolio, holdings, profile, triggers, or catalysts, call `open_dashboard` (or call `open_dashboard` after persisting updates) so the right-hand sidecar updates in real time.

## 2. Guided Onboarding When Uninitialized

- If `open_dashboard` reports `initialized: false` (fresh `${PLUGIN_DATA}`), help the user set up their baseline cleanly without lecturing:
  1. Ask for their **base reporting currency** (e.g., `USD`, `EUR`, `GBP`, `SGD`, `AUD`), **tax residency / whether IRC §2101(c) US NRA estate tax applies**, optional **external/employer equity exposure** and **near-term cash reserve**, and preferred **custom risk caps**. Persist via `update_profile`.
  2. Collect holdings either automatically from a connected broker MCP (see Step 3) or from a pasted position table/statement/CSV, then persist via `update_portfolio_positions`.
  3. Remind the user they can preview the UI immediately in Demo Mode from the sidecar without saving any fake data to disk.

## 3. Broker Sync (Connected MCP First, Manual / Statement Fallback)

- If the Interactive Brokers plugin (`ibkr_ibkr-mcp`) or another read-only broker MCP server is available and authenticated:
  1. Pull read-only positions, cash balances, accruals, and FX rates.
  2. Map each holding clearly (preserving its trading `currency`, `yf_symbol`, `domicile`, and `us_situs`), convert cash/accruals to the user's `base_currency`, and call `update_portfolio_positions`.
  3. Open or refresh the dashboard via `open_dashboard` (`tab="holdings"` or `"overview"`).
- If a broker MCP plugin is installed but not authenticated, give the user the one-click link to `[Interactive Brokers](customization://ibkr)` (using its installed directory name) to authenticate, or accept a manual snapshot/CSV export via `update_portfolio_positions`.

## 4. External Wealth, Cash Reserves & Living Theses

- **External Exposure & Liquidity Reserves:** Whenever the user shares or revises external concentrated equity (vested/unvested compensation), near-term cash obligations, or custody details, call `update_external_wealth` (or `update_profile`) and refresh `open_dashboard`. Never treat locked retirement accounts as deployable equity cash unless explicitly instructed.
- **Thesis Cards & Trigger Zones:** Whenever conviction, buy/trim price zones, binary gates, or catalyst dates change:
  1. Verify fundamentals and recent filings using `check_sec_edgar` before modifying gates or sizing.
  2. Run an adversarial challenge (Red-Team check) on bear cases, dilution, capital intensity, and valuation.
  3. Persist via `update_thesis` and/or `manage_catalysts` cleanly without writing sensitive account credentials or redundant balances into markdown prose, then refresh `open_dashboard` (`tab="theses"`).

## 5. Analytical Discipline

- **Currency & Timestamp Hygiene:** Always report the exact retrieval timestamp, separate each security's trading currency from the user's `base_currency`, and flag stale or asynchronous market marks.
- **No Double-Counting Liquidity:** Treat Cash, Available Funds, and Buying Power as overlapping measures—never sum them as separate pools of deployable capital.
- **Forensic Accounting:** Separate core recurring operating earnings from non-operating equity markups or one-time tax/legal items. Avoid double-counting stock-based compensation (SBC). Compare long-term wealth compounding using geometric CAGR rather than arithmetic average returns.
- **Cross-Border Tax Awareness (When Applicable):** If the investor is a non-US resident subject to US NRA estate tax (`nra_us_estate_tax_enabled: true`) or US dividend withholding (`30%` statutory vs. `15%` treaty or Ireland UCITS ETF wrapper), explicitly model the after-tax hurdle alongside US-situs exposure (`>$60,000` threshold under IRC §2101(c)).
