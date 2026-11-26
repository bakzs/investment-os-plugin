import assert from "node:assert/strict";
import test from "node:test";
import { runQuantWalkForwardEvaluation } from "../src/server/eval_harness.js";
import {
  computeKupiecPofTest,
  computeLedoitWolfConstantCorr,
  computePinballLoss,
  computePolitisWhiteBlockLength,
  computeQlikeLoss,
  computeSpearmanRankCorrelation,
  jacobiEigenSymmetric,
} from "../src/server/quant_sota.js";
import {
  PortfolioSchema,
  ProfileSchema,
  type HistoryCacheState,
  type HistoryPoint,
} from "../src/server/schema.js";

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

function sampleNormal(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function generateFactorReturns(T: number, N: number, seed: number): number[][] {
  const rng = mulberry32(seed);
  const loadings = Array.from({ length: N }, (_, i) => 0.5 + (i % 3) * 0.25);
  const out: number[][] = [];
  for (let t = 0; t < T; t += 1) {
    const market = sampleNormal(rng) * 0.02;
    const row = Array.from({ length: N }, (_, i) => {
      const idio = sampleNormal(rng) * (0.015 + (i % 4) * 0.004);
      return 0.0015 + loadings[i]! * market + idio;
    });
    out.push(row);
  }
  return out;
}

test("Ledoit-Wolf constant-correlation shrinkage is PSD, bounded, and shrinks more on small T than large T", () => {
  const smallSample = generateFactorReturns(15, 8, 101);
  const largeSample = generateFactorReturns(400, 8, 202);

  const lwSmall = computeLedoitWolfConstantCorr(smallSample);
  const lwLarge = computeLedoitWolfConstantCorr(largeSample);

  assert.equal(lwSmall.weeks_used, 15);
  assert.equal(lwLarge.weeks_used, 400);
  assert.ok(lwSmall.lambda >= 0 && lwSmall.lambda <= 1);
  assert.ok(lwLarge.lambda >= 0 && lwLarge.lambda <= 1);
  assert.ok(
    lwSmall.lambda > lwLarge.lambda,
    `Expected higher shrinkage on small T=15 (${lwSmall.lambda}) vs large T=400 (${lwLarge.lambda})`,
  );
  assert.ok(lwLarge.lambda < 0.35, `Expected low shrinkage at T=400, got ${lwLarge.lambda}`);

  for (const res of [lwSmall, lwLarge]) {
    const eigs = jacobiEigenSymmetric(res.cov);
    assert.ok(
      eigs.every((ep) => ep.eigenvalue >= -1e-10),
      `Covariance must be PSD; min eig=${Math.min(...eigs.map((e) => e.eigenvalue))}`,
    );
    assert.ok(res.avg_corr >= -0.9 && res.avg_corr <= 0.95);
    for (let i = 0; i < res.corr.length; i += 1) {
      assert.equal(res.corr[i]![i], 1);
      for (let j = i + 1; j < res.corr.length; j += 1) {
        assert.ok(Math.abs(res.corr[i]![j]! - res.corr[j]![i]!) < 1e-12);
        assert.ok(res.corr[i]![j]! >= -0.95 && res.corr[i]![j]! <= 0.98);
      }
    }
  }

  // Degenerate small T < 5 and constant-zero column must never produce NaN
  const tiny = [
    [0.01, -0.02, 0],
    [-0.01, 0.03, 0],
    [0.02, 0.01, 0],
  ];
  const lwTiny = computeLedoitWolfConstantCorr(tiny);
  assert.equal(lwTiny.lambda, 1);
  assert.ok(lwTiny.cov.flat().every((v) => Number.isFinite(v)));
  assert.ok(lwTiny.corr.flat().every((v) => Number.isFinite(v)));
  const tinyEigs = jacobiEigenSymmetric(lwTiny.cov);
  assert.ok(tinyEigs.every((ep) => ep.eigenvalue >= -1e-10));
});

test("Politis-White automatic L* is small on IID series and larger on persistent AR(1) and vol-clustered series", () => {
  const rng = mulberry32(4242);
  const T = 240;

  // 1. IID normal
  const iid: number[] = [];
  for (let t = 0; t < T; t += 1) iid.push(sampleNormal(rng) * 0.02);
  const pwIid = computePolitisWhiteBlockLength(iid, { minL: 2, maxL: 16 });
  assert.equal(pwIid.sample_size, T);
  assert.ok(pwIid.block_length_weeks <= 4, `Expected small L* for IID, got ${pwIid.block_length_weeks}`);

  // 2. Persistent AR(1): x_t = 0.78 * x_{t-1} + eps_t
  const ar1: number[] = [0];
  for (let t = 1; t < T; t += 1) {
    ar1.push(0.78 * ar1[t - 1]! + sampleNormal(rng) * 0.015);
  }
  const pwAr1 = computePolitisWhiteBlockLength(ar1, { minL: 2, maxL: 16 });
  assert.ok(
    pwAr1.l_returns > pwIid.l_returns && pwAr1.block_length_weeks >= 8,
    `Expected large L* for AR(1), got L*=${pwAr1.block_length_weeks} (l_returns=${pwAr1.l_returns})`,
  );

  // 3. Volatility-clustered series (zero return autocorrelation, strong |r_t - mean| persistence)
  const volClustered: number[] = [];
  let sigma = 0.01;
  for (let t = 0; t < T; t += 1) {
    const regimeVol = Math.floor(t / 24) % 2 === 0 ? 0.008 : 0.055;
    sigma = 0.75 * sigma + 0.25 * regimeVol;
    volClustered.push(sampleNormal(rng) * sigma);
  }
  const pwVol = computePolitisWhiteBlockLength(volClustered, { minL: 2, maxL: 16 });
  assert.ok(
    pwVol.l_abs_vol > pwVol.l_returns && pwVol.block_length_weeks >= 6,
    `Expected |r_t - mean| to drive larger block length on vol-clustered series, got L*=${pwVol.block_length_weeks}, l_abs_vol=${pwVol.l_abs_vol}, l_returns=${pwVol.l_returns}`,
  );

  // 4. Short-series fallback (< 30 samples)
  const shortPw = computePolitisWhiteBlockLength(iid.slice(0, 20));
  assert.equal(shortPw.block_length_weeks, 6);
  assert.equal(shortPw.sample_size, 20);
});

test("Kupiec POF test passes at nominal 5% breach rate and rejects at 25%", () => {
  const pass5 = computeKupiecPofTest(5, 100, 0.05);
  assert.equal(pass5.observed_rate_pct, 5);
  assert.ok(pass5.lr_stat < 1e-9);
  assert.ok(pass5.p_value > 0.99);
  assert.equal(pass5.calibrated, true);

  const reject25 = computeKupiecPofTest(25, 100, 0.05);
  assert.equal(reject25.observed_rate_pct, 25);
  assert.ok(reject25.lr_stat > 35);
  assert.ok(reject25.p_value < 1e-6);
  assert.equal(reject25.calibrated, false);

  const zeroBreachSmall = computeKupiecPofTest(0, 20, 0.05);
  assert.equal(zeroBreachSmall.calibrated, true);
  assert.ok(Number.isFinite(zeroBreachSmall.lr_stat) && zeroBreachSmall.p_value > 0.05);
});

test("QLIKE variance loss and Pinball quantile loss achieve strict minima at true variance and true quantiles", () => {
  const trueVar = 0.04;
  assert.equal(computeQlikeLoss(trueVar, trueVar), 0);
  for (const wrongVar of [0.01, 0.02, 0.06, 0.12]) {
    assert.ok(computeQlikeLoss(trueVar, wrongVar) > 0);
  }

  // Exact pointwise pinball values
  assert.ok(Math.abs(computePinballLoss(10, 8, 0.25) - 0.5) < 1e-12);
  assert.ok(Math.abs(computePinballLoss(8, 10, 0.25) - 1.5) < 1e-12);

  // Sample quantile optimality over {0.05, 0.10, 0.50, 0.90}
  const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const meanPinball = (pred: number, q: number): number =>
    samples.reduce((s, y) => s + computePinballLoss(y, pred, q), 0) / samples.length;

  for (const q of [0.05, 0.1, 0.5, 0.9]) {
    const trueQ = q * 100; // for 1..100, empirical q-quantile lies in [100q, 100q+1]
    const lossTrue = meanPinball(trueQ, q);
    const lossLow = meanPinball(trueQ - 5, q);
    const lossHigh = meanPinball(trueQ + 5, q);
    assert.ok(lossTrue < lossLow && lossTrue < lossHigh, `Pinball not optimal at q=${q}`);
  }
});

test("Spearman Rank IC computes exact rank correlation including ties", () => {
  const mono = computeSpearmanRankCorrelation([1, 3, 7, 15], [10, 20, 40, 80]);
  assert.ok(mono && Math.abs(mono.rho - 1) < 1e-12 && mono.t_stat === null && mono.n === 4);

  const rev = computeSpearmanRankCorrelation([1, 2, 3, 4], [40, 30, 20, 10]);
  assert.ok(rev && Math.abs(rev.rho + 1) < 1e-12 && rev.t_stat === null);

  // Ties: rx=[1, 2.5, 2.5, 4, 5], ry=[1, 3, 2, 4, 5] => rho = sqrt(0.95), t = sqrt(57)
  const tied = computeSpearmanRankCorrelation([10, 20, 20, 30, 40], [1, 3, 2, 4, 5]);
  assert.ok(tied !== null);
  assert.ok(Math.abs(tied.rho - Math.sqrt(0.95)) < 1e-10);
  assert.ok(tied.t_stat !== null && Math.abs(tied.t_stat - Math.sqrt(57)) < 1e-9);
  assert.equal(tied.n, 5);

  assert.equal(computeSpearmanRankCorrelation([1, 1, 1], [1, 2, 3]), null);
  assert.equal(computeSpearmanRankCorrelation([1, 2], [1, 2]), null);
  assert.equal(computeSpearmanRankCorrelation([1, 2, 3], [1, 2]), null);
});

function buildSyntheticSeries(
  startDate: string,
  weeks: number,
  startPx: number,
  weeklyFn: (w: number) => number,
): HistoryPoint[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const pts: HistoryPoint[] = [];
  let px = startPx;
  for (let w = 0; w <= weeks; w += 1) {
    const dt = new Date(startMs + w * 7 * 86400 * 1000).toISOString().slice(0, 10);
    if (w > 0) {
      px = Math.max(0.5, px * Math.exp(weeklyFn(w)));
    }
    pts.push({ date: dt, close: Math.round(px * 10000) / 10000 });
  }
  return pts;
}

test("runQuantWalkForwardEvaluation runs full zero-lookahead evaluation on multi-regime data and handles short history gracefully", () => {
  const rng = mulberry32(9001);
  const weeks = 200;
  const startDate = "2022-01-03";

  // Pre-generate common market shock with calm, crash/vol-cluster (w 75..95), and recovery regimes
  const mktShock: number[] = [];
  for (let w = 0; w <= weeks; w += 1) {
    const crashRegime = w >= 75 && w <= 95;
    const drift = crashRegime ? -0.012 : 0.0022;
    const vol = crashRegime ? 0.036 : 0.016;
    mktShock.push(drift + sampleNormal(rng) * vol);
  }

  const makeAssetSeries = (startPx: number, beta: number, idioVol: number, alpha: number) =>
    buildSyntheticSeries(startDate, weeks, startPx, (w) => {
      const crashVolBoost = w >= 75 && w <= 95 ? 1.5 : 1.0;
      return alpha + beta * mktShock[w]! + sampleNormal(rng) * idioVol * crashVolBoost;
    });

  // EUR/USD FX path for foreign-currency asset conversion test
  const fxPoints = buildSyntheticSeries(startDate, weeks, 1.1, () => sampleNormal(rng) * 0.006);

  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-22T00:00:00Z",
    series: {
      VWRA: { symbol: "VWRA", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(100, 0.9, 0.008, 0.0005) },
      TECH: { symbol: "TECH", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(200, 1.35, 0.022, 0.0012) },
      EURO: { symbol: "EURO.DE", currency: "EUR", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(80, 0.75, 0.016, 0.0004) },
      EXTEQ: { symbol: "EXTEQ", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(150, 1.1, 0.018, 0.0008) },
      SHORTIPO: { symbol: "SHORTIPO", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(50, 1.0, 0.02, 0).slice(-25) },
      "EURUSD=X": { symbol: "EURUSD=X", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: fxPoints },
    },
  };

  const profile = ProfileSchema.parse({
    base_currency: "USD",
    external_exposure: {
      enabled: true,
      label: "External Equity",
      ticker: "EXTEQ",
      amount_base: 25000,
      us_situs: true,
    },
  });

  const portfolio = PortfolioSchema.parse({
    as_of: "2026-11-22T00:00:00Z",
    cash_base: 5000,
    fx_rates: { USD: 1.0, EUR: 1.08 },
    positions: [
      { ticker: "VWRA", yf_symbol: "VWRA", currency: "USD", qty: 400, ref_price: 100 },
      { ticker: "TECH", yf_symbol: "TECH", currency: "USD", qty: 150, ref_price: 200 },
      { ticker: "EURO", yf_symbol: "EURO.DE", currency: "EUR", qty: 200, ref_price: 80 },
      { ticker: "SHORTIPO", yf_symbol: "SHORTIPO", currency: "USD", qty: 100, ref_price: 50 },
    ],
  });

  const res1 = runQuantWalkForwardEvaluation(
    { horizon_weeks: 13, tx_cost_bps: 10, include_external_wealth: true },
    portfolio,
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.08 },
  );
  const res2 = runQuantWalkForwardEvaluation(
    { horizon_weeks: 13, tx_cost_bps: 10, include_external_wealth: true },
    portfolio,
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.08 },
  );

  // Deterministic repeatability
  assert.deepEqual(res1, res2);
  assert.ok(res1.status === "CALIBRATED" || res1.status === "WARN");
  assert.equal(res1.horizon_weeks, 13);
  assert.equal(res1.warmup_weeks, 52);
  assert.equal(res1.aligned_weeks, weeks);
  assert.equal(res1.windows_evaluated, Math.floor((weeks - 52) / 13));
  assert.deepEqual(res1.assets_excluded, ["SHORTIPO"]);
  assert.ok(res1.assets_included.includes("EXTEQ"));
  assert.ok(res1.assets_included.includes("EURO"));
  assert.ok(res1.date_range !== null);
  assert.ok(res1.avg_lw_lambda !== null && res1.avg_lw_lambda >= 0 && res1.avg_lw_lambda <= 1);
  assert.ok(res1.avg_auto_block_length !== null && res1.avg_auto_block_length >= 3);

  // Covariance eval check
  assert.equal(res1.covariance_eval.length, 3);
  assert.equal(res1.covariance_eval.filter((r) => r.is_winner).length, 1);
  for (const row of res1.covariance_eval) {
    assert.ok(Number.isFinite(row.qlike_loss) && row.qlike_loss >= 0);
    assert.ok(Number.isFinite(row.vol_rmse_pct) && row.vol_rmse_pct >= 0);
    assert.ok(row.realized_to_predicted_vol_ratio > 0);
  }

  // Tail eval check
  assert.equal(res1.tail_eval.length, 3);
  assert.equal(res1.tail_eval.filter((r) => r.is_winner).length, 1);
  for (const row of res1.tail_eval) {
    assert.equal(row.total_windows, res1.windows_evaluated);
    assert.ok(row.kupiec_pof_pvalue >= 0 && row.kupiec_pof_pvalue <= 1);
    assert.ok(row.mean_pinball_loss_pct >= 0);
    assert.ok(row.coverage_80_pct >= 0 && row.coverage_80_pct <= 100);
    assert.ok(row.cvar95_shortfall_ratio >= 0);
  }

  // Allocation horse race check
  assert.equal(res1.allocation_horse_race.length, 4);
  for (const row of res1.allocation_horse_race) {
    assert.ok(Number.isFinite(row.oos_cagr_pct));
    assert.ok(row.oos_vol_pct > 0);
    assert.ok(row.oos_max_dd_pct <= 0);
    assert.ok(Number.isFinite(row.oos_sharpe));
    assert.ok(row.oos_cvar95_weekly_pct <= 0);
    assert.ok(row.annual_turnover_pct >= 0);
  }

  // include_external_wealth: false excludes EXTEQ, and 26-week horizon halves windows
  const res26NoExt = runQuantWalkForwardEvaluation(
    { horizon_weeks: 26, tx_cost_bps: 25, include_external_wealth: false },
    portfolio,
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.08 },
  );
  assert.equal(res26NoExt.include_external_wealth, false);
  assert.ok(!res26NoExt.assets_included.includes("EXTEQ"));
  assert.equal(res26NoExt.horizon_weeks, 26);
  assert.equal(res26NoExt.windows_evaluated, Math.floor((weeks - 52) / 26));

  // Graceful INSUFFICIENT_HISTORY fallback (never throws)
  const shortCache: HistoryCacheState = {
    updated_at: "2026-11-22T00:00:00Z",
    series: {
      VWRA: { symbol: "VWRA", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(100, 0.9, 0.01, 0).slice(0, 40) },
      TECH: { symbol: "TECH", currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: makeAssetSeries(200, 1.2, 0.02, 0).slice(0, 40) },
    },
  };
  const shortRes = runQuantWalkForwardEvaluation(
    { horizon_weeks: 13 },
    portfolio,
    profile,
    shortCache,
    { USD: 1.0 },
  );
  assert.equal(shortRes.status, "INSUFFICIENT_HISTORY");
  assert.equal(shortRes.windows_evaluated, 0);
  assert.equal(shortRes.covariance_eval.length, 0);
  assert.ok(shortRes.findings.length >= 1);
});

