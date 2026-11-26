import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

type DossierTier = "active" | "bench" | "passed";
type ActionVerdict = "GO" | "WAIT" | "PASS";
type ProvenanceSourceKind = "sec" | "ibkr" | "model" | "market" | "report";

interface RiskCapRule {
  id: string;
  label: string;
  kind: string;
  cap_pct: number;
  ticker?: string;
  tickers?: string[];
}

interface BenchmarkConfig {
  ticker: string;
  yf_symbol: string;
  label: string;
  expected_cagr_pct: number;
  alpha_buffer_pct: number;
  estate_tax_drag_mode?: "hedge" | "amortized";
  estate_tax_hedge_bps?: number;
  estate_tax_amortize_years: number;
  estate_tax_annual_drag_pct: number | null;
  core_active_cap: number;
}

interface UserProfile {
  base_currency: string;
  timezone: string;
  custody_label: string;
  benchmark?: BenchmarkConfig;
  tax_profile: {
    country_code: string;
    nra_us_estate_tax_enabled: boolean;
    us_dividend_wht_pct: number;
    ucits_dividend_wht_pct: number;
    cgt_pct: number;
  };
  external_exposure: {
    enabled: boolean;
    label: string;
    ticker: string | null;
    amount_base: number;
    vested_pct: number | null;
    us_situs: boolean;
    sector_tags: string[];
    paired_label?: string;
    paired_tickers?: string[];
  };
  liquidity_reserve: {
    enabled: boolean;
    label: string;
    amount_base: number;
    horizon_months: number | null;
  };
  risk_caps: RiskCapRule[];
}

interface PositionRow {
  ticker: string;
  yf_symbol: string;
  name: string;
  asset_type: string;
  currency: string;
  qty: number;
  avg_cost: number;
  price: number;
  regular_price?: number;
  extended_price?: number | null;
  market_state?: string | null;
  quote_time?: string | null;
  stale: boolean;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  mv_trading: number;
  mv_usd: number;
  mv_base: number;
  pnl_trading: number;
  weight_nav_pct: number;
  pnl_pct: number;
  us_situs: boolean;
  domicile: string;
}

interface LookthroughRow {
  name: string;
  direct_usd: number;
  via_etfs_usd: number;
  total_usd: number;
  total_base: number;
  pct_nav: number;
}

interface RiskCapRow {
  id: string;
  label: string;
  value_pct: number;
  cap_pct: number;
  status: "PASS" | "BREACH";
}

interface HypothesisRule {
  source: "xbrl" | "edgar" | "market" | "insiders";
  metric: string;
  op: "<=" | "<" | ">=" | ">" | "==";
  threshold: number;
  period: "latest_q" | "ttm" | "latest_fy";
}

interface HypothesisAutoEval {
  observed: number | null;
  period: string | null;
  passed: boolean | null;
  detail: string;
  source: "xbrl" | "edgar" | "market" | "insiders";
}

interface HypothesisRow {
  id: string;
  claim: string;
  metric?: string;
  status: "untested" | "supported" | "weakened" | "falsified";
  confidence: "low" | "medium" | "high";
  evidence?: string;
  last_tested?: string | null;
  source_url?: string | null;
  is_core?: boolean;
  waiver_reason?: string | null;
  waiver_expires?: string | null;
  rule?: HypothesisRule | null;
  auto_eval?: HypothesisAutoEval | null;
  observed_breach_softened?: boolean;
}

interface ThesisTestRow {
  ticker: string;
  tested_at: string;
  event_type?: "thesis_test" | "rule_change";
  verdict: "HIGH_CONVICTION" | "WATCH" | "PROBATION" | "EXIT";
  action_verdict?: ActionVerdict | null;
  kill_switch_triggered: boolean;
  summary: string;
  bear_case?: string;
  hypotheses_tested: HypothesisRow[];
  price_at_test?: number | null;
  benchmark_price_at_test?: number | null;
  currency?: string;
}

interface ProvenanceSource {
  label: string;
  kind: ProvenanceSourceKind;
  date?: string | null;
  url?: string | null;
}

interface ThesisProvenance {
  last_audited_date: string | null;
  price_at_audit: number | null;
  live_price: number | null;
  price_drift_pct: number | null;
  price_drift_alert: boolean;
  newer_sec_filing: { form: string; filingDate: string; url: string } | null;
  theme_updated_after_audit?: boolean;
  needs_retest: boolean;
  retest_reasons: string[];
  sources: ProvenanceSource[];
}

interface AfterTaxHurdleInfo {
  benchmark_ticker: string;
  benchmark_label: string;
  benchmark_cagr_pct: number;
  alpha_buffer_pct: number;
  hurdle_cagr_pct: number;
  us_situs: boolean;
  dividend_yield_pct: number;
  accumulating?: boolean;
  effective_wht_pct?: number;
  estate_tax_drag_mode?: "hedge" | "amortized";
  div_wht_drag_pct: number;
  estate_tax_drag_pct: number;
  total_tax_drag_pct: number;
  required_gross_cagr_pct: number;
}

interface ScenarioCaseEval {
  label: "bear" | "base" | "bull";
  probability: number;
  target_price_5y: number;
  multiple: number | null;
  metric_cagr_pct: number | null;
  summary: string;
  gross_cagr_pct: number;
  after_tax_cagr_pct: number;
}

interface ScenarioSummary {
  horizon_years: number;
  price_used: number;
  tax_info: AfterTaxHurdleInfo;
  cases: {
    bear: ScenarioCaseEval;
    base: ScenarioCaseEval;
    bull: ScenarioCaseEval;
  };
  expected_price_5y: number;
  expected_gross_cagr_pct: number;
  expected_after_tax_cagr_pct: number;
  standalone_kelly_cagr_pct?: number;
  dispersion_drag_bps?: number;
  valuation_warnings?: string[];
  spread_vs_benchmark_pct: number;
  spread_vs_hurdle_pct: number;
  beats_hurdle: boolean;
}

interface ReverseDcfSummary {
  basis: "fcf" | "eps";
  horizon_years: number;
  price_used: number;
  required_gross_cagr_pct: number;
  hurdle_cagr_pct: number;
  total_tax_drag_pct: number;
  implied_target_price_5y: number;
  exit_multiple: number;
  current_multiple?: number | null;
  net_cash_b?: number | null;
  annual_dilution_pct?: number;
  implied_current_margin_pct?: number | null;
  multiple_expansion_cagr_pct?: number | null;
  margin_expansion_cagr_pct?: number | null;
  residual_revenue_cagr_pct?: number | null;
  constant_mult_margin_rev_cagr_pct?: number | null;
  metric_basis_note?: string | null;
  current_metric_per_share: number;
  implied_metric_per_share_5y: number;
  implied_metric_cagr_pct: number;
  implied_revenue_5y_b: number | null;
  implied_revenue_cagr_pct: number | null;
  base_revenue_cagr_pct: number | null;
  revenue_cagr_gap_pct: number | null;
  consensus_rev_growth_pct?: number | null;
  expectations_gap_vs_consensus_pct?: number | null;
  target_margin_pct: number | null;
  linked_hypothesis_ids: string[];
  notes: string | null;
}

interface DipTriageTranche {
  label: string;
  price: number;
  pct_of_add: number;
  amount_base: number;
  note?: string;
}

interface DipTriageResult {
  readiness: "READY" | "GATED" | "WAIT" | "REENTRY_ALERT" | "PASSED" | "CAP_BLOCKED";
  risk_cap_check: {
    status: "PASS" | "WARN" | "FAIL";
    current_weight_pct: number;
    effective_cap_pct: number | null;
    room_pct: number;
    single_name_room_pct?: number;
    portfolio_cap_room_pct?: number;
    available_funding_base?: number;
    room_base: number;
    room_usd: number;
    note: string;
  };
  gate_check: {
    status: "PASS" | "BLOCKED";
    reason: string;
  };
  hurdle_check: {
    status: "PASS" | "FAIL" | "UNMODELED" | "CORE_ANCHOR";
    expected_after_tax_cagr_pct: number | null;
    hurdle_cagr_pct: number | null;
    spread_vs_hurdle_pct: number | null;
    note: string;
  };
  tranche_plan: DipTriageTranche[];
  high_vol_staged?: boolean;
  reentry_alert: boolean;
}

interface ValuationBandStat {
  current: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  samples: number;
}

interface ValuationBands {
  pe: ValuationBandStat | null;
  pfcf: ValuationBandStat | null;
  ps: ValuationBandStat | null;
  as_of?: string | null;
}

interface FundamentalsPeriod {
  period_end: string;
  filed_date?: string | null;
  fiscal_year?: number | null;
  fiscal_period: string;
  form?: string;
  revenue_m?: number | null;
  gross_profit_m?: number | null;
  operating_income_m?: number | null;
  net_income_m?: number | null;
  ocf_m?: number | null;
  capex_m?: number | null;
  fcf_m?: number | null;
  sbc_m?: number | null;
  diluted_shares_m?: number | null;
  eps_diluted?: number | null;
  net_cash_b?: number | null;
  owner_earnings_m?: number | null;
  owner_earnings_margin_pct?: number | null;
  roic_pct?: number | null;
  accruals_ratio_pct?: number | null;
  gross_margin_pct?: number | null;
  operating_margin_pct?: number | null;
  fcf_margin_pct?: number | null;
  ocf_to_ni_pct?: number | null;
  sbc_pct_rev?: number | null;
  dso_days?: number | null;
  dio_days?: number | null;
}

interface FundamentalsRatios {
  gross_margin_pct?: number | null;
  operating_margin_pct?: number | null;
  dso_days?: number | null;
  dio_days?: number | null;
  ocf_to_ni_pct?: number | null;
  fcf_margin_pct?: number | null;
  owner_earnings_margin_pct?: number | null;
  sbc_pct_rev?: number | null;
  roic_pct?: number | null;
  incremental_roic_pct?: number | null;
  accruals_ratio_pct?: number | null;
  quality_grade?: "A" | "B" | "C" | "D" | null;
  quality_flags?: string[];
  net_cash_b?: number | null;
  diluted_shares_yoy_pct?: number | null;
  ttm_eps?: number | null;
  ttm_fcf_per_share?: number | null;
  ttm_owner_earnings_per_share?: number | null;
  ttm_rev_per_share?: number | null;
}

interface DossierFundamentals {
  ticker: string;
  cik?: string | null;
  updated_at: string;
  source: "sec_xbrl" | "manual" | "hybrid";
  currency: string;
  latest_periodic_accession?: string | null;
  quarterly: FundamentalsPeriod[];
  annual: FundamentalsPeriod[];
  latest_ratios: FundamentalsRatios;
  overrides?: Record<string, number | string | null>;
}

interface InsiderWindow {
  disc_buy_usd: number;
  disc_sell_usd: number;
  plan_sell_usd: number;
  distinct_buyers: number;
  distinct_sellers: number;
}

interface InsiderFilingRow {
  filing_date: string;
  accession: string;
  form: string;
  owner_name: string;
  title: string;
  is_director: boolean;
  code: string;
  shares: number;
  price: number | null;
  value_usd: number;
  is_10b5_1: boolean;
  url?: string | null;
}

interface DossierInsiders {
  ticker: string;
  cik?: string | null;
  updated_at: string;
  window_90d: InsiderWindow;
  window_12m: InsiderWindow;
  flags: string[];
  recent_filings: InsiderFilingRow[];
}

interface IntelHistoryEntry {
  recorded_at: string;
  provider: string;
  period?: string | null;
  eps_actual?: number | null;
  eps_est?: number | null;
  rev_actual_b?: number | null;
  rev_est_b?: number | null;
  implied_move_pct?: number | null;
  iv_30d_pct?: number | null;
  iv_pct_52w?: number | null;
  headline?: string | null;
}

interface ThemeExposure {
  ticker: string;
  stance: "beneficiary" | "hedged_tollbooth" | "at_risk" | "watch";
  note: string;
}

interface ThemeSignpost {
  id: string;
  metric: string;
  threshold?: string;
  status: "watching" | "confirmed" | "falsified";
  evidence?: string | null;
  last_checked?: string | null;
}

interface ThemeObject {
  slug: string;
  title: string;
  updated_at: string;
  relationship_mode: "zero_sum" | "symbiotic" | "cyclical" | "structural";
  summary: string;
  shared_assumptions: string[];
  exposures: ThemeExposure[];
  signposts: ThemeSignpost[];
  sources: ProvenanceSource[];
}

interface ThemeDetail {
  slug: string;
  theme: ThemeObject | null;
  memo_md: string | null;
  linked_theses: Array<{
    ticker: string;
    stance: ThemeExposure["stance"];
    note: string;
    tier: DossierTier | null;
    verdict: string | null;
    price: number | null;
    currency: string;
    needs_retest: boolean;
  }>;
}

interface MacroRegime {
  updated_at: string;
  vix: number | null;
  us10y_pct: number | null;
  us3m_pct: number | null;
  hy_credit_ratio: number | null;
  dxy: number | null;
  regime_label: "CALM" | "ELEVATED" | "HIGH_VOL" | "STRESS";
  notes?: string | null;
}

interface WatchdogAlert {
  id: string;
  detected_at: string;
  severity: "high" | "medium" | "info";
  kind: string;
  ticker?: string | null;
  theme_slug?: string | null;
  title: string;
  detail: string;
  acknowledged: boolean;
}

interface SecRedFlag {
  ticker: string;
  form: string;
  filingDate: string;
  accession: string;
  code: string;
  severity: "high" | "medium" | "info";
  label: string;
  items?: string;
  url: string;
}

interface TaxSwapItem {
  ticker: string;
  target_ticker: string;
  shares: number;
  price_trading: number;
  currency: string;
  proceeds_usd: number;
  proceeds_base: number;
  estate_tax_saved_base: number;
  annual_wht_saved_base: number;
  auto_cured_caps: string[];
  rationale: string;
}

interface MandatoryExitItem {
  ticker: string;
  tier: DossierTier;
  verdict: string | null;
  reason: string;
  shares: number;
  price_trading: number;
  currency: string;
  proceeds_usd: number;
  proceeds_base: number;
  weight_nav_pct: number;
}

interface CapTrimItem {
  cap_id: string;
  cap_label: string;
  ticker: string;
  current_pct: number;
  cap_pct: number;
  excess_pct: number;
  shares_to_trim: number;
  proceeds_usd: number;
  proceeds_base: number;
  note: string;
}

interface CapitalRotationQueue {
  tax_swaps: TaxSwapItem[];
  mandatory_exits: MandatoryExitItem[];
  cap_trims: CapTrimItem[];
  total_swap_base: number;
  total_freed_base: number;
  total_estate_tax_saved_base: number;
}

interface ThesisIntelSummary {
  updated_at: string;
  provider: string;
  earnings_badge: string | null;
  implied_move_pct: number | null;
  options_expiry: string | null;
  themes: string[];
}

interface ThesisRow {
  ticker: string;
  yf_symbol: string;
  currency: string;
  role: string;
  us_situs: boolean;
  tier: DossierTier;
  action_verdict: ActionVerdict;
  takeaway: string[];
  rejection_reason: string | null;
  reentry_trigger: string | null;
  reentry_price: number | null;
  reentry_alert: boolean;
  price: number | null;
  regular_price?: number | null;
  extended_price?: number | null;
  market_state?: string | null;
  quote_time?: string | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  cached_price: number | null;
  price_base: number | null;
  stale: boolean;
  sparkline: number[];
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  buy_zone_low: number | null;
  buy_zone_high: number | null;
  trim_zone: number | null;
  max_weight_pct: number | null;
  gated: boolean;
  status: string;
  next_catalyst_date: string | null;
  next_catalyst: string | null;
  core_summary: string[];
  kill_switches: string[];
  latest_decision: string;
  verdict: string | null;
  bear_case_summary: string | null;
  last_tested_date: string | null;
  hypotheses: HypothesisRow[];
  hypothesis_counts: {
    total: number;
    supported: number;
    weakened: number;
    falsified: number;
    untested: number;
  };
  softening_warnings?: string[];
  recent_tests: ThesisTestRow[];
  recent_rule_changes?: ThesisTestRow[];
  theme_refs?: string[];
  provenance?: ThesisProvenance;
  scenario_summary?: ScenarioSummary | null;
  reverse_dcf?: ReverseDcfSummary | null;
  dip_triage?: DipTriageResult;
  has_memo?: boolean;
  has_model?: boolean;
  has_intel?: boolean;
  has_fundamentals?: boolean;
  has_insiders?: boolean;
  fundamentals_summary?: {
    updated_at: string;
    period_end: string | null;
    currency: string;
    latest_ratios: FundamentalsRatios;
  } | null;
  insiders_summary?: {
    updated_at: string;
    window_90d: InsiderWindow;
    window_12m: InsiderWindow;
    flags: string[];
  } | null;
  valuation_bands?: ValuationBands | null;
  intel_summary?: ThesisIntelSummary | null;
}

interface ScenarioCaseInput {
  probability: number;
  target_price_5y: number;
  multiple?: number | null;
  metric_cagr_pct?: number | null;
  summary: string;
}

interface DossierModel {
  as_of?: string;
  horizon_years: number;
  dividend_yield_pct: number;
  reverse_dcf?: Record<string, unknown> | null;
  scenarios?: {
    bear: ScenarioCaseInput;
    base: ScenarioCaseInput;
    bull: ScenarioCaseInput;
  } | null;
  tranches?: Array<{ label: string; price: number; pct_of_add: number; note?: string }>;
}

interface DossierIntel {
  updated_at: string;
  provider: string;
  contract_id?: number | string | null;
  earnings_insight?: {
    period?: string;
    published_at?: string;
    kind: "preview" | "recap" | "summary";
    headline?: string;
    summary: string;
    key_metrics: string[];
    source_url?: string | null;
  } | null;
  options_intel?: {
    as_of?: string;
    underlying_price?: number | null;
    expiry: string;
    atm_strike?: number | null;
    straddle_price?: number | null;
    implied_move_pct: number;
    call_iv_pct?: number | null;
    put_iv_pct?: number | null;
    iv_skew_pct?: number | null;
    iv_percentile_52w?: number | null;
    note?: string;
  } | null;
  consensus?: {
    as_of?: string;
    ntm_rev_b?: number | null;
    ntm_rev_growth_pct?: number | null;
    ntm_eps?: number | null;
    fy1_eps_est?: number | null;
    fy2_eps_est?: number | null;
    eps_revision_90d_pct?: number | null;
    target_price_mean?: number | null;
    analyst_count?: number | null;
  } | null;
  themes: string[];
  connections: Array<{ ticker?: string; name: string; relation: string }>;
}

interface DossierDetail {
  ticker: string;
  memo_md: string | null;
  model: DossierModel | null;
  intel: DossierIntel | null;
  fundamentals?: DossierFundamentals | null;
  insiders?: DossierInsiders | null;
  intel_history?: IntelHistoryEntry[];
  valuation_bands?: ValuationBands | null;
  linked_themes?: ThemeObject[];
  thesis: ThesisRow | null;
}

interface DipTriageQueueRow {
  ticker: string;
  tier: DossierTier;
  action_verdict: ActionVerdict;
  status: string;
  readiness: DipTriageResult["readiness"];
  price: number | null;
  currency: string;
  buy_zone_low: number | null;
  buy_zone_high: number | null;
  reentry_price: number | null;
  reentry_alert: boolean;
  cap_status: "PASS" | "WARN" | "FAIL";
  single_name_room_pct?: number;
  portfolio_cap_room_pct?: number;
  available_funding_base?: number;
  high_vol_staged?: boolean;
  gate_status: "PASS" | "BLOCKED";
  hurdle_status: "PASS" | "FAIL" | "UNMODELED" | "CORE_ANCHOR";
  spread_vs_hurdle_pct: number | null;
  next_tranche_price: number | null;
  next_tranche_base: number | null;
}

interface ForwardScorecardEntry {
  ticker: string;
  tested_at: string;
  test_date: string;
  verdict: string;
  action_verdict?: ActionVerdict | null;
  maturity?: "PENDING" | "MATURED";
  hit?: boolean | null;
  summary: string;
  price_at_test: number;
  current_price: number | null;
  currency: string;
  stock_return_pct: number | null;
  benchmark_return_pct: number | null;
  alpha_pct: number | null;
  days_elapsed: number;
}

interface VerdictScorecardSummary {
  verdict: string;
  count: number;
  evaluated_count: number;
  pending_count?: number;
  avg_return_pct: number | null;
  avg_alpha_pct: number | null;
  hit_rate_pct: number | null;
}

interface ScorecardHorizonBucket {
  horizon: "90d" | "180d" | "1Y";
  min_days: number;
  count: number;
  avg_alpha_pct: number | null;
  hit_rate_pct: number | null;
}

interface BrierCalibrationTier {
  confidence: "high" | "medium" | "low";
  predicted_prob: number;
  resolved_count: number;
  supported_count: number;
  falsified_count: number;
  empirical_rate_pct: number | null;
  brier_score: number | null;
}

interface BrierCalibrationSummary {
  resolved_total: number;
  overall_brier_score: number | null;
  tiers: BrierCalibrationTier[];
}

interface ForwardScorecardResult {
  benchmark_symbol: string;
  total_tests: number;
  priced_tests: number;
  pending_count?: number;
  matured_count?: number;
  entries: ForwardScorecardEntry[];
  by_verdict: VerdictScorecardSummary[];
  horizon_buckets?: ScorecardHorizonBucket[];
  brier_calibration?: BrierCalibrationSummary;
}

interface PaPerformanceState {
  updated_at: string;
  provider: string;
  base_currency?: string;
  periods: Array<{
    period: string;
    twr_pct?: number | null;
    mwr_pct?: number | null;
    benchmark_pct?: number | null;
    start_date?: string | null;
    end_date?: string | null;
  }>;
  note?: string;
}

interface BacktestSeriesMetrics {
  cagr_pct: number;
  total_return_pct: number;
  volatility_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  sharpe_se?: number | null;
  deflated_sharpe_prob_pct?: number;
  sortino: number;
  cvar_95_weekly_pct?: number;
  skewness?: number;
  excess_kurtosis?: number;
  rebalance_count?: number;
  total_turnover_pct?: number;
  tx_cost_drag_bps?: number;
  rolling_3y_cagr_min_pct: number | null;
  rolling_3y_cagr_median_pct: number | null;
  rolling_3y_cagr_max_pct: number | null;
}

interface BacktestRegimeRow {
  id: string;
  label: string;
  start: string;
  end: string;
  weeks: number;
  baseline_cagr_pct: number;
  simulated_cagr_pct: number;
  baseline_dd_pct: number;
  simulated_dd_pct: number;
}

interface BacktestEquityPoint {
  date: string;
  baseline_idx: number;
  simulated_idx: number;
  benchmark_idx: number;
}

interface BacktestResult {
  candidate_ticker: string;
  candidate_yf_symbol: string;
  benchmark_symbol: string;
  target_weight_pct: number;
  funding_source: string;
  rebalance_band_pct: number;
  rf_pct?: number;
  tx_cost_bps?: number;
  trials_tested?: number;
  sr0_annual_threshold?: number;
  include_external_wealth?: boolean;
  fx_converted_tickers?: string[];
  overlap_start: string;
  overlap_end: string;
  weeks_analyzed: number;
  caveat: string;
  data_sources: Record<string, string>;
  baseline: BacktestSeriesMetrics;
  simulated: BacktestSeriesMetrics;
  benchmark: BacktestSeriesMetrics;
  deltas: {
    cagr_pct: number;
    max_drawdown_pct: number;
    sharpe: number;
    sortino: number;
  };
  candidate_corr_portfolio: number | null;
  candidate_corr_cluster: number | null;
  top_correlations: Array<{ ticker: string; corr: number }>;
  regimes: BacktestRegimeRow[];
  equity_curve: BacktestEquityPoint[];
}

interface DashboardLabSection {
  benchmark_summary: AfterTaxHurdleInfo;
  active_count: number;
  active_cap: number;
  bench_count: number;
  passed_count: number;
  needs_retest_count: number;
  reentry_alert_count: number;
  dip_triage_queue: DipTriageQueueRow[];
  scorecard: ForwardScorecardResult;
  pa_performance: PaPerformanceState | null;
  last_backtest_tickers: string[];
  latest_backtest: BacktestResult | null;
}

interface CatalystRow {
  date: string;
  ticker: string;
  title: string;
  detail: string;
  urgency: string;
}

interface SecGateEval {
  ticker: string;
  form: string;
  filed_after: string;
  description: string;
  cleared: boolean;
  latest_matching_date?: string;
  latest_matching_url?: string;
}

interface EdgarFiling {
  form: string;
  filingDate: string;
  accession: string;
  items?: string;
  url: string;
}

interface ForecastYearPoint {
  year: number;
  p10_base: number;
  p25_base: number;
  p50_base: number;
  p75_base: number;
  p90_base: number;
  mean_base: number;
}

interface LatentRiskFactor {
  id: string;
  variance_share_pct: number;
  eigenvalue_share_pct: number;
  top_tickers: string[];
  label: string;
}

interface FactorRiskDecomposition {
  effective_bets: number;
  asset_count: number;
  market_beta: number | null;
  systematic_risk_pct: number | null;
  idiosyncratic_risk_pct: number | null;
  top_factors: LatentRiskFactor[];
}

interface BlackLittermanResult {
  tau: number;
  risk_aversion_delta: number;
  brier_score_used: number | null;
  brier_resolved_count: number;
  brier_omega_multiplier: number;
  note: string;
}

interface ForecastPathSummary {
  starting_wealth_base: number;
  ending_cvar_10_base?: number;
  ending_p10_base: number;
  ending_p50_base: number;
  ending_p90_base: number;
  ending_mean_base: number;
  expected_cagr_p50_pct: number;
  p10_cagr_pct: number;
  p90_cagr_pct: number;
  sim_max_dd_p50_pct?: number;
  sim_max_dd_p95_pct?: number;
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
  factor_risk?: FactorRiskDecomposition;
  trajectory: ForecastYearPoint[];
}

interface ForecastPositionSizingRow {
  ticker: string;
  is_external: boolean;
  is_cash: boolean;
  before_value_base: number;
  after_value_base: number;
  before_weight_pct: number;
  after_weight_pct: number;
  expected_cagr_pct: number;
  prior_cagr_pct?: number;
  raw_view_cagr_pct?: number | null;
  bl_shrinkage_pct?: number;
  annual_vol_pct: number;
  return_source: string;
  marginal_risk_contrib_pct: number;
  corr_with_portfolio: number;
  corr_adjusted_hurdle_pct: number;
  quarter_kelly_weight_pct: number;
  hrp_weight_pct?: number;
  quality_grade?: "A" | "B" | "C" | "D" | null;
}

interface ForecastAppliedActionLog {
  label: string;
  type: string;
  ticker?: string;
  target_ticker?: string;
  amount_base: number;
  note?: string;
}

interface PortfolioForecastResult {
  horizon_years: number;
  base_currency: string;
  include_external_wealth: boolean;
  regime_vol_multiplier: number;
  return_model?: "black_litterman" | "raw_dossier";
  simulation_engine_requested?: "block_bootstrap" | "student_t";
  simulation_engine_used?: "block_bootstrap" | "student_t";
  block_length_weeks?: number;
  aligned_history_weeks?: number;
  simulations: number;
  rf_pct: number;
  benchmark_ticker: string;
  benchmark_cagr_pct: number;
  benchmark_ending_base: number;
  black_litterman?: BlackLittermanResult;
  baseline: ForecastPathSummary;
  simulated: ForecastPathSummary;
  deltas: {
    p50_base: number;
    p10_base: number;
    cvar_10_base?: number;
    p90_base: number;
    cagr_p50_pct: number;
    annual_vol_pct: number;
    sharpe: number;
    effective_bets?: number;
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

interface DashboardPayload {
  initialized: boolean;
  is_demo: boolean;
  generated_at: string;
  timezone: string;
  base_currency: string;
  mode: string;
  active_tab?: TabId;
  usd_to_base_fx: number;
  vix: number | null;
  vix_sparkline: number[];
  market_cache_updated_at: string | null;
  stale_tickers: string[];
  profile: UserProfile;
  portfolio: {
    as_of: string;
    source: string;
    nav_base: number;
    nav_usd: number;
    positions_base: number;
    positions_usd: number;
    cash_base: number;
    cash_pct: number;
    accruals_base: number;
    total_unrealized_pnl_usd: number;
    total_unrealized_pnl_pct: number;
    positions: PositionRow[];
  };
  summary: {
    total_liquid_wealth_base: number;
    net_investable_base: number;
    deployable_cash_base: number;
    available_funding_base?: number;
    reserve_shortfall_base: number;
    ext_total_base: number;
    ext_pct_wealth: number;
    ext_portfolio_base: number;
    ext_live_marked?: boolean;
    ext_price_used?: number | null;
    paired_exposure_base: number;
    paired_exposure_pct_wealth: number;
    paired_label: string;
    primary_bucket_label: string | null;
    primary_bucket_portfolio_base: number;
    primary_bucket_portfolio_pct: number;
    primary_bucket_tw_pct: number;
    ext_included_in_primary_bucket: boolean;
    us_situs_enabled: boolean;
    us_situs_portfolio_usd: number;
    us_situs_portfolio_pct: number;
    us_situs_stocks_usd: number;
    portfolio_estate_tax_base: number;
    total_us_situs_usd: number;
    total_estate_tax_base: number;
    estate_tax_marginal_pct: number;
    ucits_swap_savings_base: number;
  };
  lookthrough: LookthroughRow[];
  risk_caps: RiskCapRow[];
  theses: ThesisRow[];
  catalysts: CatalystRow[];
  edgar: {
    checked_at: string | null;
    gate_evaluations: SecGateEval[];
    filings_by_ticker: Record<string, EdgarFiling[]>;
  };
  macro_regime?: MacroRegime | null;
  rotation_queue?: CapitalRotationQueue;
  themes?: ThemeObject[];
  alerts?: WatchdogAlert[];
  sec_red_flags?: SecRedFlag[];
  forecast?: PortfolioForecastResult | null;
  lab?: DashboardLabSection;
}

type TabId = "overview" | "forecast" | "holdings" | "theses" | "edgar" | "lab";
type SortKey = "ticker" | "mv_base" | "weight_nav_pct" | "pnl_pct" | "change_1d_pct";
type HoldingsMode = "positions" | "lookthrough";
type TierFilter = "active" | "bench" | "passed" | "all";
type ThesisSubFilter = "all" | "buy" | "gated" | "trim" | "retest";
type InspectorTabId = "summary" | "memo" | "valuation" | "signals";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "forecast", label: "Forecast" },
  { id: "holdings", label: "Holdings" },
  { id: "theses", label: "Research" },
  { id: "edgar", label: "SEC & Alerts" },
  { id: "lab", label: "Lab" },
];

const SLICE_PALETTE = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
  "var(--viz-8)",
];

const app = new App({ name: "Investment OS", version: "0.7.0" }, {});
let state: DashboardPayload | null = null;
let activeTab: TabId = "overview";
let hostCaps: McpUiHostCapabilities | undefined;
let busyMessage = "";
let toastMessage = "";
let heroMode: "portfolio" | "total" = "portfolio";
let holdingsMode: HoldingsMode = "positions";
let sortKey: SortKey = "mv_base";
let sortAsc = false;
let searchQuery = "";
let thesisTier: TierFilter = "active";
let thesisFilter: ThesisSubFilter = "all";
let muteVolNoise = false;
let simExtBase = 0;
let simReserveBase = 0;
let inspectorTicker: string | null = null;
let inspectorThemeSlug: string | null = null;
let inspectorTab: InspectorTabId = "summary";
let inspectorLoading = false;
let inspectorRefineOpen = false;
let inspectorSendMode: "background" | "here" = "background";
let pendingUngateConfirm = false;
const dossierCache = new Map<string, DossierDetail>();
const themeCache = new Map<string, ThemeDetail>();
let backtestResult: BacktestResult | null = null;
let backtestBusy = false;
let backtestError = "";
let btTicker = "";
let btWeight = 5;
let btFunding = "cash";
let btBand = 25;
let btIncludeExternal = true;
let btTxCostBps = 10;
let btTrialsTested = 0; // 0 = auto (total dossiers)
let forecastResult: PortfolioForecastResult | null = null;
let forecastBusy = false;
let forecastError = "";
let forecastHorizon = 5;
let forecastVolMult = 1.0;
let forecastReturnModel: "black_litterman" | "raw_dossier" = "black_litterman";
let forecastSimEngine: "block_bootstrap" | "student_t" = "block_bootstrap";
let forecastIncludeExt = true;
let forecastParkCash = false;
const forecastDisabledRotations = new Set<string>();
let forecastPlannedBuys: Array<{ id: string; ticker: string; amount_base: number }> = [];
let forecastBuyTicker = "";
let forecastBuyAmount = 25000;
let hasInitializedFromResult = false;
let svgIdSeq = 0;
let supportsDisplayTransitionCache: boolean | undefined;

function esc(val: unknown): string {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(n: number | null | undefined, currencyCode = "USD", digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "N/A";
  const code = (currencyCode || "USD").toUpperCase();
  const absFormatted = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = n < 0 ? "-" : "";
  if (code === "USD") return `${sign}$${absFormatted}`;
  if (code === "SGD") return `${sign}S$${absFormatted}`;
  if (code === "EUR") return `${sign}€${absFormatted}`;
  if (code === "GBP") return `${sign}£${absFormatted}`;
  if (code === "JPY") return `${sign}¥${absFormatted}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${sign}${code} ${absFormatted}`;
  }
}

function fmtCompact(n: number, ccy: string): string {
  if (Math.abs(n) >= 1_000_000) return `${fmtMoney(n / 1_000_000, ccy, 1)}M`;
  if (Math.abs(n) >= 1_000) return `${fmtMoney(n / 1_000, ccy, 0)}K`;
  return fmtMoney(n, ccy, 0);
}

function fmtHeaderTimestamp(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(dt);
  } catch {
    return isoStr.slice(0, 16).replace("T", " ");
  }
}

function cleanAlertTitle(title: string, ticker?: string | null): string {
  const trimmed = title.trim();
  if (!ticker) return trimmed;
  const sym = ticker.trim().toUpperCase();
  // Strip duplicated prefix like "NVDA · NVDA Rule Breached" or "NVDA - NVDA ..."
  const dupPrefix = new RegExp(`^${sym}\\s*[·:-]\\s*${sym}\\s+`, "i");
  if (dupPrefix.test(trimmed)) {
    return `${sym} · ${trimmed.replace(dupPrefix, "")}`;
  }
  const singlePrefix = new RegExp(`^${sym}\\s+`, "i");
  if (singlePrefix.test(trimmed)) {
    return `${sym} · ${trimmed.replace(singlePrefix, "")}`;
  }
  return trimmed;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
}

function fmtSignedPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtDeltaText(pct: number | null | undefined, suffix = "", respectNoiseMute = false): string {
  if (respectNoiseMute && muteVolNoise) {
    return `<span class="noise-muted" title="1D% &amp; cost-basis noise muted">Muted</span>`;
  }
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return `<span class="delta-text muted-sub">—</span>`;
  }
  const cls = pct > 0.01 ? "pos-ok" : pct < -0.01 ? "pos-bad" : "muted-sub";
  const prefix = pct > 0.01 ? "+" : "";
  return `<span class="delta-text ${cls}">${prefix}${pct.toFixed(2)}%${suffix ? ` ${esc(suffix)}` : ""}</span>`;
}

