# Vision & Product Philosophy (`v0.8`)

## North Star Vision

> **Turn Antigravity into a calm, local-first Quantamental Personal CIO workstation that grounds decisions in primary filings, bottom-up unit economics, and analytical portfolio risk math—proving out-of-sample whether both your quantitative models and human judgment actually work.**

## The Problem

Serious long-only individual investors operate across fragmented, noisy tooling:

1. **Spreadsheet Rot:** Static spreadsheets break whenever FX moves, a split happens, or holdings span USD, EUR, SGD, GBP, or HKD accounts alongside unvested employer equity.
2. **Sycophantic AI Chats:** Generic LLM sessions generate eloquent bull cases that validate whatever the user already holds—while quietly softening falsified claims or forgetting disconfirming filings weeks later.
3. **False Diversification Blind Spots:** Holding single stocks alongside global or thematic ETFs plus external equity creates hidden 15–35% single-name or cluster concentrations that standard broker screens never aggregate.
4. **Silent Cross-Border Tax Leakage:** Non-US residents holding US-domiciled ETFs or equities above US\$60,000 face IRC §2101(c) estate tax exposure up to 40% alongside 30% vs. 15% dividend withholding drag.
5. **Unverified Math & Overfit AI Backtests:** "Prompt-engineered trading bots" frequently hide lookahead bias, massive multiple-testing luck, unrealistic slippage, and narrative price-target guesses behind flashy backtests without ever auditing estimator calibration or human forecasting skill out-of-sample.

## The 4-Pillar Closed Loop (`v0.8`)

Investment OS connects four auditable layers into one continuous CIO feedback loop:

1. **Ingest Clean Primary Reality:** Zero-key SEC EDGAR filings (4 periodic + 10 event filings, 3-tier red flags), SEC XBRL financials (Owner Earnings `FCF − SBC`, ROIC, Incremental ROIC, Sloan Accruals, Quality Grade `A`–`D`), Form 4 discretionary vs. 10b5-1 insider flows, multi-currency holdings, true ETF look-through, cross-border tax modeling, and delta-only Watchdog hygiene (`run_watchdog_sweep`).
2. **Underwrite Fundamentals Like a Long-Only Fund:** Layer-1 Shared Themes (`themes/*.yaml`), 3-lens adversarial deep dives, bottom-up 1–8 segment SOTP models (`unit_economics`, `cagr_margin`, `milestone_option` with dilution and net-cash bridges), Reverse DCF Expectations Gaps, Variant Perception KPI ledgers, and machine-checkable falsification rules (`hypotheses[].rule`) with anti-softening alerts.
3. **Size & Stress-Test with Analytical Quant Math:** Dynamic Ledoit-Wolf constant-correlation shrinkage (`λ*`), automatic Patton-Politis-White stationary block lengths (`L*`) with fat-tail CVaR crash simulation, Brier-calibrated Black-Litterman posterior blending (`Π = δ Σ w_mkt`), Jacobi PCA latent factor risk & Meucci Effective Bets (`N_eff`), and López de Prado HRP weights paired alongside Ranked Priority Sells & Tax Swaps.
4. **Audit Both Models & Human Judgment Out-of-Sample:** Strictly zero-lookahead expanding-window walk-forward validation (`run_quant_evaluation`) benchmarking Covariance (QLIKE & Vol RMSE), Tail Risk (Kupiec POF & Pinball Loss), and causal OOS Allocation Horse Races net of slippage—paired with a 30-day-matured Human Judgment Scorecard tracking Hypothesis Brier Calibration, Spearman Rank IC, and horizon-scaled Scenario Band Hit Rates.

## Five Core Principles

### 1. Read-Only Sovereignty
Investment OS never places orders, modifies working orders, transfers funds, or handles brokerage trading credentials. Observation, underwriting, calibration, and discipline belong in one hardened tool; capital execution stays strictly inside your broker's own interface under explicit human confirmation.

### 2. Local-First Privacy Isolation
Financial records are deeply personal. All user configuration, holdings, themes, dossiers, signals, and audit logs live strictly under `${PLUGIN_DATA}` (`0700` directory / `0600` files). Plugin code in `${PLUGIN_ROOT}` stays 100% generic, stateless, and shareable.

### 3. Calm Linear-Minimalist Precision
Financial interfaces fail when every metric screams in neon colors. Investment OS follows Swiss hairline precision: monochrome Slate surfaces (`light-dark()` + `color-mix(in oklab, ...)`), `tabular-nums` right-aligned columns, grayscale tonal charts, and muted semantic accents reserved strictly for deltas, breaches, and falsified claims.

### 4. Falsification & Empirical Calibration Over Conviction Theater
A real thesis specifies *what observable evidence proves it wrong* before a drawdown hits, and a real risk model proves its covariance and tail bands out-of-sample before sizing capital. Hypotheses carry machine-checkable `rule` predicates evaluated directly against XBRL/EDGAR/Form 4 data, while risk estimators answer to walk-forward QLIKE and Kupiec tests.

### 5. Non-Interrupting Side-Agent Flow
Research sweeps should never hijack your active workspace or chat. Deterministic checks and interactive SOTP slider sensitivity run locally at 60fps, while deep 3-lens company audits dispatch cleanly to background conversations (`target: "new"`) and update your main thread quietly via `updateModelContext()`.

## Explicit Non-Goals

- **Not an Autonomous LLM Trading Bot:** Zero automated order routing, leverage automation, or unread "make no mistake" curve-fitted futures bots. Every formula is auditable TypeScript backed by published estimators and zero-lookahead tests, and humans make every trade.
- **Not a Day-Trading Indicator Zoo:** No RSI/MACD/candlestick noise or sub-minute alerts—built strictly for multi-year fundamental compounding, portfolio risk geometry, and tax-aware allocation.
- **Not a Hindsight Stock-Picking Mirage:** Historical simulation explicitly separates causal out-of-sample walk-forward results from hindsight references and penalizes trial counts via Deflated Sharpe Ratio (`DSR`).
- **Not a Cloud SaaS Aggregator:** Zero central accounts, remote databases, or telemetry beacons.
- **Not Personalized Financial or Tax Advice:** Deterministic calculators (including IRC §2101(c) schedules) are educational decision aids alongside qualified advisers.
