import { loadHistoryCache, saveHistoryCache } from "./storage.js";
import {
  MacroRegimeSchema,
  type HistoryCacheState,
  type HistoryPoint,
  type MacroRegime,
  type MacroRegimeLabel,
} from "./schema.js";

export interface QuoteResult {
  symbol: string;
  price: number;
  regular_price: number;
  extended_price: number | null;
  market_state: string;
  marketState?: string;
  quote_time: string | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  currency: string;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
}

export interface HistoryFetchResult {
  symbol: string;
  currency: string;
  points: HistoryPoint[];
}

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; InvestmentOS-Plugin/0.6.0)",
  Accept: "application/json",
};

export const YAHOO_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
export const IBKR_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface YahooTradingPeriod {
  start?: number;
  end?: number;
}

interface YahooChartMeta {
  regularMarketPrice?: number;
  preMarketPrice?: number;
  postMarketPrice?: number;
  regularMarketTime?: number;
  preMarketTime?: number;
  postMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  marketState?: string;
  currentTradingPeriod?: {
    pre?: YahooTradingPeriod;
    regular?: YahooTradingPeriod;
    post?: YahooTradingPeriod;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
      timestamp?: number[];
      indicators?: {
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

function inferMarketState(meta: YahooChartMeta, nowSec: number): string {
  const explicit = meta.marketState?.trim().toUpperCase();
  if (explicit) return explicit;
  const tp = meta.currentTradingPeriod;
  if (tp?.regular?.start && tp?.regular?.end && nowSec >= tp.regular.start && nowSec <= tp.regular.end) {
    return "REGULAR";
  }
  if (tp?.pre?.start && tp?.pre?.end && nowSec >= tp.pre.start && nowSec <= tp.pre.end) {
    return "PRE";
  }
  if (tp?.post?.start && tp?.post?.end && nowSec >= tp.post.start && nowSec <= tp.post.end) {
    return "POST";
  }
  return "CLOSED";
}

async function fetchIntradayExtendedQuote(
  symbol: string,
  scale: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ extendedPrice: number | null; quoteTime: string | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  try {
    const resp = await fetchImpl(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(Math.min(timeoutMs, 3500)),
    });
    if (!resp.ok) return { extendedPrice: null, quoteTime: null };
    const data = (await resp.json()) as YahooChartResponse;
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return { extendedPrice: null, quoteTime: null };

    if (typeof meta.postMarketPrice === "number" && Number.isFinite(meta.postMarketPrice) && meta.postMarketPrice > 0) {
      return {
        extendedPrice: round4(meta.postMarketPrice * scale),
        quoteTime:
          typeof meta.postMarketTime === "number" && Number.isFinite(meta.postMarketTime)
            ? new Date(meta.postMarketTime * 1000).toISOString()
            : null,
      };
    }
    if (typeof meta.preMarketPrice === "number" && Number.isFinite(meta.preMarketPrice) && meta.preMarketPrice > 0) {
      return {
        extendedPrice: round4(meta.preMarketPrice * scale),
        quoteTime:
          typeof meta.preMarketTime === "number" && Number.isFinite(meta.preMarketTime)
            ? new Date(meta.preMarketTime * 1000).toISOString()
            : null,
      };
    }

    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const regStart = meta.currentTradingPeriod?.regular?.start;
    const regEnd = meta.currentTradingPeriod?.regular?.end;
    for (let i = timestamps.length - 1; i >= 0; i -= 1) {
      const ts = timestamps[i];
      const px = closes[i];
      if (typeof ts !== "number" || typeof px !== "number" || !Number.isFinite(px) || px <= 0) continue;
      const isExtended =
        (typeof regEnd === "number" && ts > regEnd) || (typeof regStart === "number" && ts < regStart);
      if (isExtended) {
        return {
          extendedPrice: round4(px * scale),
          quoteTime: new Date(ts * 1000).toISOString(),
        };
      }
      break;
    }
    return { extendedPrice: null, quoteTime: null };
  } catch {
    return { extendedPrice: null, quoteTime: null };
  }
}

export async function fetchYahooChartQuote(
  symbol: string,
  timeoutMs = 7000,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo&includePrePost=true`;
  try {
    const resp = await fetchImpl(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as YahooChartResponse;
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;

    let price = meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    let scale = 1.0;
    let currency = (meta.currency ?? "USD").trim();
    if (currency === "GBp" || currency === "GBX") {
      scale = 0.01;
      price = round4(price * scale);
      currency = "GBP";
    } else {
      currency = currency.toUpperCase();
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      currency = "USD";
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const marketState = inferMarketState(meta, nowSec);

    let extendedPrice: number | null = null;
    let quoteTimeSec: number | undefined = meta.regularMarketTime;

    if (
      (marketState === "POST" || marketState === "POSTPOST" || marketState === "CLOSED") &&
      typeof meta.postMarketPrice === "number" &&
      Number.isFinite(meta.postMarketPrice) &&
      meta.postMarketPrice > 0
    ) {
      extendedPrice = round4(meta.postMarketPrice * scale);
      quoteTimeSec = meta.postMarketTime ?? quoteTimeSec;
    } else if (
      (marketState === "PRE" || marketState === "PREPRE") &&
      typeof meta.preMarketPrice === "number" &&
      Number.isFinite(meta.preMarketPrice) &&
      meta.preMarketPrice > 0
    ) {
      extendedPrice = round4(meta.preMarketPrice * scale);
      quoteTimeSec = meta.preMarketTime ?? quoteTimeSec;
    } else if (typeof meta.postMarketPrice === "number" && Number.isFinite(meta.postMarketPrice) && meta.postMarketPrice > 0) {
      extendedPrice = round4(meta.postMarketPrice * scale);
      quoteTimeSec = meta.postMarketTime ?? quoteTimeSec;
    } else if (typeof meta.preMarketPrice === "number" && Number.isFinite(meta.preMarketPrice) && meta.preMarketPrice > 0) {
      extendedPrice = round4(meta.preMarketPrice * scale);
      quoteTimeSec = meta.preMarketTime ?? quoteTimeSec;
    }

    let quoteTime =
      typeof quoteTimeSec === "number" && Number.isFinite(quoteTimeSec) && quoteTimeSec > 0
        ? new Date(quoteTimeSec * 1000).toISOString()
        : null;

    const isEquityLike = !symbol.startsWith("^") && !symbol.endsWith("=X");
    if (extendedPrice === null && isEquityLike && (marketState === "PRE" || marketState === "POST")) {
      const intraday = await fetchIntradayExtendedQuote(symbol, scale, timeoutMs, fetchImpl);
      if (intraday.extendedPrice !== null) {
        extendedPrice = intraday.extendedPrice;
        if (intraday.quoteTime) quoteTime = intraday.quoteTime;
      }
    }

    const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
    const sparkline = rawCloses
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
      .map((v) => round4(v * scale))
      .slice(-22);

    let prevClose: number | null = null;
    if (sparkline.length >= 2) {
      const lastPt = sparkline[sparkline.length - 1];
      const sameAsLast = Math.abs(price - lastPt) / price < 0.0005;
      prevClose = sameAsLast ? sparkline[sparkline.length - 2] : lastPt;
    } else if (typeof meta.previousClose === "number" && meta.previousClose > 0) {
      prevClose = meta.previousClose * scale;
    }

    const anchor1mRaw =
      typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
        ? meta.chartPreviousClose * scale
        : sparkline[0];

    const change1d = prevClose && prevClose > 0 ? round2(((price - prevClose) / prevClose) * 100) : null;
    const change1m = anchor1mRaw && anchor1mRaw > 0 ? round2(((price - anchor1mRaw) / anchor1mRaw) * 100) : null;

    const high52w =
      typeof meta.fiftyTwoWeekHigh === "number" && Number.isFinite(meta.fiftyTwoWeekHigh) && meta.fiftyTwoWeekHigh > 0
        ? round4(meta.fiftyTwoWeekHigh * scale)
        : null;
    const low52w =
      typeof meta.fiftyTwoWeekLow === "number" && Number.isFinite(meta.fiftyTwoWeekLow) && meta.fiftyTwoWeekLow > 0
        ? round4(meta.fiftyTwoWeekLow * scale)
        : null;

    return {
      symbol,
      price,
      regular_price: price,
      extended_price: extendedPrice,
      market_state: marketState,
      marketState,
      quote_time: quoteTime,
      fifty_two_week_high: high52w,
      fifty_two_week_low: low52w,
      currency,
      sparkline,
      change_1d_pct: change1d,
      change_1m_pct: change1m,
    };
  } catch {
    return null;
  }
}

export async function fetchQuotesBatch(
  symbols: string[],
  concurrency = 4,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, QuoteResult>> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  const out = new Map<string, QuoteResult>();
  let idx = 0;

  async function worker() {
    while (idx < unique.length) {
      const current = unique[idx];
      idx += 1;
      if (!current) continue;
      const res = await fetchYahooChartQuote(current, 7000, fetchImpl);
      if (res) {
        out.set(current, res);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, unique.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

export async function fetchFxRatesToBase(
  currencies: string[],
  baseCurrency: string,
  fallbackRates: Record<string, number>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number>> {
  const base = baseCurrency.toUpperCase();
  const out: Record<string, number> = { ...fallbackRates, [base]: 1.0 };
  const needed = Array.from(new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c !== base)));

  for (const ccy of needed) {
    const directSym = ccy === "USD" ? `${base}=X` : `${ccy}${base}=X`;
    const direct = await fetchYahooChartQuote(directSym, 7000, fetchImpl);
    if (direct && direct.price > 0) {
      out[ccy] = direct.price;
      continue;
    }
    const inverseSym = `${base}${ccy}=X`;
    const inverse = await fetchYahooChartQuote(inverseSym, 7000, fetchImpl);
    if (inverse && inverse.price > 0) {
      out[ccy] = 1.0 / inverse.price;
    }
  }

  return out;
}

export function classifyMacroRegime(vix: number | null, hyCreditRatio: number | null): MacroRegimeLabel {
  if (vix !== null && (vix >= 35 || (vix >= 28 && hyCreditRatio !== null && hyCreditRatio < 0.78))) {
    return "STRESS";
  }
  if (vix !== null && vix >= 28) {
    return "HIGH_VOL";
  }
  if (vix !== null && vix >= 20) {
    return "ELEVATED";
  }
  return "CALM";
}

export async function fetchMacroRegime(opts?: {
  nowIso?: string;
  fetchImpl?: typeof fetch;
}): Promise<MacroRegime> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const quotes = await fetchQuotesBatch(["^VIX", "^TNX", "^IRX", "HYG", "IEF", "DX-Y.NYB"], 6, fetchImpl);

  const vixRaw = quotes.get("^VIX")?.price ?? null;
  const tnxRaw = quotes.get("^TNX")?.price ?? null;
  const irxRaw = quotes.get("^IRX")?.price ?? null;
  const hygRaw = quotes.get("HYG")?.price ?? null;
  const iefRaw = quotes.get("IEF")?.price ?? null;
  const dxyRaw = quotes.get("DX-Y.NYB")?.price ?? null;

  const normalizeYield = (val: number | null): number | null => {
    if (val === null || !Number.isFinite(val)) return null;
    // Yahoo ^TNX / ^IRX are quoted in percentage points (e.g., 4.25), but guard against x10 scaling
    return round2(val > 25 ? val / 10 : val);
  };

  const vix = vixRaw !== null ? round2(vixRaw) : null;
  const us10yPct = normalizeYield(tnxRaw);
  const us3mPct = normalizeYield(irxRaw);
  const hyCreditRatio = hygRaw !== null && iefRaw !== null && iefRaw > 0 ? round4(hygRaw / iefRaw) : null;
  const dxy = dxyRaw !== null ? round2(dxyRaw) : null;
  const regimeLabel = classifyMacroRegime(vix, hyCreditRatio);

  const noteParts: string[] = [];
  if (us10yPct !== null && us3mPct !== null) {
    const slopeBps = Math.round((us10yPct - us3mPct) * 100);
    noteParts.push(`10Y-3M slope ${slopeBps >= 0 ? "+" : ""}${slopeBps} bps`);
  }
  if (vix !== null && vix >= 28) {
    noteParts.push("High volatility regime — stage tranches 2-3 weeks apart");
  }

  return MacroRegimeSchema.parse({
    updated_at: nowIso,
    vix,
    us10y_pct: us10yPct,
    us3m_pct: us3mPct,
    hy_credit_ratio: hyCreditRatio,
    dxy,
    regime_label: regimeLabel,
    notes: noteParts.length > 0 ? noteParts.join("; ") : null,
  });
}

export async function fetchYahooHistory(
  symbol: string,
  range = "5y",
  interval = "1wk",
  timeoutMs = 9000,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryFetchResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  try {
    const resp = await fetchImpl(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as YahooChartResponse;
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp ?? [];
    const adjCloses = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
    if (timestamps.length === 0) return null;

    let scale = 1.0;
    let currency = (result.meta?.currency ?? "USD").trim();
    if (currency === "GBp" || currency === "GBX") {
      scale = 0.01;
      currency = "GBP";
    } else {
      currency = currency.toUpperCase();
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      currency = "USD";
    }

    const byDate = new Map<string, number>();
    for (let i = 0; i < timestamps.length; i += 1) {
      const ts = timestamps[i];
      if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
      const adj = adjCloses[i];
      const raw = rawCloses[i];
      const val =
        typeof adj === "number" && Number.isFinite(adj) && adj > 0
          ? adj
          : typeof raw === "number" && Number.isFinite(raw) && raw > 0
            ? raw
            : null;
      if (val === null) continue;
      const dateStr = new Date(ts * 1000).toISOString().slice(0, 10);
      byDate.set(dateStr, round4(val * scale));
    }

    const points: HistoryPoint[] = Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, close }));

    if (points.length < 2) return null;
    return { symbol, currency, points };
  } catch {
    return null;
  }
}

export async function fetchYahooDailyBenchmark(
  symbol: string,
  range = "1y",
  timeoutMs = 9000,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoryFetchResult | null> {
  return fetchYahooHistory(symbol, range, "1d", timeoutMs, fetchImpl);
}

export function fxHistorySymbolToUsd(currency: string): string | null {
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy) || ccy === "USD") return null;
  return `${ccy}USD=X`;
}

export async function ensureHistorySeries(
  dataDir: string,
  symbols: string[],
  opts?: {
    nowMs?: number;
    concurrency?: number;
    fxCurrencies?: string[];
    dailyBenchmarkSymbol?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<HistoryCacheState> {
  const nowMs = opts?.nowMs ?? Date.now();
  const concurrency = opts?.concurrency ?? 4;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const cache = loadHistoryCache(dataDir);

  const fxSymbols = (opts?.fxCurrencies ?? [])
    .map((c) => fxHistorySymbolToUsd(c))
    .filter((s): s is string => Boolean(s));
  const unique = Array.from(new Set([...symbols, ...fxSymbols].map((s) => s.trim()).filter(Boolean)));
  const toFetch: string[] = [];

  for (const sym of unique) {
    const existing = cache.series[sym];
    if (existing && existing.points.length >= 10) {
      const updatedMs = Date.parse(existing.updated_at);
      const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : Number.POSITIVE_INFINITY;
      if (existing.source === "manual") continue;
      if (existing.source === "ibkr" && ageMs < IBKR_HISTORY_TTL_MS) {
        continue;
      }
      if (existing.source === "yahoo" && ageMs < YAHOO_HISTORY_TTL_MS) {
        continue;
      }
    }
    toFetch.push(sym);
  }

  let dirty = false;
  const nowIso = new Date(nowMs).toISOString();

  if (toFetch.length > 0) {
    let idx = 0;

    async function worker() {
      while (idx < toFetch.length) {
        const sym = toFetch[idx];
        idx += 1;
        if (!sym) continue;
        const fetched = await fetchYahooHistory(sym, "5y", "1wk", 9000, fetchImpl);
        if (fetched && fetched.points.length >= 2) {
          cache.series[sym] = {
            symbol: sym,
            currency: fetched.currency,
            source: "yahoo",
            updated_at: nowIso,
            points: fetched.points,
          };
          dirty = true;
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, toFetch.length) }, () => worker());
    await Promise.all(workers);
  }

  // Optional daily benchmark series for exact Scorecard date lookups (stored under daily:<symbol>)
  if (opts?.dailyBenchmarkSymbol?.trim()) {
    const benchSym = opts.dailyBenchmarkSymbol.trim();
    const dailyKey = `daily:${benchSym}`;
    const existingDaily = cache.series[dailyKey];
    const updatedMs = existingDaily ? Date.parse(existingDaily.updated_at) : Number.NaN;
    const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : Number.POSITIVE_INFINITY;
    if (!existingDaily || existingDaily.points.length < 10 || ageMs >= YAHOO_HISTORY_TTL_MS) {
      const fetchedDaily = await fetchYahooDailyBenchmark(benchSym, "1y", 9000, fetchImpl);
      if (fetchedDaily && fetchedDaily.points.length >= 2) {
        cache.series[dailyKey] = {
          symbol: benchSym,
          currency: fetchedDaily.currency,
          source: "yahoo",
          updated_at: nowIso,
          points: fetchedDaily.points,
        };
        dirty = true;
      }
    }
  }

  if (dirty) {
    cache.updated_at = nowIso;
    return saveHistoryCache(dataDir, cache);
  }
  return cache;
}
