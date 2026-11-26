import { z } from "zod";

export const TICKER_REGEX = /^[A-Z0-9][A-Z0-9._-]{0,14}$/;
export const THEME_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const CURRENCY_REGEX = /^[A-Z]{3}$/;

export function normalizeTicker(raw: string): string {
  const sym = raw.trim().toUpperCase();
  if (!TICKER_REGEX.test(sym) || sym.includes("..")) {
    throw new Error(`Invalid ticker symbol: ${raw}`);
  }
  return sym;
}

export function normalizeThemeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!THEME_SLUG_REGEX.test(slug) || slug.includes("..")) {
    throw new Error(`Invalid theme slug: ${raw}`);
  }
  return slug;
}

export const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(CURRENCY_REGEX, "Currency must be a 3-letter ISO-4217 code");

export const TickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => TICKER_REGEX.test(v) && !v.includes(".."), {
    message: "Invalid ticker symbol",
  });

export const ThemeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => THEME_SLUG_REGEX.test(v) && !v.includes(".."), {
    message: "Theme slug must be lowercase alphanumeric/kebab-case (1-64 chars)",
  });

export const SlugSchema = ThemeSlugSchema;

const FiniteNumber = z.number().finite();
const NonNegativeNumber = z.number().finite().min(0);
const PctNumber = z.number().finite().min(0).max(100);
const IsoDateSchema = z.string().trim().regex(ISO_DATE_REGEX, "Date must be YYYY-MM-DD");
const IsoDateNullableOptional = IsoDateSchema.nullable().optional();

const SafeHttpsUrlSchema = z
  .string()
  .trim()
  .max(400)
  .refine((u) => u.startsWith("https://"), { message: "URL must start with https://" });

export const RiskCapRuleSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["single_name_max", "ticker", "bucket", "us_situs"]),
  cap_pct: PctNumber,
  ticker: z.string().trim().max(24).optional(),
  tickers: z.array(z.string().trim().max(24)).optional(),
  include_etf_residual_key: z.string().trim().max(64).optional(),
});

export const BenchmarkConfigSchema = z.object({
  ticker: TickerSchema.default("VWRA"),
  yf_symbol: z.string().trim().min(1).max(24).default("VWRA.L"),
  label: z.string().trim().min(1).max(80).default("VWRA.L Core Global"),
  expected_cagr_pct: z.number().finite().min(0).max(50).default(8.0),
  alpha_buffer_pct: z.number().finite().min(0).max(30).default(2.5),
  estate_tax_drag_mode: z.enum(["hedge", "amortized"]).default("hedge"),
  estate_tax_hedge_bps: z.number().finite().min(0).max(500).default(35),
  estate_tax_amortize_years: z.number().int().min(1).max(50).default(20),
  estate_tax_annual_drag_pct: z.number().finite().min(0).max(20).nullable().default(null),
  core_active_cap: z.number().int().min(1).max(50).default(12),
});

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

export const ProfileSchema = z.object({
  base_currency: CurrencySchema.default("USD"),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  edgar_user_agent: z.string().trim().max(200).optional(),
  custody_label: z.string().trim().min(1).max(80).default("Primary Brokerage"),
  benchmark: BenchmarkConfigSchema.default({
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
  }),
  tax_profile: z
    .object({
      country_code: z.string().trim().toUpperCase().min(2).max(12).default("US"),
      nra_us_estate_tax_enabled: z.boolean().default(false),
      us_dividend_wht_pct: PctNumber.default(0),
      ucits_dividend_wht_pct: PctNumber.default(15),
      cgt_pct: PctNumber.default(0),
    })
    .default({
      country_code: "US",
      nra_us_estate_tax_enabled: false,
      us_dividend_wht_pct: 0,
      ucits_dividend_wht_pct: 15,
      cgt_pct: 0,
    }),
  external_exposure: z
    .object({
      enabled: z.boolean().default(false),
      label: z.string().trim().min(1).max(80).default("External Equity Exposure"),
      ticker: z.string().trim().max(24).nullable().default(null),
      qty: NonNegativeNumber.nullable().default(null),
      amount_base: NonNegativeNumber.default(0),
      vested_pct: PctNumber.nullable().default(null),
      us_situs: z.boolean().default(false),
      sector_tags: z.array(z.string().trim().max(40)).default([]),
      paired_label: z.string().trim().max(80).optional(),
      paired_tickers: z.array(z.string().trim().max(24)).optional(),
    })
    .default({
      enabled: false,
      label: "External Equity Exposure",
      ticker: null,
      qty: null,
      amount_base: 0,
      vested_pct: null,
      us_situs: false,
      sector_tags: [],
    }),
  liquidity_reserve: z
    .object({
      enabled: z.boolean().default(false),
      label: z.string().trim().min(1).max(80).default("Near-Term Cash Reserve"),
      amount_base: NonNegativeNumber.default(0),
      horizon_months: z.number().int().min(0).max(600).nullable().default(null),
    })
    .default({
      enabled: false,
      label: "Near-Term Cash Reserve",
      amount_base: 0,
      horizon_months: null,
    }),
  risk_caps: z
    .array(RiskCapRuleSchema)
    .default([
      {
        id: "single-name-max",
        label: "Largest Single-Name Look-Through",
        kind: "single_name_max",
        cap_pct: 15,
      },
      {
        id: "us-tech-megacap",
        label: "Mega-Cap AI / Tech Look-Through",
        kind: "bucket",
        cap_pct: 50,
        tickers: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOG/GOOGL", "AVGO", "TSM", "AMD", "MU", "QCOM", "ASML"],
        include_etf_residual_key: "other_semis_residual",
      },
    ]),
});

