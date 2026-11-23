export interface QuoteResult {
  symbol: string;
  price: number;
  currency: string;
  marketState?: string;
}

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; InvestmentOS-Plugin/0.2.0)",
  Accept: "application/json",
};

export async function fetchYahooChartQuote(symbol: string, timeoutMs = 7000): Promise<QuoteResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
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
        }>;
      };
    };
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    let price = meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    let currency = (meta.currency ?? "USD").trim();
    if (currency === "GBp" || currency === "GBX") {
      price = price / 100.0;
      currency = "GBP";
    } else {
      currency = currency.toUpperCase();
    }

    return {
      symbol,
      price,
      currency,
      marketState: meta.marketState,
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
