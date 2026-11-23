import yaml from "js-yaml";
import { fetchFxRatesToBase, fetchQuotesBatch, type QuoteResult } from "./market.js";
import {
  CurrencySchema,
  normalizeTicker,
  PortfolioSchema,
  PositionInputSchema,
  ProfileSchema,
  type CatalystRecord,
  type EtfWeightsConfig,
  type PortfolioRecord,
  type PositionRecord,
  type RiskCapRule,
  type ThesisUpdateInput,
  type UserProfile,
} from "./schema.js";
import {
  listThesisFiles,
  loadCatalysts,
  loadEdgarCache,
  loadEtfWeights,
  loadPortfolio,
  loadProfile,
  readThesisFile,
  type EdgarCacheState,
  writeThesisFile,
} from "./storage.js";
import { evaluateSecGates } from "./edgar.js";

const SHARE_CLASS_GROUPS: Record<string, { canonical: string; members: string[] }> = {
  GOOG: { canonical: "GOOG/GOOGL", members: ["GOOGL", "GOOG"] },
  GOOGL: { canonical: "GOOG/GOOGL", members: ["GOOGL", "GOOG"] },
};

export function canonicalAssetName(ticker: string): string {
  const sym = ticker.trim().toUpperCase();
  return SHARE_CLASS_GROUPS[sym]?.canonical ?? sym;
}

export function memberTickersForCanonical(canonical: string): string[] {
  const upper = canonical.trim().toUpperCase();
  if (upper === "GOOG/GOOGL") return ["GOOGL", "GOOG"];
  if (upper.includes("/")) return upper.split("/").map((s) => s.trim()).filter(Boolean);
  const group = SHARE_CLASS_GROUPS[upper];
  return group ? group.members : [upper];
}

export function inferSecurityMeta(ticker: string, isin = ""): {
  yf_symbol: string;
  domicile: string;
  us_situs: boolean;
  asset_type: string;
  currency: string;
} {
  const sym = ticker.trim().toUpperCase();
  const cleanIsin = isin.trim().toUpperCase();
  if (sym === "VWRA" || sym === "VWRA.L" || cleanIsin.startsWith("IE")) {
    return {
      yf_symbol: sym.endsWith(".L") ? sym : "VWRA.L",
      domicile: "Ireland",
      us_situs: false,
      asset_type: "UCITS ETF",
      currency: "USD",
    };
  }
  if (sym.endsWith(".DE") || cleanIsin.startsWith("DE")) {
    return {
      yf_symbol: sym,
      domicile: "Germany",
      us_situs: false,
      asset_type: "Foreign Equity",
      currency: "EUR",
    };
  }
  if (sym.endsWith(".L") || cleanIsin.startsWith("GB")) {
    return {
      yf_symbol: sym,
      domicile: "UK",
      us_situs: false,
      asset_type: "UK Security",
      currency: "GBP",
    };
  }
  if (sym.endsWith(".SI") || cleanIsin.startsWith("SG")) {
    return {
      yf_symbol: sym,
      domicile: "Singapore",
      us_situs: false,
      asset_type: "SG Security",
      currency: "SGD",
    };
  }
  if (sym === "SPY" || sym === "VOO" || sym === "VTI" || sym === "QQQ" || sym === "VT") {
    return {
      yf_symbol: sym,
      domicile: "US",
      us_situs: true,
      asset_type: "US ETF",
      currency: "USD",
    };
  }
  if (sym === "TSM" || sym === "ASML" || sym === "ARGX" || cleanIsin.startsWith("NL") || cleanIsin.startsWith("TW")) {
    return {
      yf_symbol: sym,
      domicile: sym === "TSM" ? "Taiwan ADR" : "Netherlands ADR",
      us_situs: false,
      asset_type: "Non-US ADR",
      currency: "USD",
    };
  }
  if (sym === "NU" || sym === "SE" || cleanIsin.startsWith("KY")) {
    return {
      yf_symbol: sym,
      domicile: "Cayman Islands",
      us_situs: false,
      asset_type: "Non-US Equity",
      currency: "USD",
    };
  }
  return {
    yf_symbol: sym,
    domicile: "US",
    us_situs: true,
    asset_type: "US Equity",
    currency: "USD",
  };
}

export interface UsEstateTaxResult {
  us_situs_usd: number;
  taxable_excess_over_60k_usd: number;
  tentative_tax_usd: number;
  unified_credit_usd: number;
  net_estate_tax_usd: number;
  effective_rate_pct: number;
  marginal_rate_pct: number;
}

/**
 * Exact U.S. Federal Estate Tax for Non-Resident Aliens (IRC §2101(c) & §2102(b)(1)):
 * progressive 18%-40% tentative tax minus $13,000 unified credit ($60,000 exemption).
 */
