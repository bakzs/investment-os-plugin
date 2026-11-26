/**
 * Zero-dependency institutional quantitative finance primitives for Investment OS v0.7:
 * 1. Linear algebra & distributions: Gaussian elimination solver, symmetric Jacobi eigendecomposition,
 *    normal CDF / inverse CDF (Abramowitz-Stegun + Acklam), higher moments & empirical CVaR.
 * 2. Black-Litterman Brier-calibrated posterior expected returns.
 * 3. PCA latent factor risk decomposition, Meucci Effective Number of Bets (N_eff), and Market Beta.
 * 4. López de Prado Hierarchical Risk Parity (HRP) clustering & recursive bisection.
 * 5. Politis-Romano Stationary Block Bootstrap multivariate path simulator & CVaR / Max-DD tails.
 * 6. Bailey & López de Prado Deflated Sharpe Ratio (DSR) for multiple-testing correction.
 * 7. Analytical Ledoit-Wolf (2004) constant-correlation shrinkage, Politis-White (2004) /
 *    Patton-Politis-White (2009) automatic block length, QLIKE/Pinball/Kupiec POF, and Spearman Rank IC.
 */

export interface EigenPair {
  eigenvalue: number;
  eigenvector: number[];
}

export interface HigherMomentsSummary {
  mean: number;
  std: number;
  skewness: number;
  excess_kurtosis: number;
  var_95_pct: number;
  cvar_95_pct: number;
}

export interface BlackLittermanAssetInput {
  ticker: string;
  is_cash: boolean;
  market_weight: number;
  raw_view_cagr: number | null; // decimal (e.g. 0.14 for 14%), null if no modeled dossier view
  view_warnings_count: number;
  dispersion_spread?: number | null; // optional bull-bear CAGR spread (decimal)
}

export interface BlackLittermanAssetOutput {
  ticker: string;
  prior_cagr_pct: number;
  raw_view_cagr_pct: number | null;
  posterior_cagr_pct: number;
  shrinkage_pct: number; // posterior - raw_view (negative = pulled down toward prior)
  confidence_weight_pct: number; // effective 0-100% weight placed on view vs prior
}

export interface BlackLittermanResult {
  tau: number;
  risk_aversion_delta: number;
  brier_score_used: number | null;
  brier_resolved_count: number;
  brier_omega_multiplier: number;
  assets: BlackLittermanAssetOutput[];
  note: string;
}

export interface LatentRiskFactor {
  id: string; // PC1, PC2, PC3
  variance_share_pct: number; // % of portfolio variance explained by this factor
  eigenvalue_share_pct: number; // % of total universe covariance trace
  top_tickers: string[];
  label: string;
}

export interface FactorRiskDecomposition {
  effective_bets: number; // Meucci N_eff = exp(-sum p_k ln p_k)
  asset_count: number;
  market_beta: number | null;
  systematic_risk_pct: number | null; // R^2 vs benchmark (%)
  idiosyncratic_risk_pct: number | null; // 100 - R^2 (%)
  top_factors: LatentRiskFactor[];
}

export interface HrpAssetInput {
  ticker: string;
  is_cash: boolean;
  max_weight_pct: number;
}

export interface HrpResult {
  weights_by_ticker: Record<string, number>; // percentages summing to ~100 across non-cash risky assets
  ordered_tickers: string[];
}

export interface DeflatedSharpeResult {
  dsr_prob_pct: number; // 0..100 probability true Sharpe > multiple-testing null hurdle
  trials_tested: number;
  sr0_annual_threshold: number;
  skewness: number;
  excess_kurtosis: number;
}

function round(val: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

// ─── 1. Distributions & Linear Algebra ────────────────────────────────────────

/**
 * Standard normal CDF Φ(z) via Abramowitz & Stegun 7.1.26 (max error < 1.5e-7).
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  if (z < -8) return 0;
  if (z > 8) return 1;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Standard normal inverse CDF Φ⁻¹(p) via Acklam's rational approximation (max error < 1.15e-9).
 */
export function normalInvCdf(pRaw: number): number {
  const p = clamp(pRaw, 1e-12, 1 - 1e-12);
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

/**
 * Solves A x = b via Gaussian elimination with partial pivoting and mild ridge stabilization.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  if (n === 0) return [];
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = Array<number>(n + 1).fill(0);
    for (let j = 0; j < n; j += 1) {
      row[j] = A[i]?.[j] ?? 0;
    }
    row[n] = b[i] ?? 0;
    return row;
  });

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col]![col]!);
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(aug[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }
    let pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-11) {
      pivot = pivot >= 0 ? 1e-9 : -1e-9;
      aug[col]![col] = pivot;
    }
    for (let r = col + 1; r < n; r += 1) {
      const factor = aug[r]![col]! / pivot;
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) {
        aug[r]![j] = aug[r]![j]! - factor * aug[col]![j]!;
      }
    }
  }

  const x = Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = aug[i]![n]!;
    for (let j = i + 1; j < n; j += 1) {
      sum -= aug[i]![j]! * x[j]!;
    }
    const diag = aug[i]![i]!;
    x[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
  }
  return x;
}

/**
 * Exact symmetric matrix eigendecomposition via classic Jacobi rotations.
 * Returns eigenpairs sorted by eigenvalue descending.
 */
export function jacobiEigenSymmetric(matrix: number[][], maxSweeps = 120): EigenPair[] {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) return [{ eigenvalue: matrix[0]![0]!, eigenvector: [1] }];

  // Symmetrize input copy
  const A: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => 0.5 * ((matrix[i]?.[j] ?? 0) + (matrix[j]?.[i] ?? 0))),
  );
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  const tol = 1e-12;
  const maxRotations = maxSweeps * n * n;

  for (let iter = 0; iter < maxRotations; iter += 1) {
    let p = 0;
    let q = 1;
    let maxOff = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const val = Math.abs(A[i]![j]!);
        if (val > maxOff) {
          maxOff = val;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < tol) break;

    const app = A[p]![p]!;
    const aqq = A[q]![q]!;
    const apq = A[p]![q]!;
    const tau = (aqq - app) / (2 * apq);
    const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    A[p]![p] = app - t * apq;
    A[q]![q] = aqq + t * apq;
    A[p]![q] = 0;
    A[q]![p] = 0;

    for (let k = 0; k < n; k += 1) {
      if (k === p || k === q) continue;
      const akp = A[k]![p]!;
      const akq = A[k]![q]!;
      A[k]![p] = c * akp - s * akq;
      A[p]![k] = A[k]![p]!;
      A[k]![q] = s * akp + c * akq;
      A[q]![k] = A[k]![q]!;
    }

    for (let k = 0; k < n; k += 1) {
      const vkp = V[k]![p]!;
      const vkq = V[k]![q]!;
      V[k]![p] = c * vkp - s * vkq;
      V[k]![q] = s * vkp + c * vkq;
    }
  }

  const pairs: EigenPair[] = [];
  for (let i = 0; i < n; i += 1) {
    const vec = Array.from({ length: n }, (_, row) => V[row]![i]!);
    // Normalize sign deterministically so largest-magnitude component is positive
    let maxIdx = 0;
    for (let r = 1; r < n; r += 1) {
      if (Math.abs(vec[r]!) > Math.abs(vec[maxIdx]!)) maxIdx = r;
    }
    if (vec[maxIdx]! < 0) {
      for (let r = 0; r < n; r += 1) vec[r] = -vec[r]!;
    }
    pairs.push({ eigenvalue: A[i]![i]!, eigenvector: vec });
  }
  pairs.sort((a, b) => b.eigenvalue - a.eigenvalue);
  return pairs;
}

