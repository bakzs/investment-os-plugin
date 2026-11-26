import assert from "node:assert/strict";
import test from "node:test";
import { computeAfterTaxHurdle, computeScenarioSummary, round } from "../src/server/quant.js";
import {
  DossierModelSchema,
  ForecastRequestSchema,
  FundamentalModelSchema,
  FundamentalsSchema,
  ProfileSchema,
  QuantEvalRequestSchema,
} from "../src/server/schema.js";
import { computeSotpValuation, resolveEffectiveDossierModel } from "../src/server/sotp.js";

test("3-segment SpaceX-style SOTP evaluates unit_economics + milestone_option, dilution, net cash bridge, EV shares, and CAGRs", () => {
  const model = DossierModelSchema.parse({
    as_of: "2026-11-27",
    horizon_years: 5,
    dividend_yield_pct: 0,
    accumulating: false,
    fundamental_model: {
      base_shares_m: 1800,
      annual_dilution_pct: 2,
      projected_net_cash_b: { bear: 2, base: 5, bull: 10 },
      scenario_probabilities: { bear: 1, base: 2, bull: 1 },
      segments: [
        {
          id: "starlink",
          name: "Starlink",
          kind: "unit_economics",
          valuation_metric: "owner_earnings",
          unit_label: "M subscribers",
          units: { bear: 10, base: 15, bull: 25 },
          rev_per_unit_label: "$/yr ARPU",
          rev_per_unit: { bear: 1000, base: 1200, bull: 1400 },
          rev_multiplier_to_b: 0.001,
          margin_pct: { bear: 25, base: 35, bull: 42 },
          capex_or_sbc_drag_b: { bear: 1.5, base: 2.0, bull: 2.5 },
          exit_multiple: { bear: 18, base: 24, bull: 30 },
          notes: "LEO broadband recurring subscriptions.",
        },
        {
          id: "launch",
          name: "Launch",
          kind: "unit_economics",
          valuation_metric: "ebit",
          unit_label: "orbital launches/yr",
          units: { bear: 120, base: 180, bull: 250 },
          rev_per_unit_label: "$M/launch",
          rev_per_unit: { bear: 45, base: 55, bull: 65 },
          margin_pct: { bear: 20, base: 30, bull: 38 },
          capex_or_sbc_drag_b: { bear: 0.5, base: 0.5, bull: 0.5 },
          exit_multiple: { bear: 14, base: 18, bull: 22 },
        },
        {
          id: "starshield",
          name: "Starshield",
          kind: "milestone_option",
          valuation_metric: "ev_direct",
          milestone_label: "Gov/defense constellation fleet contract expansion",
          success_prob: { bear: 0.3, base: 0.6, bull: 0.85 },
          success_ev_b: { bear: 20, base: 50, bull: 90 },
        },
      ],
      variant_perception: [
        {
          id: "arpu-tiering",
          kpi: "Starlink blended ARPU & enterprise maritime mix",
          consensus_view: "Consumer saturation forces ARPU compression toward $750/yr.",
          my_view: "Aviation, maritime, and direct-to-cell sustain $1,200/yr blended ARPU.",
          edge_rationale: "High-margin enterprise terminals lock in multi-year contracts.",
          linked_hypothesis_id: "starlink-arpu",
        },
      ],
      methodology_note: "5Y SOTP combining unit economics and probability-weighted defense optionality.",
    },
  });

  const profile = ProfileSchema.parse({});
  const taxInfo = computeAfterTaxHurdle(profile, true, 0, 0);
  const price = 65;
  const sotp = computeSotpValuation(price, model, taxInfo);
  assert.ok(sotp);

  assert.equal(sotp.horizon_years, 5);
  assert.equal(sotp.base_shares_m, 1800);
  assert.equal(sotp.annual_dilution_pct, 2);

  const expectedTermShares = 1800 * Math.pow(1.02, 5);
  assert.equal(sotp.terminal_shares_m, round(expectedTermShares, 2));

  // Segment-level checks
  const starlink = sotp.segments.find((s) => s.id === "starlink")!;
  const launch = sotp.segments.find((s) => s.id === "launch")!;
  const starshield = sotp.segments.find((s) => s.id === "starshield")!;

  // Bear:
  // Starlink: rev = 10 * 1000 * 0.001 = 10; metric = 10*0.25 - 1.5 = 1.0; ev = 1.0 * 18 = 18
  // Launch: rev = 120 * 45 * 0.001 = 5.4; metric = 5.4*0.20 - 0.5 = 0.58; ev = 0.58 * 14 = 8.12
  // Starshield: rev = 0; metric = 0; ev = 0.3 * 20 = 6.0
  assert.equal(starlink.bear.rev_T_b, 10);
  assert.equal(starlink.bear.metric_T_b, 1);
  assert.equal(starlink.bear.ev_b, 18);
  assert.equal(launch.bear.rev_T_b, 5.4);
  assert.equal(launch.bear.metric_T_b, 0.58);
  assert.equal(launch.bear.ev_b, 8.12);
  assert.equal(starshield.bear.rev_T_b, 0);
  assert.equal(starshield.bear.metric_T_b, 0);
  assert.equal(starshield.bear.ev_b, 6);

  // Base:
  // Starlink: rev = 18; metric = 4.3; ev = 103.2
  // Launch: rev = 9.9; metric = 2.47; ev = 44.46
  // Starshield: ev = 30.0
  assert.equal(starlink.base.rev_T_b, 18);
  assert.equal(starlink.base.metric_T_b, 4.3);
  assert.equal(starlink.base.ev_b, 103.2);
  assert.equal(launch.base.rev_T_b, 9.9);
  assert.equal(launch.base.metric_T_b, 2.47);
  assert.equal(launch.base.ev_b, 44.46);
  assert.equal(starshield.base.ev_b, 30);

  // Bull:
  // Starlink: rev = 35; metric = 35*0.42 - 2.5 = 12.2; ev = 12.2 * 30 = 366
  // Launch: rev = 250 * 65 * 0.001 = 16.25; metric = 16.25*0.38 - 0.5 = 5.675; ev = 5.675 * 22 = 124.85
  // Starshield: ev = 0.85 * 90 = 76.5
  assert.equal(starlink.bull.rev_T_b, 35);
  assert.equal(starlink.bull.metric_T_b, 12.2);
  assert.equal(starlink.bull.ev_b, 366);
  assert.equal(launch.bull.rev_T_b, 16.25);
  assert.equal(launch.bull.metric_T_b, 5.68);
  assert.equal(launch.bull.ev_b, 124.85);
  assert.equal(starshield.bull.ev_b, 76.5);

  // EV share sums must equal ~100% for every case
  for (const c of ["bear", "base", "bull"] as const) {
    const shareSum = sotp.segments.reduce((acc, seg) => acc + seg[c].ev_share_pct, 0);
    assert.ok(Math.abs(shareSum - 100) < 0.05, `Expected ${c} EV share sum ~100%, got ${shareSum}`);
  }

  // Exact Bear/Base/Bull totals, net cash bridge, and target prices
  const bearEquity = 18 + 8.12 + 6 + 2; // 34.12
  const baseEquity = 103.2 + 44.46 + 30 + 5; // 182.66
  const bullEquity = 366 + 124.85 + 76.5 + 10; // 577.35

  assert.equal(sotp.totals.bear.total_ev_b, 32.12);
  assert.equal(sotp.totals.bear.projected_net_cash_b, 2);
  assert.equal(sotp.totals.bear.equity_value_b, 34.12);
  assert.equal(sotp.totals.bear.target_price, round((bearEquity * 1000) / expectedTermShares, 2));

  assert.equal(sotp.totals.base.total_ev_b, 177.66);
  assert.equal(sotp.totals.base.projected_net_cash_b, 5);
  assert.equal(sotp.totals.base.equity_value_b, 182.66);
  assert.equal(sotp.totals.base.target_price, round((baseEquity * 1000) / expectedTermShares, 2));

  assert.equal(sotp.totals.bull.total_ev_b, 567.35);
  assert.equal(sotp.totals.bull.projected_net_cash_b, 10);
  assert.equal(sotp.totals.bull.equity_value_b, 577.35);
  assert.equal(sotp.totals.bull.target_price, round((bullEquity * 1000) / expectedTermShares, 2));

  // Implied CAGRs populated when price & taxInfo provided
  const expectedBaseCagr = round((Math.pow(sotp.totals.base.target_price / price, 1 / 5) - 1) * 100, 2);
  assert.ok(sotp.totals.base.implied_gross_cagr_pct !== null);
  assert.ok(Math.abs(sotp.totals.base.implied_gross_cagr_pct - expectedBaseCagr) <= 0.02);
  assert.equal(sotp.totals.base.implied_after_tax_cagr_pct, sotp.totals.base.implied_gross_cagr_pct);

  // Normalized probabilities sum cleanly to 1
  const probSum =
    sotp.derived_scenarios.bear.probability +
    sotp.derived_scenarios.base.probability +
    sotp.derived_scenarios.bull.probability;
  assert.equal(round(probSum, 4), 1);
  assert.equal(sotp.derived_scenarios.bear.probability, 0.25);
  assert.equal(sotp.derived_scenarios.base.probability, 0.5);
  assert.equal(sotp.derived_scenarios.bull.probability, 0.25);

  // Blended multiple & summary formatting
  assert.equal(sotp.derived_scenarios.base.multiple, round(177.66 / 6.77, 2));
  assert.match(sotp.derived_scenarios.base.summary, /^SOTP Base: \$177\.7B EV across 3 segments \(top: Starlink 58\.1%\)$/);
  assert.equal(sotp.variant_perception.length, 1);
  assert.equal(sotp.sotp_warnings.length, 0);

  // resolveEffectiveDossierModel integrates cleanly with computeScenarioSummary without mutating original model
  assert.equal(model.scenarios, undefined);
  const effective = resolveEffectiveDossierModel(model);
  assert.ok(effective?.scenarios);
  assert.equal(model.scenarios, undefined);
  const scenSummary = computeScenarioSummary(price, effective, taxInfo);
  assert.ok(scenSummary);
  assert.equal(scenSummary.cases.base.target_price_5y, sotp.totals.base.target_price);
});