function fmtDeltaTag(pct: number | null | undefined, suffix = "", respectNoiseMute = false): string {
  if (respectNoiseMute && muteVolNoise) {
    return `<span class="status-tag quiet"><span class="dot"></span>Muted${suffix ? ` ${esc(suffix)}` : ""}</span>`;
  }
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return `<span class="status-tag quiet"><span class="dot"></span>—</span>`;
  }
  const dotCls = pct > 0.01 ? "ok" : pct < -0.01 ? "bad" : "";
  const prefix = pct > 0.01 ? "+" : "";
  return `<span class="status-tag"><span class="dot ${dotCls}"></span>${prefix}${pct.toFixed(2)}%${suffix ? ` ${esc(suffix)}` : ""}</span>`;
}

function computeUsEstateTaxUsd(usSitusUsd: number): { netTaxUsd: number; marginalPct: number } {
  if (usSitusUsd <= 60000) return { netTaxUsd: 0, marginalPct: 0 };
  const brackets: [number, number][] = [
    [10000, 0.18],
    [20000, 0.2],
    [40000, 0.22],
    [60000, 0.24],
    [80000, 0.26],
    [100000, 0.28],
    [150000, 0.3],
    [250000, 0.32],
    [500000, 0.34],
    [750000, 0.37],
    [1000000, 0.39],
    [Number.POSITIVE_INFINITY, 0.4],
  ];
  let tentative = 0;
  let prev = 0;
  let marginal = 0.18;
  for (const [cap, rate] of brackets) {
    if (usSitusUsd > prev) {
      tentative += (Math.min(usSitusUsd, cap) - prev) * rate;
      marginal = rate;
      prev = cap;
    } else {
      break;
    }
  }
  return { netTaxUsd: Math.max(0, tentative - 13000), marginalPct: marginal * 100 };
}

function applyThemeContext(ctx?: McpUiHostContext): void {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.dataset.theme = ctx.theme;
    document.documentElement.style.colorScheme = ctx.theme;
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

function qualityGradeBadge(grade: "A" | "B" | "C" | "D" | null | undefined, compact = false): string {
  if (!grade) return "";
  const cls = grade === "A" ? "q-a" : grade === "B" ? "q-b" : grade === "C" ? "q-c" : "q-d";
  const tip =
    grade === "A"
      ? "Quality Grade A — Strong ROIC, Owner Earnings (FCF-SBC), and cash-backed accruals"
      : grade === "B"
        ? "Quality Grade B — Solid capital returns and cash conversion"
        : grade === "C"
          ? "Quality Grade C — Mixed capital efficiency or elevated SBC/accruals"
          : "Quality Grade D — Weak Owner Earnings, low ROIC, or aggressive accruals";
  return `<span class="quality-pill ${cls}" title="${esc(tip)}">${compact ? grade : `Q:${grade}`}</span>`;
}

function isRoutineNoiseAlert(a: WatchdogAlert): boolean {
  if (a.severity === "info") return true;
  if (a.kind === "sec_red_flag" && (a.id.includes(":8-K:5.02:") || a.title.includes("8-K:5.02"))) return true;
  return false;
}

function actionVerdictPill(v: ActionVerdict | string | null | undefined): string {
  const up = (v || "WAIT").toUpperCase();
  if (up === "GO") return `<span class="verdict-pill verdict-go">GO</span>`;
  if (up === "PASS") return `<span class="verdict-pill verdict-pass">PASS</span>`;
  return `<span class="verdict-pill verdict-wait">WAIT</span>`;
}

function verdictTag(verdict: string | null | undefined): string {
  if (!verdict) return "";
  const v = verdict.toUpperCase();
  const label = v.replace(/_/g, " ");
  if (v === "HIGH_CONVICTION") return `<span class="status-tag"><span class="dot ok"></span>${esc(label)}</span>`;
  if (v === "EXIT") return `<span class="status-tag"><span class="dot bad"></span>${esc(label)}</span>`;
  if (v === "PROBATION") return `<span class="status-tag"><span class="dot warn"></span>${esc(label)}</span>`;
  return `<span class="status-tag quiet"><span class="dot"></span>${esc(label)}</span>`;
}

function checkDotClass(status: string): "ok" | "warn" | "bad" | "" {
  const s = status.toUpperCase();
  if (s === "PASS" || s === "READY" || s === "REENTRY_ALERT" || s === "CORE_ANCHOR" || s === "CONFIRMED") return "ok";
  if (s === "WARN" || s === "BLOCKED" || s === "GATED" || s === "ELEVATED" || s === "HIGH_VOL") return "warn";
  if (s === "FAIL" || s === "CAP_BLOCKED" || s === "STRESS" || s === "FALSIFIED") return "bad";
  return "";
}

function renderExtendedPriceTag(
  regularPrice: number | null | undefined,
  extendedPrice: number | null | undefined,
  marketState: string | null | undefined,
  currency: string,
): string {
  if (extendedPrice === null || extendedPrice === undefined || !Number.isFinite(extendedPrice) || extendedPrice <= 0) {
    return "";
  }
  const reg = regularPrice ?? null;
  const st = (marketState ?? "").toUpperCase();
  const isPreOrPost = st === "PRE" || st === "PREPRE" || st === "POST" || st === "POSTPOST";
  const differs = reg !== null && Math.abs(extendedPrice - reg) > Math.max(0.005, reg * 0.0005);
  if (!isPreOrPost && !differs) return "";
  const prefix = st.startsWith("PRE") ? "Pre" : "Post";
  const pctDiff = reg && reg > 0 ? ((extendedPrice - reg) / reg) * 100 : null;
  const diffStr = pctDiff !== null ? ` (${pctDiff > 0 ? "+" : ""}${pctDiff.toFixed(1)}%)` : "";
  return `<span class="ext-price-tag" title="Extended-hours quote (${esc(prefix)})">${prefix} ${fmtMoney(extendedPrice, currency, extendedPrice < 10 ? 4 : 2)}${diffStr}</span>`;
}

function hypothesisStateBadge(status: string): string {
  if (status === "supported") return `<span class="hyp-state-supported">● Supported</span>`;
  if (status === "weakened") return `<span class="hyp-state-weakened">◐ Weakened</span>`;
  if (status === "falsified") return `<span class="hyp-state-falsified">✕ Falsified</span>`;
  return `<span class="hyp-state-untested">○ Untested</span>`;
}

function daysUntilLabel(isoDate: string): { label: string; cls: string } {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target)) return { label: isoDate, cls: "muted" };
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((target - todayUtc) / 86_400_000);
  if (diffDays === 0) return { label: "Today", cls: "bad" };
  if (diffDays > 0 && diffDays <= 14) return { label: `In ${diffDays}d`, cls: "warn" };
  if (diffDays > 14) return { label: `In ${diffDays}d`, cls: "" };
  return { label: `${Math.abs(diffDays)}d ago`, cls: "muted" };
}

/* Strictly HTML-escaped, zero-dependency Markdown renderer for primary-source memos */
function renderInlineMarkdown(rawInput: string, canOpenLinks: boolean): string {
  const raw = rawInput.replace(/\u0000/g, "");
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const idx = tokens.length;
    tokens.push(html);
    return `\u0000T${idx}\u0000`;
  };
  let s = raw.replace(/`([^`]+)`/g, (_m, inner: string) => stash(`<code>${esc(inner)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)<>"']+)\)/g, (_m, label: string, url: string) => {
    if (canOpenLinks && url.startsWith("https://")) {
      return stash(
        `<button type="button" class="small ghost open-ext-link" data-url="${esc(url)}">${esc(label)} ↗</button>`,
      );
    }
    return stash(esc(label));
  });
  s = esc(s);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s.replace(/\u0000T(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)] ?? "");
}

function splitMdTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

