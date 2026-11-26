import { computeDeflatedSharpeRatio, computeHigherMoments, computeSpearmanRankCorrelation } from "./quant_sota.js";
import type {
  BacktestRequest,
  CatalystRecord,
  DossierFundamentals,
  DossierInsiders,
  DossierModel,
  DossierTier,
  EtfWeightsConfig,
  HistoryCacheState,
  HistoryPoint,
  HistorySeries,
  HypothesisRecord,
  HypothesisRule,
  MarketCacheEntry,
  PortfolioRecord,
  ThesisTestRecord,
  TrancheRule,
  UserProfile,
} from "./schema.js";
import { extractSecRedFlags } from "./edgar.js";
import type { EdgarFilingRow, SecGateEvaluation } from "./storage.js";

const SHARE_CLASS_GROUPS: Record<string, { canonical: string; members: string[] }> = {
  GOOG: { canonical: "GOOG/GOOGL", members: ["GOOGL", "GOOG"] },
  GOOGL: { canonical: "GOOG/GOOGL", members: ["GOOGL", "GOOG"] },
};

const KNOWN_US_ETF_TICKERS = new Set([
  "QQQ",
  "VOO",
  "VTI",
  "SPY",
  "IVV",
  "VT",
  "VUG",
  "VGT",
  "SCHD",
  "SOXX",
  "SMH",
  "QQQM",
  "SPLG",
]);

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function canonicalAssetName(ticker: string): string {
  const sym = ticker.trim().toUpperCase();
  return SHARE_CLASS_GROUPS[sym]?.canonical ?? sym;
}

export function memberTickersForCanonical(canonical: string): string[] {
  const upper = canonical.trim().toUpperCase();
  if (upper === "GOOG/GOOGL") return ["GOOGL", "GOOG"];
  if (upper.includes("/")) return upper.split("/").map((s) => s.trim()).filter(Boolean);
  const group = SHARE_CLASS_GROUPS[upper];
  return group ? group.members : [upper];
}

export interface UsEstateTaxResult {
  us_situs_usd: number;
  taxable_excess_over_60k_usd: number;
  tentative_tax_usd: number;
  unified_credit_usd: number;
  net_estate_tax_usd: number;
  effective_rate_pct: number;
  marginal_rate_pct: number;
}

/**
 * Exact U.S. Federal Estate Tax for Non-Resident Aliens (IRC §2101(c) & §2102(b)(1)):
 * progressive 18%-40% tentative tax minus $13,000 unified credit ($60,000 exemption).
 */
export function computeUsEstateTaxNra(usSitusUsd: number): UsEstateTaxResult {
  if (!Number.isFinite(usSitusUsd) || usSitusUsd <= 60000) {
    return {
      us_situs_usd: round(Math.max(0, usSitusUsd || 0), 2),
      taxable_excess_over_60k_usd: 0,
      tentative_tax_usd: 0,
      unified_credit_usd: 13000,
      net_estate_tax_usd: 0,
      effective_rate_pct: 0,
      marginal_rate_pct: 0,
    };
  }

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
      const slice = Math.min(usSitusUsd, cap) - prev;
      tentative += slice * rate;
      marginal = rate;
      prev = cap;
    } else {
      break;
    }
  }
  const netTax = Math.max(0, tentative - 13000);
  return {
    us_situs_usd: round(usSitusUsd, 2),
    taxable_excess_over_60k_usd: round(usSitusUsd - 60000, 2),
    tentative_tax_usd: round(tentative, 2),
    unified_credit_usd: 13000,
    net_estate_tax_usd: round(netTax, 2),
    effective_rate_pct: round((netTax / usSitusUsd) * 100, 2),
    marginal_rate_pct: round(marginal * 100, 1),
  };
}

export interface AfterTaxHurdleOptions {
  dividendWhtPctOverride?: number | null;
  accumulating?: boolean;
}

export interface AfterTaxHurdleInfo {
  benchmark_ticker: string;
  benchmark_label: string;
  benchmark_cagr_pct: number;
  alpha_buffer_pct: number;
  hurdle_cagr_pct: number;
  us_situs: boolean;
  accumulating: boolean;
  dividend_yield_pct: number;
  effective_wht_pct: number;
  div_wht_drag_pct: number;
  estate_tax_drag_mode: "hedge" | "amortized" | "override" | "none";
  estate_tax_drag_pct: number;
  total_tax_drag_pct: number;
  required_gross_cagr_pct: number;
}

export function computeAfterTaxHurdle(
  profile: UserProfile,
  usSitus: boolean,
  dividendYieldPct = 0,
  marginalEstateRatePct?: number | null,
  opts?: AfterTaxHurdleOptions,
): AfterTaxHurdleInfo {
  const bench = profile.benchmark;
  const benchmarkCagrPct = round(bench.expected_cagr_pct ?? 8.0, 2);
  const alphaBufferPct = round(bench.alpha_buffer_pct ?? 2.5, 2);
  const hurdleCagrPct = round(benchmarkCagrPct + alphaBufferPct, 2);

  const safeDivYield = Number.isFinite(dividendYieldPct) && dividendYieldPct > 0 ? dividendYieldPct : 0;
  const accumulating = Boolean(opts?.accumulating);

  let effectiveWhtPct = 0;
  if (!accumulating) {
    if (
      opts?.dividendWhtPctOverride !== null &&
      opts?.dividendWhtPctOverride !== undefined &&
      Number.isFinite(opts.dividendWhtPctOverride)
    ) {
      effectiveWhtPct = Math.min(100, Math.max(0, opts.dividendWhtPctOverride));
    } else {
      effectiveWhtPct = usSitus
        ? profile.tax_profile.us_dividend_wht_pct
        : profile.tax_profile.ucits_dividend_wht_pct;
    }
  }
  const divWhtDragPct = accumulating ? 0 : round((safeDivYield * effectiveWhtPct) / 100, 2);

  const resolvedMarginal =
    marginalEstateRatePct !== null &&
    marginalEstateRatePct !== undefined &&
    Number.isFinite(marginalEstateRatePct)
      ? marginalEstateRatePct
      : 34;

  let estateTaxDragPct = 0;
  let estateTaxDragMode: AfterTaxHurdleInfo["estate_tax_drag_mode"] = "none";
  if (profile.tax_profile.nra_us_estate_tax_enabled && usSitus) {
    if (bench.estate_tax_annual_drag_pct !== null && bench.estate_tax_annual_drag_pct !== undefined) {
      estateTaxDragPct = round(bench.estate_tax_annual_drag_pct, 2);
      estateTaxDragMode = "override";
    } else if (resolvedMarginal <= 0) {
      estateTaxDragPct = 0;
      estateTaxDragMode = bench.estate_tax_drag_mode ?? "hedge";
    } else if ((bench.estate_tax_drag_mode ?? "hedge") === "hedge") {
      const hedgeBps = Number.isFinite(bench.estate_tax_hedge_bps) ? bench.estate_tax_hedge_bps : 35;
      estateTaxDragPct = round(Math.max(0, hedgeBps) / 100, 2);
      estateTaxDragMode = "hedge";
    } else {
      const rateFrac = Math.min(0.4, Math.max(0, resolvedMarginal / 100));
      const years = Math.max(1, bench.estate_tax_amortize_years || 20);
      estateTaxDragPct = round((1 - Math.pow(1 - rateFrac, 1 / years)) * 100, 2);
      estateTaxDragMode = "amortized";
    }
  }

  const totalTaxDragPct = round(divWhtDragPct + estateTaxDragPct, 2);
  const requiredGrossCagrPct = round(hurdleCagrPct + totalTaxDragPct, 2);

  return {
    benchmark_ticker: bench.ticker,
    benchmark_label: bench.label,
    benchmark_cagr_pct: benchmarkCagrPct,
    alpha_buffer_pct: alphaBufferPct,
    hurdle_cagr_pct: hurdleCagrPct,
    us_situs: usSitus,
    accumulating,
    dividend_yield_pct: round(safeDivYield, 2),
    effective_wht_pct: round(effectiveWhtPct, 2),
    div_wht_drag_pct: divWhtDragPct,
    estate_tax_drag_mode: estateTaxDragMode,
    estate_tax_drag_pct: estateTaxDragPct,
    total_tax_drag_pct: totalTaxDragPct,
    required_gross_cagr_pct: requiredGrossCagrPct,
  };
}

export interface ScenarioCaseEval {
  label: "bear" | "base" | "bull";
  probability: number;
  target_price_5y: number;
  multiple: number | null;
  metric_cagr_pct: number | null;
  summary: string;
  gross_cagr_pct: number;
  after_tax_cagr_pct: number;
}

export interface ScenarioSummary {
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
  standalone_kelly_cagr_pct: number;
  dispersion_drag_bps: number;
  spread_vs_benchmark_pct: number;
  spread_vs_hurdle_pct: number;
  beats_hurdle: boolean;
  valuation_warnings: string[];
}

export interface ScenarioSummaryOptions {
  isEtf?: boolean;
  fundamentals?: DossierFundamentals | null;
}

export function computeScenarioSummary(
  price: number | null,
  model: DossierModel | null | undefined,
  taxInfo: AfterTaxHurdleInfo,
  opts?: ScenarioSummaryOptions,
): ScenarioSummary | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || !model?.scenarios) {
    return null;
  }
  const horizon = Math.max(1, model.horizon_years || 5);
  const rawCases = model.scenarios;
  const probSum = rawCases.bear.probability + rawCases.base.probability + rawCases.bull.probability;

  const isAccumulating = Boolean(model.accumulating || taxInfo.accumulating);
  const rawDivYieldPct =
    !isAccumulating && Number.isFinite(model.dividend_yield_pct) && model.dividend_yield_pct > 0
      ? model.dividend_yield_pct
      : 0;

  const evalCase = (label: "bear" | "base" | "bull"): ScenarioCaseEval => {
    const c = rawCases[label];
    const ratio = c.target_price_5y / price;
    const priceCagrPct = ratio > 0 ? (Math.pow(ratio, 1 / horizon) - 1) * 100 : -95;
    const grossPct = round(priceCagrPct + rawDivYieldPct, 2);
    const afterTaxPct = round(grossPct - taxInfo.total_tax_drag_pct, 2);
    return {
      label,
      probability: round(c.probability, 4),
      target_price_5y: round(c.target_price_5y, 2),
      multiple: c.multiple ?? null,
      metric_cagr_pct: c.metric_cagr_pct ?? null,
      summary: c.summary,
      gross_cagr_pct: grossPct,
      after_tax_cagr_pct: afterTaxPct,
    };
  };

  const bear = evalCase("bear");
  const base = evalCase("base");
  const bull = evalCase("bull");
  const list = [bear, base, bull];
  const weights = probSum > 0 ? list.map((c) => c.probability / probSum) : [1 / 3, 1 / 3, 1 / 3];

  let expectedPrice = 0;
  let expectedTerminalGross = 0;
  let expectedTerminalAfterTax = 0;
  let logAfterTaxSum = 0;

  for (let i = 0; i < list.length; i += 1) {
    const c = list[i]!;
    const w = weights[i]!;
    expectedPrice += w * c.target_price_5y;
    const rGross = c.gross_cagr_pct / 100;
    const rAfterTax = c.after_tax_cagr_pct / 100;
    expectedTerminalGross += w * price * Math.pow(Math.max(0.01, 1 + rGross), horizon);
    expectedTerminalAfterTax += w * price * Math.pow(Math.max(0.01, 1 + rAfterTax), horizon);
    logAfterTaxSum += w * Math.log(Math.max(0.05, 1 + rAfterTax));
  }

  const expectedPrice5y = round(expectedPrice, 2);
  const expectedGrossCagrPct = round(
    (Math.pow(Math.max(0.0001, expectedTerminalGross / price), 1 / horizon) - 1) * 100,
    2,
  );
  const expectedAfterTaxCagrPct = round(
    (Math.pow(Math.max(0.0001, expectedTerminalAfterTax / price), 1 / horizon) - 1) * 100,
    2,
  );
  const standaloneKellyCagrPct = round((Math.exp(logAfterTaxSum) - 1) * 100, 2);
  const dispersionDragBps = Math.max(0, Math.round((expectedAfterTaxCagrPct - standaloneKellyCagrPct) * 100));
  const spreadVsBenchmark = round(expectedAfterTaxCagrPct - taxInfo.benchmark_cagr_pct, 2);
  const spreadVsHurdle = round(expectedAfterTaxCagrPct - taxInfo.hurdle_cagr_pct, 2);

  // Outside-view GIGO guardrails
  const valuationWarnings: string[] = [];
  const isSingleStock = !opts?.isEtf && !isAccumulating;
  if (isSingleStock) {
    const bearTotalRetPct = round(((bear.target_price_5y - price) / price) * 100, 1);
    if (bearTotalRetPct > -10) {
      valuationWarnings.push(
        `Bear case implies ${bearTotalRetPct >= 0 ? "+" : ""}${bearTotalRetPct}% 5Y price return (> -10%); single-stock downside may be cushioned.`,
      );
    }
  }

  const rd = model.reverse_dcf;
  if (rd?.current_revenue_b && rd.current_revenue_b > 0 && rd.shares_diluted_m && rd.shares_diluted_m > 0) {
    const impliedCurMarginPct = round(
      ((rd.current_metric_per_share * rd.shares_diluted_m) / 1000 / rd.current_revenue_b) * 100,
      1,
    );
    if (impliedCurMarginPct > 65) {
      valuationWarnings.push(
        `Reverse DCF inputs imply ${impliedCurMarginPct}% current ${rd.basis.toUpperCase()} margin (>65% GIGO guardrail — verify shares/metric basis).`,
      );
    }
    const xbrlMargin =
      rd.basis === "fcf"
        ? opts?.fundamentals?.latest_ratios.fcf_margin_pct
        : opts?.fundamentals?.latest_ratios.operating_margin_pct;
    if (typeof xbrlMargin === "number" && Number.isFinite(xbrlMargin) && Math.abs(impliedCurMarginPct - xbrlMargin) >= 20) {
      valuationWarnings.push(
        `Implied current ${rd.basis.toUpperCase()} margin (${impliedCurMarginPct}%) diverges by ${round(Math.abs(impliedCurMarginPct - xbrlMargin), 1)}pp from XBRL (${round(xbrlMargin, 1)}%).`,
      );
    }
  }

  if (rd?.current_revenue_b && rd.current_revenue_b > 25) {
    let baseRevWarned = false;
    if (rd.base_revenue_cagr_pct !== null && rd.base_revenue_cagr_pct !== undefined && rd.base_revenue_cagr_pct > 15) {
      valuationWarnings.push(
        `Base revenue CAGR (${rd.base_revenue_cagr_pct}%) exceeds 15% outside-view cap on $${round(rd.current_revenue_b, 1)}B revenue base.`,
      );
      baseRevWarned = true;
    }
    if (rd.shares_diluted_m && rd.shares_diluted_m > 0 && rd.target_margin_pct && rd.target_margin_pct > 0) {
      const sharesN = rd.shares_diluted_m * Math.pow(1 + (rd.annual_dilution_pct ?? 0) / 100, horizon);
      for (const sc of [base, bull]) {
        const mult = sc.multiple ?? rd.exit_multiple;
        if (!mult || mult <= 0) continue;
        const impliedRevNB = (((sc.target_price_5y / mult) * sharesN) / 1000) / (rd.target_margin_pct / 100);
        const impliedCaseRevCagr = (Math.pow(Math.max(0.0001, impliedRevNB / rd.current_revenue_b), 1 / horizon) - 1) * 100;
        if (impliedCaseRevCagr > 15 && !(sc.label === "base" && baseRevWarned)) {
          valuationWarnings.push(
            `${sc.label.toUpperCase()} scenario implies ${round(impliedCaseRevCagr, 1)}% 5Y revenue CAGR (>15% guardrail above $25B revenue).`,
          );
        }
      }
    }
  }

  if (rd?.shares_diluted_m && rd.shares_diluted_m > 0) {
    const sharesN = rd.shares_diluted_m * Math.pow(1 + (rd.annual_dilution_pct ?? 0) / 100, horizon);
    for (const sc of [base, bull]) {
      const termMcapB = (sc.target_price_5y * sharesN) / 1000;
      if (termMcapB > 5000) {
        valuationWarnings.push(
          `${sc.label.toUpperCase()} scenario implies $${round(termMcapB / 1000, 2)}T terminal market cap (> $5T outside-view guardrail).`,
        );
      }
    }
  }

  // SOTA Quality Guardrail: SBC-adjusted Owner Earnings divergence vs headline FCF
  const fcfMarginXbrl = opts?.fundamentals?.latest_ratios.fcf_margin_pct;
  const oeMarginXbrl = opts?.fundamentals?.latest_ratios.owner_earnings_margin_pct;
  if (
    isSingleStock &&
    typeof fcfMarginXbrl === "number" &&
    typeof oeMarginXbrl === "number" &&
    fcfMarginXbrl - oeMarginXbrl >= 8
  ) {
    valuationWarnings.push(
      `Headline FCF margin (${round(fcfMarginXbrl, 1)}%) exceeds SBC-adjusted Owner Earnings (${round(oeMarginXbrl, 1)}%) by ${round(fcfMarginXbrl - oeMarginXbrl, 1)}pp; verify dilution drag.`,
    );
  }

  return {
    horizon_years: horizon,
    price_used: round(price, 4),
    tax_info: taxInfo,
    cases: { bear, base, bull },
    expected_price_5y: expectedPrice5y,
    expected_gross_cagr_pct: expectedGrossCagrPct,
    expected_after_tax_cagr_pct: expectedAfterTaxCagrPct,
    standalone_kelly_cagr_pct: standaloneKellyCagrPct,
    dispersion_drag_bps: dispersionDragBps,
    spread_vs_benchmark_pct: spreadVsBenchmark,
    spread_vs_hurdle_pct: spreadVsHurdle,
    beats_hurdle: spreadVsHurdle >= 0,
    valuation_warnings: valuationWarnings,
  };
}

