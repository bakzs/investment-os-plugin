import {
  fetchSecSubmissions,
  loadSecTickerMap,
  resolveSecUserAgent,
  SEC_PACING_MS,
  sleepMs,
} from "./edgar.js";
import {
  InsidersSchema,
  normalizeTicker,
  type DossierInsiders,
  type InsiderFilingRow,
  type InsiderWindow,
  type UserProfile,
} from "./schema.js";
import { loadDossierInsiders, saveDossierInsiders } from "./storage.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_XMLS_PER_TICKER = 25;

export interface ParsedForm4Transaction {
  owner_name: string;
  title: string;
  is_director: boolean;
  is_officer: boolean;
  code: string;
  transaction_date: string;
  shares: number;
  price: number | null;
  value_usd: number;
  is_10b5_1: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagText(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(re);
  if (!match) return "";
  const inner = match[1] ?? "";
  // Unwrap nested <value>...</value> if present
  const valMatch = inner.match(/<value\b[^>]*>([\s\S]*?)<\/value>/i);
  const stripped = (valMatch ? valMatch[1] : inner).replace(/<[^>]+>/g, " ");
  return decodeXmlEntities(stripped);
}

function parseBoolTag(raw: string): boolean {
  const norm = raw.trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes";
}

function parseNumberTag(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function parseFootnotes(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<footnote\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/footnote>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const id = (match[1] ?? "").trim();
    const text = decodeXmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " "));
    if (id) map.set(id, text);
  }
  return map;
}

export function parseForm4Xml(xml: string, fallbackFilingDate = ""): ParsedForm4Transaction[] {
  const ownerName =
    extractTagText(xml, "rptOwnerName") ||
    extractTagText(xml, "reportingOwnerName") ||
    "Unknown Reporting Owner";
  const title = extractTagText(xml, "officerTitle");
  const isDirector = parseBoolTag(extractTagText(xml, "isDirector"));
  const isOfficer = parseBoolTag(extractTagText(xml, "isOfficer"));
  const docAff10b5One = parseBoolTag(extractTagText(xml, "aff10b5One"));

  const footnotes = parseFootnotes(xml);
  const anyFootnote10b5 = Array.from(footnotes.values()).some((txt) => /10b5-?1|rule\s+10b5/i.test(txt));
  const hasAnyFootnoteRefsInTx = /<nonDerivativeTransaction\b[\s\S]*?<footnoteId\b/i.test(xml);

  const txMatches = [...xml.matchAll(/<nonDerivativeTransaction\b[^>]*>([\s\S]*?)<\/nonDerivativeTransaction>/gi)];
  const out: ParsedForm4Transaction[] = [];

  for (const match of txMatches) {
    const block = match[1] ?? "";
    const code = extractTagText(block, "transactionCode").toUpperCase();
    if (code !== "P" && code !== "S") continue;

    const rawDate = extractTagText(block, "transactionDate");
    const txDate = isIsoDate(rawDate) ? rawDate : fallbackFilingDate;
    const shares = parseNumberTag(extractTagText(block, "transactionShares")) ?? 0;
    if (shares <= 0) continue;

    const price = parseNumberTag(extractTagText(block, "transactionPricePerShare"));
    const safePrice = price !== null && price >= 0 ? price : null;
    const valueUsd = safePrice !== null ? round2(shares * safePrice) : 0;

    // Determine 10b5-1 plan status from checkbox OR referenced footnotes
    let is10b51 = docAff10b5One;
    if (!is10b51) {
      const refIds = [...block.matchAll(/<footnoteId\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*\/?>/gi)].map((m) =>
        (m[1] ?? "").trim(),
      );
      if (refIds.length > 0) {
        is10b51 = refIds.some((id) => /10b5-?1|rule\s+10b5/i.test(footnotes.get(id) ?? ""));
      } else if (!hasAnyFootnoteRefsInTx && anyFootnote10b5) {
        is10b51 = true;
      }
    }
    if (!is10b51 && /10b5-?1|rule\s+10b5/i.test(block)) {
      is10b51 = true;
    }

    out.push({
      owner_name: ownerName,
      title,
      is_director: isDirector,
      is_officer: isOfficer,
      code,
      transaction_date: txDate,
      shares: round2(shares),
      price: safePrice !== null ? round2(safePrice) : null,
      value_usd: valueUsd,
      is_10b5_1: is10b51,
    });
  }

  return out;
}

function isCSuiteTitle(title: string): boolean {
  return /\b(ceo|chief\s+executive|cfo|chief\s+financial|coo|chief\s+operating|president|chair|founder)\b/i.test(
    title,
  );
}