/**
 * Computes sample mean, std, skewness, excess kurtosis, and empirical 95% VaR / CVaR (Expected Shortfall).
 */
export function computeHigherMoments(returns: number[]): HigherMomentsSummary {
  const n = returns.length;
  if (n < 3) {
    return { mean: 0, std: 0, skewness: 0, excess_kurtosis: 0, var_95_pct: 0, cvar_95_pct: 0 };
  }
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const r of returns) {
    const d = r - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  const variance = m2 / (n - 1);
  const std = Math.sqrt(Math.max(0, variance));
  let skewness = 0;
  let excessKurtosis = 0;
  if (std > 1e-10) {
    const rawM2 = m2 / n;
    const rawM3 = m3 / n;
    const rawM4 = m4 / n;
    skewness = rawM3 / Math.pow(rawM2, 1.5);
    excessKurtosis = rawM4 / (rawM2 * rawM2) - 3;
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor(n * 0.05));
  const var95 = sorted[Math.min(n - 1, tailCount - 1)]!;
  let cvarSum = 0;
  for (let i = 0; i < tailCount; i += 1) {
    cvarSum += sorted[i]!;
  }
  const cvar95 = cvarSum / tailCount;

  return {
    mean,
    std,
    skewness: round(clamp(skewness, -10, 10), 3),
    excess_kurtosis: round(clamp(excessKurtosis, -2, 30), 3),
    var_95_pct: round(var95 * 100, 2),
    cvar_95_pct: round(cvar95 * 100, 2),
  };
}

// ─── 2. Black-Litterman Brier-Calibrated Posterior ────────────────────────────

/**
 * Computes Black-Litterman posterior expected returns for the risky sub-universe.
 * - Equilibrium prior Π = δ Σ w_eq, with δ calibrated so w_eq' Π matches benchmark excess CAGR.
 * - View uncertainty Ω_kk = τ * c_brier * c_warn * (P Σ P')_kk.
 * - Uses Woodbury/direct inverse via solveLinearSystem (no matrix inversion instability).
 */
export function computeBlackLittermanPosterior(
  assets: BlackLittermanAssetInput[],
  cov: number[][],
  opts: {
    rfPct: number;
    benchmarkCagrPct: number;
    tau?: number;
    brierScore?: number | null;
    brierResolvedCount?: number;
  },
): BlackLittermanResult {
  const tau = opts.tau ?? 0.05;
  const rf = opts.rfPct / 100;
  const benchExcess = Math.max(0.02, opts.benchmarkCagrPct / 100 - rf);
  const brierScore = opts.brierScore ?? null;
  const brierResolved = opts.brierResolvedCount ?? 0;

  // Map Brier calibration score to Ω uncertainty multiplier:
  // Well-calibrated (<0.15) -> 0.65 (trust views more); Neutral/uncalibrated -> 1.0; Poor (>0.28) -> up to 1.85
  let brierMult = 1.0;
  if (brierScore !== null && brierResolved >= 5) {
    brierMult = round(clamp(0.65 + ((brierScore - 0.14) / 0.16) * 0.95, 0.6, 1.85), 2);
  }

  const riskyIdx: number[] = [];
  for (let i = 0; i < assets.length; i += 1) {
    if (!assets[i]!.is_cash) riskyIdx.push(i);
  }

  const m = riskyIdx.length;
  if (m === 0) {
    return {
      tau,
      risk_aversion_delta: 2.5,
      brier_score_used: brierScore,
      brier_resolved_count: brierResolved,
      brier_omega_multiplier: brierMult,
      assets: assets.map((a) => ({
        ticker: a.ticker,
        prior_cagr_pct: round(opts.rfPct, 2),
        raw_view_cagr_pct: null,
        posterior_cagr_pct: round(opts.rfPct, 2),
        shrinkage_pct: 0,
        confidence_weight_pct: 0,
      })),
      note: "Cash-only portfolio; Black-Litterman prior equals risk-free rate.",
    };
  }

  // Extract risky sub-covariance Σ_r and normalized equilibrium weights w_eq
  const sigR: number[][] = Array.from({ length: m }, (_, r) =>
    Array.from({ length: m }, (_, c) => cov[riskyIdx[r]!]![riskyIdx[c]!]!),
  );
  let wSum = 0;
  const wEq = riskyIdx.map((idx) => {
    const w = Math.max(0.005, assets[idx]!.market_weight);
    wSum += w;
    return w;
  });
  for (let i = 0; i < m; i += 1) wEq[i] = wEq[i]! / wSum;

  // Compute Σ_r w_eq and portfolio variance w_eq' Σ_r w_eq to calibrate δ
  const sigW = Array<number>(m).fill(0);
  let eqVar = 0;
  for (let i = 0; i < m; i += 1) {
    let s = 0;
    for (let j = 0; j < m; j += 1) s += sigR[i]![j]! * wEq[j]!;
    sigW[i] = s;
    eqVar += wEq[i]! * s;
  }
  const delta = clamp(eqVar > 1e-6 ? benchExcess / eqVar : 2.5, 1.2, 5.5);
  const pi = sigW.map((v) => clamp(delta * v, 0.01, 0.2));

  // Build views for every risky asset with a modeled dossier expected CAGR
  interface ViewEntry {
    localIdx: number;
    qExcess: number;
    omega: number;
  }
  const views: ViewEntry[] = [];
  for (let r = 0; r < m; r += 1) {
    const a = assets[riskyIdx[r]!]!;
    if (a.raw_view_cagr === null || !Number.isFinite(a.raw_view_cagr)) continue;
    const assetVar = Math.max(1e-4, sigR[r]![r]!);
    const warnPenalty = 1 + Math.min(4, Math.max(0, a.view_warnings_count)) * 0.35;
    const dispPenalty =
      typeof a.dispersion_spread === "number" && a.dispersion_spread > 0.25
        ? 1 + Math.min(0.6, (a.dispersion_spread - 0.25) * 1.2)
        : 1.0;
    // Standard He-Litterman baseline Ω_kk = τ * (P Σ P')_kk scaled by Brier + GIGO + dispersion uncertainty
    const omega = Math.max(1e-6, tau * assetVar * brierMult * warnPenalty * dispPenalty);
    views.push({
      localIdx: r,
      qExcess: clamp(a.raw_view_cagr - rf, -0.25, 0.35),
      omega,
    });
  }

  // Exact BL posterior via Woodbury identity:
  // μ_post = Π + τ Σ P' (τ P Σ P' + Ω)^(-1) (Q - P Π)
  // This solves a K x K SPD system (K = # views <= m) without ever inverting Σ directly!
  let postExcess = [...pi];
  const confByLocal = new Map<number, number>();

  if (views.length > 0) {
    const k = views.length;
    const M: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
    const rhs = Array<number>(k).fill(0);

    for (let i = 0; i < k; i += 1) {
      const vi = views[i]!;
      rhs[i] = vi.qExcess - pi[vi.localIdx]!;
      const priorVarI = tau * sigR[vi.localIdx]![vi.localIdx]!;
      confByLocal.set(vi.localIdx, round((priorVarI / (priorVarI + vi.omega)) * 100, 0));
      for (let j = 0; j < k; j += 1) {
        const vj = views[j]!;
        M[i]![j] = tau * sigR[vi.localIdx]![vj.localIdx]! + (i === j ? vi.omega : 0);
      }
    }

    const z = solveLinearSystem(M, rhs);
    postExcess = pi.map((pVal, row) => {
      let adj = 0;
      for (let j = 0; j < k; j += 1) {
        adj += tau * sigR[row]![views[j]!.localIdx]! * z[j]!;
      }
      return clamp(pVal + adj, -0.2, 0.35);
    });
  }

  const outByGlobal = new Map<number, BlackLittermanAssetOutput>();
  for (let r = 0; r < m; r += 1) {
    const gIdx = riskyIdx[r]!;
    const a = assets[gIdx]!;
    const priorPct = round((pi[r]! + rf) * 100, 2);
    const postPct = round((postExcess[r]! + rf) * 100, 2);
    const rawPct = a.raw_view_cagr !== null ? round(a.raw_view_cagr * 100, 2) : null;
    const shrink = rawPct !== null ? round(postPct - rawPct, 2) : round(postPct - priorPct, 2);
    outByGlobal.set(gIdx, {
      ticker: a.ticker,
      prior_cagr_pct: priorPct,
      raw_view_cagr_pct: rawPct,
      posterior_cagr_pct: postPct,
      shrinkage_pct: shrink,
      confidence_weight_pct: confByLocal.get(r) ?? 0,
    });
  }

  const finalAssets: BlackLittermanAssetOutput[] = assets.map((a, idx) => {
    if (a.is_cash) {
      return {
        ticker: a.ticker,
        prior_cagr_pct: round(opts.rfPct, 2),
        raw_view_cagr_pct: null,
        posterior_cagr_pct: round(opts.rfPct, 2),
        shrinkage_pct: 0,
        confidence_weight_pct: 0,
      };
    }
    return outByGlobal.get(idx)!;
  });

  const brierText =
    brierScore !== null && brierResolved >= 5
      ? `Brier=${brierScore.toFixed(2)} (${brierResolved} resolved -> Ω×${brierMult})`
      : `neutral prior calibration (Ω×${brierMult}; need >=5 resolved hypotheses for empirical Brier scaling)`;

  return {
    tau,
    risk_aversion_delta: round(delta, 2),
    brier_score_used: brierScore,
    brier_resolved_count: brierResolved,
    brier_omega_multiplier: brierMult,
    assets: finalAssets,
    note: `Black-Litterman conjugate blend (τ=${tau}, δ=${round(delta, 2)}, ${views.length} dossier views, ${brierText}).`,
  };
}

