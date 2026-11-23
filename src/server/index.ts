import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  buildDashboardPayload,
  buildSummaryText,
  formatTimestamp,
  mergePortfolioPositions,
  saveOrMergeThesis,
} from "./engine.js";
import { pollEdgarFilings } from "./edgar.js";
import {
  CatalystSchema,
  CurrencySchema,
  normalizeTicker,
  PositionInputSchema,
  ProfileSchema,
  RiskCapRuleSchema,
  ThesisUpdateSchema,
  type CatalystRecord,
  type UserProfile,
} from "./schema.js";
import {
  loadCatalysts,
  loadPortfolio,
  loadProfile,
  resolveDataDir,
  resolvePluginRoot,
  saveCatalysts,
  savePortfolio,
  saveProfile,
} from "./storage.js";

const APP_URI = "ui://investment-os/dashboard.html";
const APP_MIME = "text/html;profile=mcp-app";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(path.resolve(process.argv[1] || process.cwd()));
const inferredRoot =
  path.basename(currentDir) === "dist"
    ? path.resolve(currentDir, "..")
    : path.resolve(currentDir, "..", "..");

const PLUGIN_ROOT = resolvePluginRoot(process.env, inferredRoot);
const DATA_DIR = resolveDataDir(process.argv.slice(2), process.env);

function resolveHtmlPath(): string {
  const fromEnv = process.env.INVESTMENT_OS_HTML?.trim();
  if (fromEnv && !fromEnv.includes("${")) return path.resolve(fromEnv);
  const direct = path.resolve(currentDir, "dashboard.html");
  if (fs.existsSync(direct)) return direct;
  return path.resolve(PLUGIN_ROOT, "dist", "dashboard.html");
}

const INLINE_META = { ui: { resourceUri: APP_URI } };
const PANE_META = {
  ui: { resourceUri: APP_URI },
  "com.google.antigravity/ui": {
    entrypoints: [
      { type: "aux_pane", title: "Investment OS" },
      { type: "global", title: "Investment OS" },
    ],
  },
};
const APP_ONLY_META = { ui: { visibility: ["app"] } };