export type UserProfile = z.infer<typeof ProfileSchema>;
export type UserProfileInput = z.input<typeof ProfileSchema>;
export type RiskCapRule = z.infer<typeof RiskCapRuleSchema>;

export const PositionSchema = z.object({
  ticker: TickerSchema,
  yf_symbol: z.string().trim().min(1).max(24).default(""),
  name: z.string().trim().min(1).max(120).default(""),
  asset_type: z.string().trim().min(1).max(40).default("Equity"),
  domicile: z.string().trim().min(1).max(40).default("US"),
  us_situs: z.boolean().default(true),
  currency: CurrencySchema.default("USD"),
  qty: NonNegativeNumber,
  avg_cost: NonNegativeNumber.default(0),
  ref_price: NonNegativeNumber.default(0),
});

export type PositionRecord = z.infer<typeof PositionSchema>;

export const PortfolioSchema = z.object({
  as_of: z.string().trim().min(1).max(64),
  source: z.string().trim().min(1).max(80).default("manual"),
  cash_base: FiniteNumber.default(0),
  accruals_base: FiniteNumber.default(0),
  reported_nav_base: NonNegativeNumber.optional(),
  fx_rates: z.record(CurrencySchema, z.number().finite().positive()).default({ USD: 1.0 }),
  positions: z.array(PositionSchema).default([]),
});

export type PortfolioRecord = z.infer<typeof PortfolioSchema>;

export const PositionInputSchema = z.object({
  ticker: TickerSchema,
  qty: NonNegativeNumber,
  avg_cost: NonNegativeNumber.optional(),
  ref_price: NonNegativeNumber.optional(),
  avg_cost_usd: NonNegativeNumber.optional(),
  ref_price_usd: NonNegativeNumber.optional(),
  currency: CurrencySchema.optional(),
  yf_symbol: z.string().trim().min(1).max(24).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  asset_type: z.string().trim().min(1).max(40).optional(),
  domicile: z.string().trim().min(1).max(40).optional(),
  us_situs: z.boolean().optional(),
  isin: z.string().trim().max(24).optional(),
});

export const SecGateSchema = z.object({
  form: z.string().trim().min(1).max(20),
  filed_after: z.string().trim().regex(ISO_DATE_REGEX, "filed_after must be YYYY-MM-DD"),
  description: z.string().trim().min(1).max(240),
});

export const CatalystSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  date: z.string().trim().regex(ISO_DATE_REGEX, "Catalyst date must be YYYY-MM-DD"),
  ticker: TickerSchema,
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(400).default(""),
  urgency: z.enum(["high", "medium", "low"]).default("medium"),
  sec_gate: SecGateSchema.optional(),
});

export type CatalystRecord = z.infer<typeof CatalystSchema>;

export const CatalystsFileSchema = z.object({
  catalysts: z.array(CatalystSchema).default([]),
});

export const HypothesisStatusSchema = z.enum(["untested", "supported", "weakened", "falsified"]);
export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export const VerdictSchema = z.enum(["HIGH_CONVICTION", "WATCH", "PROBATION", "EXIT"]);

export const DossierTierSchema = z.enum(["active", "bench", "passed"]);
export type DossierTier = z.infer<typeof DossierTierSchema>;

export const ActionVerdictSchema = z.enum(["GO", "WAIT", "PASS"]);
export type ActionVerdict = z.infer<typeof ActionVerdictSchema>;

export const ProvenanceSourceKindSchema = z.enum(["sec", "ibkr", "model", "market", "report"]);
export type ProvenanceSourceKind = z.infer<typeof ProvenanceSourceKindSchema>;

export const ProvenanceSourceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  kind: ProvenanceSourceKindSchema,
  date: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, "source date must be YYYY-MM-DD")
    .nullable()
    .optional(),
  url: SafeHttpsUrlSchema.nullable().optional(),
});

export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const HypothesisRuleSchema = z.object({
  source: z.enum(["xbrl", "edgar", "market", "insiders"]).default("xbrl"),
  metric: z.string().trim().min(1).max(64),
  op: z.enum(["<=", "<", ">=", ">", "=="]),
  threshold: z.number().finite(),
  period: z.enum(["latest_q", "ttm", "latest_fy"]).default("latest_q"),
});

export type HypothesisRule = z.infer<typeof HypothesisRuleSchema>;

export const HypothesisSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Hypothesis id must be alphanumeric/kebab-case"),
  claim: z.string().trim().min(1).max(300),
  metric: z.string().trim().max(160).optional(),
  status: HypothesisStatusSchema.default("untested"),
  confidence: ConfidenceSchema.default("medium"),
  evidence: z.string().trim().max(500).optional(),
  last_tested: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, "last_tested must be YYYY-MM-DD")
    .nullable()
    .optional(),
  source_url: SafeHttpsUrlSchema.nullable().optional(),
  is_core: z.boolean().default(false),
  waiver_reason: z.string().trim().max(240).nullable().optional(),
  waiver_expires: IsoDateNullableOptional,
  rule: HypothesisRuleSchema.nullable().optional(),
});

export type HypothesisRecord = z.infer<typeof HypothesisSchema>;
export type HypothesisRecordInput = z.input<typeof HypothesisSchema>;