// ─── 3. PCA Factor Risk Decomposition & Effective Bets ────────────────────────

export function computeFactorRiskDecomposition(
  tickers: string[],
  isCashFlags: boolean[],
  weights: number[],
  cov: number[][],
  benchmarkIdx: number | null,
): FactorRiskDecomposition {
  const activeIdx: number[] = [];
  for (let i = 0; i < tickers.length; i += 1) {
    if (!isCashFlags[i] && (weights[i] ?? 0) > 1e-6) {
      activeIdx.push(i);
    }
  }
  const m = activeIdx.length;
  if (m === 0) {
    return {
      effective_bets: 0,
      asset_count: 0,
      market_beta: 0,
      systematic_risk_pct: 0,
      idiosyncratic_risk_pct: 100,
      top_factors: [],
    };
  }

  const subCov: number[][] = Array.from({ length: m }, (_, r) =>
    Array.from({ length: m }, (_, c) => cov[activeIdx[r]!]![activeIdx[c]!]!),
  );
  const wRisk = activeIdx.map((idx) => weights[idx]!);
  const wRiskSum = wRisk.reduce((s, v) => s + v, 0);
  const wNorm = wRisk.map((v) => (wRiskSum > 0 ? v / wRiskSum : 0));

  const eigenpairs = jacobiEigenSymmetric(subCov);
  const totalTrace = Math.max(
    1e-9,
    eigenpairs.reduce((s, ep) => s + Math.max(0, ep.eigenvalue), 0),
  );

  // Portfolio variance across orthogonal principal factors: w' Σ w = Σ_k (v_k' w)^2 λ_k
  const factorVars = eigenpairs.map((ep) => {
    const lam = Math.max(0, ep.eigenvalue);
    let proj = 0;
    for (let i = 0; i < m; i += 1) proj += ep.eigenvector[i]! * wNorm[i]!;
    return proj * proj * lam;
  });
  const totalPortVar = Math.max(1e-12, factorVars.reduce((s, v) => s + v, 0));
  const pShares = factorVars.map((v) => v / totalPortVar);

  // Meucci Effective Number of Bets: N_eff = exp(-Σ p_k ln p_k)
  let entropy = 0;
  for (const p of pShares) {
    if (p > 1e-10) entropy -= p * Math.log(p);
  }
  const effectiveBets = round(clamp(Math.exp(entropy), 1, m), 2);

  // Sort factors by their contribution to THIS portfolio's variance
  const ranked = eigenpairs
    .map((ep, k) => ({
      ep,
      varShare: pShares[k]!,
      eigShare: Math.max(0, ep.eigenvalue) / totalTrace,
    }))
    .sort((a, b) => b.varShare - a.varShare);

  const topFactors: LatentRiskFactor[] = ranked.slice(0, 3).map((item, rankIdx) => {
    const loadings = activeIdx
      .map((gIdx, localIdx) => ({
        ticker: tickers[gIdx]!,
        impact: Math.abs(item.ep.eigenvector[localIdx]! * wNorm[localIdx]!),
      }))
      .sort((a, b) => b.impact - a.impact);
    const topTickers = loadings.slice(0, 3).map((x) => x.ticker);
    const id = `PC${rankIdx + 1}`;
    return {
      id,
      variance_share_pct: round(item.varShare * 100, 1),
      eigenvalue_share_pct: round(item.eigShare * 100, 1),
      top_tickers: topTickers,
      label: `${id}: ${topTickers.join(" · ")}`,
    };
  });

  // Market Beta & Systematic vs Idiosyncratic Risk Split against benchmark asset (if present)
  let marketBeta: number | null = null;
  let systematicPct: number | null = null;
  let idiosyncraticPct: number | null = null;

  if (benchmarkIdx !== null && benchmarkIdx >= 0 && benchmarkIdx < tickers.length) {
    const benchVar = cov[benchmarkIdx]![benchmarkIdx]!;
    if (benchVar > 1e-8) {
      let covPortBench = 0;
      let fullPortVar = 0;
      for (let i = 0; i < tickers.length; i += 1) {
        const wi = weights[i] ?? 0;
        covPortBench += wi * cov[i]![benchmarkIdx]!;
        let sw = 0;
        for (let j = 0; j < tickers.length; j += 1) sw += cov[i]![j]! * (weights[j] ?? 0);
        fullPortVar += wi * sw;
      }
      if (fullPortVar > 1e-10) {
        const beta = covPortBench / benchVar;
        const r2 = clamp((beta * beta * benchVar) / fullPortVar, 0, 1);
        marketBeta = round(beta, 2);
        systematicPct = round(r2 * 100, 1);
        idiosyncraticPct = round((1 - r2) * 100, 1);
      }
    }
  }

  return {
    effective_bets: effectiveBets,
    asset_count: m,
    market_beta: marketBeta,
    systematic_risk_pct: systematicPct,
    idiosyncratic_risk_pct: idiosyncraticPct,
    top_factors: topFactors,
  };
}

