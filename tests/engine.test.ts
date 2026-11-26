import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDashboardPayload,
  canonicalAssetName,
  classifyTriggerStatus,
  computeUsEstateTaxNra,
  executePortfolioBacktest,
  getDossierDetail,
  getThemeDetail,
  ingestResearchIntel,
  mergePortfolioPositions,
  recordThesisTest,
  saveDossierModelWithAudit,
  saveOrMergeThesis,
  upsertDossier,
  upsertSingleHypothesis,
  upsertTheme,
} from "../src/server/engine.js";
import { ensureHistorySeries } from "../src/server/market.js";
import { ProfileSchema } from "../src/server/schema.js";
import {
  ackWatchdogAlerts,
  loadIntelHistory,
  loadThesisTestLog,
  loadWatchdogAlerts,
  saveDossierFundamentals,
  saveEdgarCache,
  saveHistoryCache,
  saveMacroRegime,
  saveMarketCache,
  savePortfolio,
  saveProfile,
} from "../src/server/storage.js";
import { runWatchdogSweep } from "../src/server/watchdog.js";

test("computeUsEstateTaxNra matches exact IRC §2101(c) schedule", () => {
  assert.equal(computeUsEstateTaxNra(0).net_estate_tax_usd, 0);
  assert.equal(computeUsEstateTaxNra(60000).net_estate_tax_usd, 0);

  const justOver = computeUsEstateTaxNra(60001);
  assert.equal(justOver.net_estate_tax_usd, 0.26);
  assert.equal(justOver.marginal_rate_pct, 26);

  const at250 = computeUsEstateTaxNra(250000);
  assert.equal(at250.net_estate_tax_usd, 57800);
  assert.equal(at250.marginal_rate_pct, 32);

  const at500 = computeUsEstateTaxNra(500000);
  assert.equal(at500.net_estate_tax_usd, 142800);
  assert.equal(at500.marginal_rate_pct, 34);

  const at1m = computeUsEstateTaxNra(1000000);
  assert.equal(at1m.net_estate_tax_usd, 332800);
  assert.equal(at1m.marginal_rate_pct, 39);

  const at15m = computeUsEstateTaxNra(1500000);
  assert.equal(at15m.net_estate_tax_usd, 532800);
  assert.equal(at15m.marginal_rate_pct, 40);
});

