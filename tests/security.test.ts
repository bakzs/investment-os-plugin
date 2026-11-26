import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDashboardPayload } from "../src/server/engine.js";
import {
  BacktestRequestSchema,
  CurrencySchema,
  EarningsInsightSchema,
  normalizeThemeSlug,
  normalizeTicker,
  PositionInputSchema,
  ProfileSchema,
  ProvenanceSourceSchema,
  ThemeSlugSchema,
} from "../src/server/schema.js";
import {
  ackWatchdogAlerts,
  appendIntelHistory,
  appendWatchdogAlerts,
  atomicWriteFile,
  ensureDataDir,
  getDossierDir,
  getThemeMemoPath,
  getThemeYamlPath,
  listThemes,
  loadDossierFundamentals,
  loadDossierInsiders,
  loadIntelHistory,
  loadMacroRegime,
  loadMarketCache,
  loadTheme,
  loadThemeMemo,
  loadWatchdogAlerts,
  resolveDataDir,
  safeResolve,
  saveDossierFundamentals,
  saveDossierInsiders,
  saveDossierIntel,
  saveDossierMemo,
  saveDossierModel,
  saveEtfWeights,
  saveHistoryCache,
  saveMacroRegime,
  saveMarketCache,
  savePaPerformance,
  saveTheme,
  saveThemeMemo,
  SecurityError,
} from "../src/server/storage.js";

test("safeResolve blocks path traversal, absolute escapes, and null bytes", () => {
  const base = path.join(os.tmpdir(), "ios-sandbox-base");
  assert.throws(() => safeResolve(base, "../etc/passwd"), SecurityError);
  assert.throws(() => safeResolve(base, "theses", "../../secret.txt"), SecurityError);
  assert.throws(() => safeResolve(base, "/etc/passwd"), SecurityError);
  assert.throws(() => safeResolve(base, "foo\0bar"), SecurityError);
  assert.equal(safeResolve(base, "theses", "AAPL.md"), path.resolve(base, "theses", "AAPL.md"));
  assert.throws(() => getDossierDir(base, "../etc"));
  assert.throws(() => getDossierDir(base, "A/B"));
});