// ─── 4. López de Prado Hierarchical Risk Parity (HRP) ─────────────────────────

/**
 * Computes cluster-balanced HRP weights over non-cash risky assets:
 * 1. Distance matrix d_ij = sqrt(0.5 * (1 - corr_ij))
 * 2. Average-linkage (UPGMA) agglomerative hierarchical clustering
 * 3. Tree leaf seriation (quasi-diagonalization)
 * 4. Recursive inverse-variance cluster bisection
 * 5. Cap enforcement with water-filling redistribution
 */
export function computeHrpWeights(
  assets: HrpAssetInput[],
  cov: number[][],
  corr: number[][],
): HrpResult {
  const riskyIdx: number[] = [];
  for (let i = 0; i < assets.length; i += 1) {
    if (!assets[i]!.is_cash) riskyIdx.push(i);
  }
  const m = riskyIdx.length;
  if (m === 0) return { weights_by_ticker: {}, ordered_tickers: [] };
  if (m === 1) {
    const sym = assets[riskyIdx[0]!]!.ticker;
    return { weights_by_ticker: { [sym]: 100 }, ordered_tickers: [sym] };
  }

  // Sub-covariance & correlation-distance matrices
  const subCov: number[][] = Array.from({ length: m }, (_, r) =>
    Array.from({ length: m }, (_, c) => cov[riskyIdx[r]!]![riskyIdx[c]!]!),
  );
  const dist: number[][] = Array.from({ length: m }, (_, r) =>
    Array.from({ length: m }, (_, c) => {
      if (r === c) return 0;
      const rho = clamp(corr[riskyIdx[r]!]![riskyIdx[c]!]!, -0.99, 0.9999);
      return Math.sqrt(Math.max(0, 0.5 * (1 - rho)));
    }),
  );

  // UPGMA agglomerative clustering producing a true binary dendrogram for tree-respecting bisection
  interface ClusterNode {
    members: number[];
    order: number[];
    left?: ClusterNode;
    right?: ClusterNode;
  }
  const clusters: ClusterNode[] = Array.from({ length: m }, (_, i) => ({
    members: [i],
    order: [i],
  }));

  const clusterDist = (a: ClusterNode, b: ClusterNode): number => {
    let sum = 0;
    for (const i of a.members) {
      for (const j of b.members) {
        sum += dist[i]![j]!;
      }
    }
    return sum / (a.members.length * b.members.length);
  };

  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const d = clusterDist(clusters[i]!, clusters[j]!);
        if (d < bestD - 1e-12) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const left = clusters[bestI]!;
    const right = clusters[bestJ]!;
    const merged: ClusterNode = {
      members: [...left.members, ...right.members],
      order: [...left.order, ...right.order],
      left,
      right,
    };
    clusters.splice(bestJ, 1);
    clusters[bestI] = merged;
  }

  const root = clusters[0]!;
  const orderedLocal = root.order;

  // Tree-respecting recursive inverse-variance cluster bisection
  const weights = Array<number>(m).fill(1.0);

  const clusterVariance = (indices: number[]): number => {
    const invDiag = indices.map((idx) => 1 / Math.max(1e-6, subCov[idx]![idx]!));
    const sumInv = invDiag.reduce((s, v) => s + v, 0);
    const ivp = invDiag.map((v) => v / sumInv);
    let v = 0;
    for (let a = 0; a < indices.length; a += 1) {
      for (let b = 0; b < indices.length; b += 1) {
        v += ivp[a]! * subCov[indices[a]!]![indices[b]!]! * ivp[b]!;
      }
    }
    return Math.max(1e-8, v);
  };

  const queue: ClusterNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (!node.left || !node.right) continue;
    const leftIdx = node.left.members;
    const rightIdx = node.right.members;
    const vLeft = clusterVariance(leftIdx);
    const vRight = clusterVariance(rightIdx);
    const alpha = 1 - vLeft / (vLeft + vRight);
    for (const idx of leftIdx) weights[idx] = weights[idx]! * alpha;
    for (const idx of rightIdx) weights[idx] = weights[idx]! * (1 - alpha);
    if (node.left.left && node.left.right) queue.push(node.left);
    if (node.right.left && node.right.right) queue.push(node.right);
  }

  // Normalize to 100% and enforce per-asset max_weight_pct via water-filling redistribution
  const rawSum = weights.reduce((s, v) => s + v, 0);
  const pct = weights.map((v) => (rawSum > 0 ? (v / rawSum) * 100 : 100 / m));
  const caps = riskyIdx.map((gIdx) => Math.max(2, Math.min(100, assets[gIdx]!.max_weight_pct || 100)));
  const capTotal = caps.reduce((s, v) => s + v, 0);

  if (capTotal >= 100) {
    for (let pass = 0; pass < 8; pass += 1) {
      let excess = 0;
      let uncappedWeight = 0;
      for (let i = 0; i < m; i += 1) {
        if (pct[i]! > caps[i]! + 1e-6) {
          excess += pct[i]! - caps[i]!;
          pct[i] = caps[i]!;
        } else if (pct[i]! < caps[i]! - 1e-6) {
          uncappedWeight += pct[i]!;
        }
      }
      if (excess <= 1e-4 || uncappedWeight <= 1e-6) break;
      for (let i = 0; i < m; i += 1) {
        if (pct[i]! < caps[i]! - 1e-6) {
          pct[i] = pct[i]! + excess * (pct[i]! / uncappedWeight);
        }
      }
    }
  }

  const byTicker: Record<string, number> = {};
  for (let i = 0; i < m; i += 1) {
    const sym = assets[riskyIdx[i]!]!.ticker;
    byTicker[sym] = round((byTicker[sym] ?? 0) + pct[i]!, 1);
  }
  return {
    weights_by_ticker: byTicker,
    ordered_tickers: orderedLocal.map((localIdx) => assets[riskyIdx[localIdx]!]!.ticker),
  };
}

