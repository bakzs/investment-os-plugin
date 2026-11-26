import { round, type AfterTaxHurdleInfo } from "./quant.js";
import type {
  DossierFundamentals,
  DossierModel,
  FundamentalModel,
  FundamentalSegment,
  ScenarioCase,
  ScenarioTriple,
  VariantPerceptionItem,
} from "./schema.js";

type CaseKey = "bear" | "base" | "bull";
const CASE_KEYS: readonly CaseKey[] = ["bear", "base", "bull"];
const CASE_TITLES: Record<CaseKey, string> = {
  bear: "Bear",
  base: "Base",
  bull: "Bull",
};

export interface SotpSegmentCaseEval {
  rev_T_b: number;
  metric_T_b: number;
  ev_b: number;
  ev_share_pct: number;
}

export interface SotpSegmentSummary {
  id: string;
  name: string;
  kind: FundamentalSegment["kind"];
  valuation_metric: FundamentalSegment["valuation_metric"];
  notes?: string;
  bear: SotpSegmentCaseEval;
  base: SotpSegmentCaseEval;
  bull: SotpSegmentCaseEval;
}

export interface SotpCaseTotal {
  label: CaseKey;
  probability: number;
  total_rev_T_b: number;
  total_metric_T_b: number;
  total_ev_b: number;
  projected_net_cash_b: number;
  equity_value_b: number;
  terminal_shares_m: number;
  target_price: number;
  implied_gross_cagr_pct: number | null;
  implied_after_tax_cagr_pct: number | null;
}

export interface SotpValuationSummary {
  horizon_years: number;
  base_shares_m: number;
  annual_dilution_pct: number;
  terminal_shares_m: number;
  segments: SotpSegmentSummary[];
  totals: {
    bear: SotpCaseTotal;
    base: SotpCaseTotal;
    bull: SotpCaseTotal;
  };
  derived_scenarios: {
    bear: ScenarioCase;
    base: ScenarioCase;
    bull: ScenarioCase;
  };
  variant_perception: VariantPerceptionItem[];
  sotp_warnings: string[];
  methodology_note: string | null;
}