export interface ReverseDcfSummary {
  basis: "fcf" | "eps";
  horizon_years: number;
  price_used: number;
  required_gross_cagr_pct: number;
  hurdle_cagr_pct: number;
  total_tax_drag_pct: number;
  implied_target_price_5y: number;
  current_multiple: number;
  exit_multiple: number;
  current_metric_per_share: number;
  implied_metric_per_share_5y: number;
  implied_metric_cagr_pct: number;
  net_cash_b: number | null;
  annual_dilution_pct: number;
  implied_current_margin_pct: number | null;
  multiple_expansion_cagr_pct: number;
  margin_expansion_cagr_pct: number | null;
  residual_revenue_cagr_pct: number | null;
  constant_mult_margin_rev_cagr_pct: number;
  implied_revenue_5y_b: number | null;
  implied_revenue_cagr_pct: number | null;
  base_revenue_cagr_pct: number | null;
  revenue_cagr_gap_pct: number | null;
  consensus_rev_growth_pct?: number | null;
  expectations_gap_vs_consensus_pct?: number | null;
  target_margin_pct: number | null;
  metric_basis_note: string | null;
  linked_hypothesis_ids: string[];
  notes: string | null;
}

export function computeReverseDcf(
  price: number | null,
  model: DossierModel | null | undefined,
  taxInfo: AfterTaxHurdleInfo,
  opts?: { consensusRevGrowthPct?: number | null },
): ReverseDcfSummary | null {
  if (price === null || !Number.isFinite(price) || price <= 0 || !model?.reverse_dcf) {
    return null;
  }
  const rd = model.reverse_dcf;
  const horizon = Math.max(1, model.horizon_years || 5);
  const reqGrossPct = round(taxInfo.hurdle_cagr_pct + taxInfo.total_tax_drag_pct, 2);
  const isAccumulating = Boolean(model.accumulating || taxInfo.accumulating);
  const divYieldPct =
    !isAccumulating && Number.isFinite(model.dividend_yield_pct) && model.dividend_yield_pct > 0
      ? model.dividend_yield_pct
      : 0;
  const reqPriceCagrPct = Math.max(-50, reqGrossPct - divYieldPct);
  const impliedTargetPrice = price * Math.pow(1 + reqPriceCagrPct / 100, horizon);

  const annualDilPct = Number.isFinite(rd.annual_dilution_pct) ? rd.annual_dilution_pct : 0;
  const dilFrac = annualDilPct / 100;
  const shares0M = rd.shares_diluted_m && rd.shares_diluted_m > 0 ? rd.shares_diluted_m : null;
  const shares5yM = shares0M !== null ? shares0M * Math.pow(1 + dilFrac, horizon) : null;

  const netCashB =
    rd.net_cash_b !== null && rd.net_cash_b !== undefined && Number.isFinite(rd.net_cash_b)
      ? rd.net_cash_b
      : null;
  const netCashPerShare0 = netCashB !== null && shares0M !== null ? (netCashB * 1000) / shares0M : 0;
  const netCashPerShare5y = netCashB !== null && shares5yM !== null ? (netCashB * 1000) / shares5yM : netCashPerShare0;

  const evPerShare0 = Math.max(price * 0.1, price - netCashPerShare0);
  const evPerShare5y = Math.max(0.01, impliedTargetPrice - netCashPerShare5y);
  const currentMultiple = evPerShare0 / rd.current_metric_per_share;
  const impliedMetricPerShare = evPerShare5y / rd.exit_multiple;
  const impliedMetricCagrPct =
    (Math.pow(Math.max(0.0001, impliedMetricPerShare / rd.current_metric_per_share), 1 / horizon) - 1) * 100;

  const multipleExpansionCagrPct = round(
    (Math.pow(Math.max(0.0001, rd.exit_multiple / currentMultiple), 1 / horizon) - 1) * 100,
    2,
  );
  const opValCagrFactor = Math.pow(Math.max(0.0001, evPerShare5y / evPerShare0), 1 / horizon);
  const constantMultMarginRevCagrPct = round((opValCagrFactor * (1 + dilFrac) - 1) * 100, 2);

  let impliedCurrentMarginPct: number | null = null;
  let marginExpansionCagrPct: number | null = null;
  let impliedRev5yB: number | null = null;
  let impliedRevCagrPct: number | null = null;
  let revCagrGapPct: number | null = null;

  if (rd.current_revenue_b && rd.current_revenue_b > 0 && shares0M !== null) {
    const currentMetricTotalB = (rd.current_metric_per_share * shares0M) / 1000;
    impliedCurrentMarginPct = round((currentMetricTotalB / rd.current_revenue_b) * 100, 2);

    if (rd.target_margin_pct && rd.target_margin_pct > 0 && shares5yM !== null) {
      if (impliedCurrentMarginPct > 0) {
        marginExpansionCagrPct = round(
          (Math.pow(Math.max(0.0001, rd.target_margin_pct / impliedCurrentMarginPct), 1 / horizon) - 1) * 100,
          2,
        );
      }
      const impliedMetricTotal5yB = (impliedMetricPerShare * shares5yM) / 1000;
      impliedRev5yB = round(impliedMetricTotal5yB / (rd.target_margin_pct / 100), 2);
      impliedRevCagrPct = round(
        (Math.pow(Math.max(0.0001, impliedRev5yB / rd.current_revenue_b), 1 / horizon) - 1) * 100,
        2,
      );
      if (rd.base_revenue_cagr_pct !== null && rd.base_revenue_cagr_pct !== undefined) {
        revCagrGapPct = round(rd.base_revenue_cagr_pct - impliedRevCagrPct, 2);
      }
    }
  }

  const consensusRevGrowth =
    opts?.consensusRevGrowthPct !== null &&
    opts?.consensusRevGrowthPct !== undefined &&
    Number.isFinite(opts.consensusRevGrowthPct)
      ? round(opts.consensusRevGrowthPct, 2)
      : null;
  const expectationsGapVsConsensus =
    consensusRevGrowth !== null && impliedRevCagrPct !== null
      ? round(consensusRevGrowth - impliedRevCagrPct, 2)
      : null;

  return {
    basis: rd.basis,
    horizon_years: horizon,
    price_used: round(price, 4),
    required_gross_cagr_pct: reqGrossPct,
    hurdle_cagr_pct: taxInfo.hurdle_cagr_pct,
    total_tax_drag_pct: taxInfo.total_tax_drag_pct,
    implied_target_price_5y: round(impliedTargetPrice, 2),
    current_multiple: round(currentMultiple, 2),
    exit_multiple: round(rd.exit_multiple, 2),
    current_metric_per_share: round(rd.current_metric_per_share, 4),
    implied_metric_per_share_5y: round(impliedMetricPerShare, 2),
    implied_metric_cagr_pct: round(impliedMetricCagrPct, 2),
    net_cash_b: netCashB,
    annual_dilution_pct: round(annualDilPct, 2),
    implied_current_margin_pct: impliedCurrentMarginPct,
    multiple_expansion_cagr_pct: multipleExpansionCagrPct,
    margin_expansion_cagr_pct: marginExpansionCagrPct,
    residual_revenue_cagr_pct: impliedRevCagrPct,
    constant_mult_margin_rev_cagr_pct: constantMultMarginRevCagrPct,
    implied_revenue_5y_b: impliedRev5yB,
    implied_revenue_cagr_pct: impliedRevCagrPct,
    base_revenue_cagr_pct: rd.base_revenue_cagr_pct ?? null,
    revenue_cagr_gap_pct: revCagrGapPct,
    consensus_rev_growth_pct: consensusRevGrowth,
    expectations_gap_vs_consensus_pct: expectationsGapVsConsensus,
    target_margin_pct: rd.target_margin_pct ?? null,
    metric_basis_note: rd.metric_basis_note ?? null,
    linked_hypothesis_ids: rd.linked_hypothesis_ids ?? [],
    notes: rd.notes ?? null,
  };
}

export interface ValuationMultipleBand {
  current: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  samples: number;
}

export interface ValuationBandsSummary {
  pe: ValuationMultipleBand;
  pfcf: ValuationMultipleBand;
  ps: ValuationMultipleBand;
  as_of: string | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return round(sorted[0]!, 2);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  const val = sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
  return round(val, 2);
}

function buildBand(values: number[], current: number | null): ValuationMultipleBand {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    current: current !== null && Number.isFinite(current) && current > 0 ? round(current, 2) : null,
    p10: sorted.length >= 4 ? percentile(sorted, 0.1) : null,
    median: sorted.length >= 4 ? percentile(sorted, 0.5) : null,
    p90: sorted.length >= 4 ? percentile(sorted, 0.9) : null,
    samples: sorted.length,
  };
}

export function computeValuationBands(
  historySeries: HistorySeries | null | undefined,
  fundamentals: DossierFundamentals | null | undefined,
  currentPrice: number | null,
): ValuationBandsSummary | null {
  if (!fundamentals) return null;

  interface TtmAnchor {
    date: string;
    ttmEps: number | null;
    ttmFcfPs: number | null;
    ttmRevPs: number | null;
  }

  const anchors: TtmAnchor[] = [];
  const qAsc = [...fundamentals.quarterly].sort((a, b) => a.period_end.localeCompare(b.period_end));
  for (let i = 3; i < qAsc.length; i += 1) {
    const win = qAsc.slice(i - 3, i + 1);
    const latest = win[3]!;
    const shares = latest.diluted_shares_m ?? null;

    let ttmEps: number | null = null;
    if (win.every((q) => typeof q.eps_diluted === "number")) {
      ttmEps = win.reduce((acc, q) => acc + (q.eps_diluted ?? 0), 0);
    } else if (shares && shares > 0 && win.every((q) => typeof q.net_income_m === "number")) {
      ttmEps = win.reduce((acc, q) => acc + (q.net_income_m ?? 0), 0) / shares;
    }

    const ttmFcfPs =
      shares && shares > 0 && win.every((q) => typeof q.fcf_m === "number")
        ? win.reduce((acc, q) => acc + (q.fcf_m ?? 0), 0) / shares
        : null;
    const ttmRevPs =
      shares && shares > 0 && win.every((q) => typeof q.revenue_m === "number")
        ? win.reduce((acc, q) => acc + (q.revenue_m ?? 0), 0) / shares
        : null;

    anchors.push({
      date: latest.filed_date ?? latest.period_end,
      ttmEps,
      ttmFcfPs,
      ttmRevPs,
    });
  }

  const earliestQAnchorDate = anchors[0]?.date ?? "9999-99-99";
  const aAsc = [...fundamentals.annual].sort((a, b) => a.period_end.localeCompare(b.period_end));
  for (const fy of aAsc) {
    const anchorDate = fy.filed_date ?? fy.period_end;
    if (anchorDate >= earliestQAnchorDate) continue;
    const shares = fy.diluted_shares_m ?? null;
    const ttmEps =
      typeof fy.eps_diluted === "number"
        ? fy.eps_diluted
        : shares && shares > 0 && typeof fy.net_income_m === "number"
          ? fy.net_income_m / shares
          : null;
    const ttmFcfPs = shares && shares > 0 && typeof fy.fcf_m === "number" ? fy.fcf_m / shares : null;
    const ttmRevPs = shares && shares > 0 && typeof fy.revenue_m === "number" ? fy.revenue_m / shares : null;
    anchors.push({ date: anchorDate, ttmEps, ttmFcfPs, ttmRevPs });
  }
  anchors.sort((a, b) => a.date.localeCompare(b.date));

  const lr = fundamentals.latest_ratios;
  const curPe =
    currentPrice && currentPrice > 0 && lr.ttm_eps && lr.ttm_eps > 0 ? currentPrice / lr.ttm_eps : null;
  const curPfcf =
    currentPrice && currentPrice > 0 && lr.ttm_fcf_per_share && lr.ttm_fcf_per_share > 0
      ? currentPrice / lr.ttm_fcf_per_share
      : null;
  const curPs =
    currentPrice && currentPrice > 0 && lr.ttm_rev_per_share && lr.ttm_rev_per_share > 0
      ? currentPrice / lr.ttm_rev_per_share
      : null;

  const peSamples: number[] = [];
  const pfcfSamples: number[] = [];
  const psSamples: number[] = [];

  if (historySeries && historySeries.points.length > 0 && anchors.length > 0) {
    const lastDate = historySeries.points[historySeries.points.length - 1]!.date;
    const cutoffMs = Date.parse(`${lastDate}T00:00:00Z`) - 5 * 365.25 * 86400 * 1000;

    let aIdx = 0;
    for (const pt of historySeries.points) {
      const ptMs = Date.parse(`${pt.date}T00:00:00Z`);
      if (Number.isFinite(cutoffMs) && Number.isFinite(ptMs) && ptMs < cutoffMs) continue;
      while (aIdx + 1 < anchors.length && anchors[aIdx + 1]!.date <= pt.date) {
        aIdx += 1;
      }
      const anchor = anchors[aIdx]!;
      if (anchor.date > pt.date) continue;

      if (anchor.ttmEps && anchor.ttmEps > 0) {
        const m = pt.close / anchor.ttmEps;
        if (m > 0 && m < 500) peSamples.push(m);
      }
      if (anchor.ttmFcfPs && anchor.ttmFcfPs > 0) {
        const m = pt.close / anchor.ttmFcfPs;
        if (m > 0 && m < 500) pfcfSamples.push(m);
      }
      if (anchor.ttmRevPs && anchor.ttmRevPs > 0) {
        const m = pt.close / anchor.ttmRevPs;
        if (m > 0 && m < 200) psSamples.push(m);
      }
    }
  }

  return {
    pe: buildBand(peSamples, curPe),
    pfcf: buildBand(pfcfSamples, curPfcf),
    ps: buildBand(psSamples, curPs),
    as_of: fundamentals.quarterly[0]?.period_end ?? fundamentals.annual[0]?.period_end ?? null,
  };
}