function computeWindow(rows: InsiderFilingRow[], nowMs: number, days: number): InsiderWindow {
  let discBuy = 0;
  let discSell = 0;
  let planSell = 0;
  const buyers = new Set<string>();
  const sellers = new Set<string>();

  for (const r of rows) {
    const dtMs = Date.parse(`${r.filing_date}T00:00:00Z`);
    if (!Number.isFinite(dtMs)) continue;
    const ageDays = (nowMs - dtMs) / MS_PER_DAY;
    if (ageDays < -2 || ageDays > days) continue;

    const ownerKey = r.owner_name.trim().toUpperCase();
    if (r.code === "P") {
      if (!r.is_10b5_1) {
        discBuy += r.value_usd;
        buyers.add(ownerKey);
      }
    } else if (r.code === "S") {
      if (r.is_10b5_1) {
        planSell += r.value_usd;
      } else {
        discSell += r.value_usd;
        sellers.add(ownerKey);
      }
    }
  }

  return {
    disc_buy_usd: round2(discBuy),
    disc_sell_usd: round2(discSell),
    plan_sell_usd: round2(planSell),
    distinct_buyers: buyers.size,
    distinct_sellers: sellers.size,
  };
}

export function aggregateInsiderFilings(
  ticker: string,
  filings: InsiderFilingRow[],
  opts?: {
    cik?: string | null;
    nowIso?: string;
    cachedAccessions?: string[];
  },
): DossierInsiders {
  const sym = normalizeTicker(ticker);
  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();

  // Keep only last 12 months (+ small buffer), newest first
  const recent = filings
    .filter((f) => {
      const ms = Date.parse(`${f.filing_date}T00:00:00Z`);
      return Number.isFinite(ms) && (nowMs - ms) / MS_PER_DAY <= 370;
    })
    .sort((a, b) => b.filing_date.localeCompare(a.filing_date))
    .slice(0, 100);

  const window90d = computeWindow(recent, nowMs, 90);
  const window12m = computeWindow(recent, nowMs, 365);

  const flags: string[] = [];
  const recent90 = recent.filter((r) => {
    const ms = Date.parse(`${r.filing_date}T00:00:00Z`);
    return Number.isFinite(ms) && (nowMs - ms) / MS_PER_DAY <= 90;
  });

  const cSuiteBuy90 = recent90.filter(
    (r) => r.code === "P" && !r.is_10b5_1 && isCSuiteTitle(r.title),
  );
  const cSuiteBuyUsd = cSuiteBuy90.reduce((sum, r) => sum + r.value_usd, 0);

  if (window90d.distinct_buyers >= 2) {
    flags.push(
      `DISCRETIONARY_BUY_CLUSTER: ${window90d.distinct_buyers} insiders bought $${Math.round(window90d.disc_buy_usd).toLocaleString("en-US")} (90D)`,
    );
  }
  if (cSuiteBuyUsd >= 250_000) {
    flags.push(
      `C_SUITE_DISCRETIONARY_BUY: $${Math.round(cSuiteBuyUsd).toLocaleString("en-US")} open-market buy by senior executive (90D)`,
    );
  }
  if (
    window90d.disc_sell_usd >= 5_000_000 ||
    (window90d.distinct_sellers >= 2 && window90d.disc_sell_usd >= 1_000_000)
  ) {
    flags.push(
      `HEAVY_DISCRETIONARY_SELLING: ${window90d.distinct_sellers} insider(s) sold $${Math.round(window90d.disc_sell_usd).toLocaleString("en-US")} outside 10b5-1 (90D)`,
    );
  }
  const has13d = recent.some((r) => r.code === "13D" || r.form.toUpperCase().startsWith("SC 13D"));
  if (has13d) {
    flags.push("ACTIVIST_13D_FILING: Schedule 13D / 13D/A filed within 12M");
  }

  const cachedAccns = Array.from(
    new Set([...(opts?.cachedAccessions ?? []), ...recent.map((r) => r.accession)]),
  ).slice(0, 100);

  return InsidersSchema.parse({
    ticker: sym,
    cik: opts?.cik ?? null,
    updated_at: nowIso,
    cached_accessions: cachedAccns,
    window_90d: window90d,
    window_12m: window12m,
    flags,
    recent_filings: recent,
  });
}

export interface SyncInsidersOptions {
  force?: boolean;
  maxXmlsPerTicker?: number;
  nowIso?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncInsidersResult {
  updated: string[];
  cached: string[];
  skipped: string[];
  errors: Array<{ ticker: string; error: string }>;
  byTicker: Record<string, DossierInsiders>;
}

export async function syncInsidersForm4(
  dataDir: string,
  profile: UserProfile,
  tickers: string[],
  opts?: SyncInsidersOptions,
): Promise<SyncInsidersResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const maxXmls = Math.max(1, opts?.maxXmlsPerTicker ?? DEFAULT_MAX_XMLS_PER_TICKER);
  const ua = resolveSecUserAgent(profile);
  const tickerMap = await loadSecTickerMap(dataDir, ua, fetchImpl);

