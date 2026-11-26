import { lookupHistorySeries, round } from "./quant.js";
import {
  computeHigherMoments,
  computeHrpWeights,
  computeKupiecPofTest,
  computeLedoitWolfConstantCorr,
  computePinballLoss,
  computePolitisWhiteBlockLength,
  computeQlikeLoss,
} from "./quant_sota.js";
import type {
  HistoryCacheState,
  HistoryPoint,
  HistorySeries,
  PortfolioRecord,
  UserProfile,
} from "./schema.js";

export interface QuantEvalRequest {
  horizon_weeks?: 13 | 26;
  tx_cost_bps?: number;
  include_external_wealth?: boolean;
  demo?: boolean;
}

export interface CovarianceEvalRow {
  method: "sample_cov" | "fixed_025_shrink" | "analytical_lw";
  label: string;
  realized_to_predicted_vol_ratio: number;
  qlike_loss: number;
  vol_rmse_pct: number;
  is_winner: boolean;
}

export interface TailEvalRow {
  engine: "block_bootstrap" | "student_t_df6" | "gaussian_normal";
  label: string;
  breaches: number;
  total_windows: number;
  var95_breach_rate_pct: number;
  kupiec_pof_pvalue: number;
  kupiec_calibrated: boolean;
  mean_pinball_loss_pct: number;
  coverage_80_pct: number;
  cvar95_shortfall_ratio: number | null;
  is_winner: boolean;
}

export interface AllocationHorseRaceRow {
  strategy: "current_weights" | "hrp_lw" | "inv_vol" | "equal_weight";
  label: string;
  oos_cagr_pct: number;
  oos_vol_pct: number;
  oos_max_dd_pct: number;
  oos_sharpe: number;
  oos_cvar95_weekly_pct: number;
  annual_turnover_pct: number;
}

export interface QuantWalkForwardEvalResult {
  status: "CALIBRATED" | "WARN" | "INSUFFICIENT_HISTORY";
  horizon_weeks: number;
  tx_cost_bps: number;
  include_external_wealth: boolean;
  assets_included: string[];
  assets_excluded: string[];
  aligned_weeks: number;
  warmup_weeks: number;
  windows_evaluated: number;
  date_range: { start: string; end: string } | null;
  avg_lw_lambda: number | null;
  avg_auto_block_length: number | null;
  covariance_eval: CovarianceEvalRow[];
  tail_eval: TailEvalRow[];
  allocation_horse_race: AllocationHorseRaceRow[];
  findings: string[];
  methodology_note: string;
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

const isoWeekCache = new Map<string, string>();

function isoWeekMonday(dateStr: string): string {
  const cached = isoWeekCache.get(dateStr);
  if (cached !== undefined) return cached;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDay();
  const diff = day === 0 ? 1 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  const res = d.toISOString().slice(0, 10);
  if (isoWeekCache.size < 4096) isoWeekCache.set(dateStr, res);
  return res;
}

function dropIncompleteCurrentWeek(points: HistoryPoint[], updatedAtIso: string | null): HistoryPoint[] {
  if (points.length < 13 || !updatedAtIso) return points;
  const updMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(updMs)) return points;
  const updDate = new Date(updMs);
  const updDay = updDate.getUTCDay();
  const updWeek = isoWeekMonday(updDate.toISOString().slice(0, 10));
  const lastPt = points[points.length - 1]!;
  const lastWeek = isoWeekMonday(lastPt.date);
  if (lastWeek !== updWeek) return points;

  const prevWeek = isoWeekMonday(points[points.length - 2]!.date);
  const isMidWeekUpdate = (updDay >= 1 && updDay <= 4) || (updDay === 5 && updDate.getUTCHours() < 20);
  const isExactMidnightSynthetic =
    updDate.getUTCHours() === 0 &&
    updDate.getUTCMinutes() === 0 &&
    updDate.getUTCSeconds() === 0 &&
    prevWeek !== lastWeek;

  if (isMidWeekUpdate && !isExactMidnightSynthetic) {
    return points.filter((p) => isoWeekMonday(p.date) < updWeek);
  }
  return points;
}

function bucketSeriesByWeek(series: HistorySeries): Map<string, number> {
  const cleaned = dropIncompleteCurrentWeek(series.points, series.updated_at);
  const out = new Map<string, number>();
  for (const pt of cleaned) {
    if (!Number.isFinite(pt.close) || pt.close <= 0) continue;
    out.set(isoWeekMonday(pt.date), pt.close);
  }
  return out;
}

function convertWeekMapToUsd(
  wkMap: Map<string, number>,
  currency: string,
  historyCache: HistoryCacheState,
): { converted: Map<string, number>; fxApplied: boolean } {
  const ccy = currency.trim().toUpperCase();
  if (!ccy || ccy === "USD") {
    return { converted: wkMap, fxApplied: false };
  }
  const fxSeries = lookupHistorySeries(historyCache, `${ccy}USD=X`);
  if (!fxSeries || fxSeries.points.length < 2) {
    return { converted: wkMap, fxApplied: false };
  }
  const fxWkMap = bucketSeriesByWeek(fxSeries);
  const fxWeeksAsc = Array.from(fxWkMap.keys()).sort();
  if (fxWeeksAsc.length === 0) {
    return { converted: wkMap, fxApplied: false };
  }

  const out = new Map<string, number>();
  let fxIdx = 0;
  const assetWeeksAsc = Array.from(wkMap.keys()).sort();
  for (const wk of assetWeeksAsc) {
    const px = wkMap.get(wk)!;
    let fxRate = fxWkMap.get(wk);
    if (fxRate === undefined) {
      while (fxIdx + 1 < fxWeeksAsc.length && fxWeeksAsc[fxIdx + 1]! <= wk) {
        fxIdx += 1;
      }
      const nearestWk = fxWeeksAsc[fxIdx]!;
      const gapDays = Math.abs(Date.parse(`${wk}T00:00:00Z`) - Date.parse(`${nearestWk}T00:00:00Z`)) / 86400000;
      if (gapDays <= 14) {
        fxRate = fxWkMap.get(nearestWk);
      }
    }
    if (fxRate !== undefined && fxRate > 0) {
      out.set(wk, px * fxRate);
    }
  }
  return out.size >= 12 ? { converted: out, fxApplied: true } : { converted: wkMap, fxApplied: false };
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
        L[i]![i] = Math.sqrt(Math.max(1e-12, diag));
      } else {
        const denom = L[j]![j]!;
        L[i]![j] = denom > 1e-12 ? (matrix[i]![j]! - sum) / denom : 0;
      }
    }
  }
  return L;
}