test("multi-segment cagr_margin triggers XBRL revenue mismatch, diluted shares mismatch, >$5T MCap, and >50% milestone warnings", () => {
  const model = DossierModelSchema.parse({
    horizon_years: 5,
    fundamental_model: {
      base_shares_m: 1000,
      annual_dilution_pct: -2,
      net_cash_b: 50,
      segments: [
        {
          id: "cloud",
          name: "Cloud Platform",
          kind: "cagr_margin",
          valuation_metric: "fcf",
          current_rev_b: 80,
          rev_cagr_pct: { bear: 10, base: 25, bull: 40 },
          margin_pct: { bear: 25, base: 35, bull: 45 },
          exit_multiple: { bear: 15, base: 25, bull: 40 },
        },
        {
          id: "commerce",
          name: "Commerce",
          kind: "cagr_margin",
          valuation_metric: "revenue",
          current_rev_b: 40,
          rev_cagr_pct: { bear: 5, base: 12, bull: 20 },
          exit_multiple: { bear: 2, base: 3, bull: 5 },
        },
        {
          id: "moonshot",
          name: "AGI Moonshot",
          kind: "milestone_option",
          valuation_metric: "ev_direct",
          success_prob: { bear: 0.2, base: 0.75, bull: 0.9 },
          success_ev_b: { bear: 500, base: 4000, bull: 6000 },
        },
      ],
    },
  });

  // Model starting rev = 80 + 40 = 120B; XBRL TTM rev = 80B (50% divergence > 25%)
  // Model base_shares_m = 1000M; XBRL diluted_shares_m = 1300M (23.1% divergence > 15%)
  const fundamentals = FundamentalsSchema.parse({
    ticker: "MEGA",
    updated_at: "2026-11-27T00:00:00Z",
    quarterly: [
      { period_end: "2026-09-30", fiscal_period: "Q3", revenue_m: 21000, diluted_shares_m: 1300 },
      { period_end: "2026-06-30", fiscal_period: "Q2", revenue_m: 20000, diluted_shares_m: 1305 },
      { period_end: "2026-03-31", fiscal_period: "Q1", revenue_m: 20000, diluted_shares_m: 1310 },
      { period_end: "2025-12-31", fiscal_period: "Q4", revenue_m: 19000, diluted_shares_m: 1315 },
    ],
  });

  const sotp = computeSotpValuation(null, model, null, fundamentals);
  assert.ok(sotp);

  // When price is null, implied CAGRs must be null
  assert.equal(sotp.totals.base.implied_gross_cagr_pct, null);
  assert.equal(sotp.totals.base.implied_after_tax_cagr_pct, null);

  // Verify buyback dilution (negative annual_dilution_pct reduces terminal shares)
  assert.ok(sotp.terminal_shares_m < 1000);
  assert.equal(sotp.terminal_shares_m, round(1000 * Math.pow(0.98, 5), 2));

  // All 4 warnings must fire
  assert.ok(
    sotp.sotp_warnings.some((w) => w.includes("XBRL TTM revenue")),
    `Expected XBRL TTM revenue warning, got: ${JSON.stringify(sotp.sotp_warnings)}`,
  );
  assert.ok(
    sotp.sotp_warnings.some((w) => w.includes("XBRL diluted shares")),
    `Expected XBRL diluted shares warning, got: ${JSON.stringify(sotp.sotp_warnings)}`,
  );
  assert.ok(
    sotp.sotp_warnings.some((w) => w.includes("BASE SOTP case") && w.includes("$5T")),
    `Expected BASE >$5T MCap warning, got: ${JSON.stringify(sotp.sotp_warnings)}`,
  );
  assert.ok(
    sotp.sotp_warnings.some((w) => w.includes("BULL SOTP case") && w.includes("$5T")),
    `Expected BULL >$5T MCap warning, got: ${JSON.stringify(sotp.sotp_warnings)}`,
  );
  assert.ok(
    sotp.sotp_warnings.some((w) => w.includes("AGI Moonshot") && w.includes("50%")),
    `Expected milestone concentration warning, got: ${JSON.stringify(sotp.sotp_warnings)}`,
  );
});