// ─── 5. Politis-Romano Stationary Block Bootstrap Simulator ───────────────────

export interface BlockBootstrapAssetSpec {
  mu: number; // target annual log/arithmetic drift (decimal)
  vol: number; // annual volatility (decimal, already volMult-scaled)
  is_cash: boolean;
  retMap: Map<string, number>; // weekly log returns keyed by ISO week Monday
}

export interface BootstrapSimulationResult {
  engine_used: "block_bootstrap" | "student_t";
  aligned_weeks: number;
  base_year_samples: number[][];
  sim_year_samples: number[][];
  base_path_max_dd_pct: number[];
  sim_path_max_dd_pct: number[];
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

function boxMullerPair(rng: () => number): [number, number] {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const r = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function sampleStandardNormal(rng: () => number): number {
  return boxMullerPair(rng)[0];
}

function sampleStudentTScale(rng: () => number, df = 6): number {
  let chi2 = 0;
  for (let i = 0; i < df; i += 2) {
    const [z1, z2] = boxMullerPair(rng);
    chi2 += z1 * z1;
    if (i + 1 < df) chi2 += z2 * z2;
  }
  return Math.sqrt((df - 2) / Math.max(0.25, chi2));
}

/**
 * Simulates baseline and action-plan trajectories using either:
 * - Politis-Romano Stationary Block Bootstrap (when >= 80 aligned historical weeks exist),
 *   re-centered to target drifts (BL or Dossier) so empirical crash streaks & tail co-movement stay intact, OR
 * - Correlated Student-t (df=6) weekly shocks (tracking intra-horizon max drawdown consistently in both modes!).
 */
export function runCorrelatedWealthSimulation(params: {
  engineRequested: "block_bootstrap" | "student_t";
  blockLengthWeeks: number;
  horizonYears: number;
  simulations: number;
  volMultiplier: number;
  assets: BlockBootstrapAssetSpec[];
  cholL: number[][];
  baseStartVec: number[];
  simStartVec: number[];
  seed: number;
}): BootstrapSimulationResult {
  const {
    engineRequested,
    blockLengthWeeks,
    horizonYears,
    simulations,
    volMultiplier,
    assets,
    cholL,
    baseStartVec,
    simStartVec,
    seed,
  } = params;
  const n = assets.length;
  const weeksPerYear = 52;
  const totalWeeks = horizonYears * weeksPerYear;
  const rng = mulberry32(seed);

  // Determine common historical weeks across risky assets that actually have history (>= 80w)
  const riskyWithHist = assets
    .map((a, idx) => ({ a, idx }))
    .filter((x) => !x.a.is_cash && x.a.retMap.size >= 80);

  let commonWeeks: string[] = [];
  if (engineRequested === "block_bootstrap" && riskyWithHist.length > 0) {
    const weekCounts = new Map<string, number>();
    for (const item of riskyWithHist) {
      for (const wk of item.a.retMap.keys()) {
        weekCounts.set(wk, (weekCounts.get(wk) ?? 0) + 1);
      }
    }
    const minNeeded = Math.max(1, Math.ceil(riskyWithHist.length * 0.75));
    commonWeeks = Array.from(weekCounts.entries())
      .filter(([, cnt]) => cnt >= minNeeded)
      .map(([wk]) => wk)
      .sort();
  }

  const useBootstrap = engineRequested === "block_bootstrap" && commonWeeks.length >= 80;
  const T = commonWeeks.length;

  // Precompute demeaned, vol-scaled weekly shock matrix for historical assets when using bootstrap
  const hasHistMask = new Uint8Array(n);
  const histShocks: Float64Array[] = [];
  if (useBootstrap) {
    for (let i = 0; i < n; i += 1) {
      const a = assets[i]!;
      const arr = new Float64Array(T);
      if (!a.is_cash) {
        let present = 0;
        let sum = 0;
        for (let t = 0; t < T; t += 1) {
          const v = a.retMap.get(commonWeeks[t]!);
          if (v !== undefined) {
            present += 1;
            sum += v;
          }
        }
        if (present >= Math.floor(T * 0.75)) {
          hasHistMask[i] = 1;
          const meanW = sum / present;
          let sumSq = 0;
          for (let t = 0; t < T; t += 1) {
            const v = a.retMap.get(commonWeeks[t]!);
            const centered = v !== undefined ? v - meanW : 0;
            arr[t] = centered;
            sumSq += centered * centered;
          }
          const empWeeklyVol = Math.sqrt(Math.max(1e-10, sumSq / Math.max(1, present - 1)));
          const targetWeeklyVol = a.vol / Math.sqrt(weeksPerYear);
          // Scale smoothly toward calibrated vol (respecting regime_vol_multiplier) without distorting tail shape
          const scale = clamp(targetWeeklyVol / empWeeklyVol, 0.55 * volMultiplier, 1.65 * volMultiplier);
          for (let t = 0; t < T; t += 1) {
            arr[t] = arr[t]! * scale;
          }
        }
      }
      histShocks.push(arr);
    }
  }

  const baseYearSamples: number[][] = Array.from({ length: horizonYears + 1 }, () => []);
  const simYearSamples: number[][] = Array.from({ length: horizonYears + 1 }, () => []);
  const basePathMaxDd: number[] = [];
  const simPathMaxDd: number[] = [];

  const weeklyDrift = assets.map((a) => (a.mu - 0.5 * a.vol * a.vol) / weeksPerYear);
  const invSqrt52 = 1 / Math.sqrt(weeksPerYear);
  const pNewBlock = 1 / Math.max(2, Math.min(26, blockLengthWeeks));

  const zStd = new Float64Array(n);
  const baseCur = new Float64Array(n);
  const simCur = new Float64Array(n);

  // Check if any non-cash asset needs parametric Student-t fallback during bootstrap
  let needParametric = !useBootstrap;
  if (useBootstrap) {
    for (let i = 0; i < n; i += 1) {
      if (!assets[i]!.is_cash && hasHistMask[i] === 0) {
        needParametric = true;
        break;
      }
    }
  }

  for (let p = 0; p < simulations; p += 1) {
    let bSum0 = 0;
    let sSum0 = 0;
    for (let i = 0; i < n; i += 1) {
      baseCur[i] = baseStartVec[i]!;
      simCur[i] = simStartVec[i]!;
      bSum0 += baseCur[i]!;
      sSum0 += simCur[i]!;
    }
    baseYearSamples[0]!.push(bSum0);
    simYearSamples[0]!.push(sSum0);

    let bPeak = Math.max(1e-6, bSum0);
    let sPeak = Math.max(1e-6, sSum0);
    let bMaxDd = 0;
    let sMaxDd = 0;

    let histIdx = useBootstrap ? Math.floor(rng() * T) : 0;

    for (let wk = 1; wk <= totalWeeks; wk += 1) {
      if (useBootstrap && wk > 1) {
        histIdx = rng() < pNewBlock ? Math.floor(rng() * T) : (histIdx + 1) % T;
      }

      let tScale = 1.0;
      if (needParametric) {
        for (let i = 0; i < n; i += 1) zStd[i] = sampleStandardNormal(rng);
        tScale = sampleStudentTScale(rng, 6);
      }

      let bSum = 0;
      let sSum = 0;

      for (let i = 0; i < n; i += 1) {
        const a = assets[i]!;
        let wkShock = 0;
        if (a.is_cash) {
          wkShock = 0;
        } else if (useBootstrap && hasHistMask[i] === 1) {
          wkShock = histShocks[i]![histIdx]!;
        } else {
          let dot = 0;
          const rowL = cholL[i]!;
          for (let k = 0; k <= i; k += 1) dot += rowL[k]! * zStd[k]!;
          wkShock = dot * invSqrt52 * tScale;
        }

        const logRet = clamp(weeklyDrift[i]! + wkShock, -0.45, 0.45);
        const growth = Math.exp(logRet);
        baseCur[i] = baseCur[i]! * growth;
        simCur[i] = simCur[i]! * growth;
        bSum += baseCur[i]!;
        sSum += simCur[i]!;
      }

      if (bSum > bPeak) bPeak = bSum;
      const bDd = (bSum - bPeak) / bPeak;
      if (bDd < bMaxDd) bMaxDd = bDd;

      if (sSum > sPeak) sPeak = sSum;
      const sDd = (sSum - sPeak) / sPeak;
      if (sDd < sMaxDd) sMaxDd = sDd;

      if (wk % weeksPerYear === 0) {
        const yr = wk / weeksPerYear;
        baseYearSamples[yr]!.push(bSum);
        simYearSamples[yr]!.push(sSum);
      }
    }

    basePathMaxDd.push(round(bMaxDd * 100, 2));
    simPathMaxDd.push(round(sMaxDd * 100, 2));
  }

  return {
    engine_used: useBootstrap ? "block_bootstrap" : "student_t",
    aligned_weeks: T,
    base_year_samples: baseYearSamples,
    sim_year_samples: simYearSamples,
    base_path_max_dd_pct: basePathMaxDd,
    sim_path_max_dd_pct: simPathMaxDd,
  };
}

// ─── 6. Bailey & López de Prado Deflated Sharpe Ratio (DSR) ───────────────────

/**
 * Computes Deflated Sharpe Ratio probability (0..100%) adjusting an observed annualized Sharpe
 * for multiple testing (M trials) and non-normal weekly return skewness & excess kurtosis.
 */
export function computeDeflatedSharpeRatio(params: {
  annualizedSharpe: number;
  weeklyReturns: number[];
  trialsTested: number;
  crossTrialAnnualSharpeVar?: number;
}): DeflatedSharpeResult {
  const { annualizedSharpe, weeklyReturns } = params;
  const T = weeklyReturns.length;
  const M = Math.max(1, Math.round(params.trialsTested || 1));
  const moments = computeHigherMoments(weeklyReturns);

  if (T < 8) {
    return {
      dsr_prob_pct: 50,
      trials_tested: M,
      sr0_annual_threshold: 0,
      skewness: moments.skewness,
      excess_kurtosis: moments.excess_kurtosis,
    };
  }

  const srWeekly = annualizedSharpe / Math.sqrt(52);
  // Expected maximum annualized Sharpe under null across M independent trials (Bailey & López de Prado 2014)
  const eulerGamma = 0.5772156649;
  const srTrialStdAnn = Math.sqrt(Math.max(0.04, params.crossTrialAnnualSharpeVar ?? 0.25));
  let sr0Ann = 0;
  if (M > 1) {
    const z1 = normalInvCdf(1 - 1 / M);
    const z2 = normalInvCdf(1 - 1 / (M * Math.E));
    sr0Ann = Math.max(0, srTrialStdAnn * ((1 - eulerGamma) * z1 + eulerGamma * z2));
  }
  const sr0Weekly = sr0Ann / Math.sqrt(52);

  // Non-normal variance of weekly Sharpe estimator: 1 - γ_3 * SR + ((γ_4_total - 1) / 4) * SR^2
  // Note: excess_kurtosis = γ_4_total - 3, so (γ_4_total - 1) = excess_kurtosis + 2
  const denomInner =
    1 - moments.skewness * srWeekly + ((moments.excess_kurtosis + 2) / 4) * srWeekly * srWeekly;
  const denom = Math.sqrt(Math.max(0.1, denomInner));
  const zScore = ((srWeekly - sr0Weekly) * Math.sqrt(T - 1)) / denom;
  const probPct = round(normalCdf(zScore) * 100, 1);

  return {
    dsr_prob_pct: probPct,
    trials_tested: M,
    sr0_annual_threshold: round(sr0Ann, 2),
    skewness: moments.skewness,
    excess_kurtosis: moments.excess_kurtosis,
  };
}

// ─── 7. Ledoit-Wolf (2004), Politis-White L*, & Calibration Scoring ────────────

export interface LedoitWolfResult {
  cov: number[][];
  corr: number[][];
  lambda: number;
  avg_corr: number;
  sample_cov: number[][];
  weeks_used: number;
}

function isStrictPositiveDefinite(matrix: number[][]): boolean {
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
        if (!Number.isFinite(diag) || diag <= 1e-12) return false;
        L[i]![i] = Math.sqrt(diag);
      } else {
        L[i]![j] = (matrix[i]![j]! - sum) / L[j]![j]!;
      }
    }
  }
  return true;
}

