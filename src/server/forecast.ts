import {
  canonicalAssetName,
  computeAfterTaxHurdle,
  computeUsEstateTaxNra,
  lookupHistorySeries,
  memberTickersForCanonical,
  round,
  type CapitalRotationQueue,
  type ScenarioSummary,
} from "./quant.js";
import {
  computeBlackLittermanPosterior,
  computeFactorRiskDecomposition,
  computeHrpWeights,
  runCorrelatedWealthSimulation,
  type BlackLittermanResult,
  type FactorRiskDecomposition,
} from "./quant_sota.js";
import type {
  DossierModel,
  EtfWeightsConfig,
  ForecastAction,
  ForecastRequest,
  HistoryCacheState,
  PortfolioRecord,
  RiskCapRule,
  UserProfile,
} from "./schema.js";

export interface ForecastThesisRef {
  ticker: string;
  yf_symbol: string;
  currency: string;
  us_situs: boolean;
  price: number | null;
  max_weight_pct: number | null;
  is_etf?: boolean;
  accumulating?: boolean;
  scenario_summary?: ScenarioSummary | null;
  model?: DossierModel | null;
  quality_grade?: "A" | "B" | "C" | "D" | null;
}

export interface ForecastYearPoint {
  year: number;
  p10_base: number;
  p25_base: number;
  p50_base: number;
  p75_base: number;
  p90_base: number;
  mean_base: number;
}

export interface ForecastPathSummary {
  starting_wealth_base: number;
  ending_cvar_10_base: number;
  ending_p10_base: number;
  ending_p50_base: number;
  ending_p90_base: number;
  ending_mean_base: number;
  expected_cagr_p50_pct: number;
  p10_cagr_pct: number;
  p90_cagr_pct: number;
  sim_max_dd_p50_pct: number;
  sim_max_dd_p95_pct: number;
  annual_vol_pct: number;
  expected_sharpe: number;
  prob_beat_benchmark_pct: number;
  prob_loss_pct: number;
  us_situs_portfolio_pct: number;
  estate_tax_base: number;
  annual_wht_drag_base: number;
  cap_breaches_count: number;
  breached_cap_labels: string[];
  ending_cash_base: number;
  factor_risk: FactorRiskDecomposition;
  trajectory: ForecastYearPoint[];
}

export interface ForecastPositionSizingRow {
  ticker: string;
  is_external: boolean;
  is_cash: boolean;
  before_value_base: number;
  after_value_base: number;
  before_weight_pct: number;
  after_weight_pct: number;
  expected_cagr_pct: number;
  prior_cagr_pct: number;
  raw_view_cagr_pct: number | null;
  bl_shrinkage_pct: number;
  annual_vol_pct: number;
  return_source: "black_litterman" | "dossier_scenarios" | "benchmark" | "etf_benchmark" | "unmodeled_default" | "risk_free";
  marginal_risk_contrib_pct: number;
  corr_with_portfolio: number;
  corr_adjusted_hurdle_pct: number;
  quarter_kelly_weight_pct: number;
  hrp_weight_pct: number;
  quality_grade?: "A" | "B" | "C" | "D" | null;
}

export interface ForecastAppliedActionLog {
  label: string;
  type: ForecastAction["type"];
  ticker?: string;
  target_ticker?: string;
  amount_base: number;
  note?: string;
}

export interface PortfolioForecastResult {
  horizon_years: number;
  base_currency: string;
  include_external_wealth: boolean;
  regime_vol_multiplier: number;
  return_model: "black_litterman" | "raw_dossier";
  simulation_engine_requested: "block_bootstrap" | "student_t";
  simulation_engine_used: "block_bootstrap" | "student_t";
  block_length_weeks: number;
  aligned_history_weeks: number;
  simulations: number;
  rf_pct: number;
  benchmark_ticker: string;
  benchmark_cagr_pct: number;
  benchmark_ending_base: number;
  black_litterman: BlackLittermanResult;
  baseline: ForecastPathSummary;
  simulated: ForecastPathSummary;
  deltas: {
    p50_base: number;
    p10_base: number;
    cvar_10_base: number;
    p90_base: number;
    cagr_p50_pct: number;
    annual_vol_pct: number;
    sharpe: number;
    effective_bets: number;
    estate_tax_saved_base: number;
    annual_wht_saved_base: number;
    us_situs_delta_pct: number;
    cap_breaches_delta: number;
    cured_caps: string[];
    remaining_breached_caps: string[];
  };
  applied_actions: ForecastAppliedActionLog[];
  cash_shortfall_base: number;
  positions: ForecastPositionSizingRow[];
  methodology_note: string;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function choleskyDecompose(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = 0;
      for (let k = 0; k < j; k += 1) {
        sum += L[i]![k]! * L[j]![k]!;
      }
      if (i === j) {
        const diag = matrix[i]![i]! - sum;
        L[i]![j] = Math.sqrt(Math.max(1e-8, diag));
      } else {
        const denom = L[j]![j]!;
        L[i]![j] = denom > 1e-9 ? (matrix[i]![j]! - sum) / denom : 0;
      }
    }
  }
  return L;
}

function buildWeeklyReturnMapByWeek(
  ticker: string,
  yfSymbol: string,
  historyCache: HistoryCacheState,
): Map<string, number> {
  const ser = lookupHistorySeries(historyCache, yfSymbol, ticker);
  const out = new Map<string, number>();
  if (!ser || ser.points.length < 15) return out;
  const pts = ser.points.slice(-260);
  const toWeek = (dateStr: string): string => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return dateStr;
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? 1 : 1 - day));
    return d.toISOString().slice(0, 10);
  };
  let prevClose: number | null = null;
  for (const pt of pts) {
    if (pt.close > 0 && prevClose !== null && prevClose > 0) {
      const r = Math.log(pt.close / prevClose);
      if (Number.isFinite(r) && Math.abs(r) < 1.2) {
        out.set(toWeek(pt.date), r);
      }
    }
    if (pt.close > 0) prevClose = pt.close;
  }
  return out;
}

