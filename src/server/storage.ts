import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  CatalystsFileSchema,
  defaultProfile,
  DossierIntelSchema,
  DossierModelSchema,
  EtfWeightsConfigSchema,
  FundamentalsSchema,
  HistoryCacheSchema,
  InsidersSchema,
  IntelHistoryEntrySchema,
  MacroRegimeSchema,
  MarketCacheEntrySchema,
  MarketCacheSchema,
  normalizeThemeSlug,
  normalizeTicker,
  PaPerformanceSchema,
  PortfolioSchema,
  ProfileSchema,
  ThemeObjectSchema,
  ThesisTestRecordSchema,
  WatchdogAlertSchema,
  type CatalystRecord,
  type DossierFundamentals,
  type DossierFundamentalsInput,
  type DossierInsiders,
  type DossierInsidersInput,
  type DossierIntel,
  type DossierModel,
  type DossierModelInput,
  type EtfWeightsConfig,
  type EtfWeightsConfigInput,
  type HistoryCacheState,
  type IntelHistoryEntry,
  type IntelHistoryEntryInput,
  type MacroRegime,
  type MacroRegimeInput,
  type MarketCacheEntry,
  type MarketCacheState,
  type MarketCacheStateInput,
  type PaPerformanceState,
  type PortfolioRecord,
  type ThemeObject,
  type ThemeObjectInput,
  type ThesisTestRecord,
  type ThesisTestRecordInput,
  type UserProfile,
  type UserProfileInput,
  type WatchdogAlert,
  type WatchdogAlertInput,
} from "./schema.js";

export { normalizeThemeSlug, type MarketCacheEntry, type MarketCacheState };

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

export function resolveDataDir(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const envDir = env.INVESTMENT_OS_DATA_DIR?.trim();
  if (envDir && !envDir.includes("${")) {
    return path.resolve(envDir);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--data-dir=") || arg.startsWith("--data_dir=")) {
      const val = arg.split("=", 2)[1]?.trim() ?? "";
      if (val && !val.includes("${")) {
        return path.resolve(val);
      }
    }
    if ((arg === "--data-dir" || arg === "--data_dir") && i + 1 < argv.length) {
      const val = (argv[i + 1] ?? "").trim();
      if (val && !val.includes("${")) {
        return path.resolve(val);
      }
    }
  }

  return path.resolve(os.homedir(), ".investment-os");
}

export function resolvePluginRoot(env: NodeJS.ProcessEnv = process.env, fallbackDir?: string): string {
  const envRoot = env.INVESTMENT_OS_ROOT?.trim();
  if (envRoot && !envRoot.includes("${")) {
    return path.resolve(envRoot);
  }
  if (fallbackDir) {
    return path.resolve(fallbackDir);
  }
  return path.resolve(process.cwd());
}

export function safeResolve(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  for (const seg of segments) {
    if (!seg || seg.includes("\0") || seg.includes("..")) {
      throw new SecurityError(`Blocked unsafe path segment: ${seg}`);
    }
  }
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new SecurityError(`Path escapes data directory: ${target}`);
  }
  return target;
}

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Ignore on filesystems that do not support POSIX chmod
  }
}

export function ensureDataDir(dataDir: string): void {
  ensurePrivateDir(dataDir);
  ensurePrivateDir(safeResolve(dataDir, "theses"));
  ensurePrivateDir(safeResolve(dataDir, "dossiers"));
  ensurePrivateDir(safeResolve(dataDir, "themes"));
  ensurePrivateDir(safeResolve(dataDir, "macro"));
}

export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  ensurePrivateDir(dir);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, targetPath);
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // Ignore on filesystems that do not support POSIX chmod
  }
}

function appendPrivateJsonl(filePath: string, lines: string[]): void {
  if (lines.length === 0) return;
  ensurePrivateDir(path.dirname(filePath));
  fs.appendFileSync(filePath, lines.join(""), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore on filesystems that do not support POSIX chmod
  }
}

export function loadProfile(dataDir: string): UserProfile {
  const filePath = safeResolve(dataDir, "profile.yaml");
  if (!fs.existsSync(filePath)) {
    return defaultProfile();
  }
  const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    return defaultProfile();
  }
  return ProfileSchema.parse(parsed);
}

export function saveProfile(dataDir: string, profile: UserProfileInput): UserProfile {
  ensureDataDir(dataDir);
  const validated = ProfileSchema.parse(profile);
  const filePath = safeResolve(dataDir, "profile.yaml");
  atomicWriteFile(filePath, yaml.dump(validated, { sortKeys: false, lineWidth: 120 }));
  return validated;
}