function isMdTableSep(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function renderSafeMarkdown(md: string, canOpenLinks: boolean): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre class="memo-pre"><code>${esc(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    const headMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headMatch) {
      const lvl = headMatch[1]!.length;
      const tag = lvl <= 2 ? "h2" : lvl === 3 ? "h3" : "h4";
      out.push(`<${tag}>${renderInlineMarkdown(headMatch[2] ?? "", canOpenLinks)}</${tag}>`);
      i += 1;
      continue;
    }

    if (trimmed.includes("|") && i + 1 < lines.length && isMdTableSep(lines[i + 1] ?? "")) {
      const headers = splitMdTableRow(trimmed);
      const aligns = splitMdTableRow(lines[i + 1] ?? "").map((c) => (c.endsWith(":") && !c.startsWith(":") ? "num" : ""));
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length) {
        const rowLine = (lines[i] ?? "").trim();
        if (!rowLine || !rowLine.includes("|")) break;
        bodyRows.push(splitMdTableRow(rowLine));
        i += 1;
      }
      const thead = `<thead><tr>${headers.map((h, idx) => `<th scope="col" class="${aligns[idx] ?? ""}">${renderInlineMarkdown(h, canOpenLinks)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map(
          (r) =>
            `<tr>${headers.map((_h, idx) => `<td class="${aligns[idx] ?? ""}">${renderInlineMarkdown(r[idx] ?? "", canOpenLinks)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`;
      out.push(`<div class="compact-table-wrap"><table class="compact-table">${thead}${tbody}</table></div>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${quoteLines.map((l) => renderInlineMarkdown(l, canOpenLinks)).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      out.push(`<ul>${items.map((it) => `<li>${renderInlineMarkdown(it, canOpenLinks)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push(`<ol>${items.map((it) => `<li>${renderInlineMarkdown(it, canOpenLinks)}</li>`).join("")}</ol>`);
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? "").trim();
      if (
        !cur ||
        cur.startsWith("```") ||
        cur.startsWith(">") ||
        /^#{1,6}\s+/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(cur) ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur) ||
        (cur.includes("|") && i + 1 < lines.length && isMdTableSep(lines[i + 1] ?? ""))
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    out.push(`<p>${renderInlineMarkdown(paraLines.join(" "), canOpenLinks)}</p>`);
  }

  return `<div class="memo-prose">${out.join("")}</div>`;
}

function renderSparklineSvg(
  points: number[],
  opts: {
    width: number;
    height: number;
    positive?: boolean | null;
    fillArea?: boolean;
    neutral?: boolean;
    label: string;
  },
): string {
  const { width, height, positive, fillArea, neutral, label } = opts;
  if (!points || points.length < 2) {
    const midY = (height / 2).toFixed(1);
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}: No 30-day trend cached"><line x1="2" y1="${midY}" x2="${width - 2}" y2="${midY}" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.2" stroke-dasharray="3 3" /></svg>`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || max * 0.02 || 1;
  const padX = 2;
  const padY = 4;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const coords = points.map((v, i) => {
    const x = padX + (i / (points.length - 1)) * plotW;
    const y = padY + (1 - (v - min) / span) * plotH;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const last = coords[coords.length - 1]!;
  const inferredUp = positive ?? points[points.length - 1]! >= points[0]!;
  const colorVar = neutral ? "var(--fg-muted)" : inferredUp ? "var(--ok)" : "var(--bad)";
  svgIdSeq += 1;
  const gradId = `sg-${svgIdSeq}`;

  const areaEl = fillArea
    ? `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${colorVar}" stop-opacity="0.11"/><stop offset="100%" stop-color="${colorVar}" stop-opacity="0"/></linearGradient></defs><path d="${linePath} L${last[0]} ${height} L${coords[0]![0]} ${height} Z" fill="url(#${gradId})" />`
    : "";

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${areaEl}<path d="${linePath}" fill="none" stroke="${colorVar}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /><circle cx="${last[0]}" cy="${last[1]}" r="2" fill="${colorVar}" /></svg>`;
}

function renderEquityCurveSvg(res: BacktestResult): string {
  const pts = res.equity_curve;
  if (!pts || pts.length < 2) {
    return `<div class="muted-sub">Insufficient overlapping price series for equity curve.</div>`;
  }
  const w = 600;
  const h = 176;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const allVals: number[] = [];
  for (const p of pts) {
    allVals.push(p.baseline_idx, p.simulated_idx, p.benchmark_idx);
  }
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const pad = Math.max(2, (rawMax - rawMin) * 0.08);
  const lo = rawMin - pad;
  const hi = rawMax + pad;
  const span = Math.max(1, hi - lo);

  const mapX = (i: number) => padL + (i / (pts.length - 1)) * plotW;
  const mapY = (v: number) => padT + (1 - (v - lo) / span) * plotH;
  const buildPath = (getter: (p: BacktestEquityPoint) => number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapX(i).toFixed(1)} ${mapY(getter(p)).toFixed(1)}`).join(" ");

  const midVal = (lo + hi) / 2;
  const yTicks = [hi, midVal, lo];
  const gridSvg = yTicks
    .map((val) => {
      const y = mapY(val).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-color)" stroke-width="1" /><text x="${padL - 6}" y="${Number(y) + 3}" text-anchor="end" fill="var(--fg-muted)" font-size="9.5" font-family="ui-monospace, monospace">${val.toFixed(0)}</text>`;
    })
    .join("");

  const midIdx = Math.floor((pts.length - 1) / 2);
  const xLabels = [
    { x: padL, text: pts[0]!.date.slice(0, 7), anchor: "start" },
    { x: mapX(midIdx), text: pts[midIdx]!.date.slice(0, 7), anchor: "middle" },
    { x: w - padR, text: pts[pts.length - 1]!.date.slice(0, 7), anchor: "end" },
  ];
  const xSvg = xLabels
    .map(
      (l) =>
        `<text x="${l.x.toFixed(1)}" y="${h - 5}" text-anchor="${l.anchor}" fill="var(--fg-muted)" font-size="9.5" font-family="ui-monospace, monospace">${esc(l.text)}</text>`,
    )
    .join("");

  const last = pts[pts.length - 1]!;
  const endX = mapX(pts.length - 1).toFixed(1);

  return `
    <div class="equity-chart-wrap">
      <svg class="equity-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Normalized growth of 100 equity curve comparing Simulated, Baseline, and Benchmark">
        ${gridSvg}
        ${xSvg}
        <path d="${buildPath((p) => p.benchmark_idx)}" fill="none" stroke="var(--viz-5)" stroke-width="1.35" stroke-dasharray="2 3" stroke-linecap="round" />
        <path d="${buildPath((p) => p.baseline_idx)}" fill="none" stroke="var(--viz-3)" stroke-width="1.65" stroke-dasharray="5 3" stroke-linecap="round" />
        <path d="${buildPath((p) => p.simulated_idx)}" fill="none" stroke="var(--fg-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${endX}" cy="${mapY(last.benchmark_idx).toFixed(1)}" r="2.2" fill="var(--viz-5)" />
        <circle cx="${endX}" cy="${mapY(last.baseline_idx).toFixed(1)}" r="2.5" fill="var(--viz-3)" />
        <circle cx="${endX}" cy="${mapY(last.simulated_idx).toFixed(1)}" r="3" fill="var(--fg-primary)" />
      </svg>
      <div class="equity-legend">
        <span class="legend-item"><span class="legend-swatch-line"></span><strong>Simulated (+${esc(res.candidate_ticker)} ${res.target_weight_pct}%)</strong> ${last.simulated_idx.toFixed(1)} (${fmtSignedPct(res.simulated.total_return_pct)})</span>
        <span class="legend-item"><span class="legend-swatch-line dashed"></span>Baseline ${last.baseline_idx.toFixed(1)} (${fmtSignedPct(res.baseline.total_return_pct)})</span>
        <span class="legend-item"><span class="legend-swatch-line dotted"></span>Benchmark (${esc(res.benchmark_symbol)}) ${last.benchmark_idx.toFixed(1)} (${fmtSignedPct(res.benchmark.total_return_pct)})</span>
      </div>
    </div>
  `;
}

function renderForecastFanSvg(fc: PortfolioForecastResult, ccy: string): string {
  const basePts = fc.baseline.trajectory;
  const simPts = fc.simulated.trajectory;
  if (!simPts || simPts.length < 2) {
    return `<div class="muted-sub">Run simulation to generate wealth projection chart.</div>`;
  }

  const w = 640;
  const h = 210;
  const padL = 56;
  const padR = 76;
  const padT = 16;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const benchPts = simPts.map((pt) =>
    fc.baseline.starting_wealth_base * Math.pow(1 + fc.benchmark_cagr_pct / 100, pt.year),
  );
  const allVals: number[] = [];
  for (let i = 0; i < simPts.length; i += 1) {
    allVals.push(simPts[i]!.p10_base, simPts[i]!.p50_base, simPts[i]!.p90_base, benchPts[i]!);
    if (basePts[i]) allVals.push(basePts[i]!.p10_base, basePts[i]!.p50_base);
  }
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const spanPad = Math.max(1000, (rawMax - rawMin) * 0.1);
  const lo = Math.max(0, rawMin - spanPad);
  const hi = rawMax + spanPad;
  const span = Math.max(1, hi - lo);

  const maxYr = Math.max(1, simPts[simPts.length - 1]!.year);
  const mapX = (yr: number) => padL + (yr / maxYr) * plotW;
  const mapY = (v: number) => padT + (1 - (v - lo) / span) * plotH;

  const buildLine = (pts: Array<{ year: number; v: number }>) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${mapX(p.year).toFixed(1)} ${mapY(p.v).toFixed(1)}`).join(" ");

  const upper = simPts.map((p) => `${mapX(p.year).toFixed(1)} ${mapY(p.p90_base).toFixed(1)}`);
  const lower = [...simPts].reverse().map((p) => `${mapX(p.year).toFixed(1)} ${mapY(p.p10_base).toFixed(1)}`);
  const outerFanPath = `M${upper.join(" L")} L${lower.join(" L")} Z`;

  const upper25 = simPts.map((p) => `${mapX(p.year).toFixed(1)} ${mapY(p.p75_base).toFixed(1)}`);
  const lower25 = [...simPts].reverse().map((p) => `${mapX(p.year).toFixed(1)} ${mapY(p.p25_base).toFixed(1)}`);
  const innerFanPath = `M${upper25.join(" L")} L${lower25.join(" L")} Z`;

  const yTicks = [hi, (lo + hi) / 2, lo];
  const gridSvg = yTicks
    .map((val) => {
      const y = mapY(val).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-color)" stroke-width="1" /><text x="${padL - 7}" y="${Number(y) + 3}" text-anchor="end" fill="var(--fg-muted)" font-size="9.5" font-family="ui-monospace, monospace">${esc(fmtCompact(val, ccy))}</text>`;
    })
    .join("");

  const xSvg = simPts
    .map(
      (p) =>
        `<text x="${mapX(p.year).toFixed(1)}" y="${h - 6}" text-anchor="middle" fill="var(--fg-muted)" font-size="9.5" font-family="ui-monospace, monospace">${p.year === 0 ? "Now" : `Y${p.year}`}</text>`,
    )
    .join("");

  const lastSim = simPts[simPts.length - 1]!;
  const lastBase = basePts[basePts.length - 1]!;
  const endX = mapX(lastSim.year);

  const labelY90 = mapY(lastSim.p90_base);
  const labelY50 = mapY(lastSim.p50_base);
  const labelY10 = mapY(lastSim.p10_base);

  return `
    <div class="forecast-fan-wrap">
      <svg class="forecast-fan-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${fc.horizon_years}-year portfolio wealth projection fan chart comparing Current Path vs Action Plan">
        ${gridSvg}
        ${xSvg}
        <path d="${outerFanPath}" fill="var(--accent)" fill-opacity="0.11" />
        <path d="${innerFanPath}" fill="var(--accent)" fill-opacity="0.15" />
        <path d="${buildLine(simPts.map((p, idx) => ({ year: p.year, v: benchPts[idx]! })))}" fill="none" stroke="var(--viz-5)" stroke-width="1.35" stroke-dasharray="2 3" />
        <path d="${buildLine(basePts.map((p) => ({ year: p.year, v: p.p50_base })))}" fill="none" stroke="var(--fg-muted)" stroke-width="1.8" stroke-dasharray="5 3" />
        <path d="${buildLine(simPts.map((p) => ({ year: p.year, v: p.p50_base })))}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${endX.toFixed(1)}" cy="${labelY90.toFixed(1)}" r="2.5" fill="var(--ok)" />
        <circle cx="${endX.toFixed(1)}" cy="${labelY50.toFixed(1)}" r="3.4" fill="var(--accent)" />
        <circle cx="${endX.toFixed(1)}" cy="${mapY(lastBase.p50_base).toFixed(1)}" r="2.5" fill="var(--fg-muted)" />
        <circle cx="${endX.toFixed(1)}" cy="${labelY10.toFixed(1)}" r="2.5" fill="var(--warn)" />
        <text x="${(endX + 7).toFixed(1)}" y="${(labelY90 + 3).toFixed(1)}" fill="var(--ok)" font-size="9.5" font-weight="600" font-family="ui-monospace, monospace">P90 ${esc(fmtCompact(lastSim.p90_base, ccy))}</text>
        <text x="${(endX + 7).toFixed(1)}" y="${(labelY50 + 3).toFixed(1)}" fill="var(--fg-primary)" font-size="10" font-weight="700" font-family="ui-monospace, monospace">P50 ${esc(fmtCompact(lastSim.p50_base, ccy))}</text>
        <text x="${(endX + 7).toFixed(1)}" y="${(labelY10 + 3).toFixed(1)}" fill="var(--warn)" font-size="9.5" font-weight="600" font-family="ui-monospace, monospace">P10 ${esc(fmtCompact(lastSim.p10_base, ccy))}</text>
      </svg>
      <div class="equity-legend">
        <span class="legend-item"><span class="legend-swatch-line" style="border-top-color:var(--accent)"></span><strong>Action Plan (P50)</strong> ${fmtCompact(lastSim.p50_base, ccy)} (${fc.simulated.expected_cagr_p50_pct.toFixed(1)}% CAGR)</span>
        <span class="legend-item"><span class="legend-swatch-line dashed"></span>Current Path (P50) ${fmtCompact(lastBase.p50_base, ccy)} (${fc.baseline.expected_cagr_p50_pct.toFixed(1)}% CAGR)</span>
        <span class="legend-item"><span class="legend-swatch-line dotted"></span>${esc(fc.benchmark_ticker)} (${fc.benchmark_cagr_pct.toFixed(1)}%) ${fmtCompact(fc.benchmark_ending_base, ccy)}</span>
        <span class="legend-item"><span class="swatch" style="background:var(--accent);opacity:0.25"></span>P10–P90 Confidence Band (${fc.simulations.toLocaleString("en-US")} correlated paths)</span>
      </div>
    </div>
  `;
}

interface DonutSegment {
  label: string;
  ticker: string | null;
  pct: number;
  valueBase: number;
  color: string;
}

function renderTriggerRuler(
  price: number | null,
  low: number | null,
  high: number | null,
  trim: number | null,
  currency: string,
): string {
  const pts = [price, low, high, trim].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (pts.length === 0) {
    return `<div class="muted-sub">No price or trigger targets set yet.</div>`;
  }

  const rawMin = Math.min(...pts);
  const rawMax = Math.max(...pts);
  const pad = (rawMax - rawMin || rawMax * 0.2 || 10) * 0.16;
  const lo = Math.max(0, rawMin - pad);
  const hi = rawMax + pad;
  const span = Math.max(0.01, hi - lo);
  const posPct = (v: number) => Math.max(2, Math.min(98, ((v - lo) / span) * 100));

  const buyBand =
    low !== null && high !== null && high >= low
      ? `<div class="ruler-buy-band" style="left:${posPct(low).toFixed(1)}%;width:${Math.max(3, posPct(high) - posPct(low)).toFixed(1)}%" title="Buy Zone ${fmtMoney(low, currency, 2)}-${fmtMoney(high, currency, 2)}"></div>`
      : "";
  const trimTick =
    trim !== null
      ? `<div class="ruler-trim-tick" style="left:${posPct(trim).toFixed(1)}%" title="Trim target ${fmtMoney(trim, currency, 2)}"></div>`
      : "";
  const pricePin =
    price !== null
      ? `<div class="ruler-pin" style="left:${posPct(price).toFixed(1)}%" title="Current ${fmtMoney(price, currency, 2)}"></div>`
      : "";

  let distText = "Targets configured";
  if (price !== null) {
    if (trim !== null && price >= trim) {
      const over = ((price - trim) / trim) * 100;
      distText = `▲ +${over.toFixed(1)}% above trim`;
    } else if (low !== null && high !== null && price >= low && price <= high) {
      distText = "Inside Buy Zone";
    } else if (low !== null && price < low) {
      const below = ((low - price) / low) * 100;
      distText = `${below.toFixed(1)}% below Buy Low`;
    } else if (high !== null && trim !== null) {
      const toTrim = ((trim - price) / price) * 100;
      distText = `${toTrim.toFixed(1)}% to Trim`;
    } else if (high !== null && price > high) {
      const aboveBuy = ((price - high) / high) * 100;
      distText = `${aboveBuy.toFixed(1)}% above Buy Zone`;
    }
  }

  return `
    <div class="ruler-block">
      <div class="ruler-track" aria-label="${esc(distText)}">
        ${buyBand}
        ${trimTick}
        ${pricePin}
      </div>
      <div class="ruler-labels">
        <span>${low !== null && high !== null ? `Buy ${fmtMoney(low, currency, low < 20 ? 2 : 0)}–${fmtMoney(high, currency, high < 20 ? 2 : 0)}` : "No Buy Zone"}</span>
        <span>${esc(distText)}</span>
        <span>${trim !== null ? `Trim ${fmtMoney(trim, currency, trim < 20 ? 2 : 0)}+` : "Core Hold"}</span>
      </div>
    </div>
  `;
}

function buildAllocationSegments(data: DashboardPayload): DonutSegment[] {
  const sorted = data.portfolio.positions.slice().sort((a, b) => b.mv_base - a.mv_base);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6);
  const segments: DonutSegment[] = top.map((p, idx) => ({
    label: p.ticker,
    ticker: p.ticker,
    pct: p.weight_nav_pct,
    valueBase: p.mv_base,
    color: SLICE_PALETTE[idx % (SLICE_PALETTE.length - 2)]!,
  }));
  if (rest.length > 0) {
    const restPct = rest.reduce((s, p) => s + p.weight_nav_pct, 0);
    const restBase = rest.reduce((s, p) => s + p.mv_base, 0);
    segments.push({
      label: `Other (${rest.length})`,
      ticker: null,
      pct: restPct,
      valueBase: restBase,
      color: SLICE_PALETTE[6]!,
    });
  }
  if (data.portfolio.cash_pct > 0.1) {
    segments.push({
      label: "Cash",
      ticker: null,
      pct: data.portfolio.cash_pct,
      valueBase: data.portfolio.cash_base,
      color: SLICE_PALETTE[7]!,
    });
  }
  return segments;
}

function getRosterCounts(data: DashboardPayload) {
  const lab = data.lab;
  if (lab) {
    return {
      active: lab.active_count,
      cap: lab.active_cap,
      bench: lab.bench_count,
      passed: lab.passed_count,
      retest: lab.needs_retest_count,
      reentry: lab.reentry_alert_count,
    };
  }
  return {
    active: data.theses.filter((t) => (t.tier || "active") === "active").length,
    cap: data.profile.benchmark?.core_active_cap ?? 12,
    bench: data.theses.filter((t) => t.tier === "bench").length,
    passed: data.theses.filter((t) => t.tier === "passed").length,
    retest: data.theses.filter((t) => t.provenance?.needs_retest).length,
    reentry: data.theses.filter((t) => t.reentry_alert).length,
  };
}

function ingestPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as DashboardPayload;
  if (!p.profile || !p.portfolio) return;
  const firstLoad = !hasInitializedFromResult;
  hasInitializedFromResult = true;
  state = p;
  simExtBase = p.profile.external_exposure.enabled ? p.profile.external_exposure.amount_base : 0;
  simReserveBase = p.profile.liquidity_reserve.enabled ? p.profile.liquidity_reserve.amount_base : 0;
  if (!p.profile.external_exposure.enabled && heroMode === "total") {
    heroMode = "portfolio";
  }
  if (p.active_tab && TABS.some((t) => t.id === p.active_tab)) {
    activeTab = p.active_tab;
  }
  if (firstLoad) {
    const activeCount = p.theses.filter((t) => (t.tier || "active") === "active").length;
    if (activeCount === 0 && p.theses.length > 0) thesisTier = "all";
  }
  if (!btTicker) {
    const benchFirst = p.theses.find((t) => t.tier === "bench")?.ticker;
    const anyThesis = p.theses.find((t) => t.tier !== "active")?.ticker ?? p.theses[0]?.ticker ?? "";
    btTicker = benchFirst ?? anyThesis;
  }
  if (p.lab?.latest_backtest && !backtestResult) {
    backtestResult = p.lab.latest_backtest;
  }
  if (p.forecast) {
    if (!forecastResult || firstLoad) {
      forecastResult = p.forecast;
      forecastIncludeExt = p.forecast.include_external_wealth;
    }
  }
  if (!forecastBuyTicker) {
    const readyCand =
      p.lab?.dip_triage_queue.find((d) => d.readiness === "READY" && d.ticker !== p.profile.benchmark?.ticker)?.ticker ??
      p.theses.find((t) => t.tier === "active" && t.action_verdict === "GO")?.ticker ??
      p.profile.benchmark?.ticker ??
      "VWRA";
    forecastBuyTicker = readyCand;
  }
  render();
  if (inspectorTicker) {
    const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
    if (dlg?.open) {
      renderInspectorDialog(inspectorTicker, captureOpenDisclosures(dlg));
    }
  } else if (inspectorThemeSlug) {
    const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
    if (dlg?.open) {
      renderThemeDialog(inspectorThemeSlug, captureOpenDisclosures(dlg));
    }
  }
}

function computeSimulatorMetrics(data: DashboardPayload) {
  const fx = data.usd_to_base_fx || 1.0;
  const navBase = data.portfolio.nav_base;
  const extEnabled = data.profile.external_exposure.enabled;
  const effectiveExt = extEnabled ? simExtBase : 0;
  const totalWealthBase = navBase + effectiveExt;
  const cashSurplusBase = data.portfolio.cash_base - simReserveBase;
  const netInvestableBase = Math.max(0, totalWealthBase - simReserveBase);

  const extTotalBase = effectiveExt + data.summary.ext_portfolio_base;
  const extPct = totalWealthBase > 0 ? (extTotalBase / totalWealthBase) * 100 : 0;

  const pairedDelta = effectiveExt - (extEnabled ? data.profile.external_exposure.amount_base : 0);
  const pairedTotalBase = data.summary.paired_exposure_base + pairedDelta;
  const pairedPct = totalWealthBase > 0 ? (pairedTotalBase / totalWealthBase) * 100 : 0;

  const bucketAdd = data.summary.ext_included_in_primary_bucket ? effectiveExt : 0;
  const primaryBucketPct =
    totalWealthBase > 0 ? ((data.summary.primary_bucket_portfolio_base + bucketAdd) / totalWealthBase) * 100 : 0;

  const extUsSitusUsd = extEnabled && data.profile.external_exposure.us_situs && fx > 0 ? effectiveExt / fx : 0;
  const totalUsSitusUsd = data.summary.us_situs_portfolio_usd + extUsSitusUsd;
  const est = data.summary.us_situs_enabled
    ? computeUsEstateTaxUsd(totalUsSitusUsd)
    : { netTaxUsd: 0, marginalPct: 0 };
  const estAfterUcits = data.summary.us_situs_enabled
    ? computeUsEstateTaxUsd(data.summary.us_situs_stocks_usd + extUsSitusUsd)
    : { netTaxUsd: 0, marginalPct: 0 };

  return {
    totalWealthBase,
    netInvestableBase,
    cashSurplusBase,
    extPct,
    pairedPct,
    primaryBucketPct,
    estateTaxBase: est.netTaxUsd * fx,
    marginalPct: est.marginalPct,
    ucitsSavingsBase: (est.netTaxUsd - estAfterUcits.netTaxUsd) * fx,
  };
}

function renderOnboarding(canMessage: boolean): string {
  const onboardBtn = canMessage
    ? `<button type="button" class="primary" id="btn-onboard-agent" ${busyMessage ? "disabled" : ""}>Ask Agent: Onboard My Portfolio</button>`
    : "";
  return `
    <div class="onboarding-card">
      <h2>Welcome to Investment OS</h2>
      <p>No local portfolio is configured yet. All holdings, tax settings, and investment dossiers stay strictly private on your machine inside <code>\${PLUGIN_DATA}</code>.</p>
      <ul class="onboarding-points">
        <li>Supports any base reporting currency, multi-currency holdings, ETF look-through weights, and after-tax hurdle modeling.</li>
        <li>Read-only by architecture: connects alongside broker MCPs or manual snapshots with zero trading tools.</li>
        <li>Explore Reverse DCF valuations, 5Y Bear/Base/Bull scenarios, 4-check dip triage, and deterministic portfolio backtests.</li>
      </ul>
      <div class="actions-row">
        ${onboardBtn}
        <button type="button" id="btn-preview-demo" ${busyMessage ? "disabled" : ""}>Preview Sample Portfolio</button>
      </div>
    </div>
  `;
}

function renderOverview(data: DashboardPayload): string {
  const ccy = data.base_currency;
  const sim = computeSimulatorMetrics(data);
  const ext = data.profile.external_exposure;
  const segments = buildAllocationSegments(data);
  const fc = forecastResult ?? data.forecast ?? null;

  const heroVal = heroMode === "total" && ext.enabled ? sim.totalWealthBase : data.portfolio.nav_base;
  const heroLabel = heroMode === "total" && ext.enabled ? "Total Liquid Wealth" : `${data.profile.custody_label} NAV`;
  const heroModeBtns = ext.enabled
    ? `
      <div class="seg-switch" role="group" aria-label="Wealth view toggle">
        <button type="button" data-hero-mode="portfolio" aria-pressed="${heroMode === "portfolio" ? "true" : "false"}">Portfolio</button>
        <button type="button" data-hero-mode="total" aria-pressed="${heroMode === "total" ? "true" : "false"}">Total Wealth</button>
      </div>
    `
    : "";

  const macro = data.macro_regime;
  const effectiveVix = macro?.vix ?? data.vix ?? null;
  const regimeLbl =
    macro?.regime_label ??
    (effectiveVix !== null
      ? effectiveVix >= 35
        ? "STRESS"
        : effectiveVix >= 28
          ? "HIGH_VOL"
          : effectiveVix >= 20
            ? "ELEVATED"
            : "CALM"
      : "CALM");
  const isHighVol = effectiveVix !== null && effectiveVix >= 28;
  const macroDotCls = checkDotClass(regimeLbl);

  const macroLineHtml = `
    <div class="exec-macro-line ${isHighVol ? "is-high-vol" : ""}" aria-label="Market regime">
      <div class="macro-items">
        <span class="status-tag ${macroDotCls ? "" : "quiet"}"><span class="dot ${macroDotCls}"></span>${esc(regimeLbl.replace(/_/g, " "))}</span>
        <span class="macro-item">VIX <strong>${effectiveVix !== null ? effectiveVix.toFixed(1) : "—"}</strong></span>
        ${macro?.us10y_pct != null ? `<span class="macro-item">10Y <strong>${macro.us10y_pct.toFixed(2)}%</strong></span>` : ""}
        ${macro?.us3m_pct != null ? `<span class="macro-item">3M <strong>${macro.us3m_pct.toFixed(2)}%</strong></span>` : ""}
        ${isHighVol ? `<span class="pos-warn">Stage buys 2–3w apart</span>` : ""}
      </div>
      ${
        isHighVol
          ? `<label class="noise-toggle"><input type="checkbox" id="toggle-mute-vol-noise" ${muteVolNoise ? "checked" : ""} /> Mute 1D% noise</label>`
          : `<span class="muted-sub">${ccy !== "USD" ? `USD/${ccy} ${data.usd_to_base_fx.toFixed(4)}` : "Base USD"}</span>`
      }
    </div>
  `;

  const allocStripHtml = segments
    .map(
      (s) =>
        `<button type="button" class="alloc-seg" style="--seg-color:${s.color};background:${s.color};flex:${Math.max(1.5, s.pct).toFixed(2)} 1 0%" ${s.ticker ? `data-inspect-ticker="${esc(s.ticker)}"` : ""} title="${esc(s.label)} (${fmtPct(s.pct)})" aria-label="${esc(s.label)} ${fmtPct(s.pct)}"></button>`,
    )
    .join("");

  const allocMiniLegend = segments
    .slice(0, 6)
    .map(
      (s) =>
        `<button type="button" class="alloc-tag" ${s.ticker ? `data-inspect-ticker="${esc(s.ticker)}"` : "disabled"}><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span><strong>${fmtPct(s.pct)}</strong></button>`,
    )
    .join("");

  const forecastHeroPill = fc
    ? `
      <button type="button" class="hero-forecast-pill" data-jump-tab="forecast" title="Open interactive ${fc.horizon_years}Y Forecast & Action Simulator">
        <span class="micro-label">${fc.horizon_years}Y Projected (Base)</span>
        <span class="hero-forecast-val">${fmtCompact(fc.simulated.ending_p50_base, ccy)}</span>
        <span class="muted-sub">${fc.simulated.expected_cagr_p50_pct.toFixed(1)}% CAGR · Open Forecast &rarr;</span>
      </button>
    `
    : "";

  const rot = data.rotation_queue;
  const taxSwaps = rot?.tax_swaps ?? [];
  const mandatoryExits = rot?.mandatory_exits ?? [];
  const capTrims = rot?.cap_trims ?? [];
  const hasRotationItems = taxSwaps.length > 0 || mandatoryExits.length > 0 || capTrims.length > 0;
  const freedTotal = rot?.total_freed_base ?? 0;

  const actionRows: string[] = [];
  if (taxSwaps.length > 0) {
    actionRows.push(`
      <div class="rotation-group">
        <span class="micro-label">Tax-Free UCITS Swaps (${taxSwaps.length})</span>
        ${taxSwaps
          .map(
            (sw) => `
          <button type="button" class="rotation-row-btn" data-inspect-ticker="${esc(sw.ticker)}">
            <div class="queue-main">
              <span class="queue-title">${esc(sw.ticker)} &rarr; ${esc(sw.target_ticker)} · ${fmtCompact(sw.proceeds_base, ccy)}</span>
              <span class="queue-sub">Saves ${fmtMoney(sw.estate_tax_saved_base, ccy)} estate tax${sw.annual_wht_saved_base > 0 ? ` + ${fmtMoney(sw.annual_wht_saved_base, ccy)}/yr WHT` : ""}</span>
            </div>
            <span class="status-tag"><span class="dot ok"></span>Swap</span>
          </button>
        `,
          )
          .join("")}
      </div>
    `);
  }
  if (mandatoryExits.length > 0) {
    actionRows.push(`
      <div class="rotation-group">
        <span class="micro-label">Mandatory Exits (${mandatoryExits.length})</span>
        ${mandatoryExits
          .map(
            (ex) => `
          <button type="button" class="rotation-row-btn" data-inspect-ticker="${esc(ex.ticker)}">
            <div class="queue-main">
              <span class="queue-title">${esc(ex.ticker)} · ${fmtCompact(ex.proceeds_base, ccy)} (${fmtPct(ex.weight_nav_pct, 1)} NAV)</span>
              <span class="queue-sub">${esc(ex.reason)}</span>
            </div>
            <span class="status-tag"><span class="dot bad"></span>Exit</span>
          </button>
        `,
          )
          .join("")}
      </div>
    `);
  }
  if (capTrims.length > 0) {
    actionRows.push(`
      <div class="rotation-group">
        <span class="micro-label">Cap-Breach Trims (${capTrims.length})</span>
        ${capTrims
          .map(
            (ct) => `
          <button type="button" class="rotation-row-btn" data-inspect-ticker="${esc(ct.ticker)}">
            <div class="queue-main">
              <span class="queue-title">${esc(ct.ticker)} · Trim ${fmtCompact(ct.proceeds_base, ccy)}</span>
              <span class="queue-sub">${ct.current_pct.toFixed(1)}% vs ${ct.cap_pct.toFixed(1)}% ${esc(ct.cap_label)}</span>
            </div>
            <span class="status-tag"><span class="dot warn"></span>Trim</span>
          </button>
        `,
          )
          .join("")}
      </div>
    `);
  }

  const priorityActionHtml = hasRotationItems
    ? `
      ${actionRows.join("")}
      <div class="signal-inbox-foot">
        <span>Frees <strong>${fmtCompact(freedTotal, ccy)}</strong>${rot && rot.total_estate_tax_saved_base > 0 ? ` · Saves <strong class="pos-ok">${fmtCompact(rot.total_estate_tax_saved_base, ccy)}</strong> estate tax` : ""}</span>
        <button type="button" class="primary small" data-jump-tab="forecast">Simulate in Forecast &rarr;</button>
      </div>
    `
    : `<div class="muted-sub" style="padding:0.5rem 0">Portfolio is clean—no pending tax swaps, mandatory exits, or cap trims.</div>`;

  // Strictly High-Signal Human Inbox (Max 5 items — routine 8-K:5.02 & background alerts live in SEC & Alerts / agent metadata)
  interface UrgentItem {
    ticker?: string;
    themeSlug?: string;
    alertId?: string;
    title: string;
    detail: string;
    badgeLabel: string;
    dotCls: "ok" | "warn" | "bad" | "";
    priority: number;
  }
  const urgentItems: UrgentItem[] = [];
  const seenUrgent = new Set<string>();
  const pushUrgent = (key: string, item: UrgentItem) => {
    if (seenUrgent.has(key)) return;
    seenUrgent.add(key);
    urgentItems.push(item);
  };

  const allUnacked = (data.alerts ?? []).filter((a) => !a.acknowledged);
  const backgroundArchivedCount = allUnacked.filter((a) => isRoutineNoiseAlert(a) || a.severity !== "high").length;

  for (const a of allUnacked) {
    if (isRoutineNoiseAlert(a)) continue;
    if (a.severity !== "high") continue;
    pushUrgent(`alert:${a.id}`, {
      ticker: a.ticker ?? undefined,
      themeSlug: a.theme_slug ?? undefined,
      alertId: a.id,
      title: cleanAlertTitle(a.title, a.ticker),
      detail: `${a.detected_at.slice(0, 10)}${a.detail ? ` · ${a.detail}` : ""}`,
      badgeLabel: a.kind === "hypothesis_rule_breach" ? "Rule Breach" : a.kind === "sec_gate_cleared" ? "Gate Cleared" : "High Priority",
      dotCls: a.kind === "sec_gate_cleared" ? "ok" : "bad",
      priority: 1,
    });
  }

  for (const t of data.theses) {
    if (t.tier === "passed" && t.reentry_alert) {
      pushUrgent(`reentry:${t.ticker}`, {
        ticker: t.ticker,
        title: `${t.ticker} hit re-entry target`,
        detail: `${t.price !== null ? fmtMoney(t.price, t.currency, 2) : ""} <= ${t.reentry_price !== null ? fmtMoney(t.reentry_price, t.currency, 2) : ""} · ${t.reentry_trigger || "Review passed dossier"}`,
        badgeLabel: "Re-Entry",
        dotCls: "ok",
        priority: 2,
      });
    }
    const coreBreach = (t.hypotheses ?? []).find((h) => h.auto_eval?.passed === false && h.is_core);
    if (coreBreach) {
      pushUrgent(`rule:${t.ticker}:${coreBreach.id}`, {
        ticker: t.ticker,
        title: `${t.ticker} core thesis rule breached`,
        detail: coreBreach.auto_eval?.detail ?? coreBreach.claim,
        badgeLabel: "Rule Breach",
        dotCls: "bad",
        priority: 1,
      });
    }
  }

  for (const g of data.edgar.gate_evaluations) {
    if (!g.cleared) {
      pushUrgent(`gate:${g.ticker}:${g.form}`, {
        ticker: g.ticker,
        title: `${g.ticker} waiting on SEC ${g.form}`,
        detail: `${g.description} (after ${g.filed_after})`,
        badgeLabel: "Open Gate",
        dotCls: "warn",
        priority: 3,
      });
    }
  }

  for (const c of data.catalysts) {
    const targetMs = Date.parse(`${c.date}T00:00:00Z`);
    const daysAway = Number.isFinite(targetMs) ? Math.round((targetMs - Date.now()) / 86_400_000) : 999;
    if (daysAway >= 0 && daysAway <= 14) {
      const due = daysUntilLabel(c.date);
      pushUrgent(`cat:${c.ticker}:${c.date}`, {
        ticker: c.ticker,
        title: `${c.ticker} · ${c.title}`,
        detail: `${c.date}${c.detail ? ` · ${c.detail}` : ""}`,
        badgeLabel: due.label,
        dotCls: c.urgency === "high" ? "bad" : "warn",
        priority: 2,
      });
    }
  }

  urgentItems.sort((a, b) => a.priority - b.priority);
  const topUrgent = urgentItems.slice(0, 5);

  const urgentInboxHtml = topUrgent.length
    ? topUrgent
        .map((q) => {
          const clickAttr = q.ticker
            ? `data-inspect-ticker="${esc(q.ticker)}"`
            : q.themeSlug
              ? `data-inspect-theme="${esc(q.themeSlug)}"`
              : "";
          const ackBtn =
            q.alertId && !data.is_demo
              ? `<button type="button" class="small ghost btn-ack-alert" data-alert-id="${esc(q.alertId)}" title="Dismiss alert">Done</button>`
              : "";
          return `
            <div class="alert-row">
              <button type="button" class="alert-row-main" ${clickAttr}>
                <span class="queue-title">${esc(q.title)}</span>
                <span class="queue-sub">${esc(q.detail)}</span>
              </button>
              <div class="alert-right">
                <span class="status-tag ${q.dotCls ? "" : "quiet"}">${q.dotCls ? `<span class="dot ${q.dotCls}"></span>` : ""}${esc(q.badgeLabel)}</span>
                ${ackBtn}
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="muted-sub" style="padding:0.55rem 0">All clear—no urgent red flags, core thesis breaks, or imminent catalysts in the next 14 days.</div>`;

  const maxLtPct = Math.max(1, ...data.lookthrough.slice(0, 6).map((r) => r.pct_nav));
  const ltBarsHtml = data.lookthrough
    .slice(0, 6)
    .map((r) => {
      const dirShare = r.total_usd > 0 ? (r.direct_usd / r.total_usd) * 100 : 0;
      const etfShare = 100 - dirShare;
      const widthPct = (r.pct_nav / maxLtPct) * 100;
      const clickTicker = r.name.includes("/") ? r.name.split("/")[0]! : r.name;
      return `
      <button type="button" class="lt-btn" data-inspect-ticker="${esc(clickTicker)}">
        <div class="lt-head">
          <span><strong>${esc(r.name)}</strong> ${r.via_etfs_usd > 0 ? `<span class="muted-sub">(${Math.round(dirShare)}% direct · ${Math.round(etfShare)}% ETF)</span>` : ""}</span>
          <span><strong>${fmtPct(r.pct_nav, 1)}</strong> · ${fmtCompact(r.total_base, ccy)}</span>
        </div>
        <div class="lt-track">
          <div class="lt-direct" style="width:${((widthPct * dirShare) / 100).toFixed(1)}%"></div>
          <div class="lt-etf" style="width:${((widthPct * etfShare) / 100).toFixed(1)}%"></div>
        </div>
      </button>
    `;
    })
    .join("");

  const renderCapItem = (c: RiskCapRow) => {
    const maxScale = Math.max(c.cap_pct * 1.4, c.value_pct, 1);
    const fillPct = Math.min(100, (c.value_pct / maxScale) * 100);
    const capPos = Math.min(98, (c.cap_pct / maxScale) * 100);
    const isPass = c.status === "PASS";
    const delta = c.value_pct - c.cap_pct;
    const badge = isPass
      ? `<span class="muted-sub">OK</span>`
      : `<span class="pos-bad" style="font-weight:600">+${delta.toFixed(1)}%</span>`;
    const capRule = data.profile.risk_caps.find((r) => r.id === c.id);
    const inspAttr =
      capRule?.kind === "ticker" && capRule.ticker ? `data-inspect-ticker="${esc(capRule.ticker)}"` : "";
    return `
      <div class="cap-row ${inspAttr ? "clickable" : ""}" ${inspAttr}>
        <div class="cap-head">
          <span>${esc(c.label)}</span>
          <span><strong>${fmtPct(c.value_pct)}</strong> <span class="muted-sub">/ ${fmtPct(c.cap_pct)}</span> ${badge}</span>
        </div>
        <div class="cap-meter">
          <div class="cap-fill ${isPass ? "pass" : "breach"}" style="width:${fillPct.toFixed(1)}%"></div>
          <div class="cap-limit-tick" style="left:${capPos.toFixed(1)}%" title="Cap ${c.cap_pct}%"></div>
        </div>
      </div>
    `;
  };

  const breachedCaps = data.risk_caps.filter((c) => c.status === "BREACH");
  const passingCaps = data.risk_caps.filter((c) => c.status === "PASS");
  const capSectionHtml = data.risk_caps.length
    ? `
      <div class="cap-list">
        ${breachedCaps.length > 0 ? breachedCaps.map(renderCapItem).join("") : `<div class="muted-sub" style="padding:0.3rem 0">All ${passingCaps.length} risk guardrails passing.</div>`}
      </div>
      ${
        passingCaps.length > 0 && breachedCaps.length > 0
          ? `<details class="cap-pass-disclosure"><summary>Show ${passingCaps.length} passing guardrail${passingCaps.length > 1 ? "s" : ""}</summary><div class="cap-list" style="margin-top:0.3rem">${passingCaps.map(renderCapItem).join("")}</div></details>`
          : passingCaps.length > 0 && breachedCaps.length === 0
            ? `<div class="cap-list">${passingCaps.map(renderCapItem).join("")}</div>`
            : ""
      }
    `
    : `<div class="muted-sub">No risk guardrails configured yet.</div>`;

  const secondKpiLabel = data.summary.us_situs_enabled
    ? "US Estate Tax Exposure"
    : ext.enabled
      ? `${ext.ticker || "External"} % Wealth`
      : "Invested Holdings";
  const secondKpiVal = data.summary.us_situs_enabled
    ? fmtMoney(sim.estateTaxBase, ccy)
    : ext.enabled
      ? fmtPct(sim.extPct)
      : fmtMoney(data.portfolio.positions_base, ccy);
  const secondKpiSub = data.summary.us_situs_enabled
    ? `UCITS swaps save ${fmtMoney(sim.ucitsSavingsBase, ccy)}`
    : ext.enabled
      ? `${ext.label} (${fmtCompact(simExtBase, ccy)})`
      : `${data.portfolio.positions.length} holdings`;

  const thirdKpiHtml = fc
    ? `
      <div class="metric-cell">
        <span class="micro-label">Action Plan (${fc.horizon_years}Y Impact)</span>
        <span class="metric-val ${fc.deltas.p10_base >= 0 ? "pos-ok" : ""}">${fc.deltas.p10_base >= 0 ? "+" : ""}${fmtCompact(fc.deltas.p10_base, ccy)} Bear P10</span>
        <span class="muted-sub">Caps ${fc.baseline.cap_breaches_count} &rarr; ${fc.simulated.cap_breaches_count} · Base ${fc.deltas.p50_base >= 0 ? "+" : ""}${fmtCompact(fc.deltas.p50_base, ccy)}</span>
      </div>
    `
    : `
      <div class="metric-cell">
        <span class="micro-label">Research Roster</span>
        <span class="metric-val">${data.lab?.active_count ?? 0}/${data.lab?.active_cap ?? 12} Active</span>
        <span class="muted-sub">${data.lab?.bench_count ?? 0} Bench · ${data.lab?.passed_count ?? 0} Passed</span>
      </div>
    `;

  return `
    <div class="panel-body">
      ${macroLineHtml}

      <section class="hero-card" aria-label="Portfolio summary">
        <div class="hero-top">
          <div>
            <div class="actions-row" style="gap:0.55rem;margin-bottom:3px">
              <span class="micro-label">${esc(heroLabel)}</span>
              ${heroModeBtns}
            </div>
            <div class="hero-nav-row">
              <div class="hero-nav">${fmtMoney(heroVal, ccy)}</div>
              ${fmtDeltaTag(data.portfolio.total_unrealized_pnl_pct, "Unrealized", true)}
            </div>
            <div class="muted-sub" style="margin-top:3px">
              ${ccy !== "USD" ? `${fmtMoney(data.portfolio.nav_usd, "USD", 0)} brokerage NAV` : `${fmtMoney(data.portfolio.positions_base, ccy)} invested`}
              ${ext.enabled && heroMode === "portfolio" ? ` · +${fmtCompact(simExtBase, ccy)} external` : ""}
              ${data.stale_tickers.length > 0 ? ` · Stale: ${esc(data.stale_tickers.join(", "))}` : ""}
            </div>
          </div>
          ${forecastHeroPill}
        </div>

        <div class="alloc-wrap">
          <div class="alloc-strip" role="group" aria-label="Top holdings allocation">${allocStripHtml}</div>
          <div class="alloc-legend-mini">${allocMiniLegend}</div>
        </div>

        <div class="exec-hero-kpis">
          <div class="metric-cell">
            <span class="micro-label">Cash &amp; Deployable</span>
            <span class="metric-val">${fmtMoney(data.portfolio.cash_base, ccy)}</span>
            <span class="muted-sub">${fmtPct(data.portfolio.cash_pct)} cash · +${fmtCompact(freedTotal, ccy)} via rotations</span>
          </div>
          <div class="metric-cell">
            <span class="micro-label">${esc(secondKpiLabel)}</span>
            <span class="metric-val ${data.summary.us_situs_enabled ? "pos-bad" : ""}">${esc(secondKpiVal)}</span>
            <span class="muted-sub">${esc(secondKpiSub)}</span>
          </div>
          ${thirdKpiHtml}
        </div>
      </section>

      <div class="hub-grid">
        <div class="card">
          <div class="section-head">
            <h2 class="section-title">Recommended Actions</h2>
            <button type="button" class="small ghost" data-jump-tab="lab">Dip Queue &rarr;</button>
          </div>
          ${priorityActionHtml}
        </div>

        <div class="card">
          <div class="section-head">
            <h2 class="section-title">Urgent Signals</h2>
            <span class="muted-sub">Top high-priority items only</span>
          </div>
          <div class="action-queue">${urgentInboxHtml}</div>
          <div class="signal-inbox-foot">
            <span>${backgroundArchivedCount > 0 ? `${backgroundArchivedCount} background item${backgroundArchivedCount > 1 ? "s" : ""} kept off Overview` : "Routine filings stored in agent metadata"}</span>
            <button type="button" class="small ghost" data-jump-tab="edgar">SEC &amp; Alerts &rarr;</button>
          </div>
        </div>
      </div>

      <div class="hub-grid">
        <div class="card">
          <div class="section-head">
            <h2 class="section-title">True Look-Through Exposure</h2>
            <button type="button" class="small ghost" data-jump-tab="holdings">All Holdings &rarr;</button>
          </div>
          <div class="lt-list">${ltBarsHtml}</div>
        </div>

        <div class="card">
          <div class="section-head">
            <h2 class="section-title">Risk Guardrails</h2>
            <span class="muted-sub">${breachedCaps.length > 0 ? `${breachedCaps.length} breached` : "All passing"}</span>
          </div>
          ${capSectionHtml}
        </div>
      </div>
    </div>
  `;
}

function buildSelectedForecastActions(data: DashboardPayload): Array<Record<string, unknown>> {
  const rot = data.rotation_queue;
  const benchTicker = data.profile.benchmark?.ticker ?? "VWRA";
  const actions: Array<Record<string, unknown>> = [];

  for (const sw of rot?.tax_swaps ?? []) {
    const key = `swap:${sw.ticker}`;
    if (!forecastDisabledRotations.has(key)) {
      actions.push({ type: "tax_swap", ticker: sw.ticker, target_ticker: benchTicker, pct: 100 });
    }
  }
  for (const ex of rot?.mandatory_exits ?? []) {
    const key = `exit:${ex.ticker}`;
    if (!forecastDisabledRotations.has(key)) {
      actions.push({ type: "sell", ticker: ex.ticker, pct: 100 });
    }
  }
  for (const ct of rot?.cap_trims ?? []) {
    const key = `trim:${ct.cap_id}:${ct.ticker}`;
    if (!forecastDisabledRotations.has(key) && ct.proceeds_base > 0) {
      actions.push({ type: "sell", ticker: ct.ticker, amount_base: ct.proceeds_base });
    }
  }
  for (const buy of forecastPlannedBuys) {
    if (buy.amount_base > 0 && buy.ticker) {
      actions.push({ type: "buy", ticker: buy.ticker, amount_base: buy.amount_base });
    }
  }
  if (forecastParkCash) {
    actions.push({ type: "park_cash_in_benchmark", pct: 100, keep_reserve: true });
  }
  return actions;
}

function renderForecast(data: DashboardPayload, canMessage: boolean): string {
  const ccy = data.base_currency;
  const fc = forecastResult ?? data.forecast ?? null;
  const rot = data.rotation_queue;
  const benchTicker = data.profile.benchmark?.ticker ?? "VWRA";

  let freedSelected = 0;
  for (const ex of rot?.mandatory_exits ?? []) {
    if (!forecastDisabledRotations.has(`exit:${ex.ticker}`)) freedSelected += ex.proceeds_base;
  }
  for (const ct of rot?.cap_trims ?? []) {
    if (!forecastDisabledRotations.has(`trim:${ct.cap_id}:${ct.ticker}`)) freedSelected += ct.proceeds_base;
  }
  const plannedBuysTotal = forecastPlannedBuys.reduce((s, b) => s + b.amount_base, 0);
  const availCashPool = data.portfolio.cash_base + freedSelected;
  const projectedLeftoverCash = Math.max(0, availCashPool - plannedBuysTotal);

  const tickerOpts = Array.from(
    new Set([
      benchTicker,
      ...data.theses.map((t) => t.ticker),
      ...data.portfolio.positions.map((p) => p.ticker),
    ]),
  )
    .sort()
    .map((sym) => `<option value="${esc(sym)}">${esc(sym)}</option>`)
    .join("");

  const rotationChecks: string[] = [];
  for (const sw of rot?.tax_swaps ?? []) {
    const key = `swap:${sw.ticker}`;
    const checked = !forecastDisabledRotations.has(key);
    rotationChecks.push(`
      <label class="action-check-row ${checked ? "is-checked" : ""}">
        <span class="action-check-left">
          <input type="checkbox" class="fc-rot-check" data-rot-key="${esc(key)}" ${checked ? "checked" : ""} />
          <span>
            <strong>Swap ${esc(sw.ticker)} &rarr; ${esc(sw.target_ticker)}</strong> (${fmtCompact(sw.proceeds_base, ccy)})
            <div class="muted-sub">Saves ${fmtMoney(sw.estate_tax_saved_base, ccy)} estate tax</div>
          </span>
        </span>
        <span class="status-tag"><span class="dot ok"></span>Tax Swap</span>
      </label>
    `);
  }
  for (const ex of rot?.mandatory_exits ?? []) {
    const key = `exit:${ex.ticker}`;
    const checked = !forecastDisabledRotations.has(key);
    rotationChecks.push(`
      <label class="action-check-row ${checked ? "is-checked" : ""}">
        <span class="action-check-left">
          <input type="checkbox" class="fc-rot-check" data-rot-key="${esc(key)}" ${checked ? "checked" : ""} />
          <span>
            <strong>Exit ${esc(ex.ticker)}</strong> (+${fmtCompact(ex.proceeds_base, ccy)} cash)
            <div class="muted-sub">${esc(ex.reason)}</div>
          </span>
        </span>
        <span class="status-tag"><span class="dot bad"></span>Exit</span>
      </label>
    `);
  }
  for (const ct of rot?.cap_trims ?? []) {
    const key = `trim:${ct.cap_id}:${ct.ticker}`;
    const checked = !forecastDisabledRotations.has(key);
    rotationChecks.push(`
      <label class="action-check-row ${checked ? "is-checked" : ""}">
        <span class="action-check-left">
          <input type="checkbox" class="fc-rot-check" data-rot-key="${esc(key)}" ${checked ? "checked" : ""} />
          <span>
            <strong>Trim ${esc(ct.ticker)}</strong> (+${fmtCompact(ct.proceeds_base, ccy)} cash)
            <div class="muted-sub">${ct.current_pct.toFixed(1)}% &rarr; ${ct.cap_pct.toFixed(1)}% ${esc(ct.cap_label)}</div>
          </span>
        </span>
        <span class="status-tag"><span class="dot warn"></span>Trim</span>
      </label>
    `);
  }

  const buyChipsHtml = forecastPlannedBuys.length
    ? `<div class="buy-chip-list">${forecastPlannedBuys
        .map(
          (b) => `
        <div class="buy-chip-row">
          <span><strong>Buy ${esc(b.ticker)}</strong> · ${fmtMoney(b.amount_base, ccy)}</span>
          <button type="button" class="small ghost fc-remove-buy" data-buy-id="${esc(b.id)}" aria-label="Remove buy ${esc(b.ticker)}">✕</button>
        </div>
      `,
        )
        .join("")}</div>`
    : `<div class="muted-sub" style="margin-top:0.45rem">No new buys queued yet—add a buy above or toggle excess cash sweep into ${esc(benchTicker)}.</div>`;

  const baseFr = fc?.baseline.factor_risk;
  const simFr = fc?.simulated.factor_risk;
  const cvar10Sim = fc?.simulated.ending_cvar_10_base ?? fc?.simulated.ending_p10_base ?? 0;
  const cvar10Delta = fc?.deltas.cvar_10_base ?? fc?.deltas.p10_base ?? 0;

  const kpiHtml = fc
    ? `
      <div class="forecast-kpi-grid">
        <div class="forecast-kpi-card">
          <span class="micro-label">${fc.horizon_years}Y Base Wealth (P50)</span>
          <span class="metric-val">${fmtCompact(fc.simulated.ending_p50_base, ccy)}</span>
          <span class="${fc.deltas.p50_base >= 0 ? "pos-ok" : "pos-bad"}" style="font-size:0.74rem;font-weight:600">
            ${fc.deltas.p50_base >= 0 ? "+" : ""}${fmtCompact(fc.deltas.p50_base, ccy)} vs hold (${fc.simulated.expected_cagr_p50_pct.toFixed(1)}% CAGR)
          </span>
        </div>
        <div class="forecast-kpi-card">
          <span class="micro-label">Tail Floor (P10 · CVaR 10%)</span>
          <span class="metric-val">${fmtCompact(fc.simulated.ending_p10_base, ccy)} <span class="muted-sub" style="font-size:0.76rem;font-weight:500">/ ${fmtCompact(cvar10Sim, ccy)}</span></span>
          <span class="${cvar10Delta >= 0 ? "pos-ok" : "pos-bad"}" style="font-size:0.73rem;font-weight:600">
            CVaR ${cvar10Delta >= 0 ? "+" : ""}${fmtCompact(cvar10Delta, ccy)} · P95 DD ${fc.simulated.sim_max_dd_p95_pct !== undefined ? `${fc.simulated.sim_max_dd_p95_pct.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div class="forecast-kpi-card">
          <span class="micro-label">PCA Effective Bets (N_eff)</span>
          <span class="metric-val">${baseFr && simFr ? `${baseFr.effective_bets.toFixed(1)} &rarr; ${simFr.effective_bets.toFixed(1)}` : "—"}</span>
          <span class="muted-sub">
            ${simFr?.market_beta !== null && simFr?.market_beta !== undefined ? `Beta ${simFr.market_beta.toFixed(2)}` : `Vol ${fc.simulated.annual_vol_pct.toFixed(1)}%`}
            ${simFr?.systematic_risk_pct !== null && simFr?.systematic_risk_pct !== undefined ? ` · ${simFr.systematic_risk_pct.toFixed(0)}% mkt-driven` : ""} · Sharpe ${fc.simulated.expected_sharpe.toFixed(2)}
          </span>
        </div>
        <div class="forecast-kpi-card">
          <span class="micro-label">Tax &amp; Risk Guardrails</span>
          <span class="metric-val pos-ok">${fc.deltas.estate_tax_saved_base > 0 ? `Saves ${fmtCompact(fc.deltas.estate_tax_saved_base, ccy)}` : `${fc.baseline.cap_breaches_count} → ${fc.simulated.cap_breaches_count} Caps`}</span>
          <span class="muted-sub">Caps ${fc.baseline.cap_breaches_count} &rarr; ${fc.simulated.cap_breaches_count} · US-Situs ${fc.simulated.us_situs_portfolio_pct.toFixed(1)}%${fc.deltas.annual_wht_saved_base > 0 ? ` · +${fmtMoney(fc.deltas.annual_wht_saved_base, ccy)}/yr` : ""}</span>
        </div>
      </div>
    `
    : "";

  const factorStripHtml =
    simFr && simFr.top_factors.length > 0
      ? `
        <div class="factor-strip">
          <div class="factor-strip-head">
            <span class="micro-label">Hidden Latent Factors (PCA Variance Share)</span>
            <span class="muted-sub">${esc(fc?.black_litterman?.note || "")}</span>
          </div>
          <div class="factor-bars">
            ${simFr.top_factors
              .map(
                (f) => `
              <div class="factor-bar-row">
                <span class="factor-bar-label"><strong>${esc(f.id)}</strong> (${esc(f.top_tickers.join(", "))})</span>
                <div class="factor-bar-track"><div class="factor-bar-fill" style="width:${Math.min(100, f.variance_share_pct).toFixed(1)}%"></div></div>
                <span class="factor-bar-pct">${f.variance_share_pct.toFixed(1)}%</span>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      `
      : "";

  const posRowsHtml = fc
    ? fc.positions
        .slice(0, 18)
        .map((p) => {
          const wtDelta = p.after_weight_pct - p.before_weight_pct;
          const wtDeltaStr =
            Math.abs(wtDelta) >= 0.1
              ? ` <span class="${wtDelta > 0 ? "pos-ok" : "pos-bad"}">(${wtDelta > 0 ? "+" : ""}${wtDelta.toFixed(1)}%)</span>`
              : "";
          const rowClick = !p.is_cash ? `class="clickable-row" data-inspect-ticker="${esc(p.ticker)}"` : "";
          const blSub =
            fc.return_model === "black_litterman" && p.raw_view_cagr_pct !== null && p.raw_view_cagr_pct !== undefined && Math.abs((p.bl_shrinkage_pct ?? 0)) >= 0.2
              ? ` <span class="muted-sub" title="Raw dossier 5Y target before Black-Litterman shrinkage">(raw ${p.raw_view_cagr_pct.toFixed(1)}%)</span>`
              : "";
          return `
            <tr ${rowClick}>
              <th scope="row">
                ${p.is_cash ? "Cash" : `<button type="button" class="ticker-link" data-inspect-ticker="${esc(p.ticker)}">${esc(p.ticker)}</button>`}
                ${p.is_external ? `<span class="src-badge">External</span>` : ""}
                ${qualityGradeBadge(p.quality_grade, true)}
              </th>
              <td class="num" data-label="Before → After">${p.before_weight_pct.toFixed(1)}% &rarr; <strong>${p.after_weight_pct.toFixed(1)}%</strong>${wtDeltaStr}</td>
              <td class="num" data-label="Exp. CAGR">${p.expected_cagr_pct.toFixed(1)}%${blSub}</td>
              <td class="num" data-label="Risk Share">${p.marginal_risk_contrib_pct.toFixed(1)}%</td>
              <td class="num" data-label="Corr Hurdle">${p.is_cash ? "—" : `${p.corr_adjusted_hurdle_pct.toFixed(1)}%`}</td>
              <td class="num" data-label="¼-Kelly">${p.is_cash ? "—" : `${p.quarter_kelly_weight_pct.toFixed(1)}%`}</td>
              <td class="num" data-label="HRP Balanced">${p.is_cash ? "—" : `${(p.hrp_weight_pct ?? 0).toFixed(1)}%`}</td>
            </tr>
          `;
        })
        .join("")
    : "";

  return `
    <div class="panel-body">
      <div class="card">
        <div class="forecast-toolbar">
          <div>
            <h2 class="section-title">Portfolio Forward Forecast &amp; Action Simulator</h2>
            <div class="muted-sub">Toggle Bayesian return shrinkage, empirical crash bootstrap, rotations, and buys to compare trajectories.</div>
          </div>
          <div class="actions-row" style="flex-wrap:wrap">
            <div class="seg-switch" role="group" aria-label="Expected return model">
              <button type="button" data-fc-return-model="black_litterman" aria-pressed="${forecastReturnModel === "black_litterman" ? "true" : "false"}" title="Shrinks 5Y dossier targets toward market equilibrium using Brier calibration">Black-Litterman</button>
              <button type="button" data-fc-return-model="raw_dossier" aria-pressed="${forecastReturnModel === "raw_dossier" ? "true" : "false"}" title="Uses unshrunk raw 5Y after-tax dossier scenarios">Raw Dossier</button>
            </div>
            <div class="seg-switch" role="group" aria-label="Shock simulation engine">
              <button type="button" data-fc-sim-engine="block_bootstrap" aria-pressed="${forecastSimEngine === "block_bootstrap" ? "true" : "false"}" title="Politis-Romano stationary weekly block bootstrap preserving real crash streaks">Block Bootstrap</button>
              <button type="button" data-fc-sim-engine="student_t" aria-pressed="${forecastSimEngine === "student_t" ? "true" : "false"}" title="Parametric correlated Student-t (df=6) weekly shocks">Student-t</button>
            </div>
            <div class="seg-switch" role="group" aria-label="Forecast horizon">
              ${[1, 3, 5]
                .map(
                  (y) =>
                    `<button type="button" data-fc-horizon="${y}" aria-pressed="${forecastHorizon === y ? "true" : "false"}">${y}Y</button>`,
                )
                .join("")}
            </div>
            <div class="seg-switch" role="group" aria-label="Volatility stress">
              <button type="button" data-fc-vol="1" aria-pressed="${forecastVolMult === 1 ? "true" : "false"}">1.0× Vol</button>
              <button type="button" data-fc-vol="1.25" aria-pressed="${forecastVolMult > 1 ? "true" : "false"}">1.25× Stress</button>
            </div>
            ${
              data.profile.external_exposure.enabled
                ? `<label class="noise-toggle"><input type="checkbox" id="fc-include-ext" ${forecastIncludeExt ? "checked" : ""} /> External Wealth</label>`
                : ""
            }
          </div>
        </div>

        ${forecastError ? `<div class="toast" style="margin-top:0.55rem">${esc(forecastError)}</div>` : ""}
        ${fc?.cash_shortfall_base && fc.cash_shortfall_base > 0 ? `<div class="warn-box" style="margin-top:0.55rem">Planned buys exceed available cash + freed proceeds by ${fmtMoney(fc.cash_shortfall_base, ccy)}; excess buy orders were capped at available cash.</div>` : ""}

        <div style="margin-top:0.75rem">
          ${forecastBusy ? `<div class="muted-sub" style="padding:0.4rem 0">Running correlated simulation...</div>` : ""}
          ${fc ? renderForecastFanSvg(fc, ccy) : `<div class="muted-sub">Click Simulate Plan below to project your portfolio.</div>`}
        </div>

        <div style="margin-top:0.75rem">${kpiHtml}</div>
        ${factorStripHtml}

        ${
          fc && fc.deltas.cured_caps.length > 0
            ? `<div class="muted-sub" style="margin-top:0.55rem"><strong class="pos-ok">Risk caps cured:</strong> ${esc(fc.deltas.cured_caps.join(" · "))}</div>`
            : ""
        }
      </div>

      <div class="hub-grid">
        <div class="card">
          <div class="section-head">
            <h2 class="section-title">1. Toggle Rotations &amp; Swaps</h2>
            <div class="actions-row" style="gap:0.25rem">
              <button type="button" class="small ghost" id="btn-fc-select-all">Select All</button>
              <button type="button" class="small ghost" id="btn-fc-clear-all">Clear All</button>
            </div>
          </div>
          <div class="action-check-list">
            ${rotationChecks.length > 0 ? rotationChecks.join("") : `<div class="muted-sub">No recommended rotations or swaps currently pending.</div>`}
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <h2 class="section-title">2. Deploy Cash &amp; Planned Buys</h2>
            ${canMessage ? `<button type="button" class="small" id="btn-fc-ask-agent">Optimize with Agent</button>` : ""}
          </div>
          <div class="cash-pool-bar">
            <span>Cash + Freed: <strong>${fmtMoney(availCashPool, ccy)}</strong></span>
            <span>Queued Buys: <strong>${fmtMoney(plannedBuysTotal, ccy)}</strong></span>
            <span>Remaining: <strong class="${projectedLeftoverCash > 0 ? "pos-ok" : ""}">${fmtMoney(projectedLeftoverCash, ccy)}</strong></span>
          </div>
          <form id="fc-add-buy-form" class="buy-builder-form">
            <label>Ticker
              <input id="fc-buy-ticker" list="fc-ticker-opts" type="text" value="${esc(forecastBuyTicker)}" placeholder="e.g. NVDA" required />
              <datalist id="fc-ticker-opts">${tickerOpts}</datalist>
            </label>
            <label>Amount (${esc(ccy)})
              <input id="fc-buy-amount" type="number" min="100" step="500" value="${forecastBuyAmount}" required />
            </label>
            <button type="submit" class="primary small">+ Add Buy</button>
          </form>
          <div class="preset-row" style="margin-top:0.4rem">
            ${[15000, 25000, 50000].map((amt) => `<button type="button" class="small ghost fc-preset-amt" data-amt="${amt}">${fmtCompact(amt, ccy)}</button>`).join("")}
            ${projectedLeftoverCash >= 500 ? `<button type="button" class="small ghost fc-preset-amt" data-amt="${Math.round(projectedLeftoverCash)}">All Left (${fmtCompact(projectedLeftoverCash, ccy)})</button>` : ""}
          </div>
          ${buyChipsHtml}
          <label class="bt-check-label" style="margin-top:0.55rem">
            <input type="checkbox" id="fc-park-cash" ${forecastParkCash ? "checked" : ""} />
            Auto-sweep leftover cash above reserve into ${esc(benchTicker)}
          </label>
        </div>
      </div>

      ${
        fc
          ? `
        <div class="card">
          <div class="section-head">
            <div>
              <h2 class="section-title">Post-Action Allocation, Risk Contribution &amp; Sizing Guide</h2>
              <div class="muted-sub">Compare Marginal Risk Share against return-driven ¼-Kelly and cluster-diversified HRP weights.</div>
            </div>
          </div>
          <div tabindex="0" role="region" aria-labelledby="cap-fc-pos" class="table-wrapper">
            <table>
              <caption id="cap-fc-pos">Simulated Holdings &amp; Risk Contribution (${fc.positions.length} rows)</caption>
              <thead>
                <tr>
                  <th scope="col">Holding</th>
                  <th scope="col" class="num">Weight Before &rarr; After</th>
                  <th scope="col" class="num">${fc.return_model === "black_litterman" ? "BL CAGR" : "Exp. CAGR"}</th>
                  <th scope="col" class="num">Risk Share</th>
                  <th scope="col" class="num">Corr Hurdle</th>
                  <th scope="col" class="num">¼-Kelly</th>
                  <th scope="col" class="num">HRP Balanced</th>
                </tr>
              </thead>
              <tbody>${posRowsHtml}</tbody>
            </table>
          </div>
          <div class="muted-sub" style="margin-top:0.5rem">${esc(fc.methodology_note)}</div>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderHoldings(data: DashboardPayload): string {
  const ccy = data.base_currency;
  const showSitus = data.summary.us_situs_enabled;
  const q = searchQuery.trim().toUpperCase();
  const thesisByTicker = new Map(data.theses.map((t) => [t.ticker.toUpperCase(), t]));

  const sortArrow = (k: SortKey) => (sortKey === k ? (sortAsc ? " ▲" : " ▼") : "");
  const ariaSort = (k: SortKey) => (sortKey === k ? (sortAsc ? "ascending" : "descending") : "none");

  const filteredPositions = data.portfolio.positions
    .filter((p) => !q || p.ticker.includes(q) || p.name.toUpperCase().includes(q))
    .slice()
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "change_1d_pct") cmp = (a.change_1d_pct ?? -999) - (b.change_1d_pct ?? -999);
      else cmp = a[sortKey] - b[sortKey];
      return sortAsc ? cmp : -cmp;
    });

  const posRows = filteredPositions.length
    ? filteredPositions
        .map((p) => {
          const grade = thesisByTicker.get(p.ticker.toUpperCase())?.fundamentals_summary?.latest_ratios.quality_grade;
          return `
          <tr class="clickable-row" data-inspect-ticker="${esc(p.ticker)}">
            <th scope="row">
              <button type="button" class="ticker-link" data-inspect-ticker="${esc(p.ticker)}">${esc(p.ticker)}</button>
              ${qualityGradeBadge(grade, true)}
              ${p.stale ? '<span class="status-tag"><span class="dot warn"></span>Stale</span>' : ""}
              ${showSitus ? `<div class="muted-sub">${p.us_situs ? "US-Situs" : "Exempt"} · ${esc(p.domicile)}</div>` : `<div class="muted-sub">${esc(p.asset_type)}</div>`}
            </th>
            <td class="num" data-label="Price">
              <div>${fmtMoney(p.price, p.currency, p.price < 10 ? 4 : 2)}</div>
              ${renderExtendedPriceTag(p.regular_price ?? p.price, p.extended_price, p.market_state, p.currency)}
            </td>
            <td class="num" data-label="1D %">${fmtDeltaText(p.change_1d_pct, "", true)}</td>
            <td class="spark-cell" data-label="30D">${renderSparklineSvg(p.sparkline, { width: 74, height: 20, positive: p.change_1m_pct !== null ? p.change_1m_pct >= 0 : null, label: `${p.ticker} 30-day trend` })}</td>
            <td class="num" data-label="Value ${esc(ccy)}">${fmtMoney(p.mv_base, ccy)}</td>
            <td class="num" data-label="Wt %"><strong>${fmtPct(p.weight_nav_pct, 2)}</strong></td>
            <td class="num" data-label="P&L %">${fmtDeltaText(p.pnl_pct, "", true)}</td>
          </tr>
        `;
        })
        .join("")
    : `<tr><td colspan="7">No positions match "${esc(searchQuery)}".</td></tr>`;

  const filteredLt = data.lookthrough.filter((r) => !q || r.name.toUpperCase().includes(q));
  const ltRows = filteredLt.length
    ? filteredLt
        .map((r) => {
          const clickTicker = r.name.includes("/") ? r.name.split("/")[0]! : r.name;
          return `
            <tr class="clickable-row" data-inspect-ticker="${esc(clickTicker)}">
              <th scope="row"><button type="button" class="ticker-link" data-inspect-ticker="${esc(clickTicker)}">${esc(r.name)}</button></th>
              <td class="num" data-label="Direct USD">${fmtMoney(r.direct_usd, "USD", 0)}</td>
              <td class="num" data-label="Via ETFs USD">${fmtMoney(r.via_etfs_usd, "USD", 0)}</td>
              <td class="num" data-label="Total ${esc(ccy)}">${fmtMoney(r.total_base, ccy)}</td>
              <td class="num" data-label="% NAV"><strong>${fmtPct(r.pct_nav, 2)}</strong></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5">No look-through exposures match "${esc(searchQuery)}".</td></tr>`;

  const tableHtml =
    holdingsMode === "positions"
      ? `
        <div tabindex="0" role="region" aria-labelledby="cap-pos" class="table-wrapper">
          <table>
            <caption id="cap-pos">Positions (${filteredPositions.length} shown · click any row for full research dossier)</caption>
            <thead>
              <tr>
                <th scope="col" aria-sort="${ariaSort("ticker")}"><button type="button" class="sort-btn" data-sort="ticker">Ticker${sortArrow("ticker")}</button></th>
                <th scope="col" class="num">Price</th>
                <th scope="col" class="num" aria-sort="${ariaSort("change_1d_pct")}"><button type="button" class="sort-btn" data-sort="change_1d_pct">1D %${sortArrow("change_1d_pct")}</button></th>
                <th scope="col">30D Trend</th>
                <th scope="col" class="num" aria-sort="${ariaSort("mv_base")}"><button type="button" class="sort-btn" data-sort="mv_base">Value ${esc(ccy)}${sortArrow("mv_base")}</button></th>
                <th scope="col" class="num" aria-sort="${ariaSort("weight_nav_pct")}"><button type="button" class="sort-btn" data-sort="weight_nav_pct">Wt %${sortArrow("weight_nav_pct")}</button></th>
                <th scope="col" class="num" aria-sort="${ariaSort("pnl_pct")}"><button type="button" class="sort-btn" data-sort="pnl_pct">P&amp;L %${sortArrow("pnl_pct")}</button></th>
              </tr>
            </thead>
            <tbody>${posRows}</tbody>
          </table>
        </div>
      `
      : `
        <div tabindex="0" role="region" aria-labelledby="cap-lt" class="table-wrapper">
          <table>
            <caption id="cap-lt">True Look-Through Single-Name Exposure (Direct + Underlying ETFs)</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" class="num">Direct USD</th>
                <th scope="col" class="num">Via ETFs</th>
                <th scope="col" class="num">Total ${esc(ccy)}</th>
                <th scope="col" class="num">% NAV</th>
              </tr>
            </thead>
            <tbody>${ltRows}</tbody>
          </table>
        </div>
      `;

  const ext = data.profile.external_exposure;
  const reserve = data.profile.liquidity_reserve;
  const showSim = ext.enabled || reserve.enabled;
  const sim = computeSimulatorMetrics(data);
  const extMax = Math.max(500000, Math.ceil((Math.max(simExtBase, 1) * 2) / 50000) * 50000);
  const resMax = Math.max(200000, Math.ceil((Math.max(simReserveBase, 1) * 2) / 25000) * 25000);
  const hasPaired = Boolean(ext.enabled && ext.paired_tickers && ext.paired_tickers.length > 0);
  const extPresets = [0, 100000, Math.round(extMax * 0.4), Math.round(extMax * 0.7)].filter((v, i, a) => a.indexOf(v) === i);
  const resPresets = [0, 30000, 100000, Math.round(resMax * 0.75)].filter((v, i, a) => a.indexOf(v) === i);

  const stressHtml = showSim
    ? `
      <details class="holdings-stress-disclosure">
        <summary>
          <span>Outside Wealth &amp; Cash Reserve Assumptions</span>
          <span class="muted-sub">${ext.enabled ? `${esc(ext.label)} ${fmtCompact(simExtBase, ccy)}` : ""}${ext.enabled && reserve.enabled ? " · " : ""}${reserve.enabled ? `Reserve ${fmtCompact(simReserveBase, ccy)}` : ""}</span>
        </summary>
        <div style="margin-top:0.75rem">
          <div class="sim-grid">
            ${
              ext.enabled
                ? `
              <div class="sim-field">
                <label for="sim-ext"><span>${esc(ext.label)}</span><span id="sim-ext-lbl">${fmtMoney(simExtBase, ccy)}</span></label>
                <input id="sim-ext" type="range" min="0" max="${extMax}" step="${Math.round(extMax / 40)}" value="${simExtBase}" />
                <div class="preset-row">${extPresets.map((v) => `<button type="button" class="small" data-preset-ext="${v}">${fmtCompact(v, ccy)}</button>`).join("")}</div>
              </div>
            `
                : ""
            }
            ${
              reserve.enabled
                ? `
              <div class="sim-field">
                <label for="sim-res"><span>${esc(reserve.label)}</span><span id="sim-res-lbl">${fmtMoney(simReserveBase, ccy)}</span></label>
                <input id="sim-res" type="range" min="0" max="${resMax}" step="${Math.round(resMax / 40)}" value="${simReserveBase}" />
                <div class="preset-row">${resPresets.map((v) => `<button type="button" class="small" data-preset-res="${v}">${fmtCompact(v, ccy)}</button>`).join("")}</div>
              </div>
            `
                : ""
            }
          </div>
          <div id="sim-results" class="sim-results">
            ${ext.enabled ? `<div class="metric-cell"><span class="micro-label">${esc(ext.ticker || "External")} % Wealth</span><span class="metric-val">${fmtPct(sim.extPct)}</span></div>` : ""}
            ${hasPaired ? `<div class="metric-cell"><span class="micro-label">${esc(data.summary.paired_label)}</span><span class="metric-val">${fmtPct(sim.pairedPct)}</span></div>` : ""}
            <div class="metric-cell"><span class="micro-label">Portfolio Cash Left</span><span class="metric-val ${sim.cashSurplusBase < 0 ? "pos-bad" : ""}">${fmtMoney(sim.cashSurplusBase, ccy)}</span></div>
            ${
              data.summary.us_situs_enabled
                ? `<div class="metric-cell"><span class="micro-label">Est. US Estate Tax</span><span class="metric-val pos-bad">${fmtMoney(sim.estateTaxBase, ccy)}</span></div>`
                : `<div class="metric-cell"><span class="micro-label">Net Investable</span><span class="metric-val">${fmtMoney(sim.netInvestableBase, ccy)}</span></div>`
            }
          </div>
          <div class="actions-row" style="margin-top:0.65rem;justify-content:flex-end">
            <button type="button" class="primary small" id="btn-save-ext" ${data.is_demo ? "disabled" : ""}>Save Assumptions</button>
          </div>
        </div>
      </details>
    `
    : "";

  return `
    <div class="panel-body">
      <div class="desk-toolbar">
        <div class="seg-switch" role="group" aria-label="Holdings table view">
          <button type="button" data-holdings-mode="positions" aria-pressed="${holdingsMode === "positions" ? "true" : "false"}">Positions (${data.portfolio.positions.length})</button>
          <button type="button" data-holdings-mode="lookthrough" aria-pressed="${holdingsMode === "lookthrough" ? "true" : "false"}">Look-Through (${data.lookthrough.length})</button>
        </div>
        <span class="muted-sub">Click any row or press / to inspect a company dossier</span>
      </div>
      ${tableHtml}
      ${stressHtml}
    </div>
  `;
}

function matchesThesisSubFilter(t: ThesisRow, f: ThesisSubFilter): boolean {
  if (f === "all") return true;
  const s = t.status.toUpperCase();
  if (f === "buy") return t.action_verdict === "GO" || s.includes("BUY") || s.includes("DEEP") || t.reentry_alert;
  if (f === "gated") return t.gated || s.includes("GATE") || t.action_verdict === "WAIT";
  if (f === "trim") return s.includes("TRIM") || s.includes("EXIT");
  return Boolean(t.provenance?.needs_retest);
}

function renderProvenanceFooter(t: ThesisRow): string {
  const prov = t.provenance;
  const audited = prov?.last_audited_date || t.last_tested_date || null;
  const drift = prov?.price_drift_pct;
  const driftHtml =
    drift !== null && drift !== undefined
      ? `<span class="${prov?.price_drift_alert ? "pos-warn" : ""}">${drift > 0 ? "+" : ""}${drift.toFixed(1)}% vs audit</span>`
      : "";
  const kinds = Array.from(new Set((prov?.sources ?? []).map((s) => s.kind)));
  if (t.has_intel && !kinds.includes("ibkr")) kinds.push("ibkr");
  if (t.has_model && !kinds.includes("model")) kinds.push("model");
  const badgesHtml = kinds.map((k) => `<span class="src-badge">${esc(k)}</span>`).join("");
  const retestStamp = prov?.needs_retest
    ? `<span class="retest-stamp" title="${esc(prov.retest_reasons.join(" · "))}"><span class="dot warn"></span>Needs Re-Test</span>`
    : "";

  return `
    <div class="provenance-foot">
      <span>${audited ? `Audited ${esc(audited)}` : "Unaudited"}${driftHtml ? ` · ${driftHtml}` : ""}</span>
      <div class="src-badges">${badgesHtml}${retestStamp}</div>
    </div>
  `;
}

function renderTheses(data: DashboardPayload, canMessage: boolean): string {
  if (!data.theses.length) {
    const btn = canMessage
      ? `<div style="margin-top:0.65rem"><button type="button" class="primary" id="btn-create-thesis">Ask Agent: Create My First Dossier</button></div>`
      : "";
    return `
      <div class="panel-body">
        <div class="card empty-state">
          No living dossiers stored in <code>\${PLUGIN_DATA}/theses/</code> yet.
          ${btn}
        </div>
      </div>
    `;
  }

  const q = searchQuery.trim().toUpperCase();
  const roster = getRosterCounts(data);
  const tierMatched = data.theses.filter((t) => {
    const tier = t.tier || "active";
    if (thesisTier !== "all" && tier !== thesisTier) return false;
    return !q || t.ticker.includes(q) || t.role.toUpperCase().includes(q);
  });

  const subCounts = {
    all: tierMatched.length,
    buy: tierMatched.filter((t) => matchesThesisSubFilter(t, "buy")).length,
    gated: tierMatched.filter((t) => matchesThesisSubFilter(t, "gated")).length,
    trim: tierMatched.filter((t) => matchesThesisSubFilter(t, "trim")).length,
    retest: tierMatched.filter((t) => matchesThesisSubFilter(t, "retest")).length,
  };

  const shown = tierMatched.filter((t) => matchesThesisSubFilter(t, thesisFilter));

  const cards = shown.length
    ? shown
        .map((t) => {
          const scen = t.scenario_summary;
          const kpiHtml = scen
            ? `
              <div class="thesis-kpi-strip">
                <div class="thesis-kpi-main">
                  <span class="micro-label">Exp. After-Tax CAGR</span>
                  <strong>${scen.expected_after_tax_cagr_pct.toFixed(1)}%</strong>
                  <span class="muted-sub">vs ${scen.tax_info.hurdle_cagr_pct.toFixed(1)}% hurdle</span>
                </div>
                <span class="delta-text ${scen.spread_vs_hurdle_pct >= 0 ? "pos-ok" : "pos-bad"}">${fmtSignedPct(scen.spread_vs_hurdle_pct, 1)}</span>
              </div>
            `
            : `
              <div class="thesis-kpi-strip">
                <span class="muted-sub">5Y After-Tax Scenario Model</span>
                <span class="muted-sub">Unmodeled</span>
              </div>
            `;

          const zoneOrReentry =
            t.tier === "passed"
              ? `
                <div class="reentry-box ${t.reentry_alert ? "triggered" : ""}">
                  <div class="hypothesis-head">
                    <span class="micro-label">Re-Entry Trigger</span>
                    ${t.reentry_alert ? `<span class="status-tag"><span class="dot ok"></span>RE-ENTRY HIT</span>` : t.reentry_price !== null ? `<span class="muted-sub">&lt;= ${fmtMoney(t.reentry_price, t.currency, 2)}</span>` : ""}
                  </div>
                  <div>${esc(t.reentry_trigger || t.rejection_reason || "Passed — no re-entry trigger defined.")}</div>
                </div>
              `
              : renderTriggerRuler(t.price, t.buy_zone_low, t.buy_zone_high, t.trim_zone, t.currency);

          const lines = (t.takeaway && t.takeaway.length > 0 ? t.takeaway : t.core_summary).slice(0, 3);
          const takeawayHtml = lines.length
            ? `<ul class="takeaway-list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
            : `<div class="muted-sub">${esc(t.rejection_reason || t.latest_decision || "Open dossier to add 3-line executive takeaway.")}</div>`;

          const qGrade = t.fundamentals_summary?.latest_ratios.quality_grade;

          return `
            <article class="thesis-card">
              <div class="thesis-head">
                <div>
                  <div class="actions-row" style="gap:0.35rem">
                    <button type="button" class="ticker-link" data-inspect-ticker="${esc(t.ticker)}">${esc(t.ticker)}</button>
                    ${qualityGradeBadge(qGrade)}
                  </div>
                  ${t.role ? `<div class="muted-sub">${esc(t.role)}</div>` : ""}
                </div>
                <div class="actions-row" style="gap:4px">
                  ${actionVerdictPill(t.action_verdict)}
                  ${t.gated ? `<span class="status-tag"><span class="dot warn"></span>Gated</span>` : verdictTag(t.verdict)}
                </div>
              </div>
              <div class="thesis-price-row">
                <div>
                  <div class="actions-row" style="gap:0.35rem;align-items:baseline">
                    <div class="thesis-price">${fmtMoney(t.price, t.currency, 2)}</div>
                    ${renderExtendedPriceTag(t.regular_price ?? t.price, t.extended_price, t.market_state, t.currency)}
                  </div>
                  <div class="actions-row" style="gap:0.35rem">
                    ${fmtDeltaText(t.change_1d_pct, "1D", true)}
                    ${t.max_weight_pct !== null && t.tier !== "passed" ? `<span class="muted-sub">· Cap ${t.max_weight_pct}%</span>` : ""}
                    ${t.intel_summary?.implied_move_pct ? `<span class="muted-sub">· ±${t.intel_summary.implied_move_pct.toFixed(1)}% IV</span>` : ""}
                    ${(t.softening_warnings?.length ?? 0) > 0 ? `<span class="auto-badge warn">Softening</span>` : ""}
                  </div>
                </div>
                ${renderSparklineSvg(t.sparkline, { width: 84, height: 26, positive: t.change_1m_pct !== null ? t.change_1m_pct >= 0 : null, fillArea: true, label: `${t.ticker} 30-day trend` })}
              </div>
              ${kpiHtml}
              ${zoneOrReentry}
              ${takeawayHtml}
              ${renderProvenanceFooter(t)}
              <div class="actions-row" style="justify-content:space-between;margin-top:auto">
                <button type="button" class="small" data-inspect-ticker="${esc(t.ticker)}">Open Dossier</button>
                ${canMessage ? `<button type="button" class="small ghost ask-deep-research" data-ticker="${esc(t.ticker)}">Deep Research</button>` : ""}
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="card empty-state">No dossiers match the active tier and filter.</div>`;

  const themes = data.themes ?? [];
  const themesSectionHtml =
    themes.length > 0
      ? `
      <div class="card">
        <div class="section-head" style="margin-bottom:0.4rem">
          <h2 class="section-title">Shared Research Themes</h2>
          <span class="muted-sub">Cross-stock macro &amp; industry debates</span>
        </div>
        <div class="theme-strip">
          ${themes
            .map(
              (th) => `
            <button type="button" class="theme-pill" data-inspect-theme="${esc(th.slug)}">
              <span>${esc(th.title)}</span>
              <span class="src-badge">${esc(th.relationship_mode.replace(/_/g, " "))}</span>
              <span class="muted-sub">${th.exposures.length} stocks</span>
            </button>
          `,
            )
            .join("")}
        </div>
      </div>
    `
      : "";

  return `
    <div class="panel-body">
      ${themesSectionHtml}
      <div class="filter-stack">
        <div class="seg-switch" role="group" aria-label="Filter dossiers by tier">
          <button type="button" data-tier-filter="active" aria-pressed="${thesisTier === "active" ? "true" : "false"}">Active (${roster.active}/${roster.cap})</button>
          <button type="button" data-tier-filter="bench" aria-pressed="${thesisTier === "bench" ? "true" : "false"}">Bench (${roster.bench})</button>
          <button type="button" data-tier-filter="passed" aria-pressed="${thesisTier === "passed" ? "true" : "false"}">Passed (${roster.passed})</button>
          <button type="button" data-tier-filter="all" aria-pressed="${thesisTier === "all" ? "true" : "false"}">All (${data.theses.length})</button>
        </div>
        <div class="seg-switch" role="group" aria-label="Filter dossiers by status">
          <button type="button" data-thesis-filter="all" aria-pressed="${thesisFilter === "all" ? "true" : "false"}">All (${subCounts.all})</button>
          <button type="button" data-thesis-filter="buy" aria-pressed="${thesisFilter === "buy" ? "true" : "false"}">Go / Buy (${subCounts.buy})</button>
          <button type="button" data-thesis-filter="gated" aria-pressed="${thesisFilter === "gated" ? "true" : "false"}">Wait / Gated (${subCounts.gated})</button>
          <button type="button" data-thesis-filter="trim" aria-pressed="${thesisFilter === "trim" ? "true" : "false"}">Trim (${subCounts.trim})</button>
          <button type="button" data-thesis-filter="retest" aria-pressed="${thesisFilter === "retest" ? "true" : "false"}">Needs Re-Test (${subCounts.retest})</button>
        </div>
      </div>
      <div class="thesis-grid">${cards}</div>
    </div>
  `;
}

function renderEdgar(data: DashboardPayload, canOpenLinks: boolean): string {
  const unackAlerts = (data.alerts ?? []).filter((a) => !a.acknowledged);
  const urgentAlerts = unackAlerts.filter((a) => !isRoutineNoiseAlert(a) && a.severity === "high");
  const backgroundAlerts = unackAlerts.filter((a) => isRoutineNoiseAlert(a) || a.severity !== "high");

  const renderAlertRow = (a: WatchdogAlert) => `
    <div class="alert-row">
      <button type="button" class="alert-row-main" ${a.ticker ? `data-inspect-ticker="${esc(a.ticker)}"` : a.theme_slug ? `data-inspect-theme="${esc(a.theme_slug)}"` : ""}>
        <span class="queue-title">${esc(cleanAlertTitle(a.title, a.ticker))}</span>
        <span class="queue-sub">${esc(a.detected_at.slice(0, 10))}${a.detail ? ` · ${esc(a.detail)}` : ""}</span>
      </button>
      <div class="alert-right">
        <span class="status-tag ${a.severity === "info" ? "quiet" : ""}"><span class="dot ${a.severity === "high" ? "bad" : a.severity === "medium" ? "warn" : ""}"></span>${esc(a.severity.toUpperCase())}</span>
        ${!data.is_demo ? `<button type="button" class="small ghost btn-ack-alert" data-alert-id="${esc(a.id)}">Done</button>` : ""}
      </div>
    </div>
  `;

  const watchdogArchiveCard = `
    <div class="card">
      <div class="section-head">
        <div>
          <h2 class="section-title">Watchdog Signal Log</h2>
          <div class="muted-sub">High-priority deltas surface on Overview; routine/background events stay archived here for agent context.</div>
        </div>
        <div class="actions-row" style="gap:0.3rem">
          ${unackAlerts.length > 0 && !data.is_demo ? `<button type="button" class="small" id="btn-ack-all-alerts">Clear All (${unackAlerts.length})</button>` : ""}
          <button type="button" class="small" id="btn-run-watchdog-edgar" ${busyMessage || data.is_demo ? "disabled" : ""}>Run Watchdog</button>
        </div>
      </div>
      ${
        urgentAlerts.length > 0
          ? `<div class="micro-label" style="margin-bottom:0.25rem">High Priority (${urgentAlerts.length})</div>${urgentAlerts.map(renderAlertRow).join("")}`
          : `<div class="muted-sub" style="padding:0.3rem 0">No unacknowledged high-priority alerts.</div>`
      }
      ${
        backgroundAlerts.length > 0
          ? `<details class="cap-pass-disclosure"><summary>Show ${backgroundAlerts.length} routine &amp; medium background alert${backgroundAlerts.length > 1 ? "s" : ""}</summary><div style="margin-top:0.35rem">${backgroundAlerts.slice(0, 40).map(renderAlertRow).join("")}</div></details>`
          : ""
      }
    </div>
  `;

  const materialRedFlags = (data.sec_red_flags ?? []).filter((rf) => rf.severity !== "info");
  const infoRedFlags = (data.sec_red_flags ?? []).filter((rf) => rf.severity === "info");

  const renderRfRow = (rf: SecRedFlag) => {
    const safeUrl = rf.url && rf.url.startsWith("https://www.sec.gov/") ? rf.url : "";
    return `
      <div class="timeline-item">
        <div>
          <span class="status-tag ${rf.severity === "info" ? "quiet" : ""}"><span class="dot ${rf.severity === "high" ? "bad" : rf.severity === "medium" ? "warn" : ""}"></span>${esc(rf.code)}</span>
          <button type="button" class="ticker-link" data-inspect-ticker="${esc(rf.ticker)}" style="margin-left:0.25rem">${esc(rf.ticker)}</button>
          <strong>${esc(rf.form)}</strong>
          <div class="muted-sub">${esc(rf.filingDate)} · ${esc(rf.label)}</div>
        </div>
        ${canOpenLinks && safeUrl ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">SEC ↗</button>` : ""}
      </div>
    `;
  };

  const gateRows = data.edgar.gate_evaluations
    .map(
      (g) => `
      <div class="timeline-item">
        <div>
          <span class="status-tag"><span class="dot ${g.cleared ? "ok" : "warn"}"></span>${g.cleared ? "Cleared" : "Open Gate"}</span>
          <button type="button" class="ticker-link" data-inspect-ticker="${esc(g.ticker)}" style="margin-left:0.25rem">${esc(g.ticker)}</button>
          <span class="muted-sub">(${esc(g.form)} &gt; ${esc(g.filed_after)})</span>
          <div class="muted-sub">${esc(g.description)}${g.latest_matching_date ? ` · Filed ${esc(g.latest_matching_date)}` : ""}</div>
        </div>
      </div>
    `,
    )
    .join("");

  const catRows = data.catalysts.length
    ? data.catalysts
        .map((c) => {
          const countdown = daysUntilLabel(c.date);
          return `
            <div class="timeline-item">
              <div>
                <button type="button" class="ticker-link" data-inspect-ticker="${esc(c.ticker)}">${esc(c.ticker)}</button>
                <strong>${esc(c.title)}</strong>
                <div class="muted-sub">${esc(c.date)} · ${esc(c.detail)}</div>
              </div>
              <div class="actions-row">
                <span class="status-tag ${countdown.cls === "muted" ? "quiet" : ""}"><span class="dot ${countdown.cls}"></span>${esc(countdown.label)}</span>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="muted-sub">No catalyst events tracked yet.</div>`;

  const filingsEntries = Object.entries(data.edgar.filings_by_ticker || {});
  const filingsHtml = filingsEntries.length
    ? `<details class="holdings-stress-disclosure"><summary><span>Recent SEC Filings by Ticker (${filingsEntries.length} companies)</span><span class="muted-sub">Expand raw filing index</span></summary><div class="hub-grid" style="margin-top:0.7rem">${filingsEntries
        .map(([sym, rows]) => {
          const items = rows
            .slice(0, 4)
            .map((r) => {
              const safeUrl = r.url.startsWith("https://www.sec.gov/") ? r.url : "";
              const linkBtn =
                canOpenLinks && safeUrl
                  ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">SEC ↗</button>`
                  : `<span class="muted-sub">${esc(r.accession)}</span>`;
              return `
                <div class="filing-item">
                  <span><strong>${esc(r.filingDate)}</strong> · ${esc(r.form)} ${r.items ? `[${esc(r.items)}]` : ""}</span>
                  ${linkBtn}
                </div>
              `;
            })
            .join("");
          return `<div class="card"><div class="section-head"><button type="button" class="ticker-link" data-inspect-ticker="${esc(sym)}">${esc(sym)}</button><span class="muted-sub">${rows.length} recent</span></div>${items}</div>`;
        })
        .join("")}</div></details>`
    : `<div class="card empty-state">Click "Poll SEC EDGAR Live" to fetch recent 10-K, 10-Q, 8-K, 20-F, 6-K, and DEF 14A filings.</div>`;

  return `
    <div class="panel-body">
      ${watchdogArchiveCard}
      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">SEC Filing Gates, Material Events &amp; Catalysts</h2>
            <div class="muted-sub">${data.edgar.checked_at ? `Last SEC check: ${esc(data.edgar.checked_at)}` : "SEC filings not polled yet"}</div>
          </div>
          <button type="button" class="primary small" id="btn-poll-edgar" ${busyMessage || data.is_demo ? "disabled" : ""}>Poll SEC EDGAR</button>
        </div>
        ${materialRedFlags.length > 0 ? materialRedFlags.slice(0, 12).map(renderRfRow).join("") : ""}
        ${gateRows}
        <div style="margin-top:0.35rem">${catRows}</div>
        ${
          infoRedFlags.length > 0
            ? `<details class="cap-pass-disclosure"><summary>Show ${infoRedFlags.length} routine 8-K:5.02 governance/comp notices (agent metadata)</summary><div style="margin-top:0.35rem">${infoRedFlags.slice(0, 20).map(renderRfRow).join("")}</div></details>`
            : ""
        }
      </div>
      ${filingsHtml}
    </div>
  `;
}

function fmtRollRange(m: BacktestSeriesMetrics): string {
  if (m.rolling_3y_cagr_min_pct === null || m.rolling_3y_cagr_median_pct === null || m.rolling_3y_cagr_max_pct === null) {
    return "— (<3Y)";
  }
  return `${m.rolling_3y_cagr_min_pct.toFixed(1)}% / ${m.rolling_3y_cagr_median_pct.toFixed(1)}% / ${m.rolling_3y_cagr_max_pct.toFixed(1)}%`;
}

function renderBacktestOutput(res: BacktestResult): string {
  const srcCount = Object.keys(res.data_sources || {}).length;
  const ibkrCount = Object.values(res.data_sources || {}).filter((s) => s === "ibkr").length;
  const yahooCount = Object.values(res.data_sources || {}).filter((s) => s === "yahoo").length;
  const srcStamp =
    ibkrCount > 0 || yahooCount > 0
      ? `${ibkrCount > 0 ? `IBKR (${ibkrCount})` : ""}${ibkrCount > 0 && yahooCount > 0 ? " + " : ""}${yahooCount > 0 ? `Yahoo (${yahooCount})` : ""}`
      : `${srcCount} series`;

  const deltaFmt = (val: number, suffix = "", higherBetter = true) => {
    const good = higherBetter ? val >= 0 : val <= 0;
    const cls = Math.abs(val) < 0.01 ? "muted-sub" : good ? "pos-ok" : "pos-bad";
    return `<span class="${cls}">${val > 0 ? "+" : ""}${val.toFixed(2)}${suffix}</span>`;
  };

  const regimeRows = res.regimes.length
    ? res.regimes
        .map(
          (r) => `
        <tr>
          <th scope="row">${esc(r.label)}<div class="muted-sub">${esc(r.start)} – ${esc(r.end)} (${r.weeks}w)</div></th>
          <td class="num">${fmtSignedPct(r.baseline_cagr_pct, 1)}</td>
          <td class="num"><strong>${fmtSignedPct(r.simulated_cagr_pct, 1)}</strong></td>
          <td class="num">${fmtPct(r.baseline_dd_pct, 1)}</td>
          <td class="num">${fmtPct(r.simulated_dd_pct, 1)}</td>
        </tr>
      `,
        )
        .join("")
    : `<tr><td colspan="5" class="muted-sub">Insufficient overlapping weeks to split macro regimes.</td></tr>`;

  const corrList = res.top_correlations.length
    ? res.top_correlations.map((c) => `${esc(c.ticker)} (${c.corr.toFixed(2)})`).join(" · ")
    : "N/A";

  const fmtSharpeCell = (m: BacktestSeriesMetrics, bold = false) => {
    const main = bold ? `<strong>${m.sharpe.toFixed(2)}</strong>` : m.sharpe.toFixed(2);
    const se = m.sharpe_se !== null && m.sharpe_se !== undefined ? ` <span class="muted-sub">±${m.sharpe_se.toFixed(2)}</span>` : "";
    return `${main}${se}`;
  };

  const fxConverted = res.fx_converted_tickers ?? [];
  const metaBadges: string[] = [];
  if (res.rf_pct !== undefined) metaBadges.push(`<span class="src-badge">Rf ${res.rf_pct.toFixed(2)}%</span>`);
  if (res.tx_cost_bps !== undefined) metaBadges.push(`<span class="src-badge">Tx ${res.tx_cost_bps.toFixed(0)}bps</span>`);
  if (res.trials_tested !== undefined) metaBadges.push(`<span class="src-badge">DSR M=${res.trials_tested}</span>`);
  if (res.include_external_wealth) metaBadges.push(`<span class="src-badge">Ext Wealth On</span>`);
  if (fxConverted.length > 0) metaBadges.push(`<span class="src-badge">FX: ${esc(fxConverted.join(", "))}</span>`);
  if (res.baseline.rebalance_count !== undefined || res.simulated.rebalance_count !== undefined) {
    metaBadges.push(`<span class="src-badge">Rebal ${res.baseline.rebalance_count ?? 0} / ${res.simulated.rebalance_count ?? 0}</span>`);
  }

  const fmtDsrCell = (prob: number | undefined) => {
    if (prob === undefined || prob === null) return "—";
    const cls = prob >= 80 ? "pos-ok" : prob >= 50 ? "pos-warn" : "pos-bad";
    return `<strong class="${cls}">${prob.toFixed(1)}%</strong>`;
  };

  return `
    <div style="display:flex;flex-direction:column;gap:0.65rem;margin-top:0.65rem">
      <div class="actions-row" style="justify-content:space-between">
        <div class="muted-sub">
          Overlap <strong>${esc(res.overlap_start)} → ${esc(res.overlap_end)}</strong> (${res.weeks_analyzed}w) · Sources: ${esc(srcStamp)} · Band: ±${res.rebalance_band_pct}%
        </div>
        ${metaBadges.length > 0 ? `<div class="src-badges">${metaBadges.join("")}</div>` : ""}
      </div>

      ${renderEquityCurveSvg(res)}

      <div class="compact-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" class="num">Baseline</th>
              <th scope="col" class="num">Simulated</th>
              <th scope="col" class="num">Delta</th>
              <th scope="col" class="num">${esc(res.benchmark_symbol)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">CAGR</th>
              <td class="num">${fmtPct(res.baseline.cagr_pct, 2)}</td>
              <td class="num"><strong>${fmtPct(res.simulated.cagr_pct, 2)}</strong></td>
              <td class="num">${deltaFmt(res.deltas.cagr_pct, "%", true)}</td>
              <td class="num">${fmtPct(res.benchmark.cagr_pct, 2)}</td>
            </tr>
            <tr>
              <th scope="row">Max Drawdown</th>
              <td class="num">${fmtPct(res.baseline.max_drawdown_pct, 2)}</td>
              <td class="num"><strong>${fmtPct(res.simulated.max_drawdown_pct, 2)}</strong></td>
              <td class="num">${deltaFmt(res.deltas.max_drawdown_pct, "%", true)}</td>
              <td class="num">${fmtPct(res.benchmark.max_drawdown_pct, 2)}</td>
            </tr>
            <tr>
              <th scope="row">Ann. Volatility</th>
              <td class="num">${fmtPct(res.baseline.volatility_pct, 2)}</td>
              <td class="num">${fmtPct(res.simulated.volatility_pct, 2)}</td>
              <td class="num">${deltaFmt(res.simulated.volatility_pct - res.baseline.volatility_pct, "%", false)}</td>
              <td class="num">${fmtPct(res.benchmark.volatility_pct, 2)}</td>
            </tr>
            <tr>
              <th scope="row">Sharpe ± SE</th>
              <td class="num">${fmtSharpeCell(res.baseline)}</td>
              <td class="num">${fmtSharpeCell(res.simulated, true)}</td>
              <td class="num">${deltaFmt(res.deltas.sharpe, "", true)}</td>
              <td class="num">${fmtSharpeCell(res.benchmark)}</td>
            </tr>
            <tr>
              <th scope="row">Sortino</th>
              <td class="num">${res.baseline.sortino.toFixed(2)}</td>
              <td class="num"><strong>${res.simulated.sortino.toFixed(2)}</strong></td>
              <td class="num">${deltaFmt(res.deltas.sortino, "", true)}</td>
              <td class="num">${res.benchmark.sortino.toFixed(2)}</td>
            </tr>
            <tr>
              <th scope="row" title="Probability true Sharpe exceeds multiple-testing luck threshold (Bailey &amp; López de Prado)">Deflated Sharpe Prob</th>
              <td class="num">${fmtDsrCell(res.baseline.deflated_sharpe_prob_pct)}</td>
              <td class="num">${fmtDsrCell(res.simulated.deflated_sharpe_prob_pct)}</td>
              <td class="num muted-sub">${res.sr0_annual_threshold !== undefined ? `SR₀ ${res.sr0_annual_threshold.toFixed(2)}` : "—"}</td>
              <td class="num">${fmtDsrCell(res.benchmark.deflated_sharpe_prob_pct)}</td>
            </tr>
            <tr>
              <th scope="row" title="Average weekly return in the worst 5% of weeks (Expected Shortfall)">Weekly CVaR 95%</th>
              <td class="num">${res.baseline.cvar_95_weekly_pct !== undefined ? fmtPct(res.baseline.cvar_95_weekly_pct, 2) : "—"}</td>
              <td class="num"><strong>${res.simulated.cvar_95_weekly_pct !== undefined ? fmtPct(res.simulated.cvar_95_weekly_pct, 2) : "—"}</strong></td>
              <td class="num">${res.simulated.cvar_95_weekly_pct !== undefined && res.baseline.cvar_95_weekly_pct !== undefined ? deltaFmt(res.simulated.cvar_95_weekly_pct - res.baseline.cvar_95_weekly_pct, "%", true) : "—"}</td>
              <td class="num">${res.benchmark.cvar_95_weekly_pct !== undefined ? fmtPct(res.benchmark.cvar_95_weekly_pct, 2) : "—"}</td>
            </tr>
            <tr>
              <th scope="row">Rebalances &amp; Slippage</th>
              <td class="num">${res.baseline.rebalance_count ?? 0} (${res.baseline.tx_cost_drag_bps ?? 0} bps/yr)</td>
              <td class="num">${res.simulated.rebalance_count ?? 0} (${res.simulated.tx_cost_drag_bps ?? 0} bps/yr)</td>
              <td class="num muted-sub">${res.simulated.total_turnover_pct !== undefined ? `${res.simulated.total_turnover_pct.toFixed(0)}% turn` : "—"}</td>
              <td class="num">0</td>
            </tr>
            <tr>
              <th scope="row">Rolling 3Y (Min/Med/Max)</th>
              <td class="num">${esc(fmtRollRange(res.baseline))}</td>
              <td class="num">${esc(fmtRollRange(res.simulated))}</td>
              <td class="num muted-sub">—</td>
              <td class="num">${esc(fmtRollRange(res.benchmark))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="corr-strip">
        <span>Corr vs Portfolio: <strong>${res.candidate_corr_portfolio !== null ? res.candidate_corr_portfolio.toFixed(2) : "N/A"}</strong></span>
        ${res.candidate_corr_cluster !== null ? `<span>Corr vs Primary Cluster: <strong>${res.candidate_corr_cluster.toFixed(2)}</strong></span>` : ""}
        <span>Top Correlated: <strong>${corrList}</strong></span>
      </div>

      <div class="compact-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th scope="col">Historical Regime</th>
              <th scope="col" class="num">Base CAGR</th>
              <th scope="col" class="num">Sim CAGR</th>
              <th scope="col" class="num">Base DD</th>
              <th scope="col" class="num">Sim DD</th>
            </tr>
          </thead>
          <tbody>${regimeRows}</tbody>
        </table>
      </div>

      <div class="muted-sub">${esc(res.caveat)}</div>
    </div>
  `;
}

function renderLab(data: DashboardPayload): string {
  const ccy = data.base_currency;
  const lab = data.lab;
  const activeRes = backtestResult ?? lab?.latest_backtest ?? null;
  const q = searchQuery.trim().toUpperCase();

  const tickerOpts = data.theses
    .map((t) => `<option value="${esc(t.ticker)}">${esc(t.ticker)} (${esc(t.tier || "active")})</option>`)
    .join("");

  const swapOpts = data.portfolio.positions
    .slice()
    .sort((a, b) => b.weight_nav_pct - a.weight_nav_pct)
    .map((p) => {
      const val = `swap:${p.ticker}`;
      return `<option value="${esc(val)}" ${btFunding === val ? "selected" : ""}>Swap from ${esc(p.ticker)} (${p.weight_nav_pct.toFixed(1)}%)</option>`;
    })
    .join("");

  const triageRows = (lab?.dip_triage_queue ?? [])
    .filter((r) => !q || r.ticker.includes(q))
    .map((r) => {
      const targetStr =
        r.tier === "passed"
          ? r.reentry_price !== null
            ? `Re-Entry <= ${fmtMoney(r.reentry_price, r.currency, 2)}`
            : "Passed"
          : r.next_tranche_price !== null
            ? `${fmtMoney(r.next_tranche_price, r.currency, 2)}${r.next_tranche_base ? ` (${fmtCompact(r.next_tranche_base, ccy)})` : ""}`
            : r.buy_zone_low !== null && r.buy_zone_high !== null
              ? `${fmtMoney(r.buy_zone_low, r.currency, 0)}–${fmtMoney(r.buy_zone_high, r.currency, 0)}`
              : "—";

      const readyLabel = r.readiness.replace(/_/g, " ");
      const isAnchor = r.hurdle_status === "CORE_ANCHOR";
      const spreadHtml = isAnchor
        ? `<span class="auto-badge ok">CORE ANCHOR</span>`
        : r.spread_vs_hurdle_pct !== null
          ? `<span class="${r.spread_vs_hurdle_pct >= 0 ? "pos-ok" : "pos-bad"}">${fmtSignedPct(r.spread_vs_hurdle_pct, 1)}</span>`
          : `<span class="muted-sub">—</span>`;

      const swapRoom = r.single_name_room_pct !== undefined ? `${r.single_name_room_pct.toFixed(1)}%` : "—";
      const netRoom = r.portfolio_cap_room_pct !== undefined ? `${r.portfolio_cap_room_pct.toFixed(1)}%` : "—";
      const dualRoomHtml =
        r.single_name_room_pct !== undefined || r.portfolio_cap_room_pct !== undefined
          ? `<span title="Single-Name Swap Room vs Portfolio Net-Add Room">${swapRoom} / ${netRoom}</span>`
          : `<span class="muted-sub">—</span>`;

      return `
        <tr class="clickable-row" data-inspect-ticker="${esc(r.ticker)}">
          <th scope="row">
            <button type="button" class="ticker-link" data-inspect-ticker="${esc(r.ticker)}">${esc(r.ticker)}</button>
            <span class="src-badge">${esc(r.tier)}</span>
            ${r.high_vol_staged ? `<span class="src-badge" title="High-Vol Staged (2-3 weeks between tranches)">2-3w</span>` : ""}
          </th>
          <td data-label="Readiness"><span class="status-tag ${checkDotClass(r.readiness) ? "" : "quiet"}"><span class="dot ${checkDotClass(r.readiness)}"></span>${esc(readyLabel)}</span></td>
          <td class="num" data-label="Price">${fmtMoney(r.price, r.currency, 2)}</td>
          <td data-label="Checks">
            <span class="triage-dots" title="Cap: ${esc(r.cap_status)} · Gate: ${esc(r.gate_status)} · Hurdle: ${esc(r.hurdle_status)}">
              <span class="triage-dot-item"><span class="dot ${checkDotClass(r.cap_status)}"></span>Cap</span>
              <span class="triage-dot-item"><span class="dot ${checkDotClass(r.gate_status)}"></span>Gate</span>
              <span class="triage-dot-item"><span class="dot ${checkDotClass(r.hurdle_status)}"></span>${isAnchor ? "Anchor" : "Hurdle"}</span>
            </span>
          </td>
          <td class="num" data-label="Swap / Net Room">${dualRoomHtml}</td>
          <td class="num" data-label="vs Hurdle">${spreadHtml}</td>
          <td class="num" data-label="Next Tranche">${esc(targetStr)}</td>
        </tr>
      `;
    })
    .join("");

  const deployableCash = data.summary.deployable_cash_base;
  const freedRotation = data.rotation_queue?.total_freed_base ?? 0;
  const totalFunding = data.summary.available_funding_base ?? deployableCash + freedRotation;
  const fundingStripHtml = `
    <div class="funding-strip">
      <span>Deployable Cash: <strong>${fmtMoney(deployableCash, ccy)}</strong></span>
      <span>Priority Sells/Swaps: <strong>+${fmtMoney(freedRotation, ccy)}</strong></span>
      <span>Paired Funding Pool: <strong class="pos-ok">${fmtMoney(totalFunding, ccy)}</strong></span>
    </div>
  `;

  const scorecard = lab?.scorecard;
  const pa = lab?.pa_performance;
  const paHtml =
    pa && pa.periods.length > 0
      ? `
      <div class="pa-strip">
        <span class="micro-label" style="align-self:center">Account PA (${esc(pa.provider)})</span>
        ${pa.periods
          .map(
            (p) =>
              `<span><strong>${esc(p.period)}</strong>: TWR ${p.twr_pct !== null && p.twr_pct !== undefined ? fmtSignedPct(p.twr_pct, 2) : "—"}${p.mwr_pct !== null && p.mwr_pct !== undefined ? ` · MWR ${fmtSignedPct(p.mwr_pct, 2)}` : ""}</span>`,
          )
          .join("")}
      </div>
    `
      : "";

  const verdictTilesHtml = scorecard
    ? scorecard.by_verdict
        .filter((v) => v.count > 0)
        .map(
          (v) => `
          <div class="scorecard-tile">
            <span class="micro-label">${esc(v.verdict.replace(/_/g, " "))} (${v.evaluated_count}m${v.pending_count ? ` · ${v.pending_count}p` : ""})</span>
            <span class="metric-val">${v.hit_rate_pct !== null ? `${v.hit_rate_pct.toFixed(0)}% hit` : "Pending (<30d)"}</span>
            <span class="muted-sub">Avg ${fmtSignedPct(v.avg_return_pct, 1)} · Alpha ${fmtSignedPct(v.avg_alpha_pct, 1)}</span>
          </div>
        `,
        )
        .join("")
    : "";

  const horizonBuckets = scorecard?.horizon_buckets ?? [];
  const horizonHtml =
    horizonBuckets.length > 0
      ? `
      <div class="horizon-grid">
        ${horizonBuckets
          .map(
            (b) => `
          <div class="scorecard-tile">
            <span class="micro-label">${esc(b.horizon)} Horizon (${b.count})</span>
            <span class="metric-val">${b.hit_rate_pct !== null ? `${b.hit_rate_pct.toFixed(0)}% hit` : "—"}</span>
            <span class="muted-sub">Alpha ${fmtSignedPct(b.avg_alpha_pct, 1)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `
      : "";

  const brier = scorecard?.brier_calibration;
  const brierHtml = brier
    ? `
      <div class="brier-strip">
        <span class="micro-label">Hypothesis Brier Calibration</span>
        <span>Resolved: <strong>${brier.resolved_total}</strong></span>
        <span>Overall Brier: <strong>${brier.overall_brier_score !== null ? brier.overall_brier_score.toFixed(3) : "—"}</strong></span>
        ${brier.tiers
          .map(
            (t) =>
              `<span><strong>${esc(t.confidence.toUpperCase())}</strong> (${Math.round(t.predicted_prob * 100)}% pred): ${t.empirical_rate_pct !== null ? `${t.empirical_rate_pct.toFixed(0)}%` : "—"} (${t.supported_count}/${t.resolved_count})</span>`,
          )
          .join("")}
      </div>
    `
    : "";

  const scorecardEntries = (scorecard?.entries ?? []).filter((e) => !q || e.ticker.includes(q));
  const scorecardRows = scorecardEntries.length
    ? scorecardEntries
        .slice(0, 25)
        .map((e) => {
          const isPending = e.maturity === "PENDING" || e.days_elapsed < 30;
          const statusBadge = isPending
            ? `<span class="status-tag quiet">PENDING</span>`
            : e.hit === true
              ? `<span class="auto-badge ok">HIT</span>`
              : e.hit === false
                ? `<span class="auto-badge bad">MISS</span>`
                : `<span class="status-tag quiet">MATURED</span>`;
          return `
        <tr class="clickable-row" data-inspect-ticker="${esc(e.ticker)}">
          <th scope="row">
            <button type="button" class="ticker-link" data-inspect-ticker="${esc(e.ticker)}">${esc(e.ticker)}</button>
            <div class="muted-sub">${esc(e.test_date)} (${e.days_elapsed}d)</div>
          </th>
          <td data-label="Verdict">${verdictTag(e.verdict)} ${statusBadge}</td>
          <td class="num" data-label="Test → Live">${fmtMoney(e.price_at_test, e.currency, 2)} &rarr; ${fmtMoney(e.current_price, e.currency, 2)}</td>
          <td class="num" data-label="Stock %">${fmtDeltaText(e.stock_return_pct)}</td>
          <td class="num" data-label="Bench %">${fmtDeltaText(e.benchmark_return_pct)}</td>
          <td class="num" data-label="Alpha %">${fmtDeltaText(e.alpha_pct)}</td>
        </tr>
      `;
        })
        .join("")
    : `<tr><td colspan="6" class="muted-sub">No priced systematic tests logged yet in <code>test_log.jsonl</code>.</td></tr>`;

  return `
    <div class="panel-body">
      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">Portfolio-Impact &amp; Regime Backtester</h2>
            <div class="muted-sub">Deterministic weekly overlap simulation vs current portfolio and ${esc(lab?.benchmark_summary.benchmark_label || "Core Benchmark")} (${fmtPct(lab?.benchmark_summary.hurdle_cagr_pct ?? 10.5, 1)} hurdle).</div>
          </div>
        </div>
        <form id="lab-backtest-form" class="v4-form">
          <div class="lab-form-grid">
            <label>Candidate Ticker
              <input id="bt-ticker" list="bt-ticker-options" type="text" value="${esc(btTicker)}" placeholder="e.g. TICKER" required />
              <datalist id="bt-ticker-options">${tickerOpts}</datalist>
            </label>
            <label>Target Weight (%)
              <input id="bt-weight" type="number" min="1" max="15" step="0.5" value="${btWeight}" required />
            </label>
            <label>Funding Source
              <select id="bt-funding">
                <option value="cash" ${btFunding === "cash" ? "selected" : ""}>Cash</option>
                <option value="pro_rata" ${btFunding === "pro_rata" ? "selected" : ""}>Pro-Rata Trim</option>
                ${swapOpts}
              </select>
            </label>
            <label>Rebalance Band (%)
              <input id="bt-band" type="number" min="5" max="100" step="5" value="${btBand}" required />
            </label>
            <label>Tx Cost (bps)
              <input id="bt-tx-bps" type="number" min="0" max="100" step="2" value="${btTxCostBps}" />
            </label>
            <label title="Number of candidate ideas tested (M) for Deflated Sharpe multiple-testing filter">Ideas Tested (M)
              <input id="bt-trials" type="number" min="1" max="200" step="1" value="${btTrialsTested > 0 ? btTrialsTested : ""}" placeholder="Auto (${data.theses.length || 1})" />
            </label>
            <button type="submit" class="primary" id="btn-run-backtest" ${backtestBusy ? "disabled" : ""}>${backtestBusy ? "Running..." : "Run Deterministic Backtest"}</button>
          </div>
          ${
            data.profile.external_exposure.enabled
              ? `<label class="bt-check-label"><input type="checkbox" id="bt-include-ext" ${btIncludeExternal ? "checked" : ""} /> Include External Wealth (${esc(data.profile.external_exposure.label)}) in baseline, simulated weights &amp; correlation</label>`
              : ""
          }
        </form>
        ${backtestError ? `<div class="toast" style="margin-top:0.55rem">${esc(backtestError)}</div>` : ""}
        ${activeRes ? renderBacktestOutput(activeRes) : `<div class="muted-sub" style="margin-top:0.55rem">Select any Active, Bench, Passed, or custom ticker and run a deterministic historical impact test.</div>`}
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">4-Check Dip Triage Queue</h2>
            <div class="muted-sub">Sorted by readiness (Buy Zone, Re-Entry Hit, Gated ahead of Cap-Blocked, Wait) · Click any row to inspect dossier.</div>
          </div>
        </div>
        ${fundingStripHtml}
        <div tabindex="0" role="region" aria-labelledby="cap-triage" class="table-wrapper">
          <table>
            <caption id="cap-triage">Opportunity Readiness &amp; Tranche Queue (${lab?.dip_triage_queue.length ?? 0} tracked)</caption>
            <thead>
              <tr>
                <th scope="col">Ticker</th>
                <th scope="col">Readiness</th>
                <th scope="col" class="num">Price</th>
                <th scope="col">Cap · Gate · Hurdle</th>
                <th scope="col" class="num">Swap / Net Room</th>
                <th scope="col" class="num">vs Hurdle</th>
                <th scope="col" class="num">Next Tranche / Trigger</th>
              </tr>
            </thead>
            <tbody>${triageRows || `<tr><td colspan="7" class="muted-sub">No opportunities configured yet.</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">Forward Judgment Scorecard</h2>
            <div class="muted-sub">Evaluates matured (30d+) <code>test_log.jsonl</code> verdicts against live prices and ${esc(scorecard?.benchmark_symbol || "benchmark")} (immature &lt;30d isolated as Pending).</div>
          </div>
          <span class="muted-sub">${scorecard ? `${scorecard.matured_count ?? 0} matured · ${scorecard.pending_count ?? 0} pending (${scorecard.total_tests} total)` : ""}</span>
        </div>
        ${paHtml}
        ${verdictTilesHtml ? `<div class="scorecard-summary-grid">${verdictTilesHtml}</div>` : ""}
        ${horizonHtml}
        ${brierHtml}
        <div tabindex="0" role="region" aria-labelledby="cap-scorecard" class="table-wrapper">
          <table>
            <caption id="cap-scorecard">Forward Audit Outcomes</caption>
            <thead>
              <tr>
                <th scope="col">Ticker / Date</th>
                <th scope="col">Verdict</th>
                <th scope="col" class="num">Test &rarr; Live</th>
                <th scope="col" class="num">Stock %</th>
                <th scope="col" class="num">Bench %</th>
                <th scope="col" class="num">Alpha %</th>
              </tr>
            </thead>
            <tbody>${scorecardRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderValuationSection(
  thesis: ThesisRow | undefined,
  detail: DossierDetail | undefined,
  currency: string,
  isDemo: boolean,
): string {
  const rdcf = thesis?.reverse_dcf;
  const scen = thesis?.scenario_summary;
  const model = detail?.model;

  const hasBridge =
    rdcf &&
    (rdcf.multiple_expansion_cagr_pct !== undefined ||
      rdcf.margin_expansion_cagr_pct !== undefined ||
      rdcf.residual_revenue_cagr_pct !== undefined ||
      rdcf.constant_mult_margin_rev_cagr_pct !== undefined);

  const rdcfBridgeHtml =
    rdcf && hasBridge
      ? `
      <div class="rdcf-bridge">
        ${rdcf.current_multiple !== null && rdcf.current_multiple !== undefined ? `<span>Current: <strong>${rdcf.current_multiple.toFixed(1)}x</strong> &rarr; ${rdcf.exit_multiple.toFixed(1)}x</span>` : ""}
        ${rdcf.multiple_expansion_cagr_pct !== null && rdcf.multiple_expansion_cagr_pct !== undefined ? `<span>Multiple: <strong>${fmtSignedPct(rdcf.multiple_expansion_cagr_pct, 1)}</strong></span>` : ""}
        ${rdcf.margin_expansion_cagr_pct !== null && rdcf.margin_expansion_cagr_pct !== undefined ? `<span>Margin: <strong>${fmtSignedPct(rdcf.margin_expansion_cagr_pct, 1)}</strong></span>` : ""}
        ${rdcf.residual_revenue_cagr_pct !== null && rdcf.residual_revenue_cagr_pct !== undefined ? `<span>Residual Rev: <strong>${fmtSignedPct(rdcf.residual_revenue_cagr_pct, 1)}</strong></span>` : ""}
        ${rdcf.consensus_rev_growth_pct !== null && rdcf.consensus_rev_growth_pct !== undefined ? `<span>Street NTM Rev: <strong>${rdcf.consensus_rev_growth_pct.toFixed(1)}%</strong>${rdcf.expectations_gap_vs_consensus_pct !== null && rdcf.expectations_gap_vs_consensus_pct !== undefined ? ` (${fmtSignedPct(rdcf.expectations_gap_vs_consensus_pct, 1)} gap)` : ""}</span>` : ""}
        ${rdcf.constant_mult_margin_rev_cagr_pct !== null && rdcf.constant_mult_margin_rev_cagr_pct !== undefined ? `<span>Const-Mult Baseline: <strong>${fmtPct(rdcf.constant_mult_margin_rev_cagr_pct, 1)}</strong></span>` : ""}
        ${rdcf.net_cash_b !== null && rdcf.net_cash_b !== undefined ? `<span>Net Cash: <strong>${fmtMoney(rdcf.net_cash_b, currency, 2)}B</strong></span>` : ""}
        ${rdcf.annual_dilution_pct ? `<span>Dilution: <strong>${fmtSignedPct(rdcf.annual_dilution_pct, 1)}/yr</strong></span>` : ""}
      </div>
    `
      : "";

  const rdcfHtml = rdcf
    ? `
      <div class="rdcf-box">
        <div class="hypothesis-head">
          <span class="micro-label">Reverse DCF (${esc(rdcf.basis.toUpperCase())} Basis · ${rdcf.horizon_years}Y)</span>
          <span class="muted-sub">Req. Gross CAGR ${rdcf.required_gross_cagr_pct.toFixed(1)}% (Hurdle ${rdcf.hurdle_cagr_pct.toFixed(1)}% + ${rdcf.total_tax_drag_pct.toFixed(2)}% tax)</span>
        </div>
        <div class="rdcf-grid">
          <div class="metric-cell">
            <span class="micro-label">Implied 5Y Price</span>
            <span class="metric-val">${fmtMoney(rdcf.implied_target_price_5y, currency, 2)}</span>
          </div>
          <div class="metric-cell">
            <span class="micro-label">Implied ${esc(rdcf.basis.toUpperCase())} CAGR</span>
            <span class="metric-val">${fmtPct(rdcf.implied_metric_cagr_pct, 1)}</span>
            <span class="muted-sub">at ${rdcf.exit_multiple.toFixed(1)}x exit</span>
          </div>
          ${
            rdcf.implied_revenue_cagr_pct !== null
              ? `
            <div class="metric-cell">
              <span class="micro-label">Implied Rev CAGR</span>
              <span class="metric-val">${fmtPct(rdcf.implied_revenue_cagr_pct, 1)}</span>
              ${rdcf.base_revenue_cagr_pct !== null ? `<span class="muted-sub">Base ${fmtPct(rdcf.base_revenue_cagr_pct, 1)} (${fmtSignedPct(rdcf.revenue_cagr_gap_pct, 1)})</span>` : ""}
            </div>
          `
              : ""
          }
        </div>
        ${rdcfBridgeHtml}
        ${rdcf.metric_basis_note ? `<div class="muted-sub">Basis: ${esc(rdcf.metric_basis_note)}</div>` : ""}
        ${
          rdcf.linked_hypothesis_ids.length > 0
            ? `<div class="chip-row"><span class="muted-sub">Linked claims:</span>${rdcf.linked_hypothesis_ids.map((id) => `<span class="mono-chip">${esc(id)}</span>`).join("")}</div>`
            : ""
        }
        ${rdcf.notes ? `<div class="muted-sub">${esc(rdcf.notes)}</div>` : ""}
      </div>
    `
    : `<div class="muted-sub">No Reverse DCF inputs stored yet in <code>model.json</code>.</div>`;

  const valWarnings = scen?.valuation_warnings ?? [];
  const valWarningsHtml =
    valWarnings.length > 0
      ? `
      <div class="warn-box" role="status">
        <span class="micro-label pos-warn">Outside-View Sanity Warnings</span>
        ${valWarnings.map((w) => `<div>• ${esc(w)}</div>`).join("")}
      </div>
    `
      : "";

  const kellyLineHtml =
    scen && scen.standalone_kelly_cagr_pct !== undefined
      ? `<div class="kelly-subline">Standalone Kelly CAGR: <strong>${scen.standalone_kelly_cagr_pct.toFixed(1)}%</strong>${scen.dispersion_drag_bps !== undefined ? ` (dispersion drag ${scen.dispersion_drag_bps.toFixed(0)} bps)` : ""}${scen.tax_info.estate_tax_drag_mode ? ` · Estate mode: ${esc(scen.tax_info.estate_tax_drag_mode)}` : ""}${scen.tax_info.accumulating ? " · Accumulating ETF (0% dist. WHT)" : ""}</div>`
      : "";

  const scenTableHtml = scen
    ? `
      <div class="compact-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col" class="num">Prob</th>
              <th scope="col" class="num">5Y Target</th>
              <th scope="col" class="num">Gross</th>
              <th scope="col" class="num">After-Tax</th>
              <th scope="col">Summary</th>
            </tr>
          </thead>
          <tbody>
            ${(["bear", "base", "bull"] as const)
              .map((k) => {
                const c = scen.cases[k];
                return `
                  <tr>
                    <th scope="row" style="text-transform:capitalize">${k}</th>
                    <td class="num">${(c.probability * 100).toFixed(0)}%</td>
                    <td class="num"><strong>${fmtMoney(c.target_price_5y, currency, 2)}</strong></td>
                    <td class="num">${fmtSignedPct(c.gross_cagr_pct, 1)}</td>
                    <td class="num">${fmtDeltaText(c.after_tax_cagr_pct)}</td>
                    <td class="wrap-cell muted-sub">${esc(c.summary)}</td>
                  </tr>
                `;
              })
              .join("")}
            <tr>
              <th scope="row">Expected</th>
              <td class="num">100%</td>
              <td class="num"><strong>${fmtMoney(scen.expected_price_5y, currency, 2)}</strong></td>
              <td class="num">${fmtSignedPct(scen.expected_gross_cagr_pct, 1)}</td>
              <td class="num"><strong>${fmtDeltaText(scen.expected_after_tax_cagr_pct)}</strong></td>
              <td class="wrap-cell">vs Bench <strong>${fmtSignedPct(scen.spread_vs_benchmark_pct, 1)}</strong> · vs Hurdle <strong class="${scen.spread_vs_hurdle_pct >= 0 ? "pos-ok" : "pos-bad"}">${fmtSignedPct(scen.spread_vs_hurdle_pct, 1)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${kellyLineHtml}
      ${valWarningsHtml}
    `
    : `<div class="muted-sub">No 5Y Bear/Base/Bull scenarios modeled yet. Add targets below to compute after-tax CAGR vs hurdle.</div>`;

  const bearTarget = model?.scenarios?.bear.target_price_5y ?? scen?.cases.bear.target_price_5y ?? "";
  const baseTarget = model?.scenarios?.base.target_price_5y ?? scen?.cases.base.target_price_5y ?? "";
  const bullTarget = model?.scenarios?.bull.target_price_5y ?? scen?.cases.bull.target_price_5y ?? "";
  const bearProb = model?.scenarios?.bear.probability ?? scen?.cases.bear.probability ?? 0.25;
  const baseProb = model?.scenarios?.base.probability ?? scen?.cases.base.probability ?? 0.5;
  const bullProb = model?.scenarios?.bull.probability ?? scen?.cases.bull.probability ?? 0.25;

  const editFormHtml = !isDemo
    ? `
      <details class="add-hyp-details">
        <summary>Edit Bear / Base / Bull Targets &amp; Probabilities</summary>
        <div class="v4-form" style="display:flex;flex-direction:column;gap:0.45rem;margin-top:0.45rem">
          <div class="model-edit-grid">
            <label>Bear 5Y Target <input type="number" step="any" id="mod-bear-px" value="${bearTarget}" /></label>
            <label>Base 5Y Target <input type="number" step="any" id="mod-base-px" value="${baseTarget}" /></label>
            <label>Bull 5Y Target <input type="number" step="any" id="mod-bull-px" value="${bullTarget}" /></label>
            <label>Bear Prob (0-1) <input type="number" step="0.05" min="0" max="1" id="mod-bear-p" value="${bearProb}" /></label>
            <label>Base Prob (0-1) <input type="number" step="0.05" min="0" max="1" id="mod-base-p" value="${baseProb}" /></label>
            <label>Bull Prob (0-1) <input type="number" step="0.05" min="0" max="1" id="mod-bull-p" value="${bullProb}" /></label>
          </div>
          <label class="rationale-label">Rationale (logged to rule-change audit)
            <input type="text" id="mod-rationale" maxlength="300" placeholder="Why are you changing 5Y targets or probabilities?" />
          </label>
          <div class="actions-row">
            <button type="button" class="small primary" id="btn-save-dossier-model" ${inspectorLoading ? "disabled" : ""}>${inspectorLoading ? "Loading model..." : "Save Valuation Model"}</button>
          </div>
        </div>
      </details>
    `
    : "";

  return `${rdcfHtml}${scenTableHtml}${editFormHtml}`;
}

function renderDipTriageSection(thesis: ThesisRow | undefined, currency: string, baseCcy: string): string {
  const dt = thesis?.dip_triage;
  if (!dt) {
    return `<div class="muted-sub">No dip triage rules computed for this ticker yet.</div>`;
  }

  const trancheContent =
    thesis?.tier === "passed"
      ? `
        <div class="reentry-box ${dt.reentry_alert ? "triggered" : ""}">
          <div class="hypothesis-head">
            <span class="triage-step-title">4. Passed Re-Entry Watch</span>
            <span class="status-tag"><span class="dot ${dt.reentry_alert ? "ok" : ""}"></span>${dt.reentry_alert ? "TRIGGER HIT" : "MONITORING"}</span>
          </div>
          <div>${esc(thesis.reentry_trigger || "No re-entry trigger recorded.")}${thesis.reentry_price !== null ? ` (Price <= ${fmtMoney(thesis.reentry_price, currency, 2)})` : ""}</div>
        </div>
      `
      : dt.tranche_plan.length > 0
        ? `
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead>
                <tr>
                  <th scope="col">4. Staged Tranche Plan</th>
                  <th scope="col" class="num">Price</th>
                  <th scope="col" class="num">% Add</th>
                  <th scope="col" class="num">Est. ${esc(baseCcy)}</th>
                </tr>
              </thead>
              <tbody>
                ${dt.tranche_plan
                  .map(
                    (tr) => `
                  <tr>
                    <th scope="row">${esc(tr.label)}</th>
                    <td class="num"><strong>${fmtMoney(tr.price, currency, 2)}</strong></td>
                    <td class="num">${tr.pct_of_add.toFixed(0)}%</td>
                    <td class="num">${fmtMoney(tr.amount_base, baseCcy, 0)}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : `<div class="muted-sub">4. Set Buy Low / Buy High trigger zones to auto-stage 2–3 buy tranches.</div>`;

  const dualHeadroomNote =
    dt.risk_cap_check.single_name_room_pct !== undefined || dt.risk_cap_check.portfolio_cap_room_pct !== undefined
      ? ` · Swap Room ${dt.risk_cap_check.single_name_room_pct !== undefined ? `${dt.risk_cap_check.single_name_room_pct.toFixed(1)}%` : "—"} · Net-Add Room ${dt.risk_cap_check.portfolio_cap_room_pct !== undefined ? `${dt.risk_cap_check.portfolio_cap_room_pct.toFixed(1)}%` : "—"}`
      : "";
  const fundingNote =
    dt.risk_cap_check.available_funding_base !== undefined
      ? ` · Paired Funding ${fmtMoney(dt.risk_cap_check.available_funding_base, baseCcy, 0)}`
      : "";

  return `
    ${dt.high_vol_staged ? `<div class="warn-box">High-Vol Staged Mode: space executed buy tranches 2–3 weeks apart.</div>` : ""}
    <div class="triage-list">
      <div class="triage-row">
        <div>
          <div class="triage-step-title">1. Risk Cap Headroom</div>
          <div class="muted-sub">${esc(dt.risk_cap_check.note)} · Current ${dt.risk_cap_check.current_weight_pct.toFixed(1)}% · Room ${fmtMoney(dt.risk_cap_check.room_base, baseCcy, 0)}${dualHeadroomNote}${fundingNote}</div>
        </div>
        <span class="status-tag"><span class="dot ${checkDotClass(dt.risk_cap_check.status)}"></span>${esc(dt.risk_cap_check.status)}</span>
      </div>
      <div class="triage-row">
        <div>
          <div class="triage-step-title">2. Binary &amp; SEC Gate</div>
          <div class="muted-sub">${esc(dt.gate_check.reason)}</div>
        </div>
        <span class="status-tag"><span class="dot ${checkDotClass(dt.gate_check.status)}"></span>${esc(dt.gate_check.status)}</span>
      </div>
      <div class="triage-row">
        <div>
          <div class="triage-step-title">3. After-Tax Hurdle</div>
          <div class="muted-sub">${esc(dt.hurdle_check.note)}</div>
        </div>
        <span class="status-tag"><span class="dot ${checkDotClass(dt.hurdle_check.status)}"></span>${esc(dt.hurdle_check.status.replace(/_/g, " "))}</span>
      </div>
    </div>
    ${trancheContent}
  `;
}

function renderValuationBandRow(label: string, stat: ValuationBandStat | null | undefined): string {
  if (!stat || stat.current === null || stat.p10 === null || stat.median === null || stat.p90 === null) {
    return "";
  }
  const lo = Math.min(stat.p10, stat.current) * 0.92;
  const hi = Math.max(stat.p90, stat.current) * 1.08;
  const span = Math.max(0.01, hi - lo);
  const pos = (v: number) => Math.max(2, Math.min(98, ((v - lo) / span) * 100));
  return `
    <div class="val-band-row">
      <div class="hypothesis-head">
        <span><strong>${esc(label)}</strong> · Current <strong>${stat.current.toFixed(1)}x</strong></span>
        <span class="muted-sub">5Y P10 ${stat.p10.toFixed(1)}x · Med ${stat.median.toFixed(1)}x · P90 ${stat.p90.toFixed(1)}x (${stat.samples}w)</span>
      </div>
      <div class="val-band-track" aria-label="${esc(label)} ${stat.current.toFixed(1)}x vs 5Y median ${stat.median.toFixed(1)}x">
        <div class="val-band-med" style="left:${pos(stat.median).toFixed(1)}%" title="5Y Median ${stat.median.toFixed(1)}x"></div>
        <div class="val-band-pin" style="left:${pos(stat.current).toFixed(1)}%" title="Current ${stat.current.toFixed(1)}x"></div>
      </div>
    </div>
  `;
}

function renderFundamentalsAndBandsSection(
  fundamentals: DossierFundamentals | null | undefined,
  summary: ThesisRow["fundamentals_summary"],
  bands: ValuationBands | null | undefined,
): string {
  const parts: string[] = [];

  if (bands && (bands.pe || bands.pfcf || bands.ps)) {
    const rows = [
      renderValuationBandRow("P/E (TTM)", bands.pe),
      renderValuationBandRow("P/FCF (TTM)", bands.pfcf),
      renderValuationBandRow("P/S (TTM)", bands.ps),
    ].filter(Boolean);
    if (rows.length > 0) {
      parts.push(`
        <div class="rdcf-box">
          <div class="hypothesis-head">
            <span class="micro-label">5Y Historical Valuation Multiple Bands</span>
            ${bands.as_of ? `<span class="muted-sub">As of ${esc(bands.as_of)}</span>` : ""}
          </div>
          <div class="val-band-list">${rows.join("")}</div>
        </div>
      `);
    }
  }

  const ratios = fundamentals?.latest_ratios ?? summary?.latest_ratios;
  if (ratios) {
    const qFlags = ratios.quality_flags ?? [];
    if (ratios.quality_grade || qFlags.length > 0) {
      parts.push(`
        <div class="drawer-card-block">
          <div class="hypothesis-head">
            <span class="micro-label">Capital Quality &amp; Forensic Screen</span>
            ${qualityGradeBadge(ratios.quality_grade)}
          </div>
          <div class="rdcf-grid">
            ${ratios.roic_pct != null ? `<div class="metric-cell"><span class="micro-label">ROIC</span><span class="metric-val">${ratios.roic_pct.toFixed(1)}%</span>${ratios.incremental_roic_pct != null ? `<span class="muted-sub">Incr. ${ratios.incremental_roic_pct.toFixed(1)}%</span>` : ""}</div>` : ""}
            ${ratios.owner_earnings_margin_pct != null ? `<div class="metric-cell"><span class="micro-label">Owner Earn (FCF-SBC)</span><span class="metric-val">${ratios.owner_earnings_margin_pct.toFixed(1)}%</span>${ratios.fcf_margin_pct != null ? `<span class="muted-sub">Headline FCF ${ratios.fcf_margin_pct.toFixed(1)}%</span>` : ""}</div>` : ""}
            ${ratios.accruals_ratio_pct != null ? `<div class="metric-cell"><span class="micro-label">Sloan Accruals</span><span class="metric-val ${ratios.accruals_ratio_pct > 4 ? "pos-warn" : "pos-ok"}">${ratios.accruals_ratio_pct > 0 ? "+" : ""}${ratios.accruals_ratio_pct.toFixed(1)}%</span><span class="muted-sub">Lower = cash-backed</span></div>` : ""}
            ${ratios.sbc_pct_rev != null ? `<div class="metric-cell"><span class="micro-label">SBC / Revenue</span><span class="metric-val ${ratios.sbc_pct_rev >= 8 ? "pos-bad" : ""}">${ratios.sbc_pct_rev.toFixed(1)}%</span>${ratios.diluted_shares_yoy_pct != null ? `<span class="muted-sub">Shares ${fmtSignedPct(ratios.diluted_shares_yoy_pct, 1)} YoY</span>` : ""}</div>` : ""}
          </div>
          ${qFlags.length > 0 ? `<div class="warn-box">${qFlags.map((f) => `<div>• ${esc(f)}</div>`).join("")}</div>` : ""}
        </div>
      `);
    }
    const rChips: string[] = [];
    if (ratios.gross_margin_pct !== null && ratios.gross_margin_pct !== undefined) rChips.push(`GM ${ratios.gross_margin_pct.toFixed(1)}%`);
    if (ratios.operating_margin_pct !== null && ratios.operating_margin_pct !== undefined) rChips.push(`OM ${ratios.operating_margin_pct.toFixed(1)}%`);
    if (ratios.ocf_to_ni_pct !== null && ratios.ocf_to_ni_pct !== undefined) rChips.push(`OCF/NI ${ratios.ocf_to_ni_pct.toFixed(0)}%`);
    if (ratios.fcf_margin_pct !== null && ratios.fcf_margin_pct !== undefined) rChips.push(`FCF ${ratios.fcf_margin_pct.toFixed(1)}%`);
    if (ratios.owner_earnings_margin_pct !== null && ratios.owner_earnings_margin_pct !== undefined) rChips.push(`Owner Earn ${ratios.owner_earnings_margin_pct.toFixed(1)}%`);
    if (ratios.dso_days !== null && ratios.dso_days !== undefined) rChips.push(`DSO ${ratios.dso_days.toFixed(0)}d`);
    if (ratios.net_cash_b !== null && ratios.net_cash_b !== undefined) rChips.push(`Net Cash $${ratios.net_cash_b.toFixed(2)}B`);
    if (rChips.length > 0) {
      parts.push(`<div class="chip-row">${rChips.map((c) => `<span class="mono-chip">${esc(c)}</span>`).join("")}</div>`);
    }
  }

  const periods = (fundamentals?.quarterly?.length ? fundamentals.quarterly : fundamentals?.annual ?? []).slice(0, 8);
  if (periods.length > 0) {
    const fCcy = fundamentals?.currency || summary?.currency || "USD";
    const fmtM = (v: number | null | undefined) =>
      v === null || v === undefined ? "—" : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)}B` : `${v.toFixed(0)}M`;
    const rowsHtml = periods
      .map(
        (p) => `
      <tr>
        <th scope="row">${esc(p.fiscal_period)} ${p.fiscal_year ?? p.period_end.slice(0, 4)}<div class="muted-sub">${esc(p.period_end)}</div></th>
        <td class="num">${fmtM(p.revenue_m)}</td>
        <td class="num">${p.gross_margin_pct !== null && p.gross_margin_pct !== undefined ? `${p.gross_margin_pct.toFixed(1)}%` : "—"}</td>
        <td class="num">${p.ocf_to_ni_pct !== null && p.ocf_to_ni_pct !== undefined ? `${p.ocf_to_ni_pct.toFixed(0)}%` : "—"}</td>
        <td class="num">${p.dso_days !== null && p.dso_days !== undefined ? `${p.dso_days.toFixed(0)}d` : "—"}</td>
        <td class="num">${p.sbc_pct_rev !== null && p.sbc_pct_rev !== undefined ? `${p.sbc_pct_rev.toFixed(1)}%` : "—"}</td>
        <td class="num">${p.net_cash_b !== null && p.net_cash_b !== undefined ? `${p.net_cash_b.toFixed(1)}B` : "—"}</td>
      </tr>
    `,
      )
      .join("");
    parts.push(`
      <div class="compact-table-wrap">
        <table class="compact-table">
          <thead>
            <tr>
              <th scope="col">Period (${esc(fCcy)})</th>
              <th scope="col" class="num">Rev</th>
              <th scope="col" class="num">GM%</th>
              <th scope="col" class="num">OCF/NI</th>
              <th scope="col" class="num">DSO</th>
              <th scope="col" class="num">SBC%</th>
              <th scope="col" class="num">Net Cash</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `);
    parts.push(`<div class="muted-sub">Source: ${esc(fundamentals?.source || "sec_xbrl")} · Updated ${esc((fundamentals?.updated_at || summary?.updated_at || "").slice(0, 10))}</div>`);
  } else if (inspectorLoading) {
    parts.push(`<div class="muted-sub">Loading SEC XBRL financial series...</div>`);
  } else if (parts.length === 0) {
    parts.push(`<div class="muted-sub">No XBRL fundamentals synced yet. Click Watchdog or run <code>sync_fundamentals_xbrl</code>.</div>`);
  }

  return parts.join("");
}

function renderInsidersSection(
  insiders: DossierInsiders | null | undefined,
  summary: ThesisRow["insiders_summary"],
  canOpenLinks: boolean,
): string {
  const w90 = insiders?.window_90d ?? summary?.window_90d;
  const w12 = insiders?.window_12m ?? summary?.window_12m;
  const flags = insiders?.flags ?? summary?.flags ?? [];
  if (!w90 && !w12) {
    return inspectorLoading
      ? `<div class="muted-sub">Loading SEC Form 4 insider flows...</div>`
      : `<div class="muted-sub">No Form 4 insider flows synced yet. Click Watchdog or run <code>sync_insiders_form4</code>.</div>`;
  }

  const fmtUsdCompact = (n: number) => fmtCompact(n, "USD");
  const flagsHtml =
    flags.length > 0
      ? `<div class="chip-row">${flags.map((f) => `<span class="auto-badge ${f.toLowerCase().includes("buy") ? "ok" : "warn"}">${esc(f)}</span>`).join("")}</div>`
      : "";

  const summaryTable = `
    <div class="compact-table-wrap">
      <table class="compact-table">
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col" class="num">Disc. Buys</th>
            <th scope="col" class="num">Disc. Sales</th>
            <th scope="col" class="num">10b5-1 Sales</th>
            <th scope="col" class="num">Buy / Sell Insiders</th>
          </tr>
        </thead>
        <tbody>
          ${
            w90
              ? `<tr><th scope="row">90D</th><td class="num ${w90.disc_buy_usd > 0 ? "pos-ok" : ""}">${fmtUsdCompact(w90.disc_buy_usd)}</td><td class="num ${w90.disc_sell_usd > 0 ? "pos-bad" : ""}">${fmtUsdCompact(w90.disc_sell_usd)}</td><td class="num muted-sub">${fmtUsdCompact(w90.plan_sell_usd)}</td><td class="num">${w90.distinct_buyers} / ${w90.distinct_sellers}</td></tr>`
              : ""
          }
          ${
            w12
              ? `<tr><th scope="row">12M</th><td class="num ${w12.disc_buy_usd > 0 ? "pos-ok" : ""}">${fmtUsdCompact(w12.disc_buy_usd)}</td><td class="num ${w12.disc_sell_usd > 0 ? "pos-bad" : ""}">${fmtUsdCompact(w12.disc_sell_usd)}</td><td class="num muted-sub">${fmtUsdCompact(w12.plan_sell_usd)}</td><td class="num">${w12.distinct_buyers} / ${w12.distinct_sellers}</td></tr>`
              : ""
          }
        </tbody>
      </table>
    </div>
  `;

  const filings = insiders?.recent_filings?.slice(0, 8) ?? [];
  const filingsHtml =
    filings.length > 0
      ? `
      <div>
        <div class="micro-label" style="margin-bottom:0.25rem">Recent Form 4 Transactions</div>
        ${filings
          .map((f) => {
            const safeUrl = f.url && f.url.startsWith("https://www.sec.gov/") ? f.url : "";
            const isBuy = f.code.toUpperCase() === "P";
            return `
              <div class="filing-item">
                <span>
                  <strong>${esc(f.filing_date)}</strong> ·
                  <span class="${isBuy ? "pos-ok" : f.is_10b5_1 ? "muted-sub" : "pos-bad"}">${esc(f.code)}${f.is_10b5_1 ? " (10b5-1)" : ""}</span> ·
                  ${esc(f.owner_name)}${f.title ? ` <span class="muted-sub">(${esc(f.title)})</span>` : ""} ·
                  <strong>${fmtUsdCompact(f.value_usd)}</strong>
                </span>
                ${canOpenLinks && safeUrl ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">SEC</button>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
    `
      : "";

  return `${flagsHtml}${summaryTable}${filingsHtml}`;
}

function renderLinkedThemesSection(
  sym: string,
  thesis: ThesisRow | undefined,
  detail: DossierDetail | undefined,
  allThemes: ThemeObject[],
): string {
  const refs = new Set<string>(thesis?.theme_refs ?? []);
  const linkedMap = new Map<string, ThemeObject>();
  for (const th of detail?.linked_themes ?? []) linkedMap.set(th.slug, th);
  for (const th of allThemes) {
    if (refs.has(th.slug) || th.exposures.some((e) => e.ticker === sym)) {
      linkedMap.set(th.slug, th);
    }
  }
  const linked = Array.from(linkedMap.values());
  if (linked.length === 0) {
    return `<div class="muted-sub">No shared themes linked yet. Link via <code>theme_refs</code> or <code>upsert_theme</code>.</div>`;
  }

  const auditWarn = thesis?.provenance?.theme_updated_after_audit
    ? `<div class="warn-box">A linked shared theme was updated after this dossier's last audit — re-test recommended.</div>`
    : "";

  return `
    ${auditWarn}
    <div style="display:flex;flex-direction:column;gap:0.4rem">
      ${linked
        .map((th) => {
          const exp = th.exposures.find((e) => e.ticker === sym);
          const stanceDot =
            exp?.stance === "beneficiary" || exp?.stance === "hedged_tollbooth"
              ? "ok"
              : exp?.stance === "at_risk"
                ? "bad"
                : "warn";
          return `
            <button type="button" class="rotation-row-btn" data-inspect-theme="${esc(th.slug)}">
              <div class="queue-main">
                <span class="queue-title">${esc(th.title)} <span class="src-badge">${esc(th.relationship_mode.replace(/_/g, " "))}</span></span>
                <span class="queue-sub">${esc(exp?.note || th.summary)}</span>
              </div>
              ${exp ? `<span class="status-tag"><span class="dot ${stanceDot}"></span>${esc(exp.stance.replace(/_/g, " ").toUpperCase())}</span>` : `<span class="status-tag quiet">LINKED</span>`}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderIntelSection(
  intel: DossierIntel | null | undefined,
  intelSummary: ThesisIntelSummary | null | undefined,
  intelHistory: IntelHistoryEntry[] | undefined,
  filings: EdgarFiling[],
  currency: string,
  canOpenLinks: boolean,
): string {
  const blocks: string[] = [];

  if (intel) {
    const ei = intel.earnings_insight;
    if (ei) {
      const safeEiUrl = ei.source_url && ei.source_url.startsWith("https://") ? ei.source_url : "";
      blocks.push(`
        <div class="intel-block">
          <div class="hypothesis-head">
            <span class="micro-label">Earnings Insight (${esc(ei.kind)}${ei.period ? ` · ${esc(ei.period)}` : ""})</span>
            <span class="muted-sub">${esc(ei.published_at || intel.updated_at.slice(0, 10))}</span>
          </div>
          ${ei.headline ? `<div><strong>${esc(ei.headline)}</strong></div>` : ""}
          <div>${esc(ei.summary)}</div>
          ${ei.key_metrics.length > 0 ? `<div class="chip-row">${ei.key_metrics.map((m) => `<span class="mono-chip">${esc(m)}</span>`).join("")}</div>` : ""}
          ${canOpenLinks && safeEiUrl ? `<div><button type="button" class="small ghost open-ext-link" data-url="${esc(safeEiUrl)}">Read Source ↗</button></div>` : ""}
        </div>
      `);
    }

    const opt = intel.options_intel;
    if (opt) {
      blocks.push(`
        <div class="intel-block">
          <div class="hypothesis-head">
            <span class="micro-label">Options Implied Move &amp; IV</span>
            <span class="muted-sub">Exp ${esc(opt.expiry)}${opt.as_of ? ` · As of ${esc(opt.as_of)}` : ""}</span>
          </div>
          <div class="rdcf-grid">
            <div class="metric-cell"><span class="micro-label">Implied Move</span><span class="metric-val">±${opt.implied_move_pct.toFixed(2)}%</span></div>
            ${opt.atm_strike !== null && opt.atm_strike !== undefined ? `<div class="metric-cell"><span class="micro-label">ATM Straddle</span><span class="metric-val">${fmtMoney(opt.straddle_price, currency, 2)}</span><span class="muted-sub">@ ${fmtMoney(opt.atm_strike, currency, 2)}</span></div>` : ""}
            ${opt.call_iv_pct !== null && opt.call_iv_pct !== undefined ? `<div class="metric-cell"><span class="micro-label">Call / Put IV</span><span class="metric-val">${opt.call_iv_pct.toFixed(1)}% / ${opt.put_iv_pct !== null && opt.put_iv_pct !== undefined ? `${opt.put_iv_pct.toFixed(1)}%` : "—"}</span>${opt.iv_skew_pct !== null && opt.iv_skew_pct !== undefined ? `<span class="muted-sub">Skew ${fmtSignedPct(opt.iv_skew_pct, 1)}</span>` : ""}</div>` : ""}
            ${opt.iv_percentile_52w !== null && opt.iv_percentile_52w !== undefined ? `<div class="metric-cell"><span class="micro-label">52W IV Pct</span><span class="metric-val">${opt.iv_percentile_52w.toFixed(1)}th</span></div>` : ""}
          </div>
          ${opt.note ? `<div class="muted-sub">${esc(opt.note)}</div>` : ""}
        </div>
      `);
    }

    if (intel.themes.length > 0 || intel.connections.length > 0) {
      blocks.push(`
        <div class="intel-block">
          ${intel.themes.length > 0 ? `<div class="micro-label">Themes</div><div class="chip-row">${intel.themes.map((th) => `<span class="mono-chip">${esc(th)}</span>`).join("")}</div>` : ""}
          ${
            intel.connections.length > 0
              ? `<div class="micro-label" style="margin-top:4px">Competitors &amp; Supply Chain</div><div class="chip-row">${intel.connections.map((c) => `<span class="mono-chip">${c.ticker ? `<strong>${esc(c.ticker)}</strong> · ` : ""}${esc(c.name)} (${esc(c.relation)})</span>`).join("")}</div>`
              : ""
          }
        </div>
      `);
    }
    blocks.push(`<div class="muted-sub">Intel provider: ${esc(intel.provider)} · Updated ${esc(intel.updated_at)}</div>`);
  } else if (intelSummary) {
    blocks.push(`
      <div class="intel-block">
        <div class="muted-sub">Provider: ${esc(intelSummary.provider)} (${esc(intelSummary.updated_at.slice(0, 10))})</div>
        ${intelSummary.earnings_badge ? `<div>${esc(intelSummary.earnings_badge)}</div>` : ""}
        ${intelSummary.implied_move_pct !== null ? `<div>Options implied move: <strong>±${intelSummary.implied_move_pct.toFixed(1)}%</strong> (${esc(intelSummary.options_expiry || "")})</div>` : ""}
      </div>
    `);
  } else if (inspectorLoading) {
    blocks.push(`<div class="muted-sub">Loading broker &amp; research intelligence...</div>`);
  } else {
    blocks.push(`<div class="muted-sub">No broker intel ingested yet. Use <code>ingest_research_intel</code> to attach earnings insights, options IV, or themes.</div>`);
  }

  if (intelHistory && intelHistory.length > 0) {
    blocks.push(`
      <div>
        <div class="micro-label" style="margin-bottom:0.25rem">Intel History (${intelHistory.length} snapshots)</div>
        <div class="compact-table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th scope="col">Date / Period</th>
                <th scope="col" class="num">EPS Act / Est</th>
                <th scope="col" class="num">Rev ($B)</th>
                <th scope="col" class="num">Impl. Move</th>
              </tr>
            </thead>
            <tbody>
              ${intelHistory
                .slice(0, 6)
                .map(
                  (h) => `
                <tr>
                  <th scope="row">${esc(h.period || h.recorded_at.slice(0, 10))}</th>
                  <td class="num">${h.eps_actual !== null && h.eps_actual !== undefined ? h.eps_actual.toFixed(2) : "—"} / ${h.eps_est !== null && h.eps_est !== undefined ? h.eps_est.toFixed(2) : "—"}</td>
                  <td class="num">${h.rev_actual_b !== null && h.rev_actual_b !== undefined ? h.rev_actual_b.toFixed(2) : "—"}</td>
                  <td class="num">${h.implied_move_pct !== null && h.implied_move_pct !== undefined ? `±${h.implied_move_pct.toFixed(1)}%` : "—"}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }

  if (filings.length > 0) {
    blocks.push(`
      <div>
        <div class="micro-label" style="margin-bottom:0.25rem">Recent SEC EDGAR Filings</div>
        ${filings
          .slice(0, 5)
          .map((r) => {
            const safeUrl = r.url.startsWith("https://www.sec.gov/") ? r.url : "";
            return `
              <div class="filing-item">
                <span><strong>${esc(r.filingDate)}</strong> · ${esc(r.form)} ${r.items ? `[${esc(r.items)}]` : ""}</span>
                ${canOpenLinks && safeUrl ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">Open SEC</button>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
    `);
  }

  return blocks.join("");
}

function captureOpenDisclosures(dlg: HTMLDialogElement): Set<string> | null {
  const existing = dlg.querySelectorAll<HTMLDetailsElement>("details.drawer-disclosure[data-sec-key]");
  if (existing.length === 0) return null;
  const openKeys = new Set<string>();
  existing.forEach((d) => {
    if (d.open && d.dataset.secKey) openKeys.add(d.dataset.secKey);
  });
  return openKeys;
}

function renderInspectorDialog(ticker: string, preserveOpenKeys?: Set<string> | null): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg || !state) return;

  const sym = ticker.toUpperCase();
  const detail = dossierCache.get(sym);
  const pos = state.portfolio.positions.find((p) => p.ticker === sym);
  const thesis = state.theses.find((t) => t.ticker === sym) ?? detail?.thesis ?? undefined;
  const lt = state.lookthrough.find((r) => r.name === sym || (sym.startsWith("GOOG") && r.name === "GOOG/GOOGL"));
  const filings = state.edgar.filings_by_ticker?.[sym] ?? [];

  const price = pos?.price ?? thesis?.price ?? null;
  const currency = pos?.currency ?? thesis?.currency ?? "USD";
  const sparkline = (pos?.sparkline.length ? pos.sparkline : thesis?.sparkline) ?? [];
  const ch1d = pos?.change_1d_pct ?? thesis?.change_1d_pct ?? null;
  const ch1m = pos?.change_1m_pct ?? thesis?.change_1m_pct ?? null;
  const titleName = pos?.name ?? thesis?.role ?? sym;
  const ccy = state.base_currency;
  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);

  const rangeMin = sparkline.length ? Math.min(...sparkline) : null;
  const rangeMax = sparkline.length ? Math.max(...sparkline) : null;

  const isSecOpen = (key: string, defaultOpen: boolean): boolean =>
    preserveOpenKeys ? preserveOpenKeys.has(key) : defaultOpen;

  const prov = thesis?.provenance;
  const sourcesHtml = (prov?.sources ?? [])
    .map((s) => {
      const safeUrl = s.url && s.url.startsWith("https://") ? s.url : "";
      const txt = `${s.kind.toUpperCase()}: ${s.label}${s.date ? ` (${s.date})` : ""}`;
      if (canOpenLinks && safeUrl) {
        return `<button type="button" class="small ghost open-ext-link" data-url="${esc(safeUrl)}">${esc(txt)} ↗</button>`;
      }
      return `<span class="src-badge">${esc(txt)}</span>`;
    })
    .join("");

  const execTakeaway = thesis
    ? (thesis.takeaway && thesis.takeaway.length > 0 ? thesis.takeaway : thesis.core_summary).slice(0, 3)
    : [];

  const tickerRedFlags = (state.sec_red_flags ?? []).filter((rf) => rf.ticker === sym);
  const tickerThemesCount = new Set([
    ...(thesis?.theme_refs ?? []),
    ...(detail?.linked_themes ?? []).map((th) => th.slug),
    ...(state.themes ?? []).filter((th) => th.exposures.some((e) => e.ticker === sym)).map((th) => th.slug),
  ]).size;
  const bands = detail?.valuation_bands ?? thesis?.valuation_bands ?? null;
  const extPrice = pos?.extended_price ?? thesis?.extended_price ?? null;
  const regPrice = pos?.regular_price ?? thesis?.regular_price ?? price;
  const mktState = pos?.market_state ?? thesis?.market_state ?? null;
  const recentAuditEntries = [
    ...(thesis?.recent_tests ?? []),
    ...(thesis?.recent_rule_changes ?? []),
  ].sort((a, b) => b.tested_at.localeCompare(a.tested_at));

  const memoHtml = detail?.memo_md
    ? renderSafeMarkdown(detail.memo_md, canOpenLinks)
    : inspectorLoading
      ? `<div class="muted-sub">Loading primary-source research memo...</div>`
      : `<div class="empty-state">
          <div style="margin-bottom:0.55rem">No primary-source deep research memo stored yet for <strong>${esc(sym)}</strong>.</div>
          ${canMessage ? `<button type="button" class="primary small" id="btn-launch-deep-memo">Launch 3-Lens Deep Research Memo</button>` : ""}
        </div>`;

  const qGrade = detail?.fundamentals?.latest_ratios.quality_grade ?? thesis?.fundamentals_summary?.latest_ratios.quality_grade;
  const ratiosSnap = detail?.fundamentals?.latest_ratios ?? thesis?.fundamentals_summary?.latest_ratios;
  const consensusBlock = detail?.intel?.consensus
    ? `
      <div class="drawer-card-block">
        <div class="hypothesis-head">
          <span class="micro-label">Street Consensus Snapshot</span>
          <span class="muted-sub">${esc(detail.intel.consensus.as_of || "")}${detail.intel.consensus.analyst_count ? ` · ${detail.intel.consensus.analyst_count} analysts` : ""}</span>
        </div>
        <div class="rdcf-grid">
          ${detail.intel.consensus.ntm_rev_growth_pct != null ? `<div class="metric-cell"><span class="micro-label">NTM Rev Growth</span><span class="metric-val">${detail.intel.consensus.ntm_rev_growth_pct.toFixed(1)}%</span></div>` : ""}
          ${detail.intel.consensus.ntm_eps != null ? `<div class="metric-cell"><span class="micro-label">NTM EPS</span><span class="metric-val">${fmtMoney(detail.intel.consensus.ntm_eps, currency, 2)}</span></div>` : ""}
          ${detail.intel.consensus.eps_revision_90d_pct != null ? `<div class="metric-cell"><span class="micro-label">90D EPS Revision</span><span class="metric-val ${detail.intel.consensus.eps_revision_90d_pct >= 0 ? "pos-ok" : "pos-bad"}">${fmtSignedPct(detail.intel.consensus.eps_revision_90d_pct, 1)}</span></div>` : ""}
          ${detail.intel.consensus.target_price_mean != null ? `<div class="metric-cell"><span class="micro-label">Mean Target</span><span class="metric-val">${fmtMoney(detail.intel.consensus.target_price_mean, currency, 2)}</span></div>` : ""}
        </div>
      </div>
    `
    : "";

  const summaryTabHtml = `
    <div class="drawer-section">
      <div class="hero-top" style="align-items:center">
        <div>
          <div class="micro-label">Latest Price (${esc(currency)})</div>
          <div class="actions-row" style="align-items:baseline;gap:0.45rem">
            <div class="hero-nav" style="font-size:1.42rem">${price !== null ? fmtMoney(price, currency, price < 10 ? 4 : 2) : "N/A"}</div>
            ${renderExtendedPriceTag(regPrice, extPrice, mktState, currency)}
          </div>
          <div class="actions-row" style="margin-top:4px">${fmtDeltaTag(ch1d, "1D", true)} ${fmtDeltaTag(ch1m, "1M")}</div>
        </div>
        ${renderSparklineSvg(sparkline, { width: 142, height: 46, positive: ch1m !== null ? ch1m >= 0 : null, fillArea: true, label: `${sym} 30-day area chart` })}
      </div>
      ${rangeMin !== null && rangeMax !== null ? `<div class="muted-sub">30D Range: ${fmtMoney(rangeMin, currency, 2)} – ${fmtMoney(rangeMax, currency, 2)}</div>` : ""}
      ${
        thesis?.scenario_summary
          ? `
        <div class="thesis-kpi-strip">
          <div class="thesis-kpi-main">
            <span class="micro-label">5Y Exp. After-Tax CAGR</span>
            <strong>${thesis.scenario_summary.expected_after_tax_cagr_pct.toFixed(1)}%</strong>
            <span class="muted-sub">vs ${thesis.scenario_summary.tax_info.hurdle_cagr_pct.toFixed(1)}% hurdle (${thesis.scenario_summary.tax_info.total_tax_drag_pct.toFixed(2)}% tax)</span>
          </div>
          <span class="delta-text ${thesis.scenario_summary.spread_vs_hurdle_pct >= 0 ? "pos-ok" : "pos-bad"}">${fmtSignedPct(thesis.scenario_summary.spread_vs_hurdle_pct, 1)}</span>
        </div>
      `
          : ""
      }
      ${execTakeaway.length > 0 ? `<ul class="takeaway-list">${execTakeaway.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${
        ratiosSnap && (ratiosSnap.roic_pct != null || ratiosSnap.owner_earnings_margin_pct != null)
          ? `
        <div class="chip-row" style="padding-top:0.35rem;border-top:1px solid var(--border-color)">
          ${qualityGradeBadge(qGrade)}
          ${ratiosSnap.roic_pct != null ? `<span class="mono-chip">ROIC ${ratiosSnap.roic_pct.toFixed(1)}%</span>` : ""}
          ${ratiosSnap.owner_earnings_margin_pct != null ? `<span class="mono-chip">Owner Earn ${ratiosSnap.owner_earnings_margin_pct.toFixed(1)}%</span>` : ""}
          ${ratiosSnap.accruals_ratio_pct != null ? `<span class="mono-chip">Accruals ${ratiosSnap.accruals_ratio_pct > 0 ? "+" : ""}${ratiosSnap.accruals_ratio_pct.toFixed(1)}%</span>` : ""}
          ${ratiosSnap.sbc_pct_rev != null ? `<span class="mono-chip">SBC ${ratiosSnap.sbc_pct_rev.toFixed(1)}%</span>` : ""}
        </div>
      `
          : ""
      }
      ${
        thesis?.tier === "passed" && (thesis.rejection_reason || thesis.reentry_trigger)
          ? `
        <div class="reentry-box ${thesis.reentry_alert ? "triggered" : ""}">
          ${thesis.rejection_reason ? `<div><strong>Passed Reason:</strong> ${esc(thesis.rejection_reason)}</div>` : ""}
          ${thesis.reentry_trigger ? `<div><strong>Re-Entry Trigger:</strong> ${esc(thesis.reentry_trigger)}${thesis.reentry_price !== null ? ` (<= ${fmtMoney(thesis.reentry_price, currency, 2)})` : ""}</div>` : ""}
        </div>
      `
          : ""
      }
      ${
        pos || lt
          ? `
        <div class="drawer-stat-grid" style="padding-top:0.35rem;border-top:1px solid var(--border-color)">
          ${pos ? `<div class="metric-cell"><span class="micro-label">Shares / Avg Cost</span><span class="metric-val">${pos.qty.toLocaleString("en-US")} @ ${fmtMoney(pos.avg_cost, currency, 2)}</span></div>` : ""}
          ${pos ? `<div class="metric-cell"><span class="micro-label">Position Value</span><span class="metric-val">${fmtMoney(pos.mv_base, ccy)} (${fmtPct(pos.weight_nav_pct)})</span></div>` : ""}
          ${lt ? `<div class="metric-cell"><span class="micro-label">Direct + ETF Overlap</span><span class="metric-val">${fmtMoney(lt.direct_usd, "USD", 0)} + ${fmtMoney(lt.via_etfs_usd, "USD", 0)}</span></div>` : ""}
          ${lt ? `<div class="metric-cell"><span class="micro-label">Total Look-Through</span><span class="metric-val">${fmtMoney(lt.total_base, ccy)} (${fmtPct(lt.pct_nav, 2)})</span></div>` : ""}
        </div>
      `
          : ""
      }
    </div>

    <div class="drawer-card-block">
      <div class="hypothesis-head">
        <span class="micro-label">4-Check Dip Readiness &amp; Tranche Plan</span>
        <span class="status-tag"><span class="dot ${checkDotClass(thesis?.dip_triage?.readiness ?? "")}"></span>${esc((thesis?.dip_triage?.readiness ?? "—").replace(/_/g, " "))}</span>
      </div>
      ${renderDipTriageSection(thesis, currency, ccy)}
    </div>

    <div class="drawer-trust-bar ${prov?.needs_retest ? "needs-retest" : ""}">
      <div class="drawer-trust-top">
        <span>
          <strong>Provenance</strong> ·
          ${prov?.last_audited_date ? `Audited ${esc(prov.last_audited_date)}` : "Not audited yet"}
          ${prov?.price_at_audit !== null && prov?.price_at_audit !== undefined ? ` @ ${fmtMoney(prov.price_at_audit, currency, 2)}` : ""}
          ${prov?.price_drift_pct !== null && prov?.price_drift_pct !== undefined ? ` (${fmtSignedPct(prov.price_drift_pct, 1)} drift)` : ""}
        </span>
        ${prov?.needs_retest ? `<span class="retest-stamp"><span class="dot warn"></span>Needs Re-Test</span>` : `<span class="muted-sub">Fresh</span>`}
      </div>
      ${prov?.needs_retest && prov.retest_reasons.length > 0 ? `<div class="pos-warn">${esc(prov.retest_reasons.join(" · "))}</div>` : ""}
      ${sourcesHtml ? `<div class="src-badges">${sourcesHtml}</div>` : ""}
    </div>
  `;

  const valuationTabHtml = `
    <div style="display:flex;flex-direction:column;gap:0.75rem">
      ${renderValuationSection(thesis, detail, currency, state.is_demo)}
      ${consensusBlock}
      ${renderFundamentalsAndBandsSection(detail?.fundamentals, thesis?.fundamentals_summary, bands)}
    </div>
  `;

  const signalsTabHtml = `
    <section class="drawer-accordion" id="drawer-accordion" aria-label="Signals, hypotheses and audit controls">
      <details class="drawer-disclosure" data-sec-key="triggers" ${isSecOpen("triggers", true) ? "open" : ""}>
        <summary>
          <span class="disc-title">Trigger Zones &amp; Falsifiable Hypotheses</span>
          <span class="disc-meta">${thesis?.hypotheses?.length ?? 0} claims</span>
        </summary>
        <div class="disc-body">
          ${thesis ? renderTriggerRuler(price, thesis.buy_zone_low, thesis.buy_zone_high, thesis.trim_zone, currency) : ""}
          <div class="drawer-edit-grid">
            <label>Buy Low <input type="number" step="any" id="ins-buy-low" value="${thesis?.buy_zone_low ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
            <label>Buy High <input type="number" step="any" id="ins-buy-high" value="${thesis?.buy_zone_high ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
            <label>Trim Target <input type="number" step="any" id="ins-trim" value="${thesis?.trim_zone ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
            <label style="flex-direction:row;align-items:center;gap:6px;padding-top:16px">
              <input type="checkbox" id="ins-gated" ${thesis?.gated ? "checked" : ""} ${state.is_demo ? "disabled" : ""} /> Gated
            </label>
          </div>
          ${
            !state.is_demo
              ? `<label class="rationale-label">Rationale (logged as rule_change)
                  <input type="text" id="ins-trigger-rationale" maxlength="300" placeholder="Reason for changing triggers or gate state..." />
                </label>`
              : ""
          }
          ${
            pendingUngateConfirm
              ? `<div class="confirm-gate-box" role="alert">
                  <div><strong>High-Vol Ungate Check (VIX ${(state.vix ?? 0).toFixed(1)}):</strong> You are removing the binary gate on ${esc(sym)} during elevated volatility. Confirm the underlying catalyst or filing has cleared and record your rationale above.</div>
                  <div class="actions-row">
                    <button type="button" class="small primary" id="btn-confirm-ungate">Confirm Remove Gate &amp; Save</button>
                    <button type="button" class="small ghost" id="btn-cancel-ungate">Cancel</button>
                  </div>
                </div>`
              : ""
          }
          <div class="actions-row">
            <button type="button" class="primary small" id="btn-save-inspector-trigger" ${state.is_demo ? "disabled" : ""}>Save Trigger Targets</button>
          </div>
          ${thesis?.kill_switches.length ? `<div><div class="micro-label" style="margin-bottom:3px">Hard Kill-Switches</div><ul class="drawer-list">${thesis.kill_switches.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></div>` : ""}
          <div class="micro-label" style="margin-top:4px">Falsifiable Hypotheses (${thesis?.hypotheses?.length ?? 0})</div>
          ${
            thesis?.softening_warnings && thesis.softening_warnings.length > 0
              ? `<div class="warn-box"><span class="micro-label pos-warn">Softening Warning</span>${thesis.softening_warnings.map((w) => `<div>• ${esc(w)}</div>`).join("")}</div>`
              : ""
          }
          ${
            thesis?.hypotheses && thesis.hypotheses.length > 0
              ? `<div class="hypothesis-list">
                  ${thesis.hypotheses
                    .map((h) => {
                      const safeSrc = h.source_url && h.source_url.startsWith("https://") ? h.source_url : "";
                      const autoBadge =
                        h.auto_eval?.passed === true
                          ? `<span class="auto-badge ok" title="${esc(h.auto_eval.detail)}">Verified</span>`
                          : h.auto_eval?.passed === false
                            ? `<span class="auto-badge bad" title="${esc(h.auto_eval.detail)}">Breached</span>`
                            : "";
                      const softenBadge = h.observed_breach_softened
                        ? `<span class="auto-badge warn">Softened</span>`
                        : "";
                      return `
                        <div class="hypothesis-item">
                          <div class="hypothesis-head">
                            <span>${hypothesisStateBadge(h.status)} ${autoBadge} ${softenBadge} · <span class="muted-sub">${esc(h.id)} (${esc(h.confidence)})</span></span>
                            ${h.last_tested ? `<span class="muted-sub">${esc(h.last_tested)}</span>` : ""}
                          </div>
                          <div>${esc(h.claim)}</div>
                          ${h.metric ? `<div class="muted-sub">Metric: ${esc(h.metric)}</div>` : ""}
                          ${h.auto_eval?.detail ? `<div class="muted-sub">Auto-Eval (${esc(h.auto_eval.source)}): ${esc(h.auto_eval.detail)}</div>` : ""}
                          ${h.evidence ? `<div class="muted-sub">Evidence: ${esc(h.evidence)}</div>` : ""}
                          ${canOpenLinks && safeSrc ? `<div><button type="button" class="small ghost open-ext-link" data-url="${esc(safeSrc)}">Source &rarr;</button></div>` : ""}
                        </div>
                      `;
                    })
                    .join("")}
                </div>`
              : `<div class="muted-sub">No falsifiable claims recorded yet.</div>`
          }
          ${
            !state.is_demo
              ? `
            <details class="add-hyp-details">
              <summary>Add / Update Hypothesis</summary>
              <div class="add-hyp-form">
                <div class="add-hyp-grid">
                  <label>ID (slug) <input type="text" id="hyp-id" placeholder="e.g. cloud-margin-floor" /></label>
                  <label>Confidence
                    <select id="hyp-conf">
                      <option value="high">high</option>
                      <option value="medium" selected>medium</option>
                      <option value="low">low</option>
                    </select>
                  </label>
                  <label>Status
                    <select id="hyp-status">
                      <option value="untested" selected>untested</option>
                      <option value="supported">supported</option>
                      <option value="weakened">weakened</option>
                      <option value="falsified">falsified</option>
                    </select>
                  </label>
                  <label>Metric <input type="text" id="hyp-metric" placeholder="e.g. Owner Earn >= 18%" /></label>
                </div>
                <label>Falsifiable Claim <input type="text" id="hyp-claim" placeholder="Specific statement that evidence can disprove..." /></label>
                <label>Evidence / Citation <input type="text" id="hyp-evidence" placeholder="10-Q note, filing figure, or observation..." /></label>
                <label>Source URL (https:// optional) <input type="url" id="hyp-url" placeholder="https://www.sec.gov/..." /></label>
                <div class="actions-row">
                  <button type="button" class="small primary" id="btn-save-hypothesis">Save Hypothesis</button>
                </div>
              </div>
            </details>
          `
              : ""
          }
        </div>
      </details>

      <details class="drawer-disclosure" data-sec-key="insiders" ${isSecOpen("insiders", false) ? "open" : ""}>
        <summary>
          <span class="disc-title">Form 4 Insider Flows (90D / 12M)</span>
          <span class="disc-meta">${thesis?.insiders_summary?.flags?.length ? esc(thesis.insiders_summary.flags[0]) : thesis?.has_insiders ? "Synced" : "None"}</span>
        </summary>
        <div class="disc-body">${renderInsidersSection(detail?.insiders, thesis?.insiders_summary, canOpenLinks)}</div>
      </details>

      <details class="drawer-disclosure" data-sec-key="themes" ${isSecOpen("themes", Boolean(prov?.theme_updated_after_audit)) ? "open" : ""}>
        <summary>
          <span class="disc-title">Linked Shared Themes</span>
          <span class="disc-meta">${tickerThemesCount} linked</span>
        </summary>
        <div class="disc-body">${renderLinkedThemesSection(sym, thesis, detail, state.themes ?? [])}</div>
      </details>

      <details class="drawer-disclosure" data-sec-key="intel" ${isSecOpen("intel", tickerRedFlags.some((r) => r.severity === "high")) ? "open" : ""}>
        <summary>
          <span class="disc-title">Broker Intel &amp; SEC Filings</span>
          <span class="disc-meta">${filings.length} SEC${detail?.intel || thesis?.has_intel ? " · Intel" : ""}</span>
        </summary>
        <div class="disc-body">
          ${
            tickerRedFlags.filter((r) => r.severity !== "info").length > 0
              ? `<div class="warn-box"><span class="micro-label pos-warn">Material SEC Events</span>${tickerRedFlags
                  .filter((r) => r.severity !== "info")
                  .map((rf) => `<div><strong>${esc(rf.filingDate)} ${esc(rf.form)} [${esc(rf.code)}]</strong> · ${esc(rf.label)}</div>`)
                  .join("")}</div>`
              : ""
          }
          ${renderIntelSection(detail?.intel, thesis?.intel_summary, detail?.intel_history, filings, currency, canOpenLinks)}
        </div>
      </details>

      <details class="drawer-disclosure" data-sec-key="audit" ${isSecOpen("audit", false) ? "open" : ""}>
        <summary>
          <span class="disc-title">Steelman Bear Case &amp; Audit Ledger</span>
          <span class="disc-meta">${recentAuditEntries.length} entries</span>
        </summary>
        <div class="disc-body">
          ${thesis?.bear_case_summary ? `<div class="bear-box"><div class="micro-label">Steelman Bear Case</div><div>${esc(thesis.bear_case_summary)}</div></div>` : ""}
          ${
            recentAuditEntries.length > 0
              ? `<div class="test-ledger-list">
                  ${recentAuditEntries
                    .slice(0, 8)
                    .map(
                      (rec) => `
                    <div class="test-ledger-item">
                      <div class="hypothesis-head">
                        <span>${rec.event_type === "rule_change" ? `<span class="auto-badge warn">Rule Change</span>` : verdictTag(rec.verdict)} ${rec.kill_switch_triggered ? `<span class="status-tag"><span class="dot bad"></span>Kill-Switch</span>` : ""}</span>
                        <span class="muted-sub">${esc(rec.tested_at)}${rec.price_at_test !== null && rec.price_at_test !== undefined ? ` · ${fmtMoney(rec.price_at_test, rec.currency || currency, 2)}` : ""}</span>
                      </div>
                      <div>${esc(rec.summary)}</div>
                    </div>
                  `,
                    )
                    .join("")}
                </div>`
              : `<div class="muted-sub">No systematic tests or rule changes logged yet.</div>`
          }
        </div>
      </details>
    </section>
  `;

  const activeDrawerContent =
    inspectorTab === "memo"
      ? memoHtml
      : inspectorTab === "valuation"
        ? valuationTabHtml
        : inspectorTab === "signals"
          ? signalsTabHtml
          : summaryTabHtml;

  dlg.innerHTML = `
    <div class="drawer-head">
      <div>
        <h1 id="inspector-title">${esc(sym)} · ${esc(titleName)}</h1>
        <div class="actions-row" style="margin-top:4px;gap:0.35rem">
          ${thesis ? `<span class="src-badge">${esc(thesis.tier || "active")}</span>` : ""}
          ${thesis ? actionVerdictPill(thesis.action_verdict) : ""}
          ${qualityGradeBadge(qGrade)}
          ${verdictTag(thesis?.verdict)}
          ${state.summary.us_situs_enabled && (pos || thesis) ? `<span class="muted-sub" style="font-size:0.7rem">${(pos?.us_situs ?? thesis?.us_situs) ? "US-Situs" : "Exempt"}</span>` : ""}
        </div>
      </div>
      <button type="button" class="small" id="btn-close-inspector" autofocus aria-label="Close inspector">✕ Close</button>
    </div>

    <div class="drawer-subtabs" role="tablist" aria-label="Dossier sections">
      <button type="button" role="tab" data-inspector-tab="summary" aria-selected="${inspectorTab === "summary" ? "true" : "false"}">Summary</button>
      <button type="button" role="tab" data-inspector-tab="memo" aria-selected="${inspectorTab === "memo" ? "true" : "false"}">Deep Memo${detail?.memo_md ? "" : thesis?.has_memo ? " ·" : ""}</button>
      <button type="button" role="tab" data-inspector-tab="valuation" aria-selected="${inspectorTab === "valuation" ? "true" : "false"}">Valuation &amp; Quality</button>
      <button type="button" role="tab" data-inspector-tab="signals" aria-selected="${inspectorTab === "signals" ? "true" : "false"}">Signals &amp; Audit</button>
    </div>

    <div class="drawer-body">
      ${activeDrawerContent}
    </div>

    <div class="drawer-foot">
      <div class="actions-row" style="gap:0.35rem">
        ${
          canMessage
            ? `
          <div class="seg-switch" role="group" aria-label="Agent dispatch target">
            <button type="button" data-send-mode="background" aria-pressed="${inspectorSendMode === "background" ? "true" : "false"}" title="Runs in a side agent so your current chat stays uninterrupted">Side Agent</button>
            <button type="button" data-send-mode="here" aria-pressed="${inspectorSendMode === "here" ? "true" : "false"}" title="Brings this research into the active chat">This Chat</button>
          </div>
          <button type="button" class="small" id="btn-inspector-redteam" title="Quickly re-verify hypotheses against live SEC, XBRL, and Form 4 signals">Systematic Test</button>
        `
            : `<span class="muted-sub">Esc to dismiss</span>`
        }
      </div>
      ${canMessage ? `<button type="button" class="primary small" id="btn-inspector-deep-research" title="Runs a full 3-lens institutional deep dive and updates memo.md, model.json, and hypotheses">Deep Research</button>` : ""}
    </div>
  `;

  syncExpandAllButton(dlg);
  bindInspectorEvents(dlg, sym, detail);
}

function syncExpandAllButton(dlg: HTMLDialogElement): void {
  const accordion = dlg.querySelector("#drawer-accordion");
  const btn = dlg.querySelector<HTMLButtonElement>("#btn-toggle-all-disc");
  if (!accordion || !btn) return;
  const items = Array.from(accordion.querySelectorAll<HTMLDetailsElement>(":scope > details.drawer-disclosure"));
  const allOpen = items.length > 0 && items.every((d) => d.open);
  btn.setAttribute("aria-expanded", allOpen ? "true" : "false");
}

function bindInspectorEvents(dlg: HTMLDialogElement, sym: string, detail: DossierDetail | undefined): void {
  dlg.querySelector<HTMLButtonElement>("#btn-close-inspector")?.addEventListener("click", () => {
    void closeTopLayer(dlg);
  });

  // Fallback for browsers without native Invoker Commands (`commandfor` / `command`)
  if (!Object.hasOwn(HTMLButtonElement.prototype, "commandForElement")) {
    dlg.querySelector<HTMLButtonElement>("#btn-toggle-all-disc")?.addEventListener("click", () => {
      const accordion = dlg.querySelector("#drawer-accordion");
      const btn = dlg.querySelector<HTMLButtonElement>("#btn-toggle-all-disc");
      if (!accordion || !btn) return;
      const expand = btn.getAttribute("aria-expanded") !== "true";
      accordion.querySelectorAll<HTMLDetailsElement>(":scope > details.drawer-disclosure").forEach((d) => {
        d.open = expand;
      });
      syncExpandAllButton(dlg);
    });
  }

  const saveTriggerTargets = async (bypassHighVolGateConfirm = false) => {
    const numVal = (id: string): number | null => {
      const el = dlg.querySelector<HTMLInputElement>(`#${id}`);
      if (!el || el.value.trim() === "") return null;
      const n = Number(el.value);
      return Number.isFinite(n) ? n : null;
    };
    const gated = Boolean(dlg.querySelector<HTMLInputElement>("#ins-gated")?.checked);
    const rationale = dlg.querySelector<HTMLInputElement>("#ins-trigger-rationale")?.value.trim() ?? "";
    const curThesis = state?.theses.find((t) => t.ticker === sym) ?? detail?.thesis ?? undefined;
    const isHighVol = (state?.vix ?? 0) >= 28;
    const uncheckingGate = Boolean(curThesis?.gated) && !gated;
    if (!bypassHighVolGateConfirm && isHighVol && uncheckingGate) {
      const openKeys = captureOpenDisclosures(dlg);
      pendingUngateConfirm = true;
      renderInspectorDialog(sym, openKeys);
      const gateEl = dlg.querySelector<HTMLInputElement>("#ins-gated");
      if (gateEl) gateEl.checked = false;
      const ratEl = dlg.querySelector<HTMLInputElement>("#ins-trigger-rationale");
      if (ratEl) ratEl.value = rationale;
      return;
    }
    pendingUngateConfirm = false;
    const args: Record<string, unknown> = {
      ticker: sym,
      buy_zone_low: numVal("ins-buy-low"),
      buy_zone_high: numVal("ins-buy-high"),
      trim_zone: numVal("ins-trim"),
      gated,
    };
    if (rationale) args.rationale = rationale;
    await runAppTool("app_save_trigger", args, `Saved ${sym} trigger targets.`);
    void fetchDossierDetail(sym);
  };

  dlg.querySelector<HTMLButtonElement>("#btn-save-inspector-trigger")?.addEventListener("click", async () => {
    await saveTriggerTargets(false);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-confirm-ungate")?.addEventListener("click", async () => {
    await saveTriggerTargets(true);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-cancel-ungate")?.addEventListener("click", () => {
    const openKeys = captureOpenDisclosures(dlg);
    pendingUngateConfirm = false;
    renderInspectorDialog(sym, openKeys);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-save-dossier-model")?.addEventListener("click", async () => {
    const readNum = (id: string, fallback: number): number => {
      const el = dlg.querySelector<HTMLInputElement>(`#${id}`);
      const n = Number(el?.value);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const bearPx = readNum("mod-bear-px", 0);
    const basePx = readNum("mod-base-px", 0);
    const bullPx = readNum("mod-bull-px", 0);
    if (bearPx <= 0 || basePx <= 0 || bullPx <= 0) {
      toastMessage = "Please enter positive 5Y target prices for Bear, Base, and Bull cases.";
      render();
      return;
    }
    const existing = detail?.model;
    const prevScen = existing?.scenarios;
    const mergedModel: DossierModel = {
      ...(existing ?? { horizon_years: 5, dividend_yield_pct: 0 }),
      as_of: new Date().toISOString().slice(0, 10),
      horizon_years: existing?.horizon_years ?? 5,
      dividend_yield_pct: existing?.dividend_yield_pct ?? 0,
      scenarios: {
        bear: {
          probability: Math.min(1, Math.max(0, readNum("mod-bear-p", 0.25))),
          target_price_5y: bearPx,
          multiple: prevScen?.bear.multiple ?? null,
          metric_cagr_pct: prevScen?.bear.metric_cagr_pct ?? null,
          summary: prevScen?.bear.summary || "Bear case 5Y valuation target.",
        },
        base: {
          probability: Math.min(1, Math.max(0, readNum("mod-base-p", 0.5))),
          target_price_5y: basePx,
          multiple: prevScen?.base.multiple ?? null,
          metric_cagr_pct: prevScen?.base.metric_cagr_pct ?? null,
          summary: prevScen?.base.summary || "Base case 5Y valuation target.",
        },
        bull: {
          probability: Math.min(1, Math.max(0, readNum("mod-bull-p", 0.25))),
          target_price_5y: bullPx,
          multiple: prevScen?.bull.multiple ?? null,
          metric_cagr_pct: prevScen?.bull.metric_cagr_pct ?? null,
          summary: prevScen?.bull.summary || "Bull case 5Y valuation target.",
        },
      },
    };
    const rationale = dlg.querySelector<HTMLInputElement>("#mod-rationale")?.value.trim() ?? "";
    const prevCached = dossierCache.get(sym);
    if (prevCached) {
      dossierCache.set(sym, { ...prevCached, model: mergedModel });
    }
    const modelArgs: Record<string, unknown> = { ticker: sym, model: mergedModel };
    if (rationale) modelArgs.rationale = rationale;
    await runAppTool("app_save_dossier_model", modelArgs, `Saved ${sym} 5Y valuation model.`);
    void fetchDossierDetail(sym);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-save-hypothesis")?.addEventListener("click", async () => {
    const rawId = dlg.querySelector<HTMLInputElement>("#hyp-id")?.value.trim() ?? "";
    const claim = dlg.querySelector<HTMLInputElement>("#hyp-claim")?.value.trim() ?? "";
    const metric = dlg.querySelector<HTMLInputElement>("#hyp-metric")?.value.trim() ?? "";
    const status = dlg.querySelector<HTMLSelectElement>("#hyp-status")?.value ?? "untested";
    const confidence = dlg.querySelector<HTMLSelectElement>("#hyp-conf")?.value ?? "medium";
    const evidence = dlg.querySelector<HTMLInputElement>("#hyp-evidence")?.value.trim() ?? "";
    const rawUrl = dlg.querySelector<HTMLInputElement>("#hyp-url")?.value.trim() ?? "";
    if (!claim) {
      toastMessage = "Please enter a falsifiable claim first.";
      render();
      return;
    }
    const slugSource = rawId || claim.slice(0, 32);
    const id =
      slugSource
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || `hyp-${Date.now()}`;
    const todayYmd = new Date().toISOString().slice(0, 10);
    const hypothesis: Record<string, unknown> = {
      id,
      claim,
      status,
      confidence,
      last_tested: status === "untested" ? null : todayYmd,
    };
    if (metric) hypothesis.metric = metric;
    if (evidence) hypothesis.evidence = evidence;
    if (rawUrl.startsWith("https://")) hypothesis.source_url = rawUrl;
    await runAppTool("app_upsert_hypothesis", { ticker: sym, hypothesis }, `Saved hypothesis "${id}" for ${sym}.`);
    void fetchDossierDetail(sym);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-toggle-refine")?.addEventListener("click", () => {
    const openKeys = captureOpenDisclosures(dlg);
    inspectorRefineOpen = !inspectorRefineOpen;
    renderInspectorDialog(sym, openKeys);
  });

  dlg.querySelectorAll<HTMLButtonElement>("[data-send-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.sendMode === "here" ? "here" : "background";
      if (next !== inspectorSendMode) {
        const openKeys = captureOpenDisclosures(dlg);
        inspectorSendMode = next;
        renderInspectorDialog(sym, openKeys);
      }
    });
  });

  dlg.querySelectorAll<HTMLButtonElement>("[data-refine-kind]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.refineKind;
      if (kind === "hypotheses") {
        await sendAgentPrompt(
          `Challenge the falsifiable hypotheses in my ${sym} dossier against the latest primary sources and SEC filings, then persist updated statuses via upsert_dossier or record_thesis_test.`,
          { mode: inspectorSendMode, label: "challenge hypotheses", ticker: sym },
        );
      } else if (kind === "valuation") {
        await sendAgentPrompt(
          `Review and stress-test the Reverse DCF assumptions and Bear/Base/Bull 5Y valuation drivers for ${sym} (after-tax CAGR vs hurdle), then persist any updates to dossiers/${sym}/model.json via upsert_dossier.`,
          { mode: inspectorSendMode, label: "update valuation", ticker: sym },
        );
      } else {
        await sendAgentPrompt(
          `Re-evaluate my buy/trim trigger zones, binary gates, or Passed re-entry criteria for ${sym} given the latest price and catalysts, and update the dossier via upsert_dossier.`,
          { mode: inspectorSendMode, label: "revise triggers", ticker: sym },
        );
      }
    });
  });

  dlg.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.inspectorTab as InspectorTabId | undefined) ?? "summary";
      if (next !== inspectorTab) {
        const openKeys = captureOpenDisclosures(dlg);
        inspectorTab = next;
        renderInspectorDialog(sym, openKeys);
      }
    });
  });

  const deepResearchPrompt = `Run a full 3-lens institutional deep research dive on ${sym}: (1) Business quality, moat, supply chain, XBRL Owner Earnings (FCF-SBC), ROIC, and Sloan Accruals (sync_fundamentals_xbrl + sync_insiders_form4 + check_sec_edgar); (2) Reverse DCF market-implied expectations vs Street consensus and Mauboussin base rates; (3) Steelman bear case and machine-checkable falsifiable hypotheses. Persist the full memo.md, 5Y model.json, and updated thesis via upsert_dossier and log the scored test via record_thesis_test.`;

  dlg.querySelector<HTMLButtonElement>("#btn-inspector-deep-research")?.addEventListener("click", async () => {
    await sendAgentPrompt(deepResearchPrompt, { mode: inspectorSendMode, label: "deep research", ticker: sym });
  });

  dlg.querySelector<HTMLButtonElement>("#btn-launch-deep-memo")?.addEventListener("click", async () => {
    await sendAgentPrompt(deepResearchPrompt, { mode: inspectorSendMode, label: "deep research", ticker: sym });
  });

  dlg.querySelector<HTMLButtonElement>("#btn-inspector-redteam")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      `Run a systematic Red-Team thesis test for ${sym}: verify falsifiable hypotheses against live market data, SEC filings (check_sec_edgar), XBRL Owner Earnings & ROIC fundamentals, and Form 4 insider flows, steelman the bear case, check hard kill-switches, and persist the scored result using record_thesis_test.`,
      { mode: inspectorSendMode, label: "systematic test", ticker: sym },
    );
  });

  dlg.querySelectorAll<HTMLElement>("[data-inspect-theme]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const slug = el.dataset.inspectTheme;
      if (slug) openThemeInspector(slug);
    });
  });

  dlg.querySelectorAll<HTMLButtonElement>(".open-sec, .open-ext-link").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (btn.classList.contains("open-sec")) {
        if (url && url.startsWith("https://www.sec.gov/")) {
          await app.openLink({ url });
        }
      } else if (url && url.startsWith("https://")) {
        await app.openLink({ url });
      }
    });
  });
}

async function fetchDossierDetail(sym: string): Promise<void> {
  if (!state || !hostCaps?.serverTools) return;
  inspectorLoading = true;
  try {
    const res = await app.callServerTool({
      name: "app_get_dossier_detail",
      arguments: {
        ticker: sym,
        demo: state.is_demo,
        use_cache: state.mode === "live_yahoo",
      },
    });
    inspectorLoading = false;
    if (res.structuredContent && typeof res.structuredContent === "object") {
      dossierCache.set(sym, res.structuredContent as unknown as DossierDetail);
    }
  } catch {
    inspectorLoading = false;
  }
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (dlg?.open && inspectorTicker === sym) {
    const openKeys = captureOpenDisclosures(dlg);
    renderInspectorDialog(sym, openKeys);
  }
}

function openInspector(ticker: string): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg) return;
  const sym = ticker.toUpperCase();
  if (inspectorTicker !== sym) {
    inspectorTab = "summary";
  }
  inspectorTicker = sym;
  inspectorThemeSlug = null;
  inspectorRefineOpen = false;
  pendingUngateConfirm = false;
  const cached = dossierCache.get(sym);
  inspectorLoading = !cached;
  renderInspectorDialog(sym);
  if (!dlg.open) {
    dlg.removeAttribute("data-closing");
    dlg.showModal();
  }
  if (!cached) {
    void fetchDossierDetail(sym);
  }
}

function renderThemeDialog(slug: string, preserveOpenKeys?: Set<string> | null): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg || !state) return;

  const detail = themeCache.get(slug);
  const theme = detail?.theme ?? (state.themes ?? []).find((t) => t.slug === slug) ?? null;
  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);
  const isSecOpen = (key: string, defaultOpen: boolean): boolean =>
    preserveOpenKeys ? preserveOpenKeys.has(key) : defaultOpen;

  const linkedRows =
    detail?.linked_theses && detail.linked_theses.length > 0
      ? detail.linked_theses
      : (theme?.exposures ?? []).map((e) => {
          const th = state?.theses.find((t) => t.ticker === e.ticker);
          return {
            ticker: e.ticker,
            stance: e.stance,
            note: e.note,
            tier: th?.tier ?? null,
            verdict: th?.verdict ?? null,
            price: th?.price ?? null,
            currency: th?.currency ?? "USD",
            needs_retest: Boolean(th?.provenance?.needs_retest),
          };
        });

  const exposuresHtml = linkedRows.length
    ? linkedRows
        .map((row) => {
          const stanceDot =
            row.stance === "beneficiary" || row.stance === "hedged_tollbooth"
              ? "ok"
              : row.stance === "at_risk"
                ? "bad"
                : "warn";
          return `
            <button type="button" class="rotation-row-btn" data-inspect-ticker="${esc(row.ticker)}">
              <div class="queue-main">
                <span class="queue-title">
                  ${esc(row.ticker)}
                  ${row.tier ? `<span class="src-badge">${esc(row.tier)}</span>` : ""}
                  ${row.price !== null ? `<span class="muted-sub">${fmtMoney(row.price, row.currency, 2)}</span>` : ""}
                  ${row.needs_retest ? `<span class="auto-badge warn">RE-TEST</span>` : ""}
                </span>
                <span class="queue-sub">${esc(row.note)}</span>
              </div>
              <span class="status-tag"><span class="dot ${stanceDot}"></span>${esc(row.stance.replace(/_/g, " ").toUpperCase())}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="muted-sub">No stock exposures linked yet.</div>`;

  const signpostsHtml =
    theme && theme.signposts.length > 0
      ? theme.signposts
          .map(
            (sp) => `
        <div class="hypothesis-item">
          <div class="hypothesis-head">
            <span><span class="status-tag"><span class="dot ${checkDotClass(sp.status)}"></span>${esc(sp.status.toUpperCase())}</span> · <span class="muted-sub">${esc(sp.id)}</span></span>
            ${sp.last_checked ? `<span class="muted-sub">${esc(sp.last_checked)}</span>` : ""}
          </div>
          <div><strong>${esc(sp.metric)}</strong>${sp.threshold ? ` · Threshold: ${esc(sp.threshold)}` : ""}</div>
          ${sp.evidence ? `<div class="muted-sub">${esc(sp.evidence)}</div>` : ""}
        </div>
      `,
          )
          .join("")
      : `<div class="muted-sub">No falsifiable theme signposts defined yet.</div>`;

  const sourcesHtml = (theme?.sources ?? [])
    .map((s) => {
      const safeUrl = s.url && s.url.startsWith("https://") ? s.url : "";
      const txt = `${s.kind.toUpperCase()}: ${s.label}${s.date ? ` (${s.date})` : ""}`;
      if (canOpenLinks && safeUrl) {
        return `<button type="button" class="small ghost open-ext-link" data-url="${esc(safeUrl)}">${esc(txt)} ↗</button>`;
      }
      return `<span class="src-badge">${esc(txt)}</span>`;
    })
    .join("");

  const memoHtml = detail?.memo_md
    ? renderSafeMarkdown(detail.memo_md, canOpenLinks)
    : inspectorLoading
      ? `<div class="muted-sub">Loading shared theme research memo...</div>`
      : `<div class="muted-sub">No <code>themes/${esc(slug)}.md</code> memo stored yet.</div>`;

  dlg.innerHTML = `
    <div class="drawer-head">
      <div>
        <h1 id="inspector-title">${esc(theme?.title || slug)}</h1>
        <div class="actions-row" style="margin-top:4px">
          <span class="src-badge">THEME</span>
          ${theme ? `<span class="status-tag">${esc(theme.relationship_mode.replace(/_/g, " ").toUpperCase())}</span>` : ""}
          ${theme?.updated_at ? `<span class="muted-sub">Updated ${esc(theme.updated_at.slice(0, 10))}</span>` : ""}
        </div>
      </div>
      <button type="button" class="small" id="btn-close-inspector" autofocus aria-label="Close theme inspector">✕ Close</button>
    </div>

    <div class="drawer-body">
      <div class="drawer-section">
        <div class="micro-label">Theme Summary</div>
        <div>${esc(theme?.summary || (inspectorLoading ? "Loading theme details..." : "Theme object not found."))}</div>
        ${
          theme && theme.shared_assumptions.length > 0
            ? `<div class="micro-label" style="margin-top:4px">Shared Assumptions</div><ul class="drawer-list">${theme.shared_assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
            : ""
        }
        ${sourcesHtml ? `<div class="src-badges" style="margin-top:4px">${sourcesHtml}</div>` : ""}
      </div>

      <section class="drawer-accordion" id="drawer-accordion" aria-label="Theme analysis sections">
        <details class="drawer-disclosure" data-sec-key="theme-exposures" ${isSecOpen("theme-exposures", true) ? "open" : ""}>
          <summary>
            <span class="disc-title">Linked Stock Exposures &amp; Stances</span>
            <span class="disc-meta">${linkedRows.length} stocks</span>
          </summary>
          <div class="disc-body">${exposuresHtml}</div>
        </details>

        <details class="drawer-disclosure" data-sec-key="theme-signposts" ${isSecOpen("theme-signposts", true) ? "open" : ""}>
          <summary>
            <span class="disc-title">Falsifiable Theme Signposts</span>
            <span class="disc-meta">${theme?.signposts.length ?? 0} signposts</span>
          </summary>
          <div class="disc-body"><div class="hypothesis-list">${signpostsHtml}</div></div>
        </details>

        <details class="drawer-disclosure" data-sec-key="theme-memo" ${isSecOpen("theme-memo", false) ? "open" : ""}>
          <summary>
            <span class="disc-title">Full Shared Theme Research Memo</span>
            <span class="disc-meta">${detail?.memo_md ? `${Math.max(1, Math.round(detail.memo_md.length / 1000))}k chars` : inspectorLoading ? "Loading..." : "None"}</span>
          </summary>
          <div class="disc-body">${memoHtml}</div>
        </details>
      </section>
    </div>

    <div class="drawer-foot">
      <div class="actions-row" style="gap:0.35rem">
        ${canMessage ? `<button type="button" class="small ghost" id="btn-theme-discuss-here">Discuss Here</button>` : `<span class="muted-sub">Esc to dismiss</span>`}
      </div>
      ${canMessage ? `<button type="button" class="primary small" id="btn-theme-challenge">Challenge Theme (Background)</button>` : ""}
    </div>
  `;

  dlg.querySelector<HTMLButtonElement>("#btn-close-inspector")?.addEventListener("click", () => {
    void closeTopLayer(dlg);
  });

  dlg.querySelectorAll<HTMLElement>("[data-inspect-ticker]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = el.dataset.inspectTicker;
      if (sym) openInspector(sym);
    });
  });

  dlg.querySelectorAll<HTMLButtonElement>(".open-ext-link").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (url && url.startsWith("https://")) {
        await app.openLink({ url });
      }
    });
  });

  dlg.querySelector<HTMLButtonElement>("#btn-theme-discuss-here")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      `Let's review the shared theme "${theme?.title || slug}" (${slug}) here: check current shared assumptions, signposts, and stance implications across linked stocks.`,
      { mode: "here", label: `discuss theme ${slug}`, ticker: slug },
    );
  });

  dlg.querySelector<HTMLButtonElement>("#btn-theme-challenge")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      `Challenge the shared theme "${theme?.title || slug}" (${slug}) against latest primary sources, verify every signpost, and update themes/${slug}.yaml via upsert_theme.`,
      { mode: "background", label: `challenge theme ${slug}`, ticker: slug },
    );
  });
}

