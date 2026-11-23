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
  mergePortfolioPositions,
  saveOrMergeThesis,
} from "../src/server/engine.js";
import { ProfileSchema } from "../src/server/schema.js";
import { savePortfolio, saveProfile } from "../src/server/storage.js";

test("computeUsEstateTaxNra matches exact IRC §2101(c) schedule", () => {
  assert.equal(computeUsEstateTaxNra(0).net_estate_tax_usd, 0);
  assert.equal(computeUsEstateTaxNra(60000).net_estate_tax_usd, 0);

  // $60,001: $1 * 26% marginal bracket above $60k unified credit equivalent
  const justOver = computeUsEstateTaxNra(60001);
  assert.equal(justOver.net_estate_tax_usd, 0.26);
  assert.equal(justOver.marginal_rate_pct, 26);

  // $250,000: tentative $70,800 - $13,000 = $57,800
  const at250 = computeUsEstateTaxNra(250000);
  assert.equal(at250.net_estate_tax_usd, 57800);
  assert.equal(at250.marginal_rate_pct, 32);

  // $500,000: $70,800 + $250k*0.34 ($85,000) - $13,000 = $142,800
  const at500 = computeUsEstateTaxNra(500000);
  assert.equal(at500.net_estate_tax_usd, 142800);
  assert.equal(at500.marginal_rate_pct, 34);

  // $1,000,000: $155,800 + $92,500 + $97,500 - $13,000 = $332,800
  const at1m = computeUsEstateTaxNra(1000000);
  assert.equal(at1m.net_estate_tax_usd, 332800);
  assert.equal(at1m.marginal_rate_pct, 39);

  // $1,500,000: $332,800 + $500,000*0.40 = $532,800
  const at15m = computeUsEstateTaxNra(1500000);
  assert.equal(at15m.net_estate_tax_usd, 532800);
  assert.equal(at15m.marginal_rate_pct, 40);
});

test("multi-currency NAV, GOOG/GOOGL canonical look-through, ETF residuals & risk caps", async () => {
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
        { ticker: "SPY", qty: 100, avg_cost: 500, ref_price: 600, currency: "USD" }, // $60,000 -> EUR 54,000
        { ticker: "GOOGL", qty: 50, avg_cost: 180, ref_price: 200, currency: "USD" }, // $10,000 -> EUR 9,000
        { ticker: "ENR.DE", qty: 100, avg_cost: 40, ref_price: 50, currency: "EUR", us_situs: false }, // EUR 5,000 ($5,555.56)
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
    assert.equal(payload.summary.us_situs_enabled, false);
    assert.equal(payload.summary.total_estate_tax_base, 0);

    // NAV = 54,000 + 9,000 + 5,000 + 5,000 cash = EUR 73,000
    assert.equal(payload.portfolio.nav_base, 73000);

    // GOOG/GOOGL = $10,000 direct + $60,000 * (0.0273 + 0.0257) = $10,000 + $3,180 = $13,180 -> EUR 11,862
    assert.equal(canonicalAssetName("GOOG"), "GOOG/GOOGL");
    const googRow = payload.lookthrough.find((r) => r.name === "GOOG/GOOGL");
    assert.ok(googRow);
    assert.equal(googRow.direct_usd, 10000);
    assert.equal(googRow.via_etfs_usd, 3180);
    assert.equal(googRow.total_usd, 13180);
    assert.equal(googRow.total_base, 11862);

    const singleCap = payload.risk_caps.find((c) => c.id === "single-max");
    assert.ok(singleCap);
    assert.equal(singleCap.status, "PASS");

    const techCap = payload.risk_caps.find((c) => c.id === "tech-bucket");
    assert.ok(techCap);
    // Tech bucket: GOOG/GOOGL ($13,180) + MSFT ($3,438) + NVDA ($3,054) + SPY residual ($60k * 0.025 = $1,500) = $21,172 -> EUR 19,054.8 -> 26.1% PASS
    assert.equal(techCap.status, "PASS");
    assert.equal(techCap.value_pct, 26.1);

    // Save thesis and verify payload inclusion
    saveOrMergeThesis(tempDir, profile, {
      ticker: "GOOGL",
      buy_zone_low: 170,
      buy_zone_high: 210,
      trim_zone: 260,
      gated: false,
      decision_log_note: "Initial multi-currency test note.",
    });
    const payload2 = await buildDashboardPayload({ dataDir: tempDir, pluginRoot, live: false });
    assert.equal(payload2.theses.length, 1);
    assert.equal(payload2.theses[0].ticker, "GOOGL");
    assert.equal(payload2.theses[0].latest_decision.includes("Initial multi-currency test note."), true);
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
