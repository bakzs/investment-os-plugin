import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBlackLittermanPosterior,
  computeDeflatedSharpeRatio,
  computeFactorRiskDecomposition,
  computeHigherMoments,
  computeHrpWeights,
  jacobiEigenSymmetric,
  normalCdf,
  normalInvCdf,
  runCorrelatedWealthSimulation,
  solveLinearSystem,
} from "../src/server/quant_sota.js";

test("linear algebra & normal distribution primitives satisfy analytical precision bounds", () => {
  // Normal CDF & Inverse CDF round-trip
  for (const p of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999]) {
    const z = normalInvCdf(p);
    assert.ok(Math.abs(normalCdf(z) - p) < 1e-6, `Round-trip error at p=${p}`);
  }
  assert.ok(Math.abs(normalCdf(1.9599639845) - 0.975) < 1e-6);

  // Linear system solver A x = b
  const A = [
    [4, 1, 2],
    [1, 3, 0],
    [2, 0, 5],
  ];
  const b = [11, 7, 17];
  const x = solveLinearSystem(A, b);
  for (let i = 0; i < 3; i += 1) {
    const lhs = A[i]![0]! * x[0]! + A[i]![1]! * x[1]! + A[i]![2]! * x[2]!;
    assert.ok(Math.abs(lhs - b[i]!) < 1e-9);
  }

  // Jacobi symmetric eigendecomposition reconstruction V Λ V' ≈ Σ and orthogonality V' V ≈ I
  const S = [
    [0.09, 0.045, 0.02],
    [0.045, 0.0625, 0.015],
    [0.02, 0.015, 0.04],
  ];
  const pairs = jacobiEigenSymmetric(S);
  assert.equal(pairs.length, 3);
  assert.ok(pairs[0]!.eigenvalue >= pairs[1]!.eigenvalue && pairs[1]!.eigenvalue >= pairs[2]!.eigenvalue);

  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let recon = 0;
      let dot = 0;
      for (let k = 0; k < 3; k += 1) {
        recon += pairs[k]!.eigenvalue * pairs[k]!.eigenvector[i]! * pairs[k]!.eigenvector[j]!;
        dot += pairs[i]!.eigenvector[k]! * pairs[j]!.eigenvector[k]!;
      }
      assert.ok(Math.abs(recon - S[i]![j]!) < 1e-8, `Reconstruction mismatch at (${i},${j})`);
      assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-8, `Orthogonality mismatch at (${i},${j})`);
    }
  }
});

test("Black-Litterman posterior shrinks views monotonically with Brier score and GIGO warnings", () => {
  const cov = [
    [0.09, 0.036, 0],
    [0.036, 0.04, 0],
    [0, 0, 0.000025],
  ];
  const baseAssets = [
    { ticker: "NVDA", is_cash: false, market_weight: 0.4, raw_view_cagr: 0.22, view_warnings_count: 0 },
    { ticker: "VWRA", is_cash: false, market_weight: 0.6, raw_view_cagr: null, view_warnings_count: 0 },
    { ticker: "CASH", is_cash: true, market_weight: 0, raw_view_cagr: null, view_warnings_count: 0 },
  ];

  const goodBrier = computeBlackLittermanPosterior(baseAssets, cov, {
    rfPct: 3.8,
    benchmarkCagrPct: 8.0,
    brierScore: 0.14,
    brierResolvedCount: 10,
  });
  const poorBrier = computeBlackLittermanPosterior(baseAssets, cov, {
    rfPct: 3.8,
    benchmarkCagrPct: 8.0,
    brierScore: 0.28,
    brierResolvedCount: 10,
  });
  const withWarnings = computeBlackLittermanPosterior(
    [
      { ...baseAssets[0]!, view_warnings_count: 3 },
      baseAssets[1]!,
      baseAssets[2]!,
    ],
    cov,
    {
      rfPct: 3.8,
      benchmarkCagrPct: 8.0,
      brierScore: 0.14,
      brierResolvedCount: 10,
    },
  );

  const nvGood = goodBrier.assets[0]!;
  const nvPoor = poorBrier.assets[0]!;
  const nvWarn = withWarnings.assets[0]!;

  // Posterior must sit strictly between equilibrium prior and aggressive 22% raw view
  assert.ok(nvGood.posterior_cagr_pct > nvGood.prior_cagr_pct && nvGood.posterior_cagr_pct < 22);
  // Poorer Brier calibration must pull posterior strictly closer to prior (lower posterior)
  assert.ok(nvPoor.posterior_cagr_pct < nvGood.posterior_cagr_pct);
  // Active GIGO warnings must pull posterior strictly closer to prior
  assert.ok(nvWarn.posterior_cagr_pct < nvGood.posterior_cagr_pct);
  // Cash remains fixed at risk-free rate
  assert.equal(goodBrier.assets[2]!.posterior_cagr_pct, 3.8);
});

