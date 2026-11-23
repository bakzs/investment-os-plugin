export interface QuoteResult {
  symbol: string;
  price: number;
  currency: string;
  marketState?: string;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
}

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; InvestmentOS-Plugin/0.2.0)",
  Accept: "application/json",
};

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function fetchYahooChartQuote(symbol: string, timeoutMs = 7000): Promise<QuoteResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  try {
    const resp = await fetch(url, {
      headers: YF_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
            marketState?: string;
          };
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
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
      price = price * scale;
      currency = "GBP";
    } else {
      currency = currency.toUpperCase();
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

    return {
      symbol,
      price,
      currency,
      marketState: meta.marketState,
      sparkline,
      change_1d_pct: change1d,
      change_1m_pct: change1m,
    };
  } catch {
    return null;
  }
}

export async function fetchQuotesBatch(symbols: string[], concurrency = 4): Promise<Map<string, QuoteResult>> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  const out = new Map<string, QuoteResult>();
  let idx = 0;

  async function worker() {
    while (idx < unique.length) {
      const current = unique[idx];
      idx += 1;
      if (!current) continue;
      const res = await fetchYahooChartQuote(current);
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
): Promise<Record<string, number>> {
  const base = baseCurrency.toUpperCase();
  const out: Record<string, number> = { ...fallbackRates, [base]: 1.0 };
  const needed = Array.from(new Set(currencies.map((c) => c.toUpperCase()).filter((c) => c !== base)));

  for (const ccy of needed) {
    const directSym = ccy === "USD" ? `${base}=X` : `${ccy}${base}=X`;
    const direct = await fetchYahooChartQuote(directSym);
    if (direct && direct.price > 0) {
      out[ccy] = direct.price;
      continue;
    }
    const inverseSym = `${base}${ccy}=X`;
    const inverse = await fetchYahooChartQuote(inverseSym);
    if (inverse && inverse.price > 0) {
      out[ccy] = 1.0 / inverse.price;
    }
  }

  return out;
}
