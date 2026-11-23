import fs from "node:fs";
import {
  atomicWriteFile,
  loadEdgarCache,
  safeResolve,
  saveEdgarCache,
  type EdgarCacheState,
  type EdgarFilingRow,
  type SecGateEvaluation,
} from "./storage.js";
import { normalizeTicker, type CatalystRecord, type UserProfile } from "./schema.js";

const DEFAULT_USER_AGENT = "InvestmentOS-Plugin/0.2.0 (https://github.com/bakzs/investment-os-plugin)";
const IMPORTANT_FORMS = new Set([
  "10-K",
  "10-Q",
  "8-K",
  "20-F",
  "6-K",
  "DEF 14A",
  "S-1",
  "S-3",
  "424B5",
  "SC 13D",
  "SC 13G",
]);

const TICKERS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export function resolveSecUserAgent(profile: UserProfile, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SEC_USER_AGENT?.trim();
  if (fromEnv) return fromEnv;
  if (profile.edgar_user_agent?.trim()) return profile.edgar_user_agent.trim();
  return DEFAULT_USER_AGENT;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadSecTickerMap(dataDir: string, userAgent: string): Promise<Map<string, string>> {
  const cachePath = safeResolve(dataDir, "sec_tickers_cache.json");
  let entries: Record<string, SecTickerEntry> | null = null;

  if (fs.existsSync(cachePath)) {
    try {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs < TICKERS_CACHE_MAX_AGE_MS) {
        entries = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, SecTickerEntry>;
      }
    } catch {
      entries = null;
    }
  }

  if (!entries) {
    const resp = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      if (fs.existsSync(cachePath)) {
        entries = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Record<string, SecTickerEntry>;
      } else {
        throw new Error(`SEC company_tickers fetch failed with HTTP ${resp.status}`);
      }
    } else {
      entries = (await resp.json()) as Record<string, SecTickerEntry>;
      atomicWriteFile(cachePath, JSON.stringify(entries));
    }
  }

  const map = new Map<string, string>();
  for (const row of Object.values(entries)) {
    if (!row?.ticker || !row?.cik_str) continue;
    const norm = row.ticker.trim().toUpperCase();
    const padded = String(row.cik_str).padStart(10, "0");
    map.set(norm, padded);
    map.set(norm.replace(/-/g, "."), padded);
    map.set(norm.replace(/\./g, "-"), padded);
  }
  return map;
}

export async function fetchRecentFilings(
  cikPadded: string,
  userAgent: string,
  limit = 6,
): Promise<EdgarFilingRow[]> {
  const url = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
  const resp = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`SEC submissions fetch failed (${resp.status}) for CIK ${cikPadded}`);
  }
  const payload = (await resp.json()) as {
    filings?: {
      recent?: {
        form?: string[];
        filingDate?: string[];
        accessionNumber?: string[];
        primaryDocument?: string[];
        items?: Array<string | string[]>;
      };
    };
  };

  const recent = payload.filings?.recent;
  if (!recent?.form || !recent.filingDate || !recent.accessionNumber || !recent.primaryDocument) {
    return [];
  }

  const cikInt = String(Number(cikPadded));
  const out: EdgarFilingRow[] = [];
  for (let i = 0; i < recent.form.length; i += 1) {
    const form = recent.form[i] ?? "";
    if (!IMPORTANT_FORMS.has(form)) continue;
    const acc = recent.accessionNumber[i] ?? "";
    const accNoDash = acc.replace(/-/g, "");
    const doc = recent.primaryDocument[i] ?? "";
    const rawItems = recent.items?.[i];
    const items = Array.isArray(rawItems) ? rawItems.join(",") : String(rawItems ?? "");
    out.push({
      form,
      filingDate: recent.filingDate[i] ?? "",
      accession: acc,
      items,
      url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${doc}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function evaluateSecGates(
  catalysts: CatalystRecord[],
  filingsByTicker: Record<string, EdgarFilingRow[]>,
): SecGateEvaluation[] {
  const evals: SecGateEvaluation[] = [];
  for (const cat of catalysts) {
    if (!cat.sec_gate) continue;
    const rows = filingsByTicker[cat.ticker] ?? [];
    const targetForm = cat.sec_gate.form.toUpperCase();
    const match = rows.find(
      (r) => r.form.toUpperCase() === targetForm && r.filingDate > cat.sec_gate!.filed_after,
    );
    evals.push({
      ticker: cat.ticker,
      form: cat.sec_gate.form,
      filed_after: cat.sec_gate.filed_after,
      description: cat.sec_gate.description,
      cleared: Boolean(match),
      latest_matching_date: match?.filingDate,
      latest_matching_url: match?.url,
    });
  }
  return evals;
}

export async function pollEdgarFilings(
  dataDir: string,
  profile: UserProfile,
  tickers: string[],
  catalysts: CatalystRecord[],
  nowIso: string,
): Promise<{ cache: EdgarCacheState; skippedTickers: string[] }> {
  const ua = resolveSecUserAgent(profile);
  const tickerMap = await loadSecTickerMap(dataDir, ua);
  const existing = loadEdgarCache(dataDir);
  const filingsByTicker: Record<string, EdgarFilingRow[]> = { ...existing.filings_by_ticker };
  const skippedTickers: string[] = [];

  const uniqueTargets = Array.from(new Set(tickers.map((t) => normalizeTicker(t))));
  for (let i = 0; i < uniqueTargets.length; i += 1) {
    const sym = uniqueTargets[i];
    if (!sym) continue;
    const cik = tickerMap.get(sym);
    if (!cik) {
      skippedTickers.push(sym);
      continue;
    }
    if (i > 0) await sleep(150);
    const hasGate = catalysts.some((c) => c.ticker === sym && c.sec_gate);
    const rows = await fetchRecentFilings(cik, ua, hasGate ? 12 : 5);
    filingsByTicker[sym] = rows.slice(0, 5);
  }

  const cache: EdgarCacheState = {
    checked_at: nowIso,
    gate_evaluations: evaluateSecGates(catalysts, filingsByTicker),
    filings_by_ticker: filingsByTicker,
  };
  saveEdgarCache(dataDir, cache);
  return { cache, skippedTickers };
}