test("PCA factor risk decomposition computes exact variance shares and Effective Number of Bets bounds", () => {
  // Case 1: 3 orthogonal equal-variance equal-weight assets -> N_eff = 3.0
  const diagCov = [
    [0.04, 0, 0],
    [0, 0.04, 0],
    [0, 0, 0.04],
  ];
  const ortho = computeFactorRiskDecomposition(
    ["A", "B", "C"],
    [false, false, false],
    [1 / 3, 1 / 3, 1 / 3],
    diagCov,
    null,
  );
  assert.ok(Math.abs(ortho.effective_bets - 3.0) < 0.05, `Expected N_eff ~3, got ${ortho.effective_bets}`);
  const sumOrtho = ortho.top_factors.reduce((s, f) => s + f.variance_share_pct, 0);
  assert.ok(Math.abs(sumOrtho - 100) < 0.5);

  // Case 2: 3 nearly identical assets (rho = 0.98) -> N_eff ~ 1.0
  const corrCov = [
    [0.09, 0.0882, 0.0882],
    [0.0882, 0.09, 0.0882],
    [0.0882, 0.0882, 0.09],
  ];
  const conc = computeFactorRiskDecomposition(
    ["NVDA", "AVGO", "AMD"],
    [false, false, false],
    [1 / 3, 1 / 3, 1 / 3],
    corrCov,
    0,
  );
  assert.ok(conc.effective_bets < 1.15, `Expected N_eff ~1, got ${conc.effective_bets}`);
  assert.ok(conc.top_factors[0]!.variance_share_pct > 95);
  assert.ok(conc.market_beta !== null && conc.systematic_risk_pct !== null && conc.systematic_risk_pct > 95);
});

test("HRP clusters correlated pair together and allocates balanced risk against uncorrelated diversifier", () => {
  // SemiA & SemiB have correlation 0.90 (same cluster), DivC has correlation 0.10 with both; identical 20% vol!
  const corr = [
    [1.0, 0.9, 0.1],
    [0.9, 1.0, 0.1],
    [0.1, 0.1, 1.0],
  ];
  const cov = corr.map((row) => row.map((c) => 0.2 * 0.2 * c));
  const hrp = computeHrpWeights(
    [
      { ticker: "SEMIA", is_cash: false, max_weight_pct: 100 },
      { ticker: "SEMIB", is_cash: false, max_weight_pct: 100 },
      { ticker: "DIVC", is_cash: false, max_weight_pct: 100 },
    ],
    cov,
    corr,
  );
  const wA = hrp.weights_by_ticker.SEMIA!;
  const wB = hrp.weights_by_ticker.SEMIB!;
  const wC = hrp.weights_by_ticker.DIVC!;
  // Total sums to 100%, DIVC receives significantly more weight (~49%) than each semi (~25.5%)
  assert.ok(Math.abs(wA + wB + wC - 100) < 0.3);
  assert.ok(wC > 45 && wA < 30 && wB < 30, `Expected DIVC > 45%, got A=${wA}, B=${wB}, C=${wC}`);
  assert.ok(Math.abs(wA - wB) < 0.2);
});