export const PitSnapshotSchema = z.object({
  vix: z.number().finite().nullable().optional(),
  us10y_pct: z.number().finite().nullable().optional(),
  expected_after_tax_cagr_pct: z.number().finite().nullable().optional(),
  hurdle_cagr_pct: z.number().finite().nullable().optional(),
  implied_revenue_cagr_pct: z.number().finite().nullable().optional(),
  portfolio_weight_pct: z.number().finite().nullable().optional(),
  fundamentals_period: z.string().trim().max(32).nullable().optional(),
});

export type PitSnapshot = z.infer<typeof PitSnapshotSchema>;

export const ThesisTestRecordSchema = z.object({
  ticker: TickerSchema,
  tested_at: z.string().trim().min(1).max(64),
  event_type: z.enum(["thesis_test", "rule_change"]).default("thesis_test"),
  verdict: VerdictSchema,
  action_verdict: ActionVerdictSchema.nullable().optional(),
  kill_switch_triggered: z.boolean().default(false),
  summary: z.string().trim().min(1).max(600),
  bear_case: z.string().trim().max(600).optional(),
  hypotheses_tested: z.array(HypothesisSchema).max(12).default([]),
  price_at_test: NonNegativeNumber.nullable().optional(),
  benchmark_price_at_test: NonNegativeNumber.nullable().optional(),
  currency: CurrencySchema.optional(),
  pit_snapshot: PitSnapshotSchema.nullable().optional(),
});

export type ThesisTestRecord = z.infer<typeof ThesisTestRecordSchema>;
export type ThesisTestRecordInput = z.input<typeof ThesisTestRecordSchema>;

export const ThesisUpdateSchema = z.object({
  ticker: TickerSchema,
  role: z.string().trim().min(1).max(80).optional(),
  yf_symbol: z.string().trim().min(1).max(24).optional(),
  currency: CurrencySchema.optional(),
  us_situs: z.boolean().optional(),
  tier: DossierTierSchema.optional(),
  action_verdict: ActionVerdictSchema.nullable().optional(),
  takeaway: z.array(z.string().trim().min(1).max(260)).max(3).optional(),
  last_audited_date: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, "last_audited_date must be YYYY-MM-DD")
    .nullable()
    .optional(),
  price_at_audit: NonNegativeNumber.nullable().optional(),
  sources: z.array(ProvenanceSourceSchema).max(12).optional(),
  rejection_reason: z.string().trim().max(600).nullable().optional(),
  reentry_trigger: z.string().trim().max(400).nullable().optional(),
  reentry_price: NonNegativeNumber.nullable().optional(),
  buy_zone_low: NonNegativeNumber.nullable().optional(),
  buy_zone_high: NonNegativeNumber.nullable().optional(),
  trim_zone: NonNegativeNumber.nullable().optional(),
  clear_buy_zone: z.boolean().optional(),
  clear_trim_zone: z.boolean().optional(),
  gated: z.boolean().optional(),
  max_weight_pct: PctNumber.nullable().optional(),
  next_catalyst_date: z.string().trim().max(32).nullable().optional(),
  next_catalyst: z.string().trim().max(240).nullable().optional(),
  verdict: VerdictSchema.nullable().optional(),
  bear_case_summary: z.string().trim().max(600).nullable().optional(),
  last_tested_date: z
    .string()
    .trim()
    .regex(ISO_DATE_REGEX, "last_tested_date must be YYYY-MM-DD")
    .nullable()
    .optional(),
  hypotheses: z.array(HypothesisSchema).max(12).optional(),
  theme_refs: z.array(SlugSchema).max(12).optional(),
  rationale: z.string().trim().max(300).optional(),
  core_thesis: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
  kill_switches: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
  decision_log_note: z.string().trim().max(4000).optional(),
});

export type ThesisUpdateInput = z.input<typeof ThesisUpdateSchema>;

export const ScenarioCaseSchema = z.object({
  probability: z.number().finite().min(0).max(1),
  target_price_5y: NonNegativeNumber,
  multiple: NonNegativeNumber.nullable().optional(),
  metric_cagr_pct: z.number().finite().min(-99).max(500).nullable().optional(),
  summary: z.string().trim().min(1).max(400),
});

export type ScenarioCase = z.infer<typeof ScenarioCaseSchema>;

