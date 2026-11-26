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

export const DEFAULT_SEC_USER_AGENT = "InvestmentOS-Plugin/0.6.0 (contact@investment-os.local)";
export const SEC_PACING_MS = 150;

export const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"]);

export const EVENT_FORMS = new Set([
  "8-K",
  "8-K/A",
  "6-K",
  "NT 10-Q",
  "NT 10-K",
  "424B4",
  "424B5",
  "S-1",
  "S-3",
  "DEF 14A",
  "SC 13D",
  "SC 13D/A",
  "SC 13G",
  "SC 13G/A",
]);

export const IMPORTANT_FORMS = new Set<string>([...PERIODIC_FORMS, ...EVENT_FORMS]);

const TICKERS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export interface SecSubmissionsRecent {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  items?: Array<string | string[]>;
}

export interface SecSubmissionsPayload {
  cik?: string;
  name?: string;
  filings?: {
    recent?: SecSubmissionsRecent;
  };
}

export interface SecRedFlag {
  ticker: string;
  form: string;
  filingDate: string;
  accession: string;
  code: string;
  severity: "high" | "medium" | "info";
  label: string;
  items?: string;
  url: string;
}

const EIGHT_K_RED_FLAG_ITEMS: Record<string, { severity: "high" | "medium" | "info"; label: string }> = {
  "1.03": { severity: "high", label: "Bankruptcy or Receivership Filing (Item 1.03)" },
  "2.06": { severity: "high", label: "Material Impairment Charges (Item 2.06)" },
  "3.01": { severity: "high", label: "Notice of Delisting or Listing Non-Compliance (Item 3.01)" },
  "4.01": { severity: "high", label: "Change in Registrant's Certifying Accountant (Item 4.01)" },
  "4.02": { severity: "high", label: "Non-Reliance on Prior Financial Statements / Restatement (Item 4.02)" },
  "1.02": { severity: "medium", label: "Termination of a Material Definitive Agreement (Item 1.02)" },
  "3.02": { severity: "medium", label: "Unregistered Sales of Equity Securities / Dilution (Item 3.02)" },
  "5.02": { severity: "info", label: "Director / Officer Appointment, Departure, or Comp Update (Item 5.02)" },
};