test("cagr_margin falls back to annual[0] revenue, ev_direct unit economics works, and derive_scenarios_from_sotp=false preserves manual scenarios", () => {
  const manualScenarios = {
    bear: { probability: 0.2, target_price_5y: 40, multiple: 12, metric_cagr_pct: 2, summary: "Manual Bear" },
    base: { probability: 0.6, target_price_5y: 80, multiple: 18, metric_cagr_pct: 10, summary: "Manual Base" },
    bull: { probability: 0.2, target_price_5y: 120, multiple: 24, metric_cagr_pct: 16, summary: "Manual Bull" },
  };

  const model = DossierModelSchema.parse({
    horizon_years: 3,
    reverse_dcf: {
      basis: "fcf",
      current_metric_per_share: 3,
      exit_multiple: 20,
      net_cash_b: 4,
    },
    scenarios: manualScenarios,
    fundamental_model: {
      base_shares_m: 500,
      derive_scenarios_from_sotp: false,
      segments: [
        {
          id: "core-saas",
          name: "Core SaaS",
          kind: "cagr_margin",
          valuation_metric: "fcf",
          current_rev_b: 10,
          rev_cagr_pct: { bear: 5, base: 15, bull: 25 },
          margin_pct: { bear: 20, base: 25, bull: 30 },
          exit_multiple: { bear: 15, base: 20, bull: 25 },
        },
        {
          id: "spectrum",
          name: "Spectrum Holdings",
          kind: "unit_economics",
          valuation_metric: "ev_direct",
          units: { bear: 100, base: 120, bull: 150 },
          rev_per_unit: { bear: 50, base: 60, bull: 80 },
          rev_multiplier_to_b: 0.001,
        },
      ],
    },
  });

  // Net cash falls back to reverse_dcf.net_cash_b = 4
  const sotp = computeSotpValuation(50, model, null);
  assert.ok(sotp);
  assert.equal(sotp.totals.base.projected_net_cash_b, 4);
  // ev_direct segment Base EV = 120 * 60 * 0.001 = 7.2B
  const spectrum = sotp.segments.find((s) => s.id === "spectrum")!;
  assert.equal(spectrum.base.ev_b, 7.2);
  // Core SaaS Base rev = 10 * 1.15^3 = 15.20875 -> metric = 3.8021875 -> ev = 76.04375 -> 76.04
  assert.equal(sotp.segments.find((s) => s.id === "core-saas")!.base.ev_b, 76.04);

  // derive_scenarios_from_sotp: false preserves manual scenarios untouched
  const resolved = resolveEffectiveDossierModel(model);
  assert.deepEqual(resolved?.scenarios, manualScenarios);

  // annual[0] fallback for XBRL revenue check when only cagr_margin segments exist
  const cagrOnly = DossierModelSchema.parse({
    horizon_years: 5,
    fundamental_model: {
      base_shares_m: 500,
      segments: [
        {
          id: "main",
          name: "Main",
          kind: "cagr_margin",
          current_rev_b: 20,
          rev_cagr_pct: { bear: 4, base: 8, bull: 12 },
          margin_pct: { bear: 15, base: 20, bull: 25 },
          exit_multiple: { bear: 12, base: 16, bull: 20 },
        },
      ],
    },
  });
  const annualOnlyFundamentals = FundamentalsSchema.parse({
    ticker: "ANUL",
    updated_at: "2026-11-27T00:00:00Z",
    annual: [{ period_end: "2025-12-31", fiscal_period: "FY", revenue_m: 10000, diluted_shares_m: 500 }],
  });
  const annualSotp = computeSotpValuation(null, cagrOnly, null, annualOnlyFundamentals);
  assert.ok(annualSotp?.sotp_warnings.some((w) => w.includes("XBRL TTM revenue")));
});

