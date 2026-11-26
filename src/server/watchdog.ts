import { z } from "zod";
import { extractSecRedFlags, pollEdgarFilings } from "./edgar.js";
import { formatTimestamp, parseThesisMarkdown } from "./engine.js";
import { syncInsidersForm4 } from "./insiders.js";
import { fetchFxRatesToBase, fetchMacroRegime, fetchQuotesBatch } from "./market.js";
import {
  canonicalAssetName,
  evaluateHypothesisRule,
  memberTickersForCanonical,
  round,
} from "./quant.js";
import {
  DossierTierSchema,
  HypothesisSchema,
  normalizeTicker,
  type DossierFundamentals,
  type DossierInsiders,
  type MacroRegime,
  type MarketCacheEntry,
  type RiskCapRule,
  type WatchdogAlert,
  type WatchdogAlertInput,
} from "./schema.js";
import {
  appendWatchdogAlerts,
  listThesisFiles,
  loadCatalysts,
  loadDossierFundamentals,
  loadDossierInsiders,
  loadEdgarCache,
  loadEtfWeights,
  loadMarketCache,
  loadPortfolio,
  loadProfile,
  loadWatchdogAlerts,
  saveMacroRegime,
  saveMarketCache,
} from "./storage.js";
import { syncFundamentalsXbrl } from "./xbrl.js";

export interface WatchdogSweepOptions {
  tickers?: string[];
  includeQuotes?: boolean;
  includeMacro?: boolean;
  includeEdgar?: boolean;
  includeXbrl?: boolean;
  includeInsiders?: boolean;
  forceXbrl?: boolean;
  forceInsiders?: boolean;
  nowDate?: Date;
  fetchImpl?: typeof fetch;
}

export interface WatchdogSweepResult {
  checked_at: string;
  new_alerts: WatchdogAlert[];
  total_unacknowledged: number;
  macro_regime: MacroRegime | null;
  edgar_checked: number;
  xbrl_updated: string[];
  insiders_updated: string[];
  summary: string;
}