export const ReverseDcfInputSchema = z.object({
  basis: z.enum(["fcf", "eps"]).default("fcf"),
  current_metric_per_share: z.number().finite().positive(),
  current_revenue_b: z.number().finite().positive().nullable().optional(),
  shares_diluted_m: z.number().finite().positive().nullable().optional(),
  target_margin_pct: z.number().finite().min(0.1).max(100).nullable().optional(),
  exit_multiple: z.number().finite().positive(),
  base_revenue_cagr_pct: z.number().finite().min(-50).max(200).nullable().optional(),
  net_cash_b: z.number().finite().nullable().optional(),
  annual_dilution_pct: z.number().finite().min(-15).max(30).default(0),
  metric_basis_note: z.string().trim().max(120).nullable().optional(),
  linked_hypothesis_ids: z.array(z.string().trim().min(1).max(64)).max(12).default([]),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type ReverseDcfInput = z.infer<typeof ReverseDcfInputSchema>;

export const TrancheRuleSchema = z.object({
  label: z.string().trim().min(1).max(80),
  price: NonNegativeNumber,
  pct_of_add: z.number().finite().min(0).max(100),
  note: z.string().trim().max(240).optional(),
});

export type TrancheRule = z.infer<typeof TrancheRuleSchema>;

export const ScenarioTripleSchema = z.object({
  bear: FiniteNumber,
  base: FiniteNumber,
  bull: FiniteNumber,
});

export type ScenarioTriple = z.infer<typeof ScenarioTripleSchema>;

export const FundamentalSegmentSchema = z.object({
  id: z.string().trim().min(1).max(48).regex(/^[a-z0-9._-]+$/),
  name: z.string().trim().min(1).max(96),
  kind: z.enum(["unit_economics", "cagr_margin", "milestone_option"]),
  valuation_metric: z.enum(["owner_earnings", "ebit", "fcf", "revenue", "ev_direct"]).default("owner_earnings"),
  unit_label: z.string().trim().max(64).optional(),
  units: ScenarioTripleSchema.optional(),
  rev_per_unit_label: z.string().trim().max(64).optional(),
  rev_per_unit: ScenarioTripleSchema.optional(),
  rev_multiplier_to_b: z.number().finite().positive().default(0.001),
  current_rev_b: z.number().finite().nonnegative().optional(),
  rev_cagr_pct: ScenarioTripleSchema.optional(),
  margin_pct: ScenarioTripleSchema.optional(),
  capex_or_sbc_drag_b: ScenarioTripleSchema.optional(),
  exit_multiple: ScenarioTripleSchema.optional(),
  milestone_label: z.string().trim().max(140).optional(),
  success_prob: ScenarioTripleSchema.optional(),
  success_ev_b: ScenarioTripleSchema.optional(),
  notes: z.string().trim().max(300).optional(),
});

export type FundamentalSegment = z.infer<typeof FundamentalSegmentSchema>;
export type FundamentalSegmentInput = z.input<typeof FundamentalSegmentSchema>;

export const VariantPerceptionItemSchema = z.object({
  id: z.string().trim().min(1).max(48),
  kpi: z.string().trim().min(1).max(120),
  consensus_view: z.string().trim().min(1).max(200),
  my_view: z.string().trim().min(1).max(200),
  edge_rationale: z.string().trim().max(320).optional(),
  linked_hypothesis_id: z.string().trim().max(64).nullable().optional(),
});

export type VariantPerceptionItem = z.infer<typeof VariantPerceptionItemSchema>;

export const FundamentalModelSchema = z.object({
  base_shares_m: z.number().finite().positive(),
  annual_dilution_pct: z.number().finite().min(-15).max(30).default(0),
  projected_net_cash_b: ScenarioTripleSchema.optional(),
  net_cash_b: z.number().finite().optional(),
  scenario_probabilities: ScenarioTripleSchema.default({ bear: 0.25, base: 0.5, bull: 0.25 }),
  derive_scenarios_from_sotp: z.boolean().default(true),
  segments: z.array(FundamentalSegmentSchema).min(1).max(8),
  variant_perception: z.array(VariantPerceptionItemSchema).max(8).default([]),
  methodology_note: z.string().trim().max(400).optional(),
});

export type FundamentalModel = z.infer<typeof FundamentalModelSchema>;
export type FundamentalModelInput = z.input<typeof FundamentalModelSchema>;

export const DossierModelSchema = z.object({
  as_of: z.string().trim().max(64).optional(),
  horizon_years: z.number().int().min(1).max(15).default(5),
  dividend_yield_pct: z.number().finite().min(0).max(30).default(0),
  accumulating: z.boolean().default(false),
  dividend_wht_pct: PctNumber.nullable().optional(),
  reverse_dcf: ReverseDcfInputSchema.nullable().optional(),
  scenarios: z
    .object({
      bear: ScenarioCaseSchema,
      base: ScenarioCaseSchema,
      bull: ScenarioCaseSchema,
    })
    .nullable()
    .optional(),
  fundamental_model: FundamentalModelSchema.nullable().optional(),
  tranches: z.array(TrancheRuleSchema).max(5).optional(),
});

export type DossierModel = z.infer<typeof DossierModelSchema>;
export type DossierModelInput = z.input<typeof DossierModelSchema>;

export const EarningsInsightSchema = z.object({
  period: z.string().trim().max(80).optional(),
  published_at: z.string().trim().max(64).optional(),
  kind: z.enum(["preview", "recap", "summary"]).default("summary"),
  headline: z.string().trim().max(240).optional(),
  summary: z.string().trim().max(1500),
  key_metrics: z.array(z.string().trim().max(240)).max(12).default([]),
  source_url: SafeHttpsUrlSchema.nullable().optional(),
});

export type EarningsInsight = z.infer<typeof EarningsInsightSchema>;

export const OptionsIntelSchema = z.object({
  as_of: z.string().trim().max(64).optional(),
  underlying_price: NonNegativeNumber.nullable().optional(),
  expiry: z.string().trim().max(32),
  atm_strike: NonNegativeNumber.nullable().optional(),
  straddle_price: NonNegativeNumber.nullable().optional(),
  implied_move_pct: z.number().finite().min(0).max(200),
  call_iv_pct: z.number().finite().min(0).max(500).nullable().optional(),
  put_iv_pct: z.number().finite().min(0).max(500).nullable().optional(),
  iv_skew_pct: z.number().finite().min(-200).max(200).nullable().optional(),
  iv_percentile_52w: z.number().finite().min(0).max(100).nullable().optional(),
  note: z.string().trim().max(300).optional(),
});

export type OptionsIntel = z.infer<typeof OptionsIntelSchema>;

export const CompanyConnectionSchema = z.object({
  ticker: z.string().trim().max(24).optional(),
  name: z.string().trim().min(1).max(120),
  relation: z.string().trim().min(1).max(64).default("peer"),
});

export type CompanyConnection = z.infer<typeof CompanyConnectionSchema>;

export const ConsensusEstimateSchema = z.object({
  as_of: z.string().trim().max(64).optional(),
  ntm_rev_b: z.number().finite().positive().nullable().optional(),
  ntm_rev_growth_pct: z.number().finite().min(-100).max(500).nullable().optional(),
  ntm_eps: z.number().finite().nullable().optional(),
  fy1_eps_est: z.number().finite().nullable().optional(),
  fy2_eps_est: z.number().finite().nullable().optional(),
  eps_revision_90d_pct: z.number().finite().min(-200).max(500).nullable().optional(),
  target_price_mean: NonNegativeNumber.nullable().optional(),
  analyst_count: z.number().int().min(0).max(200).nullable().optional(),
});

export type ConsensusEstimate = z.infer<typeof ConsensusEstimateSchema>;

export const DossierIntelSchema = z.object({
  updated_at: z.string().trim().min(1).max(64),
  provider: z.string().trim().min(1).max(64).default("ibkr"),
  contract_id: z.union([z.number().int(), z.string().trim().min(1).max(40)]).nullable().optional(),
  earnings_insight: EarningsInsightSchema.nullable().optional(),
  options_intel: OptionsIntelSchema.nullable().optional(),
  consensus: ConsensusEstimateSchema.nullable().optional(),
  themes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  connections: z.array(CompanyConnectionSchema).max(20).default([]),
});

export type DossierIntel = z.infer<typeof DossierIntelSchema>;

export const HistoryPointSchema = z.object({
  date: z.string().trim().regex(ISO_DATE_REGEX, "History date must be YYYY-MM-DD"),
  close: z.number().finite().positive(),
});

export type HistoryPoint = z.infer<typeof HistoryPointSchema>;

export const HistorySeriesSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  currency: CurrencySchema.default("USD"),
  source: z.enum(["yahoo", "ibkr", "manual"]).default("yahoo"),
  updated_at: z.string().trim().min(1).max(64),
  points: z.array(HistoryPointSchema).default([]),
});

