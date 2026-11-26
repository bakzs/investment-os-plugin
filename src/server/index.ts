import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  buildDashboardPayload,
  buildSummaryText,
  executePortfolioBacktest,
  executePortfolioForecast,
  formatTimestamp,
  getDossierDetail,
  getThemeDetail,
  ingestResearchIntel,
  mergePortfolioPositions,
  recordThesisTest,
  saveDossierModelWithAudit,
  saveOrMergeThesis,
  upsertDossier,
  upsertSingleHypothesis,
  upsertTheme,
} from "./engine.js";
import { pollEdgarFilings } from "./edgar.js";
import { syncInsidersForm4 } from "./insiders.js";
import {
  BenchmarkConfigSchema,
  CatalystSchema,
  CurrencySchema,
  EtfWeightsConfigSchema,
  normalizeThemeSlug,
  normalizeTicker,
  PositionInputSchema,
  ProfileSchema,
  RiskCapRuleSchema,
  ThesisUpdateSchema,
  type CatalystRecord,
  type UserProfile,
} from "./schema.js";
import {
  ackWatchdogAlerts,
  listThesisFiles,
  loadCatalysts,
  loadEdgarCache,
  loadPortfolio,
  loadProfile,
  resolveDataDir,
  resolvePluginRoot,
  saveCatalysts,
  saveEtfWeights,
  savePortfolio,
  saveProfile,
} from "./storage.js";
import { runWatchdogSweep } from "./watchdog.js";
import { syncFundamentalsXbrl } from "./xbrl.js";

const APP_URI = "ui://investment-os/v7/dashboard.html";
const APP_MIME = "text/html;profile=mcp-app";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(path.resolve(process.argv[1] || process.cwd()));
const inferredRoot =
  path.basename(currentDir) === "dist"
    ? path.resolve(currentDir, "..")
    : path.resolve(currentDir, "..", "..");

const PLUGIN_ROOT = resolvePluginRoot(process.env, inferredRoot);
const DATA_DIR = resolveDataDir(process.argv.slice(2), process.env);

function resolveHtmlPath(): string {
  const fromEnv = process.env.INVESTMENT_OS_HTML?.trim();
  if (fromEnv && !fromEnv.includes("${")) return path.resolve(fromEnv);
  const direct = path.resolve(currentDir, "dashboard.html");
  if (fs.existsSync(direct)) return direct;
  return path.resolve(PLUGIN_ROOT, "dist", "dashboard.html");
}

const INLINE_META = { ui: { resourceUri: APP_URI } };
const PANE_META = {
  ui: { resourceUri: APP_URI },
  "com.google.antigravity/ui": {
    entrypoints: [
      { type: "aux_pane", title: "Investment OS" },
      { type: "global", title: "Investment OS" },
    ],
  },
};
const APP_ONLY_META = { ui: { visibility: ["app"] } };

const HYPOTHESIS_ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    claim: { type: "string" },
    metric: { type: "string" },
    status: { type: "string", enum: ["untested", "supported", "weakened", "falsified"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    evidence: { type: "string" },
    last_tested: { type: ["string", "null"] },
    source_url: { type: ["string", "null"] },
    is_core: { type: "boolean" },
    waiver_reason: { type: ["string", "null"] },
    waiver_expires: { type: ["string", "null"] },
    rule: {
      type: ["object", "null"],
      properties: {
        source: { type: "string", enum: ["xbrl", "edgar", "market", "insiders"] },
        metric: { type: "string" },
        op: { type: "string", enum: ["<=", "<", ">=", ">", "=="] },
        threshold: { type: "number" },
        period: { type: "string", enum: ["latest_q", "ttm", "latest_fy"] },
      },
      required: ["metric", "op", "threshold"],
    },
  },
  required: ["id", "claim"],
};

const THESIS_BASE_PROPERTIES = {
  ticker: { type: "string" },
  role: { type: "string" },
  yf_symbol: { type: "string" },
  currency: { type: "string" },
  us_situs: { type: "boolean" },
  tier: { type: "string", enum: ["active", "bench", "passed"] },
  action_verdict: { type: ["string", "null"], enum: ["GO", "WAIT", "PASS", null] },
  takeaway: { type: "array", items: { type: "string" }, maxItems: 3 },
  last_audited_date: { type: ["string", "null"] },
  price_at_audit: { type: ["number", "null"] },
  sources: {
    type: "array",
    items: {
      type: "object",
      properties: {
        label: { type: "string" },
        kind: { type: "string", enum: ["sec", "ibkr", "model", "market", "report"] },
        date: { type: ["string", "null"] },
        url: { type: ["string", "null"] },
      },
      required: ["label", "kind"],
    },
  },
  rejection_reason: { type: ["string", "null"] },
  reentry_trigger: { type: ["string", "null"] },
  reentry_price: { type: ["number", "null"] },
  buy_zone_low: { type: ["number", "null"] },
  buy_zone_high: { type: ["number", "null"] },
  trim_zone: { type: ["number", "null"] },
  clear_buy_zone: { type: "boolean" },
  clear_trim_zone: { type: "boolean" },
  gated: { type: "boolean" },
  max_weight_pct: { type: ["number", "null"] },
  next_catalyst_date: { type: ["string", "null"] },
  next_catalyst: { type: ["string", "null"] },
  theme_refs: { type: "array", items: { type: "string" }, maxItems: 12 },
  rationale: { type: "string", description: "Optional rationale logged as an immutable rule_change event when triggers/gates/caps change." },
  core_thesis: { type: "array", items: { type: "string" } },
  kill_switches: { type: "array", items: { type: "string" } },
  decision_log_note: { type: "string" },
  verdict: {
    type: ["string", "null"],
    enum: ["HIGH_CONVICTION", "WATCH", "PROBATION", "EXIT", null],
  },
  bear_case_summary: { type: ["string", "null"] },
  last_tested_date: { type: ["string", "null"] },
  hypotheses: {
    type: "array",
    items: HYPOTHESIS_ITEM_SCHEMA,
  },
};