export interface HypothesisAutoEval {
  observed: number | null;
  period: string | null;
  passed: boolean | null;
  detail: string;
  source: HypothesisRule["source"];
}

function compareRuleOp(observed: number, op: HypothesisRule["op"], threshold: number): boolean {
  if (op === "<=") return observed <= threshold + 1e-6;
  if (op === "<") return observed < threshold;
  if (op === ">=") return observed >= threshold - 1e-6;
  if (op === ">") return observed > threshold;
  return Math.abs(observed - threshold) <= 1e-6;
}

export function evaluateHypothesisRule(
  rule: HypothesisRule,
  fundamentals?: DossierFundamentals | null,
  edgarRows?: EdgarFilingRow[] | null,
  insiders?: DossierInsiders | null,
  marketEntry?: MarketCacheEntry | null,
): HypothesisAutoEval {
  const metric = rule.metric.trim().toLowerCase();
  const opStr = `${rule.op} ${rule.threshold}`;

  if (rule.source === "xbrl") {
    if (!fundamentals) {
      return {
        observed: null,
        period: null,
        passed: null,
        detail: `No synced XBRL fundamentals to check ${rule.metric} ${opStr}`,
        source: "xbrl",
      };
    }

    let observed: number | null = null;
    let periodLabel: string | null = null;
    let overrideUsed = false;

    const overrideVal = fundamentals.overrides?.[rule.metric] ?? fundamentals.overrides?.[metric];
    if (rule.period === "latest_q" && typeof overrideVal === "number" && Number.isFinite(overrideVal)) {
      observed = overrideVal;
      periodLabel = fundamentals.quarterly[0]?.period_end ?? fundamentals.annual[0]?.period_end ?? "override";
      overrideUsed = true;
    } else if (rule.period === "latest_fy") {
      const fy = fundamentals.annual[0];
      if (fy) {
        periodLabel = fy.period_end;
        if (metric === "revenue_b" && typeof fy.revenue_m === "number") observed = round(fy.revenue_m / 1000, 3);
        else {
          const val = (fy as Record<string, unknown>)[metric];
          if (typeof val === "number" && Number.isFinite(val)) observed = val;
        }
      }
    } else if (rule.period === "ttm") {
      const q4 = fundamentals.quarterly.slice(0, 4);
      if (q4.length === 4) {
        periodLabel = `TTM ${q4[0]!.period_end}`;
        const sumField = (k: keyof (typeof q4)[number]): number | null => {
          if (!q4.every((q) => typeof q[k] === "number")) return null;
          return q4.reduce((acc, q) => acc + ((q[k] as number) ?? 0), 0);
        };
        const ttmRev = sumField("revenue_m");
        const ttmGp = sumField("gross_profit_m");
        const ttmOp = sumField("operating_income_m");
        const ttmNi = sumField("net_income_m");
        const ttmOcf = sumField("ocf_m");
        const ttmFcf = sumField("fcf_m");
        const ttmSbc = sumField("sbc_m");
        if (metric === "gross_margin_pct" && ttmRev && ttmRev > 0 && ttmGp !== null) observed = round((ttmGp / ttmRev) * 100, 2);
        else if (metric === "operating_margin_pct" && ttmRev && ttmRev > 0 && ttmOp !== null) observed = round((ttmOp / ttmRev) * 100, 2);
        else if (metric === "fcf_margin_pct" && ttmRev && ttmRev > 0 && ttmFcf !== null) observed = round((ttmFcf / ttmRev) * 100, 2);
        else if (metric === "owner_earnings_margin_pct" && ttmRev && ttmRev > 0 && ttmFcf !== null) {
          const oe = ttmSbc !== null ? ttmFcf - ttmSbc : ttmFcf;
          observed = round((oe / ttmRev) * 100, 2);
        }
        else if (metric === "ocf_to_ni_pct" && ttmNi && ttmNi > 0 && ttmOcf !== null) observed = round((ttmOcf / ttmNi) * 100, 2);
        else if (metric === "sbc_pct_rev" && ttmRev && ttmRev > 0 && ttmSbc !== null) observed = round((ttmSbc / ttmRev) * 100, 2);
        else if (metric === "revenue_b" && ttmRev !== null) observed = round(ttmRev / 1000, 3);
        else {
          const fromRatios = (fundamentals.latest_ratios as Record<string, unknown>)[metric];
          if (typeof fromRatios === "number" && Number.isFinite(fromRatios)) observed = fromRatios;
        }
      } else {
        const fromRatios = (fundamentals.latest_ratios as Record<string, unknown>)[metric];
        if (typeof fromRatios === "number" && Number.isFinite(fromRatios)) {
          observed = fromRatios;
          periodLabel = fundamentals.annual[0]?.period_end ?? fundamentals.quarterly[0]?.period_end ?? "ttm";
        }
      }
    } else {
      const q0 = fundamentals.quarterly[0] ?? fundamentals.annual[0];
      if (q0) {
        periodLabel = q0.period_end;
        if (metric === "revenue_b" && typeof q0.revenue_m === "number") {
          observed = round(q0.revenue_m / 1000, 3);
        } else {
          const qVal = (q0 as Record<string, unknown>)[metric];
          if (typeof qVal === "number" && Number.isFinite(qVal)) {
            observed = qVal;
          } else {
            const ratioVal = (fundamentals.latest_ratios as Record<string, unknown>)[metric];
            if (typeof ratioVal === "number" && Number.isFinite(ratioVal)) observed = ratioVal;
          }
        }
      } else {
        const ratioVal = (fundamentals.latest_ratios as Record<string, unknown>)[metric];
        if (typeof ratioVal === "number" && Number.isFinite(ratioVal)) {
          observed = ratioVal;
          periodLabel = "latest";
        }
      }
    }

    if (observed === null) {
      return {
        observed: null,
        period: periodLabel,
        passed: null,
        detail: `XBRL metric ${rule.metric} unavailable for ${rule.period}`,
        source: "xbrl",
      };
    }
    const passed = compareRuleOp(observed, rule.op, rule.threshold);
    return {
      observed: round(observed, 2),
      period: periodLabel,
      passed,
      detail: `XBRL ${rule.metric} = ${round(observed, 2)} (${periodLabel ?? rule.period}${overrideUsed ? ", override" : ""}) vs ${opStr} -> ${passed ? "PASS" : "BREACH"}`,
      source: "xbrl",
    };
  }

  if (rule.source === "edgar") {
    const rows = edgarRows ?? [];
    if (rows.length === 0) {
      return {
        observed: null,
        period: null,
        passed: null,
        detail: `No cached EDGAR filings to check ${rule.metric}`,
        source: "edgar",
      };
    }
    const latestDate = rows[0]?.filingDate ?? null;
    const redFlags = extractSecRedFlags({ _TARGET: rows });
    let observed: number | null = null;
    if (metric === "filing_10q_on_time" || metric === "no_nt_filing") {
      const hasNt = redFlags.some((f) => f.code === "NT 10-Q" || f.code === "NT 10-K");
      observed = hasNt ? 0 : 1;
    } else if (metric === "no_restatement" || metric === "no_red_flags") {
      const hasHigh = redFlags.some((f) => f.severity === "high");
      observed = hasHigh ? 0 : 1;
    } else if (metric === "sec_red_flag_count") {
      observed = redFlags.length;
    }
    if (observed === null) {
      return {
        observed: null,
        period: latestDate,
        passed: null,
        detail: `Unsupported EDGAR rule metric: ${rule.metric}`,
        source: "edgar",
      };
    }
    const passed = compareRuleOp(observed, rule.op, rule.threshold);
    return {
      observed,
      period: latestDate,
      passed,
      detail: `EDGAR ${rule.metric} = ${observed} (latest ${latestDate ?? "n/a"}) vs ${opStr} -> ${passed ? "PASS" : "BREACH"}`,
      source: "edgar",
    };
  }

  if (rule.source === "insiders") {
    if (!insiders) {
      return {
        observed: null,
        period: null,
        passed: null,
        detail: `No synced Form 4 insider data to check ${rule.metric}`,
        source: "insiders",
      };
    }
    const periodLabel = insiders.updated_at.slice(0, 10);
    const map: Record<string, number> = {
      disc_buy_90d_usd: insiders.window_90d.disc_buy_usd,
      disc_sell_90d_usd: insiders.window_90d.disc_sell_usd,
      plan_sell_90d_usd: insiders.window_90d.plan_sell_usd,
      distinct_buyers_90d: insiders.window_90d.distinct_buyers,
      distinct_sellers_90d: insiders.window_90d.distinct_sellers,
      disc_buy_12m_usd: insiders.window_12m.disc_buy_usd,
      disc_sell_12m_usd: insiders.window_12m.disc_sell_usd,
      plan_sell_12m_usd: insiders.window_12m.plan_sell_usd,
      net_disc_90d_usd: round(insiders.window_90d.disc_buy_usd - insiders.window_90d.disc_sell_usd, 2),
      net_disc_12m_usd: round(insiders.window_12m.disc_buy_usd - insiders.window_12m.disc_sell_usd, 2),
    };
    const observed = map[metric] ?? null;
    if (observed === null) {
      return {
        observed: null,
        period: periodLabel,
        passed: null,
        detail: `Unsupported insider metric: ${rule.metric}`,
        source: "insiders",
      };
    }
    const passed = compareRuleOp(observed, rule.op, rule.threshold);
    return {
      observed,
      period: periodLabel,
      passed,
      detail: `Insiders ${rule.metric} = ${observed} vs ${opStr} -> ${passed ? "PASS" : "BREACH"}`,
      source: "insiders",
    };
  }

  if (!marketEntry) {
    return {
      observed: null,
      period: null,
      passed: null,
      detail: `No market quote cached to check ${rule.metric}`,
      source: "market",
    };
  }
  const mVal = (marketEntry as Record<string, unknown>)[metric];
  if (typeof mVal !== "number" || !Number.isFinite(mVal)) {
    return {
      observed: null,
      period: marketEntry.quote_time?.slice(0, 10) ?? null,
      passed: null,
      detail: `Market metric ${rule.metric} unavailable`,
      source: "market",
    };
  }
  const passed = compareRuleOp(mVal, rule.op, rule.threshold);
  return {
    observed: round(mVal, 2),
    period: marketEntry.quote_time?.slice(0, 10) ?? null,
    passed,
    detail: `Market ${rule.metric} = ${round(mVal, 2)} vs ${opStr} -> ${passed ? "PASS" : "BREACH"}`,
    source: "market",
  };
}

export interface DipTriageThesisInput {
  ticker: string;
  tier?: DossierTier;
  us_situs: boolean;
  gated: boolean;
  max_weight_pct: number | null;
  buy_zone_low: number | null;
  buy_zone_high: number | null;
  trim_zone?: number | null;
  next_catalyst?: string | null;
  reentry_price?: number | null;
  tranches?: TrancheRule[];
  verdict?: string | null;
  kill_switch_triggered?: boolean;
  is_etf?: boolean;
}

export interface DipTriageRiskCapRef {
  id: string;
  label: string;
  value_pct: number;
  cap_pct: number;
  status: "PASS" | "BREACH";
}

export interface DipTriageLookthroughRef {
  name: string;
  total_usd: number;
  total_base: number;
  pct_nav: number;
}

export interface DipTriageTranche {
  label: string;
  price: number;
  pct_of_add: number;
  amount_base: number;
  note?: string;
}

export interface DipTriageOptions {
  positionWeightMap?: Map<string, number>;
  availableFundingBase?: number | null;
  vix?: number | null;
}