export type HistorySeries = z.infer<typeof HistorySeriesSchema>;

export const HistoryCacheSchema = z.object({
  updated_at: z.string().trim().max(64).nullable().default(null),
  series: z.record(z.string(), HistorySeriesSchema).default({}),
});

export type HistoryCacheState = z.infer<typeof HistoryCacheSchema>;

export const PaPeriodReturnSchema = z.object({
  period: z.string().trim().min(1).max(32),
  twr_pct: z.number().finite().nullable().optional(),
  mwr_pct: z.number().finite().nullable().optional(),
  benchmark_pct: z.number().finite().nullable().optional(),
  start_date: z.string().trim().max(32).nullable().optional(),
  end_date: z.string().trim().max(32).nullable().optional(),
});

export type PaPeriodReturn = z.infer<typeof PaPeriodReturnSchema>;

export const PaPerformanceSchema = z.object({
  updated_at: z.string().trim().min(1).max(64),
  provider: z.string().trim().min(1).max(64).default("ibkr"),
  base_currency: CurrencySchema.optional(),
  periods: z.array(PaPeriodReturnSchema).max(20).default([]),
  note: z.string().trim().max(400).optional(),
});

export type PaPerformanceState = z.infer<typeof PaPerformanceSchema>;

export const MacroRegimeLabelSchema = z.enum(["CALM", "ELEVATED", "HIGH_VOL", "STRESS"]);
export type MacroRegimeLabel = z.infer<typeof MacroRegimeLabelSchema>;

export const MacroRegimeSchema = z.object({
  updated_at: z.string().trim().min(1).max(64),
  vix: z.number().finite().nullable().default(null),
  us10y_pct: z.number().finite().nullable().default(null),
  us3m_pct: z.number().finite().nullable().default(null),
  hy_credit_ratio: z.number().finite().nullable().default(null),
  dxy: z.number().finite().nullable().default(null),
  regime_label: MacroRegimeLabelSchema.default("CALM"),
  notes: z.string().trim().max(400).nullable().optional(),
});

export type MacroRegime = z.infer<typeof MacroRegimeSchema>;
export type MacroRegimeInput = z.input<typeof MacroRegimeSchema>;

export const MarketCacheEntrySchema = z.object({
  price: NonNegativeNumber,
  regular_price: NonNegativeNumber.nullable().optional(),
  extended_price: NonNegativeNumber.nullable().optional(),
  market_state: z.string().trim().max(24).nullable().optional(),
  quote_time: z.string().trim().max(64).nullable().optional(),
  fifty_two_week_high: z.number().finite().positive().nullable().optional(),
  fifty_two_week_low: z.number().finite().positive().nullable().optional(),
  currency: CurrencySchema.default("USD"),
  sparkline: z.array(z.number().finite()).default([]),
  change_1d_pct: z.number().finite().nullable().default(null),
  change_1m_pct: z.number().finite().nullable().default(null),
});

export type MarketCacheEntry = z.infer<typeof MarketCacheEntrySchema>;
export type MarketCacheEntryInput = z.input<typeof MarketCacheEntrySchema>;

export const MarketCacheSchema = z.object({
  updated_at: z.string().trim().max(64).nullable().default(null),
  vix: z.number().finite().nullable().default(null),
  vix_sparkline: z.array(z.number().finite()).default([]),
  fx_rates: z.record(CurrencySchema, z.number().finite().positive()).optional(),
  macro_regime: MacroRegimeSchema.nullable().optional(),
  quotes: z.record(z.string(), MarketCacheEntrySchema).default({}),
});