test("runQuantWalkForwardEvaluation runs 260w x 12 assets cleanly within 120ms budget", () => {
  const rng = mulberry32(777);
  const weeks = 260;
  const startDate = "2021-11-01";
  const mkt = Array.from({ length: weeks + 1 }, () => 0.002 + sampleNormal(rng) * 0.018);

  const series: HistoryCacheState["series"] = {};
  const positions = [];
  for (let i = 0; i < 12; i += 1) {
    const ticker = `AST${i + 1}`;
    const beta = 0.7 + (i % 5) * 0.2;
    const pts = buildSyntheticSeries(startDate, weeks, 100 + i * 10, (w) => beta * mkt[w]! + sampleNormal(rng) * 0.016);
    series[ticker] = { symbol: ticker, currency: "USD", source: "yahoo", updated_at: "2026-11-22T00:00:00Z", points: pts };
    positions.push({ ticker, yf_symbol: ticker, currency: "USD", qty: 100, ref_price: 100 + i * 10 });
  }

  const profile = ProfileSchema.parse({ base_currency: "USD" });
  const portfolio = PortfolioSchema.parse({ as_of: "2026-11-22T00:00:00Z", positions });
  const cache: HistoryCacheState = { updated_at: "2026-11-22T00:00:00Z", series };

  // Warmup JIT once, then measure
  runQuantWalkForwardEvaluation({ horizon_weeks: 13 }, portfolio, profile, cache, { USD: 1.0 });
  const t0 = performance.now();
  const res = runQuantWalkForwardEvaluation({ horizon_weeks: 13 }, portfolio, profile, cache, { USD: 1.0 });
  const elapsedMs = performance.now() - t0;

  assert.equal(res.assets_included.length, 12);
  assert.equal(res.windows_evaluated, 16);
  assert.ok(elapsedMs < 120, `Expected <120ms for 260w x 12 assets, took ${elapsedMs.toFixed(1)}ms`);
});