interface RawSegmentEval {
  revTB: number;
  metricTB: number;
  evB: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeProbabilities(raw?: ScenarioTriple | null): Record<CaseKey, number> {
  const bearRaw = Math.max(0, finiteOr(raw?.bear, 0.25));
  const baseRaw = Math.max(0, finiteOr(raw?.base, 0.5));
  const bullRaw = Math.max(0, finiteOr(raw?.bull, 0.25));
  const sum = bearRaw + baseRaw + bullRaw;
  if (sum <= 0) {
    return { bear: 0.25, base: 0.5, bull: 0.25 };
  }
  const bear = round(bearRaw / sum, 4);
  const base = round(baseRaw / sum, 4);
  const bull = round(clamp(1 - bear - base, 0, 1), 4);
  return { bear, base, bull };
}

function evaluateSegmentCase(seg: FundamentalSegment, c: CaseKey, horizonYears: number): RawSegmentEval {
  const valuationMetric = seg.valuation_metric ?? "owner_earnings";
  const revMult =
    typeof seg.rev_multiplier_to_b === "number" && Number.isFinite(seg.rev_multiplier_to_b) && seg.rev_multiplier_to_b > 0
      ? seg.rev_multiplier_to_b
      : 0.001;

  if (seg.kind === "milestone_option") {
    const prob = clamp(finiteOr(seg.success_prob?.[c], 0), 0, 1);
    const successEvB = Math.max(0, finiteOr(seg.success_ev_b?.[c], 0));
    return { revTB: 0, metricTB: 0, evB: prob * successEvB };
  }

  let revTB = 0;
  if (seg.kind === "unit_economics") {
    revTB = Math.max(0, finiteOr(seg.units?.[c], 0) * finiteOr(seg.rev_per_unit?.[c], 0) * revMult);
  } else {
    const cagrPct = finiteOr(seg.rev_cagr_pct?.[c], 0);
    const curRevB = Math.max(0, finiteOr(seg.current_rev_b, 0));
    revTB = Math.max(0, curRevB * Math.pow(Math.max(0.01, 1 + cagrPct / 100), horizonYears));
  }

  const metricTB =
    valuationMetric === "revenue"
      ? revTB
      : revTB * (finiteOr(seg.margin_pct?.[c], 0) / 100) - finiteOr(seg.capex_or_sbc_drag_b?.[c], 0);

  const evB =
    valuationMetric === "ev_direct"
      ? Math.max(0, revTB)
      : Math.max(0, metricTB * finiteOr(seg.exit_multiple?.[c], 0));

  return { revTB, metricTB, evB };
}

function resolveNetCashB(model: DossierModel, fm: FundamentalModel, c: CaseKey): number {
  const candidate = fm.projected_net_cash_b?.[c] ?? fm.net_cash_b ?? model.reverse_dcf?.net_cash_b ?? 0;
  return finiteOr(candidate, 0);
}

function extractXbrlTtmRevB(fundamentals: DossierFundamentals | null | undefined): number | null {
  if (!fundamentals) return null;
  const quarterly = fundamentals.quarterly ?? [];
  if (quarterly.length >= 4) {
    const q4 = quarterly.slice(0, 4);
    if (q4.every((q) => typeof q.revenue_m === "number" && Number.isFinite(q.revenue_m))) {
      const ttmRevM = q4.reduce((sum, q) => sum + (q.revenue_m ?? 0), 0);
      if (ttmRevM > 0) return ttmRevM / 1000;
    }
  }
  const fyRevM = fundamentals.annual?.[0]?.revenue_m;
  if (typeof fyRevM === "number" && Number.isFinite(fyRevM) && fyRevM > 0) {
    return fyRevM / 1000;
  }
  return null;
}

function extractXbrlDilutedSharesM(fundamentals: DossierFundamentals | null | undefined): number | null {
  if (!fundamentals) return null;
  const qShares = fundamentals.quarterly?.find(
    (q) => typeof q.diluted_shares_m === "number" && Number.isFinite(q.diluted_shares_m) && q.diluted_shares_m > 0,
  )?.diluted_shares_m;
  if (qShares && qShares > 0) return qShares;

  const aShares = fundamentals.annual?.find(
    (a) => typeof a.diluted_shares_m === "number" && Number.isFinite(a.diluted_shares_m) && a.diluted_shares_m > 0,
  )?.diluted_shares_m;
  return aShares && aShares > 0 ? aShares : null;
}

function buildSotpWarnings(
  fm: FundamentalModel,
  baseSharesM: number,
  segments: Array<{ seg: FundamentalSegment; evals: Record<CaseKey, RawSegmentEval> }>,
  baseTotalEvRaw: number,
  baseEquityB: number,
  bullEquityB: number,
  fundamentals: DossierFundamentals | null | undefined,
): string[] {
  const warnings: string[] = [];

  // 1. TTM revenue cross-check when all non-milestone segments project from current_rev_b
  const nonMilestone = fm.segments.filter((s) => s.kind !== "milestone_option");
  const allCagrWithRev =
    nonMilestone.length > 0 &&
    nonMilestone.every(
      (s) => s.kind === "cagr_margin" && typeof s.current_rev_b === "number" && Number.isFinite(s.current_rev_b) && s.current_rev_b > 0,
    );
  const xbrlRevB = extractXbrlTtmRevB(fundamentals);
  if (allCagrWithRev && xbrlRevB !== null && xbrlRevB > 0) {
    const modelRevB = nonMilestone.reduce((acc, s) => acc + (s.current_rev_b ?? 0), 0);
    const relDiff = Math.abs(modelRevB - xbrlRevB) / xbrlRevB;
    if (relDiff > 0.25) {
      warnings.push(
        `SOTP starting revenue sum ($${round(modelRevB, 2)}B) diverges by ${round(relDiff * 100, 1)}% from XBRL TTM revenue ($${round(xbrlRevB, 2)}B).`,
      );
    }
  }

  // 2. Diluted share count cross-check vs XBRL
  const xbrlSharesM = extractXbrlDilutedSharesM(fundamentals);
  if (xbrlSharesM !== null && xbrlSharesM > 0) {
    const shareDiff = Math.abs(baseSharesM - xbrlSharesM) / xbrlSharesM;
    if (shareDiff > 0.15) {
      warnings.push(
        `SOTP base_shares_m (${round(baseSharesM, 2)}M) diverges by ${round(shareDiff * 100, 1)}% from XBRL diluted shares (${round(xbrlSharesM, 2)}M).`,
      );
    }
  }

  // 3. >$5T terminal market-cap guardrail on Base and Bull
  for (const [label, eqB] of [
    ["BASE", baseEquityB],
    ["BULL", bullEquityB],
  ] as const) {
    if (eqB > 5000) {
      warnings.push(
        `${label} SOTP case implies $${round(eqB / 1000, 2)}T terminal equity value (> $5T outside-view guardrail).`,
      );
    }
  }

  // 4. >50% milestone optionality concentration in Base EV
  if (baseTotalEvRaw > 0) {
    for (const item of segments) {
      if (item.seg.kind !== "milestone_option") continue;
      const share = item.evals.base.evB / baseTotalEvRaw;
      if (share > 0.5) {
        warnings.push(
          `Milestone option "${item.seg.name}" contributes ${round(share * 100, 1)}% of Base EV (> 50% optionality concentration).`,
        );
      }
    }
  }

  return warnings;
}

function buildCaseSummary(
  caseKey: CaseKey,
  totalEvRaw: number,
  segments: SotpSegmentSummary[],
): string {
  const k = segments.length;
  const segLabel = k === 1 ? "segment" : "segments";
  const prefix = `SOTP ${CASE_TITLES[caseKey]}: $${totalEvRaw.toFixed(1)}B EV across ${k} ${segLabel}`;
  if (totalEvRaw <= 0 || k === 0) {
    return prefix;
  }
  let topSeg = segments[0]!;
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i]![caseKey].ev_b > topSeg[caseKey].ev_b) {
      topSeg = segments[i]!;
    }
  }
  return `${prefix} (top: ${topSeg.name} ${round(topSeg[caseKey].ev_share_pct, 1)}%)`;
}