const TOOLS: Tool[] = [
  {
    name: "open_dashboard",
    title: "Investment OS",
    description:
      "Open or refresh the interactive Investment OS sidecar dashboard showing portfolio valuation, look-through exposures, configurable risk caps, optional US NRA estate tax, thesis trigger zones, and SEC EDGAR catalysts.",
    inputSchema: {
      type: "object",
      properties: {
        tab: {
          type: "string",
          enum: ["overview", "holdings", "theses", "edgar"],
          description: "Initial dashboard tab to focus.",
        },
        live: {
          type: "boolean",
          description: "If true, fetch live quotes, VIX, and FX rates via Yahoo Finance.",
        },
        demo: {
          type: "boolean",
          description: "If true, render a read-only synthetic sample portfolio without modifying local files.",
        },
      },
    },
    _meta: PANE_META,
  },
  {
    name: "update_profile",
    title: "Update Investor Profile & Risk Caps",
    description:
      "Configure base currency, timezone, tax residency / US NRA estate tax toggle, external equity / cash reserve settings, and custom risk caps inside ${PLUGIN_DATA}/profile.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        base_currency: { type: "string", description: "3-letter ISO-4217 currency code (e.g., USD, SGD, EUR, GBP)." },
        timezone: { type: "string", description: "IANA timezone string (e.g., America/New_York, Asia/Singapore, Europe/London)." },
        edgar_user_agent: { type: "string" },
        custody_label: { type: "string" },
        tax_profile: {
          type: "object",
          properties: {
            country_code: { type: "string" },
            nra_us_estate_tax_enabled: { type: "boolean" },
            us_dividend_wht_pct: { type: "number" },
            ucits_dividend_wht_pct: { type: "number" },
            cgt_pct: { type: "number" },
          },
        },
        external_exposure: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            label: { type: "string" },
            ticker: { type: ["string", "null"] },
            amount_base: { type: "number" },
            vested_pct: { type: ["number", "null"] },
            us_situs: { type: "boolean" },
            sector_tags: { type: "array", items: { type: "string" } },
            paired_label: { type: "string" },
            paired_tickers: { type: "array", items: { type: "string" } },
          },
        },
        liquidity_reserve: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            label: { type: "string" },
            amount_base: { type: "number" },
            horizon_months: { type: ["integer", "null"] },
          },
        },
        risk_caps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              kind: { type: "string", enum: ["single_name_max", "ticker", "bucket", "us_situs"] },
              cap_pct: { type: "number" },
              ticker: { type: "string" },
              tickers: { type: "array", items: { type: "string" } },
              include_etf_residual_key: { type: "string" },
            },
            required: ["id", "label", "kind", "cap_pct"],
          },
        },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_portfolio_positions",
    title: "Update Portfolio Positions",
    description:
      "Persist multi-currency holdings, cash, accruals, or FX rates into ${PLUGIN_DATA}/portfolio.json (e.g., synced from ibkr-mcp or parsed from statements) and refresh dashboard metrics.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["replace", "upsert"], description: "Replace entire position list (default) or upsert by ticker." },
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              qty: { type: "number" },
              avg_cost: { type: "number" },
              ref_price: { type: "number" },
              avg_cost_usd: { type: "number" },
              ref_price_usd: { type: "number" },
              currency: { type: "string" },
              yf_symbol: { type: "string" },
              name: { type: "string" },
              asset_type: { type: "string" },
              domicile: { type: "string" },
              us_situs: { type: "boolean" },
              isin: { type: "string" },
            },
            required: ["ticker", "qty"],
          },
        },
        cash_base: { type: "number" },
        accruals_base: { type: "number" },
        fx_rates: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Map of trading currency -> base_currency units per 1 trading currency unit (e.g., { USD: 1.29 }).",
        },
        source: { type: "string" },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_external_wealth",
    title: "Update External Exposure & Cash Reserve",
    description:
      "Update external equity exposure, vested percentage, near-term liquidity reserve, or custody label inside ${PLUGIN_DATA}/profile.yaml and refresh the Investment OS dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        external_amount_base: { type: "number" },
        external_enabled: { type: "boolean" },
        external_label: { type: "string" },
        external_ticker: { type: ["string", "null"] },
        vested_pct: { type: ["number", "null"] },
        reserve_amount_base: { type: "number" },
        reserve_enabled: { type: "boolean" },
        reserve_label: { type: "string" },
        horizon_months: { type: ["integer", "null"] },
        custody_label: { type: "string" },
      },
    },
    _meta: INLINE_META,
  },
  {
    name: "update_thesis",
    title: "Create or Update Stock Thesis Card",
    description:
      "Create or update a living thesis card (${PLUGIN_DATA}/theses/<TICKER>.md) with pre-set buy/trim zones, binary gates, catalyst dates, kill-switches, and dated decision log notes.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        role: { type: "string" },
        yf_symbol: { type: "string" },
        currency: { type: "string" },
        us_situs: { type: "boolean" },
        buy_zone_low: { type: ["number", "null"] },
        buy_zone_high: { type: ["number", "null"] },
        trim_zone: { type: ["number", "null"] },
        clear_buy_zone: { type: "boolean" },
        clear_trim_zone: { type: "boolean" },
        gated: { type: "boolean" },
        max_weight_pct: { type: ["number", "null"] },
        next_catalyst_date: { type: ["string", "null"] },
        next_catalyst: { type: ["string", "null"] },
        core_thesis: { type: "array", items: { type: "string" } },
        kill_switches: { type: "array", items: { type: "string" } },
        decision_log_note: { type: "string" },
      },
      required: ["ticker"],
    },
    _meta: INLINE_META,
  },
  {
    name: "manage_catalysts",
    title: "Manage Binary Catalysts & SEC Gates",
    description:
      "Add, remove, or replace tracked catalyst dates and optional SEC form filing gates in ${PLUGIN_DATA}/catalysts.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "replace"] },
        catalyst: {
          type: "object",
          properties: {
            id: { type: "string" },
            date: { type: "string" },
            ticker: { type: "string" },
            title: { type: "string" },
            detail: { type: "string" },
            urgency: { type: "string", enum: ["high", "medium", "low"] },
            sec_gate: {
              type: "object",
              properties: {
                form: { type: "string" },
                filed_after: { type: "string" },
                description: { type: "string" },
              },
              required: ["form", "filed_after", "description"],
            },
          },
        },
        catalysts: {
          type: "array",
          items: { type: "object" },
        },
        id: { type: "string" },
        ticker: { type: "string" },
        date: { type: "string" },
      },
      required: ["action"],
    },
    _meta: INLINE_META,
  },
  {
    name: "check_sec_edgar",
    title: "Poll SEC EDGAR Filings",
    description:
      "Fetch recent official SEC EDGAR filings (10-K, 10-Q, 8-K, 20-F, 6-K, DEF 14A) for any US-listed tickers and evaluate configured filing gates.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tickers (defaults to US-situs portfolio holdings + catalyst watchlist).",
        },
        ticker: {
          type: "string",
          description: "Optional single ticker shorthand.",
        },
      },
    },
    _meta: INLINE_META,
  },
  // App-only UI tools
  {
    name: "app_get_dashboard",
    title: "App Refresh Dashboard",
    description: "Internal UI tool to load, demo-preview, or live-refresh Investment OS state.",
    inputSchema: {
      type: "object",
      properties: {
        live: { type: "boolean" },
        tab: { type: "string" },
        demo: { type: "boolean" },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_check_edgar",
    title: "App Poll SEC EDGAR",
    description: "Internal UI tool to poll SEC EDGAR filings and evaluate active filing gates.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: { type: "array", items: { type: "string" } },
      },
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_save_external_wealth",
    title: "App Save External Wealth",
    description: "Internal UI tool to persist external exposure and cash reserve sliders into profile.yaml.",
    inputSchema: {
      type: "object",
      properties: {
        external_amount_base: { type: "number" },
        reserve_amount_base: { type: "number" },
        vested_pct: { type: ["number", "null"] },
      },
      required: ["external_amount_base", "reserve_amount_base"],
    },
    _meta: APP_ONLY_META,
  },
  {
    name: "app_save_trigger",
    title: "App Save Trigger Zones",
    description: "Internal UI tool to update thesis frontmatter buy/trim trigger zones.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        buy_zone_low: { type: ["number", "null"] },
        buy_zone_high: { type: ["number", "null"] },
        trim_zone: { type: ["number", "null"] },
        gated: { type: "boolean" },
      },
      required: ["ticker"],
    },
    _meta: APP_ONLY_META,
  },
];