export function projectToPsd(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];
  if (isStrictPositiveDefinite(matrix)) {
    return matrix.map((row) => [...row]);
  }
  const eigenpairs = jacobiEigenSymmetric(matrix);
  const maxEig = Math.max(...eigenpairs.map((ep) => ep.eigenvalue));
  const floorVal = maxEig > 1e-12 ? 1e-10 : 0;
  const out: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const ep of eigenpairs) {
    const lam = Math.max(floorVal, ep.eigenvalue);
    if (lam === 0) continue;
    for (let i = 0; i < n; i += 1) {
      const vi = ep.eigenvector[i]!;
      for (let j = i; j < n; j += 1) {
        out[i]![j]! += lam * vi * ep.eigenvector[j]!;
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      out[i]![j] = out[j]![i]!;
    }
  }
  return out;
}

/**
 * Exact Ledoit & Wolf (2004) "Honey, I Shrunk the Sample Covariance Matrix"
 * constant-correlation shrinkage estimator on a T x N return matrix.
 */
export function computeLedoitWolfConstantCorr(returnMatrix: number[][]): LedoitWolfResult {
  const T = returnMatrix.length;
  const N = T > 0 ? (returnMatrix[0]?.length ?? 0) : 0;
  if (N === 0) {
    return { cov: [], corr: [], lambda: 1, avg_corr: 0, sample_cov: [], weeks_used: T };
  }
  if (T === 0) {
    const fallbackCov = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => (i === j ? 1e-4 : 0)),
    );
    const fallbackCorr = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) => (i === j ? 1 : 0)),
    );
    return {
      cov: fallbackCov,
      corr: fallbackCorr,
      lambda: 1,
      avg_corr: 0,
      sample_cov: fallbackCov.map((r) => [...r]),
      weeks_used: 0,
    };
  }

  // Demean columns (sanitizing any non-finite inputs)
  const means = new Float64Array(N);
  for (let t = 0; t < T; t += 1) {
    const row = returnMatrix[t]!;
    for (let i = 0; i < N; i += 1) {
      const v = row[i] ?? 0;
      if (Number.isFinite(v)) means[i]! += v;
    }
  }
  for (let i = 0; i < N; i += 1) means[i] = means[i]! / T;

  const Y: Float64Array[] = Array.from({ length: T }, (_, t) => {
    const src = returnMatrix[t]!;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i += 1) {
      const v = src[i] ?? 0;
      out[i] = (Number.isFinite(v) ? v : 0) - means[i]!;
    }
    return out;
  });

  // 1/T sample covariance S
  const S: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0));
  for (let t = 0; t < T; t += 1) {
    const row = Y[t]!;
    for (let i = 0; i < N; i += 1) {
      const yi = row[i]!;
      for (let j = i; j < N; j += 1) {
        S[i]![j]! += yi * row[j]!;
      }
    }
  }
  for (let i = 0; i < N; i += 1) {
    for (let j = i; j < N; j += 1) {
      const val = S[i]![j]! / T;
      S[i]![j] = val;
      S[j]![i] = val;
    }
  }

  if (N === 1) {
    const s00 = Math.max(0, S[0]![0]!);
    return {
      cov: [[Math.max(1e-12, s00)]],
      corr: [[1]],
      lambda: 0,
      avg_corr: 0,
      sample_cov: [[s00]],
      weeks_used: T,
    };
  }

  const rawStds = Array.from({ length: N }, (_, i) => Math.sqrt(Math.max(0, S[i]![i]!)));
  const safeStds = Array.from({ length: N }, (_, i) => Math.sqrt(Math.max(1e-12, S[i]![i]!)));

  let corrSum = 0;
  let corrPairs = 0;
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      const rij = clamp(S[i]![j]! / (safeStds[i]! * safeStds[j]!), -1, 1);
      corrSum += rij;
      corrPairs += 1;
    }
  }
  const avgCorr = clamp(corrPairs > 0 ? corrSum / corrPairs : 0, -0.9, 0.95);

  const F: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (i === j ? S[i]![i]! : avgCorr * rawStds[i]! * rawStds[j]!)),
  );

  let lambda = 1;
  if (T >= 5) {
    const d2 = new Float64Array(N);
    const piMat: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0));
    const thetaMat: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0));
    for (let t = 0; t < T; t += 1) {
      const row = Y[t]!;
      for (let i = 0; i < N; i += 1) {
        d2[i] = row[i]! * row[i]! - S[i]![i]!;
      }
      for (let i = 0; i < N; i += 1) {
        const yi = row[i]!;
        const d2i = d2[i]!;
        for (let j = 0; j < N; j += 1) {
          const e = yi * row[j]! - S[i]![j]!;
          piMat[i]![j]! += e * e;
          thetaMat[i]![j]! += d2i * e;
        }
      }
    }

    let piHat = 0;
    let piDiagSum = 0;
    let rhoOffSum = 0;
    let gammaHat = 0;

    for (let i = 0; i < N; i += 1) {
      piDiagSum += piMat[i]![i]! / T;
      for (let j = 0; j < N; j += 1) {
        piHat += piMat[i]![j]! / T;
        const diff = F[i]![j]! - S[i]![j]!;
        gammaHat += diff * diff;
        if (i !== j) {
          const thetaIIij = thetaMat[i]![j]! / T;
          const thetaJJij = thetaMat[j]![i]! / T;
          rhoOffSum +=
            (avgCorr / 2) *
            ((safeStds[j]! / safeStds[i]!) * thetaIIij + (safeStds[i]! / safeStds[j]!) * thetaJJij);
        }
      }
    }

    const rhoHat = piDiagSum + rhoOffSum;
    if (gammaHat < 1e-12) {
      lambda = 0;
    } else {
      lambda = clamp((piHat - rhoHat) / (gammaHat * T), 0, 1);
    }
  }

  const rawCov: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (1 - lambda) * S[i]![j]! + lambda * F[i]![j]!),
  );
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      const sym = 0.5 * (rawCov[i]![j]! + rawCov[j]![i]!);
      rawCov[i]![j] = sym;
      rawCov[j]![i] = sym;
    }
  }

  const cov = projectToPsd(rawCov);
  const corr: number[][] = Array.from({ length: N }, () => Array<number>(N).fill(0));
  for (let i = 0; i < N; i += 1) {
    corr[i]![i] = 1;
    const di = Math.sqrt(Math.max(1e-12, cov[i]![i]!));
    for (let j = i + 1; j < N; j += 1) {
      const dj = Math.sqrt(Math.max(1e-12, cov[j]![j]!));
      const c =
        cov[i]![i]! > 0 && cov[j]![j]! > 0
          ? clamp(cov[i]![j]! / (di * dj), -0.95, 0.98)
          : 0;
      corr[i]![j] = c;
      corr[j]![i] = c;
    }
  }

  return {
    cov,
    corr,
    lambda: Number.isFinite(lambda) ? lambda : 1,
    avg_corr: Number.isFinite(avgCorr) ? avgCorr : 0,
    sample_cov: S,
    weeks_used: T,
  };
}

