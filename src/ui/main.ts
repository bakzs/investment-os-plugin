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
  name: string;
  currency: string;
  qty: number;
  avg_cost: number;
  price: number;
  stale: boolean;
  mv_trading: number;
  mv_usd: number;
  mv_base: number;
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

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "holdings", label: "Holdings & Look-Through" },
  { id: "theses", label: "Triggers & Theses" },
  { id: "edgar", label: "Catalysts & EDGAR" },
];

const app = new App({ name: "Investment OS", version: "0.2.0" }, {});
let state: DashboardPayload | null = null;
let activeTab: TabId = "overview";
let hostCaps: McpUiHostCapabilities | undefined;
let busyMessage = "";
let toastMessage = "";
let simExtBase = 0;
let simReserveBase = 0;

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
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (code === "USD") return `$${formatted}`;
  if (code === "SGD") return `S$${formatted}`;
  if (code === "EUR") return `€${formatted}`;
  if (code === "GBP") return `£${formatted}`;
  if (code === "JPY") return `¥${formatted}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${code} ${formatted}`;
  }
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
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

function statusPillClass(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("BUY") || s === "PASS" || s === "CLEARED") return "ok";
  if (s.includes("TRIM") || s.includes("EXIT") || s === "BREACH" || s.includes("BANNED")) return "bad";
  if (s.includes("GATE") || s.includes("WAIT") || s.includes("DEEP") || s === "OPEN") return "warn";
  return "muted";
}

function ingestPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as DashboardPayload;
  if (!p.profile || !p.portfolio) return;
  state = p;
  simExtBase = p.profile.external_exposure.enabled ? p.profile.external_exposure.amount_base : 0;
  simReserveBase = p.profile.liquidity_reserve.enabled ? p.profile.liquidity_reserve.amount_base : 0;
  if (p.active_tab && TABS.some((t) => t.id === p.active_tab)) {
    activeTab = p.active_tab;
  }
  render();
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
      <p>No local portfolio is configured yet. All your holdings, tax residency settings, and investment theses stay strictly private on your machine inside <code>\${PLUGIN_DATA}</code>.</p>
      <ul class="onboarding-points">
        <li>Supports any base reporting currency, multi-currency holdings, and ETF look-through weights.</li>
        <li>Read-only by architecture: connects alongside broker MCPs (like IBKR) or manual imports without trade execution tools.</li>
        <li>Optional modules for Non-Resident Alien US estate tax (IRC &sect;2101(c)), external equity concentration, and cash reserves.</li>
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

  const capHtml = data.risk_caps.length
    ? data.risk_caps
        .map((c) => {
          const fillPct = Math.min(100, (c.value_pct / Math.max(c.cap_pct * 1.4, c.value_pct, 1)) * 100);
          const isPass = c.status === "PASS";
          return `
            <div class="cap-row">
              <div class="cap-head">
                <span>${esc(c.label)}</span>
                <span><strong>${fmtPct(c.value_pct)}</strong> / ${fmtPct(c.cap_pct)} <span class="pill ${isPass ? "ok" : "bad"}">${esc(c.status)}</span></span>
              </div>
              <div class="bar-track"><div class="bar-fill ${isPass ? "pass" : "breach"}" style="width:${fillPct.toFixed(1)}%"></div></div>
            </div>
          `;
        })
        .join("")
    : `<div class="kpi-sub">No risk cap rules configured in profile.yaml yet.</div>`;

  const secondKpi = ext.enabled
    ? `
      <div class="card">
        <div class="kpi-label">Total Liquid Wealth</div>
        <div class="kpi-val">${fmtMoney(sim.totalWealthBase, ccy)}</div>
        <div class="kpi-sub">${esc(ext.label)} ${fmtMoney(simExtBase, ccy)}${ext.ticker ? ` · ${esc(ext.ticker)} ${fmtPct(sim.extPct)}` : ""}</div>
      </div>
    `
    : `
      <div class="card">
        <div class="kpi-label">Invested Positions</div>
        <div class="kpi-val">${fmtMoney(data.portfolio.positions_base, ccy)}</div>
        <div class="kpi-sub">${esc(data.profile.custody_label)} · ${data.portfolio.positions.length} holdings</div>
      </div>
    `;

  const thirdKpi = data.summary.us_situs_enabled
    ? `
      <div class="card">
        <div class="kpi-label">Est. US NRA Estate Tax</div>
        <div class="kpi-val pos-bad">${fmtMoney(sim.estateTaxBase, ccy)}</div>
        <div class="kpi-sub">${sim.marginalPct.toFixed(0)}% NRA marginal · UCITS swap saves ${fmtMoney(sim.ucitsSavingsBase, ccy)}</div>
      </div>
    `
    : `
      <div class="card">
        <div class="kpi-label">Unrealized P&amp;L</div>
        <div class="kpi-val ${data.portfolio.total_unrealized_pnl_pct >= 0 ? "pos-ok" : "pos-bad"}">${data.portfolio.total_unrealized_pnl_pct >= 0 ? "+" : ""}${fmtPct(data.portfolio.total_unrealized_pnl_pct)}</div>
        <div class="kpi-sub">${fmtMoney(data.portfolio.total_unrealized_pnl_usd, "USD", 0)} cost delta</div>
      </div>
    `;

  const pulseSubParts: string[] = [];
  if (ccy !== "USD") pulseSubParts.push(`USD/${ccy} ${data.usd_to_base_fx.toFixed(4)}`);
  if (data.summary.primary_bucket_label) {
    pulseSubParts.push(`${data.summary.primary_bucket_label}: ${fmtPct(ext.enabled ? sim.primaryBucketPct : data.summary.primary_bucket_portfolio_pct)}`);
  }
  if (data.stale_tickers.length > 0) {
    pulseSubParts.push(`Stale marks: ${data.stale_tickers.join(", ")}`);
  }

  const showSim = ext.enabled || reserve.enabled;
  const extMax = Math.max(500000, Math.ceil((Math.max(simExtBase, 1) * 2) / 50000) * 50000);
  const resMax = Math.max(200000, Math.ceil((Math.max(simReserveBase, 1) * 2) / 25000) * 25000);
  const hasPaired = Boolean(ext.enabled && ext.paired_tickers && ext.paired_tickers.length > 0);

  const simSection = showSim
    ? `
      <div class="card">
        <h2 class="section-title">Outside Wealth &amp; Liquidity Reserve Simulator</h2>
        <div class="sim-grid">
          ${
            ext.enabled
              ? `
            <div class="sim-field">
              <label for="sim-ext"><span>${esc(ext.label)}</span><span id="sim-ext-lbl">${fmtMoney(simExtBase, ccy)}</span></label>
              <input id="sim-ext" type="range" min="0" max="${extMax}" step="${Math.round(extMax / 40)}" value="${simExtBase}" />
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
            </div>
          `
              : ""
          }
        </div>
        <div id="sim-results" class="sim-results">
          ${ext.enabled ? `<div><div class="kpi-label">${esc(ext.ticker || "External")} % Wealth</div><div class="kpi-val">${fmtPct(sim.extPct)}</div></div>` : ""}
          ${hasPaired ? `<div><div class="kpi-label">${esc(data.summary.paired_label)}</div><div class="kpi-val">${fmtPct(sim.pairedPct)}</div></div>` : ""}
          <div><div class="kpi-label">Cash Left</div><div class="kpi-val ${sim.cashSurplusBase < 0 ? "pos-bad" : ""}">${fmtMoney(sim.cashSurplusBase, ccy)}</div></div>
          ${
            data.summary.us_situs_enabled
              ? `<div><div class="kpi-label">US NRA Estate Tax</div><div class="kpi-val pos-bad">${fmtMoney(sim.estateTaxBase, ccy)}</div></div>`
              : `<div><div class="kpi-label">Net Investable</div><div class="kpi-val">${fmtMoney(sim.netInvestableBase, ccy)}</div></div>`
          }
        </div>
        <div class="actions-row" style="margin-top:0.55rem">
          <button type="button" class="primary" id="btn-save-ext" ${data.is_demo ? "disabled" : ""}>Save Assumptions</button>
          <span class="kpi-sub">${data.is_demo ? "Disabled in sample demo preview" : "Persists locally to \${PLUGIN_DATA}/profile.yaml"}</span>
        </div>
      </div>
    `
    : "";

  return `
    <div class="panel-body">
      <div class="kpi-grid">
        <div class="card">
          <div class="kpi-label">Portfolio NAV</div>
          <div class="kpi-val">${fmtMoney(data.portfolio.nav_base, ccy)}</div>
          <div class="kpi-sub">${ccy !== "USD" ? `${fmtMoney(data.portfolio.nav_usd, "USD", 0)} · ` : ""}Cash ${fmtMoney(data.portfolio.cash_base, ccy)} (${fmtPct(data.portfolio.cash_pct)})</div>
        </div>
        ${secondKpi}
        ${thirdKpi}
        <div class="card">
          <div class="kpi-label">Market Pulse</div>
          <div class="kpi-val">VIX ${data.vix !== null ? data.vix.toFixed(2) : "Snapshot"}</div>
          <div class="kpi-sub">${esc(pulseSubParts.join(" · ") || "All prices in sync")}</div>
        </div>
      </div>

      ${simSection}

      <div class="card">
        <h2 class="section-title">Risk Caps (Look-Through Audit)</h2>
        <div class="cap-list">${capHtml}</div>
      </div>
    </div>
  `;
}

