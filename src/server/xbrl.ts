import {
  loadSecTickerMap,
  PERIODIC_FORMS,
  resolveSecUserAgent,
  SEC_PACING_MS,
  sleepMs,
} from "./edgar.js";
import {
  FundamentalsSchema,
  normalizeTicker,
  type DossierFundamentals,
  type FundamentalsPeriod,
  type FundamentalsRatios,
  type UserProfile,
} from "./schema.js";
import {
  loadDossierFundamentals,
  saveDossierFundamentals,
  type EdgarFilingRow,
} from "./storage.js";

const DEFAULT_XBRL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface XbrlFactItem {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

interface XbrlConceptBlock {
  units?: Record<string, XbrlFactItem[]>;
}

export interface SecCompanyFactsPayload {
  cik?: number | string;
  entityName?: string;
  facts?: Record<string, Record<string, XbrlConceptBlock>>;
}

interface ConceptCandidate {
  taxonomy: string;
  tag: string;
}

const REVENUE_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "RevenueFromContractWithCustomerExcludingAssessedTax" },
  { taxonomy: "us-gaap", tag: "Revenues" },
  { taxonomy: "us-gaap", tag: "SalesRevenueNet" },
  { taxonomy: "us-gaap", tag: "RevenueFromContractWithCustomerIncludingAssessedTax" },
  { taxonomy: "us-gaap", tag: "SalesRevenueGoodsNet" },
  { taxonomy: "ifrs-full", tag: "Revenue" },
  { taxonomy: "ifrs-full", tag: "RevenueFromContractsWithCustomers" },
];

const COGS_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "CostOfGoodsAndServicesSold" },
  { taxonomy: "us-gaap", tag: "CostOfRevenue" },
  { taxonomy: "us-gaap", tag: "CostOfGoodsSold" },
  { taxonomy: "us-gaap", tag: "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization" },
  { taxonomy: "ifrs-full", tag: "CostOfSales" },
];

const GROSS_PROFIT_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "GrossProfit" },
  { taxonomy: "ifrs-full", tag: "GrossProfit" },
];

const OP_INCOME_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "OperatingIncomeLoss" },
  { taxonomy: "ifrs-full", tag: "ProfitLossFromOperatingActivities" },
];

const NET_INCOME_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "NetIncomeLoss" },
  { taxonomy: "us-gaap", tag: "ProfitLoss" },
  { taxonomy: "us-gaap", tag: "NetIncomeLossAvailableToCommonStockholdersBasic" },
  { taxonomy: "ifrs-full", tag: "ProfitLossAttributableToOwnersOfParent" },
  { taxonomy: "ifrs-full", tag: "ProfitLoss" },
];

const OCF_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "NetCashProvidedByUsedInOperatingActivities" },
  { taxonomy: "us-gaap", tag: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations" },
  { taxonomy: "ifrs-full", tag: "CashFlowsFromUsedInOperatingActivities" },
];

const CAPEX_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "PaymentsToAcquirePropertyPlantAndEquipment" },
  { taxonomy: "us-gaap", tag: "PaymentsToAcquireProductiveAssets" },
  { taxonomy: "ifrs-full", tag: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities" },
  { taxonomy: "ifrs-full", tag: "PurchaseOfPropertyPlantAndEquipment" },
];

const SBC_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "ShareBasedCompensation" },
  { taxonomy: "us-gaap", tag: "AllocatedShareBasedCompensationExpense" },
  { taxonomy: "us-gaap", tag: "EmployeeBenefitsAndShareBasedCompensation" },
  { taxonomy: "ifrs-full", tag: "ExpenseFromSharebasedPaymentTransactionsWithEmployees" },
];

const DILUTED_SHARES_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "WeightedAverageNumberOfDilutedSharesOutstanding" },
  { taxonomy: "us-gaap", tag: "WeightedAverageNumberOfShareOutstandingBasicAndDiluted" },
  { taxonomy: "ifrs-full", tag: "AdjustedWeightedAverageShares" },
  { taxonomy: "ifrs-full", tag: "WeightedAverageShares" },
];

const INSTANT_SHARES_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "dei", tag: "EntityCommonStockSharesOutstanding" },
  { taxonomy: "us-gaap", tag: "CommonStockSharesOutstanding" },
];

const EPS_DILUTED_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "EarningsPerShareDiluted" },
  { taxonomy: "us-gaap", tag: "EarningsPerShareBasicAndDiluted" },
  { taxonomy: "ifrs-full", tag: "DilutedEarningsLossPerShare" },
];