const TOOLS: Tool[] = [
  {
    name: "open_dashboard",
    title: "Investment OS",
    description:
      "Open or refresh the interactive Investment OS v0.6 Executive Quantamental Personal-CIO sidecar dashboard showing unified wealth overview, Forward Portfolio Forecast & Action Simulator, look-through exposures, Priority Sells & Tax Swaps, living dossiers (Owner Earnings, ROIC, Reverse DCF bridge, 5Y scenarios, dip triage), Shared Themes, SEC EDGAR & Watchdog signals, and Backtest Lab.",
    inputSchema: {
      type: "object",
      properties: {
        tab: {
          type: "string",
          enum: ["overview", "forecast", "holdings", "theses", "edgar", "lab"],
          description: "Initial dashboard tab to focus.",
        },
        live: {
          type: "boolean",
          description: "If true, fetch live quotes (including extended hours), macro strip, VIX, and FX rates via Yahoo Finance.",
        },
        use_cache: {
          type: "boolean",
          description: "If true (when live is false), preserve cached live market prices and FX rates instead of reverting to snapshot reference prices.",
        },
        demo: {
          type: "boolean",
          description: "If true, render a read-only synthetic sample portfolio without modifying local files.",
        },
      },
    },
    _meta: PANE_META,
  },
  {
    name: "update_profile",
    title: "Update Investor Profile & Risk Caps",
    description:
      "Configure base currency, timezone, benchmark/hurdle assumptions (including hedge vs amortized estate-tax drag mode), tax residency / US NRA estate tax toggle, external equity (amount or live share qty) / cash reserve settings, and custom risk caps inside ${PLUGIN_DATA}/profile.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        base_currency: { type: "string", description: "3-letter ISO-4217 currency code (e.g., USD, SGD, EUR, GBP)." },
        timezone: { type: "string", description: "IANA timezone string (e.g., America/New_York, Asia/Singapore, Europe/London)." },
        edgar_user_agent: { type: "string" },
        custody_label: { type: "string" },
        benchmark: {
          type: "object",
          properties: {
            ticker: { type: "string" },
            yf_symbol: { type: "string" },
            label: { type: "string" },
            expected_cagr_pct: { type: "number" },
            alpha_buffer_pct: { type: "number" },
            estate_tax_drag_mode: { type: "string", enum: ["hedge", "amortized"] },
            estate_tax_hedge_bps: { type: "number" },
            estate_tax_amortize_years: { type: "integer" },
            estate_tax_annual_drag_pct: { type: ["number", "null"] },
            core_active_cap: { type: "integer" },
          },
        },
        tax_profile: {
          type: "object",
          properties: {
            country_code: { type: "string" },
            nra_us_estate_tax_enabled: { type: "boolean" },
            us_dividend_wht_pct: { type: "number" },
            ucits_dividend_wht_pct: { type: "number" },
            cgt_pct: { type: "number" },
          },
        },
        external_exposure: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            label: { type: "string" },
            ticker: { type: ["string", "null"] },
            qty: { type: ["number", "null"] },
            amount_base: { type: "number" },
            vested_pct: { type: ["number", "null"] },
            us_situs: { type: "boolean" },
            sector_tags: { type: "array", items: { type: "string" } },
            paired_label: { type: "string" },
            paired_tickers: { type: "array", items: { type: "string" } },
          },
        },
        liquidity_reserve: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            label: { type: "string" },
            amount_base: { type: "number" },
            horizon_months: { type: ["integer", "null"] },
          },
        },
        risk_caps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: { type: "string", enum: ["single_name_max", "ticker", "bucket", "us_situs"] },
              cap_pct: { type: "number" },
              ticker: { type: "string" },
              tickers: { type: "array", items: { type: "string" } },
              include_etf_residual_key: { type: "string" },
            },
            required: ["id", "label", "kind", "cap_pct"],
          },
        },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_portfolio_positions",
    title: "Update Portfolio Positions",
    description:
      "Persist multi-currency holdings, cash, accruals, or FX rates into ${PLUGIN_DATA}/portfolio.json (e.g., synced read-only from ibkr-mcp or parsed from statements) and refresh dashboard metrics.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["replace", "upsert"], description: "Replace entire position list (default) or upsert by ticker." },
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              qty: { type: "number" },
              avg_cost: { type: "number" },
              ref_price: { type: "number" },
              avg_cost_usd: { type: "number" },
              ref_price_usd: { type: "number" },
              currency: { type: "string" },
              yf_symbol: { type: "string" },
              name: { type: "string" },
              asset_type: { type: "string" },
              domicile: { type: "string" },
              us_situs: { type: "boolean" },
              isin: { type: "string" },
            },
            required: ["ticker", "qty"],
          },
        },
        cash_base: { type: "number" },
        accruals_base: { type: "number" },
        fx_rates: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Map of trading currency -> base_currency units per 1 trading currency unit (e.g., { USD: 1.29 }).",
        },
        source: { type: "string" },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_etf_weights",
    title: "Update ETF Look-Through Weights",
    description:
      "Validate and persist custom ETF constituent weights and metadata into ${PLUGIN_DATA}/etf_weights.json for accurate look-through aggregation.",
    inputSchema: {
      type: "object",
      properties: {
        as_of: { type: "string" },
        note: { type: "string" },
        etf_weights: {
          type: "object",
          description: "Map of ETF ticker -> map of constituent ticker -> fractional weight (0..1).",
        },
        etf_metadata: {
          type: "object",
          description: "Map of ETF ticker -> metadata object (isin, domicile, us_situs, ocf_pct, other_semis_residual, etc.).",
        },
      },
      required: ["etf_weights"],
    },
    _meta: INLINE_META,
  },
  {
    name: "update_external_wealth",
    title: "Update External Exposure & Cash Reserve",
    description:
      "Update external equity exposure (amount or live share qty), vested percentage, near-term liquidity reserve, or custody label inside ${PLUGIN_DATA}/profile.yaml and refresh the Investment OS dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        external_amount_base: { type: "number" },
        external_qty: { type: ["number", "null"] },
        external_enabled: { type: "boolean" },
        external_label: { type: "string" },
        external_ticker: { type: ["string", "null"] },
        vested_pct: { type: ["number", "null"] },
        reserve_amount_base: { type: "number" },
        reserve_enabled: { type: "boolean" },
        reserve_label: { type: "string" },
        horizon_months: { type: ["integer", "null"] },
        custody_label: { type: "string" },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_thesis",
    title: "Create or Update Stock Thesis Card",
    description:
      "Create or update a living thesis card (${PLUGIN_DATA}/theses/<TICKER>.md) with tier, action verdict, 3-line takeaway, theme_refs, provenance sources, buy/trim zones, re-entry triggers, binary gates, rule-backed hypotheses, kill-switches, and dated decision log notes.",
    inputSchema: {
      type: "object",
      properties: THESIS_BASE_PROPERTIES,
      required: ["ticker"],
    },
    _meta: INLINE_META,
  },
  {
    name: "upsert_dossier",
    title: "Create or Update Full Research Dossier",
    description:
      "Atomically upsert a stock's living thesis card (${PLUGIN_DATA}/theses/<TICKER>.md) plus optional Reverse DCF & Bear/Base/Bull valuation model (dossiers/<TICKER>/model.json), primary-source markdown research memo (dossiers/<TICKER>/memo.md), and external market intelligence (dossiers/<TICKER>/intel.json).",
    inputSchema: {
      type: "object",
      properties: {
        ...THESIS_BASE_PROPERTIES,
        model: {
          type: "object",
          description: "Optional 5Y valuation model (DossierModelSchema): reverse_dcf (with net_cash_b, annual_dilution_pct), scenarios, dividend_yield_pct, accumulating, dividend_wht_pct, tranches.",
        },
        memo_md: {
          type: "string",
          description: "Optional full primary-source markdown research memo saved to dossiers/<TICKER>/memo.md.",
        },
        intel: {
          type: "object",
          description: "Optional structured broker/market intelligence saved to dossiers/<TICKER>/intel.json.",
        },
      },
      required: ["ticker"],
    },
    _meta: INLINE_META,
  },
  {
    name: "upsert_theme",
    title: "Create or Update Shared Research Theme",
    description:
      "Create or update a Layer-1 shared macro/sector Theme Object (${PLUGIN_DATA}/themes/<slug>.yaml + optional <slug>.md) linking multiple stock dossiers via exposures[] and falsifiable signposts.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Kebab-case identifier (e.g., ai-compute-gpu-vs-tpu)." },
        title: { type: "string" },
        updated_at: { type: "string" },
        relationship_mode: { type: "string", enum: ["zero_sum", "symbiotic", "cyclical", "structural"] },
        summary: { type: "string" },
        shared_assumptions: { type: "array", items: { type: "string" } },
        exposures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              stance: { type: "string", enum: ["beneficiary", "hedged_tollbooth", "at_risk", "watch"] },
              note: { type: "string" },
            },
            required: ["ticker", "stance", "note"],
          },
        },
        signposts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              metric: { type: "string" },
              threshold: { type: "string" },
              status: { type: "string", enum: ["watching", "confirmed", "falsified"] },
              evidence: { type: ["string", "null"] },
              last_checked: { type: ["string", "null"] },
            },
            required: ["id", "metric"],
          },
        },
        sources: { type: "array", items: { type: "object" } },
        memo_md: { type: "string", description: "Optional companion markdown synthesis saved to themes/<slug>.md." },
      },
      required: ["slug", "title", "summary"],
    },
    _meta: INLINE_META,
  },
  {
    name: "ingest_research_intel",
    title: "Ingest Read-Only Broker & Market Intelligence",
    description:
      "Persist read-only external intelligence (e.g., from ibkr-mcp) into dossiers/<TICKER>/intel.json AND append numeric snapshots to dossiers/<TICKER>/intel_history.jsonl, history_cache.json, and/or pa_performance.json.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Required when ingesting ticker-level intel." },
        intel: {
          type: "object",
          description: "DossierIntelSchema payload: updated_at, provider, contract_id?, earnings_insight?, options_intel?, themes?, connections?.",
        },
        intel_history_entry: {
          type: "object",
          description: "Optional explicit numeric snapshot appended to dossiers/<TICKER>/intel_history.jsonl.",
        },
        history_series: {
          type: "array",
          description: "Optional array of weekly historical price series merged into history_cache.json.",
          items: { type: "object" },
        },
        pa_performance: {
          type: "object",
          description: "Optional account TWR/MWR summary saved to pa_performance.json.",
        },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "sync_fundamentals_xbrl",
    title: "Sync SEC XBRL Fundamentals",
    description:
      "Fetch official SEC EDGAR XBRL companyfacts (quarterly + annual financials and forensic ratios: GM%, DSO, DIO, OCF/NI, SBC%, Net Cash, TTM EPS/FCF) into dossiers/<TICKER>/fundamentals.json while preserving custom overrides.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" } },
        ticker: { type: "string" },
        force: { type: "boolean", description: "Force refresh even if cache is fresh (<7d) and no newer periodic filing landed." },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "sync_insiders_form4",
    title: "Sync SEC Form 4 / 13D Insiders",
    description:
      "Fetch incremental SEC Form 4 XML filings and Schedule 13D events separating discretionary buys/sales from 10b5-1 plans into dossiers/<TICKER>/insiders.json.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" } },
        ticker: { type: "string" },
        force: { type: "boolean", description: "Re-parse cached Form 4 accessions instead of incremental delta fetch." },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "run_watchdog_sweep",
    title: "Run CIO Delta Watchdog Sweep",
    description:
      "Execute a quiet delta-only CIO Watchdog sweep: refreshes extended quotes, FX, 4-indicator macro regime, hardened SEC EDGAR across all dossiers, conditional XBRL, and incremental Form 4 insiders, appending only genuine actionable deltas to alerts_log.jsonl.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" } },
        include_quotes: { type: "boolean" },
        include_macro: { type: "boolean" },
        include_edgar: { type: "boolean" },
        include_xbrl: { type: "boolean" },
        include_insiders: { type: "boolean" },
        force_xbrl: { type: "boolean" },
        force_insiders: { type: "boolean" },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "run_portfolio_backtest",
    title: "Run Deterministic Portfolio-Impact Backtest",
    description:
      "Simulate adding or sizing a candidate ticker into the current portfolio (with hybrid drift rebalancing, FX conversion, risk-free cash yield, Sharpe ± SE, and optional external wealth) across overlapping 5Y weekly history and benchmark regimes.",
    inputSchema: {
      type: "object",
      properties: {
        candidate_ticker: { type: "string", description: "Candidate stock or ETF ticker symbol." },
        candidate_yf_symbol: { type: "string", description: "Optional Yahoo Finance symbol override (e.g., ENR.DE, VWRA.L)." },
        target_weight_pct: { type: "number", description: "Target portfolio weight % (0.5 to 50, default 5)." },
        funding_source: {
          type: "string",
          description: 'Funding source: "cash", "pro_rata", or "swap:<HELD_TICKER>".',
        },
        rebalance_band_pct: { type: "number", description: "Relative drift rebalancing threshold % (default 25, floored at 2% absolute NAV drift)." },
        include_external_wealth: { type: "boolean", description: "Include configured external equity ticker in weights & cluster correlation (default true)." },
        rf_pct: { type: "number", description: "Annual risk-free rate % for Sharpe/Sortino and cash yield (defaults to cached 3M T-bill or 4.0%)." },
        tx_cost_bps: { type: "number", description: "Transaction cost & FX slippage in basis points per dollar traded (0-100, default 10)." },
        trials_tested: { type: "integer", description: "Number of candidate trials M for Bailey & López de Prado Deflated Sharpe Ratio (defaults to total dossier count)." },
        demo: { type: "boolean", description: "If true, simulate against Demo Preview portfolio and synthetic histories." },
      },
      required: ["candidate_ticker"],
    },
    _meta: INLINE_META,
  },
  {
    name: "simulate_portfolio_forecast",
    title: "Simulate Forward Portfolio Forecast & Action Plan",
    description:
      "Run a correlated fat-tail Monte Carlo (1,500 seeded Student-t paths, Ledoit-Wolf shrunk covariance blended with dossier 5Y after-tax scenarios) comparing Current Portfolio vs. Toggled Action Plan (UCITS tax swaps, mandatory exits, cap trims, planned buys, benchmark cash sweeps) over 1-10 years, reporting Bear/Base/Bull wealth trajectories, estate tax & WHT savings, cured risk caps, marginal risk contribution %, correlation-adjusted hurdles, and Quarter-Kelly sizing.",
    inputSchema: {
      type: "object",
      properties: {
        horizon_years: { type: "integer", description: "Forecast horizon in years (1-10, default 5)." },
        include_external_wealth: { type: "boolean", description: "Include external equity exposure in wealth fan & correlation (default true)." },
        apply_recommended_rotations: { type: "boolean", description: "Automatically apply all Tier 1 Tax Swaps, Tier 2 Mandatory Exits, and Tier 3 Cap Trims before applying custom actions (default false)." },
        actions: {
          type: "array",
          description: "Explicit ordered action list: tax_swap, sell, buy, or park_cash_in_benchmark.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["tax_swap", "sell", "buy", "park_cash_in_benchmark"] },
              ticker: { type: "string" },
              target_ticker: { type: "string" },
              pct: { type: "number" },
              amount_base: { type: "number" },
              yf_symbol: { type: "string" },
              currency: { type: "string" },
              us_situs: { type: "boolean" },
              keep_reserve: { type: "boolean" },
            },
            required: ["type"],
          },
        },
        regime_vol_multiplier: { type: "number", description: "Volatility stress multiplier (0.5-2.5, default 1.0; use 1.25 for High-Vol stress)." },
        simulations: { type: "integer", description: "Number of seeded Monte Carlo paths (200-5000, default 1500)." },
        rf_pct: { type: "number", description: "Annual risk-free rate % (defaults to cached 3M T-bill or 3.8%)." },
        return_model: { type: "string", enum: ["black_litterman", "raw_dossier"], description: "Expected return engine: Brier-calibrated Black-Litterman posterior (default) or raw 5Y dossier scenarios." },
        simulation_engine: { type: "string", enum: ["block_bootstrap", "student_t"], description: "Multivariate shock generator: Politis-Romano stationary block bootstrap (default, auto-falls back to Student-t if <80w aligned) or Student-t df=6." },
        block_length_weeks: { type: "integer", description: "Mean geometric block length in weeks for Politis-Romano bootstrap (2-26, default 6)." },
        demo: { type: "boolean", description: "Simulate against synthetic Demo Mode portfolio." },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "manage_catalysts",
    title: "Manage Binary Catalysts & SEC Gates",
    description:
      "Add, remove, or replace tracked catalyst dates and optional SEC form filing gates in ${PLUGIN_DATA}/catalysts.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "replace"] },
        catalyst: {
          type: "object",
          properties: {
            id: { type: "string" },
            date: { type: "string" },
            ticker: { type: "string" },
            title: { type: "string" },
            detail: { type: "string" },
            urgency: { type: "string", enum: ["high", "medium", "low"] },
            sec_gate: {
              type: "object",
              properties: {
                form: { type: "string" },
                filed_after: { type: "string" },
                description: { type: "string" },
              },
              required: ["form", "filed_after", "description"],
            },
          },
        },
        catalysts: {
          type: "array",
          items: { type: "object" },
        },
        id: { type: "string" },
        ticker: { type: "string" },
        date: { type: "string" },
      },
      required: ["action"],
    },
    _meta: INLINE_META,
  },
  {
    name: "check_sec_edgar",
    title: "Poll SEC EDGAR Filings",
    description:
      "Fetch recent official SEC EDGAR filings (4 periodic + 10 event filings per ticker, including NT 10-Q/K and 8-K forensic red-flag item codes) across US holdings and all dossiers, and evaluate configured filing gates.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tickers (defaults to US/ADR holdings, catalysts, and all Active/Bench/Passed dossiers).",
        },
        ticker: {
          type: "string",
          description: "Optional single ticker shorthand.",
        },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "record_thesis_test",
    title: "Record Systematic Thesis Test",
    description:
      "Record a systematic Red-Team thesis test for a stock: score falsifiable hypotheses, auto-capture Point-in-Time macro/model snapshot & benchmark price, update conviction verdict in theses/<TICKER>.md, and append an immutable entry to test_log.jsonl.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        verdict: { type: "string", enum: ["HIGH_CONVICTION", "WATCH", "PROBATION", "EXIT"] },
        action_verdict: { type: ["string", "null"], enum: ["GO", "WAIT", "PASS", null] },
        kill_switch_triggered: { type: "boolean" },
        summary: { type: "string" },
        bear_case: { type: "string" },
        tested_at: { type: "string" },
        price_at_test: { type: ["number", "null"] },
        benchmark_price_at_test: { type: ["number", "null"] },
        currency: { type: "string" },
        pit_snapshot: { type: ["object", "null"] },
        hypotheses_tested: {
          type: "array",
          items: HYPOTHESIS_ITEM_SCHEMA,
        },
      },
      required: ["ticker", "verdict", "summary"],
    },
    _meta: INLINE_META,
  },
  // App-only UI tools
  {
    name: "app_get_dashboard",
    title: "App Refresh Dashboard",
    description: "Internal UI tool to load, demo-preview, or live-refresh Investment OS state.",
    inputSchema: {
      type: "object",
      properties: {
        live: { type: "boolean" },
        use_cache: { type: "boolean" },
        tab: { type: "string", enum: ["overview", "forecast", "holdings", "theses", "edgar", "lab"] },
        demo: { type: "boolean" },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_check_edgar",
    title: "App Poll SEC EDGAR",
    description: "Internal UI tool to poll SEC EDGAR filings and evaluate active filing gates.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" } },
        use_cache: { type: "boolean" },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_run_watchdog",
    title: "App Run Delta Watchdog Sweep",
    description: "Internal UI tool to run a silent delta-only CIO Watchdog sweep (quotes, macro, EDGAR, XBRL, Form 4) and return the refreshed DashboardPayload.",
    inputSchema: {
      type: "object",
      properties: {
        include_xbrl: { type: "boolean" },
        include_insiders: { type: "boolean" },
        tab: { type: "string", enum: ["overview", "forecast", "holdings", "theses", "edgar", "lab"] },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_get_theme_detail",
    title: "App Load Shared Theme Detail",
    description: "Internal UI tool to lazy-load themes/<slug>.yaml, themes/<slug>.md, and linked dossier statuses for inspection.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        demo: { type: "boolean" },
        use_cache: { type: "boolean" },
      },
      required: ["slug"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_ack_alert",
    title: "App Acknowledge Watchdog Alert",
    description: "Internal UI tool to acknowledge one or more watchdog alerts (or '*' for all) in alerts_log.jsonl and return the refreshed DashboardPayload.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        use_cache: { type: "boolean" },
        tab: { type: "string", enum: ["overview", "forecast", "holdings", "theses", "edgar", "lab"] },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_save_external_wealth",
    title: "App Save External Wealth",
    description: "Internal UI tool to persist external exposure and cash reserve sliders into profile.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        external_amount_base: { type: "number" },
        external_qty: { type: ["number", "null"] },
        reserve_amount_base: { type: "number" },
        vested_pct: { type: ["number", "null"] },
        use_cache: { type: "boolean" },
      },
      required: ["external_amount_base", "reserve_amount_base"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_save_trigger",
    title: "App Save Trigger Zones",
    description: "Internal UI tool to update thesis frontmatter buy/trim trigger zones, gated state, and rule_change rationale.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        buy_zone_low: { type: ["number", "null"] },
        buy_zone_high: { type: ["number", "null"] },
        trim_zone: { type: ["number", "null"] },
        gated: { type: "boolean" },
        rationale: { type: "string" },
        use_cache: { type: "boolean" },
      },
      required: ["ticker"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_upsert_hypothesis",
    title: "App Upsert Falsifiable Hypothesis",
    description: "Internal UI tool to add or update a single falsifiable hypothesis (with optional machine-checkable rule) inside a thesis card.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        use_cache: { type: "boolean" },
        hypothesis: HYPOTHESIS_ITEM_SCHEMA,
      },
      required: ["ticker", "hypothesis"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_get_dossier_detail",
    title: "App Load Full Dossier Detail",
    description: "Internal UI tool to lazy-load dossiers/<TICKER>/{memo.md, model.json, intel.json, fundamentals.json, insiders.json, intel_history.jsonl}, valuation bands, and linked themes for the Stock Inspector drawer.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        demo: { type: "boolean" },
        use_cache: { type: "boolean" },
      },
      required: ["ticker"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_save_dossier_model",
    title: "App Save Dossier Valuation Model",
    description: "Internal UI tool to persist dossiers/<TICKER>/model.json edits (logging rule_change rationale) and return the refreshed dashboard payload.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        model: { type: "object" },
        rationale: { type: "string" },
        use_cache: { type: "boolean" },
      },
      required: ["ticker", "model"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_run_backtest",
    title: "App Run Deterministic Backtest",
    description: "Internal UI tool to fetch missing Yahoo weekly history (+ FX & daily benchmark) if needed and run the deterministic portfolio-impact backtest.",
    inputSchema: {
      type: "object",
      properties: {
        candidate_ticker: { type: "string" },
        candidate_yf_symbol: { type: "string" },
        target_weight_pct: { type: "number" },
        funding_source: { type: "string" },
        rebalance_band_pct: { type: "number" },
        include_external_wealth: { type: "boolean" },
        rf_pct: { type: "number" },
        tx_cost_bps: { type: "number" },
        trials_tested: { type: "integer" },
        demo: { type: "boolean" },
      },
      required: ["candidate_ticker"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_simulate_forecast",
    title: "App Simulate Forward Portfolio Forecast",
    description: "Internal UI tool to run the Black-Litterman + Block Bootstrap / Student-t forward portfolio forecast & what-if action simulator from the Forecast tab.",
    inputSchema: {
      type: "object",
      properties: {
        horizon_years: { type: "integer" },
        include_external_wealth: { type: "boolean" },
        apply_recommended_rotations: { type: "boolean" },
        actions: { type: "array", items: { type: "object" } },
        regime_vol_multiplier: { type: "number" },
        simulations: { type: "integer" },
        rf_pct: { type: "number" },
        return_model: { type: "string", enum: ["black_litterman", "raw_dossier"] },
        simulation_engine: { type: "string", enum: ["block_bootstrap", "student_t"] },
        block_length_weeks: { type: "integer" },
        demo: { type: "boolean" },
      },
    },
    _meta: APP_ONLY_META,
  },
];

function collectDefaultEdgarTickers(dataDir: string): string[] {
  const portfolio = loadPortfolio(dataDir);
  const catalysts = loadCatalysts(dataDir);
  const profile = loadProfile(dataDir);
  const theses = listThesisFiles(dataDir);
  const set = new Set<string>();

  if (portfolio) {
    for (const p of portfolio.positions) {
      if (p.us_situs || p.asset_type.includes("ADR")) {
        set.add(p.ticker);
      }
    }
  }
  for (const c of catalysts) {
    set.add(c.ticker);
  }
  for (const th of theses) {
    try {
      set.add(normalizeTicker(th.ticker));
    } catch {
      // skip non-ticker filenames
    }
  }
  if (profile.external_exposure.enabled && profile.external_exposure.ticker) {
    set.add(profile.external_exposure.ticker.toUpperCase());
  }
  return Array.from(set).sort();
}

function mergeProfileUpdate(current: UserProfile, args: Record<string, unknown>): UserProfile {
  const next: UserProfile = structuredClone(current);
  if (args.base_currency !== undefined) next.base_currency = CurrencySchema.parse(args.base_currency);
  if (args.timezone !== undefined) next.timezone = z.string().trim().min(1).max(64).parse(args.timezone);
  if (args.edgar_user_agent !== undefined) {
    next.edgar_user_agent = args.edgar_user_agent === null ? undefined : String(args.edgar_user_agent);
  }
  if (args.custody_label !== undefined) next.custody_label = z.string().trim().min(1).max(80).parse(args.custody_label);
  if (args.benchmark && typeof args.benchmark === "object") {
    next.benchmark = BenchmarkConfigSchema.parse({
      ...next.benchmark,
      ...(args.benchmark as Record<string, unknown>),
    });
  }
  if (args.tax_profile && typeof args.tax_profile === "object") {
    next.tax_profile = ProfileSchema.shape.tax_profile.parse({
      ...next.tax_profile,
      ...(args.tax_profile as Record<string, unknown>),
    });
  }
  if (args.external_exposure && typeof args.external_exposure === "object") {
    next.external_exposure = ProfileSchema.shape.external_exposure.parse({
      ...next.external_exposure,
      ...(args.external_exposure as Record<string, unknown>),
    });
  }
  if (args.liquidity_reserve && typeof args.liquidity_reserve === "object") {
    next.liquidity_reserve = ProfileSchema.shape.liquidity_reserve.parse({
      ...next.liquidity_reserve,
      ...(args.liquidity_reserve as Record<string, unknown>),
    });
  }
  if (Array.isArray(args.risk_caps)) {
    next.risk_caps = z.array(RiskCapRuleSchema).parse(args.risk_caps);
  }
  return ProfileSchema.parse(next);
}

const server = new Server(
  { name: "investment-os-dashboard", version: "0.7.0" },
  {
    capabilities: { tools: {}, resources: {} },
    instructions:
      "Institutional Quantamental Personal-CIO workstation: Black-Litterman & Politis-Romano Block Bootstrap forward portfolio forecasting with CVaR, PCA Effective Bets & HRP sizing, 3-layer research graph, automated SEC/XBRL (Owner Earnings, ROIC, Accruals)/Form 4 signal harness, and Deflated Sharpe backtest lab for Investment OS.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: APP_URI,
      name: "Investment OS Dashboard",
      title: "Investment OS Sidecar UI",
      description:
        "Interactive Quantamental Personal-CIO sidecar UI (multi-currency holdings, ETF look-through, Priority Sells & Tax Swaps, Macro Strip, Shared Themes, XBRL/Form 4 dossiers, Reverse DCF bridge, dip triage, backtest lab, and SEC EDGAR watchdog).",
      mimeType: APP_MIME,
      _meta: { ui: { prefersBorder: false } },
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== APP_URI) {
    throw new Error(`Unknown resource URI: ${request.params.uri}`);
  }
  const htmlPath = resolveHtmlPath();
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Built dashboard HTML not found at ${htmlPath}`);
  }
  const htmlText = fs.readFileSync(htmlPath, "utf-8");
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: APP_MIME,
        text: htmlText,
        _meta: { ui: { prefersBorder: false } },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "open_dashboard" || name === "app_get_dashboard") {
      const live = Boolean(args.live);
      const useCache = Boolean(args.use_cache);
      const demo = Boolean(args.demo);
      const tab = typeof args.tab === "string" ? args.tab : "overview";
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        live,
        useCache,
        activeTab: tab,
        demo,
      });
      return {
        content: [{ type: "text", text: buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_profile") {
      const current = loadProfile(DATA_DIR);
      const saved = saveProfile(DATA_DIR, mergeProfileUpdate(current, args));
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "overview",
      });
      return {
        content: [{ type: "text", text: `Updated profile.yaml (Base: ${saved.base_currency}).\n` + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_portfolio_positions") {
      const profile = loadProfile(DATA_DIR);
      const existing = loadPortfolio(DATA_DIR);
      const mode = args.mode === "upsert" ? "upsert" : "replace";
      const positions = Array.isArray(args.positions)
        ? args.positions.map((r) => PositionInputSchema.parse(r))
        : undefined;
      const fxRates = args.fx_rates
        ? z.record(CurrencySchema, z.number().finite().positive()).parse(args.fx_rates)
        : undefined;
      const merged = mergePortfolioPositions(existing, profile, {
        mode,
        positions,
        cash_base: args.cash_base !== undefined ? z.number().finite().parse(args.cash_base) : undefined,
        accruals_base: args.accruals_base !== undefined ? z.number().finite().parse(args.accruals_base) : undefined,
        fx_rates: fxRates,
        source: typeof args.source === "string" ? args.source : undefined,
      });
      savePortfolio(DATA_DIR, merged);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "holdings",
      });
      return {
        content: [{ type: "text", text: "Updated portfolio.json.\n" + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_etf_weights") {
      const validated = EtfWeightsConfigSchema.parse(args);
      const saved = saveEtfWeights(DATA_DIR, validated);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "holdings",
      });
      const etfCount = Object.keys(saved.etf_weights).length;
      return {
        content: [{ type: "text", text: `Updated etf_weights.json (${etfCount} ETF weight maps).\n` + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_external_wealth" || name === "app_save_external_wealth") {
      const profile = loadProfile(DATA_DIR);
      const next = structuredClone(profile);
      if (args.external_amount_base !== undefined) {
        const val = z.number().finite().min(0).parse(args.external_amount_base);
        next.external_exposure.amount_base = val;
        if (args.external_enabled === undefined) {
          next.external_exposure.enabled = val > 0 || next.external_exposure.enabled;
        }
      }
      if (args.external_qty !== undefined) {
        next.external_exposure.qty =
          args.external_qty === null ? null : z.number().finite().min(0).parse(args.external_qty);
      }
      if (args.external_enabled !== undefined) next.external_exposure.enabled = Boolean(args.external_enabled);
      if (args.external_label !== undefined) next.external_exposure.label = String(args.external_label);
      if (args.external_ticker !== undefined) {
        next.external_exposure.ticker =
          args.external_ticker === null ? null : normalizeTicker(String(args.external_ticker));
      }
      if (args.vested_pct !== undefined) {
        next.external_exposure.vested_pct =
          args.vested_pct === null ? null : z.number().finite().min(0).max(100).parse(args.vested_pct);
      }

      if (args.reserve_amount_base !== undefined) {
        const val = z.number().finite().min(0).parse(args.reserve_amount_base);
        next.liquidity_reserve.amount_base = val;
        if (args.reserve_enabled === undefined) {
          next.liquidity_reserve.enabled = val > 0 || next.liquidity_reserve.enabled;
        }
      }
      if (args.reserve_enabled !== undefined) next.liquidity_reserve.enabled = Boolean(args.reserve_enabled);
      if (args.reserve_label !== undefined) next.liquidity_reserve.label = String(args.reserve_label);
      if (args.horizon_months !== undefined) {
        next.liquidity_reserve.horizon_months =
          args.horizon_months === null ? null : z.number().int().min(0).max(600).parse(args.horizon_months);
      }
      if (args.custody_label !== undefined) {
        next.custody_label = z.string().trim().min(1).max(80).parse(args.custody_label);
      }

      saveProfile(DATA_DIR, next);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: Boolean(args.use_cache),
        activeTab: "overview",
      });
      return {
        content: [{ type: "text", text: "Updated profile.yaml external exposure & cash reserve.\n" + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_thesis" || name === "app_save_trigger") {
      const useCache = Boolean(args.use_cache);
      const normalizedArgs: Record<string, unknown> = { ...args };
      delete normalizedArgs.use_cache;
      if (name === "app_save_trigger") {
        if (
          ("buy_zone_low" in args && args.buy_zone_low === null) ||
          ("buy_zone_high" in args && args.buy_zone_high === null)
        ) {
          normalizedArgs.clear_buy_zone = true;
        }
        if ("trim_zone" in args && args.trim_zone === null) {
          normalizedArgs.clear_trim_zone = true;
        }
      }
      const parsed = ThesisUpdateSchema.parse(normalizedArgs);
      const profile = loadProfile(DATA_DIR);
      const writtenPath = saveOrMergeThesis(DATA_DIR, profile, parsed);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache,
        activeTab: "theses",
      });
      return {
        content: [{ type: "text", text: `Saved ${path.basename(writtenPath)}.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "upsert_dossier") {
      const profile = loadProfile(DATA_DIR);
      const res = upsertDossier(DATA_DIR, profile, args);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "theses",
      });
      const parts = [path.basename(res.thesisPath)];
      if (res.savedModel) parts.push(`dossiers/${res.ticker}/model.json`);
      if (res.savedMemo) parts.push(`dossiers/${res.ticker}/memo.md`);
      if (res.savedIntel) parts.push(`dossiers/${res.ticker}/intel.json`);
      return {
        content: [{ type: "text", text: `Upserted dossier for ${res.ticker}: ${parts.join(", ")}.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "upsert_theme") {
      const profile = loadProfile(DATA_DIR);
      const res = upsertTheme(DATA_DIR, profile, args);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "overview",
      });
      return {
        content: [
          {
            type: "text",
            text: `Upserted shared theme "${res.theme.slug}" (${res.theme.title})${res.savedMemo ? " + memo.md" : ""} linking ${res.linkedTickers.length} ticker(s): ${res.linkedTickers.join(", ") || "none"}.`,
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "ingest_research_intel") {
      const res = ingestResearchIntel(DATA_DIR, args);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: res.savedPa && !res.savedIntel ? "lab" : "theses",
      });
      const notes: string[] = [];
      if (res.savedIntel && res.ticker) notes.push(`dossiers/${res.ticker}/intel.json`);
      if (res.savedIntelHistory && res.ticker) notes.push(`dossiers/${res.ticker}/intel_history.jsonl`);
      if (res.savedSeriesCount > 0) notes.push(`${res.savedSeriesCount} history series`);
      if (res.savedPa) notes.push("pa_performance.json");
      return {
        content: [{ type: "text", text: `Ingested research intelligence: ${notes.join(", ")}.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "sync_fundamentals_xbrl") {
      const profile = loadProfile(DATA_DIR);
      let targets: string[] = [];
      if (Array.isArray(args.tickers) && args.tickers.length > 0) {
        targets = args.tickers.map((t) => normalizeTicker(String(t)));
      } else if (typeof args.ticker === "string" && args.ticker.trim()) {
        targets = [normalizeTicker(args.ticker)];
      } else {
        targets = collectDefaultEdgarTickers(DATA_DIR);
      }
      const edgarCache = loadEdgarCache(DATA_DIR);
      const { iso } = formatTimestamp(new Date(), profile.timezone);
      const res = await syncFundamentalsXbrl(DATA_DIR, profile, targets, {
        force: Boolean(args.force),
        nowIso: iso,
        edgarFilingsByTicker: edgarCache.filings_by_ticker,
      });
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: true,
        activeTab: "theses",
      });
      return {
        content: [
          {
            type: "text",
            text:
              `SEC XBRL sync complete: updated=[${res.updated.join(", ")}] cached=[${res.cached.join(", ")}] skipped=[${res.skipped.join(", ")}]` +
              (res.errors.length > 0 ? ` errors=[${res.errors.map((e) => `${e.ticker}: ${e.error}`).join("; ")}]` : ""),
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "sync_insiders_form4") {
      const profile = loadProfile(DATA_DIR);
      let targets: string[] = [];
      if (Array.isArray(args.tickers) && args.tickers.length > 0) {
        targets = args.tickers.map((t) => normalizeTicker(String(t)));
      } else if (typeof args.ticker === "string" && args.ticker.trim()) {
        targets = [normalizeTicker(args.ticker)];
      } else {
        targets = collectDefaultEdgarTickers(DATA_DIR);
      }
      const { iso } = formatTimestamp(new Date(), profile.timezone);
      const res = await syncInsidersForm4(DATA_DIR, profile, targets, {
        force: Boolean(args.force),
        nowIso: iso,
      });
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: true,
        activeTab: "theses",
      });
      return {
        content: [
          {
            type: "text",
            text:
              `SEC Form 4 sync complete: updated=[${res.updated.join(", ")}] cached=[${res.cached.join(", ")}] skipped=[${res.skipped.join(", ")}]` +
              (res.errors.length > 0 ? ` errors=[${res.errors.map((e) => `${e.ticker}: ${e.error}`).join("; ")}]` : ""),
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "run_watchdog_sweep" || name === "app_run_watchdog") {
      const tickers =
        Array.isArray(args.tickers) && args.tickers.length > 0
          ? args.tickers.map((t) => normalizeTicker(String(t)))
          : undefined;
      const sweep = await runWatchdogSweep(DATA_DIR, PLUGIN_ROOT, {
        tickers,
        includeQuotes: args.include_quotes !== undefined ? Boolean(args.include_quotes) : true,
        includeMacro: args.include_macro !== undefined ? Boolean(args.include_macro) : true,
        includeEdgar: args.include_edgar !== undefined ? Boolean(args.include_edgar) : true,
        includeXbrl: args.include_xbrl !== undefined ? Boolean(args.include_xbrl) : true,
        includeInsiders: args.include_insiders !== undefined ? Boolean(args.include_insiders) : true,
        forceXbrl: Boolean(args.force_xbrl),
        forceInsiders: Boolean(args.force_insiders),
      });
      const tab = typeof args.tab === "string" ? args.tab : "overview";
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        live: false,
        useCache: true,
        activeTab: tab,
      });
      return {
        content: [{ type: "text", text: sweep.summary }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_get_theme_detail") {
      const slug = normalizeThemeSlug(String(args.slug ?? ""));
      const detail = await getThemeDetail({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        slug,
        demo: Boolean(args.demo),
        useCache: Boolean(args.use_cache),
      });
      return {
        content: [{ type: "text", text: `Loaded theme detail for ${detail.slug}.` }],
        structuredContent: detail as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_ack_alert") {
      const ids = Array.isArray(args.ids)
        ? args.ids.map((x) => String(x))
        : typeof args.id === "string" && args.id.trim()
          ? [args.id.trim()]
          : [];
      const ackRes = ids.length > 0 ? ackWatchdogAlerts(DATA_DIR, ids) : { updated: 0, alerts: [] };
      const tab = typeof args.tab === "string" ? args.tab : "overview";
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: Boolean(args.use_cache),
        activeTab: tab,
      });
      return {
        content: [{ type: "text", text: `Acknowledged ${ackRes.updated} watchdog alert(s).` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "run_portfolio_backtest") {
      const { backtest, payload } = await executePortfolioBacktest({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        rawRequest: args,
      });
      const text = [
        `Deterministic Backtest: ${backtest.candidate_ticker} @ ${backtest.target_weight_pct}% (funded: ${backtest.funding_source}, band: max(2%, ${backtest.rebalance_band_pct}%), rf=${backtest.rf_pct}%, tx=${backtest.tx_cost_bps}bps, DSR M=${backtest.trials_tested})`,
        `- Window: ${backtest.overlap_start} to ${backtest.overlap_end} (${backtest.weeks_analyzed}w | External Wealth: ${backtest.include_external_wealth ? "Included" : "Excluded"})`,
        `- Baseline: CAGR ${backtest.baseline.cagr_pct}% | Max DD ${backtest.baseline.max_drawdown_pct}% | Sharpe ${backtest.baseline.sharpe} ± ${backtest.baseline.sharpe_se} | Wk CVaR95 ${backtest.baseline.cvar_95_weekly_pct}% | Rebalances: ${backtest.baseline.rebalance_count}`,
        `- Simulated: CAGR ${backtest.simulated.cagr_pct}% (${backtest.deltas.cagr_pct >= 0 ? "+" : ""}${backtest.deltas.cagr_pct}%) | Max DD ${backtest.simulated.max_drawdown_pct}% | Sharpe ${backtest.simulated.sharpe} ± ${backtest.simulated.sharpe_se} | DSR Prob ${backtest.simulated.deflated_sharpe_prob_pct}% (SR0=${backtest.sr0_annual_threshold}) | Wk CVaR95 ${backtest.simulated.cvar_95_weekly_pct}% | Turnover ${backtest.simulated.total_turnover_pct}% (${backtest.simulated.tx_cost_drag_bps} bps/yr drag)`,
        `- Benchmark (${backtest.benchmark_symbol}): CAGR ${backtest.benchmark.cagr_pct}% | Max DD ${backtest.benchmark.max_drawdown_pct}% | Sharpe ${backtest.benchmark.sharpe}`,
        `- Correlation vs Portfolio: ${backtest.candidate_corr_portfolio ?? "N/A"} | vs Primary Cluster: ${backtest.candidate_corr_cluster ?? "N/A"}`,
        `- Caveat: ${backtest.caveat}`,
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "simulate_portfolio_forecast") {
      const { forecast, payload } = await executePortfolioForecast({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        rawRequest: args,
      });
      const ccy = forecast.base_currency;
      const fmtM = (n: number) => `${Math.round(n).toLocaleString("en-US")} ${ccy}`;
      const fmtDeltaM = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")} ${ccy}`;
      const pc1Base = forecast.baseline.factor_risk.top_factors[0];
      const pc1Sim = forecast.simulated.factor_risk.top_factors[0];
      const text = [
        `Forward Portfolio Forecast (${forecast.horizon_years}Y | ${forecast.return_model} | ${forecast.simulation_engine_used} | ${forecast.simulations} paths | External Wealth: ${forecast.include_external_wealth ? "Included" : "Excluded"} | Vol×${forecast.regime_vol_multiplier}):`,
        `- Starting Wealth: ${fmtM(forecast.baseline.starting_wealth_base)} | Actions Applied: ${forecast.applied_actions.length}${forecast.cash_shortfall_base > 0 ? ` (Cash shortfall: ${fmtM(forecast.cash_shortfall_base)})` : ""}`,
        `- Current Path (${forecast.horizon_years}Y): CVaR10 ${fmtM(forecast.baseline.ending_cvar_10_base)} | Bear P10 ${fmtM(forecast.baseline.ending_p10_base)} | Base P50 ${fmtM(forecast.baseline.ending_p50_base)} (${forecast.baseline.expected_cagr_p50_pct}% CAGR) | Bull P90 ${fmtM(forecast.baseline.ending_p90_base)} | MaxDD P95 ${forecast.baseline.sim_max_dd_p95_pct}% | Vol ${forecast.baseline.annual_vol_pct}% | Sharpe ${forecast.baseline.expected_sharpe}`,
        `- Action Plan (${forecast.horizon_years}Y): CVaR10 ${fmtM(forecast.simulated.ending_cvar_10_base)} (${fmtDeltaM(forecast.deltas.cvar_10_base)}) | Bear P10 ${fmtM(forecast.simulated.ending_p10_base)} (${fmtDeltaM(forecast.deltas.p10_base)}) | Base P50 ${fmtM(forecast.simulated.ending_p50_base)} (${fmtDeltaM(forecast.deltas.p50_base)}, ${forecast.simulated.expected_cagr_p50_pct}% CAGR) | Bull P90 ${fmtM(forecast.simulated.ending_p90_base)} | MaxDD P95 ${forecast.simulated.sim_max_dd_p95_pct}% | Vol ${forecast.simulated.annual_vol_pct}% | Sharpe ${forecast.simulated.expected_sharpe}`,
        `- Latent Factor Risk (PCA): Effective Bets ${forecast.baseline.factor_risk.effective_bets} -> ${forecast.simulated.factor_risk.effective_bets} (${forecast.deltas.effective_bets >= 0 ? "+" : ""}${forecast.deltas.effective_bets}) | Beta ${forecast.baseline.factor_risk.market_beta ?? "n/a"} -> ${forecast.simulated.factor_risk.market_beta ?? "n/a"}${pc1Base && pc1Sim ? ` | PC1 ${pc1Base.variance_share_pct}% -> ${pc1Sim.variance_share_pct}% (${pc1Sim.top_tickers.join(", ")})` : ""}`,
        `- Tax & Risk Impact: Estate Tax Saved ${fmtM(forecast.deltas.estate_tax_saved_base)} | Annual WHT Saved ${fmtM(forecast.deltas.annual_wht_saved_base)}/yr | US-Situs ${forecast.baseline.us_situs_portfolio_pct}% -> ${forecast.simulated.us_situs_portfolio_pct}% | Cap Breaches ${forecast.baseline.cap_breaches_count} -> ${forecast.simulated.cap_breaches_count}${forecast.deltas.cured_caps.length > 0 ? ` (Cured: ${forecast.deltas.cured_caps.join(", ")})` : ""}`,
        `- Benchmark (${forecast.benchmark_ticker} @ ${forecast.benchmark_cagr_pct}%): ${fmtM(forecast.benchmark_ending_base)} | Prob Beat Bench: ${forecast.baseline.prob_beat_benchmark_pct}% -> ${forecast.simulated.prob_beat_benchmark_pct}%`,
        `- Black-Litterman: ${forecast.black_litterman.note}`,
        `- Methodology: ${forecast.methodology_note}`,
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "manage_catalysts") {
      const action = z.enum(["add", "remove", "replace"]).parse(args.action);
      let current = loadCatalysts(DATA_DIR);
      if (action === "replace") {
        const list = z.array(CatalystSchema).parse(args.catalysts ?? []);
        current = saveCatalysts(DATA_DIR, list);
      } else if (action === "add") {
        const item = CatalystSchema.parse(args.catalyst);
        const filtered = current.filter(
          (c) =>
            !(
              (item.id && c.id === item.id) ||
              (c.date === item.date && c.ticker === item.ticker && c.title === item.title)
            ),
        );
        filtered.push(item);
        filtered.sort((a, b) => a.date.localeCompare(b.date));
        current = saveCatalysts(DATA_DIR, filtered);
      } else if (action === "remove") {
        const id = typeof args.id === "string" ? args.id : undefined;
        const ticker = typeof args.ticker === "string" ? normalizeTicker(args.ticker) : undefined;
        const date = typeof args.date === "string" ? args.date : undefined;
        const filtered = current.filter((c) => {
          if (id && c.id === id) return false;
          if (ticker && date && c.ticker === ticker && c.date === date) return false;
          if (ticker && !date && !id && c.ticker === ticker) return false;
          return true;
        });
        current = saveCatalysts(DATA_DIR, filtered);
      }
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "edgar",
      });
      return {
        content: [{ type: "text", text: `Updated catalysts.yaml (${current.length} tracked catalysts).` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "check_sec_edgar" || name === "app_check_edgar") {
      const profile = loadProfile(DATA_DIR);
      const catalysts: CatalystRecord[] = loadCatalysts(DATA_DIR);
      let targets: string[] = [];
      if (Array.isArray(args.tickers) && args.tickers.length > 0) {
        targets = args.tickers.map((t) => normalizeTicker(String(t)));
      } else if (typeof args.ticker === "string" && args.ticker.trim()) {
        targets = [normalizeTicker(args.ticker)];
      } else {
        targets = collectDefaultEdgarTickers(DATA_DIR);
      }
      const { iso } = formatTimestamp(new Date(), profile.timezone);
      const { cache, skippedTickers, redFlags } =
        targets.length > 0
          ? await pollEdgarFilings(DATA_DIR, profile, targets, catalysts, iso)
          : {
              cache: { checked_at: iso, gate_evaluations: [], filings_by_ticker: {} },
              skippedTickers: [],
              redFlags: [],
            };
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: Boolean(args.use_cache),
        activeTab: "edgar",
      });
      const gateLines = cache.gate_evaluations.map(
        (g) => `${g.ticker} (${g.form} after ${g.filed_after}): ${g.cleared ? "CLEARED" : "OPEN"} — ${g.description}`,
      );
      const flagLines = redFlags.slice(0, 8).map((f) => `${f.ticker} [${f.code} · ${f.filingDate}]: ${f.label}`);
      return {
        content: [
          {
            type: "text",
            text:
              `SEC EDGAR checked (${cache.checked_at}) for ${targets.length} ticker(s).` +
              (skippedTickers.length > 0 ? `\nNon-SEC/Skipped: ${skippedTickers.join(", ")}` : "") +
              (gateLines.length > 0 ? `\nGates:\n- ${gateLines.join("\n- ")}` : "") +
              (flagLines.length > 0 ? `\nForensic Red Flags:\n- ${flagLines.join("\n- ")}` : ""),
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "record_thesis_test") {
      const profile = loadProfile(DATA_DIR);
      const { thesisPath, record } = recordThesisTest(DATA_DIR, profile, args);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "theses",
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Recorded systematic thesis test for ${record.ticker} (${record.tested_at}): ` +
              `Verdict=${record.verdict}${record.kill_switch_triggered ? " [KILL-SWITCH TRIGGERED]" : ""} ` +
              `| Updated ${path.basename(thesisPath)} and test_log.jsonl.\nSummary: ${record.summary}`,
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_upsert_hypothesis") {
      const profile = loadProfile(DATA_DIR);
      const ticker = normalizeTicker(String(args.ticker ?? ""));
      const writtenPath = upsertSingleHypothesis(DATA_DIR, profile, ticker, args.hypothesis);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: Boolean(args.use_cache),
        activeTab: "theses",
      });
      return {
        content: [{ type: "text", text: `Saved hypothesis in ${path.basename(writtenPath)}.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_get_dossier_detail") {
      const ticker = normalizeTicker(String(args.ticker ?? ""));
      const detail = await getDossierDetail({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        ticker,
        demo: Boolean(args.demo),
        useCache: Boolean(args.use_cache),
      });
      return {
        content: [{ type: "text", text: `Loaded dossier detail for ${detail.ticker}.` }],
        structuredContent: detail as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_save_dossier_model") {
      const profile = loadProfile(DATA_DIR);
      const ticker = normalizeTicker(String(args.ticker ?? ""));
      const rationale = typeof args.rationale === "string" ? args.rationale : undefined;
      saveDossierModelWithAudit(DATA_DIR, profile, ticker, args.model, rationale);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        useCache: Boolean(args.use_cache),
        activeTab: "theses",
      });
      return {
        content: [{ type: "text", text: `Saved dossiers/${ticker}/model.json.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_run_backtest") {
      const { backtest } = await executePortfolioBacktest({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        rawRequest: args,
      });
      return {
        content: [{ type: "text", text: `Completed backtest for ${backtest.candidate_ticker} (${backtest.weeks_analyzed}w).` }],
        structuredContent: backtest as unknown as Record<string, unknown>,
      };
    }

    if (name === "app_simulate_forecast") {
      const { forecast } = await executePortfolioForecast({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        rawRequest: args,
      });
      return {
        content: [{ type: "text", text: `Simulated ${forecast.horizon_years}Y forecast (${forecast.applied_actions.length} actions).` }],
        structuredContent: forecast as unknown as Record<string, unknown>,
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error in ${name}: ${msg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal MCP server error: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