function renderHoldings(data: DashboardPayload): string {
  const ccy = data.base_currency;
  const showSitus = data.summary.us_situs_enabled;

  const ltRows = data.lookthrough.length
    ? data.lookthrough
        .map(
          (r) => `
          <tr>
            <th scope="row">${esc(r.name)}</th>
            <td class="num" data-label="Direct USD">${fmtMoney(r.direct_usd, "USD", 0)}</td>
            <td class="num" data-label="Via ETFs USD">${fmtMoney(r.via_etfs_usd, "USD", 0)}</td>
            <td class="num" data-label="Total ${esc(ccy)}">${fmtMoney(r.total_base, ccy)}</td>
            <td class="num" data-label="% NAV"><strong>${fmtPct(r.pct_nav, 2)}</strong></td>
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="5">No look-through exposures found.</td></tr>`;

  const posRows = data.portfolio.positions
    .slice()
    .sort((a, b) => b.mv_base - a.mv_base)
    .map(
      (p) => `
      <tr>
        <th scope="row">${esc(p.ticker)} ${p.stale ? '<span class="pill warn">STALE</span>' : ""}</th>
        <td class="num" data-label="Qty">${p.qty.toLocaleString("en-US")}</td>
        <td class="num" data-label="Price">${fmtMoney(p.price, p.currency, p.price < 10 ? 4 : 2)}</td>
        <td class="num" data-label="Value ${esc(ccy)}">${fmtMoney(p.mv_base, ccy)}</td>
        <td class="num" data-label="Wt %">${fmtPct(p.weight_nav_pct, 2)}</td>
        <td class="num ${p.pnl_pct >= 0 ? "pos-ok" : "pos-bad"}" data-label="P&L %">${p.pnl_pct >= 0 ? "+" : ""}${fmtPct(p.pnl_pct)}</td>
        ${showSitus ? `<td data-label="Tax Situs"><span class="pill ${p.us_situs ? "warn" : "ok"}">${p.us_situs ? "US-Situs" : "Exempt"}</span></td>` : ""}
      </tr>
    `,
    )
    .join("");

  return `
    <div class="panel-body">
      <div tabindex="0" role="region" aria-labelledby="cap-lt" class="table-wrapper">
        <table>
          <caption id="cap-lt">True Look-Through Single-Name Exposure (Direct + ETF Holdings)</caption>
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

      <div tabindex="0" role="region" aria-labelledby="cap-pos" class="table-wrapper">
        <table>
          <caption id="cap-pos">Portfolio Positions (${data.portfolio.positions.length} Holdings)</caption>
          <thead>
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col" class="num">Qty</th>
              <th scope="col" class="num">Price</th>
              <th scope="col" class="num">Value ${esc(ccy)}</th>
              <th scope="col" class="num">Wt %</th>
              <th scope="col" class="num">P&amp;L %</th>
              ${showSitus ? `<th scope="col">Tax Situs</th>` : ""}
            </tr>
          </thead>
          <tbody>${posRows}</tbody>
        </table>
      </div>
    </div>
  `;
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

  const ccy = data.base_currency;
  const showSitus = data.summary.us_situs_enabled;
  const cards = data.theses
    .map((t) => {
      const zoneText =
        t.buy_zone_low !== null && t.buy_zone_high !== null
          ? `${fmtMoney(t.buy_zone_low, t.currency, t.buy_zone_high < 20 ? 2 : 0)}–${fmtMoney(t.buy_zone_high, t.currency, t.buy_zone_high < 20 ? 2 : 0)}`
          : "NO BUY";
      const trimText = t.trim_zone !== null ? `${fmtMoney(t.trim_zone, t.currency, t.trim_zone < 20 ? 2 : 0)}+` : "Core Hold";
      const summaryBullets = t.core_summary.map((s) => `<li>${esc(s)}</li>`).join("");
      const killBullets = t.kill_switches.map((k) => `<li>${esc(k)}</li>`).join("");
      const askBtn = canMessage
        ? `<button type="button" class="small ask-redteam" data-ticker="${esc(t.ticker)}">Ask Agent: Red-Team ${esc(t.ticker)}</button>`
        : "";
      const situsPill = showSitus
        ? `<span class="pill ${t.us_situs ? "warn" : "ok"}">${t.us_situs ? "US-Situs" : "Exempt"}</span>`
        : "";

      return `
        <div class="thesis-card">
          <div class="thesis-head">
            <div>
              <span class="thesis-title">${esc(t.ticker)}</span>
              ${t.role ? `<span class="pill muted">${esc(t.role)}</span>` : ""}
              ${situsPill}
              ${t.stale ? `<span class="pill warn">STALE</span>` : ""}
            </div>
            <div>
              <span class="pill ${statusPillClass(t.status)}">${esc(t.status)}</span>
            </div>
          </div>
          <div class="thesis-sub">
            Live: <strong>${fmtMoney(t.price, t.currency, 2)}</strong>${ccy !== t.currency ? ` (${fmtMoney(t.price_base, ccy, 2)})` : ""} ·
            Buy Zone: <strong>${zoneText}</strong> · Trim: <strong>${trimText}</strong> ·
            Cap: ${t.max_weight_pct ?? "-"}% ${t.gated ? "· <strong>GATED</strong>" : ""}
          </div>
          ${t.next_catalyst || t.next_catalyst_date ? `<div class="thesis-sub">Next Catalyst: ${esc(t.next_catalyst_date || "-")} — ${esc(t.next_catalyst || "")}</div>` : ""}
          <details>
            <summary>Thesis, Kill-Switches &amp; Trigger Editor</summary>
            <div class="thesis-details">
              ${summaryBullets ? `<div><strong>Core Thesis:</strong><ul>${summaryBullets}</ul></div>` : ""}
              ${killBullets ? `<div><strong>Hard Kill-Switches:</strong><ul>${killBullets}</ul></div>` : ""}
              ${t.latest_decision ? `<div><strong>Latest Decision:</strong> ${esc(t.latest_decision)}</div>` : ""}
              <div class="edit-row">
                <label>Buy Low <input type="number" step="any" data-edit="low" data-ticker="${esc(t.ticker)}" value="${t.buy_zone_low ?? ""}" ${data.is_demo ? "disabled" : ""} /></label>
                <label>Buy High <input type="number" step="any" data-edit="high" data-ticker="${esc(t.ticker)}" value="${t.buy_zone_high ?? ""}" ${data.is_demo ? "disabled" : ""} /></label>
                <label>Trim <input type="number" step="any" data-edit="trim" data-ticker="${esc(t.ticker)}" value="${t.trim_zone ?? ""}" ${data.is_demo ? "disabled" : ""} /></label>
                <label><input type="checkbox" data-edit="gated" data-ticker="${esc(t.ticker)}" ${t.gated ? "checked" : ""} ${data.is_demo ? "disabled" : ""} /> Gated</label>
                <button type="button" class="small primary save-trigger" data-ticker="${esc(t.ticker)}" ${data.is_demo ? "disabled" : ""}>Save</button>
                ${askBtn}
              </div>
            </div>
          </details>
        </div>
      `;
    })
    .join("");
  return `<div class="panel-body"><div class="thesis-list">${cards}</div></div>`;
}

function renderEdgar(data: DashboardPayload, canOpenLinks: boolean): string {
  const gateRows = data.edgar.gate_evaluations
    .map(
      (g) => `
      <div class="kpi-sub" style="margin-top:4px">
        <span class="pill ${statusPillClass(g.cleared ? "CLEARED" : "OPEN")}">${g.cleared ? "CLEARED" : "OPEN GATE"}</span>
        <strong>${esc(g.ticker)} (${esc(g.form)} &gt; ${esc(g.filed_after)}):</strong> ${esc(g.description)}
        ${g.latest_matching_date ? ` (Filed ${esc(g.latest_matching_date)})` : ""}
      </div>
    `,
    )
    .join("");

  const catRows = data.catalysts.length
    ? data.catalysts
        .map(
          (c) => `
          <div class="filing-item">
            <div>
              <strong>${esc(c.date)} · ${esc(c.ticker)}</strong> — ${esc(c.title)}
              <div class="kpi-sub">${esc(c.detail)}</div>
            </div>
            <span class="pill ${c.urgency === "high" ? "bad" : c.urgency === "medium" ? "warn" : "muted"}">${esc(c.urgency.toUpperCase())}</span>
          </div>
        `,
        )
        .join("")
    : `<div class="kpi-sub">No catalyst events tracked yet. Add milestones via the agent tool <code>manage_catalysts</code>.</div>`;

  const filingsEntries = Object.entries(data.edgar.filings_by_ticker || {});
  const filingsHtml = filingsEntries.length
    ? filingsEntries
        .map(([sym, rows]) => {
          const items = rows
            .slice(0, 3)
            .map((r) => {
              const safeUrl = r.url.startsWith("https://www.sec.gov/") ? r.url : "";
              const linkBtn =
                canOpenLinks && safeUrl
                  ? `<button type="button" class="small open-sec" data-url="${esc(safeUrl)}">Open SEC</button>`
                  : `<span class="kpi-sub">${esc(r.accession)}</span>`;
              return `
                <div class="filing-item">
                  <span><strong>${esc(r.filingDate)}</strong> · ${esc(r.form)} ${r.items ? `[${esc(r.items)}]` : ""}</span>
                  ${linkBtn}
                </div>
              `;
            })
            .join("");
          return `<div class="card"><h3 class="section-title">${esc(sym)}</h3>${items}</div>`;
        })
        .join("")
    : `<div class="card empty-state">Click "Poll SEC EDGAR Live" to fetch recent 10-K, 10-Q, 8-K, 20-F, 6-K, and DEF 14A filings.</div>`;

  return `
    <div class="panel-body">
      <div class="card">
        <div class="thesis-head">
          <h2 class="section-title" style="margin:0">Catalysts &amp; SEC Filing Gates</h2>
          <button type="button" class="primary" id="btn-poll-edgar" ${data.is_demo ? "disabled" : ""}>Poll SEC EDGAR Live</button>
        </div>
        ${data.edgar.checked_at ? `<div class="kpi-sub" style="margin-top:4px">Last SEC check: ${esc(data.edgar.checked_at)}</div>` : ""}
        ${gateRows}
        <div style="margin-top:0.5rem">${catRows}</div>
      </div>
      ${filingsHtml}
    </div>
  `;
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
          <div class="brand-block">
            <h1>Investment OS</h1>
            <div class="meta-line">Setup Required · Local data dir ready</div>
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
    ? `<button type="button" id="btn-sync-broker" ${busyMessage ? "disabled" : ""}>Ask Agent: Sync Broker</button>`
    : "";

  const demoBanner = state.is_demo
    ? `
      <div class="demo-banner" role="status">
        <span><strong>SAMPLE DEMO MODE</strong> — Synthetic preview portfolio only (nothing written to disk).</span>
        <button type="button" class="small" id="btn-exit-demo">Exit Preview</button>
      </div>
    `
    : "";

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-block">
          <h1>Investment OS</h1>
          <div class="meta-line">Mode: ${esc(state.mode)} · Base ${esc(state.base_currency)} · Updated ${esc(state.generated_at)}</div>
        </div>
        <div class="actions-row">
          <button type="button" class="primary" id="btn-refresh-live" ${busyMessage || state.is_demo ? "disabled" : ""}>${busyMessage ? esc(busyMessage) : "Refresh Live"}</button>
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

  bindEvents(root);
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

function bindEvents(root: HTMLElement): void {
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
    await runServerRefresh("Refreshing live quotes...", { live: true, tab: activeTab });
  });

  root.querySelector<HTMLButtonElement>("#btn-exit-demo")?.addEventListener("click", async () => {
    await runServerRefresh("Exiting demo preview...", { demo: false, tab: "overview" });
  });

  root.querySelector<HTMLButtonElement>("#btn-sync-broker")?.addEventListener("click", async () => {
    await sendAgentPrompt(
      "Sync my latest brokerage positions, cash, and FX (using connected ibkr-mcp if available or asking for my export) into Investment OS and refresh the dashboard.",
    );
  });

  root.querySelector<HTMLButtonElement>("#btn-create-thesis")?.addEventListener("click", async () => {
    await sendAgentPrompt("Ask which ticker I want to research, then create a living thesis card with buy/trim zones via update_thesis.");
  });

  const extSlider = root.querySelector<HTMLInputElement>("#sim-ext");
  const resSlider = root.querySelector<HTMLInputElement>("#sim-res");
  const updateSimDisplay = () => {
    if (!state) return;
    const ccy = state.base_currency;
    const ext = state.profile.external_exposure;
    const hasPaired = Boolean(ext.enabled && ext.paired_tickers && ext.paired_tickers.length > 0);
    simExtBase = Number(extSlider?.value ?? simExtBase);
    simReserveBase = Number(resSlider?.value ?? simReserveBase);
    const extLbl = root.querySelector("#sim-ext-lbl");
    const resLbl = root.querySelector("#sim-res-lbl");
    if (extLbl) extLbl.textContent = fmtMoney(simExtBase, ccy);
    if (resLbl) resLbl.textContent = fmtMoney(simReserveBase, ccy);

    const sim = computeSimulatorMetrics(state);
    const simBox = root.querySelector("#sim-results");
    if (simBox) {
      simBox.innerHTML = `
        ${ext.enabled ? `<div><div class="kpi-label">${esc(ext.ticker || "External")} % Wealth</div><div class="kpi-val">${fmtPct(sim.extPct)}</div></div>` : ""}
        ${hasPaired ? `<div><div class="kpi-label">${esc(state.summary.paired_label)}</div><div class="kpi-val">${fmtPct(sim.pairedPct)}</div></div>` : ""}
        <div><div class="kpi-label">Cash Left</div><div class="kpi-val ${sim.cashSurplusBase < 0 ? "pos-bad" : ""}">${fmtMoney(sim.cashSurplusBase, ccy)}</div></div>
        ${
          state.summary.us_situs_enabled
            ? `<div><div class="kpi-label">US NRA Estate Tax</div><div class="kpi-val pos-bad">${fmtMoney(sim.estateTaxBase, ccy)}</div></div>`
            : `<div><div class="kpi-label">Net Investable</div><div class="kpi-val">${fmtMoney(sim.netInvestableBase, ccy)}</div></div>`
        }
      `;
    }
  };
  extSlider?.addEventListener("input", updateSimDisplay);
  resSlider?.addEventListener("input", updateSimDisplay);

  root.querySelector<HTMLButtonElement>("#btn-save-ext")?.addEventListener("click", async () => {
    await runAppTool("app_save_external_wealth", {
      external_amount_base: simExtBase,
      reserve_amount_base: simReserveBase,
    }, "Saved profile assumptions.");
  });

  root.querySelectorAll<HTMLButtonElement>(".save-trigger").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sym = btn.dataset.ticker;
      if (!sym) return;
      const safeSym = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sym) : sym;
      const card = btn.closest(".thesis-card");
      const getVal = (field: string): number | null => {
        const el = card?.querySelector<HTMLInputElement>(`input[data-edit="${field}"][data-ticker="${safeSym}"]`);
        if (!el || el.value.trim() === "") return null;
        const parsed = Number(el.value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const gatedEl = card?.querySelector<HTMLInputElement>(`input[data-edit="gated"][data-ticker="${safeSym}"]`);
      await runAppTool("app_save_trigger", {
        ticker: sym,
        buy_zone_low: getVal("low"),
        buy_zone_high: getVal("high"),
        trim_zone: getVal("trim"),
        gated: Boolean(gatedEl?.checked),
      }, `Updated ${sym} trigger zones.`);
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".ask-redteam").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
        ? "Live market quotes, VIX, and FX refreshed."
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

async function bootstrap() {
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

  await app.connect();
  hostCaps = app.getHostCapabilities();
  applyThemeContext(app.getHostContext());
  render();
}

void bootstrap();