export type MarketCacheState = z.infer<typeof MarketCacheSchema>;
export type MarketCacheStateInput = z.input<typeof MarketCacheSchema>;

export const FundamentalsPeriodSchema = z.object({
  period_end: IsoDateSchema,
  filed_date: IsoDateNullableOptional,
  fiscal_year: z.number().int().min(1990).max(2100).nullable().optional(),
  fiscal_period: z.string().trim().min(1).max(16),
  form: z.string().trim().max(16).optional(),
  accession: z.string().trim().max(32).optional(),
  revenue_m: z.number().finite().nullable().optional(),
  gross_profit_m: z.number().finite().nullable().optional(),
  operating_income_m: z.number().finite().nullable().optional(),
  net_income_m: z.number().finite().nullable().optional(),
  ocf_m: z.number().finite().nullable().optional(),
  capex_m: z.number().finite().nullable().optional(),
  fcf_m: z.number().finite().nullable().optional(),
  sbc_m: z.number().finite().nullable().optional(),
  diluted_shares_m: z.number().finite().positive().nullable().optional(),
  eps_diluted: z.number().finite().nullable().optional(),
  accounts_receivable_m: z.number().finite().nullable().optional(),
  inventory_m: z.number().finite().nullable().optional(),
  cogs_m: z.number().finite().nullable().optional(),
  cash_and_st_inv_m: z.number().finite().nullable().optional(),
  total_debt_m: z.number().finite().nullable().optional(),
  total_assets_m: z.number().finite().nullable().optional(),
  stockholders_equity_m: z.number().finite().nullable().optional(),
  net_cash_b: z.number().finite().nullable().optional(),
  owner_earnings_m: z.number().finite().nullable().optional(),
  owner_earnings_margin_pct: z.number().finite().nullable().optional(),
  invested_capital_m: z.number().finite().nullable().optional(),
  roic_pct: z.number().finite().nullable().optional(),
  accruals_ratio_pct: z.number().finite().nullable().optional(),
  gross_margin_pct: z.number().finite().nullable().optional(),
  operating_margin_pct: z.number().finite().nullable().optional(),
  fcf_margin_pct: z.number().finite().nullable().optional(),
  ocf_to_ni_pct: z.number().finite().nullable().optional(),
  sbc_pct_rev: z.number().finite().nullable().optional(),
  dso_days: z.number().finite().nullable().optional(),
  dio_days: z.number().finite().nullable().optional(),
});

export type FundamentalsPeriod = z.infer<typeof FundamentalsPeriodSchema>;

export const FundamentalsRatiosSchema = z.object({
  gross_margin_pct: z.number().finite().nullable().optional(),
  operating_margin_pct: z.number().finite().nullable().optional(),
  dso_days: z.number().finite().nullable().optional(),
  dio_days: z.number().finite().nullable().optional(),
  ocf_to_ni_pct: z.number().finite().nullable().optional(),
  fcf_margin_pct: z.number().finite().nullable().optional(),
  owner_earnings_margin_pct: z.number().finite().nullable().optional(),
  sbc_pct_rev: z.number().finite().nullable().optional(),
  roic_pct: z.number().finite().nullable().optional(),
  incremental_roic_pct: z.number().finite().nullable().optional(),
  accruals_ratio_pct: z.number().finite().nullable().optional(),
  quality_grade: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  quality_flags: z.array(z.string().trim().max(160)).max(12).optional(),
  net_cash_b: z.number().finite().nullable().optional(),
  diluted_shares_yoy_pct: z.number().finite().nullable().optional(),
  ttm_eps: z.number().finite().nullable().optional(),
  ttm_fcf_per_share: z.number().finite().nullable().optional(),
  ttm_owner_earnings_per_share: z.number().finite().nullable().optional(),
  ttm_rev_per_share: z.number().finite().nullable().optional(),
});

export type FundamentalsRatios = z.infer<typeof FundamentalsRatiosSchema>;

export const FundamentalsSchema = z.object({
  ticker: TickerSchema,
  cik: z.string().trim().max(16).nullable().optional(),
  updated_at: z.string().trim().min(1).max(64),
  source: z.enum(["sec_xbrl", "manual", "hybrid"]).default("sec_xbrl"),
  currency: CurrencySchema.default("USD"),
  latest_periodic_accession: z.string().trim().max(32).nullable().optional(),
  quarterly: z.array(FundamentalsPeriodSchema).max(24).default([]),
  annual: z.array(FundamentalsPeriodSchema).max(10).default([]),
  latest_ratios: FundamentalsRatiosSchema.default({}),
  overrides: z.record(z.string(), z.union([z.number().finite(), z.string().max(240), z.null()])).optional(),
});

export type DossierFundamentals = z.infer<typeof FundamentalsSchema>;
export type DossierFundamentalsInput = z.input<typeof FundamentalsSchema>;

export const InsiderWindowSchema = z.object({
  disc_buy_usd: NonNegativeNumber.default(0),
  disc_sell_usd: NonNegativeNumber.default(0),
  plan_sell_usd: NonNegativeNumber.default(0),
  distinct_buyers: z.number().int().min(0).default(0),
  distinct_sellers: z.number().int().min(0).default(0),
});

export type InsiderWindow = z.infer<typeof InsiderWindowSchema>;