test("backward compatibility on legacy model.json without fundamental_model and schema validation guards", () => {
  const legacyModel = DossierModelSchema.parse({
    as_of: "2026-11-01",
    horizon_years: 5,
    dividend_yield_pct: 1.2,
    reverse_dcf: {
      basis: "fcf",
      current_metric_per_share: 5.5,
      exit_multiple: 22,
    },
    scenarios: {
      bear: { probability: 0.25, target_price_5y: 90, multiple: 16, metric_cagr_pct: 4, summary: "Legacy Bear" },
      base: { probability: 0.5, target_price_5y: 160, multiple: 22, metric_cagr_pct: 11, summary: "Legacy Base" },
      bull: { probability: 0.25, target_price_5y: 230, multiple: 27, metric_cagr_pct: 16, summary: "Legacy Bull" },
    },
  });

  assert.equal(legacyModel.fundamental_model, undefined);
  assert.equal(computeSotpValuation(100, legacyModel), null);
  assert.equal(resolveEffectiveDossierModel(legacyModel), legacyModel);
  assert.equal(resolveEffectiveDossierModel(null), null);

  // ForecastRequestSchema omits default on block_length_weeks so Politis-White L* triggers automatically
  const defaultForecastReq = ForecastRequestSchema.parse({});
  assert.equal(defaultForecastReq.block_length_weeks, undefined);
  assert.equal(ForecastRequestSchema.parse({ block_length_weeks: null }).block_length_weeks, null);
  assert.equal(ForecastRequestSchema.parse({ block_length_weeks: 12 }).block_length_weeks, 12);
  assert.throws(() => ForecastRequestSchema.parse({ block_length_weeks: 1 }));
  assert.throws(() => ForecastRequestSchema.parse({ block_length_weeks: 27 }));

  // QuantEvalRequestSchema defaults & validation
  const defaultEvalReq = QuantEvalRequestSchema.parse({});
  assert.equal(defaultEvalReq.horizon_weeks, 13);
  assert.equal(defaultEvalReq.tx_cost_bps, 10);
  assert.equal(defaultEvalReq.include_external_wealth, true);
  assert.equal(QuantEvalRequestSchema.parse({ horizon_weeks: 26, tx_cost_bps: 25, demo: true }).horizon_weeks, 26);
  assert.throws(() => QuantEvalRequestSchema.parse({ horizon_weeks: 12 }));

  // FundamentalModelSchema constraints
  assert.throws(() => FundamentalModelSchema.parse({ base_shares_m: 100, segments: [] }));
  assert.throws(() =>
    FundamentalModelSchema.parse({
      base_shares_m: 0,
      segments: [{ id: "seg-1", name: "Seg", kind: "cagr_margin" }],
    }),
  );
  assert.throws(() =>
    FundamentalModelSchema.parse({
      base_shares_m: 100,
      segments: [{ id: "INVALID ID", name: "Seg", kind: "cagr_margin" }],
    }),
  );
});
