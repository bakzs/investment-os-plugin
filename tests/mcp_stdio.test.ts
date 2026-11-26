import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function findNodeRuntime(): string {
  const probe = spawnSync("which", ["agy-node"], { encoding: "utf-8" });
  if (probe.status === 0 && probe.stdout.trim()) {
    return probe.stdout.trim();
  }
  return process.execPath;
}

test("bundled dist/server.cjs passes end-to-end v0.7 stdio MCP App lifecycle", async () => {
  const rootDir = path.resolve(process.cwd());
  const serverPath = path.join(rootDir, "dist", "server.cjs");
  assert.equal(fs.existsSync(serverPath), true, "dist/server.cjs must be built before running stdio test");

  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-stdio-"));
  const transport = new StdioClientTransport({
    command: findNodeRuntime(),
    args: [serverPath, `--data-dir=${tempDataDir}`],
    cwd: rootDir,
  });

  const client = new Client(
    { name: "investment-os-test-client", version: "0.7.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // 1. Verify tools metadata, entrypoints, and visibility
    const toolsResp = await client.listTools();
    const byName = new Map(toolsResp.tools.map((t) => [t.name, t]));

    const openTool = byName.get("open_dashboard");
    assert.ok(openTool);
    const openMeta = openTool._meta as Record<string, unknown>;
    assert.deepEqual(openMeta?.ui, { resourceUri: "ui://investment-os/v7/dashboard.html" });
    const agyUi = openMeta?.["com.google.antigravity/ui"] as { entrypoints?: Array<{ type: string; title: string }> };
    assert.equal(agyUi?.entrypoints?.length, 2);

    for (const inlineToolName of [
      "record_thesis_test",
      "upsert_dossier",
      "upsert_theme",
      "ingest_research_intel",
      "sync_fundamentals_xbrl",
      "sync_insiders_form4",
      "run_watchdog_sweep",
      "update_etf_weights",
      "run_portfolio_backtest",
      "simulate_portfolio_forecast",
    ]) {
      const tool = byName.get(inlineToolName);
      assert.ok(tool, `missing ${inlineToolName}`);
      assert.deepEqual((tool._meta as Record<string, unknown>)?.ui, {
        resourceUri: "ui://investment-os/v7/dashboard.html",
      });
    }

    for (const appToolName of [
      "app_get_dashboard",
      "app_check_edgar",
      "app_run_watchdog",
      "app_get_theme_detail",
      "app_ack_alert",
      "app_save_external_wealth",
      "app_save_trigger",
      "app_upsert_hypothesis",
      "app_get_dossier_detail",
      "app_save_dossier_model",
      "app_run_backtest",
      "app_simulate_forecast",
    ]) {
      const appTool = byName.get(appToolName);
      assert.ok(appTool, `missing ${appToolName}`);
      assert.deepEqual((appTool._meta as Record<string, unknown>)?.ui, { visibility: ["app"] });
    }

    // 2. Verify resource listing and HTML content
    const resList = await client.listResources();
    assert.equal(resList.resources[0]?.uri, "ui://investment-os/v7/dashboard.html");
    assert.equal(resList.resources[0]?.mimeType, "text/html;profile=mcp-app");

    const resRead = await client.readResource({ uri: "ui://investment-os/v7/dashboard.html" });
    const item = resRead.contents[0];
    assert.ok(item && "text" in item);
    assert.equal(item.mimeType, "text/html;profile=mcp-app");
    assert.equal(item.text.includes("Investment OS"), true);
    assert.equal(item.text.includes("v0.7"), true);
    assert.equal(item.text.includes('<dialog id="stock-inspector"'), true);
    assert.equal(Buffer.byteLength(item.text, "utf-8") < 1_000_000, true);

    // 3. Empty data directory boots cleanly without initializing files
    const emptyCall = await client.callTool({ name: "open_dashboard", arguments: {} });
    const emptyPayload = emptyCall.structuredContent as { initialized: boolean; is_demo: boolean };
    assert.equal(emptyPayload.initialized, false);
    assert.equal(fs.readdirSync(tempDataDir).length, 0);

    // 4. Demo mode renders synthetic v0.7 preview + BL/Bootstrap forecast + demo dossier detail + demo theme detail + DSR backtest without writing files
    const demoCall = await client.callTool({ name: "app_get_dashboard", arguments: { demo: true } });
    const demoPayload = demoCall.structuredContent as {
      initialized: boolean;
      is_demo: boolean;
      macro_regime: { regime_label: string } | null;
      rotation_queue: { tax_swaps: unknown[]; mandatory_exits: unknown[] };
      forecast: {
        return_model: string;
        simulation_engine_used: string;
        baseline: { ending_p50_base: number; ending_cvar_10_base: number; factor_risk: { effective_bets: number } };
        simulated: { ending_p50_base: number; ending_cvar_10_base: number; factor_risk: { effective_bets: number } };
      } | null;
      themes: Array<{ slug: string }>;
      alerts: unknown[];
      portfolio: { positions: unknown[] };
      lab: { active_count: number; bench_count: number; passed_count: number };
    };
    assert.equal(demoPayload.initialized, true);
    assert.equal(demoPayload.is_demo, true);
    assert.equal(demoPayload.macro_regime?.regime_label, "CALM");
    assert.equal(demoPayload.rotation_queue.tax_swaps.length >= 1, true);
    assert.equal(demoPayload.rotation_queue.mandatory_exits.length >= 1, true);
    assert.equal(demoPayload.forecast?.return_model, "black_litterman");
    assert.equal(demoPayload.forecast?.simulation_engine_used, "block_bootstrap");
    assert.equal(Boolean(demoPayload.forecast && demoPayload.forecast.simulated.ending_p50_base > 0), true);
    assert.equal(Boolean(demoPayload.forecast && demoPayload.forecast.simulated.factor_risk.effective_bets >= 1), true);
    assert.equal(demoPayload.themes.length >= 1, true);
    assert.equal(demoPayload.alerts.length >= 1, true);
    assert.equal(demoPayload.lab.active_count, 3);
    assert.equal(demoPayload.lab.bench_count, 1);
    assert.equal(demoPayload.lab.passed_count, 1);

    const demoForecastCall = await client.callTool({
      name: "app_simulate_forecast",
      arguments: { demo: true, horizon_years: 5, apply_recommended_rotations: true, simulations: 400 },
    });
    const demoForecast = demoForecastCall.structuredContent as {
      horizon_years: number;
      deltas: { estate_tax_saved_base: number };
      simulated: { ending_cvar_10_base: number; ending_p10_base: number; ending_p50_base: number; ending_p90_base: number };
      positions: Array<{ hrp_weight_pct: number; is_cash: boolean }>;
    };
    assert.equal(demoForecast.horizon_years, 5);
    assert.equal(demoForecast.simulated.ending_cvar_10_base <= demoForecast.simulated.ending_p10_base, true);
    assert.equal(demoForecast.simulated.ending_p10_base < demoForecast.simulated.ending_p50_base, true);
    assert.equal(demoForecast.simulated.ending_p50_base < demoForecast.simulated.ending_p90_base, true);
    assert.equal(demoForecast.deltas.estate_tax_saved_base > 0, true);
    assert.equal(demoForecast.positions.some((p) => !p.is_cash && p.hrp_weight_pct > 0), true);

    const demoDetailCall = await client.callTool({
      name: "app_get_dossier_detail",
      arguments: { ticker: "MSFT", demo: true },
    });
    const demoDetail = demoDetailCall.structuredContent as {
      ticker: string;
      memo_md: string | null;
      fundamentals: unknown;
      insiders: unknown;
      valuation_bands: unknown;
      linked_themes: unknown[];
    };
    assert.equal(demoDetail.ticker, "MSFT");
    assert.equal(Boolean(demoDetail.memo_md), true);
    assert.equal(Boolean(demoDetail.fundamentals), true);
    assert.equal(Boolean(demoDetail.insiders), true);
    assert.equal(Boolean(demoDetail.valuation_bands), true);
    assert.equal(demoDetail.linked_themes.length >= 1, true);

    const demoThemeCall = await client.callTool({
      name: "app_get_theme_detail",
      arguments: { slug: "cloud-capex-vs-software-roi", demo: true },
    });
    const demoTheme = demoThemeCall.structuredContent as {
      slug: string;
      theme: { title: string } | null;
      memo_md: string | null;
      linked_theses: unknown[];
    };
    assert.equal(demoTheme.slug, "cloud-capex-vs-software-roi");
    assert.equal(Boolean(demoTheme.theme?.title), true);
    assert.equal(Boolean(demoTheme.memo_md), true);
    assert.equal(demoTheme.linked_theses.length >= 1, true);

    const demoBtCall = await client.callTool({
      name: "app_run_backtest",
      arguments: { candidate_ticker: "ACME", target_weight_pct: 8, funding_source: "cash", tx_cost_bps: 10, trials_tested: 12, demo: true },
    });
    const demoBt = demoBtCall.structuredContent as {
      candidate_ticker: string;
      weeks_analyzed: number;
      tx_cost_bps: number;
      trials_tested: number;
      baseline: { sharpe_se: number; rebalance_count: number; cvar_95_weekly_pct: number };
      simulated: { deflated_sharpe_prob_pct: number; tx_cost_drag_bps: number };
    };
    assert.equal(demoBt.candidate_ticker, "ACME");
    assert.equal(demoBt.weeks_analyzed >= 250, true);
    assert.equal(demoBt.tx_cost_bps, 10);
    assert.equal(demoBt.trials_tested, 12);
    assert.equal(demoBt.baseline.sharpe_se > 0, true);
    assert.equal(demoBt.baseline.cvar_95_weekly_pct <= 0, true);
    assert.equal(demoBt.simulated.deflated_sharpe_prob_pct >= 0 && demoBt.simulated.deflated_sharpe_prob_pct <= 100, true);
    assert.equal(demoBt.simulated.tx_cost_drag_bps > 0, true);
    assert.equal(fs.readdirSync(tempDataDir).length, 0);

    // 5. Full v0.5 agent round-trip persistence (themes, etf_weights, dossiers, intel_history, watchdog, ack, tests)
    await client.callTool({
      name: "update_profile",
      arguments: {
        base_currency: "GBP",
        timezone: "Europe/London",
        benchmark: {
          ticker: "VWRA",
          yf_symbol: "VWRA.L",
          expected_cagr_pct: 8.0,
          alpha_buffer_pct: 2.5,
          estate_tax_drag_mode: "hedge",
          estate_tax_hedge_bps: 35,
        },
        tax_profile: { country_code: "UK", nra_us_estate_tax_enabled: true },
        external_exposure: { enabled: true, label: "RSU Pool", ticker: "AAPL", amount_base: 25000, us_situs: true },
        liquidity_reserve: { enabled: true, label: "Tax Reserve", amount_base: 5000 },
      },
    });

    await client.callTool({
      name: "update_portfolio_positions",
      arguments: {
        cash_base: 10000,
        fx_rates: { USD: 0.8 },
        positions: [
          { ticker: "VWRA", qty: 100, avg_cost: 160, ref_price: 175, currency: "USD" },
          { ticker: "AAPL", qty: 50, avg_cost: 190, ref_price: 220, currency: "USD" },
        ],
      },
    });

    await client.callTool({
      name: "update_etf_weights",
      arguments: {
        as_of: "2026-11-25",
        etf_weights: { VWRA: { AAPL: 0.04, MSFT: 0.038 } },
        etf_metadata: { VWRA: { domicile: "Ireland", us_situs: false, ocf_pct: 0.22 } },
      },
    });

    await client.callTool({
      name: "upsert_theme",
      arguments: {
        slug: "edge-ai-services",
        title: "Edge AI & Services Monetization",
        relationship_mode: "structural",
        summary: "Tracks on-device inference monetization across hardware ecosystems.",
        exposures: [{ ticker: "AAPL", stance: "beneficiary", note: "High-margin services attach." }],
        memo_md: "# Edge AI Theme\n\nStdio theme round-trip check.",
      },
    });

    await client.callTool({
      name: "upsert_dossier",
      arguments: {
        ticker: "AAPL",
        tier: "active",
        action_verdict: "WAIT",
        theme_refs: ["edge-ai-services"],
        takeaway: ["High-margin Services recurring base.", "Await buy zone $190-$215."],
        buy_zone_low: 190,
        buy_zone_high: 215,
        trim_zone: 260,
        decision_log_note: "Round-trip stdio test decision.",
        memo_md: "# AAPL Memo\n\nStdio round-trip check.",
        model: {
          horizon_years: 5,
          dividend_yield_pct: 0.45,
          scenarios: {
            bear: { probability: 0.25, target_price_5y: 180, summary: "Bear" },
            base: { probability: 0.5, target_price_5y: 340, summary: "Base" },
            bull: { probability: 0.25, target_price_5y: 420, summary: "Bull" },
          },
        },
      },
    });

    await client.callTool({
      name: "ingest_research_intel",
      arguments: {
        ticker: "AAPL",
        intel: {
          updated_at: "2026-11-25T00:00:00Z",
          provider: "ibkr",
          earnings_insight: { period: "Q4 FY26", kind: "recap", headline: "Services beat", summary: "Services +13%." },
          themes: ["Consumer Ecosystem"],
        },
        pa_performance: {
          updated_at: "2026-11-25T00:00:00Z",
          provider: "ibkr",
          base_currency: "GBP",
          periods: [{ period: "YTD", twr_pct: 12.5 }],
        },
      },
    });

    await client.callTool({
      name: "app_save_dossier_model",
      arguments: {
        ticker: "AAPL",
        rationale: "Raised base target slightly after Services check.",
        model: {
          horizon_years: 5,
          dividend_yield_pct: 0.5,
          scenarios: {
            bear: { probability: 0.25, target_price_5y: 185, summary: "Updated bear" },
            base: { probability: 0.5, target_price_5y: 350, summary: "Updated base" },
            bull: { probability: 0.25, target_price_5y: 430, summary: "Updated bull" },
          },
        },
      },
    });

    await client.callTool({
      name: "manage_catalysts",
      arguments: {
        action: "add",
        catalyst: {
          id: "aapl-earnings",
          date: "2027-02-01",
          ticker: "AAPL",
          title: "Q1 FY27 Form 10-Q Check",
          detail: "Verify gross margin & buyback cadence.",
          urgency: "medium",
          sec_gate: { form: "10-Q", filed_after: "2027-01-15", description: "Q1 FY27 10-Q" },
        },
      },
    });

    await client.callTool({
      name: "app_upsert_hypothesis",
      arguments: {
        ticker: "AAPL",
        hypothesis: {
          id: "services-margin-mix",
          claim: "Services gross margin stays above 70% alongside hardware cycle growth",
          metric: "Services gross margin >= 70%",
          status: "untested",
          confidence: "medium",
          is_core: true,
        },
      },
    });

    await client.callTool({
      name: "record_thesis_test",
      arguments: {
        ticker: "AAPL",
        verdict: "HIGH_CONVICTION",
        action_verdict: "GO",
        kill_switch_triggered: false,
        summary: "Services recurring base exceeded margin threshold in Q1.",
        bear_case: "Hardware replacement elongation or App Store regulatory fee compression.",
        price_at_test: 220,
        currency: "USD",
        hypotheses_tested: [
          {
            id: "services-margin-mix",
            claim: "Services gross margin stays above 70% alongside hardware cycle growth",
            metric: "Services gross margin >= 70%",
            status: "supported",
            confidence: "high",
            is_core: true,
            evidence: "10-Q confirmed Services gross margin expanded above 72%.",
          },
        ],
      },
    });

    // Offline watchdog sweep (no network calls) + ack tool round-trip
    const wdCall = await client.callTool({
      name: "run_watchdog_sweep",
      arguments: {
        include_quotes: false,
        include_macro: false,
        include_edgar: false,
        include_xbrl: false,
        include_insiders: false,
      },
    });
    assert.equal(Boolean(wdCall.isError), false);

    const ackCall = await client.callTool({ name: "app_ack_alert", arguments: { ids: ["*"] } });
    assert.equal(Boolean(ackCall.isError), false);

    const detailCall = await client.callTool({ name: "app_get_dossier_detail", arguments: { ticker: "AAPL" } });
    const detail = detailCall.structuredContent as {
      ticker: string;
      memo_md: string | null;
      model: { scenarios?: { base: { target_price_5y: number } } } | null;
      intel: { themes: string[] } | null;
      intel_history: unknown[];
      linked_themes: Array<{ slug: string }>;
    };
    assert.equal(detail.ticker, "AAPL");
    assert.equal(detail.memo_md?.includes("Stdio round-trip check"), true);
    assert.equal(detail.model?.scenarios?.base.target_price_5y, 350);
    assert.deepEqual(detail.intel?.themes, ["Consumer Ecosystem"]);
    assert.equal(detail.intel_history.length, 1);
    assert.equal(detail.linked_themes[0]?.slug, "edge-ai-services");

    const themeDetailCall = await client.callTool({
      name: "app_get_theme_detail",
      arguments: { slug: "edge-ai-services" },
    });
    const themeDetail = themeDetailCall.structuredContent as {
      slug: string;
      memo_md: string | null;
      linked_theses: Array<{ ticker: string }>;
    };
    assert.equal(themeDetail.slug, "edge-ai-services");
    assert.equal(themeDetail.memo_md?.includes("Stdio theme round-trip check"), true);
    assert.equal(themeDetail.linked_theses[0]?.ticker, "AAPL");

    const forecastCall = await client.callTool({
      name: "simulate_portfolio_forecast",
      arguments: {
        horizon_years: 5,
        simulations: 400,
        apply_recommended_rotations: false,
        actions: [{ type: "park_cash_in_benchmark" }],
      },
    });
    assert.equal(Boolean(forecastCall.isError), false);
    const forecastPayload = forecastCall.structuredContent as {
      forecast: { simulated: { ending_p50_base: number; ending_cash_base: number } } | null;
    };
    assert.equal(Boolean(forecastPayload.forecast && forecastPayload.forecast.simulated.ending_p50_base > 0), true);
    // Preserves configured £5,000 liquidity_reserve while sweeping £5,000 excess cash into VWRA
    assert.equal(forecastPayload.forecast?.simulated.ending_cash_base, 5000);

    const finalCall = await client.callTool({ name: "open_dashboard", arguments: {} });
    const finalPayload = finalCall.structuredContent as {
      initialized: boolean;
      base_currency: string;
      themes: Array<{ slug: string }>;
      portfolio: { nav_base: number; positions: Array<{ ticker: string }> };
      theses: Array<{
        ticker: string;
        verdict: string | null;
        has_memo: boolean;
        has_model: boolean;
        has_intel: boolean;
        hypothesis_counts: { total: number; supported: number };
        recent_tests: Array<{ verdict: string }>;
        recent_rule_changes: Array<{ event_type: string }>;
      }>;
      catalysts: Array<{ ticker: string }>;
      edgar: { gate_evaluations: Array<{ ticker: string; cleared: boolean }> };
      lab: { active_count: number; pa_performance: { periods: Array<{ period: string }> } | null };
    };
    assert.equal(finalPayload.initialized, true);
    assert.equal(finalPayload.base_currency, "GBP");
    assert.equal(finalPayload.portfolio.nav_base, 32800);
    assert.equal(finalPayload.themes[0]?.slug, "edge-ai-services");
    assert.equal(finalPayload.theses[0]?.ticker, "AAPL");
    assert.equal(finalPayload.theses[0]?.verdict, "HIGH_CONVICTION");
    assert.equal(finalPayload.theses[0]?.has_memo, true);
    assert.equal(finalPayload.theses[0]?.has_model, true);
    assert.equal(finalPayload.theses[0]?.has_intel, true);
    assert.equal(finalPayload.theses[0]?.hypothesis_counts.total, 1);
    assert.equal(finalPayload.theses[0]?.hypothesis_counts.supported, 1);
    assert.equal(finalPayload.theses[0]?.recent_tests.length, 1);
    assert.equal(finalPayload.theses[0]?.recent_rule_changes.length, 1);
    assert.equal(finalPayload.lab.active_count, 1);
    assert.equal(finalPayload.lab.pa_performance?.periods[0]?.period, "YTD");
    assert.equal(fs.existsSync(path.join(tempDataDir, "test_log.jsonl")), true);
    assert.equal(fs.existsSync(path.join(tempDataDir, "etf_weights.json")), true);
    assert.equal(finalPayload.catalysts[0]?.ticker, "AAPL");
    assert.equal(finalPayload.edgar.gate_evaluations[0]?.ticker, "AAPL");
    assert.equal(finalPayload.edgar.gate_evaluations[0]?.cleared, false);
  } finally {
    await client.close();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
});
