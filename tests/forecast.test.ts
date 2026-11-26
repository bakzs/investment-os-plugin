import assert from "node:assert/strict";
import test from "node:test";
import { runPortfolioForecast, type ForecastThesisRef } from "../src/server/forecast.js";
import { computeAfterTaxHurdle, computeCapitalRotationQueue, computeScenarioSummary } from "../src/server/quant.js";
import { jacobiEigenSymmetric, projectToPsd } from "../src/server/quant_sota.js";
import {
  DossierModelSchema,
  EtfWeightsConfigSchema,
  ForecastRequestSchema,
  PortfolioSchema,
  ProfileSchema,
  type HistoryCacheState,
  type HistoryPoint,
} from "../src/server/schema.js";

function makeWeeklyPoints(startDate: string, weeks: number, drift: number, startPx: number, phase = 0): HistoryPoint[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const pts: HistoryPoint[] = [];
  let px = startPx;
  for (let i = 0; i <= weeks; i += 1) {
    const dt = new Date(startMs + i * 7 * 86400 * 1000).toISOString().slice(0, 10);
    if (i > 0) {
      const wave = Math.sin((i + phase) * 0.65) * 0.018 + Math.cos((i + phase * 2) * 0.31) * 0.012;
      px = Math.max(1, px * (1 + drift + wave));
    }
    pts.push({ date: dt, close: Math.round(px * 10000) / 10000 });
  }
  return pts;
}

