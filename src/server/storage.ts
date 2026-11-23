import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  CatalystsFileSchema,
  defaultProfile,
  PortfolioSchema,
  ProfileSchema,
  type CatalystRecord,
  type EtfWeightsConfig,
  type PortfolioRecord,
  type UserProfile,
  normalizeTicker,
} from "./schema.js";

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

export function ensureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const thesesDir = safeResolve(dataDir, "theses");
  fs.mkdirSync(thesesDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dataDir, 0o700);
    fs.chmodSync(thesesDir, 0o700);
  } catch {
    // Ignore on filesystems that do not support POSIX chmod
  }
}

export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmpPath, targetPath);
  try {
    fs.chmodSync(targetPath, 0o600);
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

export function saveProfile(dataDir: string, profile: UserProfile): UserProfile {
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
    ? (JSON.parse(fs.readFileSync(defaultPath, "utf-8")) as EtfWeightsConfig)
    : { etf_weights: {}, etf_metadata: {} };

  const customPath = safeResolve(dataDir, "etf_weights.json");
  if (!fs.existsSync(customPath)) {
    return baseCfg;
  }
  const customCfg = JSON.parse(fs.readFileSync(customPath, "utf-8")) as Partial<EtfWeightsConfig>;
  return {
    as_of: customCfg.as_of ?? baseCfg.as_of,
    note: customCfg.note ?? baseCfg.note,
    etf_weights: { ...baseCfg.etf_weights, ...(customCfg.etf_weights ?? {}) },
    etf_metadata: { ...baseCfg.etf_metadata, ...(customCfg.etf_metadata ?? {}) },
  };
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