export const InsiderFilingRowSchema = z.object({
  filing_date: IsoDateSchema,
  accession: z.string().trim().min(1).max(32),
  form: z.string().trim().max(16).default("4"),
  owner_name: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160).default(""),
  is_director: z.boolean().default(false),
  code: z.string().trim().min(1).max(16),
  shares: NonNegativeNumber.default(0),
  price: NonNegativeNumber.nullable().default(null),
  value_usd: NonNegativeNumber.default(0),
  is_10b5_1: z.boolean().default(false),
  url: SafeHttpsUrlSchema.nullable().optional(),
});

export type InsiderFilingRow = z.infer<typeof InsiderFilingRowSchema>;

export const InsidersSchema = z.object({
  ticker: TickerSchema,
  cik: z.string().trim().max(16).nullable().optional(),
  updated_at: z.string().trim().min(1).max(64),
  cached_accessions: z.array(z.string().trim().max(32)).max(100).default([]),
  window_90d: InsiderWindowSchema.default({
    disc_buy_usd: 0,
    disc_sell_usd: 0,
    plan_sell_usd: 0,
    distinct_buyers: 0,
    distinct_sellers: 0,
  }),
  window_12m: InsiderWindowSchema.default({
    disc_buy_usd: 0,
    disc_sell_usd: 0,
    plan_sell_usd: 0,
    distinct_buyers: 0,
    distinct_sellers: 0,
  }),
  flags: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  recent_filings: z.array(InsiderFilingRowSchema).max(100).default([]),
});

export type DossierInsiders = z.infer<typeof InsidersSchema>;
export type DossierInsidersInput = z.input<typeof InsidersSchema>;

export const IntelHistoryEntrySchema = z.object({
  recorded_at: z.string().trim().min(1).max(64),
  provider: z.string().trim().min(1).max(64).default("ibkr"),
  period: z.string().trim().max(80).nullable().optional(),
  eps_actual: z.number().finite().nullable().optional(),
  eps_est: z.number().finite().nullable().optional(),
  rev_actual_b: z.number().finite().nullable().optional(),
  rev_est_b: z.number().finite().nullable().optional(),
  fy1_eps_est: z.number().finite().nullable().optional(),
  fy2_eps_est: z.number().finite().nullable().optional(),
  implied_move_pct: z.number().finite().min(0).max(200).nullable().optional(),
  iv_30d_pct: z.number().finite().min(0).max(500).nullable().optional(),
  iv_pct_52w: z.number().finite().min(0).max(100).nullable().optional(),
  headline: z.string().trim().max(240).nullable().optional(),
});

export type IntelHistoryEntry = z.infer<typeof IntelHistoryEntrySchema>;
export type IntelHistoryEntryInput = z.input<typeof IntelHistoryEntrySchema>;

export const ThemeStanceSchema = z.enum(["beneficiary", "hedged_tollbooth", "at_risk", "watch"]);
export type ThemeStance = z.infer<typeof ThemeStanceSchema>;

export const ThemeExposureSchema = z.object({
  ticker: TickerSchema,
  stance: ThemeStanceSchema,
  note: z.string().trim().min(1).max(400),
});

export type ThemeExposure = z.infer<typeof ThemeExposureSchema>;

export const ThemeSignpostSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Signpost id must be alphanumeric/kebab-case"),
  metric: z.string().trim().min(1).max(200),
  threshold: z.string().trim().max(160).optional(),
  status: z.enum(["watching", "confirmed", "falsified"]).default("watching"),
  evidence: z.string().trim().max(400).nullable().optional(),
  last_checked: IsoDateNullableOptional,
});

export type ThemeSignpost = z.infer<typeof ThemeSignpostSchema>;

export const ThemeObjectSchema = z.object({
  slug: ThemeSlugSchema,
  title: z.string().trim().min(1).max(140),
  updated_at: z.string().trim().min(1).max(64),
  relationship_mode: z.enum(["zero_sum", "symbiotic", "cyclical", "structural"]).default("structural"),
  summary: z.string().trim().min(1).max(1200),
  shared_assumptions: z.array(z.string().trim().min(1).max(400)).max(16).default([]),
  exposures: z.array(ThemeExposureSchema).max(30).default([]),
  signposts: z.array(ThemeSignpostSchema).max(20).default([]),
  sources: z.array(ProvenanceSourceSchema).max(16).default([]),
});

export type ThemeObject = z.infer<typeof ThemeObjectSchema>;
export type ThemeObjectInput = z.input<typeof ThemeObjectSchema>;

export const WatchdogAlertSeveritySchema = z.enum(["high", "medium", "info"]);
export type WatchdogAlertSeverity = z.infer<typeof WatchdogAlertSeveritySchema>;

export const WatchdogAlertSchema = z.object({
  id: z.string().trim().min(1).max(120),
  detected_at: z.string().trim().min(1).max(64),
  severity: WatchdogAlertSeveritySchema.default("medium"),
  kind: z.string().trim().min(1).max(64),
  ticker: TickerSchema.nullable().optional(),
  theme_slug: ThemeSlugSchema.nullable().optional(),
  title: z.string().trim().min(1).max(180),
  detail: z.string().trim().max(600).default(""),
  acknowledged: z.boolean().default(false),
});

export type WatchdogAlert = z.infer<typeof WatchdogAlertSchema>;
export type WatchdogAlertInput = z.input<typeof WatchdogAlertSchema>;

export const DossierUpsertSchema = ThesisUpdateSchema.extend({
  model: DossierModelSchema.optional(),
  memo_md: z.string().max(200_000).optional(),
  intel: DossierIntelSchema.optional(),
});