test("runPortfolioForecast simulates tax swaps, mandatory exits, planned buys, cash shortfalls, fat-tail bands, and risk sizing deterministically", () => {
  const profile = ProfileSchema.parse({
    base_currency: "USD",
    tax_profile: {
      country_code: "SG",
      nra_us_estate_tax_enabled: true,
      us_dividend_wht_pct: 30,
      ucits_dividend_wht_pct: 15,
    },
    benchmark: {
      ticker: "VWRA",
      yf_symbol: "VWRA.L",
      label: "VWRA.L Core Global",
      expected_cagr_pct: 8.0,
      alpha_buffer_pct: 2.5,
      estate_tax_drag_mode: "hedge",
      estate_tax_hedge_bps: 35,
    },
    risk_caps: [
      { id: "us-situs", label: "US-Situs Cap", kind: "us_situs", cap_pct: 60 },
      { id: "single-max", label: "Single Name Max", kind: "single_name_max", cap_pct: 20 },
    ],
  });

  const portfolio = PortfolioSchema.parse({
    as_of: "2026-11-26T00:00:00Z",
    cash_base: 10000,
    accruals_base: 0,
    fx_rates: { USD: 1.0 },
    positions: [
      { ticker: "QQQ", yf_symbol: "QQQ", asset_type: "US ETF", domicile: "US", us_situs: true, currency: "USD", qty: 100, avg_cost: 400, ref_price: 500 }, // $50k US ETF
      { ticker: "VWRA", yf_symbol: "VWRA.L", asset_type: "UCITS ETF", domicile: "Ireland", us_situs: false, currency: "USD", qty: 100, avg_cost: 150, ref_price: 180 }, // $18k UCITS
      { ticker: "HYPE", yf_symbol: "HYPE", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 200, avg_cost: 60, ref_price: 50 }, // $10k held EXIT
      { ticker: "MSFT", yf_symbol: "MSFT", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 24, avg_cost: 400, ref_price: 500 }, // $12k active
    ],
  });
  // Total starting wealth = 50k + 18k + 10k + 12k + 10k cash = $100,000; US-situs = 72% (> 60% cap!)

  const etfWeights = EtfWeightsConfigSchema.parse({
    as_of: "2026-11-26",
    etf_weights: {
      VWRA: { MSFT: 0.04, AAPL: 0.04 },
      QQQ: { MSFT: 0.08, AAPL: 0.08 },
    },
  });

  const taxMsft = computeAfterTaxHurdle(profile, true, 0.7, 34);
  const msftModel = DossierModelSchema.parse({
    horizon_years: 5,
    dividend_yield_pct: 0.7,
    scenarios: {
      bear: { probability: 0.25, target_price_5y: 450, summary: "Bear" },
      base: { probability: 0.5, target_price_5y: 850, summary: "Base" },
      bull: { probability: 0.25, target_price_5y: 1100, summary: "Bull" },
    },
  });
  const msftScen = computeScenarioSummary(500, msftModel, taxMsft);

  const theses: ForecastThesisRef[] = [
    {
      ticker: "MSFT",
      yf_symbol: "MSFT",
      currency: "USD",
      us_situs: true,
      price: 500,
      max_weight_pct: 15,
      scenario_summary: msftScen,
      model: msftModel,
      quality_grade: "A",
    },
    {
      ticker: "ACME",
      yf_symbol: "ACME",
      currency: "USD",
      us_situs: true,
      price: 100,
      max_weight_pct: 12,
      scenario_summary: computeScenarioSummary(
        100,
        DossierModelSchema.parse({
          horizon_years: 5,
          dividend_yield_pct: 0,
          scenarios: {
            bear: { probability: 0.25, target_price_5y: 80, summary: "Bear" },
            base: { probability: 0.5, target_price_5y: 210, summary: "Base" },
            bull: { probability: 0.25, target_price_5y: 280, summary: "Bull" },
          },
        }),
        computeAfterTaxHurdle(profile, true, 0, 34),
      ),
      quality_grade: "A",
    },
  ];

  const riskCaps = [
    { id: "us-situs", label: "US-Situs Cap", value_pct: 72, cap_pct: 60, status: "BREACH" as const },
    { id: "single-max", label: "Single Name Max", value_pct: 16.7, cap_pct: 20, status: "PASS" as const },
  ];
  const lookthrough = [
    { name: "MSFT", total_usd: 16720, total_base: 16720, pct_nav: 16.72 },
    { name: "HYPE", total_usd: 10000, total_base: 10000, pct_nav: 10 },
  ];
  const queue = computeCapitalRotationQueue(
    portfolio,
    lookthrough,
    riskCaps,
    [{ ticker: "HYPE", tier: "passed", verdict: "EXIT", max_weight_pct: 0, kill_switch_triggered: true }],
    profile,
    1.0,
  );

  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-26T00:00:00Z",
    series: {
      "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2022-01-03", 180, 0.0018, 100, 0) },
      QQQ: { symbol: "QQQ", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2022-01-03", 180, 0.0024, 350, 1) },
      MSFT: { symbol: "MSFT", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2022-01-03", 180, 0.0026, 300, 2) },
      HYPE: { symbol: "HYPE", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2022-01-03", 180, -0.0005, 80, 3) },
      ACME: { symbol: "ACME", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2022-01-03", 180, 0.0031, 60, 4) },
    },
  };

  const req = ForecastRequestSchema.parse({
    horizon_years: 5,
    simulations: 600,
    apply_recommended_rotations: true,
    actions: [
      { type: "buy", ticker: "ACME", amount_base: 12000 },
      { type: "park_cash_in_benchmark" },
    ],
    rf_pct: 3.8,
  });

  const res1 = runPortfolioForecast(req, portfolio, profile, theses, queue, etfWeights, historyCache, { USD: 1.0 });
  const res2 = runPortfolioForecast(req, portfolio, profile, theses, queue, etfWeights, historyCache, { USD: 1.0 });

  // 1. Seeded deterministic repeatability
  assert.deepEqual(res1, res2);

  // 2. Starting wealth conserved ($100,000), v0.8 defaults active (BL + Block Bootstrap + Analytical LW + Politis-White L*), & tail ordering holds
  assert.equal(res1.return_model, "black_litterman");
  assert.equal(res1.simulation_engine_used, "block_bootstrap");
  assert.equal(res1.lw_shrinkage_method, "analytical_lw");
  assert.ok(res1.lw_shrinkage_lambda >= 0 && res1.lw_shrinkage_lambda <= 1);
  assert.equal(res1.block_length_mode, "politis_white_auto");
  assert.ok(res1.block_length_weeks >= 3 && res1.block_length_weeks <= 16);
  assert.ok(res1.methodology_note.includes("λ*="));
  assert.ok(res1.methodology_note.includes("Auto L*="));
  assert.equal(res1.baseline.starting_wealth_base, 100000);
  assert.equal(res1.simulated.starting_wealth_base, 100000);
  assert.ok(res1.baseline.ending_cvar_10_base <= res1.baseline.ending_p10_base);
  assert.ok(res1.baseline.ending_p10_base < res1.baseline.ending_p50_base);
  assert.ok(res1.baseline.ending_p50_base < res1.baseline.ending_p90_base);
  assert.ok(res1.simulated.ending_cvar_10_base <= res1.simulated.ending_p10_base);
  assert.ok(res1.simulated.ending_p10_base < res1.simulated.ending_p50_base);
  assert.ok(res1.simulated.ending_p50_base < res1.simulated.ending_p90_base);
  assert.ok(res1.simulated.sim_max_dd_p95_pct <= res1.simulated.sim_max_dd_p50_pct && res1.simulated.sim_max_dd_p50_pct <= 0);
  assert.ok(res1.simulated.factor_risk.effective_bets >= 1);
  assert.ok(res1.simulated.factor_risk.top_factors.length >= 1);
  assert.equal(res1.simulated.trajectory.length, 6); // Year 0..5

  // 3. QQQ -> VWRA tax swap + HYPE exit cured US-Situs cap & reduced NRA estate tax to $0 (US-situs drops from $72k to $24k <= $60k threshold!)
  assert.ok(res1.deltas.cured_caps.includes("US-Situs Cap"));
  assert.ok(res1.deltas.estate_tax_saved_base > 0);
  assert.equal(res1.simulated.estate_tax_base, 0);
  assert.ok(res1.deltas.us_situs_delta_pct < -40);
  assert.equal(res1.cash_shortfall_base, 0);
  assert.equal(res1.simulated.ending_cash_base, 0); // park_cash_in_benchmark deployed residual $8k into VWRA

  // 4. Risk sizing metrics: Marginal Risk Contributions & HRP weights sum to ~100%, BL shrinks ACME toward prior
  const totalMrc = res1.positions.reduce((s, p) => s + p.marginal_risk_contrib_pct, 0);
  assert.ok(totalMrc > 98 && totalMrc < 102, `Expected total MRC ~100%, got ${totalMrc}`);
  const totalHrp = res1.positions.filter((p) => !p.is_cash && p.after_value_base > 0).reduce((s, p) => s + p.hrp_weight_pct, 0);
  assert.ok(totalHrp > 98 && totalHrp < 102, `Expected total HRP ~100%, got ${totalHrp}`);
  const acmeRow = res1.positions.find((p) => p.ticker === "ACME");
  assert.ok(acmeRow);
  assert.equal(acmeRow.after_value_base, 12000);
  assert.equal(acmeRow.quality_grade, "A");
  assert.equal(acmeRow.return_source, "black_litterman");
  assert.ok(acmeRow.raw_view_cagr_pct !== null && acmeRow.expected_cagr_pct < acmeRow.raw_view_cagr_pct);
  assert.ok(acmeRow.quarter_kelly_weight_pct > 0 && acmeRow.quarter_kelly_weight_pct <= 12);
  assert.ok(acmeRow.hrp_weight_pct > 0);
  assert.ok(acmeRow.corr_adjusted_hurdle_pct >= 8.0);

  // Raw Dossier + Student-t toggle check
  const rawStudentReq = ForecastRequestSchema.parse({
    horizon_years: 5,
    simulations: 400,
    apply_recommended_rotations: true,
    return_model: "raw_dossier",
    simulation_engine: "student_t",
    actions: [{ type: "buy", ticker: "ACME", amount_base: 12000 }],
  });
  const rawStudentRes = runPortfolioForecast(rawStudentReq, portfolio, profile, theses, queue, etfWeights, historyCache, { USD: 1.0 });
  assert.equal(rawStudentRes.return_model, "raw_dossier");
  assert.equal(rawStudentRes.simulation_engine_used, "student_t");
  assert.equal(rawStudentRes.positions.find((p) => p.ticker === "ACME")?.return_source, "dossier_scenarios");

  // 5. Cash shortfall capping when user enters a buy exceeding cash + freed proceeds
  const overBuyReq = ForecastRequestSchema.parse({
    horizon_years: 3,
    simulations: 400,
    apply_recommended_rotations: false,
    actions: [{ type: "buy", ticker: "ACME", amount_base: 25000 }], // only $10k cash available
  });
  const overBuyRes = runPortfolioForecast(overBuyReq, portfolio, profile, theses, queue, etfWeights, historyCache, { USD: 1.0 });
  assert.equal(overBuyRes.cash_shortfall_base, 15000);
  assert.equal(overBuyRes.positions.find((p) => p.ticker === "ACME")?.after_value_base, 10000);
  assert.equal(overBuyRes.simulated.ending_cash_base, 0);

  // 6. Manual block_length_weeks override vs null auto mode
  const manualBlockReq = ForecastRequestSchema.parse({
    horizon_years: 3,
    simulations: 300,
    block_length_weeks: 12,
  });
  const manualBlockRes = runPortfolioForecast(
    manualBlockReq,
    portfolio,
    profile,
    theses,
    queue,
    etfWeights,
    historyCache,
    { USD: 1.0 },
  );
  assert.equal(manualBlockRes.block_length_mode, "manual");
  assert.equal(manualBlockRes.block_length_weeks, 12);
  assert.ok(manualBlockRes.methodology_note.includes("Manual L=12w"));

  // 7. Short-history fallback (<52w common overlap -> fallback_fixed lambda=0.25)
  const shortCache: HistoryCacheState = {
    updated_at: "2026-11-26T00:00:00Z",
    series: {
      "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2026-01-05", 35, 0.0018, 100, 0) },
      QQQ: { symbol: "QQQ", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2026-01-05", 35, 0.0024, 350, 1) },
      MSFT: { symbol: "MSFT", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: makeWeeklyPoints("2026-01-05", 35, 0.0026, 300, 2) },
    },
  };
  const fallbackRes = runPortfolioForecast(
    ForecastRequestSchema.parse({ horizon_years: 3, simulations: 300 }),
    portfolio,
    profile,
    theses,
    queue,
    etfWeights,
    shortCache,
    { USD: 1.0 },
  );
  assert.equal(fallbackRes.lw_shrinkage_method, "fallback_fixed");
  assert.equal(fallbackRes.lw_shrinkage_lambda, 0.25);
  assert.equal(fallbackRes.block_length_mode, "politis_white_auto");
  assert.equal(fallbackRes.simulation_engine_used, "student_t");
});