const AR_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "AccountsReceivableNetCurrent" },
  { taxonomy: "us-gaap", tag: "ReceivablesNetCurrent" },
  { taxonomy: "us-gaap", tag: "AccountsReceivableNet" },
  { taxonomy: "ifrs-full", tag: "TradeAndOtherCurrentReceivables" },
  { taxonomy: "ifrs-full", tag: "CurrentTradeReceivables" },
];

const INVENTORY_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "InventoryNet" },
  { taxonomy: "us-gaap", tag: "Inventories" },
  { taxonomy: "ifrs-full", tag: "Inventories" },
];

const CASH_COMBINED_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "CashCashEquivalentsAndShortTermInvestments" },
  { taxonomy: "us-gaap", tag: "CashCashEquivalentsAndMarketableSecurities" },
];

const CASH_ONLY_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "CashAndCashEquivalentsAtCarryingValue" },
  { taxonomy: "us-gaap", tag: "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents" },
  { taxonomy: "ifrs-full", tag: "CashAndCashEquivalents" },
];

const ST_INVESTMENTS_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "MarketableSecuritiesCurrent" },
  { taxonomy: "us-gaap", tag: "ShortTermInvestments" },
  { taxonomy: "us-gaap", tag: "AvailableForSaleSecuritiesDebtSecuritiesCurrent" },
  { taxonomy: "us-gaap", tag: "OtherShortTermInvestments" },
];

const LT_DEBT_NONCURRENT_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "LongTermDebtNoncurrent" },
  { taxonomy: "us-gaap", tag: "LongTermDebtAndCapitalLeaseObligations" },
  { taxonomy: "us-gaap", tag: "LongTermDebt" },
  { taxonomy: "ifrs-full", tag: "LongtermBorrowings" },
  { taxonomy: "ifrs-full", tag: "NoncurrentFinancialLiabilities" },
];

const ST_DEBT_CONCEPTS: ConceptCandidate[] = [
  { taxonomy: "us-gaap", tag: "LongTermDebtCurrent" },
  { taxonomy: "us-gaap", tag: "ShortTermBorrowings" },
  { taxonomy: "us-gaap", tag: "DebtCurrent" },
  { taxonomy: "us-gaap", tag: "CommercialPaper" },
  { taxonomy: "ifrs-full", tag: "CurrentBorrowings" },
];