export function computeUsEstateTaxNra(usSitusUsd: number): UsEstateTaxResult {
  if (!Number.isFinite(usSitusUsd) || usSitusUsd <= 60000) {
    return {
      us_situs_usd: round(Math.max(0, usSitusUsd || 0), 2),
      taxable_excess_over_60k_usd: 0,
      tentative_tax_usd: 0,
      unified_credit_usd: 13000,
      net_estate_tax_usd: 0,
      effective_rate_pct: 0,
      marginal_rate_pct: 0,
    };
  }

  const brackets: [number, number][] = [
    [10000, 0.18],
    [20000, 0.2],
    [40000, 0.22],
    [60000, 0.24],
    [80000, 0.26],
    [100000, 0.28],
    [150000, 0.3],
    [250000, 0.32],
    [500000, 0.34],
    [750000, 0.37],
    [1000000, 0.39],
    [Number.POSITIVE_INFINITY, 0.4],
  ];

  let tentative = 0;
  let prev = 0;
  let marginal = 0.18;
  for (const [cap, rate] of brackets) {
    if (usSitusUsd > prev) {
      const slice = Math.min(usSitusUsd, cap) - prev;
      tentative += slice * rate;
      marginal = rate;
      prev = cap;
    } else {
      break;
    }
  }
  const netTax = Math.max(0, tentative - 13000);
  return {
    us_situs_usd: round(usSitusUsd, 2),
    taxable_excess_over_60k_usd: round(usSitusUsd - 60000, 2),
    tentative_tax_usd: round(tentative, 2),
    unified_credit_usd: 13000,
    net_estate_tax_usd: round(netTax, 2),
    effective_rate_pct: round((netTax / usSitusUsd) * 100, 2),
    marginal_rate_pct: round(marginal * 100, 1),
  };
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatTimestamp(date: Date, timeZone: string): { iso: string; dateYmd: string } {
  let tz = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(date);
  } catch {
    tz = "UTC";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") === "24" ? "00" : get("hour");
  const minute = get("minute");
  const second = get("second");
  const offsetRaw = get("timeZoneName").replace(/^GMT/, "");

  let offset = "+00:00";
  if (offsetRaw && offsetRaw !== "UTC") {
    const m = offsetRaw.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (m) {
      offset = `${m[1]}${m[2].padStart(2, "0")}:${(m[3] ?? "00").padStart(2, "0")}`;
    }
  }

  const dateYmd = `${year}-${month}-${day}`;
  return {
    iso: `${dateYmd}T${hour}:${minute}:${second}${offset}`,
    dateYmd,
  };
}

export interface ThesisFrontmatter {
  ticker: string;
  yf_symbol?: string;
  currency?: string;
  us_situs?: boolean;
  role?: string;
  last_ref_price?: number | null;
  buy_zone_low?: number | null;
  buy_zone_high?: number | null;
  trim_zone?: number | null;
  max_weight_pct?: number | null;
  max_ibkr_weight_pct?: number | null;
  next_catalyst_date?: string | null;
  next_catalyst?: string | null;
  gated?: boolean;
}

export function classifyTriggerStatus(price: number | null, fm: ThesisFrontmatter): string {
  const gated = Boolean(fm.gated);
  const low = fm.buy_zone_low ?? null;
  const high = fm.buy_zone_high ?? null;
  const trim = fm.trim_zone ?? null;

  if (price === null || !Number.isFinite(price)) {
    return "NO PRICE";
  }
  if (trim !== null && price >= trim) {
    return "TRIM / EXIT ZONE";
  }
  if (low !== null && high !== null && price >= low && price <= high) {
    return gated ? "GATED (IN BUY ZONE)" : "IN BUY ZONE";
  }
  if (low !== null && price < low) {
    return gated ? "GATED (DEEP VALUE)" : "DEEP VALUE / CHECK THESIS";
  }
  if (low === null && high === null && trim === null) {
    return "NO ACTIVE ZONE";
  }
  return gated ? "GATED / WAIT" : "HOLD / WAIT";
}

function extractSectionBullets(body: string, headingPrefix: string, limit: number): string[] {
  const lines = body.split(/\r?\n/);
  let inSec = false;
  const bullets: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inSec) break;
      if (line.toLowerCase().startsWith(headingPrefix.toLowerCase())) {
        inSec = true;
      }
      continue;
    }
    if (inSec) {
      const s = line.trim();
      if (s.startsWith("- ") || /^\d+\.\s+/.test(s)) {
        const clean = s
          .replace(/^(- |\d+\.\s+)/, "")
          .replace(/\*\*/g, "")
          .replace(/`/g, "")
          .slice(0, 260);
        bullets.push(clean);
        if (bullets.length >= limit) break;
      }
    }
  }
  return bullets;
}

export function parseThesisMarkdown(raw: string): { fm: ThesisFrontmatter; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const endIdx = normalized.indexOf("\n---\n", 4);
  if (endIdx === -1) return null;
  const fmRaw = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5);
  const loaded = yaml.load(fmRaw);
  if (!loaded || typeof loaded !== "object") return null;
  const fm = loaded as ThesisFrontmatter;
  if (!fm.ticker) return null;
  return { fm, body };
}

export function upsertThesisMarkdown(
  existingRaw: string | null,
  update: ThesisUpdateInput,
  todayYmd: string,
): string {
  const sym = normalizeTicker(update.ticker);
  let fm: Record<string, unknown>;
  let body: string;

  if (existingRaw) {
    const parsed = parseThesisMarkdown(existingRaw);
    if (!parsed) {
      throw new Error(`Invalid frontmatter in thesis card for ${sym}`);
    }
    fm = { ...(parsed.fm as unknown as Record<string, unknown>) };
    body = parsed.body;
  } else {
    const meta = inferSecurityMeta(sym);
    fm = {
      ticker: sym,
      yf_symbol: update.yf_symbol ?? meta.yf_symbol,
      currency: update.currency ?? meta.currency,
      us_situs: update.us_situs ?? meta.us_situs,
      role: update.role ?? "Watchlist / Satellite",
      last_ref_price: null,
      buy_zone_low: null,
      buy_zone_high: null,
      trim_zone: null,
      max_weight_pct: update.max_weight_pct ?? 10.0,
      next_catalyst_date: update.next_catalyst_date ?? null,
      next_catalyst: update.next_catalyst ?? null,
      gated: update.gated ?? false,
    };

    const thesisBullets =
      update.core_thesis && update.core_thesis.length > 0
        ? update.core_thesis.map((b) => `- ${b}`).join("\n")
        : "- Document core compounding thesis, moat, and valuation anchor here.";
    const killBullets =
      update.kill_switches && update.kill_switches.length > 0
        ? update.kill_switches.map((k, idx) => `${idx + 1}. ${k}`).join("\n")
        : "1. Define objective accounting, balance-sheet, or thesis-break triggers here.";

    body = `# ${sym}\n\n## 1. Core Thesis\n${thesisBullets}\n\n## 2. Pre-Set Buy / Trim Price Zones\n- Maintained dynamically via Investment OS frontmatter.\n\n## 3. Hard Kill-Switches\n${killBullets}\n\n## 4. Decision Log\n`;
  }

  if (update.role !== undefined) fm.role = update.role;
  if (update.yf_symbol !== undefined) fm.yf_symbol = update.yf_symbol;
  if (update.currency !== undefined) fm.currency = update.currency;
  if (update.us_situs !== undefined) fm.us_situs = update.us_situs;

  if (update.clear_buy_zone) {
    fm.buy_zone_low = null;
    fm.buy_zone_high = null;
  } else {
    if (update.buy_zone_low !== undefined) fm.buy_zone_low = update.buy_zone_low;
    if (update.buy_zone_high !== undefined) fm.buy_zone_high = update.buy_zone_high;
  }

  if (update.clear_trim_zone) {
    fm.trim_zone = null;
  } else if (update.trim_zone !== undefined) {
    fm.trim_zone = update.trim_zone;
  }

  if (update.gated !== undefined) fm.gated = update.gated;
  if (update.max_weight_pct !== undefined) {
    if ("max_ibkr_weight_pct" in fm && !("max_weight_pct" in fm)) {
      fm.max_ibkr_weight_pct = update.max_weight_pct;
    } else {
      fm.max_weight_pct = update.max_weight_pct;
    }
  }
  if (update.next_catalyst_date !== undefined) fm.next_catalyst_date = update.next_catalyst_date;
  if (update.next_catalyst !== undefined) fm.next_catalyst = update.next_catalyst;

  if (update.decision_log_note && update.decision_log_note.trim()) {
    const entry = `- **${todayYmd}:** ${update.decision_log_note.trim()}`;
    if (body.includes("## 4. Decision Log")) {
      body = `${body.trimEnd()}\n${entry}\n`;
    } else {
      body = `${body.trimEnd()}\n\n## 4. Decision Log\n${entry}\n`;
    }
  }

  const newFm = yaml.dump(fm, { sortKeys: false, lineWidth: 120 }).trim();
  return `---\n${newFm}\n---\n${body.trimStart()}`;
}

export function saveOrMergeThesis(
  dataDir: string,
  profile: UserProfile,
  update: ThesisUpdateInput,
): string {
  const { dateYmd } = formatTimestamp(new Date(), profile.timezone);
  const existing = readThesisFile(dataDir, update.ticker);
  const nextMarkdown = upsertThesisMarkdown(existing, update, dateYmd);
  return writeThesisFile(dataDir, update.ticker, nextMarkdown);
}

export function mergePortfolioPositions(
  existing: PortfolioRecord | null,
  profile: UserProfile,
  input: {
    mode?: "replace" | "upsert";
    positions?: Array<ReturnType<typeof PositionInputSchema.parse>>;
    cash_base?: number;
    accruals_base?: number;
    fx_rates?: Record<string, number>;
    source?: string;
  },
): PortfolioRecord {
  const { iso } = formatTimestamp(new Date(), profile.timezone);
  const baseCcy = profile.base_currency;
  const current: PortfolioRecord = existing
    ? { ...existing, positions: [...existing.positions], fx_rates: { ...existing.fx_rates } }
    : {
        as_of: iso,
        source: input.source ?? "agent_sync",
        cash_base: 0,
        accruals_base: 0,
        fx_rates: { [baseCcy]: 1.0, USD: baseCcy === "USD" ? 1.0 : 1.0 },
        positions: [],
      };

  const existingMap = new Map<string, PositionRecord>(current.positions.map((p) => [p.ticker, p]));

  if (input.positions) {
    const mode = input.mode ?? "replace";
    const workingMap = mode === "upsert" ? new Map(existingMap) : new Map<string, PositionRecord>();

    for (const rawRow of input.positions) {
      const row = PositionInputSchema.parse(rawRow);
      const cleanTicker = row.ticker.includes(".") && !row.ticker.endsWith(".DE") && !row.ticker.endsWith(".SI")
        ? row.ticker.split(".")[0]
        : row.ticker;
      const old = existingMap.get(cleanTicker);
      if (row.qty === 0) {
        workingMap.delete(cleanTicker);
        continue;
      }
      const inferred = inferSecurityMeta(row.ticker, row.isin ?? "");
      const avgCost = row.avg_cost ?? row.avg_cost_usd ?? old?.avg_cost ?? 0;
      const refPrice = row.ref_price ?? row.ref_price_usd ?? old?.ref_price ?? 0;

      workingMap.set(cleanTicker, {
        ticker: cleanTicker,
        yf_symbol: row.yf_symbol ?? old?.yf_symbol ?? inferred.yf_symbol,
        name: row.name ?? old?.name ?? cleanTicker,
        asset_type: row.asset_type ?? old?.asset_type ?? inferred.asset_type,
        domicile: row.domicile ?? old?.domicile ?? inferred.domicile,
        us_situs: row.us_situs ?? old?.us_situs ?? inferred.us_situs,
        currency: CurrencySchema.parse(row.currency ?? old?.currency ?? inferred.currency),
        qty: Number.isInteger(row.qty) ? row.qty : row.qty,
        avg_cost: round(avgCost, 4),
        ref_price: round(refPrice, 4),
      });
    }

    current.positions = Array.from(workingMap.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }

  if (input.cash_base !== undefined) current.cash_base = round(input.cash_base, 2);
  if (input.accruals_base !== undefined) current.accruals_base = round(input.accruals_base, 2);
  if (input.fx_rates) {
    for (const [k, v] of Object.entries(input.fx_rates)) {
      current.fx_rates[CurrencySchema.parse(k)] = round(v, 6);
    }
  }
  current.fx_rates[baseCcy] = 1.0;

  // Clear stale reported_nav_base once positions/cash/fx change dynamically
  delete current.reported_nav_base;
  current.as_of = iso;
  current.source = input.source ?? current.source;
  return PortfolioSchema.parse(current);
}

function buildDemoState(): {
  profile: UserProfile;
  portfolio: PortfolioRecord;
  thesesRaw: Array<{ ticker: string; content: string }>;
  catalysts: CatalystRecord[];
} {
  const profile = ProfileSchema.parse({
    base_currency: "USD",
    timezone: "UTC",
    custody_label: "Sample Multi-Currency Brokerage",
    tax_profile: {
      country_code: "INTL",
      nra_us_estate_tax_enabled: true,
      us_dividend_wht_pct: 30,
      ucits_dividend_wht_pct: 15,
      cgt_pct: 0,
    },
    external_exposure: {
      enabled: true,
      label: "Outside Employer Stock",
      ticker: "MSFT",
      amount_base: 40000,
      vested_pct: 60,
      us_situs: true,
      sector_tags: ["us-tech-megacap"],
      paired_label: "MSFT + AAPL Cluster",
      paired_tickers: ["AAPL"],
    },
    liquidity_reserve: {
      enabled: true,
      label: "Near-Term Cash Reserve",
      amount_base: 10000,
      horizon_months: 12,
    },
    risk_caps: [
      { id: "single-name-max", label: "Largest Single-Name Look-Through", kind: "single_name_max", cap_pct: 20 },
      {
        id: "us-tech-megacap",
        label: "Mega-Cap AI / Tech Look-Through",
        kind: "bucket",
        cap_pct: 45,
        tickers: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOG/GOOGL", "AVGO", "TSM"],
        include_etf_residual_key: "other_semis_residual",
      },
      { id: "us-situs-cap", label: "US-Situs Share of Portfolio", kind: "us_situs", cap_pct: 60 },
    ],
  });

  const portfolio = PortfolioSchema.parse({
    as_of: "2026-11-23T12:00:00+00:00",
    source: "sample_demo",
    cash_base: 14500,
    accruals_base: 0,
    fx_rates: { USD: 1.0, EUR: 1.09 },
    positions: [
      { ticker: "VWRA", yf_symbol: "VWRA.L", name: "Vanguard FTSE All-World UCITS ETF", asset_type: "UCITS ETF", domicile: "Ireland", us_situs: false, currency: "USD", qty: 300, avg_cost: 165, ref_price: 176.5 },
      { ticker: "VTI", yf_symbol: "VTI", name: "Vanguard Total Stock Market ETF", asset_type: "US ETF", domicile: "US", us_situs: true, currency: "USD", qty: 75, avg_cost: 300, ref_price: 348.0 },
      { ticker: "AAPL", yf_symbol: "AAPL", name: "Apple Inc.", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 40, avg_cost: 210, ref_price: 230.0 },
      { ticker: "MSFT", yf_symbol: "MSFT", name: "Microsoft Corporation", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 20, avg_cost: 410, ref_price: 495.0 },
    ],
  });

  const thesesRaw = [
    {
      ticker: "VWRA",
      content: `---\nticker: VWRA\nyf_symbol: VWRA.L\ncurrency: USD\nus_situs: false\nrole: Core Global Equity (50-70%)\nlast_ref_price: 176.50\nbuy_zone_low: 160.00\nbuy_zone_high: 180.00\ntrim_zone: null\nmax_weight_pct: 70.0\nnext_catalyst_date: "2026-12-31"\nnext_catalyst: "Global cap-weighted compounding"\ngated: false\n---\n\n# Sample Global Core ETF (VWRA)\n\n## 1. Core Thesis\n- Broad global equity diversification (Ireland UCITS domicile, exempt from US estate tax for non-US residents).\n\n## 3. Hard Kill-Switches\n1. Structural change to cross-border ETF tax treaties.\n\n## 4. Decision Log\n- **2026-11-23:** Sample core allocation baseline.\n`,
    },
    {
      ticker: "MSFT",
      content: `---\nticker: MSFT\nyf_symbol: MSFT\ncurrency: USD\nus_situs: true\nrole: Enterprise Compounder\nlast_ref_price: 495.00\nbuy_zone_low: 420.00\nbuy_zone_high: 455.00\ntrim_zone: 530.00\nmax_weight_pct: 12.0\nnext_catalyst_date: "2027-01-28"\nnext_catalyst: "Quarterly cloud & capex discipline check"\ngated: false\n---\n\n# Sample Single-Stock Thesis (MSFT)\n\n## 1. Core Thesis\n- Enterprise workflow software and cloud infrastructure cash generation.\n\n## 3. Hard Kill-Switches\n1. Sustained cloud growth deceleration alongside widening FCF dilution from capex.\n\n## 4. Decision Log\n- **2026-11-23:** Sample single-name trigger template.\n`,
    },
  ];

  const catalysts: CatalystRecord[] = [
    {
      date: "2027-01-28",
      ticker: "MSFT",
      title: "Sample Earnings & Cloud Capex Review",
      detail: "Example catalyst row — replace with your own portfolio watchlist dates.",
      urgency: "medium",
    },
  ];

  return { profile, portfolio, thesesRaw, catalysts };
}

export interface DashboardPositionRow {
  ticker: string;
  yf_symbol: string;
  name: string;
  asset_type: string;
  domicile: string;
  us_situs: boolean;
  currency: string;
  qty: number;
  avg_cost: number;
  price: number;
  stale: boolean;
  mv_trading: number;
  mv_usd: number;
  mv_base: number;
  pnl_trading: number;
  pnl_pct: number;
  weight_nav_pct: number;
}

export interface DashboardLookthroughRow {
  name: string;
  direct_usd: number;
  via_etfs_usd: number;
  total_usd: number;
  total_base: number;
  pct_nav: number;
}

export interface DashboardRiskCapRow {
  id: string;
  label: string;
  value_pct: number;
  cap_pct: number;
  status: "PASS" | "BREACH";
}

export interface DashboardThesisRow {
  ticker: string;
  yf_symbol: string;
  currency: string;
  role: string;
  us_situs: boolean;
  price: number | null;
  price_base: number | null;
  stale: boolean;
  last_ref_price: number | null;
  buy_zone_low: number | null;
  buy_zone_high: number | null;
  trim_zone: number | null;
  max_weight_pct: number | null;
  gated: boolean;
  status: string;
  next_catalyst_date: string | null;
  next_catalyst: string | null;
  core_summary: string[];
  kill_switches: string[];
  latest_decision: string;
}

export interface DashboardPayload {
  initialized: boolean;
  is_demo: boolean;
  generated_at: string;
  timezone: string;
  base_currency: string;
  mode: string;
  active_tab: string;
  usd_to_base_fx: number;
  fx_rates: Record<string, number>;
  vix: number | null;
  stale_tickers: string[];
  profile: UserProfile;
  portfolio: {
    as_of: string;
    source: string;
    nav_base: number;
    nav_usd: number;
    positions_base: number;
    positions_usd: number;
    cash_base: number;
    cash_pct: number;
    accruals_base: number;
    total_unrealized_pnl_usd: number;
    total_unrealized_pnl_pct: number;
    positions: DashboardPositionRow[];
  };
  summary: {
    total_liquid_wealth_base: number;
    net_investable_base: number;
    deployable_cash_base: number;
    reserve_shortfall_base: number;
    ext_total_base: number;
    ext_pct_wealth: number;
    ext_portfolio_base: number;
    paired_exposure_base: number;
    paired_exposure_pct_wealth: number;
    paired_label: string;
    primary_bucket_id: string | null;
    primary_bucket_label: string | null;
    primary_bucket_portfolio_base: number;
    primary_bucket_portfolio_pct: number;
    primary_bucket_tw_pct: number;
    ext_included_in_primary_bucket: boolean;
    us_situs_enabled: boolean;
    us_situs_portfolio_usd: number;
    us_situs_portfolio_pct: number;
    us_situs_stocks_usd: number;
    portfolio_estate_tax_base: number;
    total_us_situs_usd: number;
    total_estate_tax_base: number;
    estate_tax_marginal_pct: number;
    ucits_swap_savings_base: number;
  };
  lookthrough: DashboardLookthroughRow[];
  risk_caps: DashboardRiskCapRow[];
  theses: DashboardThesisRow[];
  catalysts: CatalystRecord[];
  edgar: EdgarCacheState;
}

export async function buildDashboardPayload(opts: {
  dataDir: string;
  pluginRoot: string;
  live?: boolean;
  activeTab?: string;
  demo?: boolean;
}): Promise<DashboardPayload> {
  const isDemo = Boolean(opts.demo);
  const demoState = isDemo ? buildDemoState() : null;

  const profile = demoState ? demoState.profile : loadProfile(opts.dataDir);
  const portfolio = demoState ? demoState.portfolio : loadPortfolio(opts.dataDir);
  const etfCfg: EtfWeightsConfig = loadEtfWeights(opts.dataDir, opts.pluginRoot);
  const catalysts = demoState ? demoState.catalysts : loadCatalysts(opts.dataDir);
  const edgarRaw = demoState
    ? { checked_at: null, gate_evaluations: [], filings_by_ticker: {} }
    : loadEdgarCache(opts.dataDir);
  const thesisFiles = demoState
    ? demoState.thesesRaw.map((t) => ({ ...t, filePath: "" }))
    : listThesisFiles(opts.dataDir);

  const { iso: nowIso } = formatTimestamp(new Date(), profile.timezone);
  const activeTab = opts.activeTab ?? "overview";

  if (!portfolio) {
    return {
      initialized: false,
      is_demo: false,
      generated_at: nowIso,
      timezone: profile.timezone,
      base_currency: profile.base_currency,
      mode: "uninitialized",
      active_tab: activeTab,
      usd_to_base_fx: profile.base_currency === "USD" ? 1.0 : 1.0,
      fx_rates: { [profile.base_currency]: 1.0 },
      vix: null,
      stale_tickers: [],
      profile,
      portfolio: {
        as_of: nowIso,
        source: "none",
        nav_base: 0,
        nav_usd: 0,
        positions_base: 0,
        positions_usd: 0,
        cash_base: 0,
        cash_pct: 0,
        accruals_base: 0,
        total_unrealized_pnl_usd: 0,
        total_unrealized_pnl_pct: 0,
        positions: [],
      },
      summary: {
        total_liquid_wealth_base: profile.external_exposure.enabled ? profile.external_exposure.amount_base : 0,
        net_investable_base: 0,
        deployable_cash_base: 0,
        reserve_shortfall_base: 0,
        ext_total_base: 0,
        ext_pct_wealth: 0,
        ext_portfolio_base: 0,
        paired_exposure_base: 0,
        paired_exposure_pct_wealth: 0,
        paired_label: profile.external_exposure.paired_label ?? "Combined Cluster",
        primary_bucket_id: null,
        primary_bucket_label: null,
        primary_bucket_portfolio_base: 0,
        primary_bucket_portfolio_pct: 0,
        primary_bucket_tw_pct: 0,
        ext_included_in_primary_bucket: false,
        us_situs_enabled: profile.tax_profile.nra_us_estate_tax_enabled,
        us_situs_portfolio_usd: 0,
        us_situs_portfolio_pct: 0,
        us_situs_stocks_usd: 0,
        portfolio_estate_tax_base: 0,
        total_us_situs_usd: 0,
        total_estate_tax_base: 0,
        estate_tax_marginal_pct: 0,
        ucits_swap_savings_base: 0,
      },
      lookthrough: [],
      risk_caps: [],
      theses: [],
      catalysts,
      edgar: edgarRaw,
    };
  }

  const parsedTheses = thesisFiles
    .map((f) => parseThesisMarkdown(f.content))
    .filter((x): x is { fm: ThesisFrontmatter; body: string } => x !== null);

  let fxRates: Record<string, number> = { ...portfolio.fx_rates, [profile.base_currency]: 1.0 };
  if (profile.base_currency === "USD") {
    fxRates.USD = 1.0;
  }

  let liveQuotes = new Map<string, QuoteResult>();
  let vixVal: number | null = null;
  const staleTickers = new Set<string>();

  if (opts.live && !isDemo) {
    const quoteSymbols: string[] = ["^VIX"];
    for (const p of portfolio.positions) {
      quoteSymbols.push(p.yf_symbol || p.ticker);
    }
    for (const t of parsedTheses) {
      quoteSymbols.push(t.fm.yf_symbol || t.fm.ticker);
    }

    const allCurrencies = new Set<string>(["USD", profile.base_currency]);
    for (const p of portfolio.positions) allCurrencies.add(p.currency);
    for (const t of parsedTheses) {
      if (t.fm.currency) allCurrencies.add(t.fm.currency.toUpperCase());
    }

    const [qMap, updatedFx] = await Promise.all([
      fetchQuotesBatch(quoteSymbols),
      fetchFxRatesToBase(Array.from(allCurrencies), profile.base_currency, fxRates),
    ]);
    liveQuotes = qMap;
    fxRates = updatedFx;

    const vixQ = liveQuotes.get("^VIX");
    if (vixQ) {
      vixVal = round(vixQ.price, 2);
    }
  }

  const fxUsdToBase = fxRates.USD ?? 1.0;

  let totPosBase = 0;
  let totPosUsd = 0;
  let totCostUsd = 0;

  const positionsOut: DashboardPositionRow[] = portfolio.positions.map((p) => {
    const yfSym = p.yf_symbol || p.ticker;
    let priceTrading = p.ref_price;
    let tradingCcy = p.currency;
    let isStale = false;

    if (opts.live && !isDemo) {
      const q = liveQuotes.get(yfSym);
      if (q) {
        priceTrading = q.price;
        tradingCcy = q.currency || p.currency;
      } else {
        isStale = true;
        staleTickers.add(p.ticker);
      }
    }

    const ccyFxToBase = fxRates[tradingCcy] ?? fxUsdToBase;
    const mvTrading = p.qty * priceTrading;
    const mvBase = mvTrading * ccyFxToBase;
    const mvUsd = tradingCcy === "USD" ? mvTrading : mvBase / fxUsdToBase;
    const costTrading = p.qty * p.avg_cost;
    const costUsd = tradingCcy === "USD" ? costTrading : (costTrading * ccyFxToBase) / fxUsdToBase;
    const pnlTrading = mvTrading - costTrading;
    const pnlPct = costTrading > 0 ? (pnlTrading / costTrading) * 100 : 0;

    totPosBase += mvBase;
    totPosUsd += mvUsd;
    totCostUsd += costUsd;

    return {
      ticker: p.ticker,
      yf_symbol: yfSym,
      name: p.name,
      asset_type: p.asset_type,
      domicile: p.domicile,
      us_situs: p.us_situs,
      currency: tradingCcy,
      qty: p.qty,
      avg_cost: round(p.avg_cost, 4),
      price: round(priceTrading, 4),
      stale: isStale,
      mv_trading: round(mvTrading, 2),
      mv_usd: round(mvUsd, 2),
      mv_base: round(mvBase, 2),
      pnl_trading: round(pnlTrading, 2),
      pnl_pct: round(pnlPct, 2),
      weight_nav_pct: 0,
    };
  });

  const cashBase = portfolio.cash_base;
  const accrualsBase = portfolio.accruals_base;
  const navBase =
    !opts.live && portfolio.reported_nav_base !== undefined
      ? portfolio.reported_nav_base
      : round(totPosBase + cashBase + accrualsBase, 2);
  const navUsd = fxUsdToBase > 0 ? navBase / fxUsdToBase : 0;

  for (const pos of positionsOut) {
    pos.weight_nav_pct = navBase > 0 ? round((pos.mv_base / navBase) * 100, 2) : 0;
  }

  // Look-through calculation across ALL held ETFs & direct single stocks
  const posUsdMap = new Map<string, number>();
  for (const pos of positionsOut) {
    posUsdMap.set(pos.ticker, (posUsdMap.get(pos.ticker) ?? 0) + pos.mv_usd);
  }

  const etfWeights = etfCfg.etf_weights ?? {};
  const etfMeta = etfCfg.etf_metadata ?? {};
  const etfTickersSet = new Set(Object.keys(etfWeights).map((k) => k.toUpperCase()));

  const canonicalMembers = new Map<string, Set<string>>();
  const registerTicker = (sym: string) => {
    const canon = canonicalAssetName(sym);
    if (!canonicalMembers.has(canon)) {
      canonicalMembers.set(canon, new Set(memberTickersForCanonical(canon)));
    }
  };

  for (const pos of positionsOut) {
    if (!etfTickersSet.has(pos.ticker)) {
      registerTicker(pos.ticker);
    }
  }
  for (const [etfSym, weights] of Object.entries(etfWeights)) {
    if ((posUsdMap.get(etfSym) ?? 0) <= 0) continue;
    for (const [constituent, w] of Object.entries(weights)) {
      if (typeof w === "number" && w > 0) {
        registerTicker(constituent);
      }
    }
  }

  const ltRows: DashboardLookthroughRow[] = [];
  const ltMap = new Map<string, DashboardLookthroughRow>();

  for (const [canon, members] of canonicalMembers.entries()) {
    let directUsd = 0;
    for (const m of members) {
      directUsd += posUsdMap.get(m) ?? 0;
    }

    let viaEtfsUsd = 0;
    for (const [etfSym, weights] of Object.entries(etfWeights)) {
      const etfMvUsd = posUsdMap.get(etfSym) ?? 0;
      if (etfMvUsd <= 0) continue;
      let etfShare = 0;
      for (const m of members) {
        const w = weights[m];
        if (typeof w === "number") etfShare += w;
      }
      viaEtfsUsd += etfMvUsd * etfShare;
    }

    const totalUsd = directUsd + viaEtfsUsd;
    if (totalUsd <= 0.01) continue;
    const totalBase = totalUsd * fxUsdToBase;
    const row: DashboardLookthroughRow = {
      name: canon,
      direct_usd: round(directUsd, 2),
      via_etfs_usd: round(viaEtfsUsd, 2),
      total_usd: round(totalUsd, 2),
      total_base: round(totalBase, 2),
      pct_nav: navBase > 0 ? round((totalBase / navBase) * 100, 2) : 0,
    };
    ltRows.push(row);
    ltMap.set(canon, row);
  }
  ltRows.sort((a, b) => b.total_usd - a.total_usd);

  const usSitusPortfolioUsd = positionsOut
    .filter((p) => p.us_situs)
    .reduce((acc, p) => acc + p.mv_usd, 0);
  const usSitusEtfsUsd = positionsOut
    .filter((p) => p.us_situs && p.asset_type.toUpperCase().includes("ETF"))
    .reduce((acc, p) => acc + p.mv_usd, 0);
  const usSitusStocksUsd = usSitusPortfolioUsd - usSitusEtfsUsd;
  const usSitusPortfolioPct = navBase > 0 ? round(((usSitusPortfolioUsd * fxUsdToBase) / navBase) * 100, 2) : 0;

  const evaluateBucketUsd = (rule: RiskCapRule): number => {
    const seenCanon = new Set<string>();
    let usdSum = 0;
    for (const rawTicker of rule.tickers ?? []) {
      const canon = canonicalAssetName(rawTicker);
      if (seenCanon.has(canon)) continue;
      seenCanon.add(canon);
      usdSum += ltMap.get(canon)?.total_usd ?? 0;
    }
    if (rule.include_etf_residual_key) {
      const resKey = rule.include_etf_residual_key;
      for (const etfSym of Object.keys(etfWeights)) {
        const etfMvUsd = posUsdMap.get(etfSym) ?? 0;
        if (etfMvUsd <= 0) continue;
        const metaRec = etfMeta[etfSym] as Record<string, unknown> | undefined;
        const residual = metaRec?.[resKey];
        if (typeof residual === "number") {
          usdSum += etfMvUsd * residual;
        }
      }
    }
    return usdSum;
  };

  const riskCaps: DashboardRiskCapRow[] = profile.risk_caps.map((rule) => {
    let valPct = 0;
    if (rule.kind === "single_name_max") {
      valPct = ltRows.length > 0 ? Math.max(...ltRows.map((r) => r.pct_nav)) : 0;
    } else if (rule.kind === "ticker" && rule.ticker) {
      const canon = canonicalAssetName(rule.ticker);
      valPct = ltMap.get(canon)?.pct_nav ?? 0;
    } else if (rule.kind === "us_situs") {
      valPct = usSitusPortfolioPct;
    } else if (rule.kind === "bucket") {
      const bucketUsd = evaluateBucketUsd(rule);
      valPct = navBase > 0 ? round(((bucketUsd * fxUsdToBase) / navBase) * 100, 2) : 0;
    }
    return {
      id: rule.id,
      label: rule.label,
      value_pct: round(valPct, 2),
      cap_pct: rule.cap_pct,
      status: valPct <= rule.cap_pct ? "PASS" : "BREACH",
    };
  });

  // External exposure & liquidity reserve summary
  const ext = profile.external_exposure;
  const reserve = profile.liquidity_reserve;
  const extAmountBase = ext.enabled ? ext.amount_base : 0;
  const reserveAmountBase = reserve.enabled ? reserve.amount_base : 0;

  const totalLiquidWealthBase = navBase + extAmountBase;
  const netInvestableBase = Math.max(0, totalLiquidWealthBase - reserveAmountBase);

  const extCanon = ext.ticker ? canonicalAssetName(ext.ticker) : null;
  const extPortfolioBase = extCanon ? (ltMap.get(extCanon)?.total_base ?? 0) : 0;
  const extTotalBase = extAmountBase + extPortfolioBase;
  const extPctWealth = totalLiquidWealthBase > 0 ? round((extTotalBase / totalLiquidWealthBase) * 100, 2) : 0;

  let pairedExtraBase = 0;
  const seenPaired = new Set<string>(extCanon ? [extCanon] : []);
  for (const pt of ext.paired_tickers ?? []) {
    const canon = canonicalAssetName(pt);
    if (seenPaired.has(canon)) continue;
    seenPaired.add(canon);
    pairedExtraBase += ltMap.get(canon)?.total_base ?? 0;
  }
  const pairedTotalBase = extTotalBase + pairedExtraBase;
  const pairedPctWealth = totalLiquidWealthBase > 0 ? round((pairedTotalBase / totalLiquidWealthBase) * 100, 2) : 0;
  const pairedLabel =
    ext.paired_label ??
    (ext.ticker && (ext.paired_tickers?.length ?? 0) > 0
      ? `${ext.ticker}+${ext.paired_tickers!.join("+")}`
      : `${ext.ticker ?? "External"} Cluster`);

  const primaryBucketRule = profile.risk_caps.find((r) => r.kind === "bucket") ?? null;
  const primaryBucketCapRow = primaryBucketRule ? riskCaps.find((r) => r.id === primaryBucketRule.id) : null;
  const primaryBucketPortfolioUsd = primaryBucketRule ? evaluateBucketUsd(primaryBucketRule) : 0;
  const primaryBucketPortfolioBase = primaryBucketPortfolioUsd * fxUsdToBase;
  const extIncludedInBucket = Boolean(
    ext.enabled &&
      primaryBucketRule &&
      (ext.sector_tags.includes(primaryBucketRule.id) ||
        (extCanon && (primaryBucketRule.tickers ?? []).some((t) => canonicalAssetName(t) === extCanon))),
  );
  const primaryBucketTwBase = primaryBucketPortfolioBase + (extIncludedInBucket ? extAmountBase : 0);
  const primaryBucketTwPct =
    totalLiquidWealthBase > 0 ? round((primaryBucketTwBase / totalLiquidWealthBase) * 100, 2) : 0;

  // Optional NRA US estate tax calculation
  const estateEnabled = profile.tax_profile.nra_us_estate_tax_enabled;
  const extUsSitusUsd = ext.enabled && ext.us_situs && fxUsdToBase > 0 ? extAmountBase / fxUsdToBase : 0;
  const totalUsSitusUsd = usSitusPortfolioUsd + extUsSitusUsd;
  const portfolioEstate = estateEnabled ? computeUsEstateTaxNra(usSitusPortfolioUsd) : computeUsEstateTaxNra(0);
  const totalEstate = estateEnabled ? computeUsEstateTaxNra(totalUsSitusUsd) : computeUsEstateTaxNra(0);
  const afterUcitsEstate = estateEnabled
    ? computeUsEstateTaxNra(usSitusStocksUsd + extUsSitusUsd)
    : computeUsEstateTaxNra(0);

  // Thesis cards with live price mapping
  const thesesOut: DashboardThesisRow[] = parsedTheses.map(({ fm, body }) => {
    const sym = String(fm.ticker).toUpperCase();
    const yfSym = String(fm.yf_symbol || sym);
    const thesisCcy = String(fm.currency || "USD").toUpperCase();
    const refP = typeof fm.last_ref_price === "number" ? fm.last_ref_price : null;
    let price = refP;
    let ccy = thesisCcy;
    let isStale = false;

    if (opts.live && !isDemo) {
      const q = liveQuotes.get(yfSym);
      if (q) {
        price = q.price;
        ccy = q.currency || thesisCcy;
      } else if (refP !== null) {
        isStale = true;
        staleTickers.add(sym);
      }
    }

    const ccyFxToBase = fxRates[ccy] ?? fxUsdToBase;
    const priceBase = price !== null ? round(price * ccyFxToBase, 2) : null;
    const maxWeight =
      fm.max_weight_pct !== undefined && fm.max_weight_pct !== null
        ? fm.max_weight_pct
        : (fm.max_ibkr_weight_pct ?? null);

    return {
      ticker: sym,
      yf_symbol: yfSym,
      currency: ccy,
      role: String(fm.role ?? ""),
      us_situs: Boolean(fm.us_situs ?? true),
      price: price !== null ? round(price, 4) : null,
      price_base: priceBase,
      stale: isStale,
      last_ref_price: refP,
      buy_zone_low: fm.buy_zone_low ?? null,
      buy_zone_high: fm.buy_zone_high ?? null,
      trim_zone: fm.trim_zone ?? null,
      max_weight_pct: maxWeight,
      gated: Boolean(fm.gated),
      status: classifyTriggerStatus(price, fm),
      next_catalyst_date: fm.next_catalyst_date ?? null,
      next_catalyst: fm.next_catalyst ?? null,
      core_summary: extractSectionBullets(body, "## 1.", 3),
      kill_switches: extractSectionBullets(body, "## 3.", 4),
      latest_decision: extractSectionBullets(body, "## 4.", 1)[0] ?? "",
    };
  });

  // Always re-evaluate SEC gates dynamically against current catalysts + cached filings
  const edgarState: EdgarCacheState = {
    checked_at: edgarRaw.checked_at,
    gate_evaluations: evaluateSecGates(catalysts, edgarRaw.filings_by_ticker ?? {}),
    filings_by_ticker: edgarRaw.filings_by_ticker ?? {},
  };

  const totalPnlUsd = totPosUsd - totCostUsd;
  const totalPnlPct = totCostUsd > 0 ? (totalPnlUsd / totCostUsd) * 100 : 0;

  return {
    initialized: true,
    is_demo: isDemo,
    generated_at: nowIso,
    timezone: profile.timezone,
    base_currency: profile.base_currency,
    mode: isDemo ? "demo_preview" : opts.live ? "live_yahoo" : `snapshot:${portfolio.as_of}`,
    active_tab: activeTab,
    usd_to_base_fx: round(fxUsdToBase, 5),
    fx_rates: fxRates,
    vix: vixVal,
    stale_tickers: Array.from(staleTickers).sort(),
    profile,
    portfolio: {
      as_of: portfolio.as_of,
      source: portfolio.source,
      nav_base: round(navBase, 2),
      nav_usd: round(navUsd, 2),
      positions_base: round(totPosBase, 2),
      positions_usd: round(totPosUsd, 2),
      cash_base: round(cashBase, 2),
      cash_pct: navBase > 0 ? round((cashBase / navBase) * 100, 2) : 0,
      accruals_base: round(accrualsBase, 2),
      total_unrealized_pnl_usd: round(totalPnlUsd, 2),
      total_unrealized_pnl_pct: round(totalPnlPct, 2),
      positions: positionsOut,
    },
    summary: {
      total_liquid_wealth_base: round(totalLiquidWealthBase, 2),
      net_investable_base: round(netInvestableBase, 2),
      deployable_cash_base: round(Math.max(0, cashBase - reserveAmountBase), 2),
      reserve_shortfall_base: round(Math.max(0, reserveAmountBase - cashBase), 2),
      ext_total_base: round(extTotalBase, 2),
      ext_pct_wealth: extPctWealth,
      ext_portfolio_base: round(extPortfolioBase, 2),
      paired_exposure_base: round(pairedTotalBase, 2),
      paired_exposure_pct_wealth: pairedPctWealth,
      paired_label: pairedLabel,
      primary_bucket_id: primaryBucketRule?.id ?? null,
      primary_bucket_label: primaryBucketRule?.label ?? null,
      primary_bucket_portfolio_base: round(primaryBucketPortfolioBase, 2),
      primary_bucket_portfolio_pct: primaryBucketCapRow?.value_pct ?? 0,
      primary_bucket_tw_pct: primaryBucketTwPct,
      ext_included_in_primary_bucket: extIncludedInBucket,
      us_situs_enabled: estateEnabled,
      us_situs_portfolio_usd: round(usSitusPortfolioUsd, 2),
      us_situs_portfolio_pct: usSitusPortfolioPct,
      us_situs_stocks_usd: round(usSitusStocksUsd, 2),
      portfolio_estate_tax_base: round(portfolioEstate.net_estate_tax_usd * fxUsdToBase, 2),
      total_us_situs_usd: round(totalUsSitusUsd, 2),
      total_estate_tax_base: round(totalEstate.net_estate_tax_usd * fxUsdToBase, 2),
      estate_tax_marginal_pct: totalEstate.marginal_rate_pct,
      ucits_swap_savings_base: round((totalEstate.net_estate_tax_usd - afterUcitsEstate.net_estate_tax_usd) * fxUsdToBase, 2),
    },
    lookthrough: ltRows,
    risk_caps: riskCaps,
    theses: thesesOut,
    catalysts,
    edgar: edgarState,
  };
}

export function buildSummaryText(payload: DashboardPayload): string {
  if (!payload.initialized) {
    return `Investment OS (${payload.generated_at}, Base: ${payload.base_currency}): No portfolio saved yet. Prompt the user to onboard via update_profile and update_portfolio_positions, or let them click Preview Sample Portfolio in the sidecar.`;
  }
  const s = payload.summary;
  const p = payload.portfolio;
  const ccy = payload.base_currency;
  const breaches = payload.risk_caps.filter((c) => c.status === "BREACH").map((c) => c.label);
  const lines = [
    `Investment OS Dashboard (${payload.mode} | Retrieved ${payload.generated_at}):`,
    `- Portfolio NAV: ${p.nav_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (USD ${p.nav_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy !== "USD" ? ` @ ${payload.usd_to_base_fx.toFixed(4)}` : ""}) | Cash: ${p.cash_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (${p.cash_pct.toFixed(2)}%)`,
  ];
  if (payload.profile.external_exposure.enabled) {
    lines.push(
      `- Total Liquid Wealth: ${s.total_liquid_wealth_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (${payload.profile.external_exposure.label}: ${payload.profile.external_exposure.amount_base.toLocaleString("en-US")} ${ccy}, Concentration: ${s.ext_pct_wealth.toFixed(2)}%)`,
    );
  }
  if (s.us_situs_enabled) {
    lines.push(
      `- US-Situs Portfolio Share: ${s.us_situs_portfolio_pct.toFixed(2)}% | Est. US NRA Estate Tax: ${s.total_estate_tax_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy} (${s.estate_tax_marginal_pct.toFixed(0)}% marginal; UCITS swap saves ${s.ucits_swap_savings_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy})`,
    );
  }
  lines.push(`- Risk Cap Breaches (${breaches.length}): ${breaches.length > 0 ? breaches.join(", ") : "None"}`);
  if (payload.stale_tickers.length > 0) {
    lines.push(`- Stale / Fallback Quotes: ${payload.stale_tickers.join(", ")}`);
  }
  return lines.join("\n");
}
