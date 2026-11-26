import yaml from "js-yaml";
import { z } from "zod";
import { evaluateSecGates, extractSecRedFlags, type SecRedFlag } from "./edgar.js";
import {
  runPortfolioForecast,
  type ForecastThesisRef,
  type PortfolioForecastResult,
} from "./forecast.js";
import {
  ensureHistorySeries,
  fetchFxRatesToBase,
  fetchMacroRegime,
  fetchQuotesBatch,
  type QuoteResult,
} from "./market.js";
import {
  canonicalAssetName,
  computeAfterTaxHurdle,
  computeCapitalRotationQueue,
  computeDipTriage,
  computeForwardScorecard,
  computeReverseDcf,
  computeScenarioSummary,
  computeUsEstateTaxNra,
  computeValuationBands,
  evaluateHypothesisRule,
  lookupHistorySeries,
  memberTickersForCanonical,
  round,
  runDeterministicBacktest,
  type AfterTaxHurdleInfo,
  type BacktestResult,
  type CapitalRotationQueue,
  type DipTriageResult,
  type ForwardScorecardResult,
  type HypothesisAutoEval,
  type ReverseDcfSummary,
  type ScenarioSummary,
  type UsEstateTaxResult,
  type ValuationBandsSummary,
} from "./quant.js";
import {
  ActionVerdictSchema,
  BacktestRequestSchema,
  CurrencySchema,
  DossierModelSchema,
  DossierTierSchema,
  DossierUpsertSchema,
  ForecastRequestSchema,
  HypothesisSchema,
  IntelHistoryEntrySchema,
  IntelIngestSchema,
  normalizeThemeSlug,
  normalizeTicker,
  PortfolioSchema,
  PositionInputSchema,
  ProfileSchema,
  ProvenanceSourceSchema,
  ThemeObjectSchema,
  ThesisTestRecordSchema,
  type ActionVerdict,
  type BacktestRequest,
  type CatalystRecord,
  type DossierFundamentals,
  type DossierInsiders,
  type DossierIntel,
  type DossierModel,
  type DossierTier,
  type EtfWeightsConfig,
  type ForecastRequest,
  type FundamentalsRatios,
  type HistoryCacheState,
  type HistoryPoint,
  type HypothesisRecord,
  type InsiderWindow,
  type IntelHistoryEntry,
  type MacroRegime,
  type PaPerformanceState,
  type PitSnapshot,
  type PortfolioRecord,
  type PositionRecord,
  type ProvenanceSource,
  type RiskCapRule,
  type ThemeObject,
  type ThemeStance,
  type ThesisTestRecord,
  type ThesisUpdateInput,
  type UserProfile,
  type WatchdogAlert,
} from "./schema.js";
import {
  appendIntelHistory,
  appendThesisTestLog,
  hasDossierMemo,
  listThemes,
  listThesisFiles,
  loadCatalysts,
  loadDossierFundamentals,
  loadDossierInsiders,
  loadDossierIntel,
  loadDossierMemo,
  loadDossierModel,
  loadEdgarCache,
  loadEtfWeights,
  loadHistoryCache,
  loadIntelHistory,
  loadMacroRegime,
  loadMarketCache,
  loadPaPerformance,
  loadPortfolio,
  loadProfile,
  loadTheme,
  loadThemeMemo,
  loadThesisTestLog,
  loadWatchdogAlerts,
  readThesisFile,
  saveDossierIntel,
  saveDossierMemo,
  saveDossierModel,
  saveHistoryCache,
  saveMacroRegime,
  saveMarketCache,
  savePaPerformance,
  saveTheme,
  saveThemeMemo,
  type EdgarCacheState,
  type MarketCacheEntry,
  writeThesisFile,
} from "./storage.js";

export { canonicalAssetName, computeUsEstateTaxNra, memberTickersForCanonical, round, type UsEstateTaxResult };

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
  tier?: DossierTier;
  action_verdict?: ActionVerdict | null;
  takeaway?: string[];
  last_audited_date?: string | null;
  price_at_audit?: number | null;
  sources?: ProvenanceSource[];
  rejection_reason?: string | null;
  reentry_trigger?: string | null;
  reentry_price?: number | null;
  last_ref_price?: number | null;
  buy_zone_low?: number | null;
  buy_zone_high?: number | null;
  trim_zone?: number | null;
  max_weight_pct?: number | null;
  max_ibkr_weight_pct?: number | null;
  next_catalyst_date?: string | null;
  next_catalyst?: string | null;
  gated?: boolean;
  verdict?: string | null;
  bear_case_summary?: string | null;
  last_tested_date?: string | null;
  hypotheses?: HypothesisRecord[];
  theme_refs?: string[];
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