test("projectToPsd floors rank-deficient zero eigenvalues >= 1e-10 and forecast deduplicates canonical assets cleanly", () => {
  // 1. projectToPsd must floor zero and negative eigenvalues to >= 1e-10 (strictly positive definite)
  const singularPsd = [
    [0.09, 0.09],
    [0.09, 0.09],
  ];
  const psd1 = projectToPsd(singularPsd);
  const eigs1 = jacobiEigenSymmetric(psd1);
  assert.ok(
    eigs1.every((ep) => ep.eigenvalue >= 1e-10 - 1e-13),
    `Expected strictly positive eigenvalues >= 1e-10, got ${eigs1.map((e) => e.eigenvalue)}`,
  );

  const indefinite = [
    [0.04, 0.06],
    [0.06, 0.04],
  ];
  const psd2 = projectToPsd(indefinite);
  const eigs2 = jacobiEigenSymmetric(psd2);
  assert.ok(eigs2.every((ep) => ep.eigenvalue >= 1e-10 - 1e-13));

  // 2. Duplicate canonical holdings (GOOG brokerage + EXT:GOOG external + MSFT + VWRA)
  // must keep analytical_lw, merge canonical weights in LW/PW, and yield identical lambda/L* vs consolidated GOOG
  const googPts = makeWeeklyPoints("2022-01-03", 180, 0.0025, 140, 1);
  const msftPts = makeWeeklyPoints("2022-01-03", 180, 0.0021, 300, 3);
  const vwraPts = makeWeeklyPoints("2022-01-03", 180, 0.0017, 100, 5);
  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-26T00:00:00Z",
    series: {
      GOOG: { symbol: "GOOG", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: googPts },
      MSFT: { symbol: "MSFT", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: msftPts },
      "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "yahoo", updated_at: "2026-11-26T00:00:00Z", points: vwraPts },
    },
  };

  const splitProfile = ProfileSchema.parse({
    base_currency: "USD",
    benchmark: { ticker: "VWRA", yf_symbol: "VWRA.L", label: "VWRA.L", expected_cagr_pct: 8 },
    external_exposure: { enabled: true, label: "External GOOG", ticker: "GOOG", amount_base: 30000, us_situs: true },
  });
  const splitPortfolio = PortfolioSchema.parse({
    as_of: "2026-11-26T00:00:00Z",
    cash_base: 5000,
    positions: [
      { ticker: "GOOG", yf_symbol: "GOOG", currency: "USD", qty: 100, ref_price: 200 }, // $20k
      { ticker: "MSFT", yf_symbol: "MSFT", currency: "USD", qty: 100, ref_price: 300 }, // $30k
      { ticker: "VWRA", yf_symbol: "VWRA.L", currency: "USD", qty: 200, ref_price: 100 }, // $20k
    ],
  });

  const mergedProfile = ProfileSchema.parse({
    base_currency: "USD",
    benchmark: { ticker: "VWRA", yf_symbol: "VWRA.L", label: "VWRA.L", expected_cagr_pct: 8 },
    external_exposure: { enabled: false },
  });
  const mergedPortfolio = PortfolioSchema.parse({
    as_of: "2026-11-26T00:00:00Z",
    cash_base: 5000,
    positions: [
      { ticker: "GOOG", yf_symbol: "GOOG", currency: "USD", qty: 250, ref_price: 200 }, // $50k consolidated
      { ticker: "MSFT", yf_symbol: "MSFT", currency: "USD", qty: 100, ref_price: 300 }, // $30k
      { ticker: "VWRA", yf_symbol: "VWRA.L", currency: "USD", qty: 200, ref_price: 100 }, // $20k
    ],
  });

  const emptyQueue = {
    tax_swaps: [],
    mandatory_exits: [],
    cap_trims: [],
    total_swap_base: 0,
    total_freed_base: 0,
    total_estate_tax_saved_base: 0,
  };
  const emptyEtf = EtfWeightsConfigSchema.parse({});
  const req = ForecastRequestSchema.parse({ horizon_years: 5, simulations: 400, include_external_wealth: true });

  const splitRes = runPortfolioForecast(req, splitPortfolio, splitProfile, [], emptyQueue, emptyEtf, historyCache, { USD: 1.0 });
  const mergedRes = runPortfolioForecast(req, mergedPortfolio, mergedProfile, [], emptyQueue, emptyEtf, historyCache, { USD: 1.0 });

  assert.equal(splitRes.lw_shrinkage_method, "analytical_lw");
  assert.equal(splitRes.lw_shrinkage_lambda, mergedRes.lw_shrinkage_lambda);
  assert.equal(splitRes.block_length_weeks, mergedRes.block_length_weeks);
  assert.ok(Number.isFinite(splitRes.simulated.ending_p50_base) && splitRes.simulated.ending_p50_base > 0);
  assert.ok(Number.isFinite(splitRes.simulated.annual_vol_pct) && splitRes.simulated.annual_vol_pct > 0);

  // Also test GOOG + GOOGL + EXT:GOOG + MSFT + VWRA together (3 duplicate canonical slots alongside other risky assets)
  const triPortfolio = PortfolioSchema.parse({
    as_of: "2026-11-26T00:00:00Z",
    cash_base: 5000,
    positions: [
      { ticker: "GOOG", yf_symbol: "GOOG", currency: "USD", qty: 50, ref_price: 200 },
      { ticker: "GOOGL", yf_symbol: "GOOG", currency: "USD", qty: 50, ref_price: 200 },
      { ticker: "MSFT", yf_symbol: "MSFT", currency: "USD", qty: 100, ref_price: 300 },
      { ticker: "VWRA", yf_symbol: "VWRA.L", currency: "USD", qty: 200, ref_price: 100 },
    ],
  });
  const triRes = runPortfolioForecast(req, triPortfolio, splitProfile, [], emptyQueue, emptyEtf, historyCache, { USD: 1.0 });
  assert.equal(triRes.lw_shrinkage_method, "analytical_lw");
  assert.equal(triRes.lw_shrinkage_lambda, mergedRes.lw_shrinkage_lambda);
  assert.equal(triRes.block_length_weeks, mergedRes.block_length_weeks);
  assert.ok(Number.isFinite(triRes.simulated.ending_p50_base) && triRes.simulated.ending_p50_base > 0);

  // Single-canonical-only duplicate (GOOG + EXT:GOOG + GOOGL) must NOT run LW on duplicate columns
  const singleCanonProfile = ProfileSchema.parse({
    base_currency: "USD",
    external_exposure: { enabled: true, label: "External GOOG", ticker: "GOOG", amount_base: 25000, us_situs: true },
  });
  const singleCanonPortfolio = PortfolioSchema.parse({
    as_of: "2026-11-26T00:00:00Z",
    cash_base: 5000,
    positions: [
      { ticker: "GOOG", yf_symbol: "GOOG", currency: "USD", qty: 100, ref_price: 200 },
      { ticker: "GOOGL", yf_symbol: "GOOG", currency: "USD", qty: 50, ref_price: 200 },
    ],
  });
  const singleCanonRes = runPortfolioForecast(req, singleCanonPortfolio, singleCanonProfile, [], emptyQueue, emptyEtf, historyCache, { USD: 1.0 });
  assert.equal(singleCanonRes.lw_shrinkage_method, "fallback_fixed");
  assert.ok(Number.isFinite(singleCanonRes.simulated.ending_p50_base));
  assert.ok(Number.isFinite(singleCanonRes.simulated.expected_sharpe));
});