async function fetchThemeDetail(slug: string): Promise<void> {
  if (!state || !hostCaps?.serverTools) return;
  inspectorLoading = true;
  try {
    const res = await app.callServerTool({
      name: "app_get_theme_detail",
      arguments: {
        slug,
        demo: state.is_demo,
        use_cache: state.mode === "live_yahoo",
      },
    });
    inspectorLoading = false;
    if (res.structuredContent && typeof res.structuredContent === "object") {
      themeCache.set(slug, res.structuredContent as unknown as ThemeDetail);
    }
  } catch {
    inspectorLoading = false;
  }
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (dlg?.open && inspectorThemeSlug === slug) {
    renderThemeDialog(slug, captureOpenDisclosures(dlg));
  }
}

function openThemeInspector(slug: string): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg) return;
  inspectorTicker = null;
  inspectorThemeSlug = slug;
  inspectorRefineOpen = false;
  pendingUngateConfirm = false;
  const cached = themeCache.get(slug);
  inspectorLoading = !cached;
  renderThemeDialog(slug);
  if (!dlg.open) {
    dlg.removeAttribute("data-closing");
    dlg.showModal();
  }
  if (!cached) {
    void fetchThemeDetail(slug);
  }
}

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransitionCache !== undefined) return supportsDisplayTransitionCache;
  if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransitionCache = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransitionCache;
}

