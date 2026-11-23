import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

interface RiskCapRule {
  id: string;
  label: string;
  kind: string;
  cap_pct: number;
  ticker?: string;
  tickers?: string[];
}

interface UserProfile {
  base_currency: string;
  timezone: string;
  custody_label: string;
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

interface ThesisRow {
  ticker: string;
  yf_symbol: string;
  currency: string;
  role: string;
  us_situs: boolean;
  price: number | null;
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
    reserve_shortfall_base: number;
    ext_total_base: number;
    ext_pct_wealth: number;
    ext_portfolio_base: number;
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
}

type TabId = "overview" | "holdings" | "theses" | "edgar";
type SortKey = "ticker" | "mv_base" | "weight_nav_pct" | "pnl_pct" | "change_1d_pct";
type HoldingsMode = "positions" | "lookthrough";
type ThesisFilter = "all" | "buy" | "gated" | "trim" | "hold";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings Desk" },
  { id: "theses", label: "Theses & Triggers" },
  { id: "edgar", label: "Catalysts & SEC" },
];

const SLICE_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
  "#64748b",
  "#a1a1aa",
];

const app = new App({ name: "Investment OS", version: "0.2.0" }, {});
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
let thesisFilter: ThesisFilter = "all";
let simExtBase = 0;
let simReserveBase = 0;
let inspectorTicker: string | null = null;
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

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
}

function fmtDeltaChip(pct: number | null | undefined, suffix = ""): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return `<span class="chip muted">—</span>`;
  }
  const cls = pct > 0.01 ? "ok" : pct < -0.01 ? "bad" : "muted";
  const arrow = pct > 0.01 ? "▲ +" : pct < -0.01 ? "▼ " : "";
  return `<span class="chip ${cls}">${arrow}${pct.toFixed(2)}%${suffix ? ` ${esc(suffix)}` : ""}</span>`;
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

function statusChip(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("BUY")) return `<span class="chip ok">● ${esc(status)}</span>`;
  if (s.includes("TRIM") || s.includes("EXIT")) return `<span class="chip bad">▲ ${esc(status)}</span>`;
  if (s.includes("GATE") || s.includes("DEEP")) return `<span class="chip warn">■ ${esc(status)}</span>`;
  return `<span class="chip muted">${esc(status)}</span>`;
}

function daysUntilLabel(isoDate: string): { label: string; cls: string } {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(target)) return { label: isoDate, cls: "muted" };
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((target - todayUtc) / 86_400_000);
  if (diffDays === 0) return { label: "Today", cls: "bad" };
  if (diffDays > 0 && diffDays <= 14) return { label: `In ${diffDays}d`, cls: "warn" };
  if (diffDays > 14) return { label: `In ${diffDays}d`, cls: "accent" };
  return { label: `${Math.abs(diffDays)}d ago`, cls: "muted" };
}

function renderSparklineSvg(
  points: number[],
  opts: { width: number; height: number; positive?: boolean | null; fillArea?: boolean; label: string },
): string {
  const { width, height, positive, fillArea, label } = opts;
  if (!points || points.length < 2) {
    const midY = (height / 2).toFixed(1);
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}: No 30-day trend cached"><line x1="2" y1="${midY}" x2="${width - 2}" y2="${midY}" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5" stroke-dasharray="3 3" /></svg>`;
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
  const last = coords[coords.length - 1];
  const inferredUp = positive ?? points[points.length - 1] >= points[0];
  const colorVar = inferredUp ? "var(--ok)" : "var(--bad)";
  svgIdSeq += 1;
  const gradId = `sg-${svgIdSeq}`;

  const areaEl = fillArea
    ? `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${colorVar}" stop-opacity="0.28"/><stop offset="100%" stop-color="${colorVar}" stop-opacity="0"/></linearGradient></defs><path d="${linePath} L${last[0]} ${height} L${coords[0][0]} ${height} Z" fill="url(#${gradId})" />`
    : "";

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${areaEl}<path d="${linePath}" fill="none" stroke="${colorVar}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" /><circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="${colorVar}" /></svg>`;
}

interface DonutSegment {
  label: string;
  ticker: string | null;
  pct: number;
  valueBase: number;
  color: string;
}

function renderDonutSvg(segments: DonutSegment[], centerTop: string, centerBottom: string): string {
  const size = 144;
  const cx = 72;
  const cy = 72;
  const r = 52;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  const circles = segments
    .filter((s) => s.pct > 0.2)
    .map((s) => {
      const sliceLen = (s.pct / 100) * circ;
      const visibleLen = Math.max(1.5, sliceLen - 2);
      const curOffset = offset;
      offset += sliceLen;
      const attr = s.ticker ? `data-inspect-ticker="${esc(s.ticker)}" style="cursor:pointer"` : "";
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="17" stroke-dasharray="${visibleLen.toFixed(2)} ${(circ - visibleLen).toFixed(2)}" stroke-dashoffset="${(-curOffset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" ${attr}><title>${esc(s.label)}: ${s.pct.toFixed(1)}%</title></circle>`;
    })
    .join("");

  return `
    <div class="donut-svg-box">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Portfolio Allocation Ring: ${esc(centerBottom)} ${esc(centerTop)}">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-inset)" stroke-width="17" />
        ${circles}
      </svg>
      <div class="donut-center">
        <span class="micro-label">${esc(centerTop)}</span>
        <span class="donut-center-val">${esc(centerBottom)}</span>
      </div>
    </div>
  `;
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
    color: SLICE_PALETTE[idx % (SLICE_PALETTE.length - 2)],
  }));
  if (rest.length > 0) {
    const restPct = rest.reduce((s, p) => s + p.weight_nav_pct, 0);
    const restBase = rest.reduce((s, p) => s + p.mv_base, 0);
    segments.push({
      label: `Other (${rest.length})`,
      ticker: null,
      pct: restPct,
      valueBase: restBase,
      color: SLICE_PALETTE[6],
    });
  }
  if (data.portfolio.cash_pct > 0.1) {
    segments.push({
      label: "Cash",
      ticker: null,
      pct: data.portfolio.cash_pct,
      valueBase: data.portfolio.cash_base,
      color: SLICE_PALETTE[7],
    });
  }
  return segments;
}

function ingestPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as DashboardPayload;
  if (!p.profile || !p.portfolio) return;
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
  render();
  if (inspectorTicker) {
    const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
    if (dlg?.open) {
      renderInspectorDialog(inspectorTicker);
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
      <p>No local portfolio is configured yet. All holdings, tax settings, and investment theses stay strictly private on your machine inside <code>\${PLUGIN_DATA}</code>.</p>
      <ul class="onboarding-points">
        <li>Supports any base reporting currency, multi-currency holdings, and ETF look-through weights.</li>
        <li>Read-only by architecture: connects alongside broker MCPs (such as IBKR) or manual imports with zero trading tools.</li>
        <li>Click any ticker in the Finance Hub to inspect 30-day charts, trigger rulers, kill-switches, and SEC filings.</li>
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
  const reserve = data.profile.liquidity_reserve;
  const segments = buildAllocationSegments(data);

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

  const vixSvg = renderSparklineSvg(data.vix_sparkline, {
    width: 68,
    height: 22,
    positive: data.vix !== null && data.vix < 25,
    label: "VIX 30-day trend",
  });

  const allocStripHtml = segments
    .map(
      (s) =>
        `<button type="button" class="alloc-seg" style="--seg-color:${s.color};background:${s.color};flex:${Math.max(1.5, s.pct).toFixed(2)} 1 0%" ${s.ticker ? `data-inspect-ticker="${esc(s.ticker)}"` : ""} title="${esc(s.label)} (${fmtPct(s.pct)})" aria-label="${esc(s.label)} ${fmtPct(s.pct)}"></button>`,
    )
    .join("");

  const allocMiniLegend = segments
    .slice(0, 7)
    .map(
      (s) =>
        `<button type="button" class="alloc-tag" ${s.ticker ? `data-inspect-ticker="${esc(s.ticker)}"` : "disabled"}><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span><strong>${fmtPct(s.pct)}</strong></button>`,
    )
    .join("");

  const thirdHeroLabel = data.summary.us_situs_enabled
    ? "Est. US NRA Estate Tax"
    : ext.enabled
      ? `${ext.ticker || "External"} % Wealth`
      : "Invested Holdings";
  const thirdHeroVal = data.summary.us_situs_enabled
    ? fmtMoney(sim.estateTaxBase, ccy)
    : ext.enabled
      ? fmtPct(sim.extPct)
      : fmtMoney(data.portfolio.positions_base, ccy);
  const thirdHeroSub = data.summary.us_situs_enabled
    ? `${sim.marginalPct.toFixed(0)}% marginal · UCITS swap saves ${fmtMoney(sim.ucitsSavingsBase, ccy)}`
    : ext.enabled
      ? `${ext.label} ${fmtMoney(simExtBase, ccy)}`
      : `${data.portfolio.positions.length} active positions`;

  const fourthHeroLabel = ext.enabled && data.summary.primary_bucket_label
    ? `${data.summary.primary_bucket_label} (TW)`
    : "Cash & FX";
  const fourthHeroVal = ext.enabled && data.summary.primary_bucket_label
    ? fmtPct(sim.primaryBucketPct)
    : `${fmtMoney(data.portfolio.cash_base, ccy)}`;
  const fourthHeroSub = ext.enabled && data.summary.primary_bucket_label
    ? `Portfolio: ${fmtPct(data.summary.primary_bucket_portfolio_pct)}`
    : `${ccy !== "USD" ? `USD/${ccy} ${data.usd_to_base_fx.toFixed(4)} · ` : ""}${fmtPct(data.portfolio.cash_pct)} cash`;

  const legendHtml = segments
    .map(
      (s) => `
      <button type="button" class="legend-btn" ${s.ticker ? `data-inspect-ticker="${esc(s.ticker)}"` : "disabled"}>
        <span class="legend-left"><span class="swatch" style="background:${s.color}"></span><span>${esc(s.label)}</span></span>
        <span class="legend-right">${fmtPct(s.pct)} · ${fmtCompact(s.valueBase, ccy)}</span>
      </button>
    `,
    )
    .join("");

  const maxLtPct = Math.max(1, ...data.lookthrough.slice(0, 8).map((r) => r.pct_nav));
  const ltBarsHtml = data.lookthrough.slice(0, 8).map((r) => {
    const dirShare = r.total_usd > 0 ? (r.direct_usd / r.total_usd) * 100 : 0;
    const etfShare = 100 - dirShare;
    const widthPct = (r.pct_nav / maxLtPct) * 100;
    const clickTicker = r.name.includes("/") ? r.name.split("/")[0] : r.name;
    return `
      <button type="button" class="lt-btn" data-inspect-ticker="${esc(clickTicker)}">
        <div class="lt-head">
          <span><strong>${esc(r.name)}</strong> ${r.via_etfs_usd > 0 ? `<span class="muted-sub">(Direct ${fmtMoney(r.direct_usd, "USD", 0)} + ETF ${fmtMoney(r.via_etfs_usd, "USD", 0)})</span>` : ""}</span>
          <span><strong>${fmtPct(r.pct_nav, 2)}</strong> · ${fmtCompact(r.total_base, ccy)}</span>
        </div>
        <div class="lt-track">
          <div class="lt-direct" style="width:${((widthPct * dirShare) / 100).toFixed(1)}%"></div>
          <div class="lt-etf" style="width:${((widthPct * etfShare) / 100).toFixed(1)}%"></div>
        </div>
      </button>
    `;
  }).join("");

  const capHtml = data.risk_caps.length
    ? data.risk_caps
        .map((c) => {
          const maxScale = Math.max(c.cap_pct * 1.4, c.value_pct, 1);
          const fillPct = Math.min(100, (c.value_pct / maxScale) * 100);
          const capPos = Math.min(98, (c.cap_pct / maxScale) * 100);
          const isPass = c.status === "PASS";
          const delta = c.value_pct - c.cap_pct;
          const badge = isPass
            ? `<span class="chip ok">✓ PASS</span>`
            : `<span class="chip bad">▲ OVER +${delta.toFixed(1)}%</span>`;
          const capRule = data.profile.risk_caps.find((r) => r.id === c.id);
          const inspAttr = capRule?.kind === "ticker" && capRule.ticker ? `data-inspect-ticker="${esc(capRule.ticker)}"` : "";
          return `
            <div class="cap-row ${inspAttr ? "clickable" : ""}" ${inspAttr}>
              <div class="cap-head">
                <span>${esc(c.label)}</span>
                <span><strong>${fmtPct(c.value_pct)}</strong> <span class="muted-sub">/ ${fmtPct(c.cap_pct)}</span> ${badge}</span>
              </div>
              <div class="cap-meter" aria-label="${esc(c.label)}: ${c.value_pct}% of ${c.cap_pct}% cap (${c.status})">
                <div class="cap-fill ${isPass ? "pass" : "breach"}" style="width:${fillPct.toFixed(1)}%"></div>
                <div class="cap-limit-tick" style="left:${capPos.toFixed(1)}%" title="Cap ${c.cap_pct}%"></div>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="muted-sub">No risk cap rules configured in profile.yaml yet.</div>`;

  const showSim = ext.enabled || reserve.enabled;
  const extMax = Math.max(500000, Math.ceil((Math.max(simExtBase, 1) * 2) / 50000) * 50000);
  const resMax = Math.max(200000, Math.ceil((Math.max(simReserveBase, 1) * 2) / 25000) * 25000);
  const hasPaired = Boolean(ext.enabled && ext.paired_tickers && ext.paired_tickers.length > 0);
  const extPresets = [0, 100000, Math.round(extMax * 0.4), Math.round(extMax * 0.7)].filter((v, i, a) => a.indexOf(v) === i);
  const resPresets = [0, 30000, 100000, Math.round(resMax * 0.75)].filter((v, i, a) => a.indexOf(v) === i);

  const simSection = showSim
    ? `
      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">Outside Wealth &amp; Liquidity Stress-Tester</h2>
            <div class="muted-sub">Drag sliders or tap presets to model concentration, cash runway, and estate tax.</div>
          </div>
          <button type="button" class="primary small" id="btn-save-ext" ${data.is_demo ? "disabled" : ""}>Save Assumptions</button>
        </div>
        <div class="sim-grid">
          ${
            ext.enabled
              ? `
            <div class="sim-field">
              <label for="sim-ext"><span>${esc(ext.label)}</span><span id="sim-ext-lbl">${fmtMoney(simExtBase, ccy)}</span></label>
              <input id="sim-ext" type="range" min="0" max="${extMax}" step="${Math.round(extMax / 40)}" value="${simExtBase}" />
              <div class="preset-row">
                ${extPresets.map((v) => `<button type="button" class="small" data-preset-ext="${v}">${fmtCompact(v, ccy)}</button>`).join("")}
              </div>
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
              <div class="preset-row">
                ${resPresets.map((v) => `<button type="button" class="small" data-preset-res="${v}">${fmtCompact(v, ccy)}</button>`).join("")}
              </div>
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
      </div>
    `
    : "";

  return `
    <div class="panel-body">
      <section class="hero-card" aria-label="Portfolio summary">
        <div class="hero-top">
          <div>
            <div class="micro-label">${esc(heroLabel)}</div>
            <div class="hero-nav-row">
              <div class="hero-nav">${fmtMoney(heroVal, ccy)}</div>
              ${fmtDeltaChip(data.portfolio.total_unrealized_pnl_pct, "Unrealized P&L")}
            </div>
            <div class="muted-sub" style="margin-top:3px">
              ${ccy !== "USD" ? `${fmtMoney(data.portfolio.nav_usd, "USD", 0)} IBKR · USD/${ccy} ${data.usd_to_base_fx.toFixed(4)}` : `${fmtMoney(data.portfolio.positions_base, ccy)} invested`}
              ${data.stale_tickers.length > 0 ? ` · Stale: ${esc(data.stale_tickers.join(", "))}` : ""}
            </div>
          </div>
          <div class="hero-right">
            ${heroModeBtns}
            <div class="pulse-chip" title="CBOE Volatility Index (30D)">
              <div>
                <div class="micro-label">VIX</div>
                <div class="metric-val">${data.vix !== null ? data.vix.toFixed(2) : "Snap"}</div>
              </div>
              ${vixSvg}
            </div>
          </div>
        </div>

        <div class="alloc-wrap">
          <div class="alloc-strip" role="group" aria-label="Top holdings allocation strip">${allocStripHtml}</div>
          <div class="alloc-legend-mini">${allocMiniLegend}</div>
        </div>

        <div class="hero-metrics-bar">
          <div class="metric-cell">
            <span class="micro-label">Liquid Cash</span>
            <span class="metric-val">${fmtMoney(data.portfolio.cash_base, ccy)}</span>
            <span class="muted-sub">${fmtPct(data.portfolio.cash_pct)} of NAV</span>
          </div>
          <div class="metric-cell">
            <span class="micro-label">Unrealized Cost Delta</span>
            <span class="metric-val ${data.portfolio.total_unrealized_pnl_usd >= 0 ? "pos-ok" : "pos-bad"}">${data.portfolio.total_unrealized_pnl_usd >= 0 ? "+" : ""}${fmtMoney(data.portfolio.total_unrealized_pnl_usd, "USD", 0)}</span>
            <span class="muted-sub">USD cost basis delta</span>
          </div>
          <div class="metric-cell">
            <span class="micro-label">${esc(thirdHeroLabel)}</span>
            <span class="metric-val ${data.summary.us_situs_enabled ? "pos-bad" : ""}">${esc(thirdHeroVal)}</span>
            <span class="muted-sub">${esc(thirdHeroSub)}</span>
          </div>
          <div class="metric-cell">
            <span class="micro-label">${esc(fourthHeroLabel)}</span>
            <span class="metric-val">${esc(fourthHeroVal)}</span>
            <span class="muted-sub">${esc(fourthHeroSub)}</span>
          </div>
        </div>
      </section>

      <div class="hub-grid">
        <div class="card">
          <div class="section-head">
            <h2 class="section-title">Portfolio Allocation Ring</h2>
            <span class="muted-sub">Click slice to inspect</span>
          </div>
          <div class="donut-layout">
            ${renderDonutSvg(segments, `${data.portfolio.positions.length} Positions`, fmtCompact(data.portfolio.nav_base, ccy))}
            <div class="donut-legend">${legendHtml}</div>
          </div>
        </div>

        <div class="card">
          <div class="section-head">
            <h2 class="section-title">True Look-Through Top Exposure</h2>
            <span class="muted-sub"><span class="chip accent">Direct</span> + <span class="chip muted">Via ETF</span></span>
          </div>
          <div class="lt-list">${ltBarsHtml}</div>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <h2 class="section-title">Risk Guardrails (Look-Through Audit)</h2>
          <span class="muted-sub">Vertical marker denotes cap limit</span>
        </div>
        <div class="cap-list">${capHtml}</div>
      </div>

      ${simSection}
    </div>
  `;
}

function renderHoldings(data: DashboardPayload): string {
  const ccy = data.base_currency;
  const showSitus = data.summary.us_situs_enabled;
  const q = searchQuery.trim().toUpperCase();

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
        .map(
          (p) => `
          <tr class="clickable-row" data-inspect-ticker="${esc(p.ticker)}">
            <th scope="row">
              <button type="button" class="ticker-link" data-inspect-ticker="${esc(p.ticker)}">${esc(p.ticker)}</button>
              ${p.stale ? '<span class="chip warn">STALE</span>' : ""}
              ${showSitus ? `<div class="muted-sub">${p.us_situs ? "US-Situs" : "Exempt"} · ${esc(p.domicile)}</div>` : `<div class="muted-sub">${esc(p.asset_type)}</div>`}
            </th>
            <td class="num" data-label="Price">${fmtMoney(p.price, p.currency, p.price < 10 ? 4 : 2)}</td>
            <td class="num" data-label="1D %">${fmtDeltaChip(p.change_1d_pct)}</td>
            <td class="spark-cell" data-label="30D">${renderSparklineSvg(p.sparkline, { width: 76, height: 22, positive: p.change_1m_pct !== null ? p.change_1m_pct >= 0 : null, label: `${p.ticker} 30-day trend` })}</td>
            <td class="num" data-label="Value ${esc(ccy)}">${fmtMoney(p.mv_base, ccy)}</td>
            <td class="num" data-label="Wt %"><strong>${fmtPct(p.weight_nav_pct, 2)}</strong></td>
            <td class="num" data-label="P&L %">${fmtDeltaChip(p.pnl_pct)}</td>
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="7">No positions match "${esc(searchQuery)}".</td></tr>`;

  const filteredLt = data.lookthrough.filter((r) => !q || r.name.toUpperCase().includes(q));
  const ltRows = filteredLt.length
    ? filteredLt
        .map((r) => {
          const clickTicker = r.name.includes("/") ? r.name.split("/")[0] : r.name;
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
            <caption id="cap-pos">Positions Desk (${filteredPositions.length} shown · click any row to inspect)</caption>
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

  return `
    <div class="panel-body">
      <div class="desk-toolbar">
        <div class="seg-switch" role="group" aria-label="Holdings table view">
          <button type="button" data-holdings-mode="positions" aria-pressed="${holdingsMode === "positions" ? "true" : "false"}">Positions (${data.portfolio.positions.length})</button>
          <button type="button" data-holdings-mode="lookthrough" aria-pressed="${holdingsMode === "lookthrough" ? "true" : "false"}">Look-Through (${data.lookthrough.length})</button>
        </div>
        <span class="muted-sub">Click any row or press / to jump to a ticker</span>
      </div>
      ${tableHtml}
    </div>
  `;
}

function matchesThesisFilter(t: ThesisRow, f: ThesisFilter): boolean {
  const s = t.status.toUpperCase();
  if (f === "all") return true;
  if (f === "buy") return s.includes("BUY") || s.includes("DEEP");
  if (f === "gated") return t.gated || s.includes("GATE");
  if (f === "trim") return s.includes("TRIM") || s.includes("EXIT");
  return !s.includes("BUY") && !s.includes("GATE") && !s.includes("TRIM");
}

function renderTheses(data: DashboardPayload, canMessage: boolean): string {
  if (!data.theses.length) {
    const btn = canMessage
      ? `<div style="margin-top:0.65rem"><button type="button" class="primary" id="btn-create-thesis">Ask Agent: Create My First Thesis Card</button></div>`
      : "";
    return `
      <div class="panel-body">
        <div class="card empty-state">
          No living thesis cards stored in <code>\${PLUGIN_DATA}/theses/</code> yet.
          ${btn}
        </div>
      </div>
    `;
  }

  const q = searchQuery.trim().toUpperCase();
  const counts = {
    all: data.theses.length,
    buy: data.theses.filter((t) => matchesThesisFilter(t, "buy")).length,
    gated: data.theses.filter((t) => matchesThesisFilter(t, "gated")).length,
    trim: data.theses.filter((t) => matchesThesisFilter(t, "trim")).length,
    hold: data.theses.filter((t) => matchesThesisFilter(t, "hold")).length,
  };

  const shown = data.theses.filter(
    (t) => matchesThesisFilter(t, thesisFilter) && (!q || t.ticker.includes(q) || t.role.toUpperCase().includes(q)),
  );

  const cards = shown.length
    ? shown
        .map(
          (t) => `
          <article class="thesis-card">
            <div class="thesis-head">
              <div>
                <button type="button" class="ticker-link" data-inspect-ticker="${esc(t.ticker)}">${esc(t.ticker)}</button>
                ${t.role ? `<div class="muted-sub">${esc(t.role)}</div>` : ""}
              </div>
              <div>${statusChip(t.status)}</div>
            </div>
            <div class="thesis-price-row">
              <div>
                <div class="thesis-price">${fmtMoney(t.price, t.currency, 2)}</div>
                <div class="actions-row">${fmtDeltaChip(t.change_1d_pct, "1D")} ${t.max_weight_pct !== null ? `<span class="muted-sub">Cap ${t.max_weight_pct}%</span>` : ""}</div>
              </div>
              ${renderSparklineSvg(t.sparkline, { width: 88, height: 28, positive: t.change_1m_pct !== null ? t.change_1m_pct >= 0 : null, fillArea: true, label: `${t.ticker} 30-day trend` })}
            </div>
            ${renderTriggerRuler(t.price, t.buy_zone_low, t.buy_zone_high, t.trim_zone, t.currency)}
            ${t.next_catalyst ? `<div class="muted-sub">${esc(t.next_catalyst_date || "")} · ${esc(t.next_catalyst)}</div>` : ""}
            <div class="actions-row" style="justify-content:space-between;margin-top:auto">
              <button type="button" class="small" data-inspect-ticker="${esc(t.ticker)}">Inspect &amp; Edit Triggers</button>
              ${canMessage ? `<button type="button" class="small ghost ask-redteam" data-ticker="${esc(t.ticker)}">Red-Team</button>` : ""}
            </div>
          </article>
        `,
        )
        .join("")
    : `<div class="card empty-state">No theses match current filter.</div>`;

  return `
    <div class="panel-body">
      <div class="desk-toolbar">
        <div class="seg-switch" role="group" aria-label="Filter theses by trigger state">
          <button type="button" data-thesis-filter="all" aria-pressed="${thesisFilter === "all" ? "true" : "false"}">All (${counts.all})</button>
          <button type="button" data-thesis-filter="buy" aria-pressed="${thesisFilter === "buy" ? "true" : "false"}">Buy (${counts.buy})</button>
          <button type="button" data-thesis-filter="gated" aria-pressed="${thesisFilter === "gated" ? "true" : "false"}">Gated (${counts.gated})</button>
          <button type="button" data-thesis-filter="trim" aria-pressed="${thesisFilter === "trim" ? "true" : "false"}">Trim (${counts.trim})</button>
          <button type="button" data-thesis-filter="hold" aria-pressed="${thesisFilter === "hold" ? "true" : "false"}">Hold (${counts.hold})</button>
        </div>
        <span class="muted-sub">Click card to edit trigger zones or review kill-switches</span>
      </div>
      <div class="thesis-grid">${cards}</div>
    </div>
  `;
}

function renderEdgar(data: DashboardPayload, canOpenLinks: boolean): string {
  const gateRows = data.edgar.gate_evaluations
    .map(
      (g) => `
      <div class="timeline-item">
        <div>
          <span class="chip ${g.cleared ? "ok" : "warn"}">${g.cleared ? "✓ CLEARED" : "⏳ OPEN GATE"}</span>
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
                <span class="chip ${countdown.cls}">${esc(countdown.label)}</span>
                <span class="chip ${c.urgency === "high" ? "bad" : c.urgency === "medium" ? "warn" : "muted"}">${esc(c.urgency.toUpperCase())}</span>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="muted-sub">No catalyst events tracked yet. Add milestones via <code>manage_catalysts</code>.</div>`;

  const filingsEntries = Object.entries(data.edgar.filings_by_ticker || {});
  const filingsHtml = filingsEntries.length
    ? `<div class="hub-grid">${filingsEntries
        .map(([sym, rows]) => {
          const items = rows
            .slice(0, 4)
            .map((r) => {
              const safeUrl = r.url.startsWith("https://www.sec.gov/") ? r.url : "";
              const linkBtn =
                canOpenLinks && safeUrl
                  ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">Open SEC</button>`
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
        .join("")}</div>`
    : `<div class="card empty-state">Click "Poll SEC EDGAR Live" to fetch recent 10-K, 10-Q, 8-K, 20-F, 6-K, and DEF 14A filings.</div>`;

  return `
    <div class="panel-body">
      <div class="card">
        <div class="section-head">
          <div>
            <h2 class="section-title">Catalyst Timeline &amp; SEC Filing Gates</h2>
            <div class="muted-sub">${data.edgar.checked_at ? `Last SEC check: ${esc(data.edgar.checked_at)}` : "SEC filings not polled yet"}</div>
          </div>
          <button type="button" class="primary small" id="btn-poll-edgar" ${data.is_demo ? "disabled" : ""}>Poll SEC EDGAR Live</button>
        </div>
        ${gateRows}
        <div style="margin-top:0.35rem">${catRows}</div>
      </div>
      ${filingsHtml}
    </div>
  `;
}

function renderInspectorDialog(ticker: string): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg || !state) return;

  const sym = ticker.toUpperCase();
  const pos = state.portfolio.positions.find((p) => p.ticker === sym);
  const thesis = state.theses.find((t) => t.ticker === sym);
  const lt = state.lookthrough.find((r) => r.name === sym || (sym.startsWith("GOOG") && r.name === "GOOG/GOOGL"));
  const filings = state.edgar.filings_by_ticker?.[sym] ?? [];

  const price = pos?.price ?? thesis?.price ?? null;
  const currency = pos?.currency ?? thesis?.currency ?? "USD";
  const sparkline = (pos?.sparkline.length ? pos.sparkline : thesis?.sparkline) ?? [];
  const ch1d = pos?.change_1d_pct ?? thesis?.change_1d_pct ?? null;
  const ch1m = pos?.change_1m_pct ?? thesis?.change_1m_pct ?? null;
  const titleName = pos?.name ?? sym;
  const ccy = state.base_currency;
  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);

  const rangeMin = sparkline.length ? Math.min(...sparkline) : null;
  const rangeMax = sparkline.length ? Math.max(...sparkline) : null;

  dlg.innerHTML = `
    <div class="drawer-head">
      <div>
        <h1 id="inspector-title">${esc(sym)} · ${esc(titleName)}</h1>
        <div class="actions-row" style="margin-top:4px">
          ${pos ? `<span class="chip muted">${esc(pos.asset_type)} · ${esc(pos.domicile)}</span>` : ""}
          ${thesis ? statusChip(thesis.status) : ""}
          ${state.summary.us_situs_enabled && (pos || thesis) ? `<span class="chip ${(pos?.us_situs ?? thesis?.us_situs) ? "warn" : "ok"}">${(pos?.us_situs ?? thesis?.us_situs) ? "US-Situs" : "Exempt"}</span>` : ""}
        </div>
      </div>
      <button type="button" class="small" id="btn-close-inspector" autofocus aria-label="Close inspector">✕ Close</button>
    </div>

    <div class="drawer-body">
      <div class="drawer-section">
        <div class="hero-top" style="align-items:center">
          <div>
            <div class="micro-label">Latest Price (${esc(currency)})</div>
            <div class="hero-nav" style="font-size:1.45rem">${price !== null ? fmtMoney(price, currency, price < 10 ? 4 : 2) : "N/A"}</div>
            <div class="actions-row" style="margin-top:4px">${fmtDeltaChip(ch1d, "1D")} ${fmtDeltaChip(ch1m, "1M")}</div>
          </div>
          ${renderSparklineSvg(sparkline, { width: 148, height: 48, positive: ch1m !== null ? ch1m >= 0 : null, fillArea: true, label: `${sym} 30-day area chart` })}
        </div>
        ${rangeMin !== null && rangeMax !== null ? `<div class="muted-sub">30D Range: ${fmtMoney(rangeMin, currency, 2)} – ${fmtMoney(rangeMax, currency, 2)}</div>` : ""}
      </div>

      ${
        pos || lt
          ? `
        <div class="drawer-section">
          <div class="micro-label">Position &amp; Look-Through Footprint</div>
          <div class="drawer-stat-grid">
            ${pos ? `<div class="metric-cell"><span class="micro-label">Shares / Avg Cost</span><span class="metric-val">${pos.qty.toLocaleString("en-US")} @ ${fmtMoney(pos.avg_cost, currency, 2)}</span></div>` : ""}
            ${pos ? `<div class="metric-cell"><span class="micro-label">Position Value</span><span class="metric-val">${fmtMoney(pos.mv_base, ccy)} (${fmtPct(pos.weight_nav_pct)})</span></div>` : ""}
            ${lt ? `<div class="metric-cell"><span class="micro-label">Direct vs ETF Overlap</span><span class="metric-val">${fmtMoney(lt.direct_usd, "USD", 0)} + ${fmtMoney(lt.via_etfs_usd, "USD", 0)}</span></div>` : ""}
            ${lt ? `<div class="metric-cell"><span class="micro-label">Total Look-Through</span><span class="metric-val">${fmtMoney(lt.total_base, ccy)} (${fmtPct(lt.pct_nav, 2)})</span></div>` : ""}
          </div>
        </div>
      `
          : ""
      }

      ${
        thesis
          ? `
        <div class="drawer-section">
          <div class="micro-label">Trigger Zone Ruler &amp; Thesis</div>
          ${renderTriggerRuler(price, thesis.buy_zone_low, thesis.buy_zone_high, thesis.trim_zone, currency)}
          ${thesis.core_summary.length ? `<div><strong>Core Thesis</strong><ul class="drawer-list">${thesis.core_summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
          ${thesis.kill_switches.length ? `<div><strong>Hard Kill-Switches</strong><ul class="drawer-list">${thesis.kill_switches.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></div>` : ""}
          ${thesis.latest_decision ? `<div class="muted-sub"><strong>Latest Decision:</strong> ${esc(thesis.latest_decision)}</div>` : ""}
        </div>
      `
          : ""
      }

      <div class="drawer-section">
        <div class="micro-label">${thesis ? "Edit Trigger Zones" : "Create Trigger Card"}</div>
        <div class="drawer-edit-grid">
          <label>Buy Low <input type="number" step="any" id="ins-buy-low" value="${thesis?.buy_zone_low ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
          <label>Buy High <input type="number" step="any" id="ins-buy-high" value="${thesis?.buy_zone_high ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
          <label>Trim Target <input type="number" step="any" id="ins-trim" value="${thesis?.trim_zone ?? ""}" ${state.is_demo ? "disabled" : ""} /></label>
          <label style="flex-direction:row;align-items:center;gap:6px;padding-top:16px">
            <input type="checkbox" id="ins-gated" ${thesis?.gated ? "checked" : ""} ${state.is_demo ? "disabled" : ""} /> Gated
          </label>
        </div>
        <div class="actions-row" style="margin-top:0.35rem">
          <button type="button" class="primary small" id="btn-save-inspector-trigger" ${state.is_demo ? "disabled" : ""}>Save Trigger Targets</button>
        </div>
      </div>

      ${
        filings.length > 0
          ? `
        <div class="drawer-section">
          <div class="micro-label">Recent SEC EDGAR Filings</div>
          ${filings
            .slice(0, 4)
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
      `
          : ""
      }
    </div>

    <div class="drawer-foot">
      <span class="muted-sub">Esc or click outside to dismiss</span>
      ${canMessage ? `<button type="button" class="primary small" id="btn-inspector-redteam">Ask Agent: Red-Team ${esc(sym)}</button>` : ""}
    </div>
  `;

  dlg.querySelector<HTMLButtonElement>("#btn-close-inspector")?.addEventListener("click", () => {
    void closeTopLayer(dlg);
  });

  dlg.querySelector<HTMLButtonElement>("#btn-save-inspector-trigger")?.addEventListener("click", async () => {
    const numVal = (id: string): number | null => {
      const el = dlg.querySelector<HTMLInputElement>(`#${id}`);
      if (!el || el.value.trim() === "") return null;
      const n = Number(el.value);
      return Number.isFinite(n) ? n : null;
    };
    const gated = Boolean(dlg.querySelector<HTMLInputElement>("#ins-gated")?.checked);
    await runAppTool(
      "app_save_trigger",
      {
        ticker: sym,
        buy_zone_low: numVal("ins-buy-low"),
        buy_zone_high: numVal("ins-buy-high"),
        trim_zone: numVal("ins-trim"),
        gated,
      },
      `Saved ${sym} trigger targets.`,
    );
  });

  dlg.querySelector<HTMLButtonElement>("#btn-inspector-redteam")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      `Run an adversarial Red-Team review of ${sym} using latest filings and live market price, then update ${sym}'s thesis card if warranted.`,
    );
  });

  dlg.querySelectorAll<HTMLButtonElement>(".open-sec").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (url && url.startsWith("https://www.sec.gov/")) {
        await app.openLink({ url });
      }
    });
  });
}

function openInspector(ticker: string): void {
  const dlg = document.getElementById("stock-inspector") as HTMLDialogElement | null;
  if (!dlg) return;
  inspectorTicker = ticker.toUpperCase();
  renderInspectorDialog(inspectorTicker);
  if (!dlg.open) {
    dlg.removeAttribute("data-closing");
    dlg.showModal();
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
  });

  dlg.addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeTopLayer(dlg!);
  });

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
  activeTab = nextTab;
  const tabBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

  for (const btn of tabBtns) {
    const selected = btn.dataset.tab === activeTab;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    btn.toggleAttribute("focusgroupstart", selected);
    if (selected) {
      btn.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focusTab) btn.focus();
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
}

function renderPanelsOnly(): void {
  if (!state) return;
  const canMessage = Boolean(hostCaps?.message);
  const canOpenLinks = Boolean(hostCaps?.openLinks);
  const ov = document.getElementById("panel-overview");
  const ho = document.getElementById("panel-holdings");
  const th = document.getElementById("panel-theses");
  const ed = document.getElementById("panel-edgar");
  if (ov) ov.innerHTML = renderOverview(state);
  if (ho) ho.innerHTML = renderHoldings(state);
  if (th) th.innerHTML = renderTheses(state, canMessage);
  if (ed) ed.innerHTML = renderEdgar(state, canOpenLinks);
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
              <rect x="6" y="6" width="116" height="116" rx="24" fill="#0F172A" stroke="#38BDF8" stroke-width="5"/>
              <path d="M30 84 L50 62 L66 72 L96 38" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M78 38 H96 V56" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="brand-text">
              <div class="brand-title-row"><h1>Investment OS</h1><span class="status-dot">Setup</span></div>
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

  const statusCls = state.is_demo ? "demo" : state.mode === "live_yahoo" ? "live" : "";
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
            <rect x="6" y="6" width="116" height="116" rx="24" fill="#0F172A" stroke="#38BDF8" stroke-width="5"/>
            <path d="M30 84 L50 62 L66 72 L96 38" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M78 38 H96 V56" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="brand-text">
            <div class="brand-title-row">
              <h1>Investment OS</h1>
              <span class="status-dot ${statusCls}">${statusLbl}</span>
            </div>
            <div class="meta-line">Base ${esc(state.base_currency)} · ${esc(state.generated_at)}</div>
          </div>
        </div>
        <div class="cmd-actions">
          <div class="search-box">
            <input id="search-ticker" class="search-input" type="search" value="${esc(searchQuery)}" placeholder="Jump / filter..." aria-label="Filter or jump to ticker" />
            <span class="kbd-hint">/</span>
          </div>
          <button type="button" class="primary small" id="btn-refresh-live" ${busyMessage || state.is_demo ? "disabled" : ""}>${busyMessage ? esc(busyMessage) : "Refresh Live"}</button>
          ${syncBtn}
        </div>
      </header>
      ${demoBanner}
      ${toastMessage ? `<div class="toast" role="status">${esc(toastMessage)}</div>` : ""}
      <div class="tablist" focusgroup="tablist nomemory" aria-label="Investment OS views">
        ${tabButtons}
      </div>
      <div role="tabpanel" id="panel-overview" data-panel="overview" aria-labelledby="tab-overview" ${activeTab === "overview" ? 'tabindex="0"' : 'hidden="until-found"'}>
        ${renderOverview(state)}
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
    </div>
  `;

  bindChromeEvents(root);
  bindPanelEvents(root);
}

function bindOnboardingEvents(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("#btn-onboard-agent")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Help me set up Investment OS: ask for my base currency, residency/tax profile, optional external stock or cash reserve, and brokerage holdings, then persist them cleanly.",
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-preview-demo")?.addEventListener("click", async () => {
    await runServerRefresh("Loading sample preview...", { demo: true, tab: "overview" });
  });
}

function bindChromeEvents(root: HTMLElement): void {
  const tabBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  tabBtns.forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab as TabId | undefined;
      if (id) selectTab(id);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const nextIdx =
          e.key === "ArrowRight" ? (idx + 1) % tabBtns.length : (idx - 1 + tabBtns.length) % tabBtns.length;
        const nextId = tabBtns[nextIdx].dataset.tab as TabId | undefined;
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

  root.querySelector<HTMLButtonElement>("#btn-refresh-live")?.addEventListener("click", async () => {
    await runServerRefresh("Refreshing...", { live: true, tab: activeTab });
  });

  root.querySelector<HTMLButtonElement>("#btn-exit-demo")?.addEventListener("click", async () => {
    await runServerRefresh("Exiting preview...", { demo: false, tab: "overview" });
  });

  root.querySelector<HTMLButtonElement>("#btn-sync-broker")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Sync my latest brokerage positions, cash, and FX (using connected ibkr-mcp if available or asking for my export) into Investment OS and refresh the dashboard.",
    );
  });

  const searchInput = root.querySelector<HTMLInputElement>("#search-ticker");
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    if (activeTab === "overview" && searchQuery.trim().length > 0) {
      selectTab("holdings");
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

function bindPanelEvents(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-inspect-ticker]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = el.dataset.inspectTicker;
      if (sym) openInspector(sym);
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

  root.querySelectorAll<HTMLButtonElement>("[data-thesis-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = (btn.dataset.thesisFilter as ThesisFilter | undefined) ?? "all";
      if (next !== thesisFilter) {
        thesisFilter = next;
        renderPanelsOnly();
      }
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-create-thesis")?.addEventListener("click", async () => {
    await sendAgentPrompt("Ask which ticker I want to research, then create a living thesis card with buy/trim zones via update_thesis.");
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

  root.querySelectorAll<HTMLButtonElement>(".ask-redteam").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sym = btn.dataset.ticker;
      if (!sym) return;
      await sendAgentPrompt(
        `Run an adversarial Red-Team review of ${sym} using latest filings and price, then update ${sym}'s thesis card if needed.`,
      );
    });
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
  busyMessage = "Saving...";
  render();
  try {
    const res = await app.callServerTool({ name, arguments: args });
    busyMessage = "";
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

async function sendAgentPrompt(text: string): Promise<void> {
  if (!hostCaps?.message) {
    toastMessage = "Open inside a conversation sidecar to message the agent directly.";
    render();
    return;
  }
  try {
    await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    toastMessage = "Sent request to agent.";
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
    // Fallback fetch if sidecar was opened standalone via '+' menu or left sidebar without a fresh tool result
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