function collectDefaultEdgarTickers(dataDir: string): string[] {
  const portfolio = loadPortfolio(dataDir);
  const catalysts = loadCatalysts(dataDir);
  const profile = loadProfile(dataDir);
  const set = new Set<string>();

  if (portfolio) {
    for (const p of portfolio.positions) {
      if (p.us_situs || p.asset_type.includes("ADR")) {
        set.add(p.ticker);
      }
    }
  }
  for (const c of catalysts) {
    set.add(c.ticker);
  }
  if (profile.external_exposure.enabled && profile.external_exposure.ticker) {
    set.add(profile.external_exposure.ticker.toUpperCase());
  }
  return Array.from(set).sort();
}

function mergeProfileUpdate(current: UserProfile, args: Record<string, unknown>): UserProfile {
  const next: UserProfile = structuredClone(current);
  if (args.base_currency !== undefined) next.base_currency = CurrencySchema.parse(args.base_currency);
  if (args.timezone !== undefined) next.timezone = z.string().trim().min(1).max(64).parse(args.timezone);
  if (args.edgar_user_agent !== undefined) {
    next.edgar_user_agent = args.edgar_user_agent === null ? undefined : String(args.edgar_user_agent);
  }
  if (args.custody_label !== undefined) next.custody_label = z.string().trim().min(1).max(80).parse(args.custody_label);
  if (args.tax_profile && typeof args.tax_profile === "object") {
    next.tax_profile = ProfileSchema.shape.tax_profile.parse({
      ...next.tax_profile,
      ...(args.tax_profile as Record<string, unknown>),
    });
  }
  if (args.external_exposure && typeof args.external_exposure === "object") {
    next.external_exposure = ProfileSchema.shape.external_exposure.parse({
      ...next.external_exposure,
      ...(args.external_exposure as Record<string, unknown>),
    });
  }
  if (args.liquidity_reserve && typeof args.liquidity_reserve === "object") {
    next.liquidity_reserve = ProfileSchema.shape.liquidity_reserve.parse({
      ...next.liquidity_reserve,
      ...(args.liquidity_reserve as Record<string, unknown>),
    });
  }
  if (Array.isArray(args.risk_caps)) {
    next.risk_caps = z.array(RiskCapRuleSchema).parse(args.risk_caps);
  }
  return ProfileSchema.parse(next);
}

