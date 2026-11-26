import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAfterTaxHurdle,
  computeCapitalRotationQueue,
  computeDipTriage,
  computeForwardScorecard,
  computeReverseDcf,
  computeScenarioSummary,
  computeValuationBands,
  evaluateHypothesisRule,
  runDeterministicBacktest,
} from "../src/server/quant.js";
import {
  BacktestRequestSchema,
  DossierModelSchema,
  FundamentalsSchema,
  InsidersSchema,
  PortfolioSchema,
  ProfileSchema,
  ThesisTestRecordSchema,
  type HistoryCacheState,
  type HistoryPoint,
  type HypothesisRecord,
  type ThesisTestRecord,
} from "../src/server/schema.js";

function makeWeeklyPoints(startDate: string, weeks: number, weeklyGrowth: number, startPrice = 100, dayOffset = 0): HistoryPoint[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`) + dayOffset * 86400 * 1000;
  const out: HistoryPoint[] = [];
  let px = startPrice;
  for (let i = 0; i <= weeks; i += 1) {
    const dt = new Date(startMs + i * 7 * 86400 * 1000).toISOString().slice(0, 10);
    const shock = dt >= "2022-02-01" && dt <= "2022-08-31" ? -0.012 : weeklyGrowth;
    if (i > 0) {
      px = Math.max(1, px * (1 + shock + (i % 2 === 0 ? 0.004 : -0.003)));
    }
    out.push({ date: dt, close: Math.round(px * 10000) / 10000 });
  }
  return out;
}

test("computeAfterTaxHurdle supports hedge vs amortized estate-tax drag, fixes marginalRate=0 bug, WHT overrides, and accumulating ETFs", () => {
  const hedgeProfile = ProfileSchema.parse({
    tax_profile: {
      country_code: "SG",
      nra_us_estate_tax_enabled: true,
      us_dividend_wht_pct: 30,
      ucits_dividend_wht_pct: 15,
      cgt_pct: 0,
    },
    benchmark: {
      ticker: "VWRA",
      yf_symbol: "VWRA.L",
      label: "VWRA.L Core Global",
      expected_cagr_pct: 8.0,
      alpha_buffer_pct: 2.5,
      estate_tax_drag_mode: "hedge",
      estate_tax_hedge_bps: 35,
      estate_tax_amortize_years: 20,
      estate_tax_annual_drag_pct: null,
      core_active_cap: 12,
    },
  });

  // 1. Default hedge mode: 35 bps/yr = 0.35% + 0.30% div WHT = 0.65% total drag
  const hedgeUs = computeAfterTaxHurdle(hedgeProfile, true, 1.0, 34);
  assert.equal(hedgeUs.estate_tax_drag_mode, "hedge");
  assert.equal(hedgeUs.estate_tax_drag_pct, 0.35);
  assert.equal(hedgeUs.div_wht_drag_pct, 0.3);
  assert.equal(hedgeUs.total_tax_drag_pct, 0.65);
  assert.equal(hedgeUs.required_gross_cagr_pct, 11.15);

  // 2. Amortized mode: (1 - (1 - 0.34)^(1/20))*100 = 2.06%
  const amortProfile = ProfileSchema.parse({
    ...hedgeProfile,
    benchmark: { ...hedgeProfile.benchmark, estate_tax_drag_mode: "amortized" },
  });
  const amortUs = computeAfterTaxHurdle(amortProfile, true, 1.0, 34);
  assert.equal(amortUs.estate_tax_drag_mode, "amortized");
  assert.equal(amortUs.estate_tax_drag_pct, 2.06);
  assert.equal(amortUs.total_tax_drag_pct, 2.36);
  assert.equal(amortUs.required_gross_cagr_pct, 12.86);

  // 3. Bug fix: marginalEstateRatePct === 0 (portfolios <= $60k) MUST yield 0% estate drag (NOT 34%!)
  const zeroEstateAmort = computeAfterTaxHurdle(amortProfile, true, 1.0, 0);
  assert.equal(zeroEstateAmort.estate_tax_drag_pct, 0);
  const zeroEstateHedge = computeAfterTaxHurdle(hedgeProfile, true, 1.0, 0);
  assert.equal(zeroEstateHedge.estate_tax_drag_pct, 0);

  // 4. Per-dossier WHT override (e.g., Taiwan ADR 21%, Germany 26.375%)
  const twOverride = computeAfterTaxHurdle(hedgeProfile, false, 2.0, 34, { dividendWhtPctOverride: 21 });
  assert.equal(twOverride.effective_wht_pct, 21);
  assert.equal(twOverride.div_wht_drag_pct, 0.42);
  assert.equal(twOverride.estate_tax_drag_pct, 0);

  // 5. Accumulating UCITS ETF receives 0 extra WHT drag (internal 15% already in NAV)
  const accUcits = computeAfterTaxHurdle(hedgeProfile, false, 1.8, 34, { accumulating: true });
  assert.equal(accUcits.accumulating, true);
  assert.equal(accUcits.div_wht_drag_pct, 0);
  assert.equal(accUcits.total_tax_drag_pct, 0);

  // 6. Explicit annual estate tax drag override
  const overrideProfile = ProfileSchema.parse({
    ...hedgeProfile,
    benchmark: { ...hedgeProfile.benchmark, estate_tax_annual_drag_pct: 1.75 },
  });
  assert.equal(computeAfterTaxHurdle(overrideProfile, true, 0, 34).estate_tax_drag_pct, 1.75);
});

test("computeScenarioSummary adds dividend yield to gross CAGR, separates expected-wealth vs Kelly CAGR, and flags GIGO warnings", () => {
  const profile = ProfileSchema.parse({
    tax_profile: {
      country_code: "SG",
      nra_us_estate_tax_enabled: false,
      us_dividend_wht_pct: 30,
      ucits_dividend_wht_pct: 15,
    },
    benchmark: { expected_cagr_pct: 8.0, alpha_buffer_pct: 2.5 },
  });

  // Distributing stock with 2% dividend yield & 30% WHT -> net +1.4% dividend uplift on top of price CAGR!
  const taxInfo = computeAfterTaxHurdle(profile, true, 2.0, 0);
  assert.equal(taxInfo.div_wht_drag_pct, 0.6);

  const model = DossierModelSchema.parse({
    horizon_years: 5,
    dividend_yield_pct: 2.0,
    accumulating: false,
    scenarios: {
      bear: { probability: 0.25, target_price_5y: 75, summary: "Downside stress (-25%)." },
      base: { probability: 0.5, target_price_5y: 200, summary: "Double over 5y." },
      bull: { probability: 0.25, target_price_5y: 280, summary: "Strong compounding." },
    },
  });

  const scen = computeScenarioSummary(100, model, taxInfo);
  assert.ok(scen);
  // Base price CAGR = (2^(1/5)-1)*100 = 14.87% -> +2.0% div = 16.87% gross -> -0.6% WHT = 16.27% after-tax
  assert.equal(scen.cases.base.gross_cagr_pct, 16.87);
  assert.equal(scen.cases.base.after_tax_cagr_pct, 16.27);
  // Expected-wealth after-tax CAGR must exceed standalone Kelly (log-utility) due to dispersion
  assert.ok(scen.expected_after_tax_cagr_pct > scen.standalone_kelly_cagr_pct);
  assert.ok(scen.dispersion_drag_bps > 0);
  assert.equal(scen.valuation_warnings.length, 0);

  // Accumulating ETF should NOT add dividend_yield_pct or deduct WHT
  const accTax = computeAfterTaxHurdle(profile, false, 1.8, 0, { accumulating: true });
  const accModel = DossierModelSchema.parse({
    horizon_years: 5,
    dividend_yield_pct: 1.8,
    accumulating: true,
    scenarios: {
      bear: { probability: 0.2, target_price_5y: 110, summary: "Slow" },
      base: { probability: 0.6, target_price_5y: 147, summary: "Steady 8%" },
      bull: { probability: 0.2, target_price_5y: 180, summary: "Strong" },
    },
  });
  const accScen = computeScenarioSummary(100, accModel, accTax, { isEtf: true });
  assert.ok(accScen);
  assert.equal(accScen.cases.base.gross_cagr_pct, accScen.cases.base.after_tax_cagr_pct);
  assert.equal(accScen.valuation_warnings.length, 0);

  // GIGO warnings: cushioned bear (> -10%), >65% implied margin, >15% rev CAGR above $25B, >$5T terminal MCap
  const gigoModel = DossierModelSchema.parse({
    horizon_years: 5,
    reverse_dcf: {
      basis: "fcf",
      current_metric_per_share: 10.0,
      current_revenue_b: 50.0,
      shares_diluted_m: 4000, // 10 * 4000 / 1000 = $40B / $50B = 80% implied margin (>65%!)
      target_margin_pct: 40,
      exit_multiple: 25,
      base_revenue_cagr_pct: 20, // >15% above $25B
    },
    scenarios: {
      bear: { probability: 0.2, target_price_5y: 105, summary: "Cushioned bear (+5%)" },
      base: { probability: 0.5, target_price_5y: 1400, summary: "Huge base ($5.6T MCap)" },
      bull: { probability: 0.3, target_price_5y: 1800, summary: "Huge bull" },
    },
  });
  const gigoScen = computeScenarioSummary(100, gigoModel, taxInfo, {
    fundamentals: FundamentalsSchema.parse({
      ticker: "GIGO",
      updated_at: "2026-11-26T00:00:00Z",
      latest_ratios: { fcf_margin_pct: 32.0, owner_earnings_margin_pct: 21.0 },
    }),
  });
  assert.ok(gigoScen);
  assert.ok(gigoScen.valuation_warnings.some((w) => w.includes("Bear case")));
  assert.ok(gigoScen.valuation_warnings.some((w) => w.includes(">65%")));
  assert.ok(gigoScen.valuation_warnings.some((w) => w.includes("15%")));
  assert.ok(gigoScen.valuation_warnings.some((w) => w.includes("$5T")));
  assert.ok(gigoScen.valuation_warnings.some((w) => w.includes("Owner Earnings")));
});

test("computeReverseDcf computes EV/dilution 3-part attribution bridge and computeValuationBands outputs 5Y P/E, P/FCF, P/S", () => {
  const profile = ProfileSchema.parse({
    tax_profile: { country_code: "US", nra_us_estate_tax_enabled: false, us_dividend_wht_pct: 0 },
    benchmark: { expected_cagr_pct: 8.0, alpha_buffer_pct: 4.0 }, // 12% hurdle
  });
  const taxInfo = computeAfterTaxHurdle(profile, true, 0, 0);

  const model = DossierModelSchema.parse({
    horizon_years: 5,
    dividend_yield_pct: 0,
    reverse_dcf: {
      basis: "fcf",
      current_metric_per_share: 4.0,
      current_revenue_b: 20.0,
      shares_diluted_m: 1000,
      target_margin_pct: 25,
      exit_multiple: 25,
      base_revenue_cagr_pct: 10.0,
      net_cash_b: 10.0, // $10/sh net cash -> EV/sh0 = 90 -> current_multiple = 22.5x
      annual_dilution_pct: 2.0, // 2% annual share dilution
      linked_hypothesis_ids: ["margin-expansion"],
    },
  });

  const rdcf = computeReverseDcf(100, model, taxInfo, { consensusRevGrowthPct: 9.0 });
  assert.ok(rdcf);
  assert.equal(rdcf.current_multiple, 22.5);
  assert.equal(rdcf.net_cash_b, 10);
  assert.equal(rdcf.annual_dilution_pct, 2);
  assert.equal(rdcf.implied_current_margin_pct, 20);
  assert.equal(rdcf.consensus_rev_growth_pct, 9.0);
  assert.ok(typeof rdcf.expectations_gap_vs_consensus_pct === "number");
  assert.ok(rdcf.multiple_expansion_cagr_pct > 2.0); // 22.5x -> 25x
  assert.ok(rdcf.margin_expansion_cagr_pct !== null && rdcf.margin_expansion_cagr_pct > 4.0); // 20% -> 25%
  assert.ok(rdcf.constant_mult_margin_rev_cagr_pct > 12.0); // includes dilution + EV leverage
  assert.equal(rdcf.residual_revenue_cagr_pct, rdcf.implied_revenue_cagr_pct);
  assert.ok(rdcf.residual_revenue_cagr_pct !== null && rdcf.residual_revenue_cagr_pct < rdcf.constant_mult_margin_rev_cagr_pct);

  // Valuation bands over 5Y weekly history + XBRL fundamentals
  const fundamentals = FundamentalsSchema.parse({
    ticker: "ACME",
    updated_at: "2026-11-23T00:00:00Z",
    quarterly: [
      { period_end: "2026-09-30", filed_date: "2026-10-30", fiscal_period: "Q3", revenue_m: 5000, net_income_m: 1000, fcf_m: 1000, diluted_shares_m: 1000, eps_diluted: 1.0 },
      { period_end: "2026-06-30", filed_date: "2026-07-30", fiscal_period: "Q2", revenue_m: 5000, net_income_m: 1000, fcf_m: 1000, diluted_shares_m: 1000, eps_diluted: 1.0 },
      { period_end: "2026-03-31", filed_date: "2026-04-30", fiscal_period: "Q1", revenue_m: 5000, net_income_m: 1000, fcf_m: 1000, diluted_shares_m: 1000, eps_diluted: 1.0 },
      { period_end: "2025-12-31", filed_date: "2026-02-15", fiscal_period: "Q4", revenue_m: 5000, net_income_m: 1000, fcf_m: 1000, diluted_shares_m: 1000, eps_diluted: 1.0 },
    ],
    annual: [
      { period_end: "2024-12-31", filed_date: "2025-02-15", fiscal_period: "FY", revenue_m: 18000, net_income_m: 3500, fcf_m: 3500, diluted_shares_m: 1000, eps_diluted: 3.5 },
      { period_end: "2023-12-31", filed_date: "2024-02-15", fiscal_period: "FY", revenue_m: 16000, net_income_m: 3000, fcf_m: 3000, diluted_shares_m: 1000, eps_diluted: 3.0 },
      { period_end: "2022-12-31", filed_date: "2023-02-15", fiscal_period: "FY", revenue_m: 14000, net_income_m: 2600, fcf_m: 2600, diluted_shares_m: 1000, eps_diluted: 2.6 },
    ],
    latest_ratios: { ttm_eps: 4.0, ttm_fcf_per_share: 4.0, ttm_rev_per_share: 20.0 },
  });
  const histSeries = {
    symbol: "ACME",
    currency: "USD",
    source: "yahoo" as const,
    updated_at: "2026-11-23T00:00:00Z",
    points: makeWeeklyPoints("2023-03-06", 180, 0.0025, 65),
  };
  const bands = computeValuationBands(histSeries, fundamentals, 100);
  assert.ok(bands);
  assert.equal(bands.pe.current, 25);
  assert.equal(bands.pfcf.current, 25);
  assert.equal(bands.ps.current, 5);
  assert.ok(bands.pe.p10 !== null && bands.pe.median !== null && bands.pe.p90 !== null);
  assert.ok(bands.pe.p10! <= bands.pe.median! && bands.pe.median! <= bands.pe.p90!);
});

test("computeDipTriage enforces ETF direct weight, CORE_ANCHOR benchmark, GATED > CAP_BLOCKED, verdict blocks, dual headroom & high-vol staging", () => {
  const profile = ProfileSchema.parse({
    benchmark: { ticker: "VWRA", yf_symbol: "VWRA.L", expected_cagr_pct: 8.0, alpha_buffer_pct: 2.5 },
    risk_caps: [
      { id: "single-max", label: "Single Name Max", kind: "single_name_max", cap_pct: 15 },
      { id: "tech", label: "Tech Cluster", kind: "bucket", cap_pct: 40, tickers: ["ACME", "MSFT"] },
    ],
  });
  const breachedCaps = [
    { id: "single-max", label: "Single Name Max", value_pct: 12, cap_pct: 15, status: "PASS" as const },
    { id: "tech", label: "Tech Cluster", value_pct: 45, cap_pct: 40, status: "BREACH" as const },
  ];
  const ltMap = new Map([["ACME", { name: "ACME", total_usd: 5000, total_base: 5000, pct_nav: 5.0 }]]);
  const posWeightMap = new Map<string, number>([["VWRA", 31.75]]);

  const taxInfo = computeAfterTaxHurdle(profile, false, 0, 0);
  const passingModel = DossierModelSchema.parse({
    scenarios: {
      bear: { probability: 0.2, target_price_5y: 90, summary: "Bear" },
      base: { probability: 0.5, target_price_5y: 220, summary: "Base" },
      bull: { probability: 0.3, target_price_5y: 280, summary: "Bull" },
    },
  });
  const scen = computeScenarioSummary(108, passingModel, taxInfo);

  // 1. GATED must beat CAP_BLOCKED even when tech bucket is breached!
  const gatedOverCap = computeDipTriage(
    {
      ticker: "ACME",
      tier: "active",
      us_situs: false,
      gated: false,
      max_weight_pct: 12,
      buy_zone_low: 100,
      buy_zone_high: 112,
    },
    108,
    scen,
    breachedCaps,
    profile,
    [{ ticker: "ACME", form: "10-Q", filed_after: "2026-11-01", description: "Filing gate", cleared: false }],
    [],
    100000,
    1.0,
    ltMap,
  );
  assert.equal(gatedOverCap.readiness, "GATED");
  assert.equal(gatedOverCap.risk_cap_check.single_name_room_pct, 7); // 12 - 5
  assert.equal(gatedOverCap.risk_cap_check.portfolio_cap_room_pct, -5); // 40 - 45

  // 2. Benchmark ETF (VWRA) reads direct NAV weight (31.75%) and receives CORE_ANCHOR status
  const vwraTriage = computeDipTriage(
    {
      ticker: "VWRA",
      tier: "active",
      us_situs: false,
      gated: false,
      max_weight_pct: 70,
      buy_zone_low: 160,
      buy_zone_high: 180,
      is_etf: true,
    },
    176.5,
    null,
    breachedCaps,
    profile,
    [],
    [],
    100000,
    1.0,
    ltMap,
    { positionWeightMap: posWeightMap, availableFundingBase: 10000, vix: 30.5 },
  );
  assert.equal(vwraTriage.risk_cap_check.current_weight_pct, 31.75);
  assert.equal(vwraTriage.hurdle_check.status, "CORE_ANCHOR");
  assert.equal(vwraTriage.readiness, "READY");
  assert.equal(vwraTriage.high_vol_staged, true);
  // Tranches must be capped by availableFundingBase (10,000) rather than full roomBase (38,250)
  const trancheSum = vwraTriage.tranche_plan.reduce((s, t) => s + t.amount_base, 0);
  assert.equal(trancheSum, 10000);
  assert.ok(vwraTriage.tranche_plan[0]?.note?.includes("High-Vol Staged"));

  // 3. UNMODELED, PROBATION, EXIT, or kill_switch_triggered must NEVER be READY
  const clearCaps = [
    { id: "single-max", label: "Single Name Max", value_pct: 10, cap_pct: 15, status: "PASS" as const },
    { id: "tech", label: "Tech Cluster", value_pct: 20, cap_pct: 40, status: "PASS" as const },
  ];
  const unmodeled = computeDipTriage(
    { ticker: "ACME", tier: "bench", us_situs: false, gated: false, max_weight_pct: 12, buy_zone_low: 100, buy_zone_high: 112 },
    108,
    null,
    clearCaps,
    profile,
    [],
    [],
    100000,
    1.0,
    ltMap,
  );
  assert.equal(unmodeled.readiness, "WAIT");

  const probation = computeDipTriage(
    {
      ticker: "ACME",
      tier: "active",
      us_situs: false,
      gated: false,
      max_weight_pct: 12,
      buy_zone_low: 100,
      buy_zone_high: 112,
      verdict: "PROBATION",
    },
    108,
    scen,
    clearCaps,
    profile,
    [],
    [],
    100000,
    1.0,
    ltMap,
  );
  assert.equal(probation.readiness, "WAIT");
});

test("computeCapitalRotationQueue generates Tier 1 US-ETF tax swaps, Tier 2 held EXITs (even tier=passed), and Tier 3 net cap trims", () => {
  const profile = ProfileSchema.parse({
    base_currency: "USD",
    tax_profile: { country_code: "SG", nra_us_estate_tax_enabled: true, us_dividend_wht_pct: 30, ucits_dividend_wht_pct: 15 },
    benchmark: { ticker: "VWRA", yf_symbol: "VWRA.L" },
    risk_caps: [
      { id: "us-situs", label: "US-Situs Cap", kind: "us_situs", cap_pct: 60 },
      { id: "crypto-cap", label: "Speculative Cap", kind: "ticker", ticker: "SPEC", cap_pct: 5 },
    ],
  });
  const portfolio = PortfolioSchema.parse({
    as_of: "2026-11-25T00:00:00Z",
    cash_base: 5000,
    fx_rates: { USD: 1.0 },
    positions: [
      { ticker: "QQQ", yf_symbol: "QQQ", asset_type: "US ETF", domicile: "US", us_situs: true, currency: "USD", qty: 100, avg_cost: 400, ref_price: 500 }, // $50,000
      { ticker: "VWRA", yf_symbol: "VWRA.L", asset_type: "UCITS ETF", domicile: "Ireland", us_situs: false, currency: "USD", qty: 100, avg_cost: 150, ref_price: 180 }, // $18,000
      { ticker: "HYPE", yf_symbol: "HYPE", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 200, avg_cost: 60, ref_price: 50 }, // $10,000 (held EXIT!)
      { ticker: "SPEC", yf_symbol: "SPEC", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 170, avg_cost: 80, ref_price: 100 }, // $17,000 (17% vs 5% cap!)
    ],
  });
  // Total NAV = $50k + $18k + $10k + $17k + $5k = $100,000; US-situs = $77k (77% > 60%)
  const riskCaps = [
    { id: "us-situs", label: "US-Situs Cap", value_pct: 77, cap_pct: 60, status: "BREACH" as const },
    { id: "crypto-cap", label: "Speculative Cap", value_pct: 17, cap_pct: 5, status: "BREACH" as const },
  ];
  const lookthrough = [
    { name: "SPEC", total_usd: 17000, total_base: 17000, pct_nav: 17 },
    { name: "HYPE", total_usd: 10000, total_base: 10000, pct_nav: 10 },
  ];
  const theses = [
    { ticker: "HYPE", tier: "passed" as const, verdict: "EXIT", max_weight_pct: 0, kill_switch_triggered: true },
  ];

  const queue = computeCapitalRotationQueue(portfolio, lookthrough, riskCaps, theses, profile, 1.0);
  // Tier 1: QQQ -> VWRA.L swap auto-cures US-Situs cap (77% - 50% = 27% <= 60%) and saves estate tax!
  assert.equal(queue.tax_swaps.length, 1);
  assert.equal(queue.tax_swaps[0]?.ticker, "QQQ");
  assert.equal(queue.tax_swaps[0]?.shares, 100);
  assert.equal(queue.tax_swaps[0]?.proceeds_base, 50000);
  assert.ok(queue.tax_swaps[0]!.estate_tax_saved_base > 0);
  assert.ok(queue.tax_swaps[0]!.auto_cured_caps.includes("US-Situs Cap"));

  // Tier 2: HYPE surfaces even though tier === "passed"!
  assert.equal(queue.mandatory_exits.length, 1);
  assert.equal(queue.mandatory_exits[0]?.ticker, "HYPE");
  assert.equal(queue.mandatory_exits[0]?.proceeds_base, 10000);

  // Tier 3: US-Situs cap already cured by QQQ swap -> ONLY SPEC cap trim remains (12% excess = $12,000 = 120 shares)
  assert.equal(queue.cap_trims.length, 1);
  assert.equal(queue.cap_trims[0]?.ticker, "SPEC");
  assert.equal(queue.cap_trims[0]?.shares_to_trim, 120);
  assert.equal(queue.total_freed_base, 22000); // $10k exit + $12k trim

  // Regression: Overlapping bucket + ticker caps must order specific-before-broad and propagate % NAV relief (zero double-selling!)
  const overlapProfile = ProfileSchema.parse({
    base_currency: "USD",
    tax_profile: { country_code: "US", nra_us_estate_tax_enabled: false },
    risk_caps: [
      // Broad bucket listed FIRST in config to verify sorting puts ticker caps ahead of bucket!
      { id: "ai-tech", label: "AI Tech Bucket", kind: "bucket", cap_pct: 50, tickers: ["MSFT", "META", "AAPL"] },
      { id: "msft-cap", label: "MSFT Cap", kind: "ticker", ticker: "MSFT", cap_pct: 20 },
      { id: "meta-cap", label: "META Cap", kind: "ticker", ticker: "META", cap_pct: 15 },
    ],
  });
  const overlapPortfolio = PortfolioSchema.parse({
    as_of: "2026-11-25T00:00:00Z",
    cash_base: 47570,
    fx_rates: { USD: 1.0 },
    positions: [
      { ticker: "MSFT", yf_symbol: "MSFT", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 100, avg_cost: 200, ref_price: 217.6 }, // $21,760 (21.76% -> +1.76% excess)
      { ticker: "META", yf_symbol: "META", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 100, avg_cost: 150, ref_price: 175.0 }, // $17,500 (17.50% -> +2.50% excess)
      { ticker: "AAPL", yf_symbol: "AAPL", asset_type: "US Equity", domicile: "US", us_situs: true, currency: "USD", qty: 100, avg_cost: 100, ref_price: 131.7 }, // $13,170 (13.17%)
    ],
  });
  // Total NAV = $100,000; AI Tech Bucket = 52.43% (+2.43% excess). Curing MSFT (+1.76%) + META (+2.50%) = 4.26% >= 2.43% -> auto-cures AI Tech Bucket!
  const overlapCaps = [
    { id: "ai-tech", label: "AI Tech Bucket", value_pct: 52.43, cap_pct: 50, status: "BREACH" as const },
    { id: "msft-cap", label: "MSFT Cap", value_pct: 21.76, cap_pct: 20, status: "BREACH" as const },
    { id: "meta-cap", label: "META Cap", value_pct: 17.5, cap_pct: 15, status: "BREACH" as const },
  ];
  const overlapLt = [
    { name: "MSFT", total_usd: 21760, total_base: 21760, pct_nav: 21.76 },
    { name: "META", total_usd: 17500, total_base: 17500, pct_nav: 17.5 },
    { name: "AAPL", total_usd: 13170, total_base: 13170, pct_nav: 13.17 },
  ];
  const overlapQueue = computeCapitalRotationQueue(overlapPortfolio, overlapLt, overlapCaps, [], overlapProfile, 1.0);
  // Only msft-cap & meta-cap should appear; ai-tech is auto-cured by their 4.26% relief -> zero duplicate MSFT trim!
  assert.equal(overlapQueue.cap_trims.length, 2);
  assert.deepEqual(
    overlapQueue.cap_trims.map((t) => `${t.cap_id}:${t.ticker}`),
    ["msft-cap:MSFT", "meta-cap:META"],
  );
  // Total freed must equal MSFT trim (9 sh * 217.6 = 1958.4) + META trim (15 sh * 175 = 2625) = 4583.4 (no double-count)
  assert.equal(overlapQueue.cap_trims[0]?.shares_to_trim, 9);
  assert.equal(overlapQueue.cap_trims[1]?.shares_to_trim, 15);
  assert.equal(overlapQueue.total_freed_base, 4583.4);
});

test("computeForwardScorecard separates <30d PENDING, deduplicates 30d calls, fixes verdict hit signs, and computes Brier calibration", () => {
  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-25T00:00:00Z",
    series: {
      "daily:VWRA.L": {
        symbol: "VWRA.L",
        currency: "USD",
        source: "yahoo",
        updated_at: "2026-11-25T00:00:00Z",
        points: [
          { date: "2026-07-01", close: 150 },
          { date: "2026-09-02", close: 160 },
          { date: "2026-11-24", close: 176 },
        ],
      },
    },
  };

  const logs: ThesisTestRecord[] = [
    // Matured (>140d): HIGH_CONVICTION hit (+25% vs bench +17.33%)
    ThesisTestRecordSchema.parse({
      ticker: "MSFT",
      tested_at: "2026-07-02T12:00:00Z",
      event_type: "thesis_test",
      verdict: "HIGH_CONVICTION",
      summary: "Cloud growth confirmed.",
      price_at_test: 400,
      benchmark_price_at_test: 150,
      currency: "USD",
    }),
    // Duplicate same ticker+verdict 5 days later -> must be deduplicated!
    ThesisTestRecordSchema.parse({
      ticker: "MSFT",
      tested_at: "2026-07-07T12:00:00Z",
      event_type: "thesis_test",
      verdict: "HIGH_CONVICTION",
      summary: "Duplicate call within 30d.",
      price_at_test: 402,
      benchmark_price_at_test: 151,
      currency: "USD",
    }),
    // Matured (84d): PROBATION hit (stock -10% vs bench +10% -> alpha -20% <= 0)
    ThesisTestRecordSchema.parse({
      ticker: "HYPE",
      tested_at: "2026-09-02T12:00:00Z",
      event_type: "thesis_test",
      verdict: "PROBATION",
      summary: "Dilution worsened.",
      price_at_test: 100,
      currency: "USD",
    }),
    // Immature Day-0 (<30d): MUST be PENDING with hit === null and NOT benchRet = 0 hardcoded!
    ThesisTestRecordSchema.parse({
      ticker: "AAPL",
      tested_at: "2026-11-25T00:00:00Z",
      event_type: "thesis_test",
      verdict: "HIGH_CONVICTION",
      summary: "Fresh Day-0 test.",
      price_at_test: 230,
      currency: "USD",
    }),
    // Rule change event -> ignored by scorecard
    ThesisTestRecordSchema.parse({
      ticker: "AAPL",
      tested_at: "2026-11-20T00:00:00Z",
      event_type: "rule_change",
      verdict: "WATCH",
      summary: "[RULE CHANGE] buy_zone updated",
      price_at_test: 225,
      currency: "USD",
    }),
  ];

  const prices = new Map<string, number>([
    ["MSFT", 500],
    ["HYPE", 90],
    ["AAPL", 230],
    ["VWRA.L", 176],
  ]);

  const hyps: HypothesisRecord[] = [
    { id: "h1", claim: "c1", status: "supported", confidence: "high", is_core: true },
    { id: "h2", claim: "c2", status: "falsified", confidence: "medium", is_core: false },
  ];

  const card = computeForwardScorecard(logs, prices, historyCache, "VWRA.L", new Date("2026-11-25T00:00:00Z"), hyps);
  assert.equal(card.priced_tests, 3); // deduped MSFT + HYPE + pending AAPL (rule_change excluded)
  assert.equal(card.pending_count, 1);
  assert.equal(card.matured_count, 2);

  const aaplRow = card.entries.find((e) => e.ticker === "AAPL");
  assert.equal(aaplRow?.maturity, "PENDING");
  assert.equal(aaplRow?.hit, null);
  assert.equal(aaplRow?.benchmark_return_pct, null); // no hardcoded 0!

  const probSummary = card.by_verdict.find((v) => v.verdict === "PROBATION");
  assert.equal(probSummary?.hit_rate_pct, 100); // alpha <= 0 is a HIT for PROBATION

  const b90 = card.horizon_buckets.find((b) => b.horizon === "90d");
  assert.equal(b90?.count, 1); // MSFT > 90d

  // Brier: high supported (0.8-1)^2 = 0.04, medium falsified (0.6-0)^2 = 0.36 -> avg = 0.20
  assert.equal(card.brier_calibration.resolved_total, 2);
  assert.equal(card.brier_calibration.overall_brier_score, 0.2);
});

test("evaluateHypothesisRule evaluates XBRL, EDGAR, and Form 4 insider rules deterministically", () => {
  const fund = FundamentalsSchema.parse({
    ticker: "ACME",
    updated_at: "2026-11-25T00:00:00Z",
    quarterly: [
      { period_end: "2026-09-30", fiscal_period: "Q3", gross_margin_pct: 64.5, dso_days: 72.0, ocf_to_ni_pct: 66.9, owner_earnings_margin_pct: 19.5 },
    ],
    latest_ratios: { gross_margin_pct: 64.5, dso_days: 72.0, ocf_to_ni_pct: 66.9, owner_earnings_margin_pct: 19.5 },
  });
  const xbrlBreach = evaluateHypothesisRule(
    { source: "xbrl", metric: "dso_days", op: "<=", threshold: 65, period: "latest_q" },
    fund,
  );
  assert.equal(xbrlBreach.observed, 72);
  assert.equal(xbrlBreach.passed, false);

  const oePass = evaluateHypothesisRule(
    { source: "xbrl", metric: "owner_earnings_margin_pct", op: ">=", threshold: 18, period: "latest_q" },
    fund,
  );
  assert.equal(oePass.observed, 19.5);
  assert.equal(oePass.passed, true);

  const edgarPass = evaluateHypothesisRule(
    { source: "edgar", metric: "filing_10q_on_time", op: "==", threshold: 1, period: "latest_q" },
    null,
    [{ form: "10-Q", filingDate: "2026-11-01", accession: "001", url: "https://www.sec.gov/1" }],
  );
  assert.equal(edgarPass.passed, true);

  const edgarFail = evaluateHypothesisRule(
    { source: "edgar", metric: "filing_10q_on_time", op: "==", threshold: 1, period: "latest_q" },
    null,
    [{ form: "NT 10-Q", filingDate: "2026-11-15", accession: "002", url: "https://www.sec.gov/2" }],
  );
  assert.equal(edgarFail.passed, false);

  const insiders = InsidersSchema.parse({
    ticker: "ACME",
    updated_at: "2026-11-25T00:00:00Z",
    window_90d: { disc_buy_usd: 500000, disc_sell_usd: 0, plan_sell_usd: 0, distinct_buyers: 2, distinct_sellers: 0 },
  });
  const insPass = evaluateHypothesisRule(
    { source: "insiders", metric: "disc_buy_90d_usd", op: ">=", threshold: 250000, period: "latest_q" },
    null,
    null,
    insiders,
  );
  assert.equal(insPass.passed, true);
});

test("runDeterministicBacktest prevents nano-position rebalance storms, FX-converts EUR series, credits rf_pct, computes Sharpe SE, and includes external wealth", () => {
  const profile = ProfileSchema.parse({
    base_currency: "USD",
    benchmark: { ticker: "VWRA", yf_symbol: "VWRA.L", label: "VWRA.L Core Global" },
    external_exposure: {
      enabled: true,
      label: "External Employer Equity",
      ticker: "MSFT",
      amount_base: 40000,
      us_situs: true,
      sector_tags: ["tech-bucket"],
    },
    risk_caps: [
      { id: "tech-bucket", label: "Tech", kind: "bucket", cap_pct: 50, tickers: ["MSFT", "AAPL"] },
    ],
  });
  const portfolio = PortfolioSchema.parse({
    as_of: "2026-11-23T00:00:00Z",
    cash_base: 20000,
    accruals_base: 0,
    fx_rates: { USD: 1.0, EUR: 1.1 },
    positions: [
      { ticker: "VWRA", yf_symbol: "VWRA.L", qty: 300, avg_cost: 150, ref_price: 200, currency: "USD" }, // $60,000
      { ticker: "AAPL", yf_symbol: "AAPL", qty: 100, avg_cost: 150, ref_price: 200, currency: "USD" }, // $20,000
      // Nano position (0.2% of portfolio) with huge volatility -> must NOT trigger global rebalance storms!
      { ticker: "NANO", yf_symbol: "NANO", qty: 20, avg_cost: 10, ref_price: 10, currency: "USD" }, // $200
    ],
  });

  // Build EUR.DE rising steadily in EUR while EURUSD=X declines -> USD return must reflect FX conversion!
  const weeks = 220;
  const monBase = makeWeeklyPoints("2022-01-03", weeks, 0.0022, 100, 0);
  const eurPts: HistoryPoint[] = monBase.map((pt, i) => ({
    date: pt.date,
    close: Math.round(100 * Math.pow(1.003, i) * 10000) / 10000,
  }));
  const eurusdPts: HistoryPoint[] = monBase.map((pt, i) => ({
    date: pt.date,
    close: Math.round(1.2 * Math.pow(0.9985, i) * 10000) / 10000, // EUR weakens steadily vs USD
  }));
  // Wildly volatile NANO position (alternating +/-40% swings) that stays < 0.5% weight
  const nanoPts: HistoryPoint[] = monBase.map((pt, i) => ({
    date: pt.date,
    close: i % 2 === 0 ? 10 : 15,
  }));

  const historyCache: HistoryCacheState = {
    updated_at: "2026-11-23T00:00:00Z",
    series: {
      "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: monBase },
      AAPL: { symbol: "AAPL", currency: "USD", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: makeWeeklyPoints("2022-01-03", weeks, 0.0028, 150, 0) },
      MSFT: { symbol: "MSFT", currency: "USD", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: makeWeeklyPoints("2022-01-03", weeks, 0.0032, 250, 0) },
      NANO: { symbol: "NANO", currency: "USD", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: nanoPts },
      "EUR.DE": { symbol: "EUR.DE", currency: "EUR", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: eurPts },
      "EURUSD=X": { symbol: "EURUSD=X", currency: "USD", source: "yahoo", updated_at: "2026-11-23T00:00:00Z", points: eurusdPts },
    },
  };

  const resWithExt = runDeterministicBacktest(
    BacktestRequestSchema.parse({
      candidate_ticker: "EUR.DE",
      candidate_yf_symbol: "EUR.DE",
      target_weight_pct: 10,
      funding_source: "cash",
      rebalance_band_pct: 25,
      include_external_wealth: true,
      rf_pct: 4.5,
    }),
    portfolio,
    [],
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.1 },
  );

  // 1. Hybrid rebalance band >= 2% absolute NAV stops NANO from causing 100+ rebalance storms!
  assert.ok(resWithExt.baseline.rebalance_count < 15, `Expected low rebalance count, got ${resWithExt.baseline.rebalance_count}`);
  // 2. FX conversion applied to EUR.DE
  assert.ok(resWithExt.fx_converted_tickers.includes("EUR.DE"));
  // 3. Risk-free rate, Sharpe SE, Deflated Sharpe, weekly CVaR & tx-cost slippage exposed
  assert.equal(resWithExt.rf_pct, 4.5);
  assert.equal(resWithExt.tx_cost_bps, 10);
  assert.ok(resWithExt.baseline.sharpe_se > 0);
  assert.ok(resWithExt.simulated.deflated_sharpe_prob_pct >= 0 && resWithExt.simulated.deflated_sharpe_prob_pct <= 100);
  assert.ok(resWithExt.simulated.cvar_95_weekly_pct <= 0);
  assert.ok(resWithExt.simulated.total_turnover_pct >= 9.5); // at least 10% entry buy turnover
  assert.ok(resWithExt.simulated.tx_cost_drag_bps > 0);

  // Higher slippage (50 bps) strictly reduces simulated CAGR vs 0 bps
  const resZeroCost = runDeterministicBacktest(
    BacktestRequestSchema.parse({
      candidate_ticker: "EUR.DE",
      candidate_yf_symbol: "EUR.DE",
      target_weight_pct: 10,
      funding_source: "cash",
      rebalance_band_pct: 25,
      include_external_wealth: true,
      rf_pct: 4.5,
      tx_cost_bps: 0,
      trials_tested: 1,
    }),
    portfolio,
    [],
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.1 },
  );
  const resHighCost = runDeterministicBacktest(
    BacktestRequestSchema.parse({
      candidate_ticker: "EUR.DE",
      candidate_yf_symbol: "EUR.DE",
      target_weight_pct: 10,
      funding_source: "cash",
      rebalance_band_pct: 25,
      include_external_wealth: true,
      rf_pct: 4.5,
      tx_cost_bps: 50,
      trials_tested: 25,
    }),
    portfolio,
    [],
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.1 },
  );
  assert.ok(resHighCost.simulated.cagr_pct < resZeroCost.simulated.cagr_pct);
  assert.ok(resHighCost.simulated.deflated_sharpe_prob_pct < resZeroCost.simulated.deflated_sharpe_prob_pct);
  // 4. External wealth (MSFT) included in baseline & top correlations
  assert.equal(resWithExt.include_external_wealth, true);
  assert.ok(resWithExt.top_correlations.some((c) => c.ticker === "MSFT"));

  // Compare with include_external_wealth = false -> MSFT must NOT be in baseline holdings
  const resNoExt = runDeterministicBacktest(
    BacktestRequestSchema.parse({
      candidate_ticker: "EUR.DE",
      candidate_yf_symbol: "EUR.DE",
      target_weight_pct: 10,
      funding_source: "cash",
      rebalance_band_pct: 25,
      include_external_wealth: false,
      rf_pct: 4.5,
    }),
    portfolio,
    [],
    profile,
    historyCache,
    { USD: 1.0, EUR: 1.1 },
  );
  assert.equal(resNoExt.include_external_wealth, false);
  assert.equal(resNoExt.top_correlations.some((c) => c.ticker === "MSFT"), false);
});