export function resolveSecUserAgent(profile: UserProfile, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SEC_USER_AGENT?.trim();
  if (fromEnv) return fromEnv;
  if (profile.edgar_user_agent?.trim()) return profile.edgar_user_agent.trim();
  return DEFAULT_SEC_USER_AGENT;
}

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadSecTickerMap(
  dataDir: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, string>> {
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
    const resp = await fetchImpl("https://www.sec.gov/files/company_tickers.json", {
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

export async function fetchSecSubmissions(
  cikPadded: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SecSubmissionsPayload> {
  const url = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
  const resp = await fetchImpl(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`SEC submissions fetch failed (${resp.status}) for CIK ${cikPadded}`);
  }
  return (await resp.json()) as SecSubmissionsPayload;
}

export function extractFilingsFromSubmissions(
  payload: SecSubmissionsPayload,
  cikPadded: string,
  opts?: { maxPeriodic?: number; maxEvent?: number },
): EdgarFilingRow[] {
  const recent = payload.filings?.recent;
  if (!recent?.form || !recent.filingDate || !recent.accessionNumber || !recent.primaryDocument) {
    return [];
  }

  const maxPeriodic = Math.max(1, opts?.maxPeriodic ?? 4);
  const maxEvent = Math.max(1, opts?.maxEvent ?? 10);
  const cikInt = String(Number(cikPadded));

  const periodic: Array<{ idx: number; row: EdgarFilingRow }> = [];
  const events: Array<{ idx: number; row: EdgarFilingRow }> = [];

  for (let i = 0; i < recent.form.length; i += 1) {
    const form = (recent.form[i] ?? "").trim();
    const upper = form.toUpperCase();
    const isPeriodic = PERIODIC_FORMS.has(upper);
    const isEvent = !isPeriodic && EVENT_FORMS.has(upper);
    if (!isPeriodic && !isEvent) continue;

    if (isPeriodic && periodic.length >= maxPeriodic) {
      if (events.length >= maxEvent) break;
      continue;
    }
    if (isEvent && events.length >= maxEvent) {
      if (periodic.length >= maxPeriodic) break;
      continue;
    }

    const acc = recent.accessionNumber[i] ?? "";
    const accNoDash = acc.replace(/-/g, "");
    const doc = recent.primaryDocument[i] ?? "";
    const rawItems = recent.items?.[i];
    const items = Array.isArray(rawItems) ? rawItems.join(",") : String(rawItems ?? "");
    const row: EdgarFilingRow = {
      form,
      filingDate: recent.filingDate[i] ?? "",
      accession: acc,
      items,
      url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${doc}`,
    };

    if (isPeriodic) {
      periodic.push({ idx: i, row });
    } else {
      events.push({ idx: i, row });
    }

    if (periodic.length >= maxPeriodic && events.length >= maxEvent) {
      break;
    }
  }

  return [...periodic, ...events]
    .sort((a, b) => {
      const dateCmp = b.row.filingDate.localeCompare(a.row.filingDate);
      if (dateCmp !== 0) return dateCmp;
      return a.idx - b.idx;
    })
    .map((entry) => entry.row);
}

export async function fetchRecentFilings(
  cikPadded: string,
  userAgent: string,
  opts?: number | { maxPeriodic?: number; maxEvent?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<EdgarFilingRow[]> {
  const payload = await fetchSecSubmissions(cikPadded, userAgent, fetchImpl);
  const resolvedOpts =
    typeof opts === "number"
      ? { maxPeriodic: 4, maxEvent: Math.max(10, opts) }
      : { maxPeriodic: opts?.maxPeriodic ?? 4, maxEvent: opts?.maxEvent ?? 10 };
  return extractFilingsFromSubmissions(payload, cikPadded, resolvedOpts);
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

export function extractSecRedFlags(filingsByTicker: Record<string, EdgarFilingRow[]>): SecRedFlag[] {
  const flags: SecRedFlag[] = [];
  for (const [ticker, rows] of Object.entries(filingsByTicker)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const formUpper = (row.form ?? "").trim().toUpperCase();
      if (formUpper === "NT 10-Q" || formUpper === "NT 10-K") {
        flags.push({
          ticker,
          form: row.form,
          filingDate: row.filingDate,
          accession: row.accession,
          code: formUpper,
          severity: "high",
          label:
            formUpper === "NT 10-Q"
              ? "Late Quarterly Filing Notice (NT 10-Q)"
              : "Late Annual Filing Notice (NT 10-K)",
          items: row.items || undefined,
          url: row.url,
        });
        continue;
      }

      if (formUpper === "8-K" || formUpper === "8-K/A") {
        const rawItems = (row.items ?? "").trim();
        if (!rawItems) continue;
        const tokens = Array.from(
          new Set(
            rawItems
              .split(/[,;\s]+/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        );
        for (const itemCode of tokens) {
          const spec = EIGHT_K_RED_FLAG_ITEMS[itemCode];
          if (!spec) continue;
          flags.push({
            ticker,
            form: row.form,
            filingDate: row.filingDate,
            accession: row.accession,
            code: `8-K:${itemCode}`,
            severity: spec.severity,
            label: spec.label,
            items: rawItems,
            url: row.url,
          });
        }
      }
    }
  }

  const sevRank = (s: SecRedFlag["severity"]): number => (s === "high" ? 0 : s === "medium" ? 1 : 2);
  return flags.sort((a, b) => {
    const dateCmp = b.filingDate.localeCompare(a.filingDate);
    if (dateCmp !== 0) return dateCmp;
    if (a.severity !== b.severity) return sevRank(a.severity) - sevRank(b.severity);
    return a.ticker.localeCompare(b.ticker);
  });
}

export async function pollEdgarFilings(
  dataDir: string,
  profile: UserProfile,
  tickers: string[],
  catalysts: CatalystRecord[],
  nowIso: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ cache: EdgarCacheState; skippedTickers: string[]; redFlags: SecRedFlag[] }> {
  const ua = resolveSecUserAgent(profile);
  const tickerMap = await loadSecTickerMap(dataDir, ua, fetchImpl);
  const existing = loadEdgarCache(dataDir);
  const filingsByTicker: Record<string, EdgarFilingRow[]> = { ...existing.filings_by_ticker };
  const skippedTickers: string[] = [];

  const uniqueTargets = Array.from(new Set(tickers.map((t) => normalizeTicker(t))));
  let fetchCount = 0;
  for (const sym of uniqueTargets) {
    if (!sym) continue;
    const cik = tickerMap.get(sym);
    if (!cik) {
      skippedTickers.push(sym);
      continue;
    }
    if (fetchCount > 0) await sleepMs(SEC_PACING_MS);
    fetchCount += 1;
    const rows = await fetchRecentFilings(cik, ua, { maxPeriodic: 4, maxEvent: 10 }, fetchImpl);
    filingsByTicker[sym] = rows;
  }

  const cache: EdgarCacheState = {
    checked_at: nowIso,
    gate_evaluations: evaluateSecGates(catalysts, filingsByTicker),
    filings_by_ticker: filingsByTicker,
  };
  saveEdgarCache(dataDir, cache);
  return { cache, skippedTickers, redFlags: extractSecRedFlags(filingsByTicker) };
}