function round(val: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

function daysBetween(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T00:00:00Z`);
  const e = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return -1;
  return Math.round((e - s) / MS_PER_DAY);
}

function isIsoDate(val: unknown): val is string {
  return typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

interface NormalizedFlowFact {
  start: string;
  end: string;
  days: number;
  val: number;
  filed: string;
  form: string;
  accn: string;
  fy: number | null;
  fp: string;
  priority: number;
}

interface NormalizedInstantFact {
  end: string;
  val: number;
  filed: string;
  form: string;
  accn: string;
  priority: number;
}

function detectPrimaryCurrency(payload: SecCompanyFactsPayload): string {
  const counts = new Map<string, number>();
  for (const cand of [...REVENUE_CONCEPTS, ...NET_INCOME_CONCEPTS]) {
    const units = payload.facts?.[cand.taxonomy]?.[cand.tag]?.units;
    if (!units) continue;
    for (const [unitKey, items] of Object.entries(units)) {
      if (!/^[A-Z]{3}$/.test(unitKey)) continue;
      counts.set(unitKey, (counts.get(unitKey) ?? 0) + (items?.length ?? 0));
    }
  }
  let best = "USD";
  let bestCount = -1;
  for (const [ccy, cnt] of counts.entries()) {
    if (cnt > bestCount) {
      best = ccy;
      bestCount = cnt;
    }
  }
  return best;
}

function collectFlowFacts(
  payload: SecCompanyFactsPayload,
  concepts: ConceptCandidate[],
  unitMatcher: (unitKey: string) => boolean,
): NormalizedFlowFact[] {
  const dedup = new Map<string, NormalizedFlowFact>();
  for (let pIdx = 0; pIdx < concepts.length; pIdx += 1) {
    const cand = concepts[pIdx];
    const units = payload.facts?.[cand.taxonomy]?.[cand.tag]?.units;
    if (!units) continue;
    for (const [unitKey, items] of Object.entries(units)) {
      if (!unitMatcher(unitKey) || !Array.isArray(items)) continue;
      for (const item of items) {
        const form = (item.form ?? "").trim().toUpperCase();
        if (!PERIODIC_FORMS.has(form)) continue;
        if (!isIsoDate(item.start) || !isIsoDate(item.end)) continue;
        if (typeof item.val !== "number" || !Number.isFinite(item.val)) continue;
        const days = daysBetween(item.start, item.end);
        if (days < 65 || days > 400) continue;
        const filed = isIsoDate(item.filed) ? item.filed : item.end;
        const key = `${item.start}|${item.end}`;
        const next: NormalizedFlowFact = {
          start: item.start,
          end: item.end,
          days,
          val: item.val,
          filed,
          form,
          accn: String(item.accn ?? ""),
          fy:
            typeof item.fy === "number" && Number.isInteger(item.fy) && item.fy >= 1990 && item.fy <= 2100
              ? item.fy
              : null,
          fp: String(item.fp ?? "").trim().toUpperCase(),
          priority: pIdx,
        };
        const existing = dedup.get(key);
        if (!existing) {
          dedup.set(key, next);
          continue;
        }
        // Prefer higher-priority concept; within same concept prefer latest filing date
        if (next.priority < existing.priority) {
          dedup.set(key, next);
        } else if (next.priority === existing.priority && next.filed >= existing.filed) {
          dedup.set(key, next);
        }
      }
    }
  }
  return Array.from(dedup.values());
}

function collectInstantFacts(
  payload: SecCompanyFactsPayload,
  concepts: ConceptCandidate[],
  unitMatcher: (unitKey: string) => boolean,
): Map<string, NormalizedInstantFact> {
  const dedup = new Map<string, NormalizedInstantFact>();
  for (let pIdx = 0; pIdx < concepts.length; pIdx += 1) {
    const cand = concepts[pIdx];
    const units = payload.facts?.[cand.taxonomy]?.[cand.tag]?.units;
    if (!units) continue;
    for (const [unitKey, items] of Object.entries(units)) {
      if (!unitMatcher(unitKey) || !Array.isArray(items)) continue;
      for (const item of items) {
        const form = (item.form ?? "").trim().toUpperCase();
        if (!PERIODIC_FORMS.has(form)) continue;
        if (!isIsoDate(item.end) || item.start) continue;
        if (typeof item.val !== "number" || !Number.isFinite(item.val)) continue;
        const filed = isIsoDate(item.filed) ? item.filed : item.end;
        const next: NormalizedInstantFact = {
          end: item.end,
          val: item.val,
          filed,
          form,
          accn: String(item.accn ?? ""),
          priority: pIdx,
        };
        const existing = dedup.get(item.end);
        if (!existing) {
          dedup.set(item.end, next);
          continue;
        }
        if (next.priority < existing.priority) {
          dedup.set(item.end, next);
        } else if (next.priority === existing.priority && next.filed >= existing.filed) {
          dedup.set(item.end, next);
        }
      }
    }
  }
  return dedup;
}

function findInstantNear(map: Map<string, NormalizedInstantFact>, periodEnd: string): number | null {
  const exact = map.get(periodEnd);
  if (exact) return exact.val;
  const targetMs = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) return null;
  let best: { dist: number; val: number } | null = null;
  for (const [dt, fact] of map.entries()) {
    const ms = Date.parse(`${dt}T00:00:00Z`);
    const dist = Math.abs(ms - targetMs) / MS_PER_DAY;
    if (dist <= 5 && (!best || dist < best.dist)) {
      best = { dist, val: fact.val };
    }
  }
  return best ? best.val : null;
}

/**
 * Resolves single-quarter flow values by period_end.
 * 1. Direct single-quarter facts (70-115 days).
 * 2. YTD differencing (e.g., 6M YTD - 3M Q1 = Q2, 9M YTD - 6M YTD = Q3, 12M FY - 9M YTD = Q4)
 *    for cumulative cash-flow / income items reported YTD in 10-Q/10-K filings.
 */
function buildQuarterlyFlowMap(
  facts: NormalizedFlowFact[],
  allowYtdDifference = true,
): Map<string, NormalizedFlowFact> {
  const byEnd = new Map<string, NormalizedFlowFact>();

  // Step 1: Direct single-quarter facts (70..115 days)
  for (const f of facts) {
    if (f.days < 70 || f.days > 115) continue;
    const prev = byEnd.get(f.end);
    if (!prev || f.priority < prev.priority || (f.priority === prev.priority && f.filed >= prev.filed)) {
      byEnd.set(f.end, f);
    }
  }

  if (!allowYtdDifference) {
    return byEnd;
  }

  // Step 2: Group cumulative facts by fiscal year start (within +-5 days)
  const sortedFacts = [...facts].sort((a, b) => a.end.localeCompare(b.end));
  for (const longer of sortedFacts) {
    if (byEnd.has(longer.end)) continue;
    if (longer.days < 150 || longer.days > 395) continue;

    // Look for a cumulative predecessor with same start (+-5 days) whose duration is ~1 quarter shorter (70..115 days)
    let bestPrior: NormalizedFlowFact | null = null;
    for (const prior of sortedFacts) {
      if (prior.end >= longer.end) continue;
      const startDiff = Math.abs(daysBetween(prior.start, longer.start));
      if (startDiff > 5) continue;
      const deltaDays = daysBetween(prior.end, longer.end);
      if (deltaDays < 70 || deltaDays > 115) continue;
      if (!bestPrior) {
        bestPrior = prior;
        continue;
      }
      const sameConcept = prior.priority === longer.priority;
      const bestSameConcept = bestPrior.priority === longer.priority;
      if ((sameConcept && !bestSameConcept) || (sameConcept === bestSameConcept && prior.filed >= bestPrior.filed)) {
        bestPrior = prior;
      }
    }
    if (bestPrior) {
      byEnd.set(longer.end, {
        ...longer,
        start: bestPrior.end,
        days: daysBetween(bestPrior.end, longer.end),
        val: longer.val - bestPrior.val,
        fp: longer.days >= 330 ? "Q4" : longer.fp || "Q",
      });
    }
  }

  return byEnd;
}

function buildAnnualFlowMap(facts: NormalizedFlowFact[]): Map<string, NormalizedFlowFact> {
  const byEnd = new Map<string, NormalizedFlowFact>();
  for (const f of facts) {
    if (f.days < 330 || f.days > 395) continue;
    if (f.form !== "10-K" && f.form !== "10-K/A" && f.form !== "20-F" && f.form !== "20-F/A") continue;
    const prev = byEnd.get(f.end);
    if (!prev || f.priority < prev.priority || (f.priority === prev.priority && f.filed >= prev.filed)) {
      byEnd.set(f.end, f);
    }
  }
  return byEnd;
}

function computePeriodRatios(period: FundamentalsPeriod, isAnnual: boolean): FundamentalsPeriod {
  const rev = period.revenue_m ?? null;
  let gp = period.gross_profit_m ?? null;
  let cogs = period.cogs_m ?? null;

  if (gp === null && rev !== null && cogs !== null) {
    gp = round(rev - cogs, 2);
  }
  if (cogs === null && rev !== null && gp !== null && rev >= gp) {
    cogs = round(rev - gp, 2);
  }

  const opInc = period.operating_income_m ?? null;
  const ni = period.net_income_m ?? null;
  const ocf = period.ocf_m ?? null;
  const capex = period.capex_m ?? null;
  const fcf = period.fcf_m ?? (ocf !== null && capex !== null ? round(ocf - capex, 2) : null);
  const sbc = period.sbc_m ?? null;
  const ar = period.accounts_receivable_m ?? null;
  const inv = period.inventory_m ?? null;
  const cash = period.cash_and_st_inv_m ?? null;
  const debt = period.total_debt_m ?? null;
  const shares = period.diluted_shares_m ?? null;
  const eps =
    period.eps_diluted ??
    (ni !== null && shares !== null && shares > 0 ? round(ni / shares, 2) : null);

  const daysBasis = isAnnual ? 365 : 91.25;
  const grossMarginPct = rev !== null && rev > 0 && gp !== null ? round((gp / rev) * 100, 2) : null;
  const operatingMarginPct = rev !== null && rev > 0 && opInc !== null ? round((opInc / rev) * 100, 2) : null;
  const fcfMarginPct = rev !== null && rev > 0 && fcf !== null ? round((fcf / rev) * 100, 2) : null;
  const ocfToNiPct = ni !== null && ni > 0 && ocf !== null ? round((ocf / ni) * 100, 2) : null;
  const sbcPctRev = rev !== null && rev > 0 && sbc !== null ? round((sbc / rev) * 100, 2) : null;
  const dsoDays = rev !== null && rev > 0 && ar !== null ? round((ar / rev) * daysBasis, 1) : null;
  const dioDays = cogs !== null && cogs > 0 && inv !== null ? round((inv / cogs) * daysBasis, 1) : null;
  const netCashB = cash !== null ? round((cash - (debt ?? 0)) / 1000, 3) : null;

  return {
    ...period,
    gross_profit_m: gp,
    cogs_m: cogs,
    fcf_m: fcf,
    eps_diluted: eps,
    net_cash_b: netCashB,
    gross_margin_pct: grossMarginPct,
    operating_margin_pct: operatingMarginPct,
    fcf_margin_pct: fcfMarginPct,
    ocf_to_ni_pct: ocfToNiPct,
    sbc_pct_rev: sbcPctRev,
    dso_days: dsoDays,
    dio_days: dioDays,
  };
}

function deriveLatestRatios(
  quarterly: FundamentalsPeriod[],
  annual: FundamentalsPeriod[],
  overrides?: Record<string, number | string | null>,
): FundamentalsRatios {
  const latest = quarterly[0] ?? annual[0] ?? null;

  // Diluted shares YoY%
  let dilutedSharesYoyPct: number | null = null;
  if (quarterly.length >= 2 && quarterly[0]?.diluted_shares_m) {
    const latestMs = Date.parse(`${quarterly[0].period_end}T00:00:00Z`);
    const yearAgo = quarterly.find((q, idx) => {
      if (idx === 0 || !q.diluted_shares_m) return false;
      const diff = (latestMs - Date.parse(`${q.period_end}T00:00:00Z`)) / MS_PER_DAY;
      return diff >= 320 && diff <= 410;
    });
    if (yearAgo?.diluted_shares_m && yearAgo.diluted_shares_m > 0) {
      dilutedSharesYoyPct = round(
        ((quarterly[0].diluted_shares_m - yearAgo.diluted_shares_m) / yearAgo.diluted_shares_m) * 100,
        2,
      );
    }
  }
  if (dilutedSharesYoyPct === null && annual.length >= 2 && annual[0]?.diluted_shares_m && annual[1]?.diluted_shares_m) {
    dilutedSharesYoyPct = round(
      ((annual[0].diluted_shares_m - annual[1].diluted_shares_m) / annual[1].diluted_shares_m) * 100,
      2,
    );
  }

  // TTM per-share metrics
  let ttmEps: number | null = null;
  let ttmFcfPerShare: number | null = null;
  let ttmRevPerShare: number | null = null;

  if (quarterly.length >= 4) {
    const q4 = quarterly.slice(0, 4);
    const shares = q4[0]?.diluted_shares_m ?? annual[0]?.diluted_shares_m ?? null;

    if (q4.every((q) => typeof q.eps_diluted === "number")) {
      ttmEps = round(q4.reduce((acc, q) => acc + (q.eps_diluted ?? 0), 0), 2);
    } else if (shares && shares > 0 && q4.every((q) => typeof q.net_income_m === "number")) {
      const ttmNi = q4.reduce((acc, q) => acc + (q.net_income_m ?? 0), 0);
      ttmEps = round(ttmNi / shares, 2);
    }

    if (shares && shares > 0 && q4.every((q) => typeof q.fcf_m === "number")) {
      const ttmFcf = q4.reduce((acc, q) => acc + (q.fcf_m ?? 0), 0);
      ttmFcfPerShare = round(ttmFcf / shares, 2);
    }

    if (shares && shares > 0 && q4.every((q) => typeof q.revenue_m === "number")) {
      const ttmRev = q4.reduce((acc, q) => acc + (q.revenue_m ?? 0), 0);
      ttmRevPerShare = round(ttmRev / shares, 2);
    }
  } else if (annual[0]) {
    const fy = annual[0];
    const shares = fy.diluted_shares_m ?? null;
    ttmEps = fy.eps_diluted ?? null;
    if (shares && shares > 0) {
      ttmFcfPerShare = fy.fcf_m != null ? round(fy.fcf_m / shares, 2) : null;
      ttmRevPerShare = fy.revenue_m != null ? round(fy.revenue_m / shares, 2) : null;
    }
  }

  const ratios: FundamentalsRatios = {
    gross_margin_pct: latest?.gross_margin_pct ?? null,
    operating_margin_pct: latest?.operating_margin_pct ?? null,
    dso_days: latest?.dso_days ?? null,
    dio_days: latest?.dio_days ?? null,
    ocf_to_ni_pct: latest?.ocf_to_ni_pct ?? null,
    fcf_margin_pct: latest?.fcf_margin_pct ?? null,
    sbc_pct_rev: latest?.sbc_pct_rev ?? null,
    net_cash_b: latest?.net_cash_b ?? null,
    diluted_shares_yoy_pct: dilutedSharesYoyPct,
    ttm_eps: ttmEps,
    ttm_fcf_per_share: ttmFcfPerShare,
    ttm_rev_per_share: ttmRevPerShare,
  };

  if (overrides) {
    const numericKeys: Array<keyof FundamentalsRatios> = [
      "gross_margin_pct",
      "operating_margin_pct",
      "dso_days",
      "dio_days",
      "ocf_to_ni_pct",
      "fcf_margin_pct",
      "sbc_pct_rev",
      "net_cash_b",
      "diluted_shares_yoy_pct",
      "ttm_eps",
      "ttm_fcf_per_share",
      "ttm_rev_per_share",
    ];
    for (const k of numericKeys) {
      const ov = overrides[k];
      if (typeof ov === "number" && Number.isFinite(ov)) {
        ratios[k] = ov;
      }
    }
  }

  return ratios;
}

export function parseCompanyFactsToFundamentals(
  ticker: string,
  payload: SecCompanyFactsPayload,
  opts?: {
    cik?: string | null;
    nowIso?: string;
    existingOverrides?: Record<string, number | string | null>;
  },
): DossierFundamentals {
  const sym = normalizeTicker(ticker);
  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const currency = detectPrimaryCurrency(payload);
  const ccyMatcher = (u: string) => u === currency;
  const shareMatcher = (u: string) => u === "shares";
  const epsMatcher = (u: string) => u === `${currency}/shares` || u.endsWith("/shares");

  const revFacts = collectFlowFacts(payload, REVENUE_CONCEPTS, ccyMatcher);
  const cogsFacts = collectFlowFacts(payload, COGS_CONCEPTS, ccyMatcher);
  const gpFacts = collectFlowFacts(payload, GROSS_PROFIT_CONCEPTS, ccyMatcher);
  const opFacts = collectFlowFacts(payload, OP_INCOME_CONCEPTS, ccyMatcher);
  const niFacts = collectFlowFacts(payload, NET_INCOME_CONCEPTS, ccyMatcher);
  const ocfFacts = collectFlowFacts(payload, OCF_CONCEPTS, ccyMatcher);
  const capexFacts = collectFlowFacts(payload, CAPEX_CONCEPTS, ccyMatcher);
  const sbcFacts = collectFlowFacts(payload, SBC_CONCEPTS, ccyMatcher);
  const shareFlowFacts = collectFlowFacts(payload, DILUTED_SHARES_CONCEPTS, shareMatcher);
  const epsFacts = collectFlowFacts(payload, EPS_DILUTED_CONCEPTS, epsMatcher);

  const instantShares = collectInstantFacts(payload, INSTANT_SHARES_CONCEPTS, shareMatcher);
  const arInstants = collectInstantFacts(payload, AR_CONCEPTS, ccyMatcher);
  const invInstants = collectInstantFacts(payload, INVENTORY_CONCEPTS, ccyMatcher);
  const cashCombinedInstants = collectInstantFacts(payload, CASH_COMBINED_CONCEPTS, ccyMatcher);
  const cashOnlyInstants = collectInstantFacts(payload, CASH_ONLY_CONCEPTS, ccyMatcher);
  const stInvInstants = collectInstantFacts(payload, ST_INVESTMENTS_CONCEPTS, ccyMatcher);
  const ltDebtInstants = collectInstantFacts(payload, LT_DEBT_NONCURRENT_CONCEPTS, ccyMatcher);
  const stDebtInstants = collectInstantFacts(payload, ST_DEBT_CONCEPTS, ccyMatcher);

  const qRev = buildQuarterlyFlowMap(revFacts, true);
  const qCogs = buildQuarterlyFlowMap(cogsFacts, true);
  const qGp = buildQuarterlyFlowMap(gpFacts, true);
  const qOp = buildQuarterlyFlowMap(opFacts, true);
  const qNi = buildQuarterlyFlowMap(niFacts, true);
  const qOcf = buildQuarterlyFlowMap(ocfFacts, true);
  const qCapex = buildQuarterlyFlowMap(capexFacts, true);
  const qSbc = buildQuarterlyFlowMap(sbcFacts, true);
  const qShares = buildQuarterlyFlowMap(shareFlowFacts, false);
  const qEps = buildQuarterlyFlowMap(epsFacts, true);

  const aRev = buildAnnualFlowMap(revFacts);
  const aCogs = buildAnnualFlowMap(cogsFacts);
  const aGp = buildAnnualFlowMap(gpFacts);
  const aOp = buildAnnualFlowMap(opFacts);
  const aNi = buildAnnualFlowMap(niFacts);
  const aOcf = buildAnnualFlowMap(ocfFacts);
  const aCapex = buildAnnualFlowMap(capexFacts);
  const aSbc = buildAnnualFlowMap(sbcFacts);
  const aShares = buildAnnualFlowMap(shareFlowFacts);
  const aEps = buildAnnualFlowMap(epsFacts);

  const toM = (val: number | null | undefined): number | null =>
    typeof val === "number" && Number.isFinite(val) ? round(val / 1e6, 2) : null;

  const toSharesM = (val: number | null | undefined): number | null => {
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return null;
    const millions = round(val / 1e6, 4);
    return millions > 0 ? millions : null;
  };

  const resolveCashM = (periodEnd: string): number | null => {
    const comb = findInstantNear(cashCombinedInstants, periodEnd);
    if (comb !== null) return toM(comb);
    const cashOnly = findInstantNear(cashOnlyInstants, periodEnd);
    const stInv = findInstantNear(stInvInstants, periodEnd);
    if (cashOnly === null && stInv === null) return null;
    return toM((cashOnly ?? 0) + (stInv ?? 0));
  };

  const resolveDebtM = (periodEnd: string): number | null => {
    const lt = findInstantNear(ltDebtInstants, periodEnd);
    const st = findInstantNear(stDebtInstants, periodEnd);
    if (lt === null && st === null) return null;
    return toM((lt ?? 0) + (st ?? 0));
  };

  const qDates = Array.from(new Set([...qRev.keys(), ...qNi.keys(), ...qOcf.keys()])).sort((a, b) =>
    b.localeCompare(a),
  );

  const quarterly: FundamentalsPeriod[] = qDates.slice(0, 16).map((periodEnd) => {
    const anchor = qRev.get(periodEnd) ?? qNi.get(periodEnd) ?? qOcf.get(periodEnd)!;
    const rawCapex = qCapex.get(periodEnd)?.val;
    const rawShares =
      qShares.get(periodEnd)?.val ?? aShares.get(periodEnd)?.val ?? findInstantNear(instantShares, periodEnd);
    const base: FundamentalsPeriod = {
      period_end: periodEnd,
      filed_date: anchor.filed,
      fiscal_year: anchor.fy,
      fiscal_period: anchor.fp && anchor.fp !== "FY" ? anchor.fp : "Q4",
      form: anchor.form,
      accession: anchor.accn || undefined,
      revenue_m: toM(qRev.get(periodEnd)?.val),
      gross_profit_m: toM(qGp.get(periodEnd)?.val),
      operating_income_m: toM(qOp.get(periodEnd)?.val),
      net_income_m: toM(qNi.get(periodEnd)?.val),
      ocf_m: toM(qOcf.get(periodEnd)?.val),
      capex_m: typeof rawCapex === "number" ? toM(Math.abs(rawCapex)) : null,
      sbc_m: toM(qSbc.get(periodEnd)?.val),
      diluted_shares_m: toSharesM(rawShares),
      eps_diluted: typeof qEps.get(periodEnd)?.val === "number" ? round(qEps.get(periodEnd)!.val, 2) : null,
      accounts_receivable_m: toM(findInstantNear(arInstants, periodEnd)),
      inventory_m: toM(findInstantNear(invInstants, periodEnd)),
      cogs_m: toM(qCogs.get(periodEnd)?.val),
      cash_and_st_inv_m: resolveCashM(periodEnd),
      total_debt_m: resolveDebtM(periodEnd),
    };
    return computePeriodRatios(base, false);
  });

  const aDates = Array.from(new Set([...aRev.keys(), ...aNi.keys(), ...aOcf.keys()])).sort((a, b) =>
    b.localeCompare(a),
  );

  const annual: FundamentalsPeriod[] = aDates.slice(0, 5).map((periodEnd) => {
    const anchor = aRev.get(periodEnd) ?? aNi.get(periodEnd) ?? aOcf.get(periodEnd)!;
    const rawCapex = aCapex.get(periodEnd)?.val;
    const rawShares = aShares.get(periodEnd)?.val ?? findInstantNear(instantShares, periodEnd);
    const base: FundamentalsPeriod = {
      period_end: periodEnd,
      filed_date: anchor.filed,
      fiscal_year: anchor.fy,
      fiscal_period: "FY",
      form: anchor.form,
      accession: anchor.accn || undefined,
      revenue_m: toM(aRev.get(periodEnd)?.val),
      gross_profit_m: toM(aGp.get(periodEnd)?.val),
      operating_income_m: toM(aOp.get(periodEnd)?.val),
      net_income_m: toM(aNi.get(periodEnd)?.val),
      ocf_m: toM(aOcf.get(periodEnd)?.val),
      capex_m: typeof rawCapex === "number" ? toM(Math.abs(rawCapex)) : null,
      sbc_m: toM(aSbc.get(periodEnd)?.val),
      diluted_shares_m: toSharesM(rawShares),
      eps_diluted: typeof aEps.get(periodEnd)?.val === "number" ? round(aEps.get(periodEnd)!.val, 2) : null,
      accounts_receivable_m: toM(findInstantNear(arInstants, periodEnd)),
      inventory_m: toM(findInstantNear(invInstants, periodEnd)),
      cogs_m: toM(aCogs.get(periodEnd)?.val),
      cash_and_st_inv_m: resolveCashM(periodEnd),
      total_debt_m: resolveDebtM(periodEnd),
    };
    return computePeriodRatios(base, true);
  });

  const latestPeriodicAccn = quarterly[0]?.accession ?? annual[0]?.accession ?? null;
  const cikStr =
    opts?.cik ??
    (payload.cik !== undefined && payload.cik !== null ? String(payload.cik).padStart(10, "0") : null);
  const hasOverrides = opts?.existingOverrides && Object.keys(opts.existingOverrides).length > 0;
  const latestRatios = deriveLatestRatios(quarterly, annual, opts?.existingOverrides);

  return FundamentalsSchema.parse({
    ticker: sym,
    cik: cikStr,
    updated_at: nowIso,
    source: hasOverrides ? "hybrid" : "sec_xbrl",
    currency,
    latest_periodic_accession: latestPeriodicAccn,
    quarterly,
    annual,
    latest_ratios: latestRatios,
    ...(hasOverrides ? { overrides: opts.existingOverrides } : {}),
  });
}

export interface SyncXbrlOptions {
  force?: boolean;
  maxAgeMs?: number;
  nowIso?: string;
  edgarFilingsByTicker?: Record<string, EdgarFilingRow[]>;
  fetchImpl?: typeof fetch;
}

export interface SyncXbrlResult {
  updated: string[];
  cached: string[];
  skipped: string[];
  errors: Array<{ ticker: string; error: string }>;
  byTicker: Record<string, DossierFundamentals>;
}

export async function syncFundamentalsXbrl(
  dataDir: string,
  profile: UserProfile,
  tickers: string[],
  opts?: SyncXbrlOptions,
): Promise<SyncXbrlResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_XBRL_MAX_AGE_MS;
  const ua = resolveSecUserAgent(profile);
  const tickerMap = await loadSecTickerMap(dataDir, ua, fetchImpl);

  const updated: string[] = [];
  const cached: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];
  const byTicker: Record<string, DossierFundamentals> = {};

  const uniqueTargets = Array.from(new Set(tickers.map((t) => normalizeTicker(t))));
  let fetchCount = 0;

  for (const sym of uniqueTargets) {
    const cik = tickerMap.get(sym);
    if (!cik) {
      skipped.push(sym);
      continue;
    }

    let existing: DossierFundamentals | null = null;
    try {
      existing = loadDossierFundamentals(dataDir, sym);
    } catch {
      existing = null;
    }

    if (!opts?.force && existing) {
      const updatedMs = Date.parse(existing.updated_at);
      const isFresh = Number.isFinite(updatedMs) && nowMs - updatedMs < maxAgeMs;
      const latestEdgarPeriodic = (opts?.edgarFilingsByTicker?.[sym] ?? []).find((f) =>
        PERIODIC_FORMS.has(f.form.toUpperCase()),
      );
      const hasNewerPeriodic =
        Boolean(latestEdgarPeriodic?.accession) &&
        latestEdgarPeriodic!.accession !== existing.latest_periodic_accession;

      if (isFresh && !hasNewerPeriodic) {
        cached.push(sym);
        byTicker[sym] = existing;
        continue;
      }
    }

    if (fetchCount > 0) await sleepMs(SEC_PACING_MS);
    fetchCount += 1;

    try {
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      const resp = await fetchImpl(url, {
        headers: { "User-Agent": ua, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        throw new Error(`SEC XBRL companyfacts fetch failed (${resp.status}) for ${sym} (CIK ${cik})`);
      }
      const payload = (await resp.json()) as SecCompanyFactsPayload;
      const parsed = parseCompanyFactsToFundamentals(sym, payload, {
        cik,
        nowIso,
        existingOverrides: existing?.overrides,
      });
      const saved = saveDossierFundamentals(dataDir, sym, parsed);
      updated.push(sym);
      byTicker[sym] = saved;
    } catch (err) {
      errors.push({ ticker: sym, error: err instanceof Error ? err.message : String(err) });
      if (existing) {
        byTicker[sym] = existing;
      }
    }
  }

  return { updated, cached, skipped, errors, byTicker };
}