function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay());
}

async function closeTopLayer(dlg: HTMLDialogElement): Promise<void> {
  if (!dlg.open) return;
  if (!supportsTopLayerExit()) {
    dlg.setAttribute("data-closing", "");
    const animations = dlg.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!dlg.hasAttribute("data-closing")) return;
    dlg.removeAttribute("data-closing");
  }
  dlg.close();
}

function setupInspectorDialogHost(): HTMLDialogElement {
  let dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "stock-inspector";
    dlg.setAttribute("closedby", "any");
    dlg.setAttribute("aria-labelledby", "inspector-title");
    document.body.appendChild(dlg);
  }

  dlg.addEventListener("close", () => {
    dlg!.returnValue = "";
    dlg!.removeAttribute("data-closing");
    inspectorTicker = null;
    inspectorThemeSlug = null;
    inspectorRefineOpen = false;
    pendingUngateConfirm = false;
  });

  dlg.addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeTopLayer(dlg!);
  });

  // Native Invoker Command handler for Expand/Collapse All + toggle sync (capture)
  document.addEventListener(
    "command",
    (event) => {
      const cmdEv = event as Event & { command?: string; source?: Element | null };
      if (cmdEv.command !== "--toggle-all") return;
      const target = event.target as HTMLElement | null;
      const source = cmdEv.source;
      if (!target || !source) return;
      const expand = source.getAttribute("aria-expanded") !== "true";
      target.querySelectorAll<HTMLDetailsElement>(":scope > details.drawer-disclosure").forEach((d) => {
        d.open = expand;
      });
      syncExpandAllButton(dlg!);
    },
    { capture: true },
  );

  document.addEventListener(
    "toggle",
    (event) => {
      const t = event.target as HTMLElement | null;
      if (t && t.matches("#drawer-accordion > details.drawer-disclosure")) {
        syncExpandAllButton(dlg!);
      }
    },
    { capture: true },
  );

  // Fallback for browsers lacking HTMLDialogElement.prototype.closedBy
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e: PointerEvent, d: HTMLDialogElement) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    dlg.addEventListener("pointerdown", (e) => {
      pressedOutside = outside(e, dlg!);
    });
    dlg.addEventListener("pointerup", (e) => {
      if (pressedOutside && outside(e, dlg!)) {
        void closeTopLayer(dlg!);
      }
    });
  }

  return dlg;
}