const server = new Server(
  { name: "investment-os-dashboard", version: "0.2.0" },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: "Personal-CIO portfolio dashboard and local analytics server for Investment OS.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: APP_URI,
      name: "Investment OS Dashboard",
      title: "Investment OS Sidecar UI",
      description:
        "Interactive Personal-CIO sidecar UI (multi-currency holdings, ETF look-through, risk caps, thesis trigger zones, and SEC EDGAR filings).",
      mimeType: APP_MIME,
      _meta: { ui: { prefersBorder: false } },
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== APP_URI) {
    throw new Error(`Unknown resource URI: ${request.params.uri}`);
  }
  const htmlPath = resolveHtmlPath();
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Built dashboard HTML not found at ${htmlPath}`);
  }
  const htmlText = fs.readFileSync(htmlPath, "utf-8");
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: APP_MIME,
        text: htmlText,
        _meta: { ui: { prefersBorder: false } },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "open_dashboard" || name === "app_get_dashboard") {
      const live = Boolean(args.live);
      const demo = Boolean(args.demo);
      const tab = typeof args.tab === "string" ? args.tab : "overview";
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        live,
        activeTab: tab,
        demo,
      });
      return {
        content: [{ type: "text", text: buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_profile") {
      const current = loadProfile(DATA_DIR);
      const saved = saveProfile(DATA_DIR, mergeProfileUpdate(current, args));
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "overview",
      });
      return {
        content: [{ type: "text", text: `Updated profile.yaml (Base: ${saved.base_currency}).\n` + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_portfolio_positions") {
      const profile = loadProfile(DATA_DIR);
      const existing = loadPortfolio(DATA_DIR);
      const mode = args.mode === "upsert" ? "upsert" : "replace";
      const positions = Array.isArray(args.positions)
        ? args.positions.map((r) => PositionInputSchema.parse(r))
        : undefined;
      const fxRates = args.fx_rates
        ? z.record(CurrencySchema, z.number().finite().positive()).parse(args.fx_rates)
        : undefined;
      const merged = mergePortfolioPositions(existing, profile, {
        mode,
        positions,
        cash_base: args.cash_base !== undefined ? z.number().finite().parse(args.cash_base) : undefined,
        accruals_base: args.accruals_base !== undefined ? z.number().finite().parse(args.accruals_base) : undefined,
        fx_rates: fxRates,
        source: typeof args.source === "string" ? args.source : undefined,
      });
      savePortfolio(DATA_DIR, merged);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "holdings",
      });
      return {
        content: [{ type: "text", text: "Updated portfolio.json.\n" + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_external_wealth" || name === "app_save_external_wealth") {
      const profile = loadProfile(DATA_DIR);
      const next = structuredClone(profile);
      if (args.external_amount_base !== undefined) {
        const val = z.number().finite().min(0).parse(args.external_amount_base);
        next.external_exposure.amount_base = val;
        if (args.external_enabled === undefined) {
          next.external_exposure.enabled = val > 0 || next.external_exposure.enabled;
        }
      }
      if (args.external_enabled !== undefined) next.external_exposure.enabled = Boolean(args.external_enabled);
      if (args.external_label !== undefined) next.external_exposure.label = String(args.external_label);
      if (args.external_ticker !== undefined) {
        next.external_exposure.ticker =
          args.external_ticker === null ? null : normalizeTicker(String(args.external_ticker));
      }
      if (args.vested_pct !== undefined) {
        next.external_exposure.vested_pct =
          args.vested_pct === null ? null : z.number().finite().min(0).max(100).parse(args.vested_pct);
      }

      if (args.reserve_amount_base !== undefined) {
        const val = z.number().finite().min(0).parse(args.reserve_amount_base);
        next.liquidity_reserve.amount_base = val;
        if (args.reserve_enabled === undefined) {
          next.liquidity_reserve.enabled = val > 0 || next.liquidity_reserve.enabled;
        }
      }
      if (args.reserve_enabled !== undefined) next.liquidity_reserve.enabled = Boolean(args.reserve_enabled);
      if (args.reserve_label !== undefined) next.liquidity_reserve.label = String(args.reserve_label);
      if (args.horizon_months !== undefined) {
        next.liquidity_reserve.horizon_months =
          args.horizon_months === null ? null : z.number().int().min(0).max(600).parse(args.horizon_months);
      }
      if (args.custody_label !== undefined) {
        next.custody_label = z.string().trim().min(1).max(80).parse(args.custody_label);
      }

      saveProfile(DATA_DIR, next);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "overview",
      });
      return {
        content: [{ type: "text", text: "Updated profile.yaml external exposure & cash reserve.\n" + buildSummaryText(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "update_thesis" || name === "app_save_trigger") {
      const normalizedArgs: Record<string, unknown> = { ...args };
      if (name === "app_save_trigger") {
        if (
          ("buy_zone_low" in args && args.buy_zone_low === null) ||
          ("buy_zone_high" in args && args.buy_zone_high === null)
        ) {
          normalizedArgs.clear_buy_zone = true;
        }
        if ("trim_zone" in args && args.trim_zone === null) {
          normalizedArgs.clear_trim_zone = true;
        }
      }
      const parsed = ThesisUpdateSchema.parse(normalizedArgs);
      const profile = loadProfile(DATA_DIR);
      const writtenPath = saveOrMergeThesis(DATA_DIR, profile, parsed);
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "theses",
      });
      return {
        content: [{ type: "text", text: `Saved ${path.basename(writtenPath)}.` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "manage_catalysts") {
      const action = z.enum(["add", "remove", "replace"]).parse(args.action);
      let current = loadCatalysts(DATA_DIR);
      if (action === "replace") {
        const list = z.array(CatalystSchema).parse(args.catalysts ?? []);
        current = saveCatalysts(DATA_DIR, list);
      } else if (action === "add") {
        const item = CatalystSchema.parse(args.catalyst);
        const filtered = current.filter(
          (c) =>
            !(
              (item.id && c.id === item.id) ||
              (c.date === item.date && c.ticker === item.ticker && c.title === item.title)
            ),
        );
        filtered.push(item);
        filtered.sort((a, b) => a.date.localeCompare(b.date));
        current = saveCatalysts(DATA_DIR, filtered);
      } else if (action === "remove") {
        const id = typeof args.id === "string" ? args.id : undefined;
        const ticker = typeof args.ticker === "string" ? normalizeTicker(args.ticker) : undefined;
        const date = typeof args.date === "string" ? args.date : undefined;
        const filtered = current.filter((c) => {
          if (id && c.id === id) return false;
          if (ticker && date && c.ticker === ticker && c.date === date) return false;
          if (ticker && !date && !id && c.ticker === ticker) return false;
          return true;
        });
        current = saveCatalysts(DATA_DIR, filtered);
      }
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "edgar",
      });
      return {
        content: [{ type: "text", text: `Updated catalysts.yaml (${current.length} tracked catalysts).` }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    if (name === "check_sec_edgar" || name === "app_check_edgar") {
      const profile = loadProfile(DATA_DIR);
      const catalysts: CatalystRecord[] = loadCatalysts(DATA_DIR);
      let targets: string[] = [];
      if (Array.isArray(args.tickers) && args.tickers.length > 0) {
        targets = args.tickers.map((t) => normalizeTicker(String(t)));
      } else if (typeof args.ticker === "string" && args.ticker.trim()) {
        targets = [normalizeTicker(args.ticker)];
      } else {
        targets = collectDefaultEdgarTickers(DATA_DIR);
      }
      const { iso } = formatTimestamp(new Date(), profile.timezone);
      const { cache, skippedTickers } =
        targets.length > 0
          ? await pollEdgarFilings(DATA_DIR, profile, targets, catalysts, iso)
          : {
              cache: { checked_at: iso, gate_evaluations: [], filings_by_ticker: {} },
              skippedTickers: [],
            };
      const payload = await buildDashboardPayload({
        dataDir: DATA_DIR,
        pluginRoot: PLUGIN_ROOT,
        activeTab: "edgar",
      });
      const gateLines = cache.gate_evaluations.map(
        (g) => `${g.ticker} (${g.form} after ${g.filed_after}): ${g.cleared ? "CLEARED" : "OPEN"} — ${g.description}`,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `SEC EDGAR checked (${cache.checked_at}) for ${targets.length} ticker(s).` +
              (skippedTickers.length > 0 ? `\nNon-SEC/Skipped: ${skippedTickers.join(", ")}` : "") +
              (gateLines.length > 0 ? `\nGates:\n- ${gateLines.join("\n- ")}` : ""),
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error in ${name}: ${msg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal MCP server error: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