  const updated: string[] = [];
  const cached: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];
  const byTicker: Record<string, DossierInsiders> = {};

  const uniqueTargets = Array.from(new Set(tickers.map((t) => normalizeTicker(t))));
  let secReqCount = 0;

  for (const sym of uniqueTargets) {
    const cik = tickerMap.get(sym);
    if (!cik) {
      skipped.push(sym);
      continue;
    }

    let existing: DossierInsiders | null = null;
    try {
      existing = loadDossierInsiders(dataDir, sym);
    } catch {
      existing = null;
    }

    const cachedAccnSet = new Set<string>(opts?.force ? [] : (existing?.cached_accessions ?? []));
    const existingRowsByAccn = new Map<string, InsiderFilingRow[]>();
    if (!opts?.force && existing) {
      for (const row of existing.recent_filings) {
        const list = existingRowsByAccn.get(row.accession) ?? [];
        list.push(row);
        existingRowsByAccn.set(row.accession, list);
      }
    }

    try {
      if (secReqCount > 0) await sleepMs(SEC_PACING_MS);
      secReqCount += 1;
      const submissions = await fetchSecSubmissions(cik, ua, fetchImpl);
      const recent = submissions.filings?.recent;
      if (!recent?.form || !recent.filingDate || !recent.accessionNumber || !recent.primaryDocument) {
        const emptyAgg = aggregateInsiderFilings(sym, [], { cik, nowIso });
        byTicker[sym] = saveDossierInsiders(dataDir, sym, emptyAgg);
        updated.push(sym);
        continue;
      }

      const cikInt = String(Number(cik));
      const allRows: InsiderFilingRow[] = [];
      const seenAccns: string[] = [];
      let form4Candidates = 0;
      let fetchedXmls = 0;

      for (let i = 0; i < recent.form.length; i += 1) {
        const form = (recent.form[i] ?? "").trim();
        const formUpper = form.toUpperCase();
        const filingDate = recent.filingDate[i] ?? "";
        if (!isIsoDate(filingDate)) continue;
        const ageDays = (nowMs - Date.parse(`${filingDate}T00:00:00Z`)) / MS_PER_DAY;
        if (ageDays > 366) break; // submissions are newest-first

        const accn = recent.accessionNumber[i] ?? "";
        const accnNoDash = accn.replace(/-/g, "");
        const doc = recent.primaryDocument[i] ?? "";
        if (!accn || !doc) continue;

        if (formUpper === "SC 13D" || formUpper === "SC 13D/A") {
          seenAccns.push(accn);
          allRows.push({
            filing_date: filingDate,
            accession: accn,
            form: formUpper,
            owner_name: "Schedule 13D Beneficial Owner",
            title: "5%+ / Activist Holder",
            is_director: false,
            code: "13D",
            shares: 0,
            price: null,
            value_usd: 0,
            is_10b5_1: false,
            url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accnNoDash}/${doc}`,
          });
          continue;
        }

        if (formUpper !== "4" && formUpper !== "4/A") continue;
        if (form4Candidates >= maxXmls) continue;
        form4Candidates += 1;
        seenAccns.push(accn);

        if (cachedAccnSet.has(accn)) {
          const prevRows = existingRowsByAccn.get(accn);
          if (prevRows) allRows.push(...prevRows);
          continue;
        }

        // Strip SEC XSLT render prefix (e.g. xslF345X05/form4.xml -> form4.xml) to fetch raw XML
        const rawXmlDoc = doc.replace(/^xsl[^/]+\//i, "");
        const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accnNoDash}/${rawXmlDoc}`;
        const viewUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accnNoDash}/${doc}`;

        if (secReqCount > 0) await sleepMs(SEC_PACING_MS);
        secReqCount += 1;
        fetchedXmls += 1;

        try {
          const resp = await fetchImpl(xmlUrl, {
            headers: { "User-Agent": ua, Accept: "application/xml, text/xml, */*" },
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) continue;
          const xmlText = await resp.text();
          const txs = parseForm4Xml(xmlText, filingDate);
          for (const tx of txs) {
            allRows.push({
              filing_date: tx.transaction_date || filingDate,
              accession: accn,
              form: formUpper,
              owner_name: tx.owner_name,
              title: tx.title,
              is_director: tx.is_director,
              code: tx.code,
              shares: tx.shares,
              price: tx.price,
              value_usd: tx.value_usd,
              is_10b5_1: tx.is_10b5_1,
              url: viewUrl,
            });
          }
        } catch {
          // Skip individual malformed/timeout Form 4 XML cleanly
        }
      }

      const aggregated = aggregateInsiderFilings(sym, allRows, {
        cik,
        nowIso,
        cachedAccessions: seenAccns,
      });
      const saved = saveDossierInsiders(dataDir, sym, aggregated);
      byTicker[sym] = saved;
      if (fetchedXmls === 0 && existing) {
        cached.push(sym);
      } else {
        updated.push(sym);
      }
    } catch (err) {
      errors.push({ ticker: sym, error: err instanceof Error ? err.message : String(err) });
      if (existing) {
        byTicker[sym] = existing;
      }
    }
  }

  return { updated, cached, skipped, errors, byTicker };
}
