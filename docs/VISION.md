# Vision & Product Philosophy

## North Star Vision

> **Turn Antigravity into a calm, local-first Quantamental Personal CIO workstation that automatically ingests primary-source financial, filing, market, and macro signals into a structured research graph—protecting long-only investors from hidden concentration, cross-border tax drag, and emotional mistakes while proving out-of-sample whether judgment beats a passive global ETF.**

## The Problem

Serious individual investors operate across fragmented, hostile tooling:

1. **Spreadsheet Rot:** Static spreadsheets break whenever FX moves, a split happens, or holdings span USD, EUR, SGD, GBP, or HKD accounts alongside unvested employer equity.
2. **Sycophantic AI Chats:** Standard LLM sessions generate eloquent bull cases that validate whatever the user already holds—while quietly softening falsified claims or forgetting disconfirming filings three weeks later.
3. **False Diversification Blind Spots:** Holding single stocks alongside global or thematic ETFs plus external equity creates hidden 15–35% single-name or cluster concentrations that standard broker screens never aggregate.
4. **Silent Cross-Border Tax Leakage:** Non-US residents holding US-domiciled ETFs or equities above US\$60,000 face IRC §2101(c) estate tax exposure up to 40% alongside 30% vs. 15% dividend withholding drag.
5. **Buy-Only Tunnel Vision:** Most watchlists celebrate dips while ignoring the paired **sell & swap funding queue** (riskless tax swaps, held EXITs, and cap breaches) required to fund high-conviction adds cleanly.

## Top 5 Measurable Goals (`v0.5`)

1. **Zero-Key Automated Primary Signals:** Ingest SEC EDGAR filings (4 periodic + 10 event filings, 8-K/NT red flags), XBRL quarterly/annual financials & forensic ratios, Form 4 discretionary vs. 10b5-1 insider flows, extended-hours quotes, persisted FX, and a lean 4-indicator Macro Strip without paid API keys.
2. **3-Layer Shared Research Graph:** Connect macro/sector **Themes** (`themes/*.yaml`) -> **Stock Dossiers** (`theses/*.md` + `dossiers/<TICKER>/*`) -> **Portfolio & Point-in-Time Ledger** (`portfolio.json`, `test_log.jsonl`, `alerts_log.jsonl`) so revising a shared assumption automatically flags affected stocks for re-test.
3. **Behavioral & Mathematical Honesty:** Enforce outside-view GIGO valuation warnings, 3-part Reverse DCF attribution bridges, mechanical XBRL/EDGAR hypothesis auto-evaluation with anti-softening alerts, immutable `rule_change` rationale logs, and calm high-volatility (`VIX >= 28`) discipline.
4. **Paired Capital Rotation:** Present **Priority Sells & Tax Swaps** right next to **Dip Triage**, pairing US-ETF -> UCITS tax swaps, held mandatory exits, and cap-driven trims directly with staged buy tranches.
5. **Out-of-Sample Proof of Judgment:** Separate immature calls (`<30d PENDING`) from matured verdicts (`30d+ / 90d / 180d / 1Y`), track directional alpha against exact daily benchmark history, and score hypothesis calibration via Brier scores.

## Five Core Principles

### 1. Read-Only Sovereignty
Investment OS never places orders, modifies working orders, transfers funds, or handles brokerage trading credentials. Observation, underwriting, and discipline belong in one hardened tool; trade execution stays strictly inside your broker's own interface under human confirmation.

### 2. Local-First Privacy Isolation
Financial records are deeply personal. All user configuration, holdings, themes, dossiers, signals, and audit logs live strictly under `${PLUGIN_DATA}` (`0700` directory / `0600` files). Plugin code in `${PLUGIN_ROOT}` stays 100% generic, stateless, and shareable.

### 3. Calm Linear-Minimalist Precision
Financial interfaces fail when every number screams in neon colors. Investment OS follows Swiss hairline precision: monochrome surfaces (`light-dark()` + `color-mix(in oklab, ...)`), `tabular-nums` right-aligned columns, grayscale tonal charts, and muted crimson/forest accents reserved strictly for deltas, breaches, and falsified claims.

### 4. Falsification Over Conviction Theater
A real thesis specifies *what observable evidence proves it wrong* before a drawdown hits. Hypotheses carry machine-checkable `rule` predicates evaluated directly against XBRL, EDGAR, Form 4, or market data, preserving Point-in-Time snapshots and flagging softened scores automatically.

### 5. Non-Interrupting Side-Agent Flow
Research sweeps should never hijack your main coding or planning chat. Deterministic checks execute silently inside the sidecar via `app.callServerTool`, while deep Red-Team audits spawn background conversations (`target: "new"`) and update your main thread quietly via `updateModelContext()`.

## Explicit Non-Goals

- **Not a Trading Execution Bot:** Zero automated order routing or broker credential storage.
- **Not a Day-Trading Indicator Zoo:** No RSI/MACD/candlestick noise or sub-minute technical alerts—focused strictly on structural allocation, primary filings, valuation expectations, and multi-year compounding.
- **Not a Fake Hindsight Stock-Picking Backtester:** The Backtest Lab evaluates *portfolio-level correlation, drawdown, and regime impact* with explicit survivor/hindsight caveats—never data-mined factor overfitting.
- **Not a Cloud SaaS Aggregator:** Zero central accounts, remote databases, or telemetry beacons.
- **Not Personalized Financial or Tax Advice:** Deterministic calculators (including IRC §2101(c) schedules) are educational decision aids alongside qualified advisers.