function extractLatestDecision(body: string): string {
  const all = extractSectionBullets(body, "## 4.", 250);
  return all.length > 0 ? all[all.length - 1]! : "";
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
      tier: update.tier ?? "active",
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
  if (update.tier !== undefined) fm.tier = update.tier;
  if (update.action_verdict !== undefined) fm.action_verdict = update.action_verdict;
  if (update.takeaway !== undefined) fm.takeaway = update.takeaway;
  if (update.last_audited_date !== undefined) fm.last_audited_date = update.last_audited_date;
  if (update.price_at_audit !== undefined) fm.price_at_audit = update.price_at_audit;
  if (update.sources !== undefined) fm.sources = update.sources;
  if (update.rejection_reason !== undefined) fm.rejection_reason = update.rejection_reason;
  if (update.reentry_trigger !== undefined) fm.reentry_trigger = update.reentry_trigger;
  if (update.reentry_price !== undefined) fm.reentry_price = update.reentry_price;
  if (update.theme_refs !== undefined) fm.theme_refs = update.theme_refs;

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
  if (update.verdict !== undefined) fm.verdict = update.verdict;
  if (update.bear_case_summary !== undefined) fm.bear_case_summary = update.bear_case_summary;
  if (update.last_tested_date !== undefined) fm.last_tested_date = update.last_tested_date;
  if (update.hypotheses !== undefined) fm.hypotheses = update.hypotheses;

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

export function upsertHypothesesArray(
  existing: HypothesisRecord[],
  incoming: HypothesisRecord[],
): HypothesisRecord[] {
  const byId = new Map<string, HypothesisRecord>();
  for (const h of existing) {
    byId.set(h.id, h);
  }
  for (const h of incoming) {
    byId.set(h.id, h);
  }
  return Array.from(byId.values()).slice(0, 12);
}

function parseHypothesesFromFrontmatter(raw: unknown): HypothesisRecord[] {
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(HypothesisSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function parseSourcesFromFrontmatter(raw: unknown): ProvenanceSource[] {
  if (!Array.isArray(raw)) return [];
  const parsed = z.array(ProvenanceSourceSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function parseThemeRefsFromFrontmatter(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    try {
      out.push(normalizeThemeSlug(item));
    } catch {
      // ignore invalid slug
    }
  }
  return Array.from(new Set(out));
}

export function countHypotheses(hypotheses: HypothesisRecord[]): {
  total: number;
  supported: number;
  weakened: number;
  falsified: number;
  untested: number;
} {
  let supported = 0;
  let weakened = 0;
  let falsified = 0;
  let untested = 0;
  for (const h of hypotheses) {
    if (h.status === "supported") supported += 1;
    else if (h.status === "weakened") weakened += 1;
    else if (h.status === "falsified") falsified += 1;
    else untested += 1;
  }
  return { total: hypotheses.length, supported, weakened, falsified, untested };
}

function resolveCurrentVerdictForLog(fm: ThesisFrontmatter | null | undefined): "HIGH_CONVICTION" | "WATCH" | "PROBATION" | "EXIT" {
  const v = fm?.verdict;
  if (v === "HIGH_CONVICTION" || v === "WATCH" || v === "PROBATION" || v === "EXIT") return v;
  return "WATCH";
}

function appendRuleChangeEntry(
  dataDir: string,
  profile: UserProfile,
  ticker: string,
  changes: string[],
  rationale?: string | null,
  existingFm?: ThesisFrontmatter | null,
): void {
  if (changes.length === 0) return;
  const { iso } = formatTimestamp(new Date(), profile.timezone);
  const cleanRationale = rationale?.trim() ? ` | Rationale: ${rationale.trim()}` : "";
  const summary = `[RULE CHANGE] ${changes.join(", ")}${cleanRationale}`.slice(0, 595);
  appendThesisTestLog(dataDir, {
    ticker: normalizeTicker(ticker),
    tested_at: iso,
    event_type: "rule_change",
    verdict: resolveCurrentVerdictForLog(existingFm),
    kill_switch_triggered: false,
    summary,
    hypotheses_tested: [],
  });
}

export function saveOrMergeThesis(
  dataDir: string,
  profile: UserProfile,
  update: ThesisUpdateInput,
  opts?: { skipRuleChangeLog?: boolean },
): string {
  const { dateYmd } = formatTimestamp(new Date(), profile.timezone);
  const existing = readThesisFile(dataDir, update.ticker);
  const existingFm = existing ? parseThesisMarkdown(existing)?.fm ?? null : null;
  const nextMarkdown = upsertThesisMarkdown(existing, update, dateYmd);
  const writtenPath = writeThesisFile(dataDir, update.ticker, nextMarkdown);

  if (existingFm && !opts?.skipRuleChangeLog) {
    const changes: string[] = [];
    if (update.clear_buy_zone && (existingFm.buy_zone_low != null || existingFm.buy_zone_high != null)) {
      changes.push("cleared buy_zone");
    } else {
      if (update.buy_zone_low !== undefined && update.buy_zone_low !== existingFm.buy_zone_low) {
        changes.push(`buy_zone_low ${existingFm.buy_zone_low ?? "null"} -> ${update.buy_zone_low ?? "null"}`);
      }
      if (update.buy_zone_high !== undefined && update.buy_zone_high !== existingFm.buy_zone_high) {
        changes.push(`buy_zone_high ${existingFm.buy_zone_high ?? "null"} -> ${update.buy_zone_high ?? "null"}`);
      }
    }
    if (update.clear_trim_zone && existingFm.trim_zone != null) {
      changes.push("cleared trim_zone");
    } else if (update.trim_zone !== undefined && update.trim_zone !== existingFm.trim_zone) {
      changes.push(`trim_zone ${existingFm.trim_zone ?? "null"} -> ${update.trim_zone ?? "null"}`);
    }
    if (update.gated !== undefined && update.gated !== Boolean(existingFm.gated)) {
      changes.push(`gated ${Boolean(existingFm.gated)} -> ${update.gated}`);
    }
    const prevMaxW = existingFm.max_weight_pct ?? existingFm.max_ibkr_weight_pct ?? null;
    if (update.max_weight_pct !== undefined && update.max_weight_pct !== prevMaxW) {
      changes.push(`max_weight_pct ${prevMaxW ?? "null"} -> ${update.max_weight_pct ?? "null"}`);
    }
    if (update.reentry_price !== undefined && update.reentry_price !== (existingFm.reentry_price ?? null)) {
      changes.push(`reentry_price ${existingFm.reentry_price ?? "null"} -> ${update.reentry_price ?? "null"}`);
    }
    if (changes.length > 0) {
      appendRuleChangeEntry(dataDir, profile, update.ticker, changes, update.rationale, existingFm);
    }
  }

  return writtenPath;
}

export function saveDossierModelWithAudit(
  dataDir: string,
  profile: UserProfile,
  ticker: string,
  rawModel: unknown,
  rationale?: string | null,
): DossierModel {
  const sym = normalizeTicker(ticker);
  const validated = DossierModelSchema.parse(rawModel);
  const existingModel = loadDossierModel(dataDir, sym);
  const saved = saveDossierModel(dataDir, sym, validated);

  if (existingModel || (rationale && rationale.trim())) {
    const existingRaw = readThesisFile(dataDir, sym);
    const existingFm = existingRaw ? parseThesisMarkdown(existingRaw)?.fm ?? null : null;
    const changeBits: string[] = ["updated valuation model"];
    if (saved.scenarios) {
      changeBits.push(
        `Bear/Base/Bull=${saved.scenarios.bear.target_price_5y}/${saved.scenarios.base.target_price_5y}/${saved.scenarios.bull.target_price_5y}`,
      );
    }
    if (saved.reverse_dcf) {
      changeBits.push(`exit_multiple=${saved.reverse_dcf.exit_multiple}x`);
    }
    appendRuleChangeEntry(dataDir, profile, sym, changeBits, rationale, existingFm);
  }
  return saved;
}

export function upsertDossier(
  dataDir: string,
  profile: UserProfile,
  rawInput: unknown,
): {
  ticker: string;
  thesisPath: string;
  savedModel: boolean;
  savedMemo: boolean;
  savedIntel: boolean;
} {
  const parsed = DossierUpsertSchema.parse(rawInput);
  const { model, memo_md, intel, ...thesisUpdate } = parsed;
  const thesisPath = saveOrMergeThesis(dataDir, profile, thesisUpdate);
  let savedModel = false;
  let savedMemo = false;
  let savedIntel = false;

  if (model !== undefined) {
    saveDossierModelWithAudit(dataDir, profile, parsed.ticker, model, parsed.rationale);
    savedModel = true;
  }
  if (memo_md !== undefined) {
    saveDossierMemo(dataDir, parsed.ticker, memo_md);
    savedMemo = true;
  }
  if (intel !== undefined) {
    saveDossierIntel(dataDir, parsed.ticker, intel);
    savedIntel = true;
  }
  return { ticker: parsed.ticker, thesisPath, savedModel, savedMemo, savedIntel };
}

export function upsertTheme(
  dataDir: string,
  profile: UserProfile,
  rawInput: unknown,
): { theme: ThemeObject; savedMemo: boolean; linkedTickers: string[] } {
  const obj = typeof rawInput === "object" && rawInput !== null ? { ...(rawInput as Record<string, unknown>) } : {};
  const memoMd = typeof obj.memo_md === "string" ? obj.memo_md : undefined;
  delete obj.memo_md;
  if (!obj.updated_at) {
    obj.updated_at = formatTimestamp(new Date(), profile.timezone).iso;
  }
  const validated = ThemeObjectSchema.parse(obj);
  const saved = saveTheme(dataDir, validated);
  let savedMemo = false;
  if (memoMd !== undefined) {
    saveThemeMemo(dataDir, saved.slug, memoMd);
    savedMemo = true;
  }
  const linkedTickers = Array.from(new Set(saved.exposures.map((e) => e.ticker)));
  return { theme: saved, savedMemo, linkedTickers };
}

export function ingestResearchIntel(
  dataDir: string,
  rawInput: unknown,
): {
  ticker: string | null;
  savedIntel: boolean;
  savedIntelHistory: boolean;
  savedSeriesCount: number;
  savedPa: boolean;
} {
  const rawObj = typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : {};
  const parsed = IntelIngestSchema.parse(rawInput);
  let savedIntel = false;
  let savedIntelHistory = false;
  let savedSeriesCount = 0;
  let savedPa = false;

  if (parsed.intel && parsed.ticker) {
    saveDossierIntel(dataDir, parsed.ticker, parsed.intel);
    savedIntel = true;

    const explicitHist = rawObj.intel_history_entry;
    if (explicitHist && typeof explicitHist === "object") {
      const parsedHist = IntelHistoryEntrySchema.parse({
        recorded_at: parsed.intel.updated_at,
        provider: parsed.intel.provider,
        ...(explicitHist as Record<string, unknown>),
      });
      appendIntelHistory(dataDir, parsed.ticker, parsedHist);
      savedIntelHistory = true;
    } else if (parsed.intel.earnings_insight || parsed.intel.options_intel) {
      appendIntelHistory(dataDir, parsed.ticker, {
        recorded_at: parsed.intel.updated_at,
        provider: parsed.intel.provider,
        period: parsed.intel.earnings_insight?.period ?? null,
        headline: parsed.intel.earnings_insight?.headline ?? null,
        implied_move_pct: parsed.intel.options_intel?.implied_move_pct ?? null,
        iv_30d_pct: parsed.intel.options_intel?.call_iv_pct ?? null,
        iv_pct_52w: parsed.intel.options_intel?.iv_percentile_52w ?? null,
      });
      savedIntelHistory = true;
    }
  }
  if (parsed.history_series && parsed.history_series.length > 0) {
    const cache = loadHistoryCache(dataDir);
    for (const ser of parsed.history_series) {
      cache.series[ser.symbol] = ser;
      savedSeriesCount += 1;
    }
    cache.updated_at = new Date().toISOString();
    saveHistoryCache(dataDir, cache);
  }
  if (parsed.pa_performance) {
    savePaPerformance(dataDir, parsed.pa_performance);
    savedPa = true;
  }
  return {
    ticker: parsed.ticker ?? null,
    savedIntel,
    savedIntelHistory,
    savedSeriesCount,
    savedPa,
  };
}

export function upsertSingleHypothesis(
  dataDir: string,
  profile: UserProfile,
  ticker: string,
  rawHypothesis: unknown,
): string {
  const sym = normalizeTicker(ticker);
  const validated = HypothesisSchema.parse(rawHypothesis);
  const existingRaw = readThesisFile(dataDir, sym);
  const existingList = existingRaw
    ? parseHypothesesFromFrontmatter(parseThesisMarkdown(existingRaw)?.fm.hypotheses)
    : [];
  const merged = upsertHypothesesArray(existingList, [validated]);
  return saveOrMergeThesis(
    dataDir,
    profile,
    {
      ticker: sym,
      hypotheses: merged,
    },
    { skipRuleChangeLog: true },
  );
}

function capturePitContextForTest(
  dataDir: string,
  profile: UserProfile,
  ticker: string,
  priceAtTest: number | null,
  existingFm: ThesisFrontmatter | null,
): { benchmarkPrice: number | null; pitSnapshot: PitSnapshot } {
  const sym = normalizeTicker(ticker);
  const benchYf = profile.benchmark.yf_symbol || profile.benchmark.ticker;
  const benchTicker = profile.benchmark.ticker.toUpperCase();

  let marketCache = null;
  try {
    marketCache = loadMarketCache(dataDir);
  } catch {
    marketCache = null;
  }
  let macroRegime: MacroRegime | null = null;
  try {
    macroRegime = loadMacroRegime(dataDir) ?? marketCache?.macro_regime ?? null;
  } catch {
    macroRegime = marketCache?.macro_regime ?? null;
  }
  const portfolio = loadPortfolio(dataDir);
  const historyCache = loadHistoryCache(dataDir);

  let benchmarkPrice: number | null =
    marketCache?.quotes[benchYf]?.price ??
    marketCache?.quotes[benchTicker]?.price ??
    portfolio?.positions.find((p) => p.ticker.toUpperCase() === benchTicker)?.ref_price ??
    null;

  if (benchmarkPrice === null) {
    const dailySeries = historyCache.series[`daily:${benchYf}`] ?? historyCache.series[`daily:${benchTicker}`];
    const weeklySeries = lookupHistorySeries(historyCache, benchYf, benchTicker);
    const chosen = dailySeries?.points.length ? dailySeries : weeklySeries;
    if (chosen && chosen.points.length > 0) {
      benchmarkPrice = chosen.points[chosen.points.length - 1]!.close;
    }
  }

  let portfolioWeightPct: number | null = null;
  if (portfolio) {
    const fxRates = { ...portfolio.fx_rates, ...(marketCache?.fx_rates ?? {}), [profile.base_currency]: 1.0 };
    const fxUsd = fxRates.USD ?? 1.0;
    let totalPosBase = 0;
    let symBase = 0;
    for (const p of portfolio.positions) {
      const mv = p.qty * p.ref_price * (fxRates[p.currency] ?? fxUsd);
      totalPosBase += mv;
      if (p.ticker.toUpperCase() === sym) symBase += mv;
    }
    const navBase = portfolio.reported_nav_base ?? totalPosBase + portfolio.cash_base + portfolio.accruals_base;
    if (navBase > 0) {
      portfolioWeightPct = round((symBase / navBase) * 100, 2);
    }
  }

  let expectedAfterTaxCagr: number | null = null;
  let hurdleCagr: number | null = null;
  let impliedRevCagr: number | null = null;
  let model: DossierModel | null = null;
  try {
    model = loadDossierModel(dataDir, sym);
  } catch {
    model = null;
  }
  if (model && priceAtTest && priceAtTest > 0) {
    const usSitus = Boolean(existingFm?.us_situs ?? true);
    const taxInfo = computeAfterTaxHurdle(profile, usSitus, model.dividend_yield_pct ?? 0, 34, {
      dividendWhtPctOverride: model.dividend_wht_pct,
      accumulating: model.accumulating,
    });
    const scen = computeScenarioSummary(priceAtTest, model, taxInfo);
    const rdcf = computeReverseDcf(priceAtTest, model, taxInfo);
    expectedAfterTaxCagr = scen?.expected_after_tax_cagr_pct ?? null;
    hurdleCagr = taxInfo.hurdle_cagr_pct;
    impliedRevCagr = rdcf?.implied_revenue_cagr_pct ?? null;
  }

  let fundamentalsPeriod: string | null = null;
  try {
    const fund = loadDossierFundamentals(dataDir, sym);
    fundamentalsPeriod = fund?.quarterly[0]?.period_end ?? fund?.annual[0]?.period_end ?? null;
  } catch {
    fundamentalsPeriod = null;
  }

  return {
    benchmarkPrice: benchmarkPrice !== null && benchmarkPrice > 0 ? round(benchmarkPrice, 4) : null,
    pitSnapshot: {
      vix: macroRegime?.vix ?? marketCache?.vix ?? null,
      us10y_pct: macroRegime?.us10y_pct ?? null,
      expected_after_tax_cagr_pct: expectedAfterTaxCagr,
      hurdle_cagr_pct: hurdleCagr,
      implied_revenue_cagr_pct: impliedRevCagr,
      portfolio_weight_pct: portfolioWeightPct,
      fundamentals_period: fundamentalsPeriod,
    },
  };
}

export function recordThesisTest(
  dataDir: string,
  profile: UserProfile,
  rawInput: unknown,
): { thesisPath: string; record: ThesisTestRecord } {
  const { iso, dateYmd } = formatTimestamp(new Date(), profile.timezone);
  const inputObj = typeof rawInput === "object" && rawInput !== null ? { ...(rawInput as Record<string, unknown>) } : {};
  if (!inputObj.tested_at) {
    inputObj.tested_at = iso;
  }
  if (!inputObj.event_type) {
    inputObj.event_type = "thesis_test";
  }
  if (Array.isArray(inputObj.hypotheses_tested)) {
    inputObj.hypotheses_tested = inputObj.hypotheses_tested.map((h) => {
      if (typeof h === "object" && h !== null && !(h as Record<string, unknown>).last_tested) {
        return { ...(h as Record<string, unknown>), last_tested: dateYmd };
      }
      return h;
    });
  }

  const prelim = ThesisTestRecordSchema.parse(inputObj);
  const existingRaw = readThesisFile(dataDir, prelim.ticker);
  const existingFm = existingRaw ? parseThesisMarkdown(existingRaw)?.fm ?? null : null;
  const existingList = existingFm ? parseHypothesesFromFrontmatter(existingFm.hypotheses) : [];
  const mergedHypotheses =
    prelim.hypotheses_tested.length > 0
      ? upsertHypothesesArray(existingList, prelim.hypotheses_tested)
      : existingList;

  const pit = capturePitContextForTest(dataDir, profile, prelim.ticker, prelim.price_at_test ?? null, existingFm);
  const record = ThesisTestRecordSchema.parse({
    ...prelim,
    benchmark_price_at_test: prelim.benchmark_price_at_test ?? pit.benchmarkPrice,
    pit_snapshot: prelim.pit_snapshot ?? pit.pitSnapshot,
  });

  const killFlag = record.kill_switch_triggered ? " · KILL-SWITCH TRIGGERED" : "";
  const note = `[THESIS TEST · ${record.verdict}${killFlag}] ${record.summary}`;
  const thesisPath = saveOrMergeThesis(
    dataDir,
    profile,
    {
      ticker: record.ticker,
      currency: record.currency,
      verdict: record.verdict,
      action_verdict: record.action_verdict ?? undefined,
      bear_case_summary: record.bear_case ?? undefined,
      last_tested_date: dateYmd,
      last_audited_date: dateYmd,
      price_at_audit: record.price_at_test ?? undefined,
      hypotheses: mergedHypotheses,
      decision_log_note: note,
    },
    { skipRuleChangeLog: true },
  );
  const savedRecord = appendThesisTestLog(dataDir, record);
  return { thesisPath, record: savedRecord };
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
        fx_rates: { [baseCcy]: 1.0, USD: 1.0 },
        positions: [],
      };

  const existingMap = new Map<string, PositionRecord>(current.positions.map((p) => [p.ticker, p]));

  if (input.positions) {
    const mode = input.mode ?? "replace";
    const workingMap = mode === "upsert" ? new Map(existingMap) : new Map<string, PositionRecord>();

    for (const rawRow of input.positions) {
      const row = PositionInputSchema.parse(rawRow);
      const cleanTicker =
        row.ticker.includes(".") && !row.ticker.endsWith(".DE") && !row.ticker.endsWith(".SI")
          ? row.ticker.split(".")[0]!
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

  delete current.reported_nav_base;
  current.as_of = iso;
  current.source = input.source ?? current.source;
  return PortfolioSchema.parse(current);
}

const DEMO_MARKET_CACHE: {
  vix: number;
  vix_sparkline: number[];
  macro_regime: MacroRegime;
  quotes: Record<string, MarketCacheEntry>;
} = {
  vix: 18.4,
  vix_sparkline: [21.2, 20.8, 22.1, 21.5, 20.2, 19.7, 19.3, 18.9, 19.4, 18.7, 18.4],
  macro_regime: {
    updated_at: "2026-11-23T12:00:00Z",
    vix: 18.4,
    us10y_pct: 4.25,
    us3m_pct: 4.15,
    hy_credit_ratio: 0.832,
    dxy: 103.8,
    regime_label: "CALM",
    notes: "10Y-3M slope +10 bps",
  },
  quotes: {
    "VWRA.L": {
      price: 176.5,
      regular_price: 176.5,
      extended_price: null,
      market_state: "CLOSED",
      quote_time: "2026-11-23T16:30:00Z",
      fifty_two_week_high: 182.0,
      fifty_two_week_low: 145.0,
      currency: "USD",
      change_1d_pct: 0.74,
      change_1m_pct: 3.1,
      sparkline: [171.2, 171.8, 172.4, 171.9, 172.7, 173.3, 174.1, 173.8, 174.6, 175.2, 176.5],
    },
    VTI: {
      price: 348.0,
      regular_price: 348.0,
      extended_price: 348.6,
      market_state: "POST",
      quote_time: "2026-11-23T21:15:00Z",
      fifty_two_week_high: 356.0,
      fifty_two_week_low: 280.0,
      currency: "USD",
      change_1d_pct: 1.05,
      change_1m_pct: 4.18,
      sparkline: [334.0, 335.6, 337.2, 336.4, 338.8, 340.5, 341.9, 343.0, 344.2, 344.4, 348.0],
    },
    AAPL: {
      price: 230.0,
      regular_price: 230.0,
      extended_price: 231.15,
      market_state: "POST",
      quote_time: "2026-11-23T21:20:00Z",
      fifty_two_week_high: 242.0,
      fifty_two_week_low: 178.0,
      currency: "USD",
      change_1d_pct: 0.92,
      change_1m_pct: 5.02,
      sparkline: [219.0, 220.4, 221.8, 223.1, 222.5, 224.0, 225.7, 226.9, 227.4, 227.9, 230.0],
    },
    MSFT: {
      price: 495.0,
      regular_price: 495.0,
      extended_price: 498.4,
      market_state: "POST",
      quote_time: "2026-11-23T21:20:00Z",
      fifty_two_week_high: 518.0,
      fifty_two_week_low: 392.0,
      currency: "USD",
      change_1d_pct: -0.42,
      change_1m_pct: -1.78,
      sparkline: [504.0, 502.5, 501.2, 499.8, 500.4, 498.6, 497.9, 496.5, 497.8, 497.1, 495.0],
    },
    ACME: {
      price: 112.0,
      regular_price: 112.0,
      extended_price: null,
      market_state: "CLOSED",
      quote_time: "2026-11-23T17:00:00Z",
      fifty_two_week_high: 132.0,
      fifty_two_week_low: 88.0,
      currency: "USD",
      change_1d_pct: -1.35,
      change_1m_pct: -4.2,
      sparkline: [118.0, 117.2, 116.5, 115.8, 116.1, 114.9, 114.0, 113.5, 113.8, 112.9, 112.0],
    },
    HYPE: {
      price: 43.5,
      regular_price: 43.5,
      extended_price: 42.9,
      market_state: "POST",
      quote_time: "2026-11-23T21:20:00Z",
      fifty_two_week_high: 78.0,
      fifty_two_week_low: 41.0,
      currency: "USD",
      change_1d_pct: -3.12,
      change_1m_pct: -18.6,
      sparkline: [54.0, 52.8, 51.5, 50.9, 49.4, 48.2, 47.0, 46.1, 45.2, 44.4, 43.5],
    },
  },
};

function buildSyntheticWeeklySeries(
  endPrice: number,
  annualDrift: number,
  annualVol: number,
  seedInit: number,
  weeks = 260,
): HistoryPoint[] {
  let seed = seedInit >>> 0;
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const endMs = Date.parse("2026-11-23T00:00:00Z");
  const startMs = endMs - weeks * 7 * 86400 * 1000;
  const rawLevels: number[] = [100];

  for (let i = 1; i <= weeks; i += 1) {
    const dt = new Date(startMs + i * 7 * 86400 * 1000).toISOString().slice(0, 10);
    let regimeTilt = 0;
    if (dt >= "2022-01-01" && dt <= "2022-10-15") regimeTilt = -0.0055;
    else if (dt >= "2023-01-01" && dt <= "2024-12-31") regimeTilt = 0.0018;
    const z = (nextRand() + nextRand() + nextRand() - 1.5) * 1.15;
    const ret = annualDrift / 52 + regimeTilt + (annualVol / Math.sqrt(52)) * z;
    rawLevels.push(Math.max(1, rawLevels[i - 1]! * (1 + ret)));
  }

  const scale = endPrice / rawLevels[rawLevels.length - 1]!;
  const points: HistoryPoint[] = [];
  for (let i = 0; i <= weeks; i += 1) {
    const date = new Date(startMs + i * 7 * 86400 * 1000).toISOString().slice(0, 10);
    points.push({ date, close: round(rawLevels[i]! * scale, 2) });
  }
  return points;
}

interface DemoStateBundle {
  profile: UserProfile;
  portfolio: PortfolioRecord;
  thesesRaw: Array<{ ticker: string; content: string }>;
  catalysts: CatalystRecord[];
  edgar: EdgarCacheState;
  testLogAll: ThesisTestRecord[];
  testLogByTicker: Record<string, ThesisTestRecord[]>;
  dossierModels: Record<string, DossierModel>;
  dossierMemos: Record<string, string>;
  dossierIntels: Record<string, DossierIntel>;
  dossierIntelHistory: Record<string, IntelHistoryEntry[]>;
  dossierFundamentals: Record<string, DossierFundamentals>;
  dossierInsiders: Record<string, DossierInsiders>;
  themes: ThemeObject[];
  themeMemos: Record<string, string>;
  alerts: WatchdogAlert[];
  historyCache: HistoryCacheState;
  paPerformance: PaPerformanceState;
}

function buildDemoState(): DemoStateBundle {
  const profile = ProfileSchema.parse({
    base_currency: "USD",
    timezone: "UTC",
    custody_label: "Sample Multi-Currency Brokerage",
    benchmark: {
      ticker: "VWRA",
      yf_symbol: "VWRA.L",
      label: "VWRA.L Core Global",
      expected_cagr_pct: 8.0,
      alpha_buffer_pct: 2.5,
      estate_tax_drag_mode: "hedge",
      estate_tax_hedge_bps: 35,
      estate_tax_amortize_years: 20,
      estate_tax_annual_drag_pct: null,
      core_active_cap: 12,
    },
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
      qty: null,
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
      { ticker: "HYPE", yf_symbol: "HYPE", name: "Hype Cloud Software Corp (Sample)", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 20, avg_cost: 56, ref_price: 43.5 },
    ],
  });

  const thesesRaw = [
    {
      ticker: "VWRA",
      content: `---\nticker: VWRA\nyf_symbol: VWRA.L\ncurrency: USD\nus_situs: false\nrole: Core Global Equity (50-70%)\ntier: active\naction_verdict: GO\ntakeaway:\n  - "Ireland-domiciled FTSE All-World core wrapper avoids US NRA estate tax."\n  - "Serves as 8.0% expected CAGR opportunity-cost benchmark for active ideas."\n  - "Deploy surplus cash when active single-name spreads fail the 10.5% hurdle."\nlast_audited_date: "2026-11-23"\nprice_at_audit: 176.50\nsources:\n  - label: "Vanguard UCITS Factsheet"\n    kind: report\n    date: "2026-10-31"\nlast_ref_price: 176.50\nbuy_zone_low: 160.00\nbuy_zone_high: 180.00\ntrim_zone: null\nmax_weight_pct: 70.0\nnext_catalyst_date: "2026-12-31"\nnext_catalyst: "Global cap-weighted compounding"\ngated: false\nverdict: HIGH_CONVICTION\n---\n\n# Sample Global Core ETF (VWRA)\n\n## 1. Core Thesis\n- Broad global equity diversification (Ireland UCITS domicile, exempt from US estate tax for non-US residents).\n\n## 3. Hard Kill-Switches\n1. Structural change to cross-border ETF tax treaties.\n\n## 4. Decision Log\n- **2026-11-23:** Sample core allocation baseline.\n`,
    },
    {
      ticker: "MSFT",
      content: `---\nticker: MSFT\nyf_symbol: MSFT\ncurrency: USD\nus_situs: true\nrole: Enterprise Compounder\ntier: active\naction_verdict: WAIT\ntakeaway:\n  - "Cloud backlog remains durable but AI capex intensity compresses near-term FCF conversion."\n  - "After-tax hurdle requires disciplined capital efficiency under hedge estate-tax drag."\n  - "Hold existing core shares; wait for $420-$455 buy zone before adding."\nlast_audited_date: "2026-11-23"\nprice_at_audit: 495.00\ntheme_refs:\n  - "cloud-capex-vs-software-roi"\nsources:\n  - label: "FY27 Q1 Form 10-Q"\n    kind: sec\n    date: "2026-10-30"\n    url: "https://www.sec.gov/edgar/browse/?CIK=0000789019"\n  - label: "Sample Broker Earnings Recap"\n    kind: ibkr\n    date: "2026-11-05"\n  - label: "5Y Reverse DCF Model"\n    kind: model\n    date: "2026-11-23"\nlast_ref_price: 495.00\nbuy_zone_low: 420.00\nbuy_zone_high: 455.00\ntrim_zone: 530.00\nmax_weight_pct: 12.0\nnext_catalyst_date: "2027-01-28"\nnext_catalyst: "Quarterly cloud & capex discipline check"\ngated: false\nverdict: WATCH\nlast_tested_date: "2026-11-23"\nbear_case_summary: "Rising AI data-center capex outpaces seat-based software ARPU uplift if autonomous agents compress legacy licenses."\nhypotheses:\n  - id: azure-ai-margin\n    claim: "Cloud backlog converts into durable >65% gross margin despite AI capex depreciation"\n    metric: "GAAP gross_margin_pct >= 65%"\n    status: supported\n    confidence: high\n    is_core: true\n    rule:\n      source: xbrl\n      metric: gross_margin_pct\n      op: ">="\n      threshold: 65\n      period: latest_q\n    evidence: "Latest 10-Q XBRL confirmed 68.8% GAAP gross margin alongside accelerating commercial RPO."\n    last_tested: "2026-11-23"\n  - id: seat-pricing-resilience\n    claim: "AI agent workflows expand per-user enterprise revenue rather than cannibalizing seat licenses"\n    metric: "OCF/NI cash quality >= 100%"\n    status: weakened\n    confidence: medium\n    rule:\n      source: xbrl\n      metric: ocf_to_ni_pct\n      op: ">="\n      threshold: 100\n      period: latest_q\n    evidence: "Enterprise pilot upgrades show mixed displacement vs. copilot upsell across knowledge workers."\n    last_tested: "2026-11-23"\n---\n\n# Sample Single-Stock Thesis (MSFT)\n\n## 1. Core Thesis\n- Enterprise workflow software and cloud infrastructure cash generation.\n\n## 3. Hard Kill-Switches\n1. Sustained cloud growth deceleration alongside widening FCF dilution from capex.\n\n## 4. Decision Log\n- **2026-10-01:** Initial watchlist entry.\n- **2026-11-23:** Sample single-name trigger & systematic hypothesis test baseline.\n`,
    },
    {
      ticker: "AAPL",
      content: `---\nticker: AAPL\nyf_symbol: AAPL\ncurrency: USD\nus_situs: true\nrole: Cash-Flow Ecosystem Core\ntier: active\naction_verdict: WAIT\ntakeaway:\n  - "Installed base & Services mix underpin >70% Services gross margins and steady buybacks."\n  - "Current 30x+ multiple implies modest after-tax spread versus 10.5% hurdle."\n  - "Await pullback toward $195-$212 before expanding direct weight."\nlast_audited_date: "2026-10-15"\nprice_at_audit: 196.00\ntheme_refs:\n  - "cloud-capex-vs-software-roi"\nsources:\n  - label: "FY26 Form 10-K"\n    kind: sec\n    date: "2026-11-01"\n    url: "https://www.sec.gov/edgar/browse/?CIK=0000320193"\n  - label: "5Y Scenarios Model"\n    kind: model\n    date: "2026-10-15"\nlast_ref_price: 230.00\nbuy_zone_low: 195.00\nbuy_zone_high: 212.00\ntrim_zone: 255.00\nmax_weight_pct: 12.0\nnext_catalyst_date: "2027-02-02"\nnext_catalyst: "Holiday quarter Services margin check"\ngated: false\nverdict: HIGH_CONVICTION\nlast_tested_date: "2026-10-15"\nbear_case_summary: "Regulatory pressure on App Store take rates and elongated handset upgrade cycles cap multi-year EPS growth."\nhypotheses:\n  - id: services-gross-margin\n    claim: "Consolidated gross margin holds >= 45% underpinned by recurring Services mix"\n    metric: "Consolidated GM >= 45%"\n    status: supported\n    confidence: high\n    is_core: true\n    rule:\n      source: xbrl\n      metric: gross_margin_pct\n      op: ">="\n      threshold: 45\n      period: latest_q\n    evidence: "FY26 Services grew low-teens keeping consolidated GM at 46.5%."\n    last_tested: "2026-10-15"\n---\n\n# Sample Ecosystem Core (AAPL)\n\n## 1. Core Thesis\n- High-retention hardware ecosystem monetized through recurring Services and disciplined capital return.\n\n## 3. Hard Kill-Switches\n1. Structural loss of ecosystem lock-in or sustained Services deceleration below 6% YoY.\n\n## 4. Decision Log\n- **2026-10-15:** Sample baseline audit.\n`,
    },
    {
      ticker: "ACME",
      content: `---\nticker: ACME\nyf_symbol: ACME\ncurrency: USD\nus_situs: false\nrole: Industrial Automation Bench\ntier: bench\naction_verdict: GO\ntakeaway:\n  - "Non-US industrial robotics leader with 28% ROIC and recurring software service backlog."\n  - "Entered buy zone ($105-$115) with positive after-tax CAGR spread above hurdle."\n  - "Low correlation to mega-cap tech cluster; strong candidate for staged 3-tranche entry."\nlast_audited_date: "2026-11-23"\nprice_at_audit: 112.00\ntheme_refs:\n  - "cloud-capex-vs-software-roi"\nsources:\n  - label: "Sample Annual Report"\n    kind: report\n    date: "2026-11-10"\n  - label: "Reverse DCF & Scenarios"\n    kind: model\n    date: "2026-11-23"\nlast_ref_price: 112.00\nbuy_zone_low: 102.00\nbuy_zone_high: 115.00\ntrim_zone: 165.00\nmax_weight_pct: 6.0\nnext_catalyst_date: "2027-02-18"\nnext_catalyst: "FY26 order book & software attach rate"\ngated: false\nverdict: HIGH_CONVICTION\nlast_tested_date: "2026-11-23"\nbear_case_summary: "Factory capex downturn in Europe and Asia could delay robotics deliveries by 2-3 quarters."\nhypotheses:\n  - id: software-attach-rate\n    claim: "Recurring fleet orchestration software expands above 30% of gross profit"\n    metric: "Software GP share >= 30% by FY28"\n    status: supported\n    confidence: medium\n    evidence: "Latest semi-annual report showed 24% software GP share, up 320 bps YoY."\n    last_tested: "2026-11-23"\n---\n\n# Sample Bench Compounder (ACME)\n\n## 1. Core Thesis\n- Synthetic open-source sample bench candidate demonstrating non-US industrial diversification.\n\n## 3. Hard Kill-Switches\n1. Order cancellation rate exceeding 15% or gross margin falling below 42%.\n\n## 4. Decision Log\n- **2026-11-23:** Added to Bench tier after passing after-tax hurdle.\n`,
    },
    {
      ticker: "HYPE",
      content: `---\nticker: HYPE\nyf_symbol: HYPE\ncurrency: USD\nus_situs: true\nrole: Passed Speculative Cloud\ntier: passed\naction_verdict: PASS\ntakeaway:\n  - "Passed on excessive dilution (>8% annual SBC) and negative GAAP operating leverage."\n  - "Expected after-tax CAGR trails the 10.5% hurdle unless valuation resets materially."\n  - "Re-entry watch triggered below $45 only if SBC drops under 4% of revenue."\nlast_audited_date: "2026-11-20"\nprice_at_audit: 54.00\nsources:\n  - label: "Red-Team Rejection Memo"\n    kind: report\n    date: "2026-11-20"\n  - label: "Reverse DCF Model"\n    kind: model\n    date: "2026-11-20"\nrejection_reason: "Chronic share dilution (>8% SBC/rev) and decelerating net dollar retention fail quality and hurdle screens."\nreentry_trigger: "Price <= $45 AND GAAP operating margin > 5% with SBC < 4% of revenue"\nreentry_price: 45.00\nlast_ref_price: 43.50\nbuy_zone_low: null\nbuy_zone_high: null\ntrim_zone: null\nmax_weight_pct: 0\nnext_catalyst_date: null\nnext_catalyst: null\ngated: false\nverdict: EXIT\nlast_tested_date: "2026-11-20"\nbear_case_summary: "Valuation compression compounds with ongoing equity dilution, eroding per-share intrinsic value."\nhypotheses:\n  - id: gaap-inflection\n    claim: "Company reaches sustainable GAAP operating profitability without decelerating growth"\n    metric: "GAAP EBIT margin > 5% and SBC < 4% of rev"\n    status: falsified\n    confidence: high\n    is_core: true\n    evidence: "Trailing four quarters showed widening GAAP loss and 8.6% SBC/revenue."\n    last_tested: "2026-11-20"\n---\n\n# Sample Passed Opportunity (HYPE)\n\n## 1. Core Thesis\n- Synthetic open-source passed idea illustrating explicit rejection audit trail, mandatory held exit queue, and re-entry price alert.\n\n## 3. Hard Kill-Switches\n1. Persistent negative GAAP FCF net of stock-based compensation.\n\n## 4. Decision Log\n- **2026-11-20:** Passed on valuation and dilution; set $45 conditional re-entry watch.\n`,
    },
  ];

  const dossierModels: Record<string, DossierModel> = {
    MSFT: DossierModelSchema.parse({
      as_of: "2026-11-23",
      horizon_years: 5,
      dividend_yield_pct: 0.7,
      accumulating: false,
      reverse_dcf: {
        basis: "fcf",
        current_metric_per_share: 12.1,
        current_revenue_b: 280,
        shares_diluted_m: 7450,
        target_margin_pct: 32,
        exit_multiple: 28,
        base_revenue_cagr_pct: 12.5,
        net_cash_b: 32,
        annual_dilution_pct: -0.5,
        linked_hypothesis_ids: ["azure-ai-margin", "seat-pricing-resilience"],
        notes: "Includes 35 bps hedge US estate-tax drag plus 0.21% dividend WHT drag.",
      },
      scenarios: {
        bear: { probability: 0.25, target_price_5y: 415, multiple: 22, metric_cagr_pct: 5.5, summary: "AI capex overhangs FCF conversion while seat growth stalls." },
        base: { probability: 0.5, target_price_5y: 780, multiple: 28, metric_cagr_pct: 12.5, summary: "Cloud scales efficiently and enterprise ARPU holds steady." },
        bull: { probability: 0.25, target_price_5y: 980, multiple: 31, metric_cagr_pct: 16.0, summary: "Autonomous agent monetization expands gross margins." },
      },
    }),
    AAPL: DossierModelSchema.parse({
      as_of: "2026-10-15",
      horizon_years: 5,
      dividend_yield_pct: 0.45,
      accumulating: false,
      reverse_dcf: {
        basis: "eps",
        current_metric_per_share: 7.4,
        current_revenue_b: 410,
        shares_diluted_m: 15100,
        target_margin_pct: 27,
        exit_multiple: 26,
        base_revenue_cagr_pct: 6.5,
        net_cash_b: 48,
        annual_dilution_pct: -2.2,
        linked_hypothesis_ids: ["services-gross-margin"],
        notes: "Buybacks contribute ~2.2% annual EPS accretion on top of revenue growth.",
      },
      scenarios: {
        bear: { probability: 0.25, target_price_5y: 190, multiple: 20, metric_cagr_pct: 3.5, summary: "App Store fee reset and flat hardware replacement cycle." },
        base: { probability: 0.5, target_price_5y: 345, multiple: 26, metric_cagr_pct: 9.0, summary: "Steady Services compounding and disciplined share retirements." },
        bull: { probability: 0.25, target_price_5y: 420, multiple: 28, metric_cagr_pct: 11.5, summary: "On-device AI cycle accelerates upgrades across installed base." },
      },
    }),
    ACME: DossierModelSchema.parse({
      as_of: "2026-11-23",
      horizon_years: 5,
      dividend_yield_pct: 1.2,
      accumulating: false,
      reverse_dcf: {
        basis: "fcf",
        current_metric_per_share: 4.2,
        current_revenue_b: 8.5,
        shares_diluted_m: 410,
        target_margin_pct: 24,
        exit_multiple: 24,
        base_revenue_cagr_pct: 14.0,
        net_cash_b: 2.1,
        annual_dilution_pct: 0.2,
        linked_hypothesis_ids: ["software-attach-rate"],
        notes: "Non-US domicile eliminates US estate-tax drag, lowering required gross CAGR.",
      },
      scenarios: {
        bear: { probability: 0.2, target_price_5y: 92, multiple: 17, metric_cagr_pct: 4.0, summary: "Prolonged industrial capex recession delays robot deployments." },
        base: { probability: 0.55, target_price_5y: 235, multiple: 24, metric_cagr_pct: 15.0, summary: "Factory automation backlog converts with rising software margins." },
        bull: { probability: 0.25, target_price_5y: 315, multiple: 28, metric_cagr_pct: 19.5, summary: "Global reshoring accelerates multi-year fleet adoption." },
      },
    }),
    HYPE: DossierModelSchema.parse({
      as_of: "2026-11-20",
      horizon_years: 5,
      dividend_yield_pct: 0,
      accumulating: false,
      reverse_dcf: {
        basis: "fcf",
        current_metric_per_share: 0.85,
        current_revenue_b: 2.1,
        shares_diluted_m: 320,
        target_margin_pct: 18,
        exit_multiple: 25,
        base_revenue_cagr_pct: 14.0,
        net_cash_b: 0.4,
        annual_dilution_pct: 6.5,
        linked_hypothesis_ids: ["gaap-inflection"],
        notes: "High SBC dilution requires unrealistic terminal margin to clear hurdle.",
      },
      scenarios: {
        bear: { probability: 0.35, target_price_5y: 22, multiple: 15, metric_cagr_pct: 3.0, summary: "Growth slows into teens while dilution persists." },
        base: { probability: 0.45, target_price_5y: 58, multiple: 22, metric_cagr_pct: 11.0, summary: "Gradual GAAP breakeven leaves sub-hurdle after-tax compounding." },
        bull: { probability: 0.2, target_price_5y: 90, multiple: 28, metric_cagr_pct: 18.0, summary: "Clean operating leverage turnaround." },
      },
    }),
  };

  const dossierMemos: Record<string, string> = {
    MSFT: `# MSFT — Primary-Source Underwriting Memo (Demo)\n\n## Executive Takeaway\nMicrosoft combines durable enterprise distribution with massive cloud backlog, but rising data-center depreciation raises the bar on incremental capital efficiency.\n\n## Valuation & Reverse DCF\nAt **$495/sh**, clearing the **10.5% after-tax hurdle** (plus hedge estate & dividend tax drag) is decomposed across multiple expansion, margin bridge, and residual revenue CAGR.\n\n| Scenario | Prob | 5Y Target | Exit Mult | Key Driver |\n| :--- | :---: | :---: | :---: | :--- |\n| Bear | 25% | $415 | 22x | Capex drag + seat compression |\n| Base | 50% | $780 | 28x | Steady cloud scale + stable ARPU |\n| Bull | 25% | $980 | 31x | High-margin autonomous agent uplift |\n`,
    ACME: `# ACME — Industrial Automation Bench Memo (Demo)\n\n## Executive Takeaway\nSynthetic open-source sample dossier illustrating a **Bench** candidate with non-US domicile, strong ROIC, and positive after-tax spread.\n`,
    HYPE: `# HYPE — Red-Team Rejection Memo (Demo)\n\n## Why We Passed\n- Stock-based compensation exceeded 8% of revenue for four straight quarters.\n- Held residual shares are queued under **Mandatory Exits** until liquidated.\n`,
  };

  const dossierIntels: Record<string, DossierIntel> = {
    MSFT: {
      updated_at: "2026-11-23T12:00:00Z",
      provider: "demo_broker_intel",
      contract_id: 272093,
      earnings_insight: {
        period: "Q1 FY27",
        published_at: "2026-11-05",
        kind: "recap",
        headline: "Cloud backlog accelerated while AI infrastructure capex stepped higher",
        summary: "Commercial remaining performance obligations grew strongly; management guided elevated data-center spend through FY27.",
        key_metrics: ["Cloud YoY: +24%", "Operating Margin: 44.6%", "Capex / Revenue: 28%"],
      },
      options_intel: {
        as_of: "2026-11-23",
        underlying_price: 495.0,
        expiry: "2027-01-29",
        atm_strike: 495.0,
        straddle_price: 29.7,
        implied_move_pct: 6.0,
        call_iv_pct: 25.4,
        put_iv_pct: 27.1,
        iv_skew_pct: 1.7,
        note: "Sample post-earnings ATM straddle pricing ±6.0% implied move.",
      },
      consensus: {
        as_of: "2026-11-23",
        ntm_rev_b: 304.5,
        ntm_rev_growth_pct: 13.5,
        ntm_eps: 14.1,
        fy1_eps_est: 13.8,
        fy2_eps_est: 15.9,
        eps_revision_90d_pct: 2.8,
        target_price_mean: 545.0,
        analyst_count: 54,
      },
      themes: ["Enterprise Cloud Infrastructure", "AI Productivity Software", "Hyperscale Data Centers"],
      connections: [
        { ticker: "AMZN", name: "Amazon Web Services", relation: "competitor" },
        { ticker: "GOOGL", name: "Google Cloud", relation: "competitor" },
        { ticker: "NVDA", name: "NVIDIA Corp", relation: "supplier" },
      ],
    },
  };

  const dossierIntelHistory: Record<string, IntelHistoryEntry[]> = {
    MSFT: [
      {
        recorded_at: "2026-11-23T12:00:00Z",
        provider: "demo_broker_intel",
        period: "Q1 FY27",
        eps_actual: 3.48,
        eps_est: 3.31,
        rev_actual_b: 72.4,
        rev_est_b: 70.8,
        implied_move_pct: 6.0,
        iv_30d_pct: 25.4,
        iv_pct_52w: 44.0,
        headline: "Cloud backlog accelerated while AI capex stepped higher",
      },
      {
        recorded_at: "2026-08-05T12:00:00Z",
        provider: "demo_broker_intel",
        period: "Q4 FY26",
        eps_actual: 3.35,
        eps_est: 3.22,
        rev_actual_b: 70.1,
        rev_est_b: 69.2,
        implied_move_pct: 5.4,
        iv_30d_pct: 22.8,
        iv_pct_52w: 38.0,
        headline: "Commercial cloud topped $40B quarterly run-rate",
      },
    ],
  };

  const dossierFundamentals: Record<string, DossierFundamentals> = {
    MSFT: {
      ticker: "MSFT",
      cik: "0000789019",
      updated_at: "2026-11-23T12:00:00Z",
      source: "sec_xbrl",
      currency: "USD",
      latest_periodic_accession: "0000789019-26-000088",
      quarterly: [
        { period_end: "2026-09-30", filed_date: "2026-10-30", fiscal_year: 2027, fiscal_period: "Q1", form: "10-Q", revenue_m: 72400, gross_profit_m: 49811, operating_income_m: 32290, net_income_m: 26000, ocf_m: 34200, capex_m: 16500, fcf_m: 17700, sbc_m: 2850, diluted_shares_m: 7450, eps_diluted: 3.49, dso_days: 54.2, gross_margin_pct: 68.8, operating_margin_pct: 44.6, fcf_margin_pct: 24.45, ocf_to_ni_pct: 131.54, sbc_pct_rev: 3.94, net_cash_b: 32.0 },
        { period_end: "2026-06-30", filed_date: "2026-07-30", fiscal_year: 2026, fiscal_period: "Q4", form: "10-K", revenue_m: 70100, gross_profit_m: 48439, operating_income_m: 31120, net_income_m: 25000, ocf_m: 33100, capex_m: 15200, fcf_m: 17900, sbc_m: 2790, diluted_shares_m: 7460, eps_diluted: 3.35, dso_days: 55.0, gross_margin_pct: 69.1, operating_margin_pct: 44.39, fcf_margin_pct: 25.53, ocf_to_ni_pct: 132.4, sbc_pct_rev: 3.98, net_cash_b: 30.8 },
        { period_end: "2026-03-31", filed_date: "2026-04-30", fiscal_year: 2026, fiscal_period: "Q3", form: "10-Q", revenue_m: 67800, gross_profit_m: 47053, operating_income_m: 30100, net_income_m: 24100, ocf_m: 31800, capex_m: 14100, fcf_m: 17700, sbc_m: 2710, diluted_shares_m: 7470, eps_diluted: 3.23, dso_days: 53.1, gross_margin_pct: 69.4, operating_margin_pct: 44.4, fcf_margin_pct: 26.11, ocf_to_ni_pct: 131.95, sbc_pct_rev: 4.0, net_cash_b: 29.4 },
        { period_end: "2025-12-31", filed_date: "2026-01-30", fiscal_year: 2026, fiscal_period: "Q2", form: "10-Q", revenue_m: 66200, gross_profit_m: 45876, operating_income_m: 29250, net_income_m: 23400, ocf_m: 30900, capex_m: 13400, fcf_m: 17500, sbc_m: 2680, diluted_shares_m: 7480, eps_diluted: 3.13, dso_days: 52.8, gross_margin_pct: 69.3, operating_margin_pct: 44.18, fcf_margin_pct: 26.44, ocf_to_ni_pct: 132.05, sbc_pct_rev: 4.05, net_cash_b: 28.5 },
        { period_end: "2025-09-30", filed_date: "2025-10-30", fiscal_year: 2026, fiscal_period: "Q1", form: "10-Q", revenue_m: 64100, gross_profit_m: 44678, operating_income_m: 28400, net_income_m: 22600, ocf_m: 29800, capex_m: 12500, fcf_m: 17300, sbc_m: 2600, diluted_shares_m: 7490, eps_diluted: 3.02, dso_days: 52.0, gross_margin_pct: 69.7, operating_margin_pct: 44.31, fcf_margin_pct: 26.99, ocf_to_ni_pct: 131.86, sbc_pct_rev: 4.06, net_cash_b: 27.6 },
      ],
      annual: [
        { period_end: "2026-06-30", filed_date: "2026-07-30", fiscal_year: 2026, fiscal_period: "FY", form: "10-K", revenue_m: 268200, gross_profit_m: 186046, operating_income_m: 118870, net_income_m: 95100, ocf_m: 125600, capex_m: 55200, fcf_m: 70400, sbc_m: 10780, diluted_shares_m: 7460, eps_diluted: 12.75, gross_margin_pct: 69.37, operating_margin_pct: 44.32, fcf_margin_pct: 26.25, ocf_to_ni_pct: 132.07, sbc_pct_rev: 4.02, net_cash_b: 30.8 },
        { period_end: "2025-06-30", filed_date: "2025-07-30", fiscal_year: 2025, fiscal_period: "FY", form: "10-K", revenue_m: 245100, gross_profit_m: 171080, operating_income_m: 109400, net_income_m: 88100, ocf_m: 118500, capex_m: 44500, fcf_m: 74000, sbc_m: 10100, diluted_shares_m: 7490, eps_diluted: 11.76, gross_margin_pct: 69.8, operating_margin_pct: 44.63, fcf_margin_pct: 30.19, ocf_to_ni_pct: 134.51, sbc_pct_rev: 4.12, net_cash_b: 29.0 },
        { period_end: "2024-06-30", filed_date: "2024-07-30", fiscal_year: 2024, fiscal_period: "FY", form: "10-K", revenue_m: 211900, gross_profit_m: 146000, operating_income_m: 88500, net_income_m: 72400, ocf_m: 87600, capex_m: 28100, fcf_m: 59500, sbc_m: 9600, diluted_shares_m: 7510, eps_diluted: 9.64, gross_margin_pct: 68.9, operating_margin_pct: 41.76, fcf_margin_pct: 28.08, ocf_to_ni_pct: 120.99, sbc_pct_rev: 4.53, net_cash_b: 25.0 },
        { period_end: "2023-06-30", filed_date: "2023-07-28", fiscal_year: 2023, fiscal_period: "FY", form: "10-K", revenue_m: 198300, gross_profit_m: 135600, operating_income_m: 83400, net_income_m: 67400, ocf_m: 89000, capex_m: 23900, fcf_m: 65100, sbc_m: 8900, diluted_shares_m: 7540, eps_diluted: 8.94, gross_margin_pct: 68.38, operating_margin_pct: 42.06, fcf_margin_pct: 32.83, ocf_to_ni_pct: 132.05, sbc_pct_rev: 4.49, net_cash_b: 24.0 },
      ],
      latest_ratios: {
        gross_margin_pct: 68.8,
        operating_margin_pct: 44.6,
        dso_days: 54.2,
        dio_days: null,
        ocf_to_ni_pct: 131.54,
        fcf_margin_pct: 24.45,
        owner_earnings_margin_pct: 20.51,
        sbc_pct_rev: 3.94,
        roic_pct: 28.4,
        incremental_roic_pct: 24.1,
        accruals_ratio_pct: -5.4,
        quality_grade: "A",
        quality_flags: [],
        net_cash_b: 32.0,
        diluted_shares_yoy_pct: -0.53,
        ttm_eps: 13.2,
        ttm_fcf_per_share: 9.5,
        ttm_owner_earnings_per_share: 8.02,
        ttm_rev_per_share: 37.11,
      },
    },
    AAPL: {
      ticker: "AAPL",
      cik: "0000320193",
      updated_at: "2026-11-23T12:00:00Z",
      source: "sec_xbrl",
      currency: "USD",
      latest_periodic_accession: "0000320193-26-000105",
      quarterly: [
        { period_end: "2026-09-26", filed_date: "2026-11-01", fiscal_year: 2026, fiscal_period: "Q4", form: "10-K", revenue_m: 102000, gross_profit_m: 47430, operating_income_m: 32640, net_income_m: 27400, ocf_m: 30800, capex_m: 2900, fcf_m: 27900, sbc_m: 3000, diluted_shares_m: 15100, eps_diluted: 1.81, dso_days: 28.4, gross_margin_pct: 46.5, operating_margin_pct: 32.0, fcf_margin_pct: 27.35, ocf_to_ni_pct: 112.41, sbc_pct_rev: 2.94, net_cash_b: 48.0 },
      ],
      annual: [
        { period_end: "2026-09-26", filed_date: "2026-11-01", fiscal_year: 2026, fiscal_period: "FY", form: "10-K", revenue_m: 410000, gross_profit_m: 190650, operating_income_m: 130000, net_income_m: 111700, ocf_m: 122000, capex_m: 11000, fcf_m: 111000, sbc_m: 11800, diluted_shares_m: 15100, eps_diluted: 7.4, gross_margin_pct: 46.5, operating_margin_pct: 31.71, fcf_margin_pct: 27.07, ocf_to_ni_pct: 109.22, sbc_pct_rev: 2.88, net_cash_b: 48.0 },
        { period_end: "2025-09-27", filed_date: "2025-11-01", fiscal_year: 2025, fiscal_period: "FY", form: "10-K", revenue_m: 391000, gross_profit_m: 180600, operating_income_m: 123200, net_income_m: 104000, ocf_m: 118000, capex_m: 10500, fcf_m: 107500, sbc_m: 11200, diluted_shares_m: 15400, eps_diluted: 6.75, gross_margin_pct: 46.19, operating_margin_pct: 31.51, fcf_margin_pct: 27.49, ocf_to_ni_pct: 113.46, sbc_pct_rev: 2.86, net_cash_b: 51.0 },
      ],
      latest_ratios: {
        gross_margin_pct: 46.5,
        operating_margin_pct: 32.0,
        dso_days: 28.4,
        dio_days: 10.2,
        ocf_to_ni_pct: 112.41,
        fcf_margin_pct: 27.35,
        owner_earnings_margin_pct: 24.41,
        sbc_pct_rev: 2.94,
        roic_pct: 49.2,
        incremental_roic_pct: 42.5,
        accruals_ratio_pct: -3.1,
        quality_grade: "A",
        quality_flags: [],
        net_cash_b: 48.0,
        diluted_shares_yoy_pct: -1.95,
        ttm_eps: 7.4,
        ttm_fcf_per_share: 7.35,
        ttm_owner_earnings_per_share: 6.57,
        ttm_rev_per_share: 27.15,
      },
    },
  };

  const dossierInsiders: Record<string, DossierInsiders> = {
    MSFT: {
      ticker: "MSFT",
      cik: "0000789019",
      updated_at: "2026-11-23T12:00:00Z",
      cached_accessions: ["0000789019-26-000091"],
      window_90d: {
        disc_buy_usd: 0,
        disc_sell_usd: 0,
        plan_sell_usd: 4250000,
        distinct_buyers: 0,
        distinct_sellers: 0,
      },
      window_12m: {
        disc_buy_usd: 500000,
        disc_sell_usd: 1200000,
        plan_sell_usd: 16500000,
        distinct_buyers: 1,
        distinct_sellers: 1,
      },
      flags: [],
      recent_filings: [
        {
          filing_date: "2026-11-08",
          accession: "0000789019-26-000091",
          form: "4",
          owner_name: "SAMPLE EXECUTIVE",
          title: "Executive Vice President",
          is_director: false,
          code: "S",
          shares: 8500,
          price: 500.0,
          value_usd: 4250000,
          is_10b5_1: true,
          url: "https://www.sec.gov/edgar/browse/?CIK=0000789019",
        },
      ],
    },
    ACME: {
      ticker: "ACME",
      cik: "0001234567",
      updated_at: "2026-11-23T12:00:00Z",
      cached_accessions: ["0001234567-26-000012", "0001234567-26-000014"],
      window_90d: {
        disc_buy_usd: 840000,
        disc_sell_usd: 0,
        plan_sell_usd: 0,
        distinct_buyers: 2,
        distinct_sellers: 0,
      },
      window_12m: {
        disc_buy_usd: 840000,
        disc_sell_usd: 0,
        plan_sell_usd: 0,
        distinct_buyers: 2,
        distinct_sellers: 0,
      },
      flags: [
        "DISCRETIONARY_BUY_CLUSTER: 2 insiders bought $840,000 (90D)",
        "C_SUITE_DISCRETIONARY_BUY: $640,000 open-market buy by senior executive (90D)",
      ],
      recent_filings: [
        {
          filing_date: "2026-11-12",
          accession: "0001234567-26-000014",
          form: "4",
          owner_name: "SAMPLE CEO",
          title: "Chief Executive Officer",
          is_director: true,
          code: "P",
          shares: 5700,
          price: 112.28,
          value_usd: 640000,
          is_10b5_1: false,
        },
        {
          filing_date: "2026-11-10",
          accession: "0001234567-26-000012",
          form: "4",
          owner_name: "SAMPLE DIRECTOR",
          title: "Independent Director",
          is_director: true,
          code: "P",
          shares: 1800,
          price: 111.11,
          value_usd: 200000,
          is_10b5_1: false,
        },
      ],
    },
  };

  const themes: ThemeObject[] = [
    ThemeObjectSchema.parse({
      slug: "cloud-capex-vs-software-roi",
      title: "Cloud Capex Intensity vs. Enterprise Software ROI",
      updated_at: "2026-11-22T12:00:00Z",
      relationship_mode: "symbiotic",
      summary:
        "Tracks whether hyperscaler AI infrastructure depreciation converts into durable application-layer ARPU or shifts value toward edge devices and industrial automation.",
      shared_assumptions: [
        "Hyperscaler capex remains >24% of cloud revenue through FY27.",
        "Enterprise software budgets consolidate toward bundled platforms with clear ROI.",
        "Industrial robotics & edge hardware benefit from lower inference latency costs.",
      ],
      exposures: [
        { ticker: "MSFT", stance: "beneficiary", note: "Primary cloud scale winner, but FCF conversion carries near-term capex drag." },
        { ticker: "AAPL", stance: "hedged_tollbooth", note: "Capital-light edge distribution capturing on-device AI upgrades without hyperscaler capex." },
        { ticker: "ACME", stance: "beneficiary", note: "Industrial robotics automation enjoys falling edge-AI compute costs." },
      ],
      signposts: [
        {
          id: "cloud-roic-inflection",
          metric: "Hyperscaler cloud gross profit growth outpaces depreciation growth YoY",
          threshold: "Spread >= +200 bps",
          status: "watching",
          evidence: "Latest quarterly cloud growth +24% vs rising depreciation run-rate.",
          last_checked: "2026-11-22",
        },
      ],
      sources: [
        { label: "Sample Quarterly Sector Synthesis", kind: "report", date: "2026-11-22" },
      ],
    }),
  ];

  const themeMemos: Record<string, string> = {
    "cloud-capex-vs-software-roi":
      "# Cloud Capex Intensity vs. Enterprise Software ROI (Demo Theme)\n\n## Core Thesis\nShared macro/sector research node linking hyperscaler infrastructure spend (`MSFT`), capital-light edge distribution (`AAPL`), and industrial automation beneficiaries (`ACME`).\n\n## Falsifiable Signposts\n- Monitor whether cloud gross-profit dollar growth stays ahead of incremental data-center depreciation over the next 4 quarters.\n",
  };

  const alerts: WatchdogAlert[] = [
    {
      id: "demo-reentry-hype",
      detected_at: "2026-11-23T11:30:00Z",
      severity: "medium",
      kind: "reentry_hit",
      ticker: "HYPE",
      theme_slug: null,
      title: "HYPE Hit Passed Re-Entry Target ($43.50 <= $45.00)",
      detail: "Verify whether GAAP operating margin > 5% and SBC < 4% before considering re-entry; residual held shares remain in Mandatory Exits.",
      acknowledged: false,
    },
    {
      id: "demo-drift-aapl",
      detected_at: "2026-11-23T11:30:00Z",
      severity: "medium",
      kind: "audit_drift",
      ticker: "AAPL",
      theme_slug: null,
      title: "AAPL Audit Price Drift (+17.3%)",
      detail: "Price moved from $196.00 at 2026-10-15 audit to $230.00; re-test valuation spread.",
      acknowledged: false,
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
    {
      date: "2027-02-18",
      ticker: "ACME",
      title: "FY26 Automation Backlog & Software Attach Check",
      detail: "Verify recurring fleet software share exceeds 26% of gross profit.",
      urgency: "low",
    },
  ];

  const edgar: EdgarCacheState = {
    checked_at: "2026-11-23T12:00:00+00:00",
    gate_evaluations: [],
    filings_by_ticker: {
      AAPL: [
        {
          form: "10-K",
          filingDate: "2026-11-01",
          accession: "0000320193-26-000105",
          items: "",
          url: "https://www.sec.gov/edgar/browse/?CIK=0000320193",
        },
      ],
      MSFT: [
        {
          form: "10-Q",
          filingDate: "2026-10-30",
          accession: "0000789019-26-000088",
          items: "",
          url: "https://www.sec.gov/edgar/browse/?CIK=0000789019",
        },
      ],
    },
  };

  const testLogAll: ThesisTestRecord[] = [
    ThesisTestRecordSchema.parse({
      ticker: "MSFT",
      tested_at: "2026-11-23T12:00:00+00:00",
      event_type: "thesis_test",
      verdict: "WATCH",
      action_verdict: "WAIT",
      kill_switch_triggered: false,
      summary: "Cloud demand remains healthy, though agent seat-compression risk keeps conviction at Watch.",
      bear_case: "Capex depreciation cresting alongside seat consolidation could compress 2027–2028 FCF multiple.",
      hypotheses_tested: [],
      price_at_test: 495.0,
      benchmark_price_at_test: 176.5,
      currency: "USD",
      pit_snapshot: { vix: 18.4, us10y_pct: 4.25, portfolio_weight_pct: 8.6, fundamentals_period: "2026-09-30" },
    }),
    ThesisTestRecordSchema.parse({
      ticker: "HYPE",
      tested_at: "2026-11-20T12:00:00+00:00",
      event_type: "thesis_test",
      verdict: "EXIT",
      action_verdict: "PASS",
      kill_switch_triggered: true,
      summary: "Passed due to chronic >8% SBC dilution and sub-hurdle base-case compounding.",
      bear_case: "Equity dilution steadily erodes per-share FCF value.",
      hypotheses_tested: [],
      price_at_test: 54.0,
      benchmark_price_at_test: 175.2,
      currency: "USD",
      pit_snapshot: { vix: 18.7, us10y_pct: 4.22 },
    }),
    ThesisTestRecordSchema.parse({
      ticker: "AAPL",
      tested_at: "2026-10-15T12:00:00+00:00",
      event_type: "thesis_test",
      verdict: "HIGH_CONVICTION",
      action_verdict: "GO",
      kill_switch_triggered: false,
      summary: "Services gross margin stability and steady buybacks uphold core conviction.",
      bear_case: "Regulatory fee pressure and slower hardware upgrade cadence.",
      hypotheses_tested: [],
      price_at_test: 196.0,
      benchmark_price_at_test: 170.0,
      currency: "USD",
      pit_snapshot: { vix: 19.5, us10y_pct: 4.18, fundamentals_period: "2026-09-26" },
    }),
  ];

  const testLogByTicker: Record<string, ThesisTestRecord[]> = {};
  for (const row of testLogAll) {
    if (!testLogByTicker[row.ticker]) testLogByTicker[row.ticker] = [];
    testLogByTicker[row.ticker]!.push(row);
  }

  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-23T12:00:00Z",
    series: {
      "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(176.5, 0.095, 0.15, 101) },
      VTI: { symbol: "VTI", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(348.0, 0.11, 0.17, 202) },
      AAPL: { symbol: "AAPL", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(230.0, 0.135, 0.24, 303) },
      MSFT: { symbol: "MSFT", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(495.0, 0.155, 0.23, 404) },
      ACME: { symbol: "ACME", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(112.0, 0.165, 0.22, 505) },
      HYPE: { symbol: "HYPE", currency: "USD", source: "manual", updated_at: "2026-11-23T12:00:00Z", points: buildSyntheticWeeklySeries(43.5, 0.03, 0.44, 606) },
    },
  };

  const paPerformance: PaPerformanceState = {
    updated_at: "2026-11-23T12:00:00Z",
    provider: "demo_pa",
    base_currency: "USD",
    periods: [
      { period: "1M", twr_pct: 2.15, mwr_pct: 2.08, benchmark_pct: 1.9 },
      { period: "YTD", twr_pct: 14.8, mwr_pct: 13.9, benchmark_pct: 12.1 },
      { period: "1Y", twr_pct: 18.4, mwr_pct: 17.6, benchmark_pct: 15.2 },
    ],
    note: "Synthetic demo TWR/MWR strip.",
  };

  return {
    profile,
    portfolio,
    thesesRaw,
    catalysts,
    edgar,
    testLogAll,
    testLogByTicker,
    dossierModels,
    dossierMemos,
    dossierIntels,
    dossierIntelHistory,
    dossierFundamentals,
    dossierInsiders,
    themes,
    themeMemos,
    alerts,
    historyCache,
    paPerformance,
  };
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
  regular_price: number;
  extended_price: number | null;
  market_state: string | null;
  quote_time: string | null;
  stale: boolean;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
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

export interface DashboardHypothesisRow extends HypothesisRecord {
  auto_eval: HypothesisAutoEval | null;
  observed_breach_softened: boolean;
}

export interface ThesisProvenance {
  last_audited_date: string | null;
  price_at_audit: number | null;
  live_price: number | null;
  price_drift_pct: number | null;
  price_drift_alert: boolean;
  newer_sec_filing: { form: string; filingDate: string; url: string } | null;
  theme_updated_after_audit: boolean;
  needs_retest: boolean;
  retest_reasons: string[];
  sources: ProvenanceSource[];
}

export interface ThesisIntelSummary {
  updated_at: string;
  provider: string;
  earnings_badge: string | null;
  implied_move_pct: number | null;
  options_expiry: string | null;
  themes: string[];
}

export interface ThesisFundamentalsSummary {
  updated_at: string;
  period_end: string | null;
  currency: string;
  latest_ratios: FundamentalsRatios;
}

export interface ThesisInsidersSummary {
  updated_at: string;
  window_90d: InsiderWindow;
  window_12m: InsiderWindow;
  flags: string[];
}

export interface DashboardThesisRow {
  ticker: string;
  yf_symbol: string;
  currency: string;
  role: string;
  us_situs: boolean;
  tier: DossierTier;
  action_verdict: ActionVerdict;
  takeaway: string[];
  rejection_reason: string | null;
  reentry_trigger: string | null;
  reentry_price: number | null;
  reentry_alert: boolean;
  price: number | null;
  regular_price: number | null;
  extended_price: number | null;
  market_state: string | null;
  quote_time: string | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  cached_price: number | null;
  price_base: number | null;
  stale: boolean;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
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
  verdict: string | null;
  bear_case_summary: string | null;
  last_tested_date: string | null;
  hypotheses: DashboardHypothesisRow[];
  hypothesis_counts: {
    total: number;
    supported: number;
    weakened: number;
    falsified: number;
    untested: number;
  };
  softening_warnings: string[];
  recent_tests: ThesisTestRecord[];
  recent_rule_changes: ThesisTestRecord[];
  provenance: ThesisProvenance;
  scenario_summary: ScenarioSummary | null;
  reverse_dcf: ReverseDcfSummary | null;
  valuation_bands: ValuationBandsSummary | null;
  dip_triage: DipTriageResult;
  theme_refs: string[];
  has_memo: boolean;
  has_model: boolean;
  has_intel: boolean;
  has_fundamentals: boolean;
  has_insiders: boolean;
  intel_summary: ThesisIntelSummary | null;
  fundamentals_summary: ThesisFundamentalsSummary | null;
  insiders_summary: ThesisInsidersSummary | null;
}

export interface DashboardDipTriageQueueRow {
  ticker: string;
  tier: DossierTier;
  action_verdict: ActionVerdict;
  status: string;
  readiness: DipTriageResult["readiness"];
  price: number | null;
  currency: string;
  buy_zone_low: number | null;
  buy_zone_high: number | null;
  reentry_price: number | null;
  reentry_alert: boolean;
  cap_status: "PASS" | "WARN" | "FAIL";
  single_name_room_pct: number;
  portfolio_cap_room_pct: number;
  available_funding_base: number | null;
  high_vol_staged: boolean;
  gate_status: "PASS" | "BLOCKED";
  hurdle_status: DipTriageResult["hurdle_check"]["status"];
  spread_vs_hurdle_pct: number | null;
  next_tranche_price: number | null;
  next_tranche_base: number | null;
}

export interface DashboardLabSection {
  benchmark_summary: AfterTaxHurdleInfo;
  active_count: number;
  active_cap: number;
  bench_count: number;
  passed_count: number;
  needs_retest_count: number;
  reentry_alert_count: number;
  dip_triage_queue: DashboardDipTriageQueueRow[];
  scorecard: ForwardScorecardResult;
  pa_performance: PaPerformanceState | null;
  last_backtest_tickers: string[];
  latest_backtest: BacktestResult | null;
}

export interface DossierDetail {
  ticker: string;
  memo_md: string | null;
  model: DossierModel | null;
  intel: DossierIntel | null;
  fundamentals: DossierFundamentals | null;
  insiders: DossierInsiders | null;
  intel_history: IntelHistoryEntry[];
  valuation_bands: ValuationBandsSummary | null;
  linked_themes: ThemeObject[];
  thesis: DashboardThesisRow | null;
}

export interface ThemeLinkedThesisRef {
  ticker: string;
  stance: ThemeStance | null;
  note: string;
  tier: DossierTier | null;
  verdict: string | null;
  price: number | null;
  currency: string | null;
  needs_retest: boolean;
}

export interface ThemeDetail {
  slug: string;
  theme: ThemeObject | null;
  memo_md: string | null;
  linked_theses: ThemeLinkedThesisRef[];
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
  vix_sparkline: number[];
  macro_regime: MacroRegime | null;
  market_cache_updated_at: string | null;
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
    available_funding_base: number;
    reserve_shortfall_base: number;
    ext_total_base: number;
    ext_pct_wealth: number;
    ext_portfolio_base: number;
    ext_live_marked: boolean;
    ext_price_used: number | null;
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
  rotation_queue: CapitalRotationQueue;
  themes: ThemeObject[];
  alerts: WatchdogAlert[];
  sec_red_flags: SecRedFlag[];
  theses: DashboardThesisRow[];
  catalysts: CatalystRecord[];
  edgar: EdgarCacheState;
  forecast: PortfolioForecastResult | null;
  lab: DashboardLabSection;
}

const READINESS_ORDER: Record<DipTriageResult["readiness"], number> = {
  READY: 0,
  REENTRY_ALERT: 1,
  GATED: 2,
  WAIT: 3,
  CAP_BLOCKED: 4,
  PASSED: 5,
};

const EMPTY_ROTATION_QUEUE: CapitalRotationQueue = {
  tax_swaps: [],
  mandatory_exits: [],
  cap_trims: [],
  total_swap_base: 0,
  total_freed_base: 0,
  total_estate_tax_saved_base: 0,
};

export async function buildDashboardPayload(opts: {
  dataDir: string;
  pluginRoot: string;
  live?: boolean;
  useCache?: boolean;
  activeTab?: string;
  demo?: boolean;
}): Promise<DashboardPayload> {
  const isDemo = Boolean(opts.demo);
  const demoState = isDemo ? buildDemoState() : null;

  const profile = demoState ? demoState.profile : loadProfile(opts.dataDir);
  const portfolio = demoState ? demoState.portfolio : loadPortfolio(opts.dataDir);
  const etfCfg: EtfWeightsConfig = loadEtfWeights(opts.dataDir, opts.pluginRoot);
  const catalysts = demoState ? demoState.catalysts : loadCatalysts(opts.dataDir);
  const edgarRaw = demoState ? demoState.edgar : loadEdgarCache(opts.dataDir);
  const thesisFiles = demoState
    ? demoState.thesesRaw.map((t) => ({ ...t, filePath: "" }))
    : listThesisFiles(opts.dataDir);
  const themes = demoState ? demoState.themes : listThemes(opts.dataDir);
  const alerts = demoState ? demoState.alerts : loadWatchdogAlerts(opts.dataDir, { limit: 100 });

  const { iso: nowIso } = formatTimestamp(new Date(), profile.timezone);
  const activeTab = opts.activeTab ?? "overview";
  const benchHurdle = computeAfterTaxHurdle(profile, false, 0, 34);

  if (!portfolio) {
    const emptyMacro = isDemo ? DEMO_MARKET_CACHE.macro_regime : loadMacroRegime(opts.dataDir);
    return {
      initialized: false,
      is_demo: false,
      generated_at: nowIso,
      timezone: profile.timezone,
      base_currency: profile.base_currency,
      mode: "uninitialized",
      active_tab: activeTab,
      usd_to_base_fx: 1.0,
      fx_rates: { [profile.base_currency]: 1.0 },
      vix: emptyMacro?.vix ?? null,
      vix_sparkline: [],
      macro_regime: emptyMacro,
      market_cache_updated_at: null,
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
        available_funding_base: 0,
        reserve_shortfall_base: 0,
        ext_total_base: 0,
        ext_pct_wealth: 0,
        ext_portfolio_base: 0,
        ext_live_marked: false,
        ext_price_used: null,
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
      rotation_queue: EMPTY_ROTATION_QUEUE,
      themes,
      alerts,
      sec_red_flags: extractSecRedFlags(edgarRaw.filings_by_ticker ?? {}),
      theses: [],
      catalysts,
      edgar: edgarRaw,
      forecast: null,
      lab: {
        benchmark_summary: benchHurdle,
        active_count: 0,
        active_cap: profile.benchmark.core_active_cap,
        bench_count: 0,
        passed_count: 0,
        needs_retest_count: 0,
        reentry_alert_count: 0,
        dip_triage_queue: [],
        scorecard: {
          benchmark_symbol: profile.benchmark.yf_symbol || profile.benchmark.ticker,
          total_tests: 0,
          priced_tests: 0,
          pending_count: 0,
          matured_count: 0,
          entries: [],
          by_verdict: [
            { verdict: "HIGH_CONVICTION", count: 0, pending_count: 0, evaluated_count: 0, avg_return_pct: null, avg_alpha_pct: null, hit_rate_pct: null },
            { verdict: "WATCH", count: 0, pending_count: 0, evaluated_count: 0, avg_return_pct: null, avg_alpha_pct: null, hit_rate_pct: null },
            { verdict: "PROBATION", count: 0, pending_count: 0, evaluated_count: 0, avg_return_pct: null, avg_alpha_pct: null, hit_rate_pct: null },
            { verdict: "EXIT", count: 0, pending_count: 0, evaluated_count: 0, avg_return_pct: null, avg_alpha_pct: null, hit_rate_pct: null },
          ],
          horizon_buckets: [
            { horizon: "90d", min_days: 90, count: 0, avg_alpha_pct: null, hit_rate_pct: null },
            { horizon: "180d", min_days: 180, count: 0, avg_alpha_pct: null, hit_rate_pct: null },
            { horizon: "1Y", min_days: 365, count: 0, avg_alpha_pct: null, hit_rate_pct: null },
          ],
          brier_calibration: {
            resolved_total: 0,
            overall_brier_score: null,
            tiers: [
              { confidence: "high", predicted_prob: 0.8, resolved_count: 0, supported_count: 0, falsified_count: 0, empirical_rate_pct: null, brier_score: null },
              { confidence: "medium", predicted_prob: 0.6, resolved_count: 0, supported_count: 0, falsified_count: 0, empirical_rate_pct: null, brier_score: null },
              { confidence: "low", predicted_prob: 0.4, resolved_count: 0, supported_count: 0, falsified_count: 0, empirical_rate_pct: null, brier_score: null },
            ],
          },
        },
        pa_performance: null,
        last_backtest_tickers: [],
        latest_backtest: null,
      },
    };
  }

  const parsedTheses = thesisFiles
    .map((f) => parseThesisMarkdown(f.content))
    .filter((x): x is { fm: ThesisFrontmatter; body: string } => x !== null);

  let fxRates: Record<string, number> = { ...portfolio.fx_rates, [profile.base_currency]: 1.0 };
  if (profile.base_currency === "USD") {
    fxRates.USD = 1.0;
  }

  const existingMarketCache = isDemo ? null : loadMarketCache(opts.dataDir);
  let liveQuotes = new Map<string, QuoteResult>();
  let vixVal: number | null = isDemo
    ? DEMO_MARKET_CACHE.vix
    : (existingMarketCache?.vix ?? null);
  let vixSparkline: number[] = isDemo
    ? DEMO_MARKET_CACHE.vix_sparkline
    : (existingMarketCache?.vix_sparkline ?? []);
  let macroRegime: MacroRegime | null = isDemo
    ? DEMO_MARKET_CACHE.macro_regime
    : (loadMacroRegime(opts.dataDir) ?? existingMarketCache?.macro_regime ?? null);
  let marketCacheUpdatedAt: string | null = isDemo
    ? nowIso
    : (existingMarketCache?.updated_at ?? null);
  const staleTickers = new Set<string>();

  if (opts.live && !isDemo) {
    const quoteSymbols: string[] = ["^VIX", profile.benchmark.yf_symbol || profile.benchmark.ticker];
    for (const p of portfolio.positions) {
      quoteSymbols.push(p.yf_symbol || p.ticker);
    }
    for (const t of parsedTheses) {
      quoteSymbols.push(t.fm.yf_symbol || t.fm.ticker);
    }
    if (profile.external_exposure.enabled && profile.external_exposure.ticker) {
      quoteSymbols.push(profile.external_exposure.ticker);
    }

    const allCurrencies = new Set<string>(["USD", profile.base_currency]);
    for (const p of portfolio.positions) allCurrencies.add(p.currency);
    for (const t of parsedTheses) {
      if (t.fm.currency) allCurrencies.add(t.fm.currency.toUpperCase());
    }

    const [qMap, updatedFx, fetchedMacro] = await Promise.all([
      fetchQuotesBatch(quoteSymbols),
      fetchFxRatesToBase(Array.from(allCurrencies), profile.base_currency, fxRates),
      fetchMacroRegime({ nowIso }).catch(() => null),
    ]);
    liveQuotes = qMap;
    fxRates = updatedFx;

    if (fetchedMacro) {
      macroRegime = saveMacroRegime(opts.dataDir, fetchedMacro);
      if (fetchedMacro.vix !== null) vixVal = fetchedMacro.vix;
    }

    const vixQ = liveQuotes.get("^VIX");
    if (vixQ) {
      vixVal = round(vixQ.price, 2);
      if (vixQ.sparkline.length > 0) {
        vixSparkline = vixQ.sparkline;
      }
    }

    const nextQuotesCache: Record<string, MarketCacheEntry> = {
      ...(existingMarketCache?.quotes ?? {}),
    };
    for (const [sym, q] of liveQuotes.entries()) {
      if (sym === "^VIX") continue;
      nextQuotesCache[sym] = {
        price: round(q.price, 4),
        regular_price: round(q.regular_price, 4),
        extended_price: q.extended_price !== null ? round(q.extended_price, 4) : null,
        market_state: q.market_state,
        quote_time: q.quote_time,
        fifty_two_week_high: q.fifty_two_week_high,
        fifty_two_week_low: q.fifty_two_week_low,
        currency: q.currency,
        sparkline: q.sparkline,
        change_1d_pct: q.change_1d_pct,
        change_1m_pct: q.change_1m_pct,
      };
    }
    marketCacheUpdatedAt = nowIso;
    saveMarketCache(opts.dataDir, {
      updated_at: nowIso,
      vix: vixVal,
      vix_sparkline: vixSparkline,
      fx_rates: fxRates,
      macro_regime: macroRegime,
      quotes: nextQuotesCache,
    });
  }

  const cachedQuotesMap: Record<string, MarketCacheEntry> = isDemo
    ? DEMO_MARKET_CACHE.quotes
    : (existingMarketCache?.quotes ?? {});
  const useCachedLive = Boolean(opts.useCache && !opts.live && !isDemo && Object.keys(cachedQuotesMap).length > 0);
  if (useCachedLive && existingMarketCache?.fx_rates) {
    fxRates = { ...fxRates, ...existingMarketCache.fx_rates, [profile.base_currency]: 1.0 };
  }

  const fxUsdToBase = fxRates.USD ?? 1.0;

  let totPosBase = 0;
  let totPosUsd = 0;
  let totCostUsd = 0;

  const positionsOut: DashboardPositionRow[] = portfolio.positions.map((p) => {
    const yfSym = p.yf_symbol || p.ticker;
    const cachedQ = cachedQuotesMap[yfSym];
    let priceTrading = p.ref_price;
    let regularPrice = p.ref_price;
    let extendedPrice: number | null = cachedQ?.extended_price ?? null;
    let marketState: string | null = cachedQ?.market_state ?? null;
    let quoteTime: string | null = cachedQ?.quote_time ?? null;
    let tradingCcy = p.currency;
    let isStale = false;
    let sparkline: number[] = cachedQ?.sparkline ?? [];
    let change1d: number | null = cachedQ?.change_1d_pct ?? null;
    let change1m: number | null = cachedQ?.change_1m_pct ?? null;

    if (opts.live && !isDemo) {
      const q = liveQuotes.get(yfSym);
      if (q) {
        priceTrading = q.price;
        regularPrice = q.regular_price;
        extendedPrice = q.extended_price;
        marketState = q.market_state;
        quoteTime = q.quote_time;
        tradingCcy = q.currency || p.currency;
        sparkline = q.sparkline;
        change1d = q.change_1d_pct;
        change1m = q.change_1m_pct;
      } else {
        isStale = true;
        staleTickers.add(p.ticker);
      }
    } else if (useCachedLive && cachedQ && cachedQ.price > 0) {
      priceTrading = cachedQ.price;
      regularPrice = cachedQ.regular_price ?? cachedQ.price;
      tradingCcy = cachedQ.currency || p.currency;
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
      regular_price: round(regularPrice, 4),
      extended_price: extendedPrice !== null ? round(extendedPrice, 4) : null,
      market_state: marketState,
      quote_time: quoteTime,
      stale: isStale,
      sparkline,
      change_1d_pct: change1d,
      change_1m_pct: change1m,
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
    !opts.live && !useCachedLive && portfolio.reported_nav_base !== undefined
      ? portfolio.reported_nav_base
      : round(totPosBase + cashBase + accrualsBase, 2);
  const navUsd = fxUsdToBase > 0 ? navBase / fxUsdToBase : 0;

  const positionWeightMap = new Map<string, number>();
  const positionAssetTypeMap = new Map<string, string>();
  for (const pos of positionsOut) {
    pos.weight_nav_pct = navBase > 0 ? round((pos.mv_base / navBase) * 100, 2) : 0;
    positionWeightMap.set(pos.ticker.toUpperCase(), pos.weight_nav_pct);
    positionAssetTypeMap.set(pos.ticker.toUpperCase(), pos.asset_type);
  }

  // Look-through calculation across ALL held ETFs & direct single stocks
  const posUsdMap = new Map<string, number>();
  const posPriceMap = new Map<string, number>();
  for (const pos of positionsOut) {
    posUsdMap.set(pos.ticker, (posUsdMap.get(pos.ticker) ?? 0) + pos.mv_usd);
    posPriceMap.set(pos.ticker, pos.price);
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

  // External exposure (with optional live qty marking) & liquidity reserve summary
  const ext = profile.external_exposure;
  const reserve = profile.liquidity_reserve;
  let extAmountBase = ext.enabled ? ext.amount_base : 0;
  let extLiveMarked = false;
  let extPriceUsed: number | null = null;
  if (ext.enabled && ext.qty !== null && ext.qty > 0 && ext.ticker) {
    const extSym = ext.ticker.toUpperCase();
    const liveQ = liveQuotes.get(extSym);
    const cachedQ = cachedQuotesMap[extSym];
    const resolvedExtPrice =
      opts.live && liveQ
        ? liveQ.price
        : (useCachedLive || extAmountBase === 0) && cachedQ && cachedQ.price > 0
          ? cachedQ.price
          : posPriceMap.get(extSym) ?? (cachedQ && cachedQ.price > 0 ? cachedQ.price : null);
    if (resolvedExtPrice !== null && resolvedExtPrice > 0) {
      const extCcy = liveQ?.currency ?? cachedQ?.currency ?? "USD";
      const extFx = fxRates[extCcy] ?? fxUsdToBase;
      extAmountBase = round(ext.qty * resolvedExtPrice * extFx, 2);
      extLiveMarked = true;
      extPriceUsed = round(resolvedExtPrice, 4);
    }
  }
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

  // Always re-evaluate SEC gates dynamically against current catalysts + cached filings before thesis triage
  const edgarState: EdgarCacheState = {
    checked_at: edgarRaw.checked_at,
    gate_evaluations: evaluateSecGates(catalysts, edgarRaw.filings_by_ticker ?? {}),
    filings_by_ticker: edgarRaw.filings_by_ticker ?? {},
  };
  const secRedFlags = extractSecRedFlags(edgarState.filings_by_ticker);

  // Pre-load test log & history cache so rotation queue, valuation bands, and dip triage have complete data
  const historyCache = isDemo ? demoState!.historyCache : loadHistoryCache(opts.dataDir);
  const paPerformance = isDemo ? demoState!.paPerformance : loadPaPerformance(opts.dataDir);
  const testLogAll = isDemo ? demoState!.testLogAll : loadThesisTestLog(opts.dataDir, undefined, 500);

  const testsByTickerAll = new Map<string, ThesisTestRecord[]>();
  for (const row of testLogAll) {
    const k = row.ticker.toUpperCase();
    const list = testsByTickerAll.get(k) ?? [];
    list.push(row);
    testsByTickerAll.set(k, list);
  }

  // Compute Priority Sell & Tax-Swap Rotation Queue BEFORE dip triage so freed cash pairs with buy tranches
  const effectiveProfileForRotation: UserProfile = extLiveMarked
    ? { ...profile, external_exposure: { ...profile.external_exposure, amount_base: extAmountBase } }
    : profile;
  const rotationThesesInput = parsedTheses.map(({ fm }) => {
    const sym = String(fm.ticker).toUpperCase();
    const tierParsed = DossierTierSchema.safeParse(fm.tier);
    const tickerTests = (testsByTickerAll.get(sym) ?? []).filter((r) => r.event_type !== "rule_change");
    const latestTest = tickerTests[0];
    return {
      ticker: sym,
      tier: tierParsed.success ? tierParsed.data : ("active" as DossierTier),
      verdict: typeof fm.verdict === "string" ? fm.verdict : null,
      max_weight_pct:
        fm.max_weight_pct !== undefined && fm.max_weight_pct !== null
          ? fm.max_weight_pct
          : (fm.max_ibkr_weight_pct ?? null),
      kill_switch_triggered: Boolean(latestTest?.kill_switch_triggered),
      rejection_reason: typeof fm.rejection_reason === "string" ? fm.rejection_reason : null,
    };
  });

  const rotationQueue = computeCapitalRotationQueue(
    portfolio,
    ltRows,
    riskCaps,
    rotationThesesInput,
    effectiveProfileForRotation,
    fxUsdToBase,
    {
      positionsOut,
      navBase,
      etfWeights: etfCfg,
    },
  );

  const deployableCashBase = round(Math.max(0, cashBase - reserveAmountBase), 2);
  const availableFundingBase = round(deployableCashBase + rotationQueue.total_freed_base, 2);

  // Map shared themes by slug & ticker
  const themesBySlug = new Map<string, ThemeObject>(themes.map((th) => [th.slug, th]));
  const themeSlugsByTicker = new Map<string, Set<string>>();
  for (const th of themes) {
    for (const exp of th.exposures) {
      const sym = exp.ticker.toUpperCase();
      const set = themeSlugsByTicker.get(sym) ?? new Set<string>();
      set.add(th.slug);
      themeSlugsByTicker.set(sym, set);
    }
  }

  // Current price map for scorecard & thesis rows
  const currentPricesMap = new Map<string, number>(posPriceMap);
  const benchYf = profile.benchmark.yf_symbol || profile.benchmark.ticker;
  const liveBenchQ = liveQuotes.get(benchYf);
  if (liveBenchQ) {
    currentPricesMap.set(benchYf, liveBenchQ.price);
    currentPricesMap.set(profile.benchmark.ticker, liveBenchQ.price);
  } else if (cachedQuotesMap[benchYf]) {
    currentPricesMap.set(benchYf, cachedQuotesMap[benchYf]!.price);
    currentPricesMap.set(profile.benchmark.ticker, cachedQuotesMap[benchYf]!.price);
  }

  // Thesis cards with live/cached quotes, dossiers, XBRL, Form 4, valuation bands, auto-eval, shared themes & dip triage
  const thesesOut: DashboardThesisRow[] = parsedTheses.map(({ fm, body }) => {
    const sym = String(fm.ticker).toUpperCase();
    const yfSym = String(fm.yf_symbol || sym);
    const thesisCcy = String(fm.currency || "USD").toUpperCase();
    const refP = typeof fm.last_ref_price === "number" ? fm.last_ref_price : null;
    const cachedQ = cachedQuotesMap[yfSym];
    const cachedPrice = cachedQ && Number.isFinite(cachedQ.price) ? round(cachedQ.price, 4) : null;
    let price = refP;
    let regularPrice: number | null = cachedQ?.regular_price ?? refP;
    let extendedPrice: number | null = cachedQ?.extended_price ?? null;
    let marketState: string | null = cachedQ?.market_state ?? null;
    let quoteTime: string | null = cachedQ?.quote_time ?? null;
    let high52w: number | null = cachedQ?.fifty_two_week_high ?? null;
    let low52w: number | null = cachedQ?.fifty_two_week_low ?? null;
    let ccy = thesisCcy;
    let isStale = false;
    let sparkline: number[] = cachedQ?.sparkline ?? [];
    let change1d: number | null = cachedQ?.change_1d_pct ?? null;
    let change1m: number | null = cachedQ?.change_1m_pct ?? null;
    let marketEntryForRule: MarketCacheEntry | null = cachedQ ?? null;

    if (opts.live && !isDemo) {
      const q = liveQuotes.get(yfSym);
      if (q) {
        price = q.price;
        regularPrice = q.regular_price;
        extendedPrice = q.extended_price;
        marketState = q.market_state;
        quoteTime = q.quote_time;
        high52w = q.fifty_two_week_high;
        low52w = q.fifty_two_week_low;
        ccy = q.currency || thesisCcy;
        sparkline = q.sparkline;
        change1d = q.change_1d_pct;
        change1m = q.change_1m_pct;
        marketEntryForRule = {
          price: q.price,
          regular_price: q.regular_price,
          extended_price: q.extended_price,
          market_state: q.market_state,
          quote_time: q.quote_time,
          fifty_two_week_high: q.fifty_two_week_high,
          fifty_two_week_low: q.fifty_two_week_low,
          currency: q.currency,
          sparkline: q.sparkline,
          change_1d_pct: q.change_1d_pct,
          change_1m_pct: q.change_1m_pct,
        };
      } else if (cachedQ && cachedQ.price > 0) {
        price = cachedQ.price;
        regularPrice = cachedQ.regular_price ?? cachedQ.price;
        isStale = true;
        staleTickers.add(sym);
      } else if (refP !== null) {
        isStale = true;
        staleTickers.add(sym);
      }
    } else if (useCachedLive && cachedQ && cachedQ.price > 0) {
      price = cachedQ.price;
      regularPrice = cachedQ.regular_price ?? cachedQ.price;
      ccy = cachedQ.currency || thesisCcy;
    } else if (price === null) {
      if (cachedQ && cachedQ.price > 0) {
        price = cachedQ.price;
        regularPrice = cachedQ.regular_price ?? cachedQ.price;
        ccy = cachedQ.currency || thesisCcy;
      } else if (posPriceMap.has(sym)) {
        price = posPriceMap.get(sym)!;
        regularPrice = price;
      }
    }

    if (price !== null && Number.isFinite(price)) {
      currentPricesMap.set(sym, price);
    }

    const ccyFxToBase = fxRates[ccy] ?? fxUsdToBase;
    const priceBase = price !== null ? round(price * ccyFxToBase, 2) : null;
    const maxWeight =
      fm.max_weight_pct !== undefined && fm.max_weight_pct !== null
        ? fm.max_weight_pct
        : (fm.max_ibkr_weight_pct ?? null);

    const parsedTier = DossierTierSchema.safeParse(fm.tier);
    const tier: DossierTier = parsedTier.success ? parsedTier.data : "active";
    const status = classifyTriggerStatus(price, fm);
    const parsedAction = ActionVerdictSchema.safeParse(fm.action_verdict);
    const actionVerdict: ActionVerdict = parsedAction.success
      ? parsedAction.data
      : tier === "passed"
        ? "PASS"
        : Boolean(fm.gated)
          ? "WAIT"
          : status === "IN BUY ZONE" || status === "DEEP VALUE / CHECK THESIS"
            ? "GO"
            : "WAIT";

    const coreSummary = extractSectionBullets(body, "## 1.", 3);
    const takeaway =
      Array.isArray(fm.takeaway) && fm.takeaway.length > 0
        ? fm.takeaway.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
        : coreSummary.slice(0, 3);

    const allTickerLogs = isDemo ? (demoState?.testLogByTicker[sym] ?? []) : (testsByTickerAll.get(sym) ?? []);
    const recentTests = allTickerLogs.filter((r) => r.event_type !== "rule_change").slice(0, 5);
    const recentRuleChanges = allTickerLogs.filter((r) => r.event_type === "rule_change").slice(0, 5);
    const killSwitchTriggered = Boolean(recentTests[0]?.kill_switch_triggered);

    const model = isDemo ? (demoState?.dossierModels[sym] ?? null) : loadDossierModel(opts.dataDir, sym);
    const hasMemo = isDemo ? Boolean(demoState?.dossierMemos[sym]) : hasDossierMemo(opts.dataDir, sym);
    const intel = isDemo ? (demoState?.dossierIntels[sym] ?? null) : loadDossierIntel(opts.dataDir, sym);
    const fundamentals = isDemo
      ? (demoState?.dossierFundamentals[sym] ?? null)
      : loadDossierFundamentals(opts.dataDir, sym);
    const insiders = isDemo
      ? (demoState?.dossierInsiders[sym] ?? null)
      : loadDossierInsiders(opts.dataDir, sym);

    const tickerFilings = edgarState.filings_by_ticker[sym] ?? [];
    const rawHypotheses = parseHypothesesFromFrontmatter(fm.hypotheses);
    const softeningWarnings: string[] = [];
    const hypotheses: DashboardHypothesisRow[] = rawHypotheses.map((h) => {
      const autoEval = h.rule
        ? evaluateHypothesisRule(h.rule, fundamentals, tickerFilings, insiders, marketEntryForRule)
        : null;
      const breachedSoftened = Boolean(
        autoEval &&
          autoEval.passed === false &&
          (h.status === "supported" || h.status === "weakened"),
      );
      if (breachedSoftened) {
        softeningWarnings.push(
          `Anti-softening: "${h.id}" status is ${h.status} despite breached rule (${autoEval!.detail}).`,
        );
      }
      if (h.is_core && autoEval?.passed === false && !h.waiver_reason && h.status !== "falsified") {
        softeningWarnings.push(
          `Core hypothesis "${h.id}" breached without waiver_reason; review falsification.`,
        );
      }
      return {
        ...h,
        auto_eval: autoEval,
        observed_breach_softened: breachedSoftened,
      };
    });
    const hypothesisCounts = countHypotheses(rawHypotheses);

    const usSitus = Boolean(fm.us_situs ?? true);
    const assetType = positionAssetTypeMap.get(sym) ?? "";
    const isEtf =
      etfTickersSet.has(sym) ||
      assetType.toUpperCase().includes("ETF") ||
      sym === profile.benchmark.ticker.toUpperCase();
    const isAccumulating =
      model?.accumulating ?? (assetType.toUpperCase().includes("UCITS") || sym === "VWRA");

    const taxInfo = computeAfterTaxHurdle(
      profile,
      usSitus,
      model?.dividend_yield_pct ?? 0,
      totalEstate.marginal_rate_pct,
      {
        dividendWhtPctOverride: model?.dividend_wht_pct ?? null,
        accumulating: isAccumulating,
      },
    );
    const scenarioSummary = computeScenarioSummary(price, model, taxInfo, { isEtf, fundamentals });
    const reverseDcf = computeReverseDcf(price, model, taxInfo, {
      consensusRevGrowthPct: intel?.consensus?.ntm_rev_growth_pct ?? null,
    });
    const tickerSeries = lookupHistorySeries(historyCache, yfSym, sym);
    const valuationBands = computeValuationBands(tickerSeries, fundamentals, price);

    const reentryPrice = typeof fm.reentry_price === "number" && Number.isFinite(fm.reentry_price) ? fm.reentry_price : null;
    const dipTriage = computeDipTriage(
      {
        ticker: sym,
        tier,
        us_situs: usSitus,
        gated: Boolean(fm.gated),
        max_weight_pct: maxWeight,
        buy_zone_low: fm.buy_zone_low ?? null,
        buy_zone_high: fm.buy_zone_high ?? null,
        trim_zone: fm.trim_zone ?? null,
        next_catalyst: fm.next_catalyst ?? null,
        reentry_price: reentryPrice,
        tranches: model?.tranches,
        verdict: typeof fm.verdict === "string" ? fm.verdict : null,
        kill_switch_triggered: killSwitchTriggered,
        is_etf: isEtf,
      },
      price,
      scenarioSummary,
      riskCaps,
      profile,
      edgarState.gate_evaluations,
      catalysts,
      navBase,
      fxUsdToBase,
      ltMap,
      {
        positionWeightMap,
        availableFundingBase,
        vix: vixVal,
      },
    );

    const lastAuditedDate =
      typeof fm.last_audited_date === "string"
        ? fm.last_audited_date
        : typeof fm.last_tested_date === "string"
          ? fm.last_tested_date
          : null;
    const priceAtAudit =
      typeof fm.price_at_audit === "number" && Number.isFinite(fm.price_at_audit)
        ? fm.price_at_audit
        : typeof recentTests[0]?.price_at_test === "number"
          ? recentTests[0].price_at_test
          : refP;
    const priceDriftPct =
      priceAtAudit && priceAtAudit > 0 && price !== null
        ? round(((price - priceAtAudit) / priceAtAudit) * 100, 2)
        : null;
    const priceDriftAlert = priceDriftPct !== null && Math.abs(priceDriftPct) >= 15;

    const newerSecRaw = lastAuditedDate
      ? (tickerFilings.find((f) => f.filingDate > lastAuditedDate) ?? null)
      : null;
    const newerSecFiling = newerSecRaw
      ? { form: newerSecRaw.form, filingDate: newerSecRaw.filingDate, url: newerSecRaw.url }
      : null;

    // Merge explicit frontmatter theme_refs with themes listing this ticker in exposures[]
    const mergedThemeSlugs = new Set<string>(parseThemeRefsFromFrontmatter(fm.theme_refs));
    for (const slug of themeSlugsByTicker.get(sym) ?? []) {
      mergedThemeSlugs.add(slug);
    }
    const themeRefs = Array.from(mergedThemeSlugs).sort();

    let themeUpdatedAfterAudit = false;
    const retestReasons: string[] = [];
    if (priceDriftAlert && priceDriftPct !== null) {
      retestReasons.push(
        `Price moved ${priceDriftPct >= 0 ? "+" : ""}${priceDriftPct.toFixed(1)}% since audit (${priceAtAudit})`,
      );
    }
    if (newerSecFiling) {
      retestReasons.push(`Newer SEC ${newerSecFiling.form} filed ${newerSecFiling.filingDate}`);
    }
    if (lastAuditedDate) {
      for (const slug of themeRefs) {
        const th = themesBySlug.get(slug);
        const thDate = th?.updated_at?.slice(0, 10);
        if (th && thDate && thDate > lastAuditedDate) {
          themeUpdatedAfterAudit = true;
          retestReasons.push(`Linked theme "${th.slug}" updated ${thDate} after last audit`);
        }
      }
    }
    const needsRetest = priceDriftAlert || Boolean(newerSecFiling) || themeUpdatedAfterAudit;

    const provenance: ThesisProvenance = {
      last_audited_date: lastAuditedDate,
      price_at_audit: priceAtAudit !== null ? round(priceAtAudit, 4) : null,
      live_price: price !== null ? round(price, 4) : null,
      price_drift_pct: priceDriftPct,
      price_drift_alert: priceDriftAlert,
      newer_sec_filing: newerSecFiling,
      theme_updated_after_audit: themeUpdatedAfterAudit,
      needs_retest: needsRetest,
      retest_reasons: retestReasons,
      sources: parseSourcesFromFrontmatter(fm.sources),
    };

    const intelSummary: ThesisIntelSummary | null = intel
      ? {
          updated_at: intel.updated_at,
          provider: intel.provider,
          earnings_badge: intel.earnings_insight
            ? `${intel.earnings_insight.period ? `${intel.earnings_insight.period} ` : ""}${intel.earnings_insight.kind}`
            : null,
          implied_move_pct: intel.options_intel?.implied_move_pct ?? null,
          options_expiry: intel.options_intel?.expiry ?? null,
          themes: intel.themes.slice(0, 4),
        }
      : null;

    const fundamentalsSummary: ThesisFundamentalsSummary | null = fundamentals
      ? {
          updated_at: fundamentals.updated_at,
          period_end: fundamentals.quarterly[0]?.period_end ?? fundamentals.annual[0]?.period_end ?? null,
          currency: fundamentals.currency,
          latest_ratios: fundamentals.latest_ratios,
        }
      : null;

    const insidersSummary: ThesisInsidersSummary | null = insiders
      ? {
          updated_at: insiders.updated_at,
          window_90d: insiders.window_90d,
          window_12m: insiders.window_12m,
          flags: insiders.flags,
        }
      : null;

    return {
      ticker: sym,
      yf_symbol: yfSym,
      currency: ccy,
      role: String(fm.role ?? ""),
      us_situs: usSitus,
      tier,
      action_verdict: actionVerdict,
      takeaway,
      rejection_reason: typeof fm.rejection_reason === "string" ? fm.rejection_reason : null,
      reentry_trigger: typeof fm.reentry_trigger === "string" ? fm.reentry_trigger : null,
      reentry_price: reentryPrice,
      reentry_alert: dipTriage.reentry_alert,
      price: price !== null ? round(price, 4) : null,
      regular_price: regularPrice !== null ? round(regularPrice, 4) : null,
      extended_price: extendedPrice !== null ? round(extendedPrice, 4) : null,
      market_state: marketState,
      quote_time: quoteTime,
      fifty_two_week_high: high52w,
      fifty_two_week_low: low52w,
      cached_price: cachedPrice,
      price_base: priceBase,
      stale: isStale,
      sparkline,
      change_1d_pct: change1d,
      change_1m_pct: change1m,
      last_ref_price: refP,
      buy_zone_low: fm.buy_zone_low ?? null,
      buy_zone_high: fm.buy_zone_high ?? null,
      trim_zone: fm.trim_zone ?? null,
      max_weight_pct: maxWeight,
      gated: Boolean(fm.gated),
      status,
      next_catalyst_date: fm.next_catalyst_date ?? null,
      next_catalyst: fm.next_catalyst ?? null,
      core_summary: coreSummary,
      kill_switches: extractSectionBullets(body, "## 3.", 4),
      latest_decision: extractLatestDecision(body),
      verdict: typeof fm.verdict === "string" ? fm.verdict : null,
      bear_case_summary: typeof fm.bear_case_summary === "string" ? fm.bear_case_summary : null,
      last_tested_date: typeof fm.last_tested_date === "string" ? fm.last_tested_date : null,
      hypotheses,
      hypothesis_counts: hypothesisCounts,
      softening_warnings: softeningWarnings,
      recent_tests: recentTests,
      recent_rule_changes: recentRuleChanges,
      provenance,
      scenario_summary: scenarioSummary,
      reverse_dcf: reverseDcf,
      valuation_bands: valuationBands,
      dip_triage: dipTriage,
      theme_refs: themeRefs,
      has_memo: hasMemo,
      has_model: Boolean(model),
      has_intel: Boolean(intel),
      has_fundamentals: Boolean(fundamentals),
      has_insiders: Boolean(insiders),
      intel_summary: intelSummary,
      fundamentals_summary: fundamentalsSummary,
      insiders_summary: insidersSummary,
    };
  });

  // Collect all live hypotheses across dossiers for Brier calibration
  const allLiveHypotheses: HypothesisRecord[] = thesesOut.flatMap((t) => t.hypotheses);
  const scorecard = computeForwardScorecard(
    testLogAll,
    currentPricesMap,
    historyCache,
    benchYf,
    isDemo ? new Date("2026-11-23T12:00:00Z") : new Date(),
    allLiveHypotheses,
  );

  const dipTriageQueue: DashboardDipTriageQueueRow[] = thesesOut
    .map((t) => ({
      ticker: t.ticker,
      tier: t.tier,
      action_verdict: t.action_verdict,
      status: t.status,
      readiness: t.dip_triage.readiness,
      price: t.price,
      currency: t.currency,
      buy_zone_low: t.buy_zone_low,
      buy_zone_high: t.buy_zone_high,
      reentry_price: t.reentry_price,
      reentry_alert: t.reentry_alert,
      cap_status: t.dip_triage.risk_cap_check.status,
      single_name_room_pct: t.dip_triage.risk_cap_check.single_name_room_pct,
      portfolio_cap_room_pct: t.dip_triage.risk_cap_check.portfolio_cap_room_pct,
      available_funding_base: t.dip_triage.risk_cap_check.available_funding_base,
      high_vol_staged: t.dip_triage.high_vol_staged,
      gate_status: t.dip_triage.gate_check.status,
      hurdle_status: t.dip_triage.hurdle_check.status,
      spread_vs_hurdle_pct: t.dip_triage.hurdle_check.spread_vs_hurdle_pct,
      next_tranche_price: t.dip_triage.tranche_plan[0]?.price ?? t.reentry_price ?? null,
      next_tranche_base: t.dip_triage.tranche_plan[0]?.amount_base ?? null,
    }))
    .sort((a, b) => {
      const ord = READINESS_ORDER[a.readiness] - READINESS_ORDER[b.readiness];
      if (ord !== 0) return ord;
      const spA = a.spread_vs_hurdle_pct ?? -999;
      const spB = b.spread_vs_hurdle_pct ?? -999;
      if (spA !== spB) return spB - spA;
      return a.ticker.localeCompare(b.ticker);
    });

  const backtestCandidates = new Set<string>();
  for (const t of thesesOut) backtestCandidates.add(t.ticker);
  for (const p of positionsOut) backtestCandidates.add(p.ticker);

  const lab: DashboardLabSection = {
    benchmark_summary: computeAfterTaxHurdle(profile, false, 0, totalEstate.marginal_rate_pct, { accumulating: true }),
    active_count: thesesOut.filter((t) => t.tier === "active").length,
    active_cap: profile.benchmark.core_active_cap,
    bench_count: thesesOut.filter((t) => t.tier === "bench").length,
    passed_count: thesesOut.filter((t) => t.tier === "passed").length,
    needs_retest_count: thesesOut.filter((t) => t.provenance.needs_retest).length,
    reentry_alert_count: thesesOut.filter((t) => t.reentry_alert).length,
    dip_triage_queue: dipTriageQueue,
    scorecard,
    pa_performance: paPerformance,
    last_backtest_tickers: Array.from(backtestCandidates).sort(),
    latest_backtest: null,
  };

  const totalPnlUsd = totPosUsd - totCostUsd;
  const totalPnlPct = totCostUsd > 0 ? (totalPnlUsd / totCostUsd) * 100 : 0;

  let defaultForecast: PortfolioForecastResult | null = null;
  try {
    const forecastThesisRefs: ForecastThesisRef[] = thesesOut.map((t) => {
      const m = isDemo ? (demoState?.dossierModels[t.ticker] ?? null) : loadDossierModel(opts.dataDir, t.ticker);
      return {
        ticker: t.ticker,
        yf_symbol: t.yf_symbol,
        currency: t.currency,
        us_situs: t.us_situs,
        price: t.price,
        max_weight_pct: t.max_weight_pct,
        is_etf:
          etfTickersSet.has(t.ticker) ||
          (positionAssetTypeMap.get(t.ticker) ?? "").toUpperCase().includes("ETF") ||
          t.ticker === profile.benchmark.ticker.toUpperCase(),
        accumulating: m?.accumulating ?? ((positionAssetTypeMap.get(t.ticker) ?? "").toUpperCase().includes("UCITS") || t.ticker === "VWRA"),
        scenario_summary: t.scenario_summary,
        model: m,
        quality_grade: t.fundamentals_summary?.latest_ratios.quality_grade ?? null,
      };
    });
    const defaultForecastReq = ForecastRequestSchema.parse({
      horizon_years: 5,
      include_external_wealth: profile.external_exposure.enabled,
      apply_recommended_rotations: true,
      actions: [],
      regime_vol_multiplier: 1.0,
      simulations: 800,
    });
    defaultForecast = runPortfolioForecast(
      defaultForecastReq,
      portfolio,
      effectiveProfileForRotation,
      forecastThesisRefs,
      rotationQueue,
      etfCfg,
      historyCache,
      fxRates,
      {
        defaultRfPct: macroRegime?.us3m_pct ?? 3.8,
        vix: vixVal,
        liveExternalBase: extLiveMarked ? extTotalBase - extPortfolioBase : null,
        livePricesMap: currentPricesMap,
      },
    );
  } catch {
    defaultForecast = null;
  }

  return {
    initialized: true,
    is_demo: isDemo,
    generated_at: nowIso,
    timezone: profile.timezone,
    base_currency: profile.base_currency,
    mode: isDemo ? "demo_preview" : opts.live || useCachedLive ? "live_yahoo" : `snapshot:${portfolio.as_of}`,
    active_tab: activeTab,
    usd_to_base_fx: round(fxUsdToBase, 5),
    fx_rates: fxRates,
    vix: vixVal,
    vix_sparkline: vixSparkline,
    macro_regime: macroRegime,
    market_cache_updated_at: marketCacheUpdatedAt,
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
      deployable_cash_base: deployableCashBase,
      available_funding_base: availableFundingBase,
      reserve_shortfall_base: round(Math.max(0, reserveAmountBase - cashBase), 2),
      ext_total_base: round(extTotalBase, 2),
      ext_pct_wealth: extPctWealth,
      ext_portfolio_base: round(extPortfolioBase, 2),
      ext_live_marked: extLiveMarked,
      ext_price_used: extPriceUsed,
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
    rotation_queue: rotationQueue,
    themes,
    alerts,
    sec_red_flags: secRedFlags,
    theses: thesesOut,
    catalysts,
    edgar: edgarState,
    forecast: defaultForecast,
    lab,
  };
}

export async function getDossierDetail(opts: {
  dataDir: string;
  pluginRoot: string;
  ticker: string;
  demo?: boolean;
  useCache?: boolean;
}): Promise<DossierDetail> {
  const sym = normalizeTicker(opts.ticker);
  const payload = await buildDashboardPayload({
    dataDir: opts.dataDir,
    pluginRoot: opts.pluginRoot,
    live: false,
    useCache: opts.useCache,
    demo: opts.demo,
  });
  const thesis = payload.theses.find((t) => t.ticker === sym) ?? null;
  const linkedSlugs = new Set<string>(thesis?.theme_refs ?? []);
  const linkedThemes = payload.themes.filter(
    (th) => linkedSlugs.has(th.slug) || th.exposures.some((e) => e.ticker.toUpperCase() === sym),
  );

  if (opts.demo) {
    const demoState = buildDemoState();
    return {
      ticker: sym,
      memo_md: demoState.dossierMemos[sym] ?? null,
      model: demoState.dossierModels[sym] ?? null,
      intel: demoState.dossierIntels[sym] ?? null,
      fundamentals: demoState.dossierFundamentals[sym] ?? null,
      insiders: demoState.dossierInsiders[sym] ?? null,
      intel_history: demoState.dossierIntelHistory[sym] ?? [],
      valuation_bands: thesis?.valuation_bands ?? null,
      linked_themes: linkedThemes,
      thesis,
    };
  }

  return {
    ticker: sym,
    memo_md: loadDossierMemo(opts.dataDir, sym),
    model: loadDossierModel(opts.dataDir, sym),
    intel: loadDossierIntel(opts.dataDir, sym),
    fundamentals: loadDossierFundamentals(opts.dataDir, sym),
    insiders: loadDossierInsiders(opts.dataDir, sym),
    intel_history: loadIntelHistory(opts.dataDir, sym, 30),
    valuation_bands: thesis?.valuation_bands ?? null,
    linked_themes: linkedThemes,
    thesis,
  };
}

export async function getThemeDetail(opts: {
  dataDir: string;
  pluginRoot: string;
  slug: string;
  demo?: boolean;
  useCache?: boolean;
}): Promise<ThemeDetail> {
  const normSlug = normalizeThemeSlug(opts.slug);
  const payload = await buildDashboardPayload({
    dataDir: opts.dataDir,
    pluginRoot: opts.pluginRoot,
    live: false,
    useCache: opts.useCache,
    demo: opts.demo,
  });

  let theme: ThemeObject | null;
  let memoMd: string | null;
  if (opts.demo) {
    const demoState = buildDemoState();
    theme = demoState.themes.find((t) => t.slug === normSlug) ?? null;
    memoMd = demoState.themeMemos[normSlug] ?? null;
  } else {
    theme = loadTheme(opts.dataDir, normSlug);
    memoMd = loadThemeMemo(opts.dataDir, normSlug);
  }

  const thesisByTicker = new Map(payload.theses.map((t) => [t.ticker.toUpperCase(), t]));
  const linkedMap = new Map<string, ThemeLinkedThesisRef>();

  if (theme) {
    for (const exp of theme.exposures) {
      const sym = exp.ticker.toUpperCase();
      const th = thesisByTicker.get(sym);
      linkedMap.set(sym, {
        ticker: sym,
        stance: exp.stance,
        note: exp.note,
        tier: th?.tier ?? null,
        verdict: th?.verdict ?? null,
        price: th?.price ?? null,
        currency: th?.currency ?? null,
        needs_retest: Boolean(th?.provenance.needs_retest),
      });
    }
  }
  for (const th of payload.theses) {
    if (th.theme_refs.includes(normSlug) && !linkedMap.has(th.ticker)) {
      linkedMap.set(th.ticker, {
        ticker: th.ticker,
        stance: null,
        note: th.takeaway[0] ?? "",
        tier: th.tier,
        verdict: th.verdict,
        price: th.price,
        currency: th.currency,
        needs_retest: th.provenance.needs_retest,
      });
    }
  }

  return {
    slug: normSlug,
    theme,
    memo_md: memoMd,
    linked_theses: Array.from(linkedMap.values()),
  };
}

export async function executePortfolioBacktest(opts: {
  dataDir: string;
  pluginRoot: string;
  rawRequest: unknown;
}): Promise<{ backtest: BacktestResult; payload: DashboardPayload }> {
  const req: BacktestRequest = BacktestRequestSchema.parse(opts.rawRequest);
  const isDemo = Boolean(req.demo);
  const payload = await buildDashboardPayload({
    dataDir: opts.dataDir,
    pluginRoot: opts.pluginRoot,
    live: false,
    useCache: !isDemo,
    activeTab: "lab",
    demo: isDemo,
  });

  if (!payload.initialized) {
    throw new Error("Portfolio is not initialized yet. Save positions via update_portfolio_positions or use Demo Mode.");
  }

  const demoState = isDemo ? buildDemoState() : null;
  const portfolio = demoState ? demoState.portfolio : loadPortfolio(opts.dataDir);
  if (!portfolio) {
    throw new Error("Portfolio file not found.");
  }

  const thesisMatch = payload.theses.find((t) => t.ticker === req.candidate_ticker);
  const posMatch = portfolio.positions.find((p) => p.ticker === req.candidate_ticker);
  const resolvedCandidateYf =
    req.candidate_yf_symbol || thesisMatch?.yf_symbol || posMatch?.yf_symbol || req.candidate_ticker;
  const resolvedReq: BacktestRequest = {
    ...req,
    candidate_yf_symbol: resolvedCandidateYf,
  };

  let historyCache: HistoryCacheState;
  if (isDemo) {
    historyCache = demoState!.historyCache;
  } else {
    const benchSym = payload.profile.benchmark.yf_symbol || payload.profile.benchmark.ticker;
    const symbolsToEnsure: string[] = [resolvedCandidateYf, benchSym];
    const fxCurrencies = new Set<string>();
    if (thesisMatch?.currency && thesisMatch.currency !== "USD") fxCurrencies.add(thesisMatch.currency);
    for (const p of portfolio.positions) {
      symbolsToEnsure.push(p.yf_symbol || p.ticker);
      if (p.currency && p.currency !== "USD") fxCurrencies.add(p.currency);
    }
    if (req.include_external_wealth && payload.profile.external_exposure.enabled && payload.profile.external_exposure.ticker) {
      symbolsToEnsure.push(payload.profile.external_exposure.ticker);
    }
    historyCache = await ensureHistorySeries(opts.dataDir, symbolsToEnsure, {
      fxCurrencies: Array.from(fxCurrencies),
      dailyBenchmarkSymbol: benchSym,
    });
  }

  const effectiveProfile: UserProfile = payload.summary.ext_live_marked
    ? {
        ...payload.profile,
        external_exposure: {
          ...payload.profile.external_exposure,
          amount_base: payload.summary.ext_total_base - payload.summary.ext_portfolio_base,
        },
      }
    : payload.profile;

  const backtest = runDeterministicBacktest(
    resolvedReq,
    portfolio,
    payload.lookthrough,
    effectiveProfile,
    historyCache,
    payload.fx_rates,
    { defaultRfPct: payload.macro_regime?.us3m_pct ?? 4.0 },
  );
  payload.lab.latest_backtest = backtest;
  return { backtest, payload };
}

export async function executePortfolioForecast(opts: {
  dataDir: string;
  pluginRoot: string;
  rawRequest: unknown;
}): Promise<{ forecast: PortfolioForecastResult; payload: DashboardPayload }> {
  const req: ForecastRequest = ForecastRequestSchema.parse(opts.rawRequest);
  const isDemo = Boolean(req.demo);
  const payload = await buildDashboardPayload({
    dataDir: opts.dataDir,
    pluginRoot: opts.pluginRoot,
    live: false,
    useCache: !isDemo,
    activeTab: "forecast",
    demo: isDemo,
  });

  if (!payload.initialized) {
    throw new Error("Portfolio is not initialized yet. Save positions via update_portfolio_positions or use Demo Mode.");
  }

  const demoState = isDemo ? buildDemoState() : null;
  const portfolio = demoState ? demoState.portfolio : loadPortfolio(opts.dataDir);
  if (!portfolio) {
    throw new Error("Portfolio file not found.");
  }

  const etfCfg: EtfWeightsConfig = loadEtfWeights(opts.dataDir, opts.pluginRoot);
  const etfSet = new Set(Object.keys(etfCfg.etf_weights ?? {}).map((k) => k.toUpperCase()));
  const posAssetMap = new Map(portfolio.positions.map((p) => [p.ticker.toUpperCase(), p.asset_type]));

  let historyCache: HistoryCacheState;
  if (isDemo) {
    historyCache = demoState!.historyCache;
  } else {
    const benchSym = payload.profile.benchmark.yf_symbol || payload.profile.benchmark.ticker;
    const symbolsToEnsure: string[] = [benchSym];
    const fxCurrencies = new Set<string>();
    for (const p of portfolio.positions) {
      symbolsToEnsure.push(p.yf_symbol || p.ticker);
      if (p.currency && p.currency !== "USD") fxCurrencies.add(p.currency);
    }
    for (const act of req.actions) {
      if (act.type === "buy") {
        const th = payload.theses.find((t) => t.ticker === act.ticker);
        symbolsToEnsure.push(act.yf_symbol || th?.yf_symbol || act.ticker);
        if (act.currency && act.currency !== "USD") fxCurrencies.add(act.currency);
      } else if (act.type === "tax_swap" && act.target_ticker) {
        const th = payload.theses.find((t) => t.ticker === act.target_ticker);
        symbolsToEnsure.push(th?.yf_symbol || act.target_ticker);
      }
    }
    if (req.include_external_wealth && payload.profile.external_exposure.enabled && payload.profile.external_exposure.ticker) {
      symbolsToEnsure.push(payload.profile.external_exposure.ticker);
    }
    historyCache = await ensureHistorySeries(opts.dataDir, symbolsToEnsure, {
      fxCurrencies: Array.from(fxCurrencies),
      dailyBenchmarkSymbol: benchSym,
    });
  }

  const effectiveProfile: UserProfile = payload.summary.ext_live_marked
    ? {
        ...payload.profile,
        external_exposure: {
          ...payload.profile.external_exposure,
          amount_base: payload.summary.ext_total_base - payload.summary.ext_portfolio_base,
        },
      }
    : payload.profile;

  const livePricesMap = new Map<string, number>();
  for (const pos of payload.portfolio.positions) {
    livePricesMap.set(pos.ticker, pos.price);
    if (pos.yf_symbol) livePricesMap.set(pos.yf_symbol, pos.price);
  }
  for (const t of payload.theses) {
    if (t.price !== null) {
      livePricesMap.set(t.ticker, t.price);
      if (t.yf_symbol) livePricesMap.set(t.yf_symbol, t.price);
    }
  }

  const thesisRefs: ForecastThesisRef[] = payload.theses.map((t) => {
    const model = isDemo ? (demoState?.dossierModels[t.ticker] ?? null) : loadDossierModel(opts.dataDir, t.ticker);
    return {
      ticker: t.ticker,
      yf_symbol: t.yf_symbol,
      currency: t.currency,
      us_situs: t.us_situs,
      price: t.price,
      max_weight_pct: t.max_weight_pct,
      is_etf:
        etfSet.has(t.ticker) ||
        (posAssetMap.get(t.ticker) ?? "").toUpperCase().includes("ETF") ||
        t.ticker === payload.profile.benchmark.ticker.toUpperCase(),
      accumulating:
        model?.accumulating ?? ((posAssetMap.get(t.ticker) ?? "").toUpperCase().includes("UCITS") || t.ticker === "VWRA"),
      scenario_summary: t.scenario_summary,
      model,
      quality_grade: t.fundamentals_summary?.latest_ratios.quality_grade ?? null,
    };
  });

  const forecast = runPortfolioForecast(
    req,
    portfolio,
    effectiveProfile,
    thesisRefs,
    payload.rotation_queue,
    etfCfg,
    historyCache,
    payload.fx_rates,
    {
      defaultRfPct: payload.macro_regime?.us3m_pct ?? 3.8,
      vix: payload.vix,
      liveExternalBase: payload.summary.ext_live_marked
        ? payload.summary.ext_total_base - payload.summary.ext_portfolio_base
        : null,
      livePricesMap,
    },
  );
  payload.forecast = forecast;
  return { forecast, payload };
}

export function buildSummaryText(payload: DashboardPayload): string {
  if (!payload.initialized) {
    return `Investment OS (${payload.generated_at}, Base: ${payload.base_currency}): No portfolio saved yet. Prompt the user to onboard via update_profile and update_portfolio_positions, or let them click Preview Sample Portfolio in the sidecar.`;
  }
  const s = payload.summary;
  const p = payload.portfolio;
  const ccy = payload.base_currency;
  const breaches = payload.risk_caps.filter((c) => c.status === "BREACH").map((c) => c.label);
  const unackAlerts = payload.alerts.filter((a) => !a.acknowledged).length;
  const lines = [
    `Investment OS Dashboard (${payload.mode} | Retrieved ${payload.generated_at}):`,
    `- Portfolio NAV: ${p.nav_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (USD ${p.nav_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy !== "USD" ? ` @ ${payload.usd_to_base_fx.toFixed(4)}` : ""}) | Cash: ${p.cash_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (${p.cash_pct.toFixed(2)}%)`,
  ];
  if (payload.macro_regime) {
    const m = payload.macro_regime;
    lines.push(
      `- Macro Regime: ${m.regime_label} (VIX ${m.vix ?? "n/a"}, US10Y ${m.us10y_pct ?? "n/a"}%, 3M ${m.us3m_pct ?? "n/a"}%, HY/IEF ${m.hy_credit_ratio ?? "n/a"})`,
    );
  }
  if (payload.profile.external_exposure.enabled) {
    lines.push(
      `- Total Liquid Wealth: ${s.total_liquid_wealth_base.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy} (${payload.profile.external_exposure.label}: ${Math.round(s.ext_total_base - s.ext_portfolio_base).toLocaleString("en-US")} ${ccy}${s.ext_live_marked ? " live-marked" : ""}, Concentration: ${s.ext_pct_wealth.toFixed(2)}%)`,
    );
  }
  if (s.us_situs_enabled) {
    lines.push(
      `- US-Situs Portfolio Share: ${s.us_situs_portfolio_pct.toFixed(2)}% | Est. US NRA Estate Tax: ${s.total_estate_tax_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy} (${s.estate_tax_marginal_pct.toFixed(0)}% marginal; UCITS swap saves ${s.ucits_swap_savings_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy})`,
    );
  }
  const rq = payload.rotation_queue;
  if (rq.tax_swaps.length > 0 || rq.mandatory_exits.length > 0 || rq.cap_trims.length > 0) {
    lines.push(
      `- Priority Sells & Swaps: ${rq.tax_swaps.length} tax swap(s) (${rq.total_swap_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy}) · ${rq.mandatory_exits.length} mandatory exit(s) · ${rq.cap_trims.length} cap trim(s) (Freed: ${rq.total_freed_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy})`,
    );
  }
  lines.push(
    `- Research Graph: Active ${payload.lab.active_count}/${payload.lab.active_cap} · Bench ${payload.lab.bench_count} · Passed ${payload.lab.passed_count} · Themes ${payload.themes.length} · Unack Alerts ${unackAlerts} · Needs Re-Test ${payload.lab.needs_retest_count}`,
  );
  if (payload.forecast) {
    const fc = payload.forecast;
    lines.push(
      `- ${fc.horizon_years}Y Forward Forecast (Base P50): ${fc.baseline.ending_p50_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} -> ${fc.simulated.ending_p50_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy} (${fc.deltas.p50_base >= 0 ? "+" : ""}${fc.deltas.p50_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy} with recommended rotations; P10 downside ${fc.deltas.p10_base >= 0 ? "+" : ""}${fc.deltas.p10_base.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy})`,
    );
  }
  lines.push(`- Risk Cap Breaches (${breaches.length}): ${breaches.length > 0 ? breaches.join(", ") : "None"}`);
  if (payload.stale_tickers.length > 0) {
    lines.push(`- Stale / Fallback Quotes: ${payload.stale_tickers.join(", ")}`);
  }
  return lines.join("\n");
}