function selectTab(nextTab: TabId, focusTab = false): void {
  if (activeTab === nextTab && !focusTab) return;
  activeTab = nextTab;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

  const applyTabUpdate = () => {
    for (const btn of tabBtns) {
      const selected = btn.dataset.tab === activeTab;
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.toggleAttribute("focusgroupstart", selected);
      if (selected) {
        btn.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          container: "nearest",
        } as ScrollIntoViewOptions);
      }
    }

    for (const panel of panels) {
      const isCurrent = panel.dataset.panel === activeTab;
      if (isCurrent) {
        panel.removeAttribute("hidden");
        panel.setAttribute("tabindex", "0");
      } else {
        panel.setAttribute("hidden", "until-found");
        panel.removeAttribute("tabindex");
      }
    }
  };

  const docWithVt = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (typeof docWithVt.startViewTransition === "function" && !prefersReducedMotion) {
    const vt = docWithVt.startViewTransition(applyTabUpdate);
    if (focusTab) {
      vt.finished.finally(() => {
        document.getElementById(`tab-${activeTab}`)?.focus();
      });
    }
  } else {
    applyTabUpdate();
    if (focusTab) {
      document.getElementById(`tab-${activeTab}`)?.focus();
    }
  }
}

function renderPanelsOnly(): void {
  if (!state) return;
  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);
  const ov = document.getElementById("panel-overview");
  const fc = document.getElementById("panel-forecast");
  const ho = document.getElementById("panel-holdings");
  const th = document.getElementById("panel-theses");
  const ed = document.getElementById("panel-edgar");
  const la = document.getElementById("panel-lab");
  if (ov) ov.innerHTML = renderOverview(state);
  if (fc) fc.innerHTML = renderForecast(state, canMessage);
  if (ho) ho.innerHTML = renderHoldings(state);
  if (th) th.innerHTML = renderTheses(state, canMessage);
  if (ed) ed.innerHTML = renderEdgar(state, canOpenLinks);
  if (la) la.innerHTML = renderLab(state);
  const root = document.getElementById("app");
  if (root) bindPanelEvents(root);
}

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  if (!state) {
    root.innerHTML = `<div class="card empty-state">${esc(busyMessage || "Loading Investment OS dashboard...")}</div>`;
    return;
  }

  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);

  if (!state.initialized) {
    root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-cluster brand-block">
            <svg class="brand-mark" viewBox="0 0 128 128" fill="none" aria-hidden="true">
              <rect x="8" y="8" width="112" height="112" rx="22" stroke="currentColor" stroke-width="6"/>
              <path d="M32 82 L52 62 L68 72 L96 40" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M78 40 H96 V58" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="brand-text">
              <div class="brand-title-row"><h1>Investment OS</h1><span class="ver-badge">v0.7</span><span class="status-tag"><span class="dot"></span>Setup</span></div>
              <div class="meta-line">Local data vault ready</div>
            </div>
          </div>
        </header>
        ${toastMessage ? `<div class="toast" role="status">${esc(toastMessage)}</div>` : ""}
        ${renderOnboarding(canMessage)}
      </div>
    `;
    bindOnboardingEvents(root);
    return;
  }

  const tabButtons = TABS.map((t) => {
    const sel = t.id === activeTab;
    return `<button type="button" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-selected="${sel ? "true" : "false"}" ${sel ? "focusgroupstart" : ""}>${esc(t.label)}</button>`;
  }).join("");

  const syncBtn = canMessage
    ? `<button type="button" class="small" id="btn-sync-broker" ${busyMessage ? "disabled" : ""}>Sync</button>`
    : "";

  const statusDotCls = state.is_demo ? "warn" : state.mode === "live_yahoo" ? "ok" : "";
  const statusLbl = state.is_demo ? "Demo" : state.mode === "live_yahoo" ? "Live" : "Snapshot";

  const demoBanner = state.is_demo
    ? `
      <div class="demo-banner" role="status">
        <span><strong>Sample Demo Mode</strong> — Synthetic preview data only (nothing saved to disk).</span>
        <button type="button" class="small" id="btn-exit-demo">Exit Preview</button>
      </div>
    `
    : "";

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-cluster brand-block">
          <svg class="brand-mark" viewBox="0 0 128 128" fill="none" aria-hidden="true">
            <rect x="8" y="8" width="112" height="112" rx="22" stroke="currentColor" stroke-width="6"/>
            <path d="M32 82 L52 62 L68 72 L96 40" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M78 40 H96 V58" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="brand-text">
            <div class="brand-title-row">
              <h1>Investment OS</h1>
              <span class="ver-badge">v0.7</span>
              <span class="status-tag"><span class="dot ${statusDotCls}"></span>${statusLbl}</span>
            </div>
            <div class="meta-line">Base ${esc(state.base_currency)} · ${esc(fmtHeaderTimestamp(state.generated_at))}</div>
          </div>
        </div>
        <div class="cmd-actions">
          <div class="search-box">
            <input id="search-ticker" class="search-input" type="search" value="${esc(searchQuery)}" placeholder="Jump / filter..." aria-label="Filter or jump to ticker" />
            <span class="kbd-hint">/</span>
          </div>
          <button type="button" class="small" id="btn-run-watchdog" title="Run silent deterministic Watchdog sweep (quotes, SEC, XBRL, Form 4)" ${busyMessage || state.is_demo ? "disabled" : ""}>Watchdog</button>
          <button type="button" class="primary small" id="btn-refresh-live" ${busyMessage || state.is_demo ? "disabled" : ""}>${busyMessage ? esc(busyMessage) : "Live"}</button>
          ${syncBtn}
        </div>
      </header>
      ${demoBanner}
      ${toastMessage ? `<div class="toast" role="status">${esc(toastMessage)}</div>` : ""}
      <div class="tablist" focusgroup="tablist nomemory" aria-label="Investment OS views">
        ${tabButtons}
      </div>
      <div class="tab-panels">
        <div role="tabpanel" id="panel-overview" data-panel="overview" aria-labelledby="tab-overview" ${activeTab === "overview" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderOverview(state)}
        </div>
        <div role="tabpanel" id="panel-forecast" data-panel="forecast" aria-labelledby="tab-forecast" ${activeTab === "forecast" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderForecast(state, canMessage)}
        </div>
        <div role="tabpanel" id="panel-holdings" data-panel="holdings" aria-labelledby="tab-holdings" ${activeTab === "holdings" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderHoldings(state)}
        </div>
        <div role="tabpanel" id="panel-theses" data-panel="theses" aria-labelledby="tab-theses" ${activeTab === "theses" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderTheses(state, canMessage)}
        </div>
        <div role="tabpanel" id="panel-edgar" data-panel="edgar" aria-labelledby="tab-edgar" ${activeTab === "edgar" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderEdgar(state, canOpenLinks)}
        </div>
        <div role="tabpanel" id="panel-lab" data-panel="lab" aria-labelledby="tab-lab" ${activeTab === "lab" ? 'tabindex="0"' : 'hidden="until-found"'}>
          ${renderLab(state)}
        </div>
      </div>
    </div>
  `;

  bindChromeEvents(root);
  bindPanelEvents(root);
}

