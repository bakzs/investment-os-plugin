import { z } from "zod";

export const TICKER_REGEX = /^[A-Z0-9][A-Z0-9._-]{0,14}$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const CURRENCY_REGEX = /^[A-Z]{3}$/;

export function normalizeTicker(raw: string): string {
  const sym = raw.trim().toUpperCase();
  if (!TICKER_REGEX.test(sym) || sym.includes("..")) {
    throw new Error(`Invalid ticker symbol: ${raw}`);
  }
  return sym;
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

const FiniteNumber = z.number().finite();
const NonNegativeNumber = z.number().finite().min(0);
const PctNumber = z.number().finite().min(0).max(100);

export const RiskCapRuleSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["single_name_max", "ticker", "bucket", "us_situs"]),
  cap_pct: PctNumber,
  ticker: z.string().trim().max(24).optional(),
  tickers: z.array(z.string().trim().max(24)).optional(),
  include_etf_residual_key: z.string().trim().max(64).optional(),
});

export const ProfileSchema = z.object({
  base_currency: CurrencySchema.default("USD"),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  edgar_user_agent: z.string().trim().max(200).optional(),
  custody_label: z.string().trim().min(1).max(80).default("Primary Brokerage"),
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

const SafeHttpsUrlSchema = z
  .string()
  .trim()
  .max(400)
  .refine((u) => u.startsWith("https://"), { message: "source_url must start with https://" });

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
});

export type HypothesisRecord = z.infer<typeof HypothesisSchema>;

export const ThesisTestRecordSchema = z.object({
  ticker: TickerSchema,
  tested_at: z.string().trim().min(1).max(64),
  verdict: VerdictSchema,
  kill_switch_triggered: z.boolean().default(false),
  summary: z.string().trim().min(1).max(600),
  bear_case: z.string().trim().max(600).optional(),
  hypotheses_tested: z.array(HypothesisSchema).max(12).default([]),
  price_at_test: NonNegativeNumber.nullable().optional(),
  currency: CurrencySchema.optional(),
});

export type ThesisTestRecord = z.infer<typeof ThesisTestRecordSchema>;

export const ThesisUpdateSchema = z.object({
  ticker: TickerSchema,
  role: z.string().trim().min(1).max(80).optional(),
  yf_symbol: z.string().trim().min(1).max(24).optional(),
  currency: CurrencySchema.optional(),
  us_situs: z.boolean().optional(),
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
  core_thesis: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
  kill_switches: z.array(z.string().trim().min(1).max(400)).max(8).optional(),
  decision_log_note: z.string().trim().max(4000).optional(),
});

export type ThesisUpdateInput = z.infer<typeof ThesisUpdateSchema>;

export interface EtfMetadata {
  isin?: string;
  domicile?: string;
  us_situs?: boolean;
  ocf_pct?: number;
  us_weight?: number;
  other_semis_residual?: number;
}

export interface EtfWeightsConfig {
  as_of?: string;
  note?: string;
  etf_weights: Record<string, Record<string, number | string>>;
  etf_metadata: Record<string, EtfMetadata>;
}

export function defaultProfile(): UserProfile {
  return ProfileSchema.parse({});
}