export interface PolitisWhiteResult {
  block_length_weeks: number;
  l_returns: number;
  l_abs_vol: number;
  bandwidth_m: number;
  sample_size: number;
}

function estimateSinglePolitisWhiteL(vals: number[]): { lStar: number; bandwidthM: number } {
  const T = vals.length;
  if (T < 30) {
    return { lStar: 6, bandwidthM: Math.max(1, Math.min(2, Math.floor(T / 4))) };
  }
  const mean = vals.reduce((s, v) => s + v, 0) / T;
  const centered = new Float64Array(T);
  for (let t = 0; t < T; t += 1) {
    centered[t] = vals[t]! - mean;
  }

  const autoCov = (lag: number): number => {
    if (lag < 0 || lag >= T) return 0;
    let sum = 0;
    const limit = T - lag;
    for (let t = 0; t < limit; t += 1) {
      sum += centered[t]! * centered[t + lag]!;
    }
    return sum / T;
  };

  const r0 = autoCov(0);
  if (r0 <= 1e-14) {
    return { lStar: 1, bandwidthM: 2 };
  }

  const log10T = Math.log10(T);
  const kT = Math.max(5, Math.ceil(Math.sqrt(log10T)));
  const threshold = 2 * Math.sqrt(log10T / T);
  const mMax = Math.max(2, Math.min(Math.ceil(Math.sqrt(T)) + kT, Math.floor(T / 4)));
  const maxCacheLag = Math.min(T - 1, Math.max(mMax + kT, mMax));
  const rCache = new Float64Array(maxCacheLag + 1);
  rCache[0] = r0;
  for (let k = 1; k <= maxCacheLag; k += 1) {
    rCache[k] = autoCov(k);
  }

  const maxSearchM = Math.max(1, Math.min(mMax, T - kT));
  let mHat = mMax;
  for (let m = 1; m <= maxSearchM; m += 1) {
    let allBelow = true;
    for (let k = 0; k < kT; k += 1) {
      const lag = m + k;
      if (lag >= T) {
        allBelow = false;
        break;
      }
      const rk = lag <= maxCacheLag ? rCache[lag]! : autoCov(lag);
      if (Math.abs(rk / r0) >= threshold) {
        allBelow = false;
        break;
      }
    }
    if (allBelow) {
      mHat = m;
      break;
    }
  }

  const M = clamp(2 * Math.max(1, mHat), 2, mMax);
  const flatTopTaper = (u: number): number => {
    const au = Math.abs(u);
    if (au <= 0.5) return 1;
    if (au <= 1) return 2 * (1 - au);
    return 0;
  };

  let g0Sum = r0;
  let gSum = 0;
  for (let k = 1; k <= M; k += 1) {
    const w = flatTopTaper(k / M);
    if (w === 0) continue;
    const rk = k <= maxCacheLag ? rCache[k]! : autoCov(k);
    g0Sum += 2 * w * rk;
    gSum += 2 * w * k * rk;
  }

  const g0 = Math.max(1e-12, g0Sum);
  const Dsb = 2 * g0 * g0;
  const Lsb = Math.pow((2 * gSum * gSum) / Math.max(1e-12, Dsb), 1 / 3) * Math.pow(T, 1 / 3);
  return {
    lStar: Number.isFinite(Lsb) ? Lsb : 6,
    bandwidthM: M,
  };
}