export function loadPortfolio(dataDir: string): PortfolioRecord | null {
  const filePath = safeResolve(dataDir, "portfolio.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return PortfolioSchema.parse(parsed);
}

export function savePortfolio(dataDir: string, portfolio: PortfolioRecord): PortfolioRecord {
  ensureDataDir(dataDir);
  const validated = PortfolioSchema.parse(portfolio);
  const filePath = safeResolve(dataDir, "portfolio.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function loadEtfWeights(dataDir: string, pluginRoot: string): EtfWeightsConfig {
  const defaultPath = path.resolve(pluginRoot, "defaults", "etf_weights.json");
  const baseCfg: EtfWeightsConfig = fs.existsSync(defaultPath)
    ? EtfWeightsConfigSchema.parse(JSON.parse(fs.readFileSync(defaultPath, "utf-8")))
    : { etf_weights: {}, etf_metadata: {} };

  const customPath = safeResolve(dataDir, "etf_weights.json");
  if (!fs.existsSync(customPath)) {
    return baseCfg;
  }
  const rawCustom = JSON.parse(fs.readFileSync(customPath, "utf-8"));
  const customCfg = EtfWeightsConfigSchema.parse(rawCustom);
  return {
    as_of: customCfg.as_of ?? baseCfg.as_of,
    note: customCfg.note ?? baseCfg.note,
    etf_weights: { ...baseCfg.etf_weights, ...customCfg.etf_weights },
    etf_metadata: { ...baseCfg.etf_metadata, ...customCfg.etf_metadata },
  };
}

export function saveEtfWeights(dataDir: string, config: EtfWeightsConfigInput): EtfWeightsConfig {
  ensureDataDir(dataDir);
  const validated = EtfWeightsConfigSchema.parse(config);
  const filePath = safeResolve(dataDir, "etf_weights.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function loadCatalysts(dataDir: string): CatalystRecord[] {
  const filePath = safeResolve(dataDir, "catalysts.yaml");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = yaml.load(fs.readFileSync(filePath, "utf-8"));
  if (!raw) return [];
  const parsed = CatalystsFileSchema.parse(Array.isArray(raw) ? { catalysts: raw } : raw);
  return parsed.catalysts;
}

export function saveCatalysts(dataDir: string, catalysts: CatalystRecord[]): CatalystRecord[] {
  ensureDataDir(dataDir);
  const validated = CatalystsFileSchema.parse({ catalysts });
  const filePath = safeResolve(dataDir, "catalysts.yaml");
  atomicWriteFile(filePath, yaml.dump(validated, { sortKeys: false, lineWidth: 120 }));
  return validated.catalysts;
}

export interface EdgarFilingRow {
  form: string;
  filingDate: string;
  accession: string;
  items?: string;
  url: string;
}

export interface SecGateEvaluation {
  ticker: string;
  form: string;
  filed_after: string;
  description: string;
  cleared: boolean;
  latest_matching_date?: string;
  latest_matching_url?: string;
}

export interface EdgarCacheState {
  checked_at: string | null;
  gate_evaluations: SecGateEvaluation[];
  filings_by_ticker: Record<string, EdgarFilingRow[]>;
}

export function loadEdgarCache(dataDir: string): EdgarCacheState {
  const filePath = safeResolve(dataDir, "edgar_latest.json");
  if (!fs.existsSync(filePath)) {
    return {
      checked_at: null,
      gate_evaluations: [],
      filings_by_ticker: {},
    };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as EdgarCacheState;
}

export function saveEdgarCache(dataDir: string, state: EdgarCacheState): void {
  ensureDataDir(dataDir);
  const filePath = safeResolve(dataDir, "edgar_latest.json");
  atomicWriteFile(filePath, JSON.stringify(state, null, 2) + "\n");
}

function emptyMarketCache(): MarketCacheState {
  return {
    updated_at: null,
    vix: null,
    vix_sparkline: [],
    quotes: {},
  };
}

export function loadMarketCache(dataDir: string): MarketCacheState {
  const filePath = safeResolve(dataDir, "market_cache.json");
  if (!fs.existsSync(filePath)) {
    return emptyMarketCache();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    const strict = MarketCacheSchema.safeParse(raw);
    if (strict.success) {
      return strict.data;
    }
    // Backward-compatible salvage for legacy/partially-populated caches
    const salvagedQuotes: Record<string, MarketCacheEntry> = {};
    if (raw && typeof raw === "object" && raw.quotes && typeof raw.quotes === "object") {
      for (const [k, v] of Object.entries(raw.quotes as Record<string, unknown>)) {
        const parsedEntry = MarketCacheEntrySchema.safeParse(v);
        if (parsedEntry.success) {
          salvagedQuotes[k] = parsedEntry.data;
        }
      }
    }
    const salvagedMacro = MacroRegimeSchema.safeParse(raw?.macro_regime);
    return MarketCacheSchema.parse({
      updated_at: typeof raw?.updated_at === "string" ? raw.updated_at : null,
      vix: typeof raw?.vix === "number" && Number.isFinite(raw.vix) ? raw.vix : null,
      vix_sparkline: Array.isArray(raw?.vix_sparkline)
        ? raw.vix_sparkline.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
        : [],
      macro_regime: salvagedMacro.success ? salvagedMacro.data : undefined,
      quotes: salvagedQuotes,
    });
  } catch {
    return emptyMarketCache();
  }
}

export function saveMarketCache(dataDir: string, state: MarketCacheStateInput): MarketCacheState {
  ensureDataDir(dataDir);
  const validated = MarketCacheSchema.parse(state);
  const filePath = safeResolve(dataDir, "market_cache.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function listThesisFiles(dataDir: string): { ticker: string; filePath: string; content: string }[] {
  const thesesDir = safeResolve(dataDir, "theses");
  if (!fs.existsSync(thesesDir)) {
    return [];
  }
  const files = fs
    .readdirSync(thesesDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort();
  return files.map((fileName) => {
    const filePath = safeResolve(thesesDir, fileName);
    return {
      ticker: fileName.replace(/\.md$/i, ""),
      filePath,
      content: fs.readFileSync(filePath, "utf-8"),
    };
  });
}

export function getThesisFilePath(dataDir: string, ticker: string): string {
  const sym = normalizeTicker(ticker);
  return safeResolve(dataDir, "theses", `${sym}.md`);
}

export function readThesisFile(dataDir: string, ticker: string): string | null {
  const filePath = getThesisFilePath(dataDir, ticker);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function writeThesisFile(dataDir: string, ticker: string, content: string): string {
  ensureDataDir(dataDir);
  const filePath = getThesisFilePath(dataDir, ticker);
  atomicWriteFile(filePath, content);
  return filePath;
}

export function getDossierDir(dataDir: string, ticker: string): string {
  const sym = normalizeTicker(ticker);
  return safeResolve(dataDir, "dossiers", sym);
}

export function ensureDossierDir(dataDir: string, ticker: string): string {
  ensureDataDir(dataDir);
  const dir = getDossierDir(dataDir, ticker);
  ensurePrivateDir(dir);
  return dir;
}

export function loadDossierModel(dataDir: string, ticker: string): DossierModel | null {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "model.json");
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return DossierModelSchema.parse(parsed);
}

export function saveDossierModel(dataDir: string, ticker: string, model: DossierModelInput): DossierModel {
  const dir = ensureDossierDir(dataDir, ticker);
  const validated = DossierModelSchema.parse(model);
  const filePath = safeResolve(dir, "model.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function hasDossierMemo(dataDir: string, ticker: string): boolean {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "memo.md");
  return fs.existsSync(filePath);
}

export function loadDossierMemo(dataDir: string, ticker: string): string | null {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "memo.md");
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function saveDossierMemo(dataDir: string, ticker: string, content: string): string {
  const dir = ensureDossierDir(dataDir, ticker);
  const filePath = safeResolve(dir, "memo.md");
  atomicWriteFile(filePath, content);
  return filePath;
}

export function loadDossierIntel(dataDir: string, ticker: string): DossierIntel | null {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "intel.json");
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return DossierIntelSchema.parse(parsed);
}

export function saveDossierIntel(dataDir: string, ticker: string, intel: DossierIntel): DossierIntel {
  const dir = ensureDossierDir(dataDir, ticker);
  const validated = DossierIntelSchema.parse(intel);
  const filePath = safeResolve(dir, "intel.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function loadDossierFundamentals(dataDir: string, ticker: string): DossierFundamentals | null {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "fundamentals.json");
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return FundamentalsSchema.parse(parsed);
}

export function saveDossierFundamentals(
  dataDir: string,
  ticker: string,
  fundamentals: DossierFundamentalsInput,
): DossierFundamentals {
  const sym = normalizeTicker(ticker);
  const dir = ensureDossierDir(dataDir, sym);
  const validated = FundamentalsSchema.parse({ ...fundamentals, ticker: sym });
  const filePath = safeResolve(dir, "fundamentals.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function loadDossierInsiders(dataDir: string, ticker: string): DossierInsiders | null {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "insiders.json");
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return InsidersSchema.parse(parsed);
}

export function saveDossierInsiders(
  dataDir: string,
  ticker: string,
  insiders: DossierInsidersInput,
): DossierInsiders {
  const sym = normalizeTicker(ticker);
  const dir = ensureDossierDir(dataDir, sym);
  const validated = InsidersSchema.parse({ ...insiders, ticker: sym });
  const filePath = safeResolve(dir, "insiders.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function appendIntelHistory(
  dataDir: string,
  ticker: string,
  entry: IntelHistoryEntryInput,
): IntelHistoryEntry {
  const dir = ensureDossierDir(dataDir, ticker);
  const validated = IntelHistoryEntrySchema.parse(entry);
  const filePath = safeResolve(dir, "intel_history.jsonl");
  appendPrivateJsonl(filePath, [JSON.stringify(validated) + "\n"]);
  return validated;
}

export function loadIntelHistory(dataDir: string, ticker: string, limit = 50): IntelHistoryEntry[] {
  const filePath = safeResolve(getDossierDir(dataDir, ticker), "intel_history.jsonl");
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const entries: IntelHistoryEntry[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      entries.push(IntelHistoryEntrySchema.parse(JSON.parse(trimmed)));
    } catch {
      // Skip malformed JSONL line without breaking history
    }
  }
  return entries.reverse().slice(0, limit);
}

export function getThemeYamlPath(dataDir: string, slug: string): string {
  const norm = normalizeThemeSlug(slug);
  return safeResolve(dataDir, "themes", `${norm}.yaml`);
}

export function getThemeMemoPath(dataDir: string, slug: string): string {
  const norm = normalizeThemeSlug(slug);
  return safeResolve(dataDir, "themes", `${norm}.md`);
}

export function listThemes(dataDir: string): ThemeObject[] {
  const themesDir = safeResolve(dataDir, "themes");
  if (!fs.existsSync(themesDir)) return [];
  const files = fs
    .readdirSync(themesDir)
    .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.startsWith("."))
    .sort();
  const out: ThemeObject[] = [];
  for (const fileName of files) {
    const filePath = safeResolve(themesDir, fileName);
    try {
      const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
      if (parsed && typeof parsed === "object") {
        out.push(ThemeObjectSchema.parse(parsed));
      }
    } catch {
      // Skip malformed theme file rather than crashing entire dashboard
    }
  }
  return out;
}

export function loadTheme(dataDir: string, slug: string): ThemeObject | null {
  const filePath = getThemeYamlPath(dataDir, slug);
  if (!fs.existsSync(filePath)) return null;
  const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object") return null;
  return ThemeObjectSchema.parse(parsed);
}

export function saveTheme(dataDir: string, theme: ThemeObjectInput): ThemeObject {
  ensureDataDir(dataDir);
  const normSlug = normalizeThemeSlug(theme.slug);
  const validated = ThemeObjectSchema.parse({ ...theme, slug: normSlug });
  const filePath = getThemeYamlPath(dataDir, normSlug);
  atomicWriteFile(filePath, yaml.dump(validated, { sortKeys: false, lineWidth: 120 }));
  return validated;
}

export function loadThemeMemo(dataDir: string, slug: string): string | null {
  const filePath = getThemeMemoPath(dataDir, slug);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function saveThemeMemo(dataDir: string, slug: string, content: string): string {
  ensureDataDir(dataDir);
  const filePath = getThemeMemoPath(dataDir, slug);
  atomicWriteFile(filePath, content);
  return filePath;
}

export function loadMacroRegime(dataDir: string): MacroRegime | null {
  const filePath = safeResolve(dataDir, "macro", "regimes.yaml");
  if (!fs.existsSync(filePath)) return null;
  const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object") return null;
  return MacroRegimeSchema.parse(parsed);
}

export function saveMacroRegime(dataDir: string, regime: MacroRegimeInput): MacroRegime {
  ensureDataDir(dataDir);
  const validated = MacroRegimeSchema.parse(regime);
  const filePath = safeResolve(dataDir, "macro", "regimes.yaml");
  atomicWriteFile(filePath, yaml.dump(validated, { sortKeys: false, lineWidth: 120 }));
  return validated;
}

export function appendWatchdogAlerts(dataDir: string, alerts: WatchdogAlertInput[]): WatchdogAlert[] {
  if (alerts.length === 0) return [];
  ensureDataDir(dataDir);
  const validated = alerts.map((a) => WatchdogAlertSchema.parse(a));
  const filePath = safeResolve(dataDir, "alerts_log.jsonl");
  appendPrivateJsonl(
    filePath,
    validated.map((v) => JSON.stringify(v) + "\n"),
  );
  return validated;
}

export function loadWatchdogAlerts(
  dataDir: string,
  opts?: { limit?: number; onlyUnacknowledged?: boolean } | number,
): WatchdogAlert[] {
  const filePath = safeResolve(dataDir, "alerts_log.jsonl");
  if (!fs.existsSync(filePath)) return [];
  const limit = typeof opts === "number" ? opts : (opts?.limit ?? 100);
  const onlyUnack = typeof opts === "object" && opts !== null ? Boolean(opts.onlyUnacknowledged) : false;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const entries: WatchdogAlert[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = WatchdogAlertSchema.parse(JSON.parse(trimmed));
      if (!onlyUnack || !parsed.acknowledged) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed alert line
    }
  }
  return entries.reverse().slice(0, limit);
}

export function ackWatchdogAlerts(
  dataDir: string,
  ids: string | string[],
): { updated: number; alerts: WatchdogAlert[] } {
  const filePath = safeResolve(dataDir, "alerts_log.jsonl");
  if (!fs.existsSync(filePath)) {
    return { updated: 0, alerts: [] };
  }
  const idList = Array.isArray(ids) ? ids : [ids];
  const ackAll = idList.includes("*");
  const idSet = new Set(idList);

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const parsedEntries: WatchdogAlert[] = [];
  let updated = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const item = WatchdogAlertSchema.parse(JSON.parse(trimmed));
      if (!item.acknowledged && (ackAll || idSet.has(item.id))) {
        parsedEntries.push({ ...item, acknowledged: true });
        updated += 1;
      } else {
        parsedEntries.push(item);
      }
    } catch {
      // Drop unparseable lines cleanly on rewrite
    }
  }
  if (updated > 0) {
    ensureDataDir(dataDir);
    atomicWriteFile(filePath, parsedEntries.map((e) => JSON.stringify(e) + "\n").join(""));
  }
  return { updated, alerts: [...parsedEntries].reverse() };
}

export function loadHistoryCache(dataDir: string): HistoryCacheState {
  const filePath = safeResolve(dataDir, "history_cache.json");
  if (!fs.existsSync(filePath)) {
    return { updated_at: null, series: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return HistoryCacheSchema.parse(parsed);
}

export function saveHistoryCache(dataDir: string, state: HistoryCacheState): HistoryCacheState {
  ensureDataDir(dataDir);
  const validated = HistoryCacheSchema.parse(state);
  const filePath = safeResolve(dataDir, "history_cache.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function loadPaPerformance(dataDir: string): PaPerformanceState | null {
  const filePath = safeResolve(dataDir, "pa_performance.json");
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return PaPerformanceSchema.parse(parsed);
}

export function savePaPerformance(dataDir: string, state: PaPerformanceState): PaPerformanceState {
  ensureDataDir(dataDir);
  const validated = PaPerformanceSchema.parse(state);
  const filePath = safeResolve(dataDir, "pa_performance.json");
  atomicWriteFile(filePath, JSON.stringify(validated, null, 2) + "\n");
  return validated;
}

export function appendThesisTestLog(dataDir: string, entry: ThesisTestRecordInput): ThesisTestRecord {
  ensureDataDir(dataDir);
  const validated = ThesisTestRecordSchema.parse(entry);
  const filePath = safeResolve(dataDir, "test_log.jsonl");
  appendPrivateJsonl(filePath, [JSON.stringify(validated) + "\n"]);
  return validated;
}

export function loadThesisTestLog(dataDir: string, ticker?: string, limit = 25): ThesisTestRecord[] {
  const filePath = safeResolve(dataDir, "test_log.jsonl");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const filterSym = ticker ? normalizeTicker(ticker) : null;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const entries: ThesisTestRecord[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = ThesisTestRecordSchema.parse(JSON.parse(trimmed));
      if (!filterSym || parsed.ticker === filterSym) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed line without breaking ledger
    }
  }
  return entries.reverse().slice(0, limit);
}