export type DossierUpsertInput = z.input<typeof DossierUpsertSchema>;

export const IntelIngestSchema = z
  .object({
    ticker: TickerSchema.optional(),
    intel: DossierIntelSchema.optional(),
    history_series: z.array(HistorySeriesSchema).max(40).optional(),
    pa_performance: PaPerformanceSchema.optional(),
  })
  .refine((v) => Boolean(v.intel || (v.history_series && v.history_series.length > 0) || v.pa_performance), {
    message: "Provide at least one of intel, history_series, or pa_performance",
  })
  .refine((v) => !v.intel || Boolean(v.ticker), {
    message: "ticker is required when ingesting dossier intel",
  });

export type IntelIngestInput = z.input<typeof IntelIngestSchema>;

export const BacktestRequestSchema = z.object({
  candidate_ticker: TickerSchema,
  candidate_yf_symbol: z.string().trim().min(1).max(24).optional(),
  target_weight_pct: z.number().finite().min(0.5).max(50).default(5),
  funding_source: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .default("cash")
    .refine(
      (val) => {
        if (val === "cash" || val === "pro_rata") return true;
        if (val.startsWith("swap:")) {
          const sym = val.slice(5).trim().toUpperCase();
          return TICKER_REGEX.test(sym) && !sym.includes("..");
        }
        return false;
      },
      { message: 'funding_source must be "cash", "pro_rata", or "swap:<TICKER>"' },
    ),
  rebalance_band_pct: z.number().finite().min(5).max(100).default(25),
  include_external_wealth: z.boolean().default(true),
  rf_pct: z.number().finite().min(0).max(20).optional(),
  tx_cost_bps: z.number().finite().min(0).max(100).default(10),
  trials_tested: z.number().int().min(1).max(200).optional(),
  demo: z.boolean().optional(),
});

export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

export const ForecastActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tax_swap"),
    ticker: TickerSchema,
    target_ticker: TickerSchema.optional(),
    pct: z.number().finite().min(1).max(100).default(100),
  }),
  z.object({
    type: z.literal("sell"),
    ticker: TickerSchema,
    pct: z.number().finite().min(1).max(100).optional(),
    amount_base: NonNegativeNumber.optional(),
  }),
  z.object({
    type: z.literal("buy"),
    ticker: TickerSchema,
    amount_base: z.number().finite().positive(),
    yf_symbol: z.string().trim().min(1).max(24).optional(),
    currency: CurrencySchema.optional(),
    us_situs: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("park_cash_in_benchmark"),
    pct: z.number().finite().min(1).max(100).default(100),
    keep_reserve: z.boolean().default(true),
  }),
]);

export type ForecastAction = z.infer<typeof ForecastActionSchema>;

export const ForecastRequestSchema = z.object({
  horizon_years: z.number().int().min(1).max(10).default(5),
  include_external_wealth: z.boolean().default(true),
  apply_recommended_rotations: z.boolean().default(false),
  actions: z.array(ForecastActionSchema).max(40).default([]),
  regime_vol_multiplier: z.number().finite().min(0.5).max(2.5).default(1.0),
  simulations: z.number().int().min(200).max(5000).default(1500),
  rf_pct: z.number().finite().min(0).max(20).optional(),
  return_model: z.enum(["black_litterman", "raw_dossier"]).default("black_litterman"),
  simulation_engine: z.enum(["block_bootstrap", "student_t"]).default("block_bootstrap"),
  block_length_weeks: z.number().int().min(2).max(26).nullable().optional(),
  demo: z.boolean().optional(),
});

export type ForecastRequest = z.infer<typeof ForecastRequestSchema>;
export type ForecastRequestInput = z.input<typeof ForecastRequestSchema>;

export const QuantEvalRequestSchema = z.object({
  horizon_weeks: z.union([z.literal(13), z.literal(26)]).default(13),
  tx_cost_bps: z.number().finite().min(0).max(100).default(10),
  include_external_wealth: z.boolean().default(true),
  demo: z.boolean().optional(),
});

export type QuantEvalRequest = z.infer<typeof QuantEvalRequestSchema>;
export type QuantEvalRequestInput = z.input<typeof QuantEvalRequestSchema>;

export const EtfMetadataSchema = z
  .object({
    isin: z.string().trim().max(24).optional(),
    domicile: z.string().trim().max(40).optional(),
    us_situs: z.boolean().optional(),
    ocf_pct: z.number().finite().min(0).max(10).optional(),
    us_weight: z.number().finite().min(0).max(1).optional(),
    other_semis_residual: z.number().finite().min(0).max(1).optional(),
  })
  .catchall(z.union([z.number().finite(), z.string().max(120), z.boolean()]));

export type EtfMetadata = z.infer<typeof EtfMetadataSchema>;

export const EtfWeightsConfigSchema = z.object({
  as_of: z.string().trim().max(64).optional(),
  note: z.string().trim().max(400).optional(),
  etf_weights: z
    .record(
      z.string().trim().min(1).max(24),
      z.record(z.string().trim().min(1).max(64), z.union([z.number().finite().min(0), z.string().trim().max(240)])),
    )
    .default({}),
  etf_metadata: z.record(z.string().trim().min(1).max(24), EtfMetadataSchema).default({}),
});

export type EtfWeightsConfig = z.infer<typeof EtfWeightsConfigSchema>;
export type EtfWeightsConfigInput = z.input<typeof EtfWeightsConfigSchema>;

export function defaultProfile(): UserProfile {
  return ProfileSchema.parse({});
}