export interface DipTriageResult {
  readiness: "READY" | "GATED" | "WAIT" | "REENTRY_ALERT" | "PASSED" | "CAP_BLOCKED";
  risk_cap_check: {
    status: "PASS" | "WARN" | "FAIL";
    current_weight_pct: number;
    effective_cap_pct: number | null;
    room_pct: number;
    single_name_room_pct: number;
    portfolio_cap_room_pct: number;
    room_base: number;
    room_usd: number;
    available_funding_base: number | null;
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
  high_vol_staged: boolean;
  reentry_alert: boolean;
}

export function computeDipTriage(
  thesis: DipTriageThesisInput,
  price: number | null,
  scenarioSummary: ScenarioSummary | null,
  riskCaps: DipTriageRiskCapRef[],
  profile: UserProfile,
  edgarGates: SecGateEvaluation[],
  catalysts: CatalystRecord[],
  navBase: number,
  usdToBaseFx: number,
  lookthroughMap: Map<string, DipTriageLookthroughRef>,
  opts?: DipTriageOptions,
): DipTriageResult {
  const sym = thesis.ticker.trim().toUpperCase();
  const canon = canonicalAssetName(sym);
  const benchTicker = profile.benchmark.ticker.trim().toUpperCase();
  const isBenchmark = sym === benchTicker;
  const isEtf = Boolean(thesis.is_etf || isBenchmark);

  const currentPct =
    lookthroughMap.get(canon)?.pct_nav ??
    opts?.positionWeightMap?.get(sym) ??
    opts?.positionWeightMap?.get(canon) ??
    0;
  const capById = new Map(riskCaps.map((r) => [r.id, r]));

  let singleNameRoomPct = Number.POSITIVE_INFINITY;
  let singleNameCapPct: number | null = null;
  let singleNameLabel = "Thesis max weight";

  if (thesis.max_weight_pct !== null && Number.isFinite(thesis.max_weight_pct)) {
    singleNameRoomPct = thesis.max_weight_pct - currentPct;
    singleNameCapPct = thesis.max_weight_pct;
    singleNameLabel = `Thesis cap (${thesis.max_weight_pct}%)`;
  }

  for (const rule of profile.risk_caps) {
    if (rule.kind === "single_name_max" && !isEtf) {
      const room = rule.cap_pct - currentPct;
      if (room < singleNameRoomPct) {
        singleNameRoomPct = room;
        singleNameCapPct = rule.cap_pct;
        singleNameLabel = rule.label;
      }
    } else if (rule.kind === "ticker" && rule.ticker && canonicalAssetName(rule.ticker) === canon) {
      const room = rule.cap_pct - currentPct;
      if (room < singleNameRoomPct) {
        singleNameRoomPct = room;
        singleNameCapPct = rule.cap_pct;
        singleNameLabel = rule.label;
      }
    }
  }

  if (!Number.isFinite(singleNameRoomPct)) {
    singleNameRoomPct = Math.max(0, (isBenchmark ? 70 : 10) - currentPct);
    singleNameCapPct = isBenchmark ? 70 : 10;
    singleNameLabel = isBenchmark ? "Core benchmark allocation" : "Default 10% single-name guideline";
  }

  let portfolioCapRoomPct = singleNameRoomPct;
  let effectiveCapPct = singleNameCapPct;
  let bindingLabel = singleNameLabel;

  for (const rule of profile.risk_caps) {
    const evalRow = capById.get(rule.id);
    if (rule.kind === "bucket" && (rule.tickers ?? []).some((t) => canonicalAssetName(t) === canon)) {
      const used = evalRow?.value_pct ?? currentPct;
      const room = rule.cap_pct - used;
      if (room < portfolioCapRoomPct) {
        portfolioCapRoomPct = room;
        effectiveCapPct = rule.cap_pct;
        bindingLabel = rule.label;
      }
    } else if (rule.kind === "us_situs" && thesis.us_situs) {
      const used = evalRow?.value_pct ?? 0;
      const room = rule.cap_pct - used;
      if (room < portfolioCapRoomPct) {
        portfolioCapRoomPct = room;
        effectiveCapPct = rule.cap_pct;
        bindingLabel = rule.label;
      }
    }
  }

  const singleRoomRounded = round(singleNameRoomPct, 2);
  const portfolioRoomRounded = round(portfolioCapRoomPct, 2);
  const roomPct = portfolioRoomRounded;
  const roomBase = round(Math.max(0, roomPct / 100) * Math.max(0, navBase), 2);
  const roomUsd = usdToBaseFx > 0 ? round(roomBase / usdToBaseFx, 2) : 0;
  const availableFundingBase =
    opts?.availableFundingBase !== null &&
    opts?.availableFundingBase !== undefined &&
    Number.isFinite(opts.availableFundingBase)
      ? round(Math.max(0, opts.availableFundingBase), 2)
      : null;

  let capStatus: "PASS" | "WARN" | "FAIL" = "PASS";
  let capNote = `${roomPct.toFixed(1)}% NAV room under ${bindingLabel}`;
  if (roomPct <= 0) {
    capStatus = "FAIL";
    capNote =
      singleRoomRounded > 0
        ? `Portfolio cap full (${bindingLabel}); ${singleRoomRounded.toFixed(1)}% single-name swap room only`
        : `At or above ${bindingLabel} (${roomPct.toFixed(1)}% room)`;
  } else if (roomPct < 2.0) {
    capStatus = "WARN";
    capNote = `Tight headroom: ${roomPct.toFixed(1)}% NAV left under ${bindingLabel}`;
  }

  // 2. Binary & SEC Gate check
  const openSecGate = edgarGates.find((g) => g.ticker.toUpperCase() === sym && !g.cleared);
  const tickerHighCat = catalysts.find((c) => c.ticker.toUpperCase() === sym && c.urgency === "high");
  let gateStatus: "PASS" | "BLOCKED" = "PASS";
  let gateReason = "No open binary or SEC filing gates";
  if (openSecGate) {
    gateStatus = "BLOCKED";
    gateReason = `Open SEC ${openSecGate.form} gate (filed after ${openSecGate.filed_after}): ${openSecGate.description}`;
  } else if (thesis.gated) {
    gateStatus = "BLOCKED";
    gateReason = thesis.next_catalyst
      ? `Binary gate active — ${thesis.next_catalyst}`
      : tickerHighCat
        ? `Binary gate active — ${tickerHighCat.date}: ${tickerHighCat.title}`
        : "Binary catalyst / forensic gate active";
  }

  // 3. After-Tax Hurdle check (exempt benchmark from +alpha_buffer_pct)
  let hurdleStatus: DipTriageResult["hurdle_check"]["status"] = "UNMODELED";
  let hurdleNote = "Add 5Y Bear/Base/Bull model to test after-tax hurdle";
  let hurdleExpectedCagr: number | null = scenarioSummary ? scenarioSummary.expected_after_tax_cagr_pct : null;
  let hurdleTargetCagr: number | null = scenarioSummary ? scenarioSummary.tax_info.hurdle_cagr_pct : null;
  let hurdleSpread: number | null = scenarioSummary ? scenarioSummary.spread_vs_hurdle_pct : null;

  if (isBenchmark) {
    hurdleStatus = "CORE_ANCHOR";
    hurdleExpectedCagr = scenarioSummary ? scenarioSummary.expected_after_tax_cagr_pct : profile.benchmark.expected_cagr_pct;
    hurdleTargetCagr = profile.benchmark.expected_cagr_pct;
    hurdleSpread = round((hurdleExpectedCagr ?? profile.benchmark.expected_cagr_pct) - profile.benchmark.expected_cagr_pct, 2);
    hurdleNote = `Core benchmark anchor (${profile.benchmark.expected_cagr_pct.toFixed(1)}% expected CAGR; exempt from +${profile.benchmark.alpha_buffer_pct.toFixed(1)}% alpha buffer)`;
  } else if (scenarioSummary) {
    const spread = scenarioSummary.spread_vs_hurdle_pct;
    const hurdle = scenarioSummary.tax_info.hurdle_cagr_pct;
    if (spread >= 0) {
      hurdleStatus = "PASS";
      hurdleNote = `+${spread.toFixed(2)}% vs ${hurdle.toFixed(1)}% after-tax hurdle`;
    } else {
      hurdleStatus = "FAIL";
      hurdleNote = `${spread.toFixed(2)}% vs ${hurdle.toFixed(1)}% after-tax hurdle`;
    }
  }

  // 4. Staged Tranche Plan (capped by available funding when known; annotated for VIX >= 28)
  const highVolStaged = Boolean(opts?.vix !== null && opts?.vix !== undefined && Number.isFinite(opts.vix) && opts.vix >= 28);
  const deployableBudgetBase = availableFundingBase !== null ? Math.min(roomBase, availableFundingBase) : roomBase;
  const annotateTrancheNote = (note?: string): string | undefined => {
    if (!highVolStaged) return note;
    const tag = "High-Vol Staged (2-3w apart)";
    return note ? `${note} · ${tag}` : tag;
  };

  const tranchePlan: DipTriageTranche[] = [];
  if (thesis.tranches && thesis.tranches.length > 0) {
    for (const tr of thesis.tranches) {
      tranchePlan.push({
        label: tr.label,
        price: round(tr.price, 2),
        pct_of_add: round(tr.pct_of_add, 1),
        amount_base: round(deployableBudgetBase * (tr.pct_of_add / 100), 2),
        note: annotateTrancheNote(tr.note),
      });
    }
  } else if (
    thesis.buy_zone_low !== null &&
    thesis.buy_zone_high !== null &&
    thesis.buy_zone_high > 0 &&
    thesis.buy_zone_low >= 0 &&
    thesis.buy_zone_high >= thesis.buy_zone_low
  ) {
    if (thesis.buy_zone_high > thesis.buy_zone_low) {
      const mid = round((thesis.buy_zone_low + thesis.buy_zone_high) / 2, 2);
      tranchePlan.push(
        {
          label: "Tranche 1 (Top of Zone)",
          price: round(thesis.buy_zone_high, 2),
          pct_of_add: 35,
          amount_base: round(deployableBudgetBase * 0.35, 2),
          note: annotateTrancheNote(),
        },
        {
          label: "Tranche 2 (Mid-Zone)",
          price: mid,
          pct_of_add: 40,
          amount_base: round(deployableBudgetBase * 0.4, 2),
          note: annotateTrancheNote(),
        },
        {
          label: "Tranche 3 (Deep Value)",
          price: round(thesis.buy_zone_low, 2),
          pct_of_add: 25,
          amount_base: round(deployableBudgetBase * 0.25, 2),
          note: annotateTrancheNote(),
        },
      );
    } else {
      tranchePlan.push(
        {
          label: "Tranche 1 (Target Entry)",
          price: round(thesis.buy_zone_low, 2),
          pct_of_add: 50,
          amount_base: round(deployableBudgetBase * 0.5, 2),
          note: annotateTrancheNote(),
        },
        {
          label: "Tranche 2 (-8% Buffer)",
          price: round(thesis.buy_zone_low * 0.92, 2),
          pct_of_add: 50,
          amount_base: round(deployableBudgetBase * 0.5, 2),
          note: annotateTrancheNote(),
        },
      );
    }
  }

  const reentryAlert = Boolean(
    thesis.tier === "passed" &&
      thesis.reentry_price !== null &&
      thesis.reentry_price !== undefined &&
      price !== null &&
      Number.isFinite(price) &&
      price <= thesis.reentry_price,
  );

  const inBuyOrDeep =
    price !== null &&
    thesis.buy_zone_high !== null &&
    Number.isFinite(price) &&
    price <= thesis.buy_zone_high;

  const verdictBlocked =
    Boolean(thesis.kill_switch_triggered) ||
    thesis.verdict === "PROBATION" ||
    thesis.verdict === "EXIT";

  // Priority order: PASSED/REENTRY -> GATED -> CAP_BLOCKED -> READY (only if PASS/CORE_ANCHOR & not verdictBlocked) -> WAIT
  let readiness: DipTriageResult["readiness"] = "WAIT";
  if (thesis.tier === "passed") {
    readiness = reentryAlert ? "REENTRY_ALERT" : "PASSED";
  } else if (gateStatus === "BLOCKED") {
    readiness = "GATED";
  } else if (capStatus === "FAIL") {
    readiness = "CAP_BLOCKED";
  } else if (!verdictBlocked && inBuyOrDeep && (hurdleStatus === "PASS" || hurdleStatus === "CORE_ANCHOR")) {
    readiness = "READY";
  } else {
    readiness = "WAIT";
  }

  return {
    readiness,
    risk_cap_check: {
      status: capStatus,
      current_weight_pct: round(currentPct, 2),
      effective_cap_pct: effectiveCapPct !== null ? round(effectiveCapPct, 2) : null,
      room_pct: roomPct,
      single_name_room_pct: singleRoomRounded,
      portfolio_cap_room_pct: portfolioRoomRounded,
      room_base: roomBase,
      room_usd: roomUsd,
      available_funding_base: availableFundingBase,
      note: capNote,
    },
    gate_check: {
      status: gateStatus,
      reason: gateReason,
    },
    hurdle_check: {
      status: hurdleStatus,
      expected_after_tax_cagr_pct: hurdleExpectedCagr,
      hurdle_cagr_pct: hurdleTargetCagr,
      spread_vs_hurdle_pct: hurdleSpread,
      note: hurdleNote,
    },
    tranche_plan: tranchePlan,
    high_vol_staged: highVolStaged,
    reentry_alert: reentryAlert,
  };
}

export interface RotationThesisRef {
  ticker: string;
  tier?: DossierTier;
  verdict?: string | null;
  max_weight_pct?: number | null;
  kill_switch_triggered?: boolean;
  rejection_reason?: string | null;
}

export interface RotationPositionRef {
  ticker: string;
  asset_type: string;
  us_situs: boolean;
  currency: string;
  qty: number;
  price: number;
  mv_usd: number;
  mv_base: number;
  weight_nav_pct: number;
}

export interface TaxSwapItem {
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

export interface MandatoryExitItem {
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

export interface CapTrimItem {
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

export interface CapitalRotationQueue {
  tax_swaps: TaxSwapItem[];
  mandatory_exits: MandatoryExitItem[];
  cap_trims: CapTrimItem[];
  total_swap_base: number;
  total_freed_base: number;
  total_estate_tax_saved_base: number;
}

export interface CapitalRotationOptions {
  positionsOut?: RotationPositionRef[];
  navBase?: number;
  etfWeights?: EtfWeightsConfig;
}

export function computeCapitalRotationQueue(
  portfolio: PortfolioRecord,
  lookthrough: DipTriageLookthroughRef[],
  riskCaps: DipTriageRiskCapRef[],
  theses: RotationThesisRef[],
  profile: UserProfile,
  fxUsdToBase: number,
  opts?: CapitalRotationOptions,
): CapitalRotationQueue {
  const safeFxUsd = fxUsdToBase > 0 ? fxUsdToBase : 1.0;
  const fxRates: Record<string, number> = { ...portfolio.fx_rates, USD: safeFxUsd, [profile.base_currency]: 1.0 };

  let positions: RotationPositionRef[];
  let navBase: number;

  if (opts?.positionsOut && opts.navBase !== undefined) {
    positions = opts.positionsOut;
    navBase = opts.navBase;
  } else {
    let posSumBase = 0;
    const rawPos = portfolio.positions.map((p) => {
      const ccyFx = fxRates[p.currency] ?? safeFxUsd;
      const mvTrading = p.qty * p.ref_price;
      const mvBase = mvTrading * ccyFx;
      const mvUsd = p.currency === "USD" ? mvTrading : mvBase / safeFxUsd;
      posSumBase += mvBase;
      return {
        ticker: p.ticker,
        asset_type: p.asset_type,
        us_situs: p.us_situs,
        currency: p.currency,
        qty: p.qty,
        price: p.ref_price,
        mv_usd: round(mvUsd, 2),
        mv_base: round(mvBase, 2),
        weight_nav_pct: 0,
      };
    });
    navBase = portfolio.reported_nav_base ?? round(posSumBase + portfolio.cash_base + portfolio.accruals_base, 2);
    positions = rawPos.map((p) => ({
      ...p,
      weight_nav_pct: navBase > 0 ? round((p.mv_base / navBase) * 100, 2) : 0,
    }));
  }

  const heldPositions = positions.filter((p) => p.qty > 0 && p.mv_base > 0.01);
  const benchTicker = profile.benchmark.ticker.toUpperCase();
  const thesisByTicker = new Map(theses.map((t) => [t.ticker.toUpperCase(), t]));
  const etfWeightsMap = opts?.etfWeights?.etf_weights ?? {};
  const etfMetaMap = opts?.etfWeights?.etf_metadata ?? {};

  const isUsEtf = (p: RotationPositionRef): boolean =>
    p.us_situs &&
    p.ticker.toUpperCase() !== benchTicker &&
    (p.asset_type.toUpperCase().includes("ETF") || KNOWN_US_ETF_TICKERS.has(p.ticker.toUpperCase()));

  const ext = profile.external_exposure;
  const extUsSitusUsd = ext.enabled && ext.us_situs ? ext.amount_base / safeFxUsd : 0;
  let runningUsSitusUsd =
    heldPositions.filter((p) => p.us_situs).reduce((acc, p) => acc + p.mv_usd, 0) + extUsSitusUsd;

  const etfBucketFrac = (etfSym: string, rule: UserProfile["risk_caps"][number]): number => {
    const weights = etfWeightsMap[etfSym];
    if (!weights) return 0;
    const canonSet = new Set((rule.tickers ?? []).map((t) => canonicalAssetName(t)));
    let frac = 0;
    for (const [k, v] of Object.entries(weights)) {
      if (typeof v === "number" && canonSet.has(canonicalAssetName(k))) {
        frac += v;
      }
    }
    if (rule.include_etf_residual_key) {
      const res = (etfMetaMap[etfSym] as Record<string, unknown> | undefined)?.[rule.include_etf_residual_key];
      if (typeof res === "number") frac += res;
    }
    return frac;
  };

  const capReliefPct = new Map<string, number>();
  const remainingLtPct = new Map<string, number>(lookthrough.map((r) => [r.name, r.pct_nav]));
  const remainingSharesByTicker = new Map<string, number>(
    heldPositions.map((p) => [p.ticker.toUpperCase(), p.qty]),
  );
  const swappedTickers = new Set<string>();
  const exitedTickers = new Set<string>();

  const propagateAssetReduction = (tickerSym: string, usSitus: boolean, pctNavReduced: number): void => {
    if (pctNavReduced <= 0) return;
    const canon = canonicalAssetName(tickerSym);
    if (remainingLtPct.has(canon)) {
      remainingLtPct.set(canon, Math.max(0, round((remainingLtPct.get(canon) ?? 0) - pctNavReduced, 4)));
    }
    for (const cap of riskCaps) {
      const rule = profile.risk_caps.find((r) => r.id === cap.id);
      if (!rule) continue;
      if (rule.kind === "us_situs" && usSitus) {
        capReliefPct.set(cap.id, (capReliefPct.get(cap.id) ?? 0) + pctNavReduced);
      } else if (rule.kind === "bucket" && (rule.tickers ?? []).some((t) => canonicalAssetName(t) === canon)) {
        capReliefPct.set(cap.id, (capReliefPct.get(cap.id) ?? 0) + pctNavReduced);
      } else if (rule.kind === "ticker" && rule.ticker && canonicalAssetName(rule.ticker) === canon) {
        capReliefPct.set(cap.id, (capReliefPct.get(cap.id) ?? 0) + pctNavReduced);
      }
    }
  };

  // Tier 1: US-ETF -> Benchmark UCITS Tax-Arbitrage Swaps
  const taxSwaps: TaxSwapItem[] = [];
  if (profile.tax_profile.nra_us_estate_tax_enabled) {
    const usEtfs = heldPositions.filter(isUsEtf).sort((a, b) => b.mv_usd - a.mv_usd);
    const whtDiffFrac = Math.max(
      0,
      (profile.tax_profile.us_dividend_wht_pct - profile.tax_profile.ucits_dividend_wht_pct) / 100,
    );

    for (const etf of usEtfs) {
      const beforeTaxUsd = computeUsEstateTaxNra(runningUsSitusUsd).net_estate_tax_usd;
      const afterTaxUsd = computeUsEstateTaxNra(Math.max(0, runningUsSitusUsd - etf.mv_usd)).net_estate_tax_usd;
      runningUsSitusUsd = Math.max(0, runningUsSitusUsd - etf.mv_usd);
      const estateSavedBase = round((beforeTaxUsd - afterTaxUsd) * safeFxUsd, 2);
      const annualWhtSavedBase = round(etf.mv_base * 0.013 * whtDiffFrac, 2);

      const prevMaxLt = remainingLtPct.size > 0 ? Math.max(...remainingLtPct.values(), 0) : 0;
      const fromWeights = etfWeightsMap[etf.ticker];
      if (fromWeights) {
        for (const [canon, curLtPct] of remainingLtPct.entries()) {
          const members = memberTickersForCanonical(canon);
          let fromShare = 0;
          let toShare = 0;
          for (const m of members) {
            const fw = fromWeights[m];
            if (typeof fw === "number") fromShare += fw;
            const tw = etfWeightsMap[benchTicker]?.[m];
            if (typeof tw === "number") toShare += tw;
          }
          const delta = (fromShare - toShare) * etf.weight_nav_pct;
          if (delta !== 0) {
            remainingLtPct.set(canon, Math.max(0, round(curLtPct - delta, 4)));
          }
        }
      }
      const nextMaxLt = remainingLtPct.size > 0 ? Math.max(...remainingLtPct.values(), 0) : 0;

      const autoCuredCaps: string[] = [];
      for (const cap of riskCaps) {
        const rule = profile.risk_caps.find((r) => r.id === cap.id);
        if (!rule) continue;
        if (rule.kind === "single_name_max") {
          if (cap.status === "BREACH" && prevMaxLt > cap.cap_pct && nextMaxLt <= cap.cap_pct) {
            autoCuredCaps.push(cap.label);
          }
          continue;
        }
        let deltaPct = 0;
        if (rule.kind === "us_situs") {
          deltaPct = etf.weight_nav_pct;
        } else if (rule.kind === "bucket") {
          const fromFrac = etfBucketFrac(etf.ticker, rule);
          const toFrac = etfBucketFrac(benchTicker, rule);
          deltaPct = Math.max(0, (fromFrac - toFrac) * etf.weight_nav_pct);
        } else if (rule.kind === "ticker" && rule.ticker) {
          const fromW = etfWeightsMap[etf.ticker]?.[rule.ticker];
          const toW = etfWeightsMap[benchTicker]?.[rule.ticker];
          if (typeof fromW === "number") {
            deltaPct = Math.max(0, (fromW - (typeof toW === "number" ? toW : 0)) * etf.weight_nav_pct);
          }
        }
        if (deltaPct > 0) {
          const prevRelief = capReliefPct.get(cap.id) ?? 0;
          const nextRelief = prevRelief + deltaPct;
          capReliefPct.set(cap.id, nextRelief);
          if (cap.status === "BREACH" && cap.value_pct - prevRelief > cap.cap_pct && cap.value_pct - nextRelief <= cap.cap_pct) {
            autoCuredCaps.push(cap.label);
          }
        }
      }

      swappedTickers.add(etf.ticker.toUpperCase());
      remainingSharesByTicker.set(etf.ticker.toUpperCase(), 0);
      taxSwaps.push({
        ticker: etf.ticker,
        target_ticker: profile.benchmark.yf_symbol || benchTicker,
        shares: etf.qty,
        price_trading: round(etf.price, 4),
        currency: etf.currency,
        proceeds_usd: round(etf.mv_usd, 2),
        proceeds_base: round(etf.mv_base, 2),
        estate_tax_saved_base: estateSavedBase,
        annual_wht_saved_base: annualWhtSavedBase,
        auto_cured_caps: autoCuredCaps,
        rationale: `Swap US-situs ${etf.ticker} -> Ireland UCITS ${profile.benchmark.yf_symbol || benchTicker} to eliminate IRC §2101(c) estate exposure${annualWhtSavedBase > 0 ? " & cut dividend WHT" : ""}.`,
      });
    }
  }

  // Tier 2: Mandatory Held Exits (including held positions marked tier === "passed"!)
  const mandatoryExits: MandatoryExitItem[] = [];
  for (const pos of heldPositions) {
    const sym = pos.ticker.toUpperCase();
    if (swappedTickers.has(sym)) continue;
    const th = thesisByTicker.get(sym);
    if (!th) continue;
    const isExitVerdict = th.verdict === "EXIT";
    const isKillSwitch = Boolean(th.kill_switch_triggered);
    const isZeroCap = th.max_weight_pct === 0;
    if (!isExitVerdict && !isKillSwitch && !isZeroCap) continue;

    const reasons: string[] = [];
    if (isExitVerdict) reasons.push("Verdict EXIT");
    if (isKillSwitch) reasons.push("Kill-switch triggered");
    if (isZeroCap) reasons.push("Max weight 0%");
    if (th.tier === "passed") reasons.push("Passed tier still held");

    exitedTickers.add(sym);
    remainingSharesByTicker.set(sym, 0);
    mandatoryExits.push({
      ticker: pos.ticker,
      tier: th.tier ?? "active",
      verdict: th.verdict ?? null,
      reason: reasons.join(" · "),
      shares: pos.qty,
      price_trading: round(pos.price, 4),
      currency: pos.currency,
      proceeds_usd: round(pos.mv_usd, 2),
      proceeds_base: round(pos.mv_base, 2),
      weight_nav_pct: pos.weight_nav_pct,
    });

    propagateAssetReduction(sym, pos.us_situs, pos.weight_nav_pct);
  }
  mandatoryExits.sort((a, b) => b.proceeds_base - a.proceeds_base);

  // Tier 3: Remaining Cap-Driven Trims (specific caps before broad caps, propagating % NAV relief & remaining shares)
  const capTrims: CapTrimItem[] = [];
  const nonEtfHeld = heldPositions.filter(
    (p) =>
      !swappedTickers.has(p.ticker.toUpperCase()) &&
      !exitedTickers.has(p.ticker.toUpperCase()) &&
      !p.asset_type.toUpperCase().includes("ETF"),
  );

  const CAP_KIND_PRIORITY: Record<UserProfile["risk_caps"][number]["kind"], number> = {
    ticker: 0,
    single_name_max: 1,
    bucket: 2,
    us_situs: 3,
  };

  const breachedCapsOrdered = riskCaps
    .filter((c) => c.status === "BREACH")
    .map((cap, idx) => ({
      cap,
      rule: profile.risk_caps.find((r) => r.id === cap.id),
      idx,
    }))
    .filter((x): x is { cap: DipTriageRiskCapRef; rule: UserProfile["risk_caps"][number]; idx: number } => Boolean(x.rule))
    .sort((a, b) => {
      const pDiff = CAP_KIND_PRIORITY[a.rule.kind] - CAP_KIND_PRIORITY[b.rule.kind];
      return pDiff !== 0 ? pDiff : a.idx - b.idx;
    });

  const remainingMvBase = (p: RotationPositionRef): number => {
    const remQty = remainingSharesByTicker.get(p.ticker.toUpperCase()) ?? 0;
    if (remQty <= 0 || p.price <= 0) return 0;
    const ccyFx = fxRates[p.currency] ?? safeFxUsd;
    return remQty * p.price * ccyFx;
  };

  for (const { cap, rule } of breachedCapsOrdered) {
    let relief = capReliefPct.get(cap.id) ?? 0;
    let netPct = round(cap.value_pct - relief, 2);
    if (rule.kind === "single_name_max" && remainingLtPct.size > 0) {
      const maxLtNow = Math.max(...remainingLtPct.values(), 0);
      netPct = round(Math.min(cap.value_pct, maxLtNow), 2);
      relief = Math.max(0, round(cap.value_pct - netPct, 2));
    }
    if (netPct <= cap.cap_pct + 0.05) continue;

    const excessPct = round(netPct - cap.cap_pct, 2);
    const excessBase = (excessPct / 100) * navBase;
    if (excessBase <= 1) continue;

    const eligible = nonEtfHeld.filter((p) => (remainingSharesByTicker.get(p.ticker.toUpperCase()) ?? 0) > 1e-6);
    let candidate: RotationPositionRef | null = null;
    if (rule.kind === "single_name_max") {
      const worstLt = Array.from(remainingLtPct.entries())
        .filter(([name, pct]) => pct > cap.cap_pct + 0.05 && eligible.some((p) => canonicalAssetName(p.ticker) === name))
        .sort((a, b) => b[1] - a[1])[0];
      if (worstLt) {
        candidate =
          eligible
            .filter((p) => canonicalAssetName(p.ticker) === worstLt[0])
            .sort((a, b) => remainingMvBase(b) - remainingMvBase(a))[0] ?? null;
      }
    } else if (rule.kind === "ticker" && rule.ticker) {
      const targetCanon = canonicalAssetName(rule.ticker);
      candidate =
        eligible
          .filter((p) => canonicalAssetName(p.ticker) === targetCanon)
          .sort((a, b) => remainingMvBase(b) - remainingMvBase(a))[0] ?? null;
    } else if (rule.kind === "bucket") {
      const canonSet = new Set((rule.tickers ?? []).map((t) => canonicalAssetName(t)));
      candidate =
        eligible
          .filter((p) => canonSet.has(canonicalAssetName(p.ticker)))
          .sort((a, b) => remainingMvBase(b) - remainingMvBase(a))[0] ?? null;
    } else if (rule.kind === "us_situs") {
      candidate =
        eligible
          .filter((p) => p.us_situs)
          .sort((a, b) => remainingMvBase(b) - remainingMvBase(a))[0] ?? null;
    }

    if (!candidate || candidate.price <= 0) continue;
    const candSym = candidate.ticker.toUpperCase();
    const availQty = remainingSharesByTicker.get(candSym) ?? 0;
    if (availQty <= 1e-6) continue;
    const ccyFx = fxRates[candidate.currency] ?? safeFxUsd;
    const unitBase = candidate.price * ccyFx;
    if (unitBase <= 0) continue;

    const rawShares = Math.min(availQty, excessBase / unitBase);
    const sharesToTrim = Number.isInteger(candidate.qty)
      ? Math.min(Math.floor(availQty), Math.ceil(rawShares))
      : round(rawShares, 4);
    if (sharesToTrim <= 0) continue;

    const proceedsBase = round(sharesToTrim * unitBase, 2);
    const proceedsUsd = round(proceedsBase / safeFxUsd, 2);
    remainingSharesByTicker.set(candSym, Math.max(0, round(availQty - sharesToTrim, 6)));

    const trimPctNav = navBase > 0 ? (proceedsBase / navBase) * 100 : 0;
    propagateAssetReduction(candidate.ticker, candidate.us_situs, trimPctNav);

    capTrims.push({
      cap_id: cap.id,
      cap_label: cap.label,
      ticker: candidate.ticker,
      current_pct: netPct,
      cap_pct: cap.cap_pct,
      excess_pct: excessPct,
      shares_to_trim: sharesToTrim,
      proceeds_usd: proceedsUsd,
      proceeds_base: proceedsBase,
      note:
        relief > 0
          ? `Net of ${round(relief, 1)}% prior swap/exit/trim relief; trim ${sharesToTrim} sh ${candidate.ticker} to cure ${cap.label}.`
          : `Trim ${sharesToTrim} sh ${candidate.ticker} to bring ${cap.label} within ${cap.cap_pct}%.`,
    });
  }

  const totalSwapBase = round(taxSwaps.reduce((acc, s) => acc + s.proceeds_base, 0), 2);
  const totalFreedBase = round(
    mandatoryExits.reduce((acc, e) => acc + e.proceeds_base, 0) +
      capTrims.reduce((acc, t) => acc + t.proceeds_base, 0),
    2,
  );
  const totalEstateSavedBase = round(taxSwaps.reduce((acc, s) => acc + s.estate_tax_saved_base, 0), 2);

  return {
    tax_swaps: taxSwaps,
    mandatory_exits: mandatoryExits,
    cap_trims: capTrims,
    total_swap_base: totalSwapBase,
    total_freed_base: totalFreedBase,
    total_estate_tax_saved_base: totalEstateSavedBase,
  };
}

export interface ForwardScorecardEntry {
  ticker: string;
  tested_at: string;
  test_date: string;
  verdict: string;
  action_verdict: string | null;
  maturity: "PENDING" | "MATURED";
  hit: boolean | null;
  summary: string;
  price_at_test: number;
  current_price: number | null;
  currency: string;
  stock_return_pct: number | null;
  benchmark_return_pct: number | null;
  alpha_pct: number | null;
  days_elapsed: number;
}

export interface VerdictScorecardSummary {
  verdict: string;
  count: number;
  pending_count: number;
  evaluated_count: number;
  avg_return_pct: number | null;
  avg_alpha_pct: number | null;
  hit_rate_pct: number | null;
}

export interface ScorecardHorizonBucket {
  horizon: "90d" | "180d" | "1Y";
  min_days: number;
  count: number;
  avg_alpha_pct: number | null;
  hit_rate_pct: number | null;
}

export interface BrierCalibrationTier {
  confidence: "high" | "medium" | "low";
  predicted_prob: number;
  resolved_count: number;
  supported_count: number;
  falsified_count: number;
  empirical_rate_pct: number | null;
  brier_score: number | null;
}

export interface BrierCalibrationSummary {
  resolved_total: number;
  overall_brier_score: number | null;
  tiers: BrierCalibrationTier[];
}

export interface FundamentalAccuracySummary {
  spearman_rank_ic: number | null;
  ic_t_stat: number | null;
  ic_sample_count: number;
  modeled_tests_matured: number;
  inside_band_count: number;
  inside_band_rate_pct: number | null;
  note: string;
}

export interface ForwardScorecardResult {
  benchmark_symbol: string;
  total_tests: number;
  priced_tests: number;
  pending_count: number;
  matured_count: number;
  entries: ForwardScorecardEntry[];
  by_verdict: VerdictScorecardSummary[];
  horizon_buckets: ScorecardHorizonBucket[];
  brier_calibration: BrierCalibrationSummary;
  fundamental_accuracy: FundamentalAccuracySummary;
}

export function lookupHistorySeries(
  historyCache: HistoryCacheState,
  primarySym: string,
  fallbackSym?: string,
): HistorySeries | null {
  const candidates = [primarySym, primarySym.toUpperCase()];
  if (fallbackSym) {
    candidates.push(fallbackSym, fallbackSym.toUpperCase());
  }
  const baseNoSuffix = primarySym.split(".")[0];
  if (baseNoSuffix && baseNoSuffix !== primarySym) {
    candidates.push(baseNoSuffix, baseNoSuffix.toUpperCase());
  }
  for (const key of candidates) {
    const found = historyCache.series[key];
    if (found && found.points.length >= 2) return found;
  }
  return null;
}

function findPriceOnOrNearDate(series: HistorySeries, targetDate: string): number | null {
  if (series.points.length === 0) return null;
  let bestBefore: { date: string; close: number } | null = null;
  let firstAfter: { date: string; close: number } | null = null;
  for (const pt of series.points) {
    if (pt.date <= targetDate) {
      bestBefore = pt;
    } else if (!firstAfter) {
      firstAfter = pt;
    }
  }
  if (bestBefore) {
    const gapDays = Math.abs(Date.parse(targetDate) - Date.parse(bestBefore.date)) / 86400000;
    if (gapDays <= 14) return bestBefore.close;
  }
  if (firstAfter) {
    const gapDays = Math.abs(Date.parse(firstAfter.date) - Date.parse(targetDate)) / 86400000;
    if (gapDays <= 14) return firstAfter.close;
  }
  return bestBefore?.close ?? null;
}

function evaluateDirectionalHit(
  verdict: string,
  actionVerdict: string | null,
  stockRet: number | null,
  alphaPct: number | null,
): boolean | null {
  if (stockRet === null) return null;
  const metric = alphaPct !== null ? alphaPct : stockRet;
  if (verdict === "HIGH_CONVICTION" || actionVerdict === "GO") {
    return metric > 0;
  }
  if (verdict === "EXIT" || verdict === "PROBATION" || actionVerdict === "PASS") {
    return metric <= 0;
  }
  if (verdict === "WATCH") {
    return stockRet <= 0;
  }
  return metric > 0;
}

function computeBrierCalibration(
  testLogAll: ThesisTestRecord[],
  allHypotheses?: HypothesisRecord[],
): BrierCalibrationSummary {
  let pool: HypothesisRecord[];
  if (allHypotheses && allHypotheses.length > 0) {
    pool = allHypotheses;
  } else {
    const latestMap = new Map<string, HypothesisRecord>();
    const chrono = [...testLogAll].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
    for (const rec of chrono) {
      if (rec.event_type === "rule_change") continue;
      for (const h of rec.hypotheses_tested) {
        latestMap.set(`${rec.ticker}:${h.id}`, h);
      }
    }
    pool = Array.from(latestMap.values());
  }

  const tierProbs: Array<{ confidence: "high" | "medium" | "low"; prob: number }> = [
    { confidence: "high", prob: 0.8 },
    { confidence: "medium", prob: 0.6 },
    { confidence: "low", prob: 0.4 },
  ];

  let totalResolved = 0;
  let totalBrierSum = 0;

  const tiers: BrierCalibrationTier[] = tierProbs.map(({ confidence, prob }) => {
    const resolved = pool.filter(
      (h) => h.confidence === confidence && (h.status === "supported" || h.status === "falsified"),
    );
    const supportedCount = resolved.filter((h) => h.status === "supported").length;
    const falsifiedCount = resolved.length - supportedCount;
    let brierSum = 0;
    for (const h of resolved) {
      const y = h.status === "supported" ? 1 : 0;
      brierSum += (prob - y) ** 2;
    }
    totalResolved += resolved.length;
    totalBrierSum += brierSum;
    return {
      confidence,
      predicted_prob: prob,
      resolved_count: resolved.length,
      supported_count: supportedCount,
      falsified_count: falsifiedCount,
      empirical_rate_pct: resolved.length > 0 ? round((supportedCount / resolved.length) * 100, 1) : null,
      brier_score: resolved.length > 0 ? round(brierSum / resolved.length, 3) : null,
    };
  });

  return {
    resolved_total: totalResolved,
    overall_brier_score: totalResolved > 0 ? round(totalBrierSum / totalResolved, 3) : null,
    tiers,
  };
}

export function computeForwardScorecard(
  testLogAll: ThesisTestRecord[],
  currentPrices: Map<string, number>,
  historyCache: HistoryCacheState,
  benchmarkSymbol: string,
  nowDate: Date = new Date(),
  allHypotheses?: HypothesisRecord[],
  scenarioBoundsByTicker?: Map<string, { bearCagrPct: number; bullCagrPct: number }>,
): ForwardScorecardResult {
  const nowMs = nowDate.getTime();
  const benchBaseTicker = benchmarkSymbol.split(".")[0]?.toUpperCase() ?? benchmarkSymbol.toUpperCase();
  const dailyBenchSeries =
    historyCache.series[`daily:${benchmarkSymbol}`] ??
    historyCache.series[`daily:${benchBaseTicker}`] ??
    null;
  const weeklyBenchSeries = lookupHistorySeries(historyCache, benchmarkSymbol, benchBaseTicker);
  const benchSeries = dailyBenchSeries && dailyBenchSeries.points.length >= 2 ? dailyBenchSeries : weeklyBenchSeries;

  const latestBenchPrice =
    currentPrices.get(benchmarkSymbol) ??
    currentPrices.get(benchBaseTicker) ??
    (benchSeries && benchSeries.points.length > 0 ? benchSeries.points[benchSeries.points.length - 1]!.close : null);

  const judgmentLogs = testLogAll.filter((rec) => rec.event_type !== "rule_change");

  const chronoLogs = [...judgmentLogs].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
  const lastKeptMsByKey = new Map<string, number>();
  const dedupedLogs: ThesisTestRecord[] = [];
  for (const rec of chronoLogs) {
    if (typeof rec.price_at_test !== "number" || !Number.isFinite(rec.price_at_test) || rec.price_at_test <= 0) {
      continue;
    }
    const testDate = rec.tested_at.slice(0, 10);
    const ms = Date.parse(`${testDate}T00:00:00Z`);
    const dedupKey = `${rec.ticker.toUpperCase()}:${rec.verdict}`;
    const prevMs = lastKeptMsByKey.get(dedupKey);
    if (prevMs !== undefined && Number.isFinite(ms) && (ms - prevMs) / 86400000 < 30) {
      continue;
    }
    if (Number.isFinite(ms)) {
      lastKeptMsByKey.set(dedupKey, ms);
    }
    dedupedLogs.push(rec);
  }

  const entries: ForwardScorecardEntry[] = [];
  const icExpected: number[] = [];
  const icRealized: number[] = [];
  let modeledTestsMatured = 0;
  let insideBandCount = 0;

  for (const rec of dedupedLogs) {
    const testDate = rec.tested_at.slice(0, 10);
    const parsedMs = Date.parse(`${testDate}T00:00:00Z`);
    const daysElapsed = Number.isFinite(parsedMs) ? Math.max(0, Math.floor((nowMs - parsedMs) / 86400000)) : 0;
    const curPrice = currentPrices.get(rec.ticker) ?? null;
    const stockRet =
      curPrice !== null && rec.price_at_test! > 0
        ? round(((curPrice - rec.price_at_test!) / rec.price_at_test!) * 100, 2)
        : null;

    let benchRet: number | null = null;
    const startBenchFromRecord =
      typeof rec.benchmark_price_at_test === "number" &&
      Number.isFinite(rec.benchmark_price_at_test) &&
      rec.benchmark_price_at_test > 0
        ? rec.benchmark_price_at_test
        : null;

    if (latestBenchPrice !== null && latestBenchPrice > 0) {
      const startBench =
        startBenchFromRecord ??
        (daysElapsed > 0 && benchSeries ? findPriceOnOrNearDate(benchSeries, testDate) : null);
      if (startBench !== null && startBench > 0) {
        benchRet = round(((latestBenchPrice - startBench) / startBench) * 100, 2);
      }
    }

    const alphaPct = stockRet !== null && benchRet !== null ? round(stockRet - benchRet, 2) : null;
    const maturity: "PENDING" | "MATURED" = daysElapsed >= 30 ? "MATURED" : "PENDING";
    const actionVerdict = rec.action_verdict ?? null;
    const hit =
      maturity === "MATURED" ? evaluateDirectionalHit(rec.verdict, actionVerdict, stockRet, alphaPct) : null;

    if (maturity === "MATURED" && stockRet !== null) {
      const ratio = Math.max(0.001, 1 + stockRet / 100);
      const yearsForIc = Math.max(0.5, daysElapsed / 365.25);
      const icRealizedAnn = (Math.pow(ratio, 1 / yearsForIc) - 1) * 100;

      const pitExpected = rec.pit_snapshot?.expected_after_tax_cagr_pct;
      if (typeof pitExpected === "number" && Number.isFinite(pitExpected)) {
        icExpected.push(pitExpected);
        icRealized.push(icRealizedAnn);
      }

      const bounds = scenarioBoundsByTicker?.get(rec.ticker.toUpperCase());
      if (bounds && Number.isFinite(bounds.bearCagrPct) && Number.isFinite(bounds.bullCagrPct)) {
        modeledTestsMatured += 1;
        const y = Math.max(30, daysElapsed) / 365.25;
        const loCagr = Math.min(bounds.bearCagrPct, bounds.bullCagrPct);
        const hiCagr = Math.max(bounds.bearCagrPct, bounds.bullCagrPct);
        const bearHorizPct = (Math.pow(Math.max(0.05, 1 + loCagr / 100), y) - 1) * 100;
        const bullHorizPct = (Math.pow(Math.max(0.05, 1 + hiCagr / 100), y) - 1) * 100;
        const tolPct = y < 0.75 ? 5 : 2;
        if (stockRet >= bearHorizPct - tolPct && stockRet <= bullHorizPct + tolPct) {
          insideBandCount += 1;
        }
      }
    }

    entries.push({
      ticker: rec.ticker,
      tested_at: rec.tested_at,
      test_date: testDate,
      verdict: rec.verdict,
      action_verdict: actionVerdict,
      maturity,
      hit,
      summary: rec.summary,
      price_at_test: round(rec.price_at_test!, 4),
      current_price: curPrice !== null ? round(curPrice, 4) : null,
      currency: rec.currency ?? "USD",
      stock_return_pct: stockRet,
      benchmark_return_pct: benchRet,
      alpha_pct: alphaPct,
      days_elapsed: daysElapsed,
    });
  }

  entries.sort((a, b) => b.tested_at.localeCompare(a.tested_at));

  const pendingCount = entries.filter((e) => e.maturity === "PENDING").length;
  const maturedCount = entries.filter((e) => e.maturity === "MATURED").length;

  const verdicts = ["HIGH_CONVICTION", "WATCH", "PROBATION", "EXIT"];
  const byVerdict: VerdictScorecardSummary[] = verdicts.map((v) => {
    const subset = entries.filter((e) => e.verdict === v);
    const pendingInVerdict = subset.filter((e) => e.maturity === "PENDING").length;
    const evaluated = subset.filter((e) => e.maturity === "MATURED" && e.stock_return_pct !== null);
    const withAlpha = evaluated.filter((e) => e.alpha_pct !== null);
    const avgRet =
      evaluated.length > 0
        ? round(evaluated.reduce((acc, e) => acc + (e.stock_return_pct ?? 0), 0) / evaluated.length, 2)
        : null;
    const avgAlpha =
      withAlpha.length > 0
        ? round(withAlpha.reduce((acc, e) => acc + (e.alpha_pct ?? 0), 0) / withAlpha.length, 2)
        : null;
    const scored = evaluated.filter((e) => e.hit !== null);
    const hits = scored.filter((e) => e.hit === true).length;
    const hitRate = scored.length > 0 ? round((hits / scored.length) * 100, 1) : null;
    return {
      verdict: v,
      count: subset.length,
      pending_count: pendingInVerdict,
      evaluated_count: evaluated.length,
      avg_return_pct: avgRet,
      avg_alpha_pct: avgAlpha,
      hit_rate_pct: hitRate,
    };
  });

  const horizonDefs: Array<{ horizon: "90d" | "180d" | "1Y"; min_days: number }> = [
    { horizon: "90d", min_days: 90 },
    { horizon: "180d", min_days: 180 },
    { horizon: "1Y", min_days: 365 },
  ];
  const horizonBuckets: ScorecardHorizonBucket[] = horizonDefs.map(({ horizon, min_days }) => {
    const bucket = entries.filter((e) => e.maturity === "MATURED" && e.days_elapsed >= min_days);
    const withAlpha = bucket.filter((e) => e.alpha_pct !== null);
    const scored = bucket.filter((e) => e.hit !== null);
    const hits = scored.filter((e) => e.hit === true).length;
    return {
      horizon,
      min_days,
      count: bucket.length,
      avg_alpha_pct:
        withAlpha.length > 0
          ? round(withAlpha.reduce((acc, e) => acc + (e.alpha_pct ?? 0), 0) / withAlpha.length, 2)
          : null,
      hit_rate_pct: scored.length > 0 ? round((hits / scored.length) * 100, 1) : null,
    };
  });

  const icSampleCount = icExpected.length;
  let spearmanRankIc: number | null = null;
  let icTStat: number | null = null;
  let accuracyNote = "Need >=4 matured modeled tests for Rank IC";

  if (icSampleCount >= 4) {
    const sp = computeSpearmanRankCorrelation(icExpected, icRealized);
    if (sp) {
      spearmanRankIc = round(sp.rho, 3);
      icTStat = sp.t_stat !== null ? round(sp.t_stat, 2) : null;
      accuracyNote = `Spearman Rank IC across ${icSampleCount} matured modeled call(s) (rho=${spearmanRankIc}${icTStat !== null ? `, t=${icTStat}` : ""}).`;
    } else {
      accuracyNote = `Rank IC undefined across ${icSampleCount} matured modeled call(s) (zero rank dispersion).`;
    }
  }

  const insideBandRatePct =
    modeledTestsMatured > 0 ? round((insideBandCount / modeledTestsMatured) * 100, 1) : null;

  return {
    benchmark_symbol: benchmarkSymbol,
    total_tests: judgmentLogs.length,
    priced_tests: entries.length,
    pending_count: pendingCount,
    matured_count: maturedCount,
    entries,
    by_verdict: byVerdict,
    horizon_buckets: horizonBuckets,
    brier_calibration: computeBrierCalibration(judgmentLogs, allHypotheses),
    fundamental_accuracy: {
      spearman_rank_ic: spearmanRankIc,
      ic_t_stat: icTStat,
      ic_sample_count: icSampleCount,
      modeled_tests_matured: modeledTestsMatured,
      inside_band_count: insideBandCount,
      inside_band_rate_pct: insideBandRatePct,
      note: accuracyNote,
    },
  };
}

export interface BacktestSeriesMetrics {
  cagr_pct: number;
  total_return_pct: number;
  volatility_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  sharpe_se: number;
  deflated_sharpe_prob_pct: number;
  sortino: number;
  cvar_95_weekly_pct: number;
  skewness: number;
  excess_kurtosis: number;
  rebalance_count: number;
  total_turnover_pct: number;
  tx_cost_drag_bps: number;
  rolling_3y_cagr_min_pct: number | null;
  rolling_3y_cagr_median_pct: number | null;
  rolling_3y_cagr_max_pct: number | null;
}

export interface BacktestRegimeRow {
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

export interface BacktestEquityPoint {
  date: string;
  baseline_idx: number;
  simulated_idx: number;
  benchmark_idx: number;
}

export interface BacktestResult {
  candidate_ticker: string;
  candidate_yf_symbol: string;
  benchmark_symbol: string;
  target_weight_pct: number;
  funding_source: string;
  rebalance_band_pct: number;
  rf_pct: number;
  tx_cost_bps: number;
  trials_tested: number;
  sr0_annual_threshold: number;
  include_external_wealth: boolean;
  fx_converted_tickers: string[];
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

function isoWeekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 1 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
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
    const wk = isoWeekMonday(pt.date);
    out.set(wk, pt.close);
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
  const fxSeries = historyCache.series[`${ccy}USD=X`];
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
      out.set(wk, round(px * fxRate, 4));
    }
  }
  return out.size >= 12 ? { converted: out, fxApplied: true } : { converted: wkMap, fxApplied: false };
}

function computeSeriesMetrics(
  values: number[],
  rfPct = 4.0,
  rebalanceCount = 0,
  opts?: { totalTurnoverPct?: number; txCostDragBps?: number; trialsTested?: number },
): BacktestSeriesMetrics {
  const n = values.length;
  const totalTurnoverPct = round(opts?.totalTurnoverPct ?? 0, 1);
  const txCostDragBps = round(opts?.txCostDragBps ?? 0, 1);
  const trialsTested = Math.max(1, opts?.trialsTested ?? 1);
  if (n < 2) {
    return {
      cagr_pct: 0,
      total_return_pct: 0,
      volatility_pct: 0,
      max_drawdown_pct: 0,
      sharpe: 0,
      sharpe_se: 0,
      deflated_sharpe_prob_pct: 50,
      sortino: 0,
      cvar_95_weekly_pct: 0,
      skewness: 0,
      excess_kurtosis: 0,
      rebalance_count: rebalanceCount,
      total_turnover_pct: totalTurnoverPct,
      tx_cost_drag_bps: txCostDragBps,
      rolling_3y_cagr_min_pct: null,
      rolling_3y_cagr_median_pct: null,
      rolling_3y_cagr_max_pct: null,
    };
  }
  const start = values[0]!;
  const end = values[n - 1]!;
  const weeks = n - 1;
  const years = Math.max(1 / 52, weeks / 52);
  const totalReturnPct = round((end / start - 1) * 100, 2);
  const cagrPct = round((Math.pow(Math.max(0.0001, end / start), 1 / years) - 1) * 100, 2);

  const rets: number[] = [];
  let peak = start;
  let maxDd = 0;
  for (let i = 1; i < n; i += 1) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    rets.push(prev > 0 ? cur / prev - 1 : 0);
    if (cur > peak) peak = cur;
    const dd = peak > 0 ? (cur - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const rfWeekly = Math.pow(1 + Math.max(0, rfPct) / 100, 1 / 52) - 1;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.length > 1 ? rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
  const volAnn = Math.sqrt(variance) * Math.sqrt(52);
  const downSq = rets.reduce((acc, r) => acc + (r < rfWeekly ? (r - rfWeekly) ** 2 : 0), 0) / rets.length;
  const downDevAnn = Math.sqrt(downSq) * Math.sqrt(52);

  const annExcessMean = (mean - rfWeekly) * 52;
  const sharpe = volAnn > 1e-9 ? round(annExcessMean / volAnn, 2) : 0;
  const sharpeSe = round(Math.sqrt((1 + 0.5 * sharpe * sharpe) / Math.max(0.25, years)), 2);
  const sortino = downDevAnn > 1e-9 ? round(annExcessMean / downDevAnn, 2) : 0;
  const moments = computeHigherMoments(rets);
  const dsr = computeDeflatedSharpeRatio({
    annualizedSharpe: sharpe,
    weeklyReturns: rets,
    trialsTested,
  });

  let rollMin: number | null = null;
  let rollMed: number | null = null;
  let rollMax: number | null = null;
  const win3y = 156;
  if (n > win3y) {
    const rolls: number[] = [];
    for (let i = win3y; i < n; i += 1) {
      const v0 = values[i - win3y]!;
      const v1 = values[i]!;
      if (v0 > 0 && v1 > 0) {
        rolls.push((Math.pow(v1 / v0, 1 / 3) - 1) * 100);
      }
    }
    if (rolls.length > 0) {
      rolls.sort((a, b) => a - b);
      rollMin = round(rolls[0]!, 2);
      const mid = Math.floor(rolls.length / 2);
      rollMed = round(rolls.length % 2 === 1 ? rolls[mid]! : (rolls[mid - 1]! + rolls[mid]!) / 2, 2);
      rollMax = round(rolls[rolls.length - 1]!, 2);
    }
  }

  return {
    cagr_pct: cagrPct,
    total_return_pct: totalReturnPct,
    volatility_pct: round(volAnn * 100, 2),
    max_drawdown_pct: round(maxDd * 100, 2),
    sharpe,
    sharpe_se: sharpeSe,
    deflated_sharpe_prob_pct: dsr.dsr_prob_pct,
    sortino,
    cvar_95_weekly_pct: moments.cvar_95_pct,
    skewness: moments.skewness,
    excess_kurtosis: moments.excess_kurtosis,
    rebalance_count: rebalanceCount,
    total_turnover_pct: totalTurnoverPct,
    tx_cost_drag_bps: txCostDragBps,
    rolling_3y_cagr_min_pct: rollMin,
    rolling_3y_cagr_median_pct: rollMed,
    rolling_3y_cagr_max_pct: rollMax,
  };
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den <= 1e-12) return null;
  return round(num / den, 3);
}

function simulatePortfolioPath(
  weights: Map<string, number>,
  weeklyPrices: Map<string, number[]>,
  numPoints: number,
  rebalanceBandFrac: number,
  rfPct = 4.0,
  txCostBps = 0,
  initialTurnoverFrac = 0,
): { curve: number[]; rebalanceCount: number; totalTurnoverPct: number; txCostDragBps: number } {
  const assets = Array.from(weights.entries()).filter(([, w]) => w > 1e-6);
  const costRate = Math.max(0, txCostBps) / 10_000;
  const initTurn = Math.max(0, initialTurnoverFrac);
  const initCostMult = Math.max(0.9, 1 - initTurn * costRate);
  const alloc = new Map<string, number>();
  for (const [k, w] of assets) {
    alloc.set(k, 100 * initCostMult * w);
  }
  const curve: number[] = [100];
  const cashGrowthWeekly = Math.pow(1 + Math.max(0, rfPct) / 100, 1 / 52);
  let rebalanceCount = 0;
  let totalTurnoverFrac = initTurn;
  let totalCostFrac = initTurn * costRate;

  for (let t = 1; t < numPoints; t += 1) {
    let total = 0;
    for (const [k] of assets) {
      const prevAlloc = alloc.get(k) ?? 0;
      if (k === "__CASH__") {
        const nextCash = prevAlloc * cashGrowthWeekly;
        alloc.set(k, nextCash);
        total += nextCash;
        continue;
      }
      const series = weeklyPrices.get(k);
      const p0 = series?.[t - 1] ?? 1;
      const p1 = series?.[t] ?? p0;
      const nextAlloc = p0 > 0 ? prevAlloc * (p1 / p0) : prevAlloc;
      alloc.set(k, nextAlloc);
      total += nextAlloc;
    }

    if (total > 0 && rebalanceBandFrac > 0) {
      let breached = false;
      for (const [k, targetW] of assets) {
        if (targetW < 0.001) continue;
        const curW = (alloc.get(k) ?? 0) / total;
        if (Math.abs(curW - targetW) >= Math.max(0.02, targetW * rebalanceBandFrac)) {
          breached = true;
          break;
        }
      }
      if (breached) {
        rebalanceCount += 1;
        let oneWayTurn = 0;
        for (const [k, targetW] of assets) {
          const curW = (alloc.get(k) ?? 0) / total;
          oneWayTurn += Math.abs(curW - targetW);
        }
        oneWayTurn *= 0.5;
        totalTurnoverFrac += oneWayTurn;
        const stepCost = oneWayTurn * costRate;
        totalCostFrac += stepCost;
        total = Math.max(0.01, total * (1 - stepCost));
        for (const [k, targetW] of assets) {
          alloc.set(k, total * targetW);
        }
      }
    }

    curve.push(round(total, 4));
  }
  const years = Math.max(1 / 52, (numPoints - 1) / 52);
  return {
    curve,
    rebalanceCount,
    totalTurnoverPct: round(totalTurnoverFrac * 100, 1),
    txCostDragBps: round((totalCostFrac / years) * 10_000, 1),
  };
}

function computeWindowCagrAndDd(
  dates: string[],
  values: number[],
  startDate: string,
  endDate: string,
): { weeks: number; cagr_pct: number; dd_pct: number } | null {
  const slice: number[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const d = dates[i]!;
    if (d >= startDate && d <= endDate) {
      slice.push(values[i]!);
    }
  }
  if (slice.length < 12) return null;
  const start = slice[0]!;
  const end = slice[slice.length - 1]!;
  const weeks = slice.length - 1;
  const cagrPct = round((Math.pow(Math.max(0.0001, end / start), 52 / weeks) - 1) * 100, 2);
  let peak = start;
  let maxDd = 0;
  for (const v of slice) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return { weeks, cagr_pct: cagrPct, dd_pct: round(maxDd * 100, 2) };
}

export interface BacktestRunOptions {
  defaultRfPct?: number;
  defaultTrialsTested?: number;
}

export function runDeterministicBacktest(
  req: BacktestRequest,
  portfolio: PortfolioRecord,
  lookthrough: DipTriageLookthroughRef[],
  profile: UserProfile,
  historyCache: HistoryCacheState,
  fxRates: Record<string, number>,
  opts?: BacktestRunOptions,
): BacktestResult {
  const candidateTicker = req.candidate_ticker.toUpperCase();
  const candidateYf = (req.candidate_yf_symbol || candidateTicker).trim();
  const benchmarkSym = profile.benchmark.yf_symbol || profile.benchmark.ticker;
  const benchmarkTicker = profile.benchmark.ticker.toUpperCase();
  const rfPct = round(req.rf_pct ?? opts?.defaultRfPct ?? 4.0, 2);
  const includeExternalWealth = req.include_external_wealth !== false;

  const candSeries = lookupHistorySeries(historyCache, candidateYf, candidateTicker);
  if (!candSeries || candSeries.points.length < 12) {
    throw new Error(
      `Insufficient weekly price history for ${candidateTicker} (need at least 12 overlapping weekly bars).`,
    );
  }

  const benchSeries = lookupHistorySeries(historyCache, benchmarkSym, benchmarkTicker) ?? candSeries;
  const dataSources: Record<string, string> = {};
  dataSources[candidateTicker] = candSeries.source;
  dataSources[benchmarkTicker] = benchSeries.source;

  const fxUsdToBase = fxRates.USD ?? 1.0;
  const posBaseValues = new Map<string, number>();
  const posYfSymbols = new Map<string, string>();
  let totalPosBase = 0;

  for (const pos of portfolio.positions) {
    const ccyFx = fxRates[pos.currency] ?? fxUsdToBase;
    const mvBase = Math.max(0, pos.qty * pos.ref_price * ccyFx);
    if (mvBase <= 0) continue;
    posBaseValues.set(pos.ticker, (posBaseValues.get(pos.ticker) ?? 0) + mvBase);
    posYfSymbols.set(pos.ticker, pos.yf_symbol || pos.ticker);
    totalPosBase += mvBase;
  }

  const caveats: string[] = [];
  const ext = profile.external_exposure;
  let extTickerIncluded: string | null = null;
  if (includeExternalWealth && ext.enabled && ext.ticker && ext.amount_base > 0) {
    const extSym = ext.ticker.trim().toUpperCase();
    posBaseValues.set(extSym, (posBaseValues.get(extSym) ?? 0) + ext.amount_base);
    if (!posYfSymbols.has(extSym)) {
      posYfSymbols.set(extSym, extSym);
    }
    totalPosBase += ext.amount_base;
    extTickerIncluded = extSym;
  }

  const cashBase = Math.max(0, portfolio.cash_base + portfolio.accruals_base);
  const rawNavBase = Math.max(1, totalPosBase + cashBase);

  const fxConvertedTickers: string[] = [];
  const unconvertedForeignTickers: string[] = [];

  const rawWeekMaps = new Map<string, Map<string, number>>();
  const candConv = convertWeekMapToUsd(bucketSeriesByWeek(candSeries), candSeries.currency, historyCache);
  if (candConv.fxApplied) fxConvertedTickers.push(candidateTicker);
  else if (candSeries.currency.toUpperCase() !== "USD") unconvertedForeignTickers.push(candidateTicker);

  const benchConv = convertWeekMapToUsd(bucketSeriesByWeek(benchSeries), benchSeries.currency, historyCache);
  if (benchConv.fxApplied) fxConvertedTickers.push(benchmarkTicker);

  const candWeeks = candConv.converted;
  const benchWeeks = benchConv.converted;
  rawWeekMaps.set(candidateTicker, candWeeks);
  rawWeekMaps.set("__BENCH__", benchWeeks);

  const candKeys = Array.from(candWeeks.keys()).sort();
  const benchKeys = Array.from(benchWeeks.keys()).sort();
  const candBenchStart =
    candKeys[0] && benchKeys[0] ? (candKeys[0] > benchKeys[0] ? candKeys[0] : benchKeys[0]) : (candKeys[0] ?? "");
  const candBenchEnd =
    candKeys.length > 0 && benchKeys.length > 0
      ? candKeys[candKeys.length - 1]! < benchKeys[benchKeys.length - 1]!
        ? candKeys[candKeys.length - 1]!
        : benchKeys[benchKeys.length - 1]!
      : (candKeys[candKeys.length - 1] ?? "");
  const candBenchWeeks = candKeys.filter((w) => w >= candBenchStart && w <= candBenchEnd).length;

  const holdingCandidates: Array<{ ticker: string; source: string; wkMap: Map<string, number>; overlapCount: number }> = [];
  const missingHoldings: string[] = [];

  for (const [ticker] of posBaseValues.entries()) {
    const yfSym = posYfSymbols.get(ticker) ?? ticker;
    const series = lookupHistorySeries(historyCache, yfSym, ticker);
    if (!series || series.points.length < 26) {
      missingHoldings.push(ticker);
      continue;
    }
    const conv = convertWeekMapToUsd(bucketSeriesByWeek(series), series.currency, historyCache);
    if (conv.fxApplied && !fxConvertedTickers.includes(ticker)) fxConvertedTickers.push(ticker);
    else if (series.currency.toUpperCase() !== "USD" && !conv.fxApplied && !unconvertedForeignTickers.includes(ticker)) {
      unconvertedForeignTickers.push(ticker);
    }
    const wkMap = conv.converted;
    if (wkMap.size < 26) {
      missingHoldings.push(ticker);
      continue;
    }
    const overlapCount = Array.from(wkMap.keys()).filter((w) => w >= candBenchStart && w <= candBenchEnd).length;
    holdingCandidates.push({ ticker, source: series.source, wkMap, overlapCount });
  }

  const useThreeYearCutoff = candBenchWeeks >= 156 && holdingCandidates.some((h) => h.overlapCount >= 156);
  const minHoldingWeeks = useThreeYearCutoff ? 156 : 26;

  const includedHoldings: string[] = [];
  const excludedHoldings: string[] = [...missingHoldings];

  for (const h of holdingCandidates) {
    if (h.overlapCount < minHoldingWeeks && h.ticker !== candidateTicker) {
      excludedHoldings.push(h.ticker);
      continue;
    }
    rawWeekMaps.set(h.ticker, h.wkMap);
    dataSources[h.ticker] = h.source;
    includedHoldings.push(h.ticker);
  }

  if (extTickerIncluded && includedHoldings.includes(extTickerIncluded)) {
    caveats.push(`Includes external ${extTickerIncluded} exposure in liquid wealth weights.`);
  }
  if (fxConvertedTickers.length > 0) {
    caveats.push(`Weekly USD FX conversion applied to: ${fxConvertedTickers.join(", ")}.`);
  }
  if (unconvertedForeignTickers.length > 0) {
    caveats.push(`Local-currency bars (FX history unavailable) for: ${unconvertedForeignTickers.join(", ")}.`);
  }
  if (excludedHoldings.length > 0) {
    caveats.push(
      `Excluded holdings with <${minHoldingWeeks}w overlapping history (weights renormalized): ${excludedHoldings.join(", ")}.`,
    );
  }

  const allWeekSet = new Set<string>(candWeeks.keys());
  const sortedAllWeeks = Array.from(allWeekSet).sort();

  const startDates: string[] = [];
  const endDates: string[] = [];
  for (const [key, wkMap] of rawWeekMaps.entries()) {
    if (key === "__BENCH__" && wkMap.size === 0) continue;
    const keys = Array.from(wkMap.keys()).sort();
    if (keys.length === 0) continue;
    startDates.push(keys[0]!);
    endDates.push(keys[keys.length - 1]!);
  }

  const overlapStart = startDates.sort()[startDates.length - 1] ?? sortedAllWeeks[0] ?? "";
  const overlapEnd = endDates.sort()[0] ?? sortedAllWeeks[sortedAllWeeks.length - 1] ?? "";

  const candidateAlignedWeeks = sortedAllWeeks.filter((w) => w >= overlapStart && w <= overlapEnd);
  if (candidateAlignedWeeks.length < 12) {
    throw new Error(
      `Insufficient overlapping history across portfolio and ${candidateTicker} (${candidateAlignedWeeks.length} weeks; need >= 12).`,
    );
  }

  const alignedPrices = new Map<string, number[]>();
  const finalDates: string[] = [];
  const lastSeen = new Map<string, number>();
  const carryStreak = new Map<string, number>();

  for (const wk of candidateAlignedWeeks) {
    let allValid = true;
    const stepPrices = new Map<string, number>();
    const nextStreaks = new Map<string, number>();
    for (const [key, wkMap] of rawWeekMaps.entries()) {
      const exact = wkMap.get(wk);
      if (exact !== undefined) {
        stepPrices.set(key, exact);
        nextStreaks.set(key, 0);
      } else {
        const carry = lastSeen.get(key);
        const streak = carryStreak.get(key) ?? 0;
        if (carry !== undefined && streak < 1) {
          stepPrices.set(key, carry);
          nextStreaks.set(key, streak + 1);
        } else {
          allValid = false;
          break;
        }
      }
    }
    if (!allValid) continue;
    finalDates.push(wk);
    for (const [key, val] of stepPrices.entries()) {
      lastSeen.set(key, val);
      carryStreak.set(key, nextStreaks.get(key) ?? 0);
      let arr = alignedPrices.get(key);
      if (!arr) {
        arr = [];
        alignedPrices.set(key, arr);
      }
      arr.push(val);
    }
  }

  if (finalDates.length < 12) {
    throw new Error(`Aligned backtest series has only ${finalDates.length} weeks (need >= 12).`);
  }

  const baseWeights = new Map<string, number>();
  let backedBaseTotal = cashBase;
  for (const ticker of includedHoldings) {
    backedBaseTotal += posBaseValues.get(ticker) ?? 0;
  }
  const denom = backedBaseTotal > 0 ? backedBaseTotal : rawNavBase;
  for (const ticker of includedHoldings) {
    const w = (posBaseValues.get(ticker) ?? 0) / denom;
    if (w > 0) baseWeights.set(ticker, w);
  }
  if (cashBase > 0) {
    baseWeights.set("__CASH__", cashBase / denom);
  }
  if (baseWeights.size === 0) {
    baseWeights.set("__BENCH__", 1.0);
    caveats.push("No backed holdings available; baseline defaults to 100% benchmark.");
  }

  const simWeights = new Map<string, number>(baseWeights);
  const targetW = Math.min(0.95, Math.max(0.005, req.target_weight_pct / 100));
  const currentCandW = simWeights.get(candidateTicker) ?? 0;
  const deltaW = targetW - currentCandW;
  simWeights.set(candidateTicker, targetW);

  if (deltaW > 0) {
    let remainingToFund = deltaW;
    if (req.funding_source.startsWith("swap:")) {
      const swapSym = req.funding_source.slice(5).trim().toUpperCase();
      const availSwap = simWeights.get(swapSym) ?? 0;
      const takeSwap = Math.min(availSwap, remainingToFund);
      simWeights.set(swapSym, Math.max(0, availSwap - takeSwap));
      remainingToFund -= takeSwap;
      if (remainingToFund > 0.0005) {
        caveats.push(`Swap source ${swapSym} (${round(availSwap * 100, 1)}%) was smaller than target; remainder funded from cash/pro-rata.`);
      }
    }
    if (remainingToFund > 0.0005 && (req.funding_source === "cash" || req.funding_source.startsWith("swap:"))) {
      const availCash = simWeights.get("__CASH__") ?? 0;
      const takeCash = Math.min(availCash, remainingToFund);
      simWeights.set("__CASH__", Math.max(0, availCash - takeCash));
      remainingToFund -= takeCash;
      if (remainingToFund > 0.0005 && req.funding_source === "cash") {
        caveats.push(`Cash (${round(availCash * 100, 1)}%) was insufficient for ${req.target_weight_pct}%; remainder funded pro-rata.`);
      }
    }
    if (remainingToFund > 0.0005) {
      let otherSum = 0;
      for (const [k, w] of simWeights.entries()) {
        if (k !== candidateTicker && w > 0) otherSum += w;
      }
      if (otherSum > 0) {
        const scale = Math.max(0, (otherSum - remainingToFund) / otherSum);
        for (const [k, w] of simWeights.entries()) {
          if (k !== candidateTicker && w > 0) {
            simWeights.set(k, w * scale);
          }
        }
      }
    }
  } else if (deltaW < 0) {
    const freed = -deltaW;
    if (req.funding_source.startsWith("swap:")) {
      const swapSym = req.funding_source.slice(5).trim().toUpperCase();
      if (alignedPrices.has(swapSym)) {
        simWeights.set(swapSym, (simWeights.get(swapSym) ?? 0) + freed);
      } else {
        simWeights.set("__CASH__", (simWeights.get("__CASH__") ?? 0) + freed);
      }
    } else if (req.funding_source === "pro_rata") {
      let otherSum = 0;
      for (const [k, w] of simWeights.entries()) {
        if (k !== candidateTicker && w > 0) otherSum += w;
      }
      if (otherSum > 0) {
        const scale = (otherSum + freed) / otherSum;
        for (const [k, w] of simWeights.entries()) {
          if (k !== candidateTicker && w > 0) simWeights.set(k, w * scale);
        }
      } else {
        simWeights.set("__CASH__", (simWeights.get("__CASH__") ?? 0) + freed);
      }
    } else {
      simWeights.set("__CASH__", (simWeights.get("__CASH__") ?? 0) + freed);
    }
  }

  let simSum = 0;
  for (const w of simWeights.values()) simSum += w;
  if (simSum > 0 && Math.abs(simSum - 1) > 1e-6) {
    for (const [k, w] of simWeights.entries()) {
      simWeights.set(k, w / simSum);
    }
  }

  const bandFrac = Math.max(0.05, req.rebalance_band_pct / 100);
  const txCostBps = round(req.tx_cost_bps ?? 10, 1);
  const trialsTested = Math.max(1, Math.round(req.trials_tested ?? opts?.defaultTrialsTested ?? 1));

  // Initial one-way turnover between baseline and simulated weights (charged at entry on simulated path)
  const allWeightKeys = new Set([...baseWeights.keys(), ...simWeights.keys()]);
  let initTurnFrac = 0;
  for (const k of allWeightKeys) {
    initTurnFrac += Math.abs((simWeights.get(k) ?? 0) - (baseWeights.get(k) ?? 0));
  }
  initTurnFrac *= 0.5;

  const baselineSim = simulatePortfolioPath(baseWeights, alignedPrices, finalDates.length, bandFrac, rfPct, txCostBps, 0);
  const simulatedSim = simulatePortfolioPath(simWeights, alignedPrices, finalDates.length, bandFrac, rfPct, txCostBps, initTurnFrac);
  const baselineCurve = baselineSim.curve;
  const simulatedCurve = simulatedSim.curve;
  const benchRaw = alignedPrices.get("__BENCH__")!;
  const benchStart = benchRaw[0]!;
  const benchmarkCurve = benchRaw.map((p) => round((p / benchStart) * 100, 4));

  const baselineMetrics = computeSeriesMetrics(baselineCurve, rfPct, baselineSim.rebalanceCount, {
    totalTurnoverPct: baselineSim.totalTurnoverPct,
    txCostDragBps: baselineSim.txCostDragBps,
    trialsTested: 1,
  });
  const simulatedMetrics = computeSeriesMetrics(simulatedCurve, rfPct, simulatedSim.rebalanceCount, {
    totalTurnoverPct: simulatedSim.totalTurnoverPct,
    txCostDragBps: simulatedSim.txCostDragBps,
    trialsTested,
  });
  const benchmarkMetrics = computeSeriesMetrics(benchmarkCurve, rfPct, 0, { trialsTested: 1 });
  const simWeeklyRetsForDsr = simulatedCurve.slice(1).map((v, i) => (simulatedCurve[i]! > 0 ? v / simulatedCurve[i]! - 1 : 0));
  const simDsrDetail = computeDeflatedSharpeRatio({
    annualizedSharpe: simulatedMetrics.sharpe,
    weeklyReturns: simWeeklyRetsForDsr,
    trialsTested,
  });

  const toWeeklyReturns = (arr: number[]): number[] => {
    const out: number[] = [];
    for (let i = 1; i < arr.length; i += 1) {
      const prev = arr[i - 1]!;
      out.push(prev > 0 ? arr[i]! / prev - 1 : 0);
    }
    return out;
  };

  const candRets = toWeeklyReturns(alignedPrices.get(candidateTicker)!);
  const baseRets = toWeeklyReturns(baselineCurve);
  const candCorrPortfolio = pearsonCorrelation(candRets, baseRets);

  const primaryBucket = profile.risk_caps.find((r) => r.kind === "bucket");
  let candCorrCluster: number | null = null;
  if (primaryBucket && primaryBucket.tickers && primaryBucket.tickers.length > 0) {
    const bucketCanonSet = new Set(primaryBucket.tickers.map((t) => canonicalAssetName(t)));
    const ltWeightByCanon = new Map(lookthrough.map((row) => [row.name, row.pct_nav]));
    const clusterWeights = new Map<string, number>();
    let clusterWTotal = 0;
    for (const ticker of includedHoldings) {
      const canon = canonicalAssetName(ticker);
      if (bucketCanonSet.has(canon) && ticker !== candidateTicker) {
        const w =
          includeExternalWealth && ticker === extTickerIncluded
            ? (baseWeights.get(ticker) ?? 0) * 100
            : (ltWeightByCanon.get(canon) ?? (baseWeights.get(ticker) ?? 0) * 100);
        if (w > 0) {
          clusterWeights.set(ticker, w);
          clusterWTotal += w;
        }
      }
    }
    if (clusterWTotal > 0) {
      const normCluster = new Map<string, number>();
      for (const [k, w] of clusterWeights.entries()) {
        normCluster.set(k, w / clusterWTotal);
      }
      const clusterSim = simulatePortfolioPath(normCluster, alignedPrices, finalDates.length, 0, rfPct);
      candCorrCluster = pearsonCorrelation(candRets, toWeeklyReturns(clusterSim.curve));
    }
  }

  const holdingCorrs: Array<{ ticker: string; corr: number }> = [];
  for (const ticker of includedHoldings) {
    if (ticker === candidateTicker) continue;
    const arr = alignedPrices.get(ticker);
    if (!arr) continue;
    const c = pearsonCorrelation(candRets, toWeeklyReturns(arr));
    if (c !== null) {
      holdingCorrs.push({ ticker, corr: c });
    }
  }
  holdingCorrs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  const regimeDefs = [
    { id: "2022-rate-shock", label: "2022 Rate Shock", start: "2022-01-01", end: "2022-12-31" },
    { id: "2023-2024-ai-expansion", label: "2023–24 AI Expansion", start: "2023-01-01", end: "2024-12-31" },
    { id: "2025-2026-vol", label: "2025–26 Market Regime", start: "2025-01-01", end: "2026-12-31" },
  ];
  const regimes: BacktestRegimeRow[] = [];
  for (const r of regimeDefs) {
    const bStat = computeWindowCagrAndDd(finalDates, baselineCurve, r.start, r.end);
    const sStat = computeWindowCagrAndDd(finalDates, simulatedCurve, r.start, r.end);
    if (bStat && sStat) {
      regimes.push({
        id: r.id,
        label: r.label,
        start: r.start,
        end: r.end,
        weeks: bStat.weeks,
        baseline_cagr_pct: bStat.cagr_pct,
        simulated_cagr_pct: sStat.cagr_pct,
        baseline_dd_pct: bStat.dd_pct,
        simulated_dd_pct: sStat.dd_pct,
      });
    }
  }
  if (regimes.length === 0) {
    regimes.push({
      id: "full-overlap",
      label: "Full Overlapping Window",
      start: finalDates[0]!,
      end: finalDates[finalDates.length - 1]!,
      weeks: finalDates.length - 1,
      baseline_cagr_pct: baselineMetrics.cagr_pct,
      simulated_cagr_pct: simulatedMetrics.cagr_pct,
      baseline_dd_pct: baselineMetrics.max_drawdown_pct,
      simulated_dd_pct: simulatedMetrics.max_drawdown_pct,
    });
  }

  const equityCurve: BacktestEquityPoint[] = finalDates.map((date, idx) => ({
    date,
    baseline_idx: round(baselineCurve[idx]!, 2),
    simulated_idx: round(simulatedCurve[idx]!, 2),
    benchmark_idx: round(benchmarkCurve[idx]!, 2),
  }));

  const baseCaveat = `Deterministic weekly backtest (${finalDates.length - 1}w, hybrid max(2%, ${req.rebalance_band_pct}%) drift rebalance, rf=${rfPct}%, tx=${txCostBps}bps, DSR M=${trialsTested}, survivor/hindsight caveats apply).`;
  const caveat = caveats.length > 0 ? `${baseCaveat} ${caveats.join(" ")}` : baseCaveat;

  return {
    candidate_ticker: candidateTicker,
    candidate_yf_symbol: candidateYf,
    benchmark_symbol: benchmarkSym,
    target_weight_pct: round(req.target_weight_pct, 2),
    funding_source: req.funding_source,
    rebalance_band_pct: round(req.rebalance_band_pct, 1),
    rf_pct: rfPct,
    tx_cost_bps: txCostBps,
    trials_tested: trialsTested,
    sr0_annual_threshold: simDsrDetail.sr0_annual_threshold,
    include_external_wealth: includeExternalWealth,
    fx_converted_tickers: fxConvertedTickers,
    overlap_start: finalDates[0]!,
    overlap_end: finalDates[finalDates.length - 1]!,
    weeks_analyzed: finalDates.length - 1,
    caveat,
    data_sources: dataSources,
    baseline: baselineMetrics,
    simulated: simulatedMetrics,
    benchmark: benchmarkMetrics,
    deltas: {
      cagr_pct: round(simulatedMetrics.cagr_pct - baselineMetrics.cagr_pct, 2),
      max_drawdown_pct: round(simulatedMetrics.max_drawdown_pct - baselineMetrics.max_drawdown_pct, 2),
      sharpe: round(simulatedMetrics.sharpe - baselineMetrics.sharpe, 2),
      sortino: round(simulatedMetrics.sortino - baselineMetrics.sortino, 2),
    },
    candidate_corr_portfolio: candCorrPortfolio,
    candidate_corr_cluster: candCorrCluster,
    top_correlations: holdingCorrs.slice(0, 5),
    regimes,
    equity_curve: equityCurve,
  };
}