function evaluatePortfolioRiskCapsQuick(
  dataDir: string,
  pluginRoot: string,
  quotesMap: Record<string, MarketCacheEntry>,
  fxRates: Record<string, number>,
): Array<{ id: string; label: string; value_pct: number; cap_pct: number; status: "PASS" | "BREACH" }> {
  const profile = loadProfile(dataDir);
  const portfolio = loadPortfolio(dataDir);
  if (!portfolio) return [];
  const etfCfg = loadEtfWeights(dataDir, pluginRoot);
  const fxUsdToBase = fxRates.USD ?? 1.0;

  let totPosBase = 0;
  const posUsdMap = new Map<string, number>();
  let usSitusUsd = 0;

  for (const p of portfolio.positions) {
    const yfSym = p.yf_symbol || p.ticker;
    const cachedQ = quotesMap[yfSym];
    const price = cachedQ && cachedQ.price > 0 ? cachedQ.price : p.ref_price;
    const ccy = cachedQ?.currency || p.currency;
    const ccyFx = fxRates[ccy] ?? fxUsdToBase;
    const mvTrading = p.qty * price;
    const mvBase = mvTrading * ccyFx;
    const mvUsd = ccy === "USD" ? mvTrading : mvBase / fxUsdToBase;
    totPosBase += mvBase;
    posUsdMap.set(p.ticker, (posUsdMap.get(p.ticker) ?? 0) + mvUsd);
    if (p.us_situs) usSitusUsd += mvUsd;
  }

  const navBase = totPosBase + portfolio.cash_base + portfolio.accruals_base;
  if (navBase <= 0) return [];

  const etfWeights = etfCfg.etf_weights ?? {};
  const etfMeta = etfCfg.etf_metadata ?? {};
  const etfTickersSet = new Set(Object.keys(etfWeights).map((k) => k.toUpperCase()));
  const canonicalMembers = new Map<string, Set<string>>();

  const register = (sym: string) => {
    const canon = canonicalAssetName(sym);
    if (!canonicalMembers.has(canon)) {
      canonicalMembers.set(canon, new Set(memberTickersForCanonical(canon)));
    }
  };

  for (const p of portfolio.positions) {
    if (!etfTickersSet.has(p.ticker)) register(p.ticker);
  }
  for (const [etfSym, weights] of Object.entries(etfWeights)) {
    if ((posUsdMap.get(etfSym) ?? 0) <= 0) continue;
    for (const [constituent, w] of Object.entries(weights)) {
      if (typeof w === "number" && w > 0) register(constituent);
    }
  }

  const ltPctMap = new Map<string, number>();
  const ltUsdMap = new Map<string, number>();
  let maxSinglePct = 0;

  for (const [canon, members] of canonicalMembers.entries()) {
    let directUsd = 0;
    for (const m of members) directUsd += posUsdMap.get(m) ?? 0;
    let viaEtfsUsd = 0;
    for (const [etfSym, weights] of Object.entries(etfWeights)) {
      const etfMv = posUsdMap.get(etfSym) ?? 0;
      if (etfMv <= 0) continue;
      let share = 0;
      for (const m of members) {
        const w = weights[m];
        if (typeof w === "number") share += w;
      }
      viaEtfsUsd += etfMv * share;
    }
    const totUsd = directUsd + viaEtfsUsd;
    if (totUsd <= 0.01) continue;
    const pct = round(((totUsd * fxUsdToBase) / navBase) * 100, 2);
    ltUsdMap.set(canon, totUsd);
    ltPctMap.set(canon, pct);
    if (pct > maxSinglePct) maxSinglePct = pct;
  }

  const usSitusPct = round(((usSitusUsd * fxUsdToBase) / navBase) * 100, 2);

  const evalBucketUsd = (rule: RiskCapRule): number => {
    const seen = new Set<string>();
    let sum = 0;
    for (const rawT of rule.tickers ?? []) {
      const canon = canonicalAssetName(rawT);
      if (seen.has(canon)) continue;
      seen.add(canon);
      sum += ltUsdMap.get(canon) ?? 0;
    }
    if (rule.include_etf_residual_key) {
      for (const etfSym of Object.keys(etfWeights)) {
        const etfMv = posUsdMap.get(etfSym) ?? 0;
        if (etfMv <= 0) continue;
        const res = (etfMeta[etfSym] as Record<string, unknown> | undefined)?.[rule.include_etf_residual_key];
        if (typeof res === "number") sum += etfMv * res;
      }
    }
    return sum;
  };

  return profile.risk_caps.map((rule) => {
    let valPct = 0;
    if (rule.kind === "single_name_max") valPct = maxSinglePct;
    else if (rule.kind === "ticker" && rule.ticker) valPct = ltPctMap.get(canonicalAssetName(rule.ticker)) ?? 0;
    else if (rule.kind === "us_situs") valPct = usSitusPct;
    else if (rule.kind === "bucket") valPct = round(((evalBucketUsd(rule) * fxUsdToBase) / navBase) * 100, 2);
    return {
      id: rule.id,
      label: rule.label,
      value_pct: valPct,
      cap_pct: rule.cap_pct,
      status: valPct <= rule.cap_pct ? "PASS" : "BREACH",
    };
  });
}