function bindOnboardingEvents(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("#btn-onboard-agent")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Help me set up Investment OS: ask for my base currency, residency/tax profile, optional external stock or cash reserve, and brokerage holdings, then persist them cleanly.",
      { mode: "here", label: "onboarding", ticker: "portfolio" },
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-preview-demo")?.addEventListener("click", async () => {
    dossierCache.clear();
    themeCache.clear();
    backtestResult = null;
    await runServerRefresh("Loading sample preview...", { demo: true, tab: "overview" });
  });
}

function installTablistScrollFadeFallback(tablist: HTMLElement | null): void {
  if (!tablist || window.CSS?.supports?.("animation-timeline", "scroll()")) return;
  const first = tablist.firstElementChild;
  const last = tablist.lastElementChild;
  if (!first || !last || typeof IntersectionObserver === "undefined") return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target, intersectionRatio } of entries) {
        tablist.classList.toggle(target === first ? "more-start" : "more-end", intersectionRatio < 1);
      }
    },
    { root: tablist, threshold: 1, rootMargin: "1px" },
  );
  observer.observe(first);
  observer.observe(last);
}

function bindChromeEvents(root: HTMLElement): void {
  const tablist = root.querySelector<HTMLElement>(".tablist");
  installTablistScrollFadeFallback(tablist);

  const tabBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  tabBtns.forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab as TabId | undefined;
      if (id) selectTab(id);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const nextIdx =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabBtns.length - 1
              : e.key === "ArrowRight"
                ? (idx + 1) % tabBtns.length
                : (idx - 1 + tabBtns.length) % tabBtns.length;
        const nextId = tabBtns[nextIdx]?.dataset.tab as TabId | undefined;
        if (nextId) selectTab(nextId, true);
      }
    });
  });

  root.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach((panel) => {
    panel.addEventListener("beforematch", () => {
      const id = panel.dataset.panel as TabId | undefined;
      if (id) selectTab(id);
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-run-watchdog")?.addEventListener("click", async () => {
    dossierCache.clear();
    themeCache.clear();
    await runAppTool(
      "app_run_watchdog",
      { tab: activeTab },
      "Watchdog sweep complete (quotes, SEC, XBRL, Form 4 & alerts updated).",
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-refresh-live")?.addEventListener("click", async () => {
    dossierCache.clear();
    themeCache.clear();
    await runServerRefresh("Refreshing...", { live: true, tab: activeTab });
  });

  root.querySelector<HTMLButtonElement>("#btn-exit-demo")?.addEventListener("click", async () => {
    dossierCache.clear();
    themeCache.clear();
    backtestResult = null;
    await runServerRefresh("Exiting preview...", { demo: false, tab: "overview" });
  });

  root.querySelector<HTMLButtonElement>("#btn-sync-broker")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Sync my latest brokerage positions, cash, and FX (using connected broker MCP if available or asking for my export) into Investment OS and refresh the dashboard.",
      { mode: "background", label: "broker sync", ticker: "portfolio" },
    );
  });

  const searchInput = root.querySelector<HTMLInputElement>("#search-ticker");
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    const q = searchQuery.trim().toUpperCase();
    if (activeTab === "overview" && q.length > 0 && state) {
      const inPos = state.portfolio.positions.some((p) => p.ticker.includes(q) || p.name.toUpperCase().includes(q));
      selectTab(inPos ? "holdings" : "theses");
    }
    renderPanelsOnly();
  });
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state) {
      const q = searchInput.value.trim().toUpperCase();
      if (!q) return;
      const exactPos = state.portfolio.positions.find((p) => p.ticker === q);
      const exactThesis = state.theses.find((t) => t.ticker === q);
      const firstMatch =
        exactPos?.ticker ??
        exactThesis?.ticker ??
        state.portfolio.positions.find((p) => p.ticker.includes(q) || p.name.toUpperCase().includes(q))?.ticker ??
        state.theses.find((t) => t.ticker.includes(q))?.ticker;
      if (firstMatch) {
        e.preventDefault();
        openInspector(firstMatch);
      }
    }
  });
}