function computeSampleVolAndCorr(
  mapA: Map<string, number>,
  mapB: Map<string, number>,
): { corr: number | null; overlap: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [wk, valA] of mapA.entries()) {
    const valB = mapB.get(wk);
    if (valB !== undefined) {
      xs.push(valA);
      ys.push(valB);
    }
  }
  if (xs.length < 20) return { corr: null, overlap: xs.length };
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den <= 1e-12) return { corr: null, overlap: n };
  return { corr: Math.max(-0.9, Math.min(0.96, num / den)), overlap: n };
}

function computeAnnualizedVol(retMap: Map<string, number>): number | null {
  const vals = Array.from(retMap.values());
  if (vals.length < 20) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vals.length - 1);
  const ann = Math.sqrt(Math.max(0, variance) * 52);
  return Number.isFinite(ann) && ann > 0.02 ? Math.min(1.1, ann) : null;
}

interface HoldingSlot {
  key: string; // ticker, or "EXT:<ticker>", or "__CASH__"
  ticker: string;
  yf_symbol: string;
  us_situs: boolean;
  is_etf: boolean;
  accumulating: boolean;
  is_external: boolean;
  is_cash: boolean;
  value_base: number;
  dividend_yield_pct: number;
}

interface RiskTaxEvaluation {
  us_situs_portfolio_pct: number;
  estate_tax_base: number;
  annual_wht_drag_base: number;
  cap_breaches_count: number;
  breached_cap_labels: string[];
}

function evaluateRiskAndTaxForHoldings(
  slots: HoldingSlot[],
  profile: UserProfile,
  etfWeightsCfg: EtfWeightsConfig,
  fxUsdToBase: number,
): RiskTaxEvaluation {
  const safeFx = fxUsdToBase > 0 ? fxUsdToBase : 1.0;
  const brokerageSlots = slots.filter((s) => !s.is_external);
  const navBase = brokerageSlots.reduce((acc, s) => acc + Math.max(0, s.value_base), 0);
  const etfWeights = etfWeightsCfg.etf_weights ?? {};
  const etfMeta = etfWeightsCfg.etf_metadata ?? {};
  const etfSet = new Set(Object.keys(etfWeights).map((k) => k.toUpperCase()));

  const posUsdMap = new Map<string, number>();
  let usSitusPortfolioUsd = 0;
  let extUsSitusUsd = 0;
  let annualWhtDragBase = 0;

  for (const s of slots) {
    if (s.value_base <= 0.01) continue;
    const usdVal = s.value_base / safeFx;
    if (s.is_external) {
      if (s.us_situs) extUsSitusUsd += usdVal;
      continue;
    }
    if (s.is_cash) continue;
    posUsdMap.set(s.ticker, (posUsdMap.get(s.ticker) ?? 0) + usdVal);
    if (s.us_situs) usSitusPortfolioUsd += usdVal;

    if (!s.accumulating && s.dividend_yield_pct > 0) {
      const whtRate = s.us_situs
        ? profile.tax_profile.us_dividend_wht_pct
        : profile.tax_profile.ucits_dividend_wht_pct;
      annualWhtDragBase += s.value_base * (s.dividend_yield_pct / 100) * (whtRate / 100);
    }
  }

  const canonicalMembers = new Map<string, Set<string>>();
  const register = (sym: string) => {
    const canon = canonicalAssetName(sym);
    if (!canonicalMembers.has(canon)) {
      canonicalMembers.set(canon, new Set(memberTickersForCanonical(canon)));
    }
  };
  for (const sym of posUsdMap.keys()) {
    if (!etfSet.has(sym)) register(sym);
  }
  for (const [etfSym, weights] of Object.entries(etfWeights)) {
    if ((posUsdMap.get(etfSym) ?? 0) <= 0) continue;
    for (const [c, w] of Object.entries(weights)) {
      if (typeof w === "number" && w > 0) register(c);
    }
  }

  const ltUsdMap = new Map<string, number>();
  const ltPctMap = new Map<string, number>();
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
    const pct = navBase > 0 ? round(((totUsd * safeFx) / navBase) * 100, 2) : 0;
    ltUsdMap.set(canon, totUsd);
    ltPctMap.set(canon, pct);
    if (pct > maxSinglePct) maxSinglePct = pct;
  }

  const usSitusPortfolioPct = navBase > 0 ? round(((usSitusPortfolioUsd * safeFx) / navBase) * 100, 2) : 0;

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

  const breached: string[] = [];
  for (const rule of profile.risk_caps) {
    let valPct = 0;
    if (rule.kind === "single_name_max") valPct = maxSinglePct;
    else if (rule.kind === "ticker" && rule.ticker) valPct = ltPctMap.get(canonicalAssetName(rule.ticker)) ?? 0;
    else if (rule.kind === "us_situs") valPct = usSitusPortfolioPct;
    else if (rule.kind === "bucket") valPct = navBase > 0 ? round(((evalBucketUsd(rule) * safeFx) / navBase) * 100, 2) : 0;
    if (valPct > rule.cap_pct + 0.05) {
      breached.push(rule.label);
    }
  }

  const estateEnabled = profile.tax_profile.nra_us_estate_tax_enabled;
  const estateTaxBase = estateEnabled
    ? round(computeUsEstateTaxNra(usSitusPortfolioUsd + extUsSitusUsd).net_estate_tax_usd * safeFx, 2)
    : 0;

  return {
    us_situs_portfolio_pct: usSitusPortfolioPct,
    estate_tax_base: estateTaxBase,
    annual_wht_drag_base: round(annualWhtDragBase, 2),
    cap_breaches_count: breached.length,
    breached_cap_labels: breached,
  };
}