export async function runWatchdogSweep(
  dataDir: string,
  pluginRoot: string,
  opts?: WatchdogSweepOptions,
): Promise<WatchdogSweepResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const includeQuotes = opts?.includeQuotes ?? true;
  const includeMacro = opts?.includeMacro ?? true;
  const includeEdgar = opts?.includeEdgar ?? true;
  const includeXbrl = opts?.includeXbrl ?? true;
  const includeInsiders = opts?.includeInsiders ?? true;

  const profile = loadProfile(dataDir);
  const portfolio = loadPortfolio(dataDir);
  const catalysts = loadCatalysts(dataDir);
  const thesisFiles = listThesisFiles(dataDir);
  const parsedTheses = thesisFiles
    .map((f) => parseThesisMarkdown(f.content))
    .filter((x): x is NonNullable<ReturnType<typeof parseThesisMarkdown>> => x !== null);

  const nowDate = opts?.nowDate ?? new Date();
  const { iso: nowIso, dateYmd } = formatTimestamp(nowDate, profile.timezone);
  const ymTag = dateYmd.slice(0, 7);

  // Capture prior state BEFORE polling so we only log genuine deltas
  const priorEdgar = loadEdgarCache(dataDir);
  const priorMarket = loadMarketCache(dataDir);
  const priorAlerts = loadWatchdogAlerts(dataDir, { limit: 500 });
  const existingAlertIds = new Set(priorAlerts.map((a) => a.id));

  const priorOpenGates = new Set(
    priorEdgar.gate_evaluations
      .filter((g) => !g.cleared)
      .map((g) => `${g.ticker.toUpperCase()}:${g.form.toUpperCase()}:${g.filed_after}`),
  );
  const priorFx = {
    ...(portfolio?.fx_rates ?? {}),
    ...(priorMarket.fx_rates ?? {}),
    [profile.base_currency]: 1.0,
  };
  const priorRiskCaps = new Map(
    evaluatePortfolioRiskCapsQuick(dataDir, pluginRoot, priorMarket.quotes, priorFx).map((c) => [c.id, c.status]),
  );

  // Target ticker discovery across portfolio, catalysts, external wealth, AND all Active/Bench/Passed dossiers
  const secTargetSet = new Set<string>();
  if (opts?.tickers && opts.tickers.length > 0) {
    for (const t of opts.tickers) secTargetSet.add(normalizeTicker(t));
  } else {
    if (portfolio) {
      for (const p of portfolio.positions) {
        if (p.us_situs || p.asset_type.includes("ADR")) secTargetSet.add(p.ticker);
      }
    }
    for (const c of catalysts) secTargetSet.add(c.ticker);
    for (const t of parsedTheses) secTargetSet.add(normalizeTicker(t.fm.ticker));
    if (profile.external_exposure.enabled && profile.external_exposure.ticker) {
      secTargetSet.add(normalizeTicker(profile.external_exposure.ticker));
    }
  }
  const secTargets = Array.from(secTargetSet).sort();

  // 1. Quotes + FX + Macro strip
  let fxRates: Record<string, number> = { ...priorFx };
  let nextQuotesCache: Record<string, MarketCacheEntry> = { ...priorMarket.quotes };
  let vixVal: number | null = priorMarket.vix;
  let vixSparkline: number[] = [...priorMarket.vix_sparkline];
  let macroRegime: MacroRegime | null = priorMarket.macro_regime ?? null;

  if (includeQuotes || includeMacro) {
    const quoteSymbols = new Set<string>(["^VIX", profile.benchmark.yf_symbol || profile.benchmark.ticker]);
    const currencies = new Set<string>(["USD", profile.base_currency]);
    if (portfolio) {
      for (const p of portfolio.positions) {
        quoteSymbols.add(p.yf_symbol || p.ticker);
        currencies.add(p.currency);
      }
    }
    for (const t of parsedTheses) {
      quoteSymbols.add(t.fm.yf_symbol || t.fm.ticker);
      if (t.fm.currency) currencies.add(t.fm.currency.toUpperCase());
    }
    if (profile.external_exposure.enabled && profile.external_exposure.ticker) {
      quoteSymbols.add(profile.external_exposure.ticker);
    }

    const [qMap, updatedFx, fetchedMacro] = await Promise.all([
      includeQuotes ? fetchQuotesBatch(Array.from(quoteSymbols), 4, fetchImpl) : Promise.resolve(new Map()),
      includeQuotes ? fetchFxRatesToBase(Array.from(currencies), profile.base_currency, fxRates, fetchImpl) : Promise.resolve(fxRates),
      includeMacro ? fetchMacroRegime({ nowIso, fetchImpl }) : Promise.resolve(macroRegime),
    ]);

    fxRates = updatedFx;
    if (fetchedMacro) {
      macroRegime = saveMacroRegime(dataDir, fetchedMacro);
      if (fetchedMacro.vix !== null) vixVal = fetchedMacro.vix;
    }

    const vixQ = qMap.get("^VIX");
    if (vixQ) {
      vixVal = round(vixQ.price, 2);
      if (vixQ.sparkline.length > 0) vixSparkline = vixQ.sparkline;
    }
    for (const [sym, q] of qMap.entries()) {
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

    saveMarketCache(dataDir, {
      updated_at: nowIso,
      vix: vixVal,
      vix_sparkline: vixSparkline,
      fx_rates: fxRates,
      macro_regime: macroRegime,
      quotes: nextQuotesCache,
    });
  }

  // 2. Hardened SEC EDGAR across all dossiers
  let latestEdgar = priorEdgar;
  let edgarChecked = 0;
  if (includeEdgar && secTargets.length > 0) {
    try {
      const edgarRes = await pollEdgarFilings(dataDir, profile, secTargets, catalysts, nowIso, fetchImpl);
      latestEdgar = edgarRes.cache;
      edgarChecked = secTargets.length - edgarRes.skippedTickers.length;
    } catch {
      // Preserve cached EDGAR state if SEC endpoint is temporarily unreachable
    }
  }

  // 3. Conditional XBRL & Incremental Form 4 sync
  let xbrlUpdated: string[] = [];
  const xbrlByTicker: Record<string, DossierFundamentals> = {};
  if (includeXbrl && secTargets.length > 0) {
    try {
      const xbrlRes = await syncFundamentalsXbrl(dataDir, profile, secTargets, {
        force: opts?.forceXbrl,
        nowIso,
        edgarFilingsByTicker: latestEdgar.filings_by_ticker,
        fetchImpl,
      });
      xbrlUpdated = xbrlRes.updated;
      Object.assign(xbrlByTicker, xbrlRes.byTicker);
    } catch {
      // Fall back to cached fundamentals below
    }
  }

  let insidersUpdated: string[] = [];
  const insidersByTicker: Record<string, DossierInsiders> = {};
  if (includeInsiders && secTargets.length > 0) {
    try {
      const insRes = await syncInsidersForm4(dataDir, profile, secTargets, {
        force: opts?.forceInsiders,
        nowIso,
        fetchImpl,
      });
      insidersUpdated = insRes.updated;
      Object.assign(insidersByTicker, insRes.byTicker);
    } catch {
      // Fall back to cached insiders below
    }
  }

  // 4. Diff & collect actionable deltas only
  const pendingAlerts: WatchdogAlertInput[] = [];
  const enqueueAlert = (alert: WatchdogAlertInput) => {
    if (existingAlertIds.has(alert.id)) return;
    existingAlertIds.add(alert.id);
    pendingAlerts.push(alert);
  };

  // 4a. SEC gates newly cleared
  for (const g of latestEdgar.gate_evaluations) {
    if (!g.cleared) continue;
    const gateKey = `${g.ticker.toUpperCase()}:${g.form.toUpperCase()}:${g.filed_after}`;
    if (priorOpenGates.size === 0 || priorOpenGates.has(gateKey)) {
      enqueueAlert({
        id: `sec-gate-cleared:${g.ticker.toUpperCase()}:${g.form.toUpperCase()}:${g.latest_matching_date ?? dateYmd}`,
        detected_at: nowIso,
        severity: "high",
        kind: "sec_gate_cleared",
        ticker: g.ticker.toUpperCase(),
        title: `${g.ticker} SEC ${g.form} Gate Cleared`,
        detail: `${g.form} filed ${g.latest_matching_date ?? "recently"} — ${g.description}`,
        acknowledged: false,
      });
    }
  }

  // 4b. SEC 8-K / NT red flags
  const redFlags = extractSecRedFlags(latestEdgar.filings_by_ticker);
  for (const rf of redFlags) {
    enqueueAlert({
      id: `sec-red-flag:${rf.ticker.toUpperCase()}:${rf.code}:${rf.accession}`,
      detected_at: nowIso,
      severity: rf.severity,
      kind: "sec_red_flag",
      ticker: rf.ticker.toUpperCase(),
      title: `${rf.ticker} ${rf.code} Forensic Filing Alert`,
      detail: `${rf.label} (${rf.form} filed ${rf.filingDate})`,
      acknowledged: false,
    });
  }

  // 4c. Per-thesis deltas (rule breaches, passed re-entry hits, audit drift, insider signals)
  for (const { fm } of parsedTheses) {
    const sym = normalizeTicker(fm.ticker);
    const yfSym = String(fm.yf_symbol || sym);
    const quoteEntry = nextQuotesCache[yfSym] ?? nextQuotesCache[sym] ?? null;
    const curPrice = quoteEntry?.price ?? (typeof fm.last_ref_price === "number" ? fm.last_ref_price : null);
    const tier = DossierTierSchema.safeParse(fm.tier).success ? fm.tier! : "active";

    let fundamentals: DossierFundamentals | null = xbrlByTicker[sym] ?? null;
    if (!fundamentals) {
      try {
        fundamentals = loadDossierFundamentals(dataDir, sym);
      } catch {
        fundamentals = null;
      }
    }

    let insiders: DossierInsiders | null = insidersByTicker[sym] ?? null;
    if (!insiders) {
      try {
        insiders = loadDossierInsiders(dataDir, sym);
      } catch {
        insiders = null;
      }
    }

    const tickerFilings = latestEdgar.filings_by_ticker[sym] ?? [];
    const parsedHyps = Array.isArray(fm.hypotheses) ? z.array(HypothesisSchema).safeParse(fm.hypotheses) : null;
    const hypotheses = parsedHyps?.success ? parsedHyps.data : [];

    for (const h of hypotheses) {
      if (!h.rule) continue;
      const evalRes = evaluateHypothesisRule(h.rule, fundamentals, tickerFilings, insiders, quoteEntry);
      if (evalRes.passed === false) {
        enqueueAlert({
          id: `rule-breach:${sym}:${h.id}:${evalRes.period ?? dateYmd}`,
          detected_at: nowIso,
          severity: h.is_core ? "high" : "medium",
          kind: "hypothesis_rule_breach",
          ticker: sym,
          title: `${sym} Rule Breached: ${h.id}`,
          detail: evalRes.detail,
          acknowledged: false,
        });
      }
    }

    if (
      tier === "passed" &&
      typeof fm.reentry_price === "number" &&
      Number.isFinite(fm.reentry_price) &&
      curPrice !== null &&
      curPrice <= fm.reentry_price
    ) {
      enqueueAlert({
        id: `reentry-hit:${sym}:${fm.reentry_price}:${ymTag}`,
        detected_at: nowIso,
        severity: "medium",
        kind: "reentry_hit",
        ticker: sym,
        title: `${sym} Hit Passed Re-Entry Target (${curPrice} <= ${fm.reentry_price})`,
        detail: fm.reentry_trigger ? `Re-entry criteria: ${fm.reentry_trigger}` : `Price ${curPrice} crossed re-entry level ${fm.reentry_price}.`,
        acknowledged: false,
      });
    }

    const priceAtAudit = typeof fm.price_at_audit === "number" && fm.price_at_audit > 0 ? fm.price_at_audit : null;
    if (priceAtAudit !== null && curPrice !== null) {
      const driftPct = round(((curPrice - priceAtAudit) / priceAtAudit) * 100, 1);
      if (Math.abs(driftPct) >= 15) {
        const bucket = Math.floor(Math.abs(driftPct) / 15) * 15;
        enqueueAlert({
          id: `audit-drift:${sym}:${fm.last_audited_date ?? "none"}:${bucket}`,
          detected_at: nowIso,
          severity: "medium",
          kind: "audit_drift",
          ticker: sym,
          title: `${sym} Audit Price Drift (${driftPct >= 0 ? "+" : ""}${driftPct}%)`,
          detail: `Price moved from ${priceAtAudit} at audit (${fm.last_audited_date ?? "n/a"}) to ${curPrice}; thesis needs re-test.`,
          acknowledged: false,
        });
      }
    }

    if (insiders && insiders.flags.length > 0) {
      for (const flag of insiders.flags) {
        const code = flag.split(":")[0]?.trim() || "INSIDER_SIGNAL";
        const isHigh = code === "ACTIVIST_13D_FILING" || code === "C_SUITE_DISCRETIONARY_BUY";
        enqueueAlert({
          id: `insider-flag:${sym}:${code}:${ymTag}`,
          detected_at: nowIso,
          severity: isHigh ? "high" : "medium",
          kind: "insider_signal",
          ticker: sym,
          title: `${sym} ${code.replace(/_/g, " ")}`,
          detail: flag,
          acknowledged: false,
        });
      }
    }
  }

  // 4d. Newly breached portfolio risk caps
  const nextCaps = evaluatePortfolioRiskCapsQuick(dataDir, pluginRoot, nextQuotesCache, fxRates);
  for (const cap of nextCaps) {
    if (cap.status === "BREACH" && priorRiskCaps.get(cap.id) !== "BREACH") {
      enqueueAlert({
        id: `risk-cap-breach:${cap.id}:${ymTag}`,
        detected_at: nowIso,
        severity: "high",
        kind: "risk_cap_breach",
        title: `Risk Cap Breached: ${cap.label}`,
        detail: `Exposure rose to ${cap.value_pct.toFixed(1)}% vs ${cap.cap_pct.toFixed(1)}% cap.`,
        acknowledged: false,
      });
    }
  }

  // 4e. High-Vol / Stress macro alert
  if (macroRegime && macroRegime.vix !== null && macroRegime.vix >= 28) {
    enqueueAlert({
      id: `macro-high-vol:${macroRegime.regime_label}:${dateYmd}`,
      detected_at: nowIso,
      severity: macroRegime.regime_label === "STRESS" ? "high" : "medium",
      kind: "macro_regime",
      title: `Macro Regime ${macroRegime.regime_label} (VIX ${macroRegime.vix.toFixed(1)})`,
      detail: macroRegime.notes ?? "Elevated volatility regime — stage buys 2-3 weeks apart and guard liquidity reserve.",
      acknowledged: false,
    });
  }

  const savedNewAlerts = appendWatchdogAlerts(dataDir, pendingAlerts);
  const totalUnack = loadWatchdogAlerts(dataDir, { limit: 200, onlyUnacknowledged: true }).length;

  const summaryParts = [
    `Watchdog sweep complete (${nowIso}): ${savedNewAlerts.length} new alert(s), ${totalUnack} unacknowledged.`,
    `EDGAR checked: ${edgarChecked} | XBRL updated: ${xbrlUpdated.length} | Form 4 updated: ${insidersUpdated.length}.`,
  ];
  if (macroRegime) {
    summaryParts.push(
      `Macro: ${macroRegime.regime_label} (VIX ${macroRegime.vix ?? "n/a"}, US10Y ${macroRegime.us10y_pct ?? "n/a"}%, 3M ${macroRegime.us3m_pct ?? "n/a"}%).`,
    );
  }

  return {
    checked_at: nowIso,
    new_alerts: savedNewAlerts,
    total_unacknowledged: totalUnack,
    macro_regime: macroRegime,
    edgar_checked: edgarChecked,
    xbrl_updated: xbrlUpdated,
    insiders_updated: insidersUpdated,
    summary: summaryParts.join(" "),
  };
}