/**
 * Exact Politis & White (2004) / Patton-Politis-White (2009) automatic stationary-bootstrap
 * optimal block length L*, taking max over raw returns and demeaned absolute returns (vol clustering).
 */
export function computePolitisWhiteBlockLength(
  series: number[],
  opts?: { minL?: number; maxL?: number },
): PolitisWhiteResult {
  const minL = opts?.minL ?? 3;
  const maxL = Math.max(minL, opts?.maxL ?? 16);
  const clean = series.filter((v) => Number.isFinite(v));
  const T = clean.length;

  if (T < 30) {
    return {
      block_length_weeks: Math.round(clamp(6, minL, maxL)),
      l_returns: 6,
      l_abs_vol: 6,
      bandwidth_m: Math.max(1, Math.min(2, Math.floor(T / 4))),
      sample_size: T,
    };
  }

  const mean = clean.reduce((s, v) => s + v, 0) / T;
  const absDemeaned = clean.map((v) => Math.abs(v - mean));

  const retEst = estimateSinglePolitisWhiteL(clean);
  const volEst = estimateSinglePolitisWhiteL(absDemeaned);
  const rawMax = Math.max(retEst.lStar, volEst.lStar);

  return {
    block_length_weeks: Math.round(clamp(rawMax, minL, maxL)),
    l_returns: retEst.lStar,
    l_abs_vol: volEst.lStar,
    bandwidth_m: Math.max(retEst.bandwidthM, volEst.bandwidthM),
    sample_size: T,
  };
}

/**
 * Patton (2011) QLIKE quasi-likelihood variance forecast loss: ratio - ln(ratio) - 1.
 */
export function computeQlikeLoss(realizedVar: number, predictedVar: number): number {
  const real = Number.isFinite(realizedVar) ? Math.max(1e-10, realizedVar) : 1e-10;
  const pred = Number.isFinite(predictedVar) ? Math.max(1e-10, predictedVar) : 1e-10;
  const ratio = real / pred;
  return ratio - Math.log(ratio) - 1;
}

/**
 * Quantile / Pinball loss for quantile q in (0, 1).
 */
export function computePinballLoss(actual: number, predictedQuantile: number, q: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(predictedQuantile)) return 0;
  const qClamped = clamp(q, 1e-6, 1 - 1e-6);
  const err = actual - predictedQuantile;
  return err >= 0 ? qClamped * err : (qClamped - 1) * err;
}

export interface KupiecPofResult {
  breaches: number;
  total_windows: number;
  nominal_alpha: number;
  observed_rate_pct: number;
  lr_stat: number;
  p_value: number;
  calibrated: boolean;
}

/**
 * Exact Kupiec (1995) Proportion-of-Failures (POF) Likelihood Ratio test with chi2(1) p-value.
 */
export function computeKupiecPofTest(breaches: number, totalWindows: number, alpha = 0.05): KupiecPofResult {
  const N = Math.max(0, Math.round(totalWindows));
  const p = clamp(alpha, 1e-6, 1 - 1e-6);
  if (N === 0) {
    return {
      breaches: 0,
      total_windows: 0,
      nominal_alpha: p,
      observed_rate_pct: 0,
      lr_stat: 0,
      p_value: 1,
      calibrated: true,
    };
  }
  const x = clamp(Math.round(breaches), 0, N);
  const pHat = x / N;

  const ll0 = x * Math.log(p) + (N - x) * Math.log(1 - p);
  const ll1 =
    (x > 0 ? x * Math.log(pHat) : 0) +
    (x < N ? (N - x) * Math.log(1 - pHat) : 0);
  const lrStat = Math.max(0, 2 * (ll1 - ll0));
  const pValue = clamp(2 * (1 - normalCdf(Math.sqrt(Math.max(0, lrStat)))), 0, 1);

  return {
    breaches: x,
    total_windows: N,
    nominal_alpha: p,
    observed_rate_pct: (x / N) * 100,
    lr_stat: lrStat,
    p_value: pValue,
    calibrated: pValue >= 0.05,
  };
}

export interface SpearmanResult {
  rho: number;
  t_stat: number | null;
  n: number;
}

function averageRanks(values: number[]): number[] {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    const baseVal = values[order[i]!]!;
    while (j < n && values[order[j]!]! === baseVal) {
      j += 1;
    }
    // 1-based average rank across tied group [i, j)
    const avgRank = 0.5 * (i + 1 + j);
    for (let k = i; k < j; k += 1) {
      ranks[order[k]!] = avgRank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Exact Spearman rank correlation using average ranks for ties.
 */
export function computeSpearmanRankCorrelation(xs: number[], ys: number[]): SpearmanResult | null {
  if (xs.length !== ys.length) return null;
  const cleanX: number[] = [];
  const cleanY: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const xv = xs[i]!;
    const yv = ys[i]!;
    if (Number.isFinite(xv) && Number.isFinite(yv)) {
      cleanX.push(xv);
      cleanY.push(yv);
    }
  }
  const n = cleanX.length;
  if (n < 3) return null;

  const rx = averageRanks(cleanX);
  const ry = averageRanks(cleanY);
  const meanRank = (n + 1) / 2;

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = rx[i]! - meanRank;
    const dy = ry[i]! - meanRank;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom <= 1e-12) return null;

  const rho = clamp(num / denom, -1, 1);
  const tStat = Math.abs(rho) < 1 - 1e-12 ? rho * Math.sqrt((n - 2) / (1 - rho * rho)) : null;

  return { rho, t_stat: tStat, n };
}