async function runInteractiveForecast(): Promise<void> {
  if (!state || !hostCaps?.serverTools) return;
  forecastBusy = true;
  forecastError = "";
  renderPanelsOnly();
  try {
    const actions = buildSelectedForecastActions(state);
    const res = await app.callServerTool({
      name: "app_simulate_forecast",
      arguments: {
        horizon_years: forecastHorizon,
        include_external_wealth: state.profile.external_exposure.enabled ? forecastIncludeExt : false,
        apply_recommended_rotations: false,
        actions,
        regime_vol_multiplier: forecastVolMult,
        return_model: forecastReturnModel,
        simulation_engine: forecastSimEngine,
        simulations: 1500,
        demo: state.is_demo,
      },
    });
    forecastBusy = false;
    if (res.isError) {
      forecastError = res.content?.find((c) => c.type === "text")?.text ?? "Forecast simulation failed.";
    } else if (res.structuredContent && typeof res.structuredContent === "object") {
      forecastResult = res.structuredContent as unknown as PortfolioForecastResult;
    } else {
      forecastError = "Forecast returned no structured result.";
    }
  } catch (err) {
    forecastBusy = false;
    forecastError = `Forecast error: ${err instanceof Error ? err.message : String(err)}`;
  }
  renderPanelsOnly();
}

async function runDeterministicBacktestFromForm(root: HTMLElement): Promise<void> {
  if (!state) return;
  const tickerEl = root.querySelector<HTMLInputElement>("#bt-ticker");
  const weightEl = root.querySelector<HTMLInputElement>("#bt-weight");
  const fundingEl = root.querySelector<HTMLSelectElement>("#bt-funding");
  const bandEl = root.querySelector<HTMLInputElement>("#bt-band");
  const txEl = root.querySelector<HTMLInputElement>("#bt-tx-bps");
  const trialsEl = root.querySelector<HTMLInputElement>("#bt-trials");
  const includeExtEl = root.querySelector<HTMLInputElement>("#bt-include-ext");

  const sym = (tickerEl?.value ?? btTicker).trim().toUpperCase();
  if (!sym) {
    backtestError = "Please pick or enter a candidate ticker.";
    renderPanelsOnly();
    return;
  }
  btTicker = sym;
  btWeight = Math.min(15, Math.max(1, Number(weightEl?.value) || 5));
  btFunding = fundingEl?.value || "cash";
  btBand = Math.min(100, Math.max(5, Number(bandEl?.value) || 25));
  btTxCostBps = Math.min(100, Math.max(0, Number(txEl?.value ?? btTxCostBps) || 0));
  const rawTrials = trialsEl?.value.trim() ? Math.round(Number(trialsEl.value)) : 0;
  btTrialsTested = Number.isFinite(rawTrials) && rawTrials >= 1 ? Math.min(200, rawTrials) : 0;
  if (includeExtEl) btIncludeExternal = includeExtEl.checked;

  const matchedThesis = state.theses.find((t) => t.ticker === sym);
  const matchedPos = state.portfolio.positions.find((p) => p.ticker === sym);
  const yfSym = matchedThesis?.yf_symbol || matchedPos?.yf_symbol || undefined;

  backtestBusy = true;
  backtestError = "";
  renderPanelsOnly();

  try {
    const args: Record<string, unknown> = {
      candidate_ticker: sym,
      target_weight_pct: btWeight,
      funding_source: btFunding,
      rebalance_band_pct: btBand,
      tx_cost_bps: btTxCostBps,
      include_external_wealth: state.profile.external_exposure.enabled ? btIncludeExternal : false,
      demo: state.is_demo,
    };
    if (btTrialsTested > 0) args.trials_tested = btTrialsTested;
    if (yfSym) args.candidate_yf_symbol = yfSym;
    const res = await app.callServerTool({ name: "app_run_backtest", arguments: args });
    backtestBusy = false;
    if (res.isError) {
      const txt = res.content?.find((c) => c.type === "text")?.text ?? "Backtest failed.";
      backtestError = txt;
    } else if (res.structuredContent && typeof res.structuredContent === "object") {
      backtestResult = res.structuredContent as unknown as BacktestResult;
      toastMessage = `Completed backtest for ${sym} (${backtestResult.weeks_analyzed}w).`;
    } else {
      backtestError = "Backtest returned no structured result.";
    }
  } catch (err) {
    backtestBusy = false;
    backtestError = `Backtest error: ${err instanceof Error ? err.message : String(err)}`;
  }
  renderPanelsOnly();
}

function bindPanelEvents(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-inspect-ticker]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = el.dataset.inspectTicker;
      if (sym) openInspector(sym);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-inspect-theme]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const slug = el.dataset.inspectTheme;
      if (slug) openThemeInspector(slug);
    });
  });

  root.querySelector<HTMLInputElement>("#toggle-mute-vol-noise")?.addEventListener("change", (e) => {
    muteVolNoise = Boolean((e.currentTarget as HTMLInputElement).checked);
    renderPanelsOnly();
  });

  root.querySelectorAll<HTMLButtonElement>(".btn-ack-alert").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.alertId;
      if (!id) return;
      await runAppTool("app_ack_alert", { id, tab: activeTab }, "Watchdog alert acknowledged.");
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-ack-all-alerts")?.addEventListener("click", async () => {
    await runAppTool("app_ack_alert", { ids: ["*"], tab: activeTab }, "All watchdog alerts acknowledged.");
  });

  root.querySelectorAll<HTMLElement>("[data-jump-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      const next = el.dataset.jumpTab as TabId | undefined;
      if (next && TABS.some((t) => t.id === next)) {
        selectTab(next, true);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-jump-roster]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.jumpRoster;
      if (target === "retest") {
        thesisTier = "all";
        thesisFilter = "retest";
      } else if (target === "active" || target === "bench" || target === "passed") {
        thesisTier = target;
        thesisFilter = "all";
      }
      renderPanelsOnly();
      selectTab("theses", true);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-hero-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.heroMode === "total" ? "total" : "portfolio";
      if (next !== heroMode) {
        heroMode = next;
        renderPanelsOnly();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-holdings-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next: HoldingsMode = btn.dataset.holdingsMode === "lookthrough" ? "lookthrough" : "positions";
      if (next !== holdingsMode) {
        holdingsMode = next;
        renderPanelsOnly();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort as SortKey | undefined;
      if (!key) return;
      if (sortKey === key) sortAsc = !sortAsc;
      else {
        sortKey = key;
        sortAsc = key === "ticker";
      }
      renderPanelsOnly();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-tier-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.tierFilter as TierFilter | undefined) ?? "active";
      if (next !== thesisTier) {
        thesisTier = next;
        renderPanelsOnly();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-thesis-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.thesisFilter as ThesisSubFilter | undefined) ?? "all";
      if (next !== thesisFilter) {
        thesisFilter = next;
        renderPanelsOnly();
      }
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-create-thesis")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Ask which ticker I want to research, then create a living research dossier with buy/trim zones and 5Y scenarios via upsert_dossier.",
      { mode: "here", label: "create dossier", ticker: "new" },
    );
  });

  const extSlider = root.querySelector<HTMLInputElement>("#sim-ext");
  const resSlider = root.querySelector<HTMLInputElement>("#sim-res");
  const syncSimUi = () => {
    if (!state) return;
    const ccy = state.base_currency;
    const ext = state.profile.external_exposure;
    const hasPaired = Boolean(ext.enabled && ext.paired_tickers && ext.paired_tickers.length > 0);
    const extLbl = root.querySelector("#sim-ext-lbl");
    const resLbl = root.querySelector("#sim-res-lbl");
    if (extLbl) extLbl.textContent = fmtMoney(simExtBase, ccy);
    if (resLbl) resLbl.textContent = fmtMoney(simReserveBase, ccy);

    const sim = computeSimulatorMetrics(state);
    const simBox = root.querySelector("#sim-results");
    if (simBox) {
      simBox.innerHTML = `
        ${ext.enabled ? `<div class="metric-cell"><span class="micro-label">${esc(ext.ticker || "External")} % Wealth</span><span class="metric-val">${fmtPct(sim.extPct)}</span></div>` : ""}
        ${hasPaired ? `<div class="metric-cell"><span class="micro-label">${esc(state.summary.paired_label)}</span><span class="metric-val">${fmtPct(sim.pairedPct)}</span></div>` : ""}
        <div class="metric-cell"><span class="micro-label">Portfolio Cash Left</span><span class="metric-val ${sim.cashSurplusBase < 0 ? "pos-bad" : ""}">${fmtMoney(sim.cashSurplusBase, ccy)}</span></div>
        ${
          state.summary.us_situs_enabled
            ? `<div class="metric-cell"><span class="micro-label">Est. US Estate Tax</span><span class="metric-val pos-bad">${fmtMoney(sim.estateTaxBase, ccy)}</span></div>`
            : `<div class="metric-cell"><span class="micro-label">Net Investable</span><span class="metric-val">${fmtMoney(sim.netInvestableBase, ccy)}</span></div>`
        }
      `;
    }
  };

  extSlider?.addEventListener("input", () => {
    simExtBase = Number(extSlider.value);
    syncSimUi();
  });
  resSlider?.addEventListener("input", () => {
    simReserveBase = Number(resSlider.value);
    syncSimUi();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-preset-ext]").forEach((btn) => {
    btn.addEventListener("click", () => {
      simExtBase = Number(btn.dataset.presetExt ?? 0);
      if (extSlider) extSlider.value = String(simExtBase);
      syncSimUi();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-preset-res]").forEach((btn) => {
    btn.addEventListener("click", () => {
      simReserveBase = Number(btn.dataset.presetRes ?? 0);
      if (resSlider) resSlider.value = String(simReserveBase);
      syncSimUi();
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-save-ext")?.addEventListener("click", async () => {
    await runAppTool(
      "app_save_external_wealth",
      { external_amount_base: simExtBase, reserve_amount_base: simReserveBase },
      "Saved profile assumptions.",
    );
  });

  root.querySelectorAll<HTMLButtonElement>(".ask-deep-research").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sym = btn.dataset.ticker;
      if (!sym) return;
      await sendAgentPrompt(
        `Run a full 3-lens institutional deep research dive on ${sym}: (1) Business quality, moat, supply chain, XBRL Owner Earnings (FCF-SBC), ROIC, and Sloan Accruals; (2) Reverse DCF market-implied expectations vs Street consensus and base rates; (3) Steelman bear case and machine-checkable falsifiable hypotheses. Persist memo.md, model.json, and thesis updates via upsert_dossier and record_thesis_test.`,
        { mode: "background", label: "deep research", ticker: sym },
      );
    });
  });

  // Forecast & Action Simulator bindings
  root.querySelectorAll<HTMLButtonElement>("[data-fc-return-model]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.fcReturnModel === "raw_dossier" ? "raw_dossier" : "black_litterman";
      if (next !== forecastReturnModel) {
        forecastReturnModel = next;
        void runInteractiveForecast();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-fc-sim-engine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.fcSimEngine === "student_t" ? "student_t" : "block_bootstrap";
      if (next !== forecastSimEngine) {
        forecastSimEngine = next;
        void runInteractiveForecast();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-fc-horizon]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = Number(btn.dataset.fcHorizon) || 5;
      if (next !== forecastHorizon) {
        forecastHorizon = next;
        void runInteractiveForecast();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-fc-vol]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = Number(btn.dataset.fcVol) || 1.0;
      if (next !== forecastVolMult) {
        forecastVolMult = next;
        void runInteractiveForecast();
      }
    });
  });

  root.querySelector<HTMLInputElement>("#fc-include-ext")?.addEventListener("change", (e) => {
    forecastIncludeExt = Boolean((e.currentTarget as HTMLInputElement).checked);
    void runInteractiveForecast();
  });

  root.querySelector<HTMLInputElement>("#fc-park-cash")?.addEventListener("change", (e) => {
    forecastParkCash = Boolean((e.currentTarget as HTMLInputElement).checked);
    void runInteractiveForecast();
  });

  root.querySelectorAll<HTMLInputElement>(".fc-rot-check").forEach((chk) => {
    chk.addEventListener("change", () => {
      const key = chk.dataset.rotKey;
      if (!key) return;
      if (chk.checked) forecastDisabledRotations.delete(key);
      else forecastDisabledRotations.add(key);
      void runInteractiveForecast();
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-fc-select-all")?.addEventListener("click", () => {
    forecastDisabledRotations.clear();
    void runInteractiveForecast();
  });

  root.querySelector<HTMLButtonElement>("#btn-fc-clear-all")?.addEventListener("click", () => {
    if (!state) return;
    const rot = state.rotation_queue;
    for (const sw of rot?.tax_swaps ?? []) forecastDisabledRotations.add(`swap:${sw.ticker}`);
    for (const ex of rot?.mandatory_exits ?? []) forecastDisabledRotations.add(`exit:${ex.ticker}`);
    for (const ct of rot?.cap_trims ?? []) forecastDisabledRotations.add(`trim:${ct.cap_id}:${ct.ticker}`);
    forecastPlannedBuys = [];
    forecastParkCash = false;
    void runInteractiveForecast();
  });

  root.querySelectorAll<HTMLButtonElement>(".fc-preset-amt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const amt = Number(btn.dataset.amt) || 0;
      if (amt > 0) {
        forecastBuyAmount = amt;
        const amtInput = root.querySelector<HTMLInputElement>("#fc-buy-amount");
        if (amtInput) amtInput.value = String(amt);
      }
    });
  });

  root.querySelector<HTMLFormElement>("#fc-add-buy-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const symEl = root.querySelector<HTMLInputElement>("#fc-buy-ticker");
    const amtEl = root.querySelector<HTMLInputElement>("#fc-buy-amount");
    const sym = (symEl?.value ?? forecastBuyTicker).trim().toUpperCase();
    const amt = Math.round(Number(amtEl?.value ?? forecastBuyAmount));
    if (!sym || !Number.isFinite(amt) || amt <= 0) return;
    forecastBuyTicker = sym;
    forecastBuyAmount = amt;
    forecastPlannedBuys.push({ id: `buy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ticker: sym, amount_base: amt });
    void runInteractiveForecast();
  });

  root.querySelectorAll<HTMLButtonElement>(".fc-remove-buy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.buyId;
      if (!id) return;
      forecastPlannedBuys = forecastPlannedBuys.filter((b) => b.id !== id);
      void runInteractiveForecast();
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-fc-ask-agent")?.addEventListener("click", async () => {
    if (!state) return;
    const actions = buildSelectedForecastActions(state);
    await sendAgentPrompt(
      `Optimize my ${forecastHorizon}-year forward portfolio action plan using simulate_portfolio_forecast (currently modeling ${actions.length} actions across swaps/exits/trims/buys, external wealth=${forecastIncludeExt}, vol_mult=${forecastVolMult}). Evaluate marginal risk contributions, correlation-adjusted hurdles, Quarter-Kelly sizing, and cross-border estate tax savings, and recommend an optimal strictly read-only staged execution sequence.`,
      { mode: "here", label: "optimize forecast plan", ticker: "portfolio" },
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-run-watchdog-edgar")?.addEventListener("click", async () => {
    dossierCache.clear();
    themeCache.clear();
    await runAppTool(
      "app_run_watchdog",
      { tab: activeTab },
      "Watchdog sweep complete (quotes, SEC, XBRL, Form 4 & alerts updated).",
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-poll-edgar")?.addEventListener("click", async () => {
    await runAppTool("app_check_edgar", {}, "SEC EDGAR filings & gate status refreshed.");
  });

  root.querySelectorAll<HTMLButtonElement>(".open-sec").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (url && url.startsWith("https://www.sec.gov/")) {
        await app.openLink({ url });
      }
    });
  });

  root.querySelector<HTMLFormElement>("#lab-backtest-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void runDeterministicBacktestFromForm(root);
  });
}

async function runServerRefresh(label: string, args: { live?: boolean; tab?: TabId; demo?: boolean }): Promise<void> {
  busyMessage = label;
  render();
  try {
    const res = await app.callServerTool({
      name: "app_get_dashboard",
      arguments: args,
    });
    busyMessage = "";
    if (res.structuredContent) {
      toastMessage = args.live
        ? "Live market quotes, 30-day charts, VIX, and FX refreshed."
        : args.demo
          ? "Sample demo preview loaded."
          : "Dashboard updated.";
      ingestPayload(res.structuredContent);
    }
  } catch (err) {
    busyMessage = "";
    toastMessage = `Refresh error: ${err instanceof Error ? err.message : String(err)}`;
    render();
  }
}

async function runAppTool(name: string, args: Record<string, unknown>, okToast: string): Promise<void> {
  busyMessage = name === "app_run_watchdog" ? "Watchdog..." : name === "app_check_edgar" ? "Polling SEC..." : "Saving...";
  render();
  try {
    const mergedArgs: Record<string, unknown> = {
      use_cache: state?.mode === "live_yahoo",
      ...args,
    };
    const res = await app.callServerTool({ name, arguments: mergedArgs });
    busyMessage = "";
    if (res.isError) {
      toastMessage = res.content?.find((c) => c.type === "text")?.text ?? `Action ${name} failed.`;
      render();
      return;
    }
    toastMessage = okToast;
    if (res.structuredContent) {
      ingestPayload(res.structuredContent);
    } else {
      render();
    }
  } catch (err) {
    busyMessage = "";
    toastMessage = `Action failed: ${err instanceof Error ? err.message : String(err)}`;
    render();
  }
}

async function sendAgentPrompt(
  text: string,
  opts: { mode?: "background" | "here"; label?: string; ticker?: string } = {},
): Promise<void> {
  const mode = opts.mode ?? "background";
  if (!hostCaps?.message) {
    toastMessage = "Open inside a conversation sidecar to launch an agent run.";
    render();
    return;
  }
  try {
    const params: Record<string, unknown> = {
      role: "user",
      content: [{ type: "text", text }],
    };
    if (mode === "background") {
      params._meta = { "com.google.antigravity/message": { target: "new" } };
    }
    const res = await app.sendMessage(params as Parameters<typeof app.sendMessage>[0]);
    const bgMeta = (res as { _meta?: Record<string, { conversationId?: string }> } | undefined)?._meta?.[
      "com.google.antigravity/message"
    ];
    if (mode === "background" && hostCaps?.updateModelContext) {
      const note = `Investment OS sidecar launched background task (${opts.label ?? "research"} for ${opts.ticker ?? "portfolio"}${bgMeta?.conversationId ? `, conversationId=${bgMeta.conversationId}` : ""}). Read updated state from \${PLUGIN_DATA} on next turn.`;
      try {
        await app.updateModelContext({ content: [{ type: "text", text: note }] });
      } catch {
        // Best-effort silent context sync; never fail the launched background run
      }
    }
    toastMessage =
      mode === "background"
        ? `Running ${opts.label ?? "task"} in background (main chat untouched). Click Live when done.`
        : `Sent ${opts.label ?? "request"} to active chat.`;
    render();
  } catch (err) {
    toastMessage = `Could not message agent: ${err instanceof Error ? err.message : String(err)}`;
    render();
  }
}

function installGlobalKeyboardAndScroll(): void {
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if ((e.key === "/" && !inInput) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      const searchEl = document.getElementById("search-ticker") as HTMLInputElement | null;
      if (searchEl) {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
      }
    }
  });

  if (!window.CSS?.supports?.("container-type", "scroll-state")) {
    let lastY = window.scrollY;
    window.addEventListener(
      "scroll",
      () => {
        const bar = document.querySelector(".topbar") as HTMLElement | null;
        if (!bar) return;
        const y = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
        if (y === lastY) return;
        bar.classList.toggle("is-hidden", y > lastY && y > bar.offsetHeight);
        lastY = y;
      },
      { passive: true },
    );
  }
}

async function bootstrap() {
  setupInspectorDialogHost();
  installGlobalKeyboardAndScroll();

  app.ontoolinput = () => {
    if (!state) {
      busyMessage = "Loading Investment OS data...";
      render();
    }
  };
  app.ontoolresult = (result) => {
    busyMessage = "";
    if (result?.structuredContent) {
      ingestPayload(result.structuredContent);
    }
  };
  app.ontoolcancelled = () => {
    busyMessage = "";
    toastMessage = "Dashboard update cancelled.";
    render();
  };
  app.onhostcontextchanged = (ctx) => applyThemeContext(ctx);

  try {
    await app.connect();
    hostCaps = app.getHostCapabilities();
    applyThemeContext(app.getHostContext());
    render();
    if (!hasInitializedFromResult && hostCaps?.serverTools) {
      setTimeout(() => {
        if (!hasInitializedFromResult) {
          void runServerRefresh("Loading Investment OS...", { live: false, tab: "overview" });
        }
      }, 250);
    }
  } catch (err) {
    busyMessage = `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
    render();
  }
}

void bootstrap();