test("multi-currency NAV, GOOG/GOOGL canonical look-through, ETF residuals, risk caps & newest latest_decision fix", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-engine-"));
  const pluginRoot = path.resolve(process.cwd());
  try {
    const profile = ProfileSchema.parse({
      base_currency: "EUR",
      timezone: "Europe/Berlin",
      tax_profile: {
        country_code: "DE",
        nra_us_estate_tax_enabled: false,
        us_dividend_wht_pct: 15,
        ucits_dividend_wht_pct: 15,
        cgt_pct: 26.375,
      },
      risk_caps: [
        { id: "single-max", label: "Max Single Name", kind: "single_name_max", cap_pct: 25 },
        {
          id: "tech-bucket",
          label: "Tech & Semis",
          kind: "bucket",
          cap_pct: 30,
          tickers: ["MSFT", "GOOG/GOOGL", "NVDA"],
          include_etf_residual_key: "other_semis_residual",
        },
      ],
    });
    saveProfile(tempDir, profile);

    const portfolio = mergePortfolioPositions(null, profile, {
      cash_base: 5000,
      accruals_base: 0,
      fx_rates: { USD: 0.9, EUR: 1.0 },
      positions: [
        { ticker: "SPY", qty: 100, avg_cost: 500, ref_price: 600, currency: "USD" },
        { ticker: "GOOGL", qty: 50, avg_cost: 180, ref_price: 200, currency: "USD" },
        { ticker: "ENR.DE", qty: 100, avg_cost: 40, ref_price: 50, currency: "EUR", us_situs: false },
      ],
    });
    savePortfolio(tempDir, portfolio);

    const payload = await buildDashboardPayload({
      dataDir: tempDir,
      pluginRoot,
      live: false,
      activeTab: "overview",
    });

    assert.equal(payload.initialized, true);
    assert.equal(payload.base_currency, "EUR");
    assert.equal(payload.portfolio.nav_base, 73000);
    assert.equal(canonicalAssetName("GOOG"), "GOOG/GOOGL");
    const googRow = payload.lookthrough.find((r) => r.name === "GOOG/GOOGL");
    assert.ok(googRow);
    assert.equal(googRow.direct_usd, 10000);
    assert.equal(googRow.via_etfs_usd, 3180);
    assert.equal(googRow.total_base, 11862);

    const techCap = payload.risk_caps.find((c) => c.id === "tech-bucket");
    assert.equal(techCap?.status, "PASS");
    assert.equal(techCap?.value_pct, 26.1);

    // Append TWO dated decision log notes: latest_decision MUST pick the LAST (newest) bullet!
    saveOrMergeThesis(tempDir, profile, {
      ticker: "GOOGL",
      buy_zone_low: 170,
      buy_zone_high: 210,
      trim_zone: 260,
      gated: false,
      decision_log_note: "First older decision note.",
    });
    saveOrMergeThesis(tempDir, profile, {
      ticker: "GOOGL",
      decision_log_note: "Second newest decision note.",
    });
    const payload2 = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, live: false });
    assert.equal(payload2.theses[0]?.latest_decision.includes("Second newest decision note."), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("classifyTriggerStatus covers all states cleanly", () => {
  const fm = {
    ticker: "ACME",
    buy_zone_low: 100,
    buy_zone_high: 120,
    trim_zone: 150,
    gated: false,
  };
  assert.equal(classifyTriggerStatus(null, fm), "NO PRICE");
  assert.equal(classifyTriggerStatus(95, fm), "DEEP VALUE / CHECK THESIS");
  assert.equal(classifyTriggerStatus(110, fm), "IN BUY ZONE");
  assert.equal(classifyTriggerStatus(110, { ...fm, gated: true }), "GATED (IN BUY ZONE)");
  assert.equal(classifyTriggerStatus(135, fm), "HOLD / WAIT");
  assert.equal(classifyTriggerStatus(155, fm), "TRIM / EXIT ZONE");
  assert.equal(classifyTriggerStatus(100, { ticker: "NONE" }), "NO ACTIVE ZONE");
});

test("market_cache hydrates FX, extended-hours quotes, sparklines, and live external qty without altering snapshot NAV", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-cache-"));
  const pluginRoot = path.resolve(process.cwd());
  try {
    const profile = ProfileSchema.parse({
      base_currency: "EUR",
      external_exposure: {
        enabled: true,
        label: "External Employer Stock",
        ticker: "MSFT",
        qty: 100,
        amount_base: 40000,
        us_situs: true,
      },
    });
    saveProfile(tempDir, profile);

    const portfolio = mergePortfolioPositions(null, profile, {
      cash_base: 2500,
      accruals_base: 0,
      fx_rates: { USD: 0.9, EUR: 1.0 },
      positions: [{ ticker: "MSFT", qty: 10, avg_cost: 400, ref_price: 500, currency: "USD" }],
    });
    savePortfolio(tempDir, portfolio);

    saveMarketCache(tempDir, {
      updated_at: "2026-11-24T01:00:00Z",
      vix: 24.5,
      vix_sparkline: [26.1, 25.4, 24.5],
      fx_rates: { USD: 0.92, EUR: 1.0 },
      quotes: {
        MSFT: {
          price: 512.0,
          regular_price: 512.0,
          extended_price: 516.5,
          market_state: "POST",
          quote_time: "2026-11-24T21:10:00Z",
          currency: "USD",
          sparkline: [480.0, 492.5, 512.0],
          change_1d_pct: 1.85,
          change_1m_pct: 6.67,
        },
      },
    });

    const snapPayload = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, live: false });
    // Snapshot NAV reconciles exact ref_price & portfolio FX (10 * 500 * 0.9 + 2500 = EUR 7,000)
    assert.equal(snapPayload.portfolio.nav_base, 7000);
    assert.equal(snapPayload.portfolio.positions[0]?.extended_price, 516.5);
    assert.equal(snapPayload.portfolio.positions[0]?.market_state, "POST");
    assert.equal(snapPayload.summary.ext_live_marked, true);
    assert.equal(snapPayload.summary.ext_price_used, 500);

    // useCache uses cached live FX (0.92) & cached quote (512.0) -> 10 * 512 * 0.92 + 2500 = 7210.4
    const cachedPayload = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, live: false, useCache: true });
    assert.equal(cachedPayload.portfolio.nav_base, 7210.4);
    assert.equal(cachedPayload.summary.ext_price_used, 512);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("v0.5 systematic testing auto-captures PIT snapshot & benchmark_price_at_test, logs rule_change events, and hydrates themes/XBRL/anti-softening", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-v5-engine-"));
  const pluginRoot = path.resolve(process.cwd());
  try {
    const profile = ProfileSchema.parse({
      base_currency: "USD",
      tax_profile: { country_code: "SG", nra_us_estate_tax_enabled: true, us_dividend_wht_pct: 30, ucits_dividend_wht_pct: 15 },
    });
    saveProfile(tempDir, profile);
    savePortfolio(
      tempDir,
      mergePortfolioPositions(null, profile, {
        cash_base: 10000,
        fx_rates: { USD: 1.0 },
        positions: [
          { ticker: "VWRA", qty: 100, avg_cost: 160, ref_price: 175, currency: "USD" },
          { ticker: "MSFT", qty: 10, avg_cost: 400, ref_price: 500, currency: "USD" },
        ],
      }),
    );
    saveMacroRegime(tempDir, {
      updated_at: "2026-11-25T00:00:00Z",
      vix: 22.4,
      us10y_pct: 4.35,
      us3m_pct: 4.2,
      hy_credit_ratio: 0.82,
      dxy: 104.1,
      regime_label: "ELEVATED",
    });
    saveMarketCache(tempDir, {
      updated_at: "2026-11-25T00:00:00Z",
      vix: 22.4,
      vix_sparkline: [21.0, 22.4],
      quotes: {
        "VWRA.L": { price: 178.0, currency: "USD", sparkline: [175, 178], change_1d_pct: 0.5, change_1m_pct: 2.0 },
        MSFT: { price: 510.0, currency: "USD", sparkline: [495, 510], change_1d_pct: 1.2, change_1m_pct: 4.0 },
      },
    });
    saveDossierFundamentals(tempDir, "MSFT", {
      ticker: "MSFT",
      updated_at: "2026-11-25T00:00:00Z",
      quarterly: [{ period_end: "2026-09-30", fiscal_period: "Q1", gross_margin_pct: 62.0, dso_days: 55.0 }],
      latest_ratios: { gross_margin_pct: 62.0, dso_days: 55.0 },
    });

    // 1. Upsert dossier with rule-backed hypothesis that is BREACHED (62% < 65%) yet labeled "supported" -> anti-softening warning!
    upsertDossier(tempDir, profile, {
      ticker: "MSFT",
      tier: "active",
      action_verdict: "WAIT",
      last_audited_date: "2026-11-10",
      price_at_audit: 500,
      buy_zone_low: 440,
      buy_zone_high: 470,
      theme_refs: ["cloud-roi"],
      hypotheses: [
        {
          id: "gm-floor",
          claim: "Gross margin stays >= 65%",
          status: "supported",
          confidence: "high",
          is_core: true,
          rule: { source: "xbrl", metric: "gross_margin_pct", op: ">=", threshold: 65, period: "latest_q" },
        },
      ],
      model: {
        horizon_years: 5,
        dividend_yield_pct: 0.7,
        scenarios: {
          bear: { probability: 0.25, target_price_5y: 410, summary: "Bear" },
          base: { probability: 0.5, target_price_5y: 780, summary: "Base" },
          bull: { probability: 0.25, target_price_5y: 980, summary: "Bull" },
        },
      },
    });

    // 2. Shared theme updated AFTER last_audited_date -> must flag theme_updated_after_audit & needs_retest!
    upsertTheme(tempDir, profile, {
      slug: "cloud-roi",
      title: "Cloud Capex vs ROI",
      updated_at: "2026-11-24T12:00:00Z",
      relationship_mode: "symbiotic",
      summary: "Tracks hyperscaler depreciation vs cloud margin.",
      exposures: [{ ticker: "MSFT", stance: "beneficiary", note: "Core hyperscaler" }],
      memo_md: "# Cloud ROI Theme Memo\n\nDetailed synthesis.",
    });

    // 3. Trigger edit & model edit must append event_type="rule_change" entries with rationale!
    saveOrMergeThesis(tempDir, profile, {
      ticker: "MSFT",
      buy_zone_high: 480,
      rationale: "Raised top of buy zone after backlog beat.",
    });
    saveDossierModelWithAudit(
      tempDir,
      profile,
      "MSFT",
      {
        horizon_years: 5,
        dividend_yield_pct: 0.7,
        scenarios: {
          bear: { probability: 0.25, target_price_5y: 420, summary: "Bear" },
          base: { probability: 0.5, target_price_5y: 790, summary: "Base" },
          bull: { probability: 0.25, target_price_5y: 990, summary: "Bull" },
        },
      },
      "Refreshed scenario targets after Q1.",
    );

    // 4. recordThesisTest auto-captures pit_snapshot + benchmark_price_at_test
    const { record } = recordThesisTest(tempDir, profile, {
      ticker: "MSFT",
      verdict: "WATCH",
      action_verdict: "WAIT",
      summary: "Margin pressure keeps verdict at WATCH.",
      price_at_test: 510,
      currency: "USD",
      hypotheses_tested: [],
    });
    assert.equal(record.benchmark_price_at_test, 178);
    assert.equal(record.pit_snapshot?.vix, 22.4);
    assert.equal(record.pit_snapshot?.us10y_pct, 4.35);
    assert.equal(record.pit_snapshot?.fundamentals_period, "2026-09-30");

    // 5. ingestResearchIntel also appends to intel_history.jsonl
    const ingestRes = ingestResearchIntel(tempDir, {
      ticker: "MSFT",
      intel: {
        updated_at: "2026-11-25T10:00:00Z",
        provider: "ibkr",
        earnings_insight: { period: "Q1 FY27", kind: "recap", headline: "Solid cloud", summary: "Beat rev." },
        options_intel: { expiry: "2026-12-18", implied_move_pct: 5.8, call_iv_pct: 24.5 },
      },
    });
    assert.equal(ingestRes.savedIntelHistory, true);
    assert.equal(loadIntelHistory(tempDir, "MSFT").length, 1);

    const allLogs = loadThesisTestLog(tempDir, "MSFT", 20);
    assert.equal(allLogs.filter((l) => l.event_type === "rule_change").length, 2);
    assert.equal(allLogs.filter((l) => l.event_type === "thesis_test").length, 1);

    // 6. Reset last_audited_date earlier than theme update to confirm theme propagation
    saveOrMergeThesis(tempDir, profile, { ticker: "MSFT", last_audited_date: "2026-11-10" }, { skipRuleChangeLog: true });

    const payload = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, live: false, useCache: true });
    assert.equal(payload.macro_regime?.regime_label, "ELEVATED");
    assert.equal(payload.themes.length, 1);
    const msft = payload.theses.find((t) => t.ticker === "MSFT");
    assert.ok(msft);
    assert.equal(msft.hypotheses[0]?.auto_eval?.passed, false);
    assert.equal(msft.hypotheses[0]?.observed_breach_softened, true);
    assert.ok(msft.softening_warnings.length >= 1);
    assert.equal(msft.provenance.theme_updated_after_audit, true);
    assert.equal(msft.provenance.needs_retest, true);
    assert.equal(msft.recent_tests.length, 1);
    assert.equal(msft.recent_rule_changes.length, 2);

    // 7. Dossier detail & Theme detail lazy loaders
    const detail = await getDossierDetail({ dataDir: tempDir, pluginRoot, ticker: "MSFT", useCache: true });
    assert.equal(detail.fundamentals?.latest_ratios.gross_margin_pct, 62);
    assert.equal(detail.intel_history.length, 1);
    assert.equal(detail.linked_themes.length, 1);

    const themeDetail = await getThemeDetail({ dataDir: tempDir, pluginRoot, slug: "cloud-roi", useCache: true });
    assert.equal(themeDetail.theme?.slug, "cloud-roi");
    assert.equal(themeDetail.memo_md?.includes("Cloud ROI Theme Memo"), true);
    assert.equal(themeDetail.linked_theses[0]?.ticker, "MSFT");

    // 8. Demo Mode v0.5 hydrates macro, rotation_queue, themes, alerts, fundamentals, insiders, and backtest
    const demo = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, demo: true });
    assert.equal(demo.macro_regime?.regime_label, "CALM");
    assert.ok(demo.rotation_queue.tax_swaps.length >= 1);
    assert.ok(demo.rotation_queue.mandatory_exits.length >= 1);
    assert.ok(demo.themes.length >= 1);
    assert.ok(demo.alerts.length >= 1);
    const demoDetail = await getDossierDetail({ dataDir: tempDir, pluginRoot, ticker: "MSFT", demo: true });
    assert.ok(demoDetail.fundamentals !== null);
    assert.ok(demoDetail.insiders !== null);
    assert.ok(demoDetail.valuation_bands !== null);
    assert.ok(demoDetail.linked_themes.length >= 1);

    const demoBt = await executePortfolioBacktest({
      dataDir: tempDir,
      pluginRoot,
      rawRequest: { candidate_ticker: "ACME", target_weight_pct: 8, funding_source: "cash", demo: true },
    });
    assert.ok(demoBt.backtest.weeks_analyzed >= 250);
    assert.ok(demoBt.backtest.baseline.sharpe_se > 0);

    // 9. Delta-only Watchdog sweep logs genuine deltas once and does not duplicate on repeat runs
    saveEdgarCache(tempDir, {
      checked_at: "2026-11-24T00:00:00Z",
      gate_evaluations: [],
      filings_by_ticker: {
        MSFT: [
          { form: "8-K", filingDate: "2026-11-24", accession: "0000789019-26-000999", items: "4.02", url: "https://www.sec.gov/1" },
        ],
      },
    });
    const sweep1 = await runWatchdogSweep(tempDir, pluginRoot, {
      includeQuotes: false,
      includeMacro: false,
      includeEdgar: false,
      includeXbrl: false,
      includeInsiders: false,
      nowDate: new Date("2026-11-25T12:00:00Z"),
    });
    assert.ok(sweep1.new_alerts.some((a) => a.kind === "sec_red_flag"));
    assert.ok(sweep1.new_alerts.some((a) => a.kind === "hypothesis_rule_breach"));

    // Second identical sweep must append ZERO duplicate alerts!
    const sweep2 = await runWatchdogSweep(tempDir, pluginRoot, {
      includeQuotes: false,
      includeMacro: false,
      includeEdgar: false,
      includeXbrl: false,
      includeInsiders: false,
      nowDate: new Date("2026-11-25T12:05:00Z"),
    });
    assert.equal(sweep2.new_alerts.length, 0);

    // Acknowledge all alerts cleanly
    const acked = ackWatchdogAlerts(tempDir, "*");
    assert.ok(acked.updated >= 2);
    assert.equal(loadWatchdogAlerts(tempDir, { onlyUnacknowledged: true }).length, 0);

    // Ensure history cache preservation works cleanly
    const nowIso = "2026-11-25T00:00:00Z";
    const samplePts = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
    }));
    saveHistoryCache(tempDir, {
      updated_at: nowIso,
      series: {
        MSFT: { symbol: "MSFT", currency: "USD", source: "ibkr", updated_at: "2026-11-20T00:00:00Z", points: samplePts },
        "VWRA.L": { symbol: "VWRA.L", currency: "USD", source: "yahoo", updated_at: nowIso, points: samplePts },
      },
    });
    const kept = await ensureHistorySeries(tempDir, ["MSFT", "VWRA.L"], { nowMs: Date.parse("2026-11-25T12:00:00Z") });
    assert.equal(kept.series.MSFT?.source, "ibkr");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("upsertSingleHypothesis merges hypotheses without altering rule_change log", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-hyp-"));
  try {
    const profile = ProfileSchema.parse({ base_currency: "USD" });
    upsertSingleHypothesis(tempDir, profile, "MSFT", {
      id: "cloud-margin",
      claim: "Cloud grows > 20%",
      status: "supported",
      confidence: "high",
    });
    const md = fs.readFileSync(path.join(tempDir, "theses", "MSFT.md"), "utf-8");
    assert.equal(md.includes("cloud-margin"), true);
    assert.equal(loadThesisTestLog(tempDir, "MSFT", 10).length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