test("normalizeTicker and Zod schemas reject malformed, unsafe URL, or out-of-range inputs", () => {
  for (const bad of ["../etc", "A/B", "A\\B", "AAPL MSFT", "TOOLONGTICKERSYMBOL123", "", "$DROP"]) {
    assert.throws(() => normalizeTicker(bad));
  }
  assert.equal(normalizeTicker("  brk-b "), "BRK-B");
  assert.equal(normalizeTicker("enr.de"), "ENR.DE");

  assert.throws(() => CurrencySchema.parse("US"));
  assert.throws(() => CurrencySchema.parse("DOLLAR"));
  assert.throws(() => PositionInputSchema.parse({ ticker: "AAPL", qty: -5 }));
  assert.throws(() => PositionInputSchema.parse({ ticker: "AAPL", qty: Number.NaN }));
  assert.throws(() => PositionInputSchema.parse({ ticker: "AAPL", qty: Number.POSITIVE_INFINITY }));
  assert.throws(() =>
    ProfileSchema.parse({
      tax_profile: { cgt_pct: 150 },
    }),
  );

  // Strict https:// URL enforcement on provenance & earnings insights
  assert.throws(() =>
    ProvenanceSourceSchema.parse({ label: "Bad", kind: "sec", url: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    ProvenanceSourceSchema.parse({ label: "HTTP", kind: "sec", url: "http://example.com" }),
  );
  assert.throws(() =>
    EarningsInsightSchema.parse({ summary: "Test", source_url: "http://insecure.example" }),
  );

  // Backtest funding_source validation
  assert.throws(() =>
    BacktestRequestSchema.parse({ candidate_ticker: "MSFT", funding_source: "swap:../etc" }),
  );
  assert.throws(() =>
    BacktestRequestSchema.parse({ candidate_ticker: "MSFT", funding_source: "margin" }),
  );
  assert.equal(
    BacktestRequestSchema.parse({ candidate_ticker: "MSFT", funding_source: "swap:VWRA" }).funding_source,
    "swap:VWRA",
  );
});

test("resolveDataDir ignores unexpanded ${PLUGIN_DATA} placeholder", () => {
  const resolved = resolveDataDir(["--data-dir=${PLUGIN_DATA}"], {});
  assert.equal(resolved, path.resolve(os.homedir(), ".investment-os"));

  const explicit = resolveDataDir(["--data-dir=/tmp/custom-ios"], {});
  assert.equal(explicit, path.resolve("/tmp/custom-ios"));
});

test("atomicWriteFile, ensureDataDir, and v0.4 dossier helpers enforce restrictive 0700/0600 permissions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-sec-"));
  const subDataDir = path.join(tempDir, "fresh-data");
  try {
    // Empty fresh data dir must boot cleanly without throwing or writing disk files
    const emptyPayload = await buildDashboardPayload({
      dataDir: subDataDir,
      pluginRoot: process.cwd(),
      live: false,
    });
    assert.equal(emptyPayload.initialized, false);
    assert.equal(fs.existsSync(subDataDir), false);

    // Demo preview must also leave fresh data dir untouched
    const demoPayload = await buildDashboardPayload({
      dataDir: subDataDir,
      pluginRoot: process.cwd(),
      demo: true,
    });
    assert.equal(demoPayload.initialized, true);
    assert.equal(demoPayload.is_demo, true);
    assert.equal(fs.existsSync(subDataDir), false);

    // POSIX file/dir modes
    ensureDataDir(subDataDir);
    assert.equal(fs.statSync(subDataDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(subDataDir, "dossiers")).mode & 0o777, 0o700);

    const secretPath = safeResolve(subDataDir, "profile.yaml");
    atomicWriteFile(secretPath, "base_currency: USD\n");
    assert.equal(fs.statSync(secretPath).mode & 0o777, 0o600);

    // Dossier sidecar files and lab caches must inherit 0700/0600 modes
    saveDossierModel(subDataDir, "MSFT", { horizon_years: 5, dividend_yield_pct: 0.7 });
    const memoPath = saveDossierMemo(subDataDir, "MSFT", "# Memo\n");
    saveDossierIntel(subDataDir, "MSFT", { updated_at: "2026-11-25T00:00:00Z", provider: "ibkr", themes: [], connections: [] });
    saveHistoryCache(subDataDir, { updated_at: "2026-11-25T00:00:00Z", series: {} });
    savePaPerformance(subDataDir, { updated_at: "2026-11-25T00:00:00Z", provider: "ibkr", periods: [] });

    const msftDir = getDossierDir(subDataDir, "MSFT");
    assert.equal(fs.statSync(msftDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(msftDir, "model.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(memoPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(msftDir, "intel.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(subDataDir, "history_cache.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(subDataDir, "pa_performance.json")).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("v0.5 themes, fundamentals, insiders, intel_history, macro, and watchdog alerts enforce path containment and 0700/0600 modes", () => {
  const base = path.join(os.tmpdir(), "ios-v5-sec-base");
  // Path-traversal & malformed slug guards
  for (const badSlug of ["../etc", "foo/bar", "foo\\bar", "-leading-dash", "has space", "bad_underscore", "a".repeat(65), ""]) {
    assert.throws(() => normalizeThemeSlug(badSlug));
    assert.throws(() => ThemeSlugSchema.parse(badSlug));
    assert.throws(() => getThemeYamlPath(base, badSlug));
    assert.throws(() => getThemeMemoPath(base, badSlug));
  }
  assert.equal(normalizeThemeSlug("  AI-Compute-2026 "), "ai-compute-2026");
  assert.throws(() => loadDossierFundamentals(base, "../etc"));
  assert.throws(() => loadDossierInsiders(base, "A/B"));
  assert.throws(() => loadIntelHistory(base, "..\\secret"));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-v5-sec-"));
  try {
    // 1. Themes YAML + companion MD
    saveTheme(tempDir, {
      slug: "cloud-capex-cycle",
      title: "Cloud Capex Cycle",
      updated_at: "2026-11-25T00:00:00Z",
      relationship_mode: "symbiotic",
      summary: "Hyperscaler infrastructure cycle across silicon and software.",
      shared_assumptions: ["Capex intensity normalizes over 3-5 years."],
      exposures: [{ ticker: "MSFT", stance: "beneficiary", note: "Cloud platform demand." }],
      signposts: [{ id: "capex-rev", metric: "Cloud growth vs capex", status: "watching" }],
    });
    const themeMemoPath = saveThemeMemo(tempDir, "cloud-capex-cycle", "# Cloud Capex Memo\n");
    assert.equal(fs.statSync(path.join(tempDir, "themes")).mode & 0o777, 0o700);
    assert.equal(fs.statSync(getThemeYamlPath(tempDir, "cloud-capex-cycle")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(themeMemoPath).mode & 0o777, 0o600);
    assert.equal(listThemes(tempDir).length, 1);
    assert.equal(loadTheme(tempDir, "cloud-capex-cycle")?.title, "Cloud Capex Cycle");
    assert.equal(loadThemeMemo(tempDir, "cloud-capex-cycle")?.includes("Cloud Capex Memo"), true);

    // 2. Dossier fundamentals, insiders, and intel_history
    saveDossierFundamentals(tempDir, "MSFT", {
      ticker: "MSFT",
      updated_at: "2026-11-25T00:00:00Z",
      source: "sec_xbrl",
      currency: "USD",
      latest_ratios: { gross_margin_pct: 69.5, dso_days: 55.2 },
    });
    saveDossierInsiders(tempDir, "MSFT", {
      ticker: "MSFT",
      updated_at: "2026-11-25T00:00:00Z",
    });
    appendIntelHistory(tempDir, "MSFT", {
      recorded_at: "2026-11-25T00:00:00Z",
      provider: "ibkr",
      implied_move_pct: 5.5,
      iv_pct_52w: 62,
    });
    const msftDir = getDossierDir(tempDir, "MSFT");
    assert.equal(fs.statSync(msftDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(msftDir, "fundamentals.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(msftDir, "insiders.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(msftDir, "intel_history.jsonl")).mode & 0o777, 0o600);
    assert.equal(loadDossierFundamentals(tempDir, "MSFT")?.latest_ratios.gross_margin_pct, 69.5);
    assert.equal(loadDossierInsiders(tempDir, "MSFT")?.ticker, "MSFT");
    assert.equal(loadIntelHistory(tempDir, "MSFT", 10).length, 1);

    // 3. Macro regime, ETF weights, market_cache (backward compat), and watchdog alerts
    saveMacroRegime(tempDir, {
      updated_at: "2026-11-25T00:00:00Z",
      vix: 18.5,
      us10y_pct: 4.2,
      us3m_pct: 4.4,
      hy_credit_ratio: 0.84,
      dxy: 103.5,
      regime_label: "CALM",
    });
    assert.equal(fs.statSync(path.join(tempDir, "macro")).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(tempDir, "macro", "regimes.yaml")).mode & 0o777, 0o600);
    assert.equal(loadMacroRegime(tempDir)?.regime_label, "CALM");

    saveEtfWeights(tempDir, {
      as_of: "2026-11-25",
      etf_weights: { VWRA: { MSFT: 0.037 } },
      etf_metadata: { VWRA: { domicile: "Ireland", us_situs: false, ocf_pct: 0.14 } },
    });
    assert.equal(fs.statSync(path.join(tempDir, "etf_weights.json")).mode & 0o777, 0o600);

    // Legacy v0.4 market_cache without fx_rates/macro_regime/extended_price loads cleanly
    atomicWriteFile(
      safeResolve(tempDir, "market_cache.json"),
      JSON.stringify({
        updated_at: "2026-11-24T00:00:00Z",
        vix: 19.0,
        vix_sparkline: [19.5, 19.0],
        quotes: { MSFT: { price: 450, currency: "USD", sparkline: [440, 450], change_1d_pct: 1.1, change_1m_pct: 3.2 } },
      }),
    );
    const legacyCache = loadMarketCache(tempDir);
    assert.equal(legacyCache.quotes.MSFT?.price, 450);
    saveMarketCache(tempDir, {
      ...legacyCache,
      fx_rates: { USD: 1.0, EUR: 0.92 },
    });
    assert.equal(fs.statSync(path.join(tempDir, "market_cache.json")).mode & 0o777, 0o600);

    appendWatchdogAlerts(tempDir, [
      {
        id: "alert-1",
        detected_at: "2026-11-25T01:00:00Z",
        severity: "high",
        kind: "sec_red_flag",
        ticker: "MSFT",
        title: "Sample alert",
        detail: "Synthetic test alert",
      },
    ]);
    assert.equal(fs.statSync(path.join(tempDir, "alerts_log.jsonl")).mode & 0o777, 0o600);
    assert.equal(loadWatchdogAlerts(tempDir, { onlyUnacknowledged: true }).length, 1);
    const acked = ackWatchdogAlerts(tempDir, "alert-1");
    assert.equal(acked.updated, 1);
    assert.equal(loadWatchdogAlerts(tempDir, { onlyUnacknowledged: true }).length, 0);
    assert.equal(fs.statSync(path.join(tempDir, "alerts_log.jsonl")).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