/**
 * Evaluates a bottom-up multi-segment Sum-of-the-Parts (SOTP) model across Bear/Base/Bull cases,
 * bridging EV to equity value per diluted terminal share and deriving ScenarioCase summaries.
 */
export function computeSotpValuation(
  price: number | null,
  model: DossierModel | null | undefined,
  taxInfo?: AfterTaxHurdleInfo | null,
  fundamentals?: DossierFundamentals | null,
): SotpValuationSummary | null {
  const fm = model?.fundamental_model;
  if (!model || !fm || !Array.isArray(fm.segments) || fm.segments.length === 0) {
    return null;
  }
  const baseSharesM = fm.base_shares_m;
  if (!Number.isFinite(baseSharesM) || baseSharesM <= 0) {
    return null;
  }

  const horizonYears = Math.max(1, model.horizon_years || 5);
  const annualDilPct = finiteOr(fm.annual_dilution_pct, 0);
  const terminalSharesRaw = baseSharesM * Math.pow(1 + annualDilPct / 100, horizonYears);
  if (!Number.isFinite(terminalSharesRaw) || terminalSharesRaw <= 0) {
    return null;
  }

  const probs = normalizeProbabilities(fm.scenario_probabilities);
  const isAccumulating = Boolean(model.accumulating || taxInfo?.accumulating);
  const rawDivYieldPct =
    !isAccumulating && Number.isFinite(model.dividend_yield_pct) && model.dividend_yield_pct > 0
      ? model.dividend_yield_pct
      : 0;
  const hasValidPrice = price !== null && Number.isFinite(price) && price > 0;

  const rawBySeg = fm.segments.map((seg) => ({
    seg,
    evals: {
      bear: evaluateSegmentCase(seg, "bear", horizonYears),
      base: evaluateSegmentCase(seg, "base", horizonYears),
      bull: evaluateSegmentCase(seg, "bull", horizonYears),
    },
  }));

  const rawTotals = {
    bear: { rev: 0, metric: 0, ev: 0, netCash: 0, equity: 0, targetPrice: 0 },
    base: { rev: 0, metric: 0, ev: 0, netCash: 0, equity: 0, targetPrice: 0 },
    bull: { rev: 0, metric: 0, ev: 0, netCash: 0, equity: 0, targetPrice: 0 },
  };

  for (const c of CASE_KEYS) {
    let totalRev = 0;
    let totalMetric = 0;
    let totalEv = 0;
    for (const item of rawBySeg) {
      totalRev += item.evals[c].revTB;
      totalMetric += item.evals[c].metricTB;
      totalEv += item.evals[c].evB;
    }
    const netCash = resolveNetCashB(model, fm, c);
    const equity = Math.max(0, totalEv + netCash);
    const targetPrice = (equity * 1000) / terminalSharesRaw;
    rawTotals[c] = { rev: totalRev, metric: totalMetric, ev: totalEv, netCash, equity, targetPrice };
  }

  const segmentSummaries: SotpSegmentSummary[] = rawBySeg.map(({ seg, evals }) => {
    const toCaseEval = (c: CaseKey): SotpSegmentCaseEval => {
      const e = evals[c];
      const totalEv = rawTotals[c].ev;
      return {
        rev_T_b: round(e.revTB, 2),
        metric_T_b: round(e.metricTB, 2),
        ev_b: round(e.evB, 2),
        ev_share_pct: totalEv > 0 ? round((e.evB / totalEv) * 100, 2) : 0,
      };
    };
    return {
      id: seg.id,
      name: seg.name,
      kind: seg.kind,
      valuation_metric: seg.valuation_metric ?? "owner_earnings",
      ...(seg.notes !== undefined ? { notes: seg.notes } : {}),
      bear: toCaseEval("bear"),
      base: toCaseEval("base"),
      bull: toCaseEval("bull"),
    };
  });

  const terminalSharesRounded = round(terminalSharesRaw, 2);
  const buildCaseTotal = (c: CaseKey): SotpCaseTotal => {
    const t = rawTotals[c];
    let grossCagr: number | null = null;
    let afterTaxCagr: number | null = null;
    if (hasValidPrice) {
      const ratio = t.targetPrice / price;
      const priceCagrPct = ratio > 0 ? (Math.pow(ratio, 1 / horizonYears) - 1) * 100 : -95;
      grossCagr = round(priceCagrPct + rawDivYieldPct, 2);
      if (taxInfo) {
        afterTaxCagr = round(grossCagr - taxInfo.total_tax_drag_pct, 2);
      }
    }
    return {
      label: c,
      probability: probs[c],
      total_rev_T_b: round(t.rev, 2),
      total_metric_T_b: round(t.metric, 2),
      total_ev_b: round(t.ev, 2),
      projected_net_cash_b: round(t.netCash, 2),
      equity_value_b: round(t.equity, 2),
      terminal_shares_m: terminalSharesRounded,
      target_price: round(t.targetPrice, 2),
      implied_gross_cagr_pct: grossCagr,
      implied_after_tax_cagr_pct: afterTaxCagr,
    };
  };

  const buildDerivedScenario = (c: CaseKey): ScenarioCase => {
    const t = rawTotals[c];
    const blendedMultiple = t.metric > 0 && t.ev >= 0 ? round(t.ev / t.metric, 2) : null;
    return {
      probability: probs[c],
      target_price_5y: round(t.targetPrice, 2),
      multiple: blendedMultiple,
      metric_cagr_pct: null,
      summary: buildCaseSummary(c, t.ev, segmentSummaries),
    };
  };

  const warnings = buildSotpWarnings(
    fm,
    baseSharesM,
    rawBySeg,
    rawTotals.base.ev,
    rawTotals.base.equity,
    rawTotals.bull.equity,
    fundamentals,
  );

  return {
    horizon_years: horizonYears,
    base_shares_m: round(baseSharesM, 4),
    annual_dilution_pct: round(annualDilPct, 2),
    terminal_shares_m: terminalSharesRounded,
    segments: segmentSummaries,
    totals: {
      bear: buildCaseTotal("bear"),
      base: buildCaseTotal("base"),
      bull: buildCaseTotal("bull"),
    },
    derived_scenarios: {
      bear: buildDerivedScenario("bear"),
      base: buildDerivedScenario("base"),
      bull: buildDerivedScenario("bull"),
    },
    variant_perception: fm.variant_perception ?? [],
    sotp_warnings: warnings,
    methodology_note: fm.methodology_note ?? null,
  };
}

/**
 * Returns a cloned DossierModel with `scenarios` populated from SOTP valuation when
 * `fundamental_model` is present and `derive_scenarios_from_sotp !== false`; otherwise returns `model ?? null`.
 */
export function resolveEffectiveDossierModel(
  model: DossierModel | null | undefined,
  fundamentals?: DossierFundamentals | null,
): DossierModel | null {
  if (!model) return null;
  if (!model.fundamental_model || model.fundamental_model.derive_scenarios_from_sotp === false) {
    return model;
  }
  const sotp = computeSotpValuation(null, model, null, fundamentals);
  if (!sotp) return model;
  return {
    ...model,
    scenarios: sotp.derived_scenarios,
  };
}
