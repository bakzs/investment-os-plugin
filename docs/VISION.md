# Vision & Product Philosophy

## The Problem

Serious individual investors operate across fragmented, hostile tooling:

1. **Spreadsheet Rot:** Static spreadsheets break every time FX moves, a split happens, or an investor forgets to update cost basis across USD, EUR, SGD, or HKD accounts.
2. **Sycophantic AI Chats:** Standard LLM conversations excel at generating eloquent bull cases that validate whatever position the user already holds—while forgetting disconfirming evidence three sessions later.
3. **False Diversification Blind Spots:** Holding single stocks alongside global or thematic ETFs often creates hidden 15–30% single-name or cluster concentrations that standard broker views never aggregate.
4. **Silent Cross-Border Tax Leakage:** Non-US residents holding US-domiciled ETFs or equities above US\$60,000 face IRC §2101(c) estate tax liabilities up to 40% alongside 30% vs. 15% dividend withholding friction—risks almost never surfaced beside portfolio allocation.

## The Solution

**Investment OS** transforms an AI coding/research workspace (**Google Antigravity**) into a calm, local-first Personal Chief Investment Officer workstation:

- **One Shared Balance Sheet:** Live or snapshot broker holdings (read-only), underlying ETF look-through weights, unvested external equity, and real-life cash obligations live in a single validated schema.
- **Persistent Living Workspace:** An interactive right-hand MCP App sidecar lets the investor inspect triggers, adjust stress-test assumptions, and challenge claims visually—while delegating data retrieval, EDGAR filing checks, and analytical synthesis to Antigravity agents.
- **Falsifiable Research Memory:** Every conviction call leaves behind testable claims, quantitative metrics, source URLs, and a timestamped Red-Team test log inside the user's private vault.

## Five Core Principles

### 1. Read-Only Sovereignty
Investment OS never places orders, modifies working orders, transfers funds, or handles brokerage trading credentials. Observation and thesis discipline belong in one hardened tool; trade execution stays strictly inside your broker's own authenticated interface under human confirmation.

### 2. Local-First Privacy Isolation
Financial records are deeply personal. All user configuration, holdings, theses, and audit logs live strictly under `${PLUGIN_DATA}` (`0700` directory / `0600` files) on the investor's own machine. Plugin code in `${PLUGIN_ROOT}` stays 100% generic, stateless, and shareable.

### 3. Calm Linear-Minimalist Precision
Financial interfaces fail when every number screams in neon red, green, blue, and pink. Investment OS follows Swiss hairline precision: neutral zinc/charcoal surfaces, `tabular-nums` right-aligned columns, grayscale tonal visual encodings, and restrained muted crimson/forest semantic accents reserved solely for deltas, breaches, and falsified claims.

### 4. Falsification Over Conviction Theater
A good thesis specifies *what evidence would prove it wrong* before a drawdown happens. Every thesis tracks discrete testable claims (`supported`, `weakened`, `falsified`, `untested`), steelmans the opposing bear case, and logs dated verdicts (`HIGH_CONVICTION`, `WATCH`, `PROBATION`, `EXIT`) to an append-only audit trail.

### 5. Look-Through Honesty
Portfolio risk is measured on your **true economic exposure**, not ticker labels. Direct shares + underlying ETF weights + unvested employer/external stock form the numerator for single-stock, sector/cluster, and currency concentration guardrails.

## Explicit Non-Goals

To remain crisp, fast, and maintainable, Investment OS deliberately avoids becoming:

- **Not a Trading Execution Bot:** No automated buy/sell signals, order routing, or broker credential storage.
- **Not a Cloud SaaS Aggregator:** Zero central accounts, remote databases, or telemetry beacons.
- **Not Personalized Financial or Tax Advice:** Models (such as the IRC §2101(c) schedule) are deterministic mathematical calculators for educational planning alongside qualified advisers.
- **Not a Tick-by-Tick Day-Trading Charting App:** Focused on structural allocation, valuation zones, filings, and fundamental hypotheses rather than sub-second candlesticks.

## Roadmap

- **`v0.2` (Look-Through & Monochrome Foundation):** Cross-currency NAV normalization, ETF constituent decomposition, IRC §2101(c) estimator, External Wealth stress-tester, and Linear-minimalist monochrome sidecar UI.
- **`v0.3` (Systematic Thesis Testing & Open-Source Release):** Hypothesis scoring schemas, `record_thesis_test`, `app_upsert_hypothesis`, append-only `test_log.jsonl`, Overview Thesis & Catalyst Action Queue, inspector Test Audit Ledger, and public architecture documentation.
- **`v0.4+` (Ecosystem & Extensibility):** Pluggable broker CSV/statement parsers, dividend withholding & corporate-action tax-drag tracker, optional ETF holdings auto-refresh adapters, and portable markdown/JSON quarterly CIO review exports.