function mulberry32(seedInit: number): () => number {
  let a = seedInit >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillStandardNormals(rng: () => number, out: Float64Array, count: number): void {
  let i = 0;
  while (i < count) {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = 2 * rng() - 1;
      v = 2 * rng() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s <= 1e-18);
    const mul = Math.sqrt((-2.0 * Math.log(s)) / s);
    out[i] = u * mul;
    if (i + 1 < count) out[i + 1] = v * mul;
    i += 2;
  }
}

function sampleStudentTScale(rng: () => number): number {
  // df = 6 -> 3 pairs of standard normals (zero heap allocations)
  let chi2 = 0;
  for (let p = 0; p < 3; p += 1) {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = 2 * rng() - 1;
      v = 2 * rng() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s <= 1e-18);
    chi2 += -2.0 * Math.log(s);
  }
  return Math.sqrt(4 / Math.max(0.25, chi2));
}

function quantile(sorted: Float64Array, p: number): number {
  const len = sorted.length;
  if (len === 0) return 0;
  if (len === 1) return sorted[0]!;
  const idx = (len - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function portfolioVariance(w: number[], cov: number[][]): number {
  const n = w.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const wi = w[i]!;
    if (wi === 0) continue;
    let rowSum = 0;
    const covRow = cov[i]!;
    for (let j = 0; j < n; j += 1) {
      rowSum += covRow[j]! * w[j]!;
    }
    total += wi * rowSum;
  }
  return Math.max(1e-12, total);
}

function normalizeWeights(w: number[]): number[] {
  const sum = w.reduce((acc, v) => acc + Math.max(0, v), 0);
  if (sum <= 1e-12) {
    return w.map(() => (w.length > 0 ? 1 / w.length : 0));
  }
  return w.map((v) => Math.max(0, v) / sum);
}

interface CandidateAsset {
  ticker: string;
  yfSymbol: string;
  mvBase: number;
  wkMap: Map<string, number>;
  firstWeek: string;
  lastWeek: string;
  fxApplied: boolean;
  missingFx: boolean;
}

function buildInsufficientHistoryResult(params: {
  horizonWeeks: number;
  txCostBps: number;
  includeExt: boolean;
  assetsIncluded: string[];
  assetsExcluded: string[];
  alignedWeeks: number;
  warmupWeeks: number;
  dateRange: { start: string; end: string } | null;
  findings: string[];
}): QuantWalkForwardEvalResult {
  const {
    horizonWeeks,
    txCostBps,
    includeExt,
    assetsIncluded,
    assetsExcluded,
    alignedWeeks,
    warmupWeeks,
    dateRange,
    findings,
  } = params;
  return {
    status: "INSUFFICIENT_HISTORY",
    horizon_weeks: horizonWeeks,
    tx_cost_bps: txCostBps,
    include_external_wealth: includeExt,
    assets_included: assetsIncluded,
    assets_excluded: assetsExcluded,
    aligned_weeks: alignedWeeks,
    warmup_weeks: warmupWeeks,
    windows_evaluated: 0,
    date_range: dateRange,
    avg_lw_lambda: null,
    avg_auto_block_length: null,
    covariance_eval: [],
    tail_eval: [],
    allocation_horse_race: [],
    findings,
    methodology_note: `Walk-forward evaluation requires at least 2 risky assets and >= ${warmupWeeks + horizonWeeks * 2} aligned weekly returns (${warmupWeeks}w warmup + 2x ${horizonWeeks}w OOS windows).`,
  };
}

/**
 * Strictly zero-lookahead expanding-window walk-forward evaluation harness comparing:
 * 1. Covariance accuracy (Sample vs Fixed-0.25 Shrinkage vs Analytical Ledoit-Wolf 2004),
 * 2. Tail simulation calibration (Politis-White Block Bootstrap vs Student-t df=6 vs Gaussian),
 * 3. Out-of-sample allocation horse race (Current Weights vs HRP-LW vs Inv-Vol vs Equal-Weight).
 */
export function runQuantWalkForwardEvaluation(
  req: QuantEvalRequest,
  portfolio: PortfolioRecord,
  profile: UserProfile,
  historyCache: HistoryCacheState,
  fxRates: Record<string, number>,
  opts?: { defaultRfPct?: number; livePricesMap?: Map<string, number> },
): QuantWalkForwardEvalResult {
  const horizonWeeks = req.horizon_weeks === 26 ? 26 : 13;
  const txCostBps = Number.isFinite(req.tx_cost_bps) ? clamp(req.tx_cost_bps!, 0, 100) : 10;
  const includeExt = req.include_external_wealth !== false;
  const rfPct = opts?.defaultRfPct ?? 4.0;
  const warmupWeeks = 52;
  const minRequiredWeeks = warmupWeeks + horizonWeeks * 2;
  const fxUsdToBase = fxRates.USD && fxRates.USD > 0 ? fxRates.USD : 1.0;

  // 1. Collect risky positions (plus external equity when enabled)
  const assetAgg = new Map<string, { ticker: string; yfSymbol: string; mvBase: number }>();
  for (const pos of portfolio.positions) {
    const ticker = pos.ticker.trim().toUpperCase();
    if (!ticker || ticker === "CASH") continue;
    const yfLookup = (pos.yf_symbol || ticker).trim();
    const livePx =
      opts?.livePricesMap?.get(ticker) ??
      opts?.livePricesMap?.get(yfLookup) ??
      opts?.livePricesMap?.get(yfLookup.toUpperCase()) ??
      pos.ref_price;
    const ccyFx = fxRates[pos.currency] ?? fxUsdToBase;
    const mvBase = Math.max(0, pos.qty * livePx * ccyFx);
    if (mvBase <= 0) continue;
    const prev = assetAgg.get(ticker);
    assetAgg.set(ticker, {
      ticker,
      yfSymbol: prev?.yfSymbol || pos.yf_symbol || ticker,
      mvBase: (prev?.mvBase ?? 0) + mvBase,
    });
  }

  const ext = profile.external_exposure;
  if (includeExt && ext.enabled && ext.ticker && ext.amount_base > 0) {
    const extTicker = ext.ticker.trim().toUpperCase();
    if (extTicker && extTicker !== "CASH") {
      const prev = assetAgg.get(extTicker);
      assetAgg.set(extTicker, {
        ticker: extTicker,
        yfSymbol: prev?.yfSymbol || extTicker,
        mvBase: (prev?.mvBase ?? 0) + ext.amount_base,
      });
    }
  }

  const excluded: string[] = [];
  const candidates: CandidateAsset[] = [];

  for (const entry of assetAgg.values()) {
    const series = lookupHistorySeries(historyCache, entry.yfSymbol, entry.ticker);
    if (!series || series.points.length < minRequiredWeeks + 1) {
      excluded.push(entry.ticker);
      continue;
    }
    const rawWkMap = bucketSeriesByWeek(series);
    const conv = convertWeekMapToUsd(rawWkMap, series.currency, historyCache);
    const wkMap = conv.converted;
    if (wkMap.size < minRequiredWeeks + 1) {
      excluded.push(entry.ticker);
      continue;
    }
    const keys = Array.from(wkMap.keys()).sort();
    candidates.push({
      ticker: entry.ticker,
      yfSymbol: entry.yfSymbol,
      mvBase: entry.mvBase,
      wkMap,
      firstWeek: keys[0]!,
      lastWeek: keys[keys.length - 1]!,
      fxApplied: conv.fxApplied,
      missingFx: series.currency.toUpperCase() !== "USD" && !conv.fxApplied,
    });
  }

  if (candidates.length < 2) {
    return buildInsufficientHistoryResult({
      horizonWeeks,
      txCostBps,
      includeExt,
      assetsIncluded: candidates.map((c) => c.ticker),
      assetsExcluded: excluded,
      alignedWeeks: 0,
      warmupWeeks,
      dateRange: null,
      findings: [
        `Only ${candidates.length} risky asset(s) have >= ${minRequiredWeeks + 1} weekly bars; need at least 2 risky assets for cross-asset covariance and walk-forward scoring.`,
        ...(excluded.length > 0 ? [`Excluded for short/missing history: ${excluded.join(", ")}.`] : []),
      ],
    });
  }

  // Greedily drop the bottleneck asset if common overlap across all candidates is < minRequiredWeeks + 1
  const computeOverlapBounds = (pool: CandidateAsset[]): { start: string; end: string; count: number } => {
    let start = pool[0]!.firstWeek;
    let end = pool[0]!.lastWeek;
    for (const c of pool) {
      if (c.firstWeek > start) start = c.firstWeek;
      if (c.lastWeek < end) end = c.lastWeek;
    }
    const baseKeys = Array.from(pool[0]!.wkMap.keys()).filter((w) => w >= start && w <= end);
    return { start, end, count: baseKeys.length };
  };

  let activePool = [...candidates];
  while (activePool.length > 2) {
    const bounds = computeOverlapBounds(activePool);
    if (bounds.count >= minRequiredWeeks + 1) break;
    // Remove the candidate whose removal maximizes remaining overlap count (tie-break: lowest weight)
    let bestDropIdx = 0;
    let bestAfterCount = -1;
    let bestDropMv = Number.POSITIVE_INFINITY;
    for (let i = 0; i < activePool.length; i += 1) {
      const subset = activePool.filter((_, idx) => idx !== i);
      const subBounds = computeOverlapBounds(subset);
      const mv = activePool[i]!.mvBase;
      if (subBounds.count > bestAfterCount || (subBounds.count === bestAfterCount && mv < bestDropMv)) {
        bestAfterCount = subBounds.count;
        bestDropIdx = i;
        bestDropMv = mv;
      }
    }
    const [dropped] = activePool.splice(bestDropIdx, 1);
    if (dropped) excluded.push(dropped.ticker);
  }

  const finalBounds = computeOverlapBounds(activePool);
  const allWeekSet = new Set<string>();
  for (const c of activePool) {
    for (const w of c.wkMap.keys()) {
      if (w >= finalBounds.start && w <= finalBounds.end) {
        allWeekSet.add(w);
      }
    }
  }
  const sortedCandidateWeeks = Array.from(allWeekSet).sort();

  const alignedDates: string[] = [];
  const alignedPrices: number[][] = activePool.map(() => []);
  const lastSeen = new Float64Array(activePool.length);
  const hasSeen = new Uint8Array(activePool.length);
  const carryStreak = new Uint8Array(activePool.length);

  for (const wk of sortedCandidateWeeks) {
    let valid = true;
    const rowPx = new Float64Array(activePool.length);
    const nextStreak = new Uint8Array(activePool.length);
    for (let i = 0; i < activePool.length; i += 1) {
      const exact = activePool[i]!.wkMap.get(wk);
      if (exact !== undefined && exact > 0) {
        rowPx[i] = exact;
        nextStreak[i] = 0;
      } else if (hasSeen[i] === 1 && carryStreak[i]! < 1) {
        rowPx[i] = lastSeen[i]!;
        nextStreak[i] = (carryStreak[i]! + 1) as number;
      } else {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    alignedDates.push(wk);
    for (let i = 0; i < activePool.length; i += 1) {
      lastSeen[i] = rowPx[i]!;
      hasSeen[i] = 1;
      carryStreak[i] = nextStreak[i]!;
      alignedPrices[i]!.push(rowPx[i]!);
    }
  }

  const T = Math.max(0, alignedDates.length - 1);
  if (T < minRequiredWeeks) {
    return buildInsufficientHistoryResult({
      horizonWeeks,
      txCostBps,
      includeExt,
      assetsIncluded: activePool.map((c) => c.ticker),
      assetsExcluded: excluded,
      alignedWeeks: T,
      warmupWeeks,
      dateRange: alignedDates.length >= 2 ? { start: alignedDates[0]!, end: alignedDates[alignedDates.length - 1]! } : null,
      findings: [
        `Aligned history has ${T} weekly returns; need at least ${minRequiredWeeks} (${warmupWeeks}w warmup + 2x ${horizonWeeks}w OOS windows).`,
        ...(excluded.length > 0 ? [`Excluded shorter-history holdings: ${excluded.join(", ")}.`] : []),
      ],
    });
  }

  const N = activePool.length;
  const returnsMatrix: number[][] = Array.from({ length: T }, (_, t) =>
    Array.from({ length: N }, (_, i) => {
      const p0 = alignedPrices[i]![t]!;
      const p1 = alignedPrices[i]![t + 1]!;
      const r = p0 > 0 && p1 > 0 ? Math.log(p1 / p0) : 0;
      return Number.isFinite(r) ? clamp(r, -1.2, 1.2) : 0;
    }),
  );

  const currentWeights = normalizeWeights(activePool.map((c) => c.mvBase));
  const assetsIncluded = activePool.map((c) => c.ticker);
  const dateRange = { start: alignedDates[0]!, end: alignedDates[alignedDates.length - 1]! };

  // Build non-overlapping window origins t = W0, W0 + h, ... <= T - h
  const origins: number[] = [];
  for (let t = warmupWeeks; t <= T - horizonWeeks; t += horizonWeeks) {
    origins.push(t);
  }
  const windowsEvaluated = origins.length;

  // Covariance accumulators
  type CovKey = "sample_cov" | "fixed_025_shrink" | "analytical_lw";
  const covStats: Record<
    CovKey,
    { label: string; predVols: number[]; realVols: number[]; qlikeSum: number; sqErrSum: number }
  > = {
    sample_cov: { label: "Sample Covariance (1/(T-1))", predVols: [], realVols: [], qlikeSum: 0, sqErrSum: 0 },
    fixed_025_shrink: { label: "Fixed 0.25 Constant-Corr Shrink", predVols: [], realVols: [], qlikeSum: 0, sqErrSum: 0 },
    analytical_lw: { label: "Analytical Ledoit-Wolf (2004)", predVols: [], realVols: [], qlikeSum: 0, sqErrSum: 0 },
  };

  // Tail accumulators
  type EngineKey = "block_bootstrap" | "student_t_df6" | "gaussian_normal";
  const tailStats: Record<
    EngineKey,
    {
      label: string;
      breaches: number;
      covered80: number;
      pinballSum: number;
      breachRealized: number[];
      breachPredCvar: number[];
    }
  > = {
    block_bootstrap: {
      label: "Politis-White Block Bootstrap",
      breaches: 0,
      covered80: 0,
      pinballSum: 0,
      breachRealized: [],
      breachPredCvar: [],
    },
    student_t_df6: {
      label: "Correlated Student-t (df=6)",
      breaches: 0,
      covered80: 0,
      pinballSum: 0,
      breachRealized: [],
      breachPredCvar: [],
    },
    gaussian_normal: {
      label: "Correlated Gaussian Normal",
      breaches: 0,
      covered80: 0,
      pinballSum: 0,
      breachRealized: [],
      breachPredCvar: [],
    },
  };

  // Allocation horse-race state
  type StratKey = "current_weights" | "hrp_lw" | "inv_vol" | "equal_weight";
  const stratState: Record<
    StratKey,
    { label: string; equity: number; curW: number[]; weeklyRets: number[]; totalTurnover: number }
  > = {
    current_weights: { label: "Current Weights (Hindsight Ref)", equity: 1, curW: [...currentWeights], weeklyRets: [], totalTurnover: 0 },
    hrp_lw: { label: "HRP (Ledoit-Wolf Cov/Corr, 35% Cap)", equity: 1, curW: Array<number>(N).fill(1 / N), weeklyRets: [], totalTurnover: 0 },
    inv_vol: { label: "Inverse Volatility", equity: 1, curW: Array<number>(N).fill(1 / N), weeklyRets: [], totalTurnover: 0 },
    equal_weight: { label: "Equal Weight (1/N)", equity: 1, curW: Array<number>(N).fill(1 / N), weeklyRets: [], totalTurnover: 0 },
  };

  // Reusable simulation buffers (zero allocation inside inner loops)
  const nSims = 500;
  const zBuf = new Float64Array(N);
  const cumLog = new Float64Array(N);
  const simBoot = new Float64Array(nSims);
  const simStud = new Float64Array(nSims);
  const simGauss = new Float64Array(nSims);
  const centeredFlat = new Float64Array(T * N);
  const cholFlat = new Float64Array(N * N);
  const retFlat = new Float64Array(T * N);
  for (let t = 0; t < T; t += 1) {
    const row = returnsMatrix[t]!;
    const off = t * N;
    for (let i = 0; i < N; i += 1) retFlat[off + i] = row[i]!;
  }
  const curWArr = new Float64Array(currentWeights);

  let lambdaSum = 0;
  let blockLenSum = 0;

  // Precompute portfolio weekly log returns
  const portWeeklyLogRets = new Float64Array(T);
  for (let t = 0; t < T; t += 1) {
    const off = t * N;
    let pRet = 0;
    for (let i = 0; i < N; i += 1) pRet += curWArr[i]! * retFlat[off + i]!;
    portWeeklyLogRets[t] = pRet;
  }

  for (let wIdx = 0; wIdx < windowsEvaluated; wIdx += 1) {
    const t = origins[wIdx]!;
    const trainSlice = returnsMatrix.slice(0, t);

    // 1. Fit strictly on [0..t-1]
    const lw = computeLedoitWolfConstantCorr(trainSlice);
    lambdaSum += lw.lambda;

    const unbiasedScale = t / Math.max(1, t - 1);
    const stdUnbiasedScale = Math.sqrt(unbiasedScale);
    const lwCovUnbiased: number[][] = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => lw.cov[i]![j]! * unbiasedScale),
    );
    const sampleCov: number[][] = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => lw.sample_cov[i]![j]! * unbiasedScale),
    );
    const stdUnbiased = Array.from({ length: N }, (_, i) => Math.sqrt(Math.max(1e-12, sampleCov[i]![i]!)));
    const fixed025Cov: number[][] = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => {
        if (i === j) return sampleCov[i]![i]!;
        const fIJ = lw.avg_corr * stdUnbiased[i]! * stdUnbiased[j]!;
        return 0.75 * sampleCov[i]![j]! + 0.25 * fIJ;
      }),
    );

    // Realized h-week portfolio variance & annualized vol over [t, t + h)
    let realMeanW = 0;
    for (let s = t; s < t + horizonWeeks; s += 1) {
      realMeanW += portWeeklyLogRets[s]!;
    }
    realMeanW /= horizonWeeks;
    let realSqSum = 0;
    for (let s = t; s < t + horizonWeeks; s += 1) {
      const d = portWeeklyLogRets[s]! - realMeanW;
      realSqSum += d * d;
    }
    const realWeeklyVar = Math.max(1e-10, realSqSum / Math.max(1, horizonWeeks - 1));
    const realHVar = horizonWeeks * realWeeklyVar;
    const realAnnVolPct = Math.sqrt(52 * realWeeklyVar) * 100;

    const covEvaluators: Array<[CovKey, number[][]]> = [
      ["sample_cov", sampleCov],
      ["fixed_025_shrink", fixed025Cov],
      ["analytical_lw", lwCovUnbiased],
    ];
    for (const [key, mat] of covEvaluators) {
      const predWeeklyVar = portfolioVariance(currentWeights, mat);
      const predHVar = horizonWeeks * predWeeklyVar;
      const predAnnVolPct = Math.sqrt(52 * predWeeklyVar) * 100;
      const entry = covStats[key];
      entry.predVols.push(predAnnVolPct);
      entry.realVols.push(realAnnVolPct);
      entry.qlikeSum += computeQlikeLoss(realHVar, predHVar);
      const err = predAnnVolPct - realAnnVolPct;
      entry.sqErrSum += err * err;
    }

    // 2. Tail Calibration on [0..t-1]
    const pastPortSeries = Array.from(portWeeklyLogRets.subarray(0, t));
    const pw = computePolitisWhiteBlockLength(pastPortSeries);
    blockLenSum += pw.block_length_weeks;

    const trainMeans = new Float64Array(N);
    for (let u = 0; u < t; u += 1) {
      const off = u * N;
      for (let i = 0; i < N; i += 1) trainMeans[i]! += retFlat[off + i]!;
    }
    for (let i = 0; i < N; i += 1) trainMeans[i] = trainMeans[i]! / t;

    for (let u = 0; u < t; u += 1) {
      const off = u * N;
      for (let i = 0; i < N; i += 1) {
        centeredFlat[off + i] = (retFlat[off + i]! - trainMeans[i]!) * stdUnbiasedScale;
      }
    }

    // Realized demeaned h-week buy-and-hold portfolio return over [t, t + h)
    let realizedDemeanedRet = 0;
    for (let i = 0; i < N; i += 1) {
      let assetCumLog = 0;
      const mI = trainMeans[i]!;
      for (let s = t; s < t + horizonWeeks; s += 1) {
        assetCumLog += retFlat[s * N + i]! - mI;
      }
      const cLog = assetCumLog < -4 ? -4 : assetCumLog > 4 ? 4 : assetCumLog;
      realizedDemeanedRet += curWArr[i]! * (Math.exp(cLog) - 1);
    }

    const cholL = choleskyDecompose(lwCovUnbiased);
    for (let i = 0; i < N; i += 1) {
      const rowL = cholL[i]!;
      const off = i * N;
      for (let j = 0; j <= i; j += 1) cholFlat[off + j] = rowL[j]!;
    }
    const pNewBlock = 1 / Math.max(2, pw.block_length_weeks);
    const baseSeed = (20261127 ^ Math.imul(t + 1, 2654435761) ^ Math.imul(horizonWeeks, 1013904223)) >>> 0;

    const rngBoot = mulberry32(baseSeed ^ 0x11111111);
    const rngStud = mulberry32(baseSeed ^ 0x22222222);
    const rngGauss = mulberry32(baseSeed ^ 0x33333333);

    // Engine 1: Block bootstrap
    for (let p = 0; p < nSims; p += 1) {
      cumLog.fill(0);
      let histIdx = Math.floor(rngBoot() * t);
      for (let wk = 0; wk < horizonWeeks; wk += 1) {
        if (wk > 0) {
          histIdx = rngBoot() < pNewBlock ? Math.floor(rngBoot() * t) : (histIdx + 1) % t;
        }
        const off = histIdx * N;
        for (let i = 0; i < N; i += 1) cumLog[i]! += centeredFlat[off + i]!;
      }
      let portRet = 0;
      for (let i = 0; i < N; i += 1) {
        const v = cumLog[i]!;
        const cLog = v < -4 ? -4 : v > 4 ? 4 : v;
        portRet += curWArr[i]! * (Math.exp(cLog) - 1);
      }
      simBoot[p] = portRet;
    }

    // Engine 2: Correlated Student-t (df=6)
    for (let p = 0; p < nSims; p += 1) {
      cumLog.fill(0);
      for (let wk = 0; wk < horizonWeeks; wk += 1) {
        fillStandardNormals(rngStud, zBuf, N);
        const tScale = sampleStudentTScale(rngStud);
        for (let i = 0; i < N; i += 1) {
          const off = i * N;
          let dot = 0;
          for (let k = 0; k <= i; k += 1) dot += cholFlat[off + k]! * zBuf[k]!;
          cumLog[i]! += dot * tScale;
        }
      }
      let portRet = 0;
      for (let i = 0; i < N; i += 1) {
        const v = cumLog[i]!;
        const cLog = v < -4 ? -4 : v > 4 ? 4 : v;
        portRet += curWArr[i]! * (Math.exp(cLog) - 1);
      }
      simStud[p] = portRet;
    }

    // Engine 3: Correlated Gaussian Normal (sum of h independent N(0, Σ) weeks == sqrt(h) * L * Z)
    const sqrtH = Math.sqrt(horizonWeeks);
    for (let p = 0; p < nSims; p += 1) {
      fillStandardNormals(rngGauss, zBuf, N);
      let portRet = 0;
      for (let i = 0; i < N; i += 1) {
        const off = i * N;
        let dot = 0;
        for (let k = 0; k <= i; k += 1) dot += cholFlat[off + k]! * zBuf[k]!;
        const v = dot * sqrtH;
        const cLog = v < -4 ? -4 : v > 4 ? 4 : v;
        portRet += curWArr[i]! * (Math.exp(cLog) - 1);
      }
      simGauss[p] = portRet;
    }

    const tailInputs: Array<[EngineKey, Float64Array]> = [
      ["block_bootstrap", simBoot],
      ["student_t_df6", simStud],
      ["gaussian_normal", simGauss],
    ];
    const tailCount = Math.max(1, Math.floor(nSims * 0.05));
    for (const [engKey, samples] of tailInputs) {
      samples.sort();
      const p05 = quantile(samples, 0.05);
      const p10 = quantile(samples, 0.1);
      const p50 = quantile(samples, 0.5);
      const p90 = quantile(samples, 0.9);
      let cvarSum = 0;
      for (let k = 0; k < tailCount; k += 1) cvarSum += samples[k]!;
      const cvar95 = cvarSum / tailCount;

      const acc = tailStats[engKey];
      if (realizedDemeanedRet < p05) {
        acc.breaches += 1;
        acc.breachRealized.push(realizedDemeanedRet);
        acc.breachPredCvar.push(cvar95);
      }
      if (realizedDemeanedRet >= p10 && realizedDemeanedRet <= p90) {
        acc.covered80 += 1;
      }
      const winPinball =
        0.25 *
        (computePinballLoss(realizedDemeanedRet, p05, 0.05) +
          computePinballLoss(realizedDemeanedRet, p10, 0.1) +
          computePinballLoss(realizedDemeanedRet, p50, 0.5) +
          computePinballLoss(realizedDemeanedRet, p90, 0.9));
      acc.pinballSum += winPinball;
    }

    // 3. Allocation Horse Race: weights fitted strictly on [0..t-1]
    const hrpRes = computeHrpWeights(
      assetsIncluded.map((ticker) => ({ ticker, is_cash: false, max_weight_pct: 35 })),
      lwCovUnbiased,
      lw.corr,
    );
    const hrpWeights = normalizeWeights(assetsIncluded.map((tkr) => hrpRes.weights_by_ticker[tkr] ?? 0));
    const invVolWeights = normalizeWeights(
      Array.from({ length: N }, (_, i) => 1 / Math.sqrt(Math.max(1e-10, lw.sample_cov[i]![i]!))),
    );
    const equalWeights = Array<number>(N).fill(1 / N);

    const stratTargets: Array<[StratKey, number[]]> = [
      ["current_weights", currentWeights],
      ["hrp_lw", hrpWeights],
      ["inv_vol", invVolWeights],
      ["equal_weight", equalWeights],
    ];

    for (const [sKey, targetW] of stratTargets) {
      const st = stratState[sKey];
      let oneWayTurn = 0;
      if (wIdx > 0) {
        for (let i = 0; i < N; i += 1) {
          oneWayTurn += Math.abs(targetW[i]! - st.curW[i]!);
        }
        oneWayTurn *= 0.5;
        st.totalTurnover += oneWayTurn;
      }
      const txDragFactor = wIdx > 0 ? Math.max(0.01, 1 - (txCostBps / 10000) * oneWayTurn) : 1;
      st.curW = [...targetW];

      for (let s = t; s < t + horizonWeeks; s += 1) {
        const retRow = returnsMatrix[s]!;
        let portGross = 0;
        const assetGrowths = new Float64Array(N);
        for (let i = 0; i < N; i += 1) {
          const g = Math.exp(retRow[i]!);
          assetGrowths[i] = g;
          portGross += st.curW[i]! * g;
        }
        const netGrowth = s === t ? portGross * txDragFactor : portGross;
        st.equity *= netGrowth;
        st.weeklyRets.push(netGrowth - 1);
        const denom = Math.max(1e-12, portGross);
        for (let i = 0; i < N; i += 1) {
          st.curW[i] = (st.curW[i]! * assetGrowths[i]!) / denom;
        }
      }
    }
  }

  // Finalize Covariance Eval
  const covKeys: CovKey[] = ["sample_cov", "fixed_025_shrink", "analytical_lw"];
  const covRowsRaw: CovarianceEvalRow[] = covKeys.map((key) => {
    const entry = covStats[key];
    const meanPred = entry.predVols.reduce((s, v) => s + v, 0) / Math.max(1, windowsEvaluated);
    const meanReal = entry.realVols.reduce((s, v) => s + v, 0) / Math.max(1, windowsEvaluated);
    return {
      method: key,
      label: entry.label,
      realized_to_predicted_vol_ratio: round(meanPred > 1e-9 ? meanReal / meanPred : 1, 3),
      qlike_loss: round(entry.qlikeSum / Math.max(1, windowsEvaluated), 4),
      vol_rmse_pct: round(Math.sqrt(entry.sqErrSum / Math.max(1, windowsEvaluated)), 2),
      is_winner: false,
    };
  });
  let bestCovIdx = 0;
  for (let i = 1; i < covRowsRaw.length; i += 1) {
    if (covRowsRaw[i]!.qlike_loss < covRowsRaw[bestCovIdx]!.qlike_loss - 1e-9) {
      bestCovIdx = i;
    } else if (
      Math.abs(covRowsRaw[i]!.qlike_loss - covRowsRaw[bestCovIdx]!.qlike_loss) <= 1e-9 &&
      covRowsRaw[i]!.method === "analytical_lw"
    ) {
      bestCovIdx = i;
    }
  }
  if (covRowsRaw[bestCovIdx]) covRowsRaw[bestCovIdx]!.is_winner = true;

  // Finalize Tail Eval
  const engineKeys: EngineKey[] = ["block_bootstrap", "student_t_df6", "gaussian_normal"];
  const tailRowsRaw: TailEvalRow[] = engineKeys.map((engKey) => {
    const acc = tailStats[engKey];
    const kupiec = computeKupiecPofTest(acc.breaches, windowsEvaluated, 0.05);
    let shortfallRatio: number | null = null;
    if (acc.breachRealized.length > 0) {
      const avgReal = acc.breachRealized.reduce((s, v) => s + v, 0) / acc.breachRealized.length;
      const avgPred = acc.breachPredCvar.reduce((s, v) => s + v, 0) / acc.breachPredCvar.length;
      if (avgPred < -1e-6 && avgReal < 0) {
        shortfallRatio = round(avgReal / avgPred, 3);
      }
    }
    return {
      engine: engKey,
      label: acc.label,
      breaches: kupiec.breaches,
      total_windows: kupiec.total_windows,
      var95_breach_rate_pct: round(kupiec.observed_rate_pct, 2),
      kupiec_pof_pvalue: round(kupiec.p_value, 4),
      kupiec_calibrated: kupiec.calibrated,
      mean_pinball_loss_pct: round((acc.pinballSum / Math.max(1, windowsEvaluated)) * 100, 3),
      coverage_80_pct: round((acc.covered80 / Math.max(1, windowsEvaluated)) * 100, 1),
      cvar95_shortfall_ratio: shortfallRatio,
      is_winner: false,
    };
  });
  const calibratedIndices = tailRowsRaw
    .map((r, idx) => ({ r, idx }))
    .filter((x) => x.r.kupiec_calibrated);
  const candidateTailIndices =
    calibratedIndices.length > 0
      ? calibratedIndices.map((x) => x.idx)
      : tailRowsRaw.map((_, idx) => idx);
  let bestTailIdx = candidateTailIndices[0]!;
  for (const idx of candidateTailIndices) {
    if (tailRowsRaw[idx]!.mean_pinball_loss_pct < tailRowsRaw[bestTailIdx]!.mean_pinball_loss_pct - 1e-9) {
      bestTailIdx = idx;
    }
  }
  if (tailRowsRaw[bestTailIdx]) tailRowsRaw[bestTailIdx]!.is_winner = true;

  // Finalize Allocation Horse Race
  const rfWeekly = Math.pow(1 + Math.max(0, rfPct) / 100, 1 / 52) - 1;
  const stratKeys: StratKey[] = ["current_weights", "hrp_lw", "inv_vol", "equal_weight"];
  const oosTotalWeeks = windowsEvaluated * horizonWeeks;
  const oosYears = Math.max(1 / 52, oosTotalWeeks / 52);

  const horseRaceRows: AllocationHorseRaceRow[] = stratKeys.map((sKey) => {
    const st = stratState[sKey];
    const rets = st.weeklyRets;
    let eq = 1;
    let peak = 1;
    let maxDd = 0;
    for (const r of rets) {
      eq *= 1 + r;
      if (eq > peak) peak = eq;
      const dd = (eq - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
    const cagrPct = (Math.pow(Math.max(1e-6, st.equity), 1 / oosYears) - 1) * 100;
    const mean = rets.reduce((s, r) => s + r, 0) / Math.max(1, rets.length);
    const variance =
      rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
    const volAnn = Math.sqrt(Math.max(0, variance)) * Math.sqrt(52);
    const sharpe = volAnn > 1e-9 ? ((mean - rfWeekly) * 52) / volAnn : 0;
    const moments = computeHigherMoments(rets);

    return {
      strategy: sKey,
      label: st.label,
      oos_cagr_pct: round(cagrPct, 2),
      oos_vol_pct: round(volAnn * 100, 2),
      oos_max_dd_pct: round(maxDd * 100, 2),
      oos_sharpe: round(sharpe, 2),
      oos_cvar95_weekly_pct: moments.cvar_95_pct,
      annual_turnover_pct: round((st.totalTurnover / oosYears) * 100, 1),
    };
  });

  const avgLambda = round(lambdaSum / Math.max(1, windowsEvaluated), 3);
  const avgBlockLen = round(blockLenSum / Math.max(1, windowsEvaluated), 1);

  const covWinner = covRowsRaw[bestCovIdx]!;
  const tailWinner = tailRowsRaw[bestTailIdx]!;
  const anyCalibrated = tailRowsRaw.some((r) => r.kupiec_calibrated);
  const volRatioOk = covWinner.realized_to_predicted_vol_ratio >= 0.5 && covWinner.realized_to_predicted_vol_ratio <= 2.0;
  const status: QuantWalkForwardEvalResult["status"] = anyCalibrated && volRatioOk ? "CALIBRATED" : "WARN";

  const causalRows = horseRaceRows.filter((r) => r.strategy !== "current_weights");
  const bestCausal = [...causalRows].sort((a, b) => b.oos_sharpe - a.oos_sharpe)[0]!;
  const currentRefRow = horseRaceRows.find((r) => r.strategy === "current_weights");
  const missingFxTickers = activePool.filter((c) => c.missingFx).map((c) => c.ticker);

  const findings: string[] = [
    `Evaluated ${windowsEvaluated} non-overlapping ${horizonWeeks}w expanding windows across ${T} aligned weeks (${assetsIncluded.length} assets, mean Ledoit-Wolf λ=${avgLambda}, mean Politis-White L*=${avgBlockLen}w).`,
    `Covariance winner: ${covWinner.label} (QLIKE=${covWinner.qlike_loss}, realized/predicted vol=${covWinner.realized_to_predicted_vol_ratio}x, RMSE=${covWinner.vol_rmse_pct}%).`,
    `Tail winner: ${tailWinner.label} (pinball=${tailWinner.mean_pinball_loss_pct}%, VaR95 breaches=${tailWinner.breaches}/${tailWinner.total_windows} [${tailWinner.var95_breach_rate_pct}%], Kupiec p=${tailWinner.kupiec_pof_pvalue}).`,
    `Causal OOS leader: ${bestCausal.label} (Sharpe=${bestCausal.oos_sharpe}, CAGR=${bestCausal.oos_cagr_pct}%, MaxDD=${bestCausal.oos_max_dd_pct}%, turnover=${bestCausal.annual_turnover_pct}%/yr).`,
    ...(currentRefRow
      ? [
          `Current Weights (hindsight ref using today's weights — subject to selection bias): Sharpe=${currentRefRow.oos_sharpe}, CAGR=${currentRefRow.oos_cagr_pct}%, MaxDD=${currentRefRow.oos_max_dd_pct}%, turnover=${currentRefRow.annual_turnover_pct}%/yr.`,
        ]
      : []),
  ];
  if (!anyCalibrated) {
    findings.push("Warning: All tail simulators rejected by Kupiec POF (p < 0.05) — regime instability or structural shift detected.");
  }
  if (!volRatioOk) {
    findings.push(`Warning: Realized-to-predicted volatility ratio (${covWinner.realized_to_predicted_vol_ratio}x) sits outside [0.5x, 2.0x] calibration band.`);
  }
  if (excluded.length > 0) {
    findings.push(`Excluded holdings lacking >= ${minRequiredWeeks + 1} overlapping weekly bars: ${excluded.join(", ")}.`);
  }
  if (missingFxTickers.length > 0) {
    findings.push(`Local-currency bars used (FX history unavailable) for: ${missingFxTickers.join(", ")}.`);
  }

  return {
    status,
    horizon_weeks: horizonWeeks,
    tx_cost_bps: txCostBps,
    include_external_wealth: includeExt,
    assets_included: assetsIncluded,
    assets_excluded: excluded,
    aligned_weeks: T,
    warmup_weeks: warmupWeeks,
    windows_evaluated: windowsEvaluated,
    date_range: dateRange,
    avg_lw_lambda: avgLambda,
    avg_auto_block_length: avgBlockLen,
    covariance_eval: covRowsRaw,
    tail_eval: tailRowsRaw,
    allocation_horse_race: horseRaceRows,
    findings,
    methodology_note: `Zero-lookahead expanding-window walk-forward evaluation (W0=${warmupWeeks}w, step=${horizonWeeks}w, tx=${txCostBps}bps, rf=${rfPct}%, 500 drift-neutral seeded paths per engine/window).`,
  };
}