test("Politis-Romano stationary block bootstrap is deterministic and yields coherent CVaR <= P10 < P50 < P90", () => {
  const startMs = Date.parse("2022-01-03T00:00:00Z");
  const retA = new Map<string, number>();
  const retB = new Map<string, number>();
  for (let w = 0; w < 140; w += 1) {
    const dt = new Date(startMs + w * 7 * 86400 * 1000).toISOString().slice(0, 10);
    // Include a multi-week correlated bear stretch (weeks 20..35)
    const regime = w >= 20 && w <= 35 ? -0.025 : 0.004;
    retA.set(dt, regime + Math.sin(w * 0.7) * 0.025);
    retB.set(dt, regime * 0.6 + Math.cos(w * 0.5) * 0.015);
  }

  const simParams = {
    engineRequested: "block_bootstrap" as const,
    blockLengthWeeks: 6,
    horizonYears: 5,
    simulations: 400,
    volMultiplier: 1.0,
    assets: [
      { mu: 0.11, vol: 0.3, is_cash: false, retMap: retA },
      { mu: 0.08, vol: 0.18, is_cash: false, retMap: retB },
    ],
    cholL: [
      [0.3, 0],
      [0.09, 0.155],
    ],
    baseStartVec: [70000, 30000],
    simStartVec: [30000, 70000],
    seed: 123456,
  };

  const r1 = runCorrelatedWealthSimulation(simParams);
  const r2 = runCorrelatedWealthSimulation(simParams);
  assert.equal(r1.engine_used, "block_bootstrap");
  assert.equal(r1.aligned_weeks, 140);
  assert.deepEqual(r1.sim_year_samples[5], r2.sim_year_samples[5]);

  const sortedEnd = [...r1.sim_year_samples[5]!].sort((a, b) => a - b);
  const p10 = sortedEnd[Math.floor(sortedEnd.length * 0.1)]!;
  const p50 = sortedEnd[Math.floor(sortedEnd.length * 0.5)]!;
  const p90 = sortedEnd[Math.floor(sortedEnd.length * 0.9)]!;
  const tailN = Math.max(1, Math.floor(sortedEnd.length * 0.1));
  const cvar10 = sortedEnd.slice(0, tailN).reduce((s, v) => s + v, 0) / tailN;
  assert.ok(cvar10 <= p10 && p10 < p50 && p50 < p90);
  // Simulated max drawdowns are negative percentages
  assert.ok(r1.sim_path_max_dd_pct.every((dd) => dd <= 0));
});

test("Deflated Sharpe Ratio penalizes multiple testing (M trials) and negative crash skewness", () => {
  // Build mildly skewed vs heavily crash-skewed weekly return streams
  const calmRets: number[] = [];
  const crashRets: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const base = (i % 2 === 0 ? 0.012 : -0.008) + 0.002;
    calmRets.push(base);
    crashRets.push(i % 40 === 10 ? -0.14 : base + 0.003);
  }
  const calmMom = computeHigherMoments(calmRets);
  const crashMom = computeHigherMoments(crashRets);
  assert.ok(crashMom.skewness < calmMom.skewness);
  assert.ok(crashMom.cvar_95_pct < calmMom.cvar_95_pct);

  const dsr1 = computeDeflatedSharpeRatio({ annualizedSharpe: 1.0, weeklyReturns: calmRets, trialsTested: 1 });
  const dsr25 = computeDeflatedSharpeRatio({ annualizedSharpe: 1.0, weeklyReturns: calmRets, trialsTested: 25 });
  const dsrCrash = computeDeflatedSharpeRatio({ annualizedSharpe: 1.0, weeklyReturns: crashRets, trialsTested: 10 });
  const dsrCalm10 = computeDeflatedSharpeRatio({ annualizedSharpe: 1.0, weeklyReturns: calmRets, trialsTested: 10 });

  assert.ok(dsr1.dsr_prob_pct > 90);
  assert.ok(dsr25.dsr_prob_pct < dsr1.dsr_prob_pct, "More trials must reduce DSR probability");
  assert.ok(dsr25.sr0_annual_threshold > dsr1.sr0_annual_threshold);
  assert.ok(dsrCrash.dsr_prob_pct < dsrCalm10.dsr_prob_pct, "Negative skew + fat tails must reduce DSR");
});