export interface ForecastRunOptions {
  defaultRfPct?: number;
  vix?: number | null;
  liveExternalBase?: number | null;
  livePricesMap?: Map<string, number>;
  brierScore?: number | null;
  brierResolvedCount?: number;
}

export function runPortfolioForecast(
  req: ForecastRequest,
  portfolio: PortfolioRecord,
  profile: UserProfile,
  theses: ForecastThesisRef[],
  rotationQueue: CapitalRotationQueue,
  etfWeights: EtfWeightsConfig,
  historyCache: HistoryCacheState,
  fxRates: Record<string, number>,
  opts?: ForecastRunOptions,
): PortfolioForecastResult {
  const horizon = Math.max(1, Math.min(10, req.horizon_years || 5));
  const simulations = Math.max(200, Math.min(5000, req.simulations || 1500));
  const volMult = Math.max(0.5, Math.min(2.5, req.regime_vol_multiplier || 1.0));
  const rfPct = round(req.rf_pct ?? opts?.defaultRfPct ?? 3.8, 2);
  const fxUsdToBase = fxRates.USD && fxRates.USD > 0 ? fxRates.USD : 1.0;
  const benchTicker = profile.benchmark.ticker.toUpperCase();
  const benchYf = profile.benchmark.yf_symbol || benchTicker;
  const benchCagrPct = profile.benchmark.expected_cagr_pct ?? 8.0;
  const etfSet = new Set(Object.keys(etfWeights.etf_weights ?? {}).map((k) => k.toUpperCase()));
  const thesisByTicker = new Map(theses.map((t) => [t.ticker.toUpperCase(), t]));

  // 1. Build Baseline Holdings Vector
  const baselineMap = new Map<string, HoldingSlot>();
  for (const p of portfolio.positions) {
    const sym = p.ticker.toUpperCase();
    const livePx = opts?.livePricesMap?.get(sym) ?? opts?.livePricesMap?.get(p.yf_symbol || sym) ?? p.ref_price;
    const ccyFx = fxRates[p.currency] ?? fxUsdToBase;
    const mvBase = Math.max(0, p.qty * livePx * ccyFx);
    if (mvBase <= 0.01) continue;
    const th = thesisByTicker.get(sym);
    const isEtf = Boolean(th?.is_etf || etfSet.has(sym) || p.asset_type.toUpperCase().includes("ETF") || sym === benchTicker);
    const accumulating = Boolean(th?.accumulating ?? (p.asset_type.toUpperCase().includes("UCITS") || sym === "VWRA"));
    const divYield = th?.model?.dividend_yield_pct ?? (isEtf && !accumulating ? 1.3 : 0);
    const prev = baselineMap.get(sym);
    baselineMap.set(sym, {
      key: sym,
      ticker: sym,
      yf_symbol: p.yf_symbol || th?.yf_symbol || sym,
      us_situs: p.us_situs,
      is_etf: isEtf,
      accumulating,
      is_external: false,
      is_cash: false,
      value_base: round((prev?.value_base ?? 0) + mvBase, 2),
      dividend_yield_pct: divYield,
    });
  }

  const cashStart = Math.max(0, round(portfolio.cash_base + portfolio.accruals_base, 2));
  baselineMap.set("__CASH__", {
    key: "__CASH__",
    ticker: "CASH",
    yf_symbol: "CASH",
    us_situs: false,
    is_etf: false,
    accumulating: true,
    is_external: false,
    is_cash: true,
    value_base: cashStart,
    dividend_yield_pct: 0,
  });

  const ext = profile.external_exposure;
  const includeExt = Boolean(req.include_external_wealth && ext.enabled);
  const extAmountBase =
    opts?.liveExternalBase !== null && opts?.liveExternalBase !== undefined && Number.isFinite(opts.liveExternalBase)
      ? Math.max(0, opts.liveExternalBase)
      : Math.max(0, ext.amount_base);
  if (includeExt && extAmountBase > 0.01) {
    const extTicker = (ext.ticker || "EXTERNAL").toUpperCase();
    const extTh = thesisByTicker.get(extTicker);
    baselineMap.set(`EXT:${extTicker}`, {
      key: `EXT:${extTicker}`,
      ticker: extTicker,
      yf_symbol: extTh?.yf_symbol || extTicker,
      us_situs: ext.us_situs,
      is_etf: false,
      accumulating: false,
      is_external: true,
      is_cash: false,
      value_base: round(extAmountBase, 2),
      dividend_yield_pct: extTh?.model?.dividend_yield_pct ?? 0,
    });
  }

  // 2. Construct Action Queue (auto recommended rotations + explicit user actions)
  const effectiveActions: ForecastAction[] = [];
  if (req.apply_recommended_rotations) {
    const explicitSwapTickers = new Set(
      req.actions.filter((a) => a.type === "tax_swap").map((a) => a.ticker.toUpperCase()),
    );
    const explicitSellTickers = new Set(
      req.actions.filter((a) => a.type === "sell").map((a) => a.ticker.toUpperCase()),
    );
    for (const sw of rotationQueue.tax_swaps) {
      if (!explicitSwapTickers.has(sw.ticker.toUpperCase())) {
        effectiveActions.push({
          type: "tax_swap",
          ticker: sw.ticker.toUpperCase(),
          target_ticker: benchTicker,
          pct: 100,
        });
      }
    }
    for (const ex of rotationQueue.mandatory_exits) {
      if (!explicitSellTickers.has(ex.ticker.toUpperCase())) {
        effectiveActions.push({
          type: "sell",
          ticker: ex.ticker.toUpperCase(),
          pct: 100,
        });
      }
    }
    for (const ct of rotationQueue.cap_trims) {
      if (!explicitSellTickers.has(ct.ticker.toUpperCase()) && ct.proceeds_base > 0) {
        effectiveActions.push({
          type: "sell",
          ticker: ct.ticker.toUpperCase(),
          amount_base: ct.proceeds_base,
        });
      }
    }
  }
  effectiveActions.push(...req.actions);

  // 3. Apply Actions to Clone of Baseline -> Simulated Holdings Vector
  const simMap = new Map<string, HoldingSlot>();
  for (const [k, slot] of baselineMap.entries()) {
    simMap.set(k, { ...slot });
  }

  const ensureSlot = (
    sym: string,
    overrides?: { yf_symbol?: string; us_situs?: boolean; is_etf?: boolean; accumulating?: boolean },
  ): HoldingSlot => {
    const existing = simMap.get(sym);
    if (existing) return existing;
    const th = thesisByTicker.get(sym);
    const isBench = sym === benchTicker;
    const isEtf = Boolean(overrides?.is_etf ?? th?.is_etf ?? etfSet.has(sym) ?? isBench);
    const accumulating = Boolean(overrides?.accumulating ?? th?.accumulating ?? (isBench && sym === "VWRA"));
    const slot: HoldingSlot = {
      key: sym,
      ticker: sym,
      yf_symbol: overrides?.yf_symbol || (isBench ? benchYf : th?.yf_symbol || sym),
      us_situs: overrides?.us_situs ?? (isBench ? false : (th?.us_situs ?? true)),
      is_etf: isEtf,
      accumulating,
      is_external: false,
      is_cash: false,
      value_base: 0,
      dividend_yield_pct: th?.model?.dividend_yield_pct ?? (isEtf && !accumulating ? 1.3 : 0),
    };
    simMap.set(sym, slot);
    return slot;
  };

  const appliedLog: ForecastAppliedActionLog[] = [];
  let cashShortfallBase = 0;

  // Phase A: tax_swap and sell first so freed proceeds fund buys cleanly
  const swapsAndSells = effectiveActions.filter((a) => a.type === "tax_swap" || a.type === "sell");
  const buysAndParks = effectiveActions.filter((a) => a.type === "buy" || a.type === "park_cash_in_benchmark");

  for (const act of swapsAndSells) {
    if (act.type === "tax_swap") {
      const fromSym = act.ticker.toUpperCase();
      const targetSym = (act.target_ticker || benchTicker).toUpperCase();
      const fromSlot = simMap.get(fromSym);
      if (!fromSlot || fromSlot.value_base <= 0.01) continue;
      const amt = round(fromSlot.value_base * (Math.min(100, Math.max(1, act.pct ?? 100)) / 100), 2);
      fromSlot.value_base = round(Math.max(0, fromSlot.value_base - amt), 2);
      const targetSlot = ensureSlot(targetSym, {
        yf_symbol: targetSym === benchTicker ? benchYf : undefined,
        us_situs: targetSym === benchTicker ? false : undefined,
        is_etf: targetSym === benchTicker ? true : undefined,
        accumulating: targetSym === benchTicker ? true : undefined,
      });
      targetSlot.value_base = round(targetSlot.value_base + amt, 2);
      appliedLog.push({
        label: `Tax swap ${fromSym} → ${targetSym}`,
        type: "tax_swap",
        ticker: fromSym,
        target_ticker: targetSym,
        amount_base: amt,
      });
    } else if (act.type === "sell") {
      const sym = act.ticker.toUpperCase();
      const fromSlot = simMap.get(sym);
      if (!fromSlot || fromSlot.value_base <= 0.01) continue;
      const rawAmt =
        act.amount_base !== undefined
          ? Math.min(fromSlot.value_base, act.amount_base)
          : fromSlot.value_base * (Math.min(100, Math.max(1, act.pct ?? 100)) / 100);
      const amt = round(rawAmt, 2);
      if (amt <= 0.01) continue;
      fromSlot.value_base = round(Math.max(0, fromSlot.value_base - amt), 2);
      const cashSlot = simMap.get("__CASH__")!;
      cashSlot.value_base = round(cashSlot.value_base + amt, 2);
      appliedLog.push({
        label: `Sell ${sym}`,
        type: "sell",
        ticker: sym,
        amount_base: amt,
      });
    }
  }

  for (const act of buysAndParks) {
    const cashSlot = simMap.get("__CASH__")!;
    if (act.type === "buy") {
      const sym = act.ticker.toUpperCase();
      const wanted = round(act.amount_base, 2);
      const funded = round(Math.min(cashSlot.value_base, wanted), 2);
      if (wanted - funded > 0.5) {
        cashShortfallBase = round(cashShortfallBase + (wanted - funded), 2);
      }
      if (funded <= 0.01) continue;
      cashSlot.value_base = round(Math.max(0, cashSlot.value_base - funded), 2);
      const targetSlot = ensureSlot(sym, {
        yf_symbol: act.yf_symbol,
        us_situs: act.us_situs,
      });
      targetSlot.value_base = round(targetSlot.value_base + funded, 2);
      appliedLog.push({
        label: `Buy ${sym}`,
        type: "buy",
        ticker: sym,
        amount_base: funded,
        note: wanted - funded > 0.5 ? `Capped by available cash (${round(wanted - funded, 0)} shortfall)` : undefined,
      });
    } else if (act.type === "park_cash_in_benchmark") {
      const reserveAmt = act.keep_reserve && profile.liquidity_reserve.enabled ? profile.liquidity_reserve.amount_base : 0;
      const excessCash = Math.max(0, cashSlot.value_base - reserveAmt);
      const amt = round(excessCash * (Math.min(100, Math.max(1, act.pct ?? 100)) / 100), 2);
      if (amt <= 0.01) continue;
      cashSlot.value_base = round(Math.max(0, cashSlot.value_base - amt), 2);
      const benchSlot = ensureSlot(benchTicker, {
        yf_symbol: benchYf,
        us_situs: false,
        is_etf: true,
        accumulating: true,
      });
      benchSlot.value_base = round(benchSlot.value_base + amt, 2);
      appliedLog.push({
        label: `Sweep excess cash → ${benchTicker}`,
        type: "park_cash_in_benchmark",
        target_ticker: benchTicker,
        amount_base: amt,
      });
    }
  }

  // 4. Unified Asset Universe & Parameter Calibration (Expected After-Tax Drift + Shrunk Covariance)
  const allKeys = Array.from(new Set([...baselineMap.keys(), ...simMap.keys()])).filter((k) => {
    const bVal = baselineMap.get(k)?.value_base ?? 0;
    const sVal = simMap.get(k)?.value_base ?? 0;
    return bVal > 0.01 || sVal > 0.01;
  });

  const baseRiskTax = evaluateRiskAndTaxForHoldings(
    Array.from(baselineMap.values()),
    profile,
    etfWeights,
    fxUsdToBase,
  );
  const simRiskTax = evaluateRiskAndTaxForHoldings(
    Array.from(simMap.values()),
    profile,
    etfWeights,
    fxUsdToBase,
  );

  const estMarginalRate =
    profile.tax_profile.nra_us_estate_tax_enabled && baseRiskTax.estate_tax_base > 0 ? 34 : 0;

  const returnModel = req.return_model ?? "black_litterman";
  const simEngineReq = req.simulation_engine ?? "block_bootstrap";
  const blockLenWeeks = Math.max(2, Math.min(26, req.block_length_weeks ?? 6));

  interface CalibratedAsset {
    key: string;
    slot: HoldingSlot;
    rawMu: number; // raw dossier/benchmark after-tax expected return (decimal)
    mu: number; // active expected return used for simulation (BL posterior or rawMu)
    hasDossierView: boolean;
    viewWarningsCount: number;
    dispersionSpread: number | null;
    vol: number; // annual volatility (decimal)
    returnSource: ForecastPositionSizingRow["return_source"];
    retMap: Map<string, number>;
    qualityGrade?: "A" | "B" | "C" | "D" | null;
    maxWeightPct: number;
  }

  const assets: CalibratedAsset[] = allKeys.map((key) => {
    const slot = (simMap.get(key) ?? baselineMap.get(key))!;
    if (slot.is_cash) {
      return {
        key,
        slot,
        rawMu: rfPct / 100,
        mu: rfPct / 100,
        hasDossierView: false,
        viewWarningsCount: 0,
        dispersionSpread: null,
        vol: 0.005,
        returnSource: "risk_free",
        retMap: new Map(),
        qualityGrade: null,
        maxWeightPct: 100,
      };
    }

    const th = thesisByTicker.get(slot.ticker);
    const taxInfo = computeAfterTaxHurdle(
      profile,
      slot.us_situs,
      slot.dividend_yield_pct,
      estMarginalRate,
      {
        dividendWhtPctOverride: th?.model?.dividend_wht_pct ?? null,
        accumulating: slot.accumulating,
      },
    );

    let rawMu = (benchCagrPct - taxInfo.total_tax_drag_pct) / 100;
    let returnSource: ForecastPositionSizingRow["return_source"] = "unmodeled_default";
    let hasDossierView = false;
    let viewWarningsCount = 0;
    let dispersionSpread: number | null = null;
    let scenVol: number | null = null;

    if (th?.scenario_summary) {
      const s = th.scenario_summary;
      rawMu = Math.max(-0.2, Math.min(0.35, s.expected_after_tax_cagr_pct / 100));
      returnSource = "dossier_scenarios";
      hasDossierView = true;
      viewWarningsCount = s.valuation_warnings?.length ?? 0;
      const bearR = s.cases.bear.after_tax_cagr_pct / 100;
      const bullR = s.cases.bull.after_tax_cagr_pct / 100;
      const spread = Math.max(0.06, bullR - bearR);
      dispersionSpread = spread;
      scenVol = Math.max(0.14, Math.min(0.75, spread * 1.15));
    } else if (slot.ticker === benchTicker) {
      rawMu = benchCagrPct / 100;
      returnSource = "benchmark";
    } else if (slot.is_etf) {
      rawMu = (benchCagrPct - taxInfo.total_tax_drag_pct) / 100;
      returnSource = "etf_benchmark";
    } else {
      rawMu = (benchCagrPct + 0.5 - taxInfo.total_tax_drag_pct) / 100;
      returnSource = "unmodeled_default";
    }

    const retMap = buildWeeklyReturnMapByWeek(slot.ticker, slot.yf_symbol, historyCache);
    const empVol = computeAnnualizedVol(retMap);
    const fallbackVol = slot.is_etf ? 0.17 : 0.34;
    const rawVol =
      empVol !== null && scenVol !== null
        ? 0.65 * empVol + 0.35 * scenVol
        : (empVol ?? scenVol ?? fallbackVol);
    const vol = Math.max(0.08, Math.min(0.95, rawVol * volMult));

    return {
      key,
      slot,
      rawMu,
      mu: rawMu,
      hasDossierView,
      viewWarningsCount,
      dispersionSpread,
      vol,
      returnSource,
      retMap,
      qualityGrade: th?.quality_grade ?? null,
      maxWeightPct: th?.max_weight_pct ?? (slot.is_etf ? 70 : 12),
    };
  });

  // 5. Ledoit-Wolf Shrunk Correlation & Covariance Matrix
  const n = assets.length;
  const rawCorr: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  let pairwiseSum = 0;
  let pairwiseCount = 0;

  for (let i = 0; i < n; i += 1) {
    rawCorr[i]![i] = 1.0;
    for (let j = i + 1; j < n; j += 1) {
      const a = assets[i]!;
      const b = assets[j]!;
      let c = 0;
      if (a.slot.is_cash || b.slot.is_cash) {
        c = 0;
      } else if (canonicalAssetName(a.slot.ticker) === canonicalAssetName(b.slot.ticker)) {
        c = 0.96;
      } else {
        const res = computeSampleVolAndCorr(a.retMap, b.retMap);
        if (res.corr !== null) {
          c = res.corr;
        } else {
          c = a.slot.is_etf || b.slot.is_etf ? 0.68 : 0.52;
        }
      }
      rawCorr[i]![j] = c;
      rawCorr[j]![i] = c;
      if (!a.slot.is_cash && !b.slot.is_cash) {
        pairwiseSum += c;
        pairwiseCount += 1;
      }
    }
  }

  const avgCorr = pairwiseCount > 0 ? Math.max(0.1, Math.min(0.8, pairwiseSum / pairwiseCount)) : 0.45;
  const shrinkLambda = 0.25;
  const shrunkCorr: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const cov: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = assets[i]!;
      const b = assets[j]!;
      let corrIJ = rawCorr[i]![j]!;
      if (i !== j && !a.slot.is_cash && !b.slot.is_cash) {
        corrIJ = (1 - shrinkLambda) * corrIJ + shrinkLambda * avgCorr;
      }
      shrunkCorr[i]![j] = corrIJ;
      cov[i]![j] = a.vol * b.vol * corrIJ;
    }
  }

  const L = choleskyDecompose(cov);

  const baseStartVec = assets.map((a) => baselineMap.get(a.key)?.value_base ?? 0);
  const simStartVec = assets.map((a) => simMap.get(a.key)?.value_base ?? 0);
  const baseStartTotal = baseStartVec.reduce((acc, v) => acc + v, 0);
  const simStartTotal = simStartVec.reduce((acc, v) => acc + v, 0);
  const benchEndBase = round(baseStartTotal * Math.pow(1 + benchCagrPct / 100, horizon), 2);

  // 5b. Black-Litterman Posterior Expected Returns (Brier-Calibrated & GIGO-Adjusted)
  const eqTotal = Math.max(1, baseStartTotal);
  const blResult = computeBlackLittermanPosterior(
    assets.map((a, idx) => ({
      ticker: a.slot.ticker,
      is_cash: a.slot.is_cash,
      market_weight: (baseStartVec[idx] ?? 0) / eqTotal,
      raw_view_cagr: a.hasDossierView ? a.rawMu : null,
      view_warnings_count: a.viewWarningsCount,
      dispersion_spread: a.dispersionSpread,
    })),
    cov,
    {
      rfPct,
      benchmarkCagrPct: benchCagrPct,
      brierScore: opts?.brierScore ?? null,
      brierResolvedCount: opts?.brierResolvedCount ?? 0,
    },
  );

  if (returnModel === "black_litterman") {
    for (let i = 0; i < n; i += 1) {
      const a = assets[i]!;
      if (a.slot.is_cash) continue;
      if (a.slot.ticker === benchTicker && !a.hasDossierView) {
        a.mu = benchCagrPct / 100;
        continue;
      }
      const blAsset = blResult.assets[i]!;
      a.mu = blAsset.posterior_cagr_pct / 100;
      if (a.hasDossierView) {
        a.returnSource = "black_litterman";
      }
    }
  }

  // 5c. PCA Factor Risk Decomposition & Effective Bets (Before vs After) + HRP Benchmark Weights
  const tickersList = assets.map((a) => a.slot.ticker);
  const cashFlags = assets.map((a) => a.slot.is_cash);
  const benchAssetIdx = assets.findIndex((a) => !a.slot.is_cash && a.slot.ticker === benchTicker);
  const baseWeights = baseStartVec.map((v) => (baseStartTotal > 0 ? v / baseStartTotal : 0));
  const simWeights = simStartVec.map((v) => (simStartTotal > 0 ? v / simStartTotal : 0));

  const baseFactorRisk = computeFactorRiskDecomposition(
    tickersList,
    cashFlags,
    baseWeights,
    cov,
    benchAssetIdx >= 0 ? benchAssetIdx : null,
  );
  const simFactorRisk = computeFactorRiskDecomposition(
    tickersList,
    cashFlags,
    simWeights,
    cov,
    benchAssetIdx >= 0 ? benchAssetIdx : null,
  );

  const hrpActiveIndices = assets
    .map((a, idx) => ({ a, idx }))
    .filter((x) => !x.a.slot.is_cash && (simStartVec[x.idx] ?? 0) > 0.01)
    .map((x) => x.idx);
  const hrpSubCov = hrpActiveIndices.map((r) => hrpActiveIndices.map((c) => cov[r]![c]!));
  const hrpSubCorr = hrpActiveIndices.map((r) => hrpActiveIndices.map((c) => shrunkCorr[r]![c]!));
  const hrpRes = computeHrpWeights(
    hrpActiveIndices.map((idx) => ({
      ticker: assets[idx]!.slot.ticker,
      is_cash: false,
      max_weight_pct: assets[idx]!.maxWeightPct,
    })),
    hrpSubCov,
    hrpSubCorr,
  );

  // 6. Correlated Multi-Path Simulation (Politis-Romano Stationary Block Bootstrap or Student-t df=6)
  const simRun = runCorrelatedWealthSimulation({
    engineRequested: simEngineReq,
    blockLengthWeeks: blockLenWeeks,
    horizonYears: horizon,
    simulations,
    volMultiplier: volMult,
    assets: assets.map((a) => ({
      mu: a.mu,
      vol: a.vol,
      is_cash: a.slot.is_cash,
      retMap: a.retMap,
    })),
    cholL: L,
    baseStartVec,
    simStartVec,
    seed: 20260701 ^ (horizon * 31) ^ (simulations * 17) ^ (blockLenWeeks * 7),
  });

  const baseYearSamples = simRun.base_year_samples;
  const simYearSamples = simRun.sim_year_samples;

  const computeAnalyticalStats = (vec: number[], total: number): { volPct: number; sharpe: number; mrcPct: number[]; corrWithPort: number[] } => {
    const w = vec.map((v) => (total > 0 ? v / total : 0));
    const sigmaW = Array<number>(n).fill(0);
    let portVar = 0;
    let portMu = 0;
    for (let i = 0; i < n; i += 1) {
      portMu += w[i]! * assets[i]!.mu;
      let sw = 0;
      for (let j = 0; j < n; j += 1) {
        sw += cov[i]![j]! * w[j]!;
      }
      sigmaW[i] = sw;
      portVar += w[i]! * sw;
    }
    const portVol = Math.sqrt(Math.max(1e-8, portVar));
    const sharpe = portVol > 1e-6 ? round((portMu - rfPct / 100) / portVol, 2) : 0;
    const mrcPct = assets.map((_, i) => (portVar > 1e-9 ? round(((w[i]! * sigmaW[i]!) / portVar) * 100, 1) : 0));
    const corrWithPort = assets.map((a, i) =>
      a.slot.is_cash || portVol <= 1e-6 || a.vol <= 1e-6
        ? 0
        : round(Math.max(-1, Math.min(1, sigmaW[i]! / (a.vol * portVol))), 2),
    );
    return { volPct: round(portVol * 100, 2), sharpe, mrcPct, corrWithPort };
  };

  const baseAnalytics = computeAnalyticalStats(baseStartVec, baseStartTotal);
  const simAnalytics = computeAnalyticalStats(simStartVec, simStartTotal);

  const summarizePath = (
    yearSamples: number[][],
    pathMaxDds: number[],
    startTotal: number,
    analytics: { volPct: number; sharpe: number },
    riskTax: RiskTaxEvaluation,
    endingCashBase: number,
    factorRisk: FactorRiskDecomposition,
  ): ForecastPathSummary => {
    const trajectory: ForecastYearPoint[] = yearSamples.map((arr, yr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mean = arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
      return {
        year: yr,
        p10_base: round(quantile(sorted, 0.1), 0),
        p25_base: round(quantile(sorted, 0.25), 0),
        p50_base: round(quantile(sorted, 0.5), 0),
        p75_base: round(quantile(sorted, 0.75), 0),
        p90_base: round(quantile(sorted, 0.9), 0),
        mean_base: round(mean, 0),
      };
    });

    const finalSamples = yearSamples[horizon] ?? [startTotal];
    const sortedFinal = [...finalSamples].sort((a, b) => a - b);
    const tailCount = Math.max(1, Math.floor(sortedFinal.length * 0.1));
    let tailSum = 0;
    for (let i = 0; i < tailCount; i += 1) tailSum += sortedFinal[i]!;
    const cvar10Base = round(tailSum / tailCount, 0);

    const sortedDd = [...pathMaxDds].sort((a, b) => a - b); // most negative first
    const ddP95 = sortedDd.length > 0 ? round(quantile(sortedDd, 0.05), 1) : 0;
    const ddP50 = sortedDd.length > 0 ? round(quantile(sortedDd, 0.5), 1) : 0;

    const finalPt = trajectory[horizon]!;
    const safeStart = Math.max(1, startTotal);
    const cagrFrom = (endVal: number) => round((Math.pow(Math.max(0.01, endVal / safeStart), 1 / horizon) - 1) * 100, 2);
    const beatCount = finalSamples.filter((v) => v >= benchEndBase).length;
    const lossCount = finalSamples.filter((v) => v < startTotal).length;

    return {
      starting_wealth_base: round(startTotal, 2),
      ending_cvar_10_base: cvar10Base,
      ending_p10_base: finalPt.p10_base,
      ending_p50_base: finalPt.p50_base,
      ending_p90_base: finalPt.p90_base,
      ending_mean_base: finalPt.mean_base,
      expected_cagr_p50_pct: cagrFrom(finalPt.p50_base),
      p10_cagr_pct: cagrFrom(finalPt.p10_base),
      p90_cagr_pct: cagrFrom(finalPt.p90_base),
      sim_max_dd_p50_pct: ddP50,
      sim_max_dd_p95_pct: ddP95,
      annual_vol_pct: analytics.volPct,
      expected_sharpe: analytics.sharpe,
      prob_beat_benchmark_pct: round((beatCount / Math.max(1, finalSamples.length)) * 100, 1),
      prob_loss_pct: round((lossCount / Math.max(1, finalSamples.length)) * 100, 1),
      us_situs_portfolio_pct: riskTax.us_situs_portfolio_pct,
      estate_tax_base: riskTax.estate_tax_base,
      annual_wht_drag_base: riskTax.annual_wht_drag_base,
      cap_breaches_count: riskTax.cap_breaches_count,
      breached_cap_labels: riskTax.breached_cap_labels,
      ending_cash_base: round(endingCashBase, 2),
      factor_risk: factorRisk,
      trajectory,
    };
  };

  const baseSummary = summarizePath(
    baseYearSamples,
    simRun.base_path_max_dd_pct,
    baseStartTotal,
    baseAnalytics,
    baseRiskTax,
    baselineMap.get("__CASH__")?.value_base ?? 0,
    baseFactorRisk,
  );
  const simSummary = summarizePath(
    simYearSamples,
    simRun.sim_path_max_dd_pct,
    simStartTotal,
    simAnalytics,
    simRiskTax,
    simMap.get("__CASH__")?.value_base ?? 0,
    simFactorRisk,
  );

  const simBreachSet = new Set(simRiskTax.breached_cap_labels);
  const curedCaps = baseRiskTax.breached_cap_labels.filter((l) => !simBreachSet.has(l));
  const baseHurdlePct = (profile.benchmark.expected_cagr_pct ?? 8.0) + (profile.benchmark.alpha_buffer_pct ?? 2.5);

  const positionRows: ForecastPositionSizingRow[] = assets
    .map((a, idx) => {
      const bVal = baseStartVec[idx]!;
      const sVal = simStartVec[idx]!;
      const corrP = simAnalytics.corrWithPort[idx]!;
      const corrAdjHurdle = a.slot.is_cash
        ? rfPct
        : a.slot.ticker === benchTicker
          ? benchCagrPct
          : round(Math.max(benchCagrPct, baseHurdlePct + (corrP - 0.55) * 3.0), 2);
      const excessMu = a.mu - rfPct / 100;
      const varI = Math.max(0.01, a.vol * a.vol);
      const rawQuarterKellyPct =
        a.slot.is_cash || excessMu <= 0
          ? 0
          : (0.25 * (excessMu / varI) * (1 - 0.3 * Math.max(0, corrP - 0.5))) * 100;
      const boundedKelly = round(Math.max(0, Math.min(a.maxWeightPct, rawQuarterKellyPct)), 1);
      const blRow = blResult.assets[idx]!;

      return {
        ticker: a.slot.ticker,
        is_external: a.slot.is_external,
        is_cash: a.slot.is_cash,
        before_value_base: round(bVal, 2),
        after_value_base: round(sVal, 2),
        before_weight_pct: baseStartTotal > 0 ? round((bVal / baseStartTotal) * 100, 2) : 0,
        after_weight_pct: simStartTotal > 0 ? round((sVal / simStartTotal) * 100, 2) : 0,
        expected_cagr_pct: round(a.mu * 100, 2),
        prior_cagr_pct: blRow.prior_cagr_pct,
        raw_view_cagr_pct: blRow.raw_view_cagr_pct,
        bl_shrinkage_pct: blRow.shrinkage_pct,
        annual_vol_pct: round(a.vol * 100, 1),
        return_source: a.returnSource,
        marginal_risk_contrib_pct: simAnalytics.mrcPct[idx]!,
        corr_with_portfolio: corrP,
        corr_adjusted_hurdle_pct: corrAdjHurdle,
        quarter_kelly_weight_pct: boundedKelly,
        hrp_weight_pct: a.slot.is_cash ? 0 : (hrpRes.weights_by_ticker[a.slot.ticker] ?? 0),
        quality_grade: a.qualityGrade,
      };
    })
    .sort((a, b) => b.after_value_base - a.after_value_base);

  const engineLabel =
    simRun.engine_used === "block_bootstrap"
      ? `Politis-Romano Stationary Block Bootstrap (L=${blockLenWeeks}w across ${simRun.aligned_weeks} aligned weeks)`
      : `Correlated Student-t (df=6) weekly shocks${simEngineReq === "block_bootstrap" ? ` (fallback: ${simRun.aligned_weeks}w < 80w aligned)` : ""}`;
  const retLabel = returnModel === "black_litterman" ? "Black-Litterman Brier-calibrated posterior" : "Raw 5Y dossier scenarios";

  return {
    horizon_years: horizon,
    base_currency: profile.base_currency,
    include_external_wealth: includeExt,
    regime_vol_multiplier: round(volMult, 2),
    return_model: returnModel,
    simulation_engine_requested: simEngineReq,
    simulation_engine_used: simRun.engine_used,
    block_length_weeks: blockLenWeeks,
    aligned_history_weeks: simRun.aligned_weeks,
    simulations,
    rf_pct: rfPct,
    benchmark_ticker: benchTicker,
    benchmark_cagr_pct: benchCagrPct,
    benchmark_ending_base: benchEndBase,
    black_litterman: blResult,
    baseline: baseSummary,
    simulated: simSummary,
    deltas: {
      p50_base: round(simSummary.ending_p50_base - baseSummary.ending_p50_base, 0),
      p10_base: round(simSummary.ending_p10_base - baseSummary.ending_p10_base, 0),
      cvar_10_base: round(simSummary.ending_cvar_10_base - baseSummary.ending_cvar_10_base, 0),
      p90_base: round(simSummary.ending_p90_base - baseSummary.ending_p90_base, 0),
      cagr_p50_pct: round(simSummary.expected_cagr_p50_pct - baseSummary.expected_cagr_p50_pct, 2),
      annual_vol_pct: round(simSummary.annual_vol_pct - baseSummary.annual_vol_pct, 2),
      sharpe: round(simSummary.expected_sharpe - baseSummary.expected_sharpe, 2),
      effective_bets: round(simFactorRisk.effective_bets - baseFactorRisk.effective_bets, 2),
      estate_tax_saved_base: round(baseSummary.estate_tax_base - simSummary.estate_tax_base, 2),
      annual_wht_saved_base: round(baseSummary.annual_wht_drag_base - simSummary.annual_wht_drag_base, 2),
      us_situs_delta_pct: round(simSummary.us_situs_portfolio_pct - baseSummary.us_situs_portfolio_pct, 2),
      cap_breaches_delta: simSummary.cap_breaches_count - baseSummary.cap_breaches_count,
      cured_caps: curedCaps,
      remaining_breached_caps: simRiskTax.breached_cap_labels,
    },
    applied_actions: appliedLog,
    cash_shortfall_base: cashShortfallBase,
    positions: positionRows,
    methodology_note: `Seeded ${simulations}-path ${engineLabel} using Ledoit-Wolf shrunk covariance (λ=0.25), ${retLabel}, Rf=${rfPct}%, Vol×${round(volMult, 2)}. Forecast cones reflect modeled assumptions & historical covariance, not guarantees.`,
  };
}
