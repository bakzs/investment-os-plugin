import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateSecGates,
  extractFilingsFromSubmissions,
  extractSecRedFlags,
  type SecSubmissionsPayload,
} from "../src/server/edgar.js";
import {
  aggregateInsiderFilings,
  parseForm4Xml,
  syncInsidersForm4,
} from "../src/server/insiders.js";
import {
  classifyMacroRegime,
  ensureHistorySeries,
  fetchMacroRegime,
  fetchYahooChartQuote,
} from "../src/server/market.js";
import { ProfileSchema, type CatalystRecord } from "../src/server/schema.js";
import {
  loadDossierFundamentals,
  saveDossierFundamentals,
  saveHistoryCache,
} from "../src/server/storage.js";
import {
  parseCompanyFactsToFundamentals,
  syncFundamentalsXbrl,
  type SecCompanyFactsPayload,
} from "../src/server/xbrl.js";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeXmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "application/xml" },
  });
}

function buildMockCompanyFacts(): SecCompanyFactsPayload {
  // 5 quarters of synthetic US-GAAP data for ACME including YTD cash-flow differencing and Q4 derivation
  // FY25 Q1..Q4 + FY26 Q1
  return {
    cik: 1234567,
    entityName: "ACME CORP",
    facts: {
      "us-gaap": {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              // FY25 Q1..Q3 standalone + 9M YTD + FY25 10-K (for Q4 derivation!)
              { start: "2025-01-01", end: "2025-03-31", val: 10_000_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-04-01", end: "2025-06-30", val: 11_000_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" },
              { start: "2025-07-01", end: "2025-09-30", val: 12_000_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-09-30", val: 33_000_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-12-31", val: 46_000_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              // FY26 Q1 standalone
              { start: "2026-01-01", end: "2026-03-31", val: 14_000_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        CostOfGoodsAndServicesSold: {
          units: {
            USD: [
              { start: "2025-01-01", end: "2025-03-31", val: 3_000_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-04-01", end: "2025-06-30", val: 3_300_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" },
              { start: "2025-07-01", end: "2025-09-30", val: 3_600_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-09-30", val: 9_900_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-12-31", val: 13_800_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              { start: "2026-01-01", end: "2026-03-31", val: 4_200_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        OperatingIncomeLoss: {
          units: {
            USD: [
              { start: "2025-01-01", end: "2025-03-31", val: 4_000_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-04-01", end: "2025-06-30", val: 4_400_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" },
              { start: "2025-07-01", end: "2025-09-30", val: 4_800_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-09-30", val: 13_200_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-12-31", val: 18_400_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              { start: "2026-01-01", end: "2026-03-31", val: 5_600_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              { start: "2025-01-01", end: "2025-03-31", val: 3_000_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-04-01", end: "2025-06-30", val: 3_300_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" },
              { start: "2025-07-01", end: "2025-09-30", val: 3_600_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-09-30", val: 9_900_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-12-31", val: 13_800_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              { start: "2026-01-01", end: "2026-03-31", val: 4_000_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        // Cumulative YTD-only OCF in Q2/Q3/FY (mimics real SEC 10-Q cash flow reporting!)
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              { start: "2025-01-01", end: "2025-03-31", val: 3_600_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-01-01", end: "2025-06-30", val: 7_500_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" }, // Q2 = 3.9B
              { start: "2025-01-01", end: "2025-09-30", val: 11_700_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" }, // Q3 = 4.2B
              { start: "2025-01-01", end: "2025-12-31", val: 16_200_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" }, // Q4 = 4.5B
              { start: "2026-01-01", end: "2026-03-31", val: 4_800_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        PaymentsToAcquirePropertyPlantAndEquipment: {
          units: {
            USD: [
              { start: "2025-01-01", end: "2025-03-31", val: 600_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-01-01", end: "2025-06-30", val: 1_300_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" }, // Q2 = 0.7B
              { start: "2025-01-01", end: "2025-09-30", val: 2_100_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" }, // Q3 = 0.8B
              { start: "2025-01-01", end: "2025-12-31", val: 3_000_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" }, // Q4 = 0.9B
              { start: "2026-01-01", end: "2026-03-31", val: 1_000_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        ShareBasedCompensation: {
          units: {
            USD: [
              { start: "2026-01-01", end: "2026-03-31", val: 700_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: {
            shares: [
              { start: "2025-01-01", end: "2025-03-31", val: 1_000_000_000, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "0001234567-25-000010" },
              { start: "2025-04-01", end: "2025-06-30", val: 995_000_000, fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "0001234567-25-000020" },
              { start: "2025-07-01", end: "2025-09-30", val: 990_000_000, fy: 2025, fp: "Q3", form: "10-Q", filed: "2025-11-01", accn: "0001234567-25-000030" },
              { start: "2025-01-01", end: "2025-12-31", val: 992_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              { start: "2026-01-01", end: "2026-03-31", val: 980_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" }, // -2.0% YoY buyback
            ],
          },
        },
        AccountsReceivableNetCurrent: {
          units: {
            USD: [
              { end: "2025-12-31", val: 8_000_000_000, form: "10-K", filed: "2026-02-20", accn: "0001234567-26-000005" },
              { end: "2026-03-31", val: 9_125_000_000, form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        InventoryNet: {
          units: {
            USD: [
              { end: "2026-03-31", val: 2_100_000_000, form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        CashCashEquivalentsAndShortTermInvestments: {
          units: {
            USD: [
              { end: "2026-03-31", val: 25_000_000_000, form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
        LongTermDebtNoncurrent: {
          units: {
            USD: [
              { end: "2026-03-31", val: 10_000_000_000, form: "10-Q", filed: "2026-05-01", accn: "0001234567-26-000015" },
            ],
          },
        },
      },
    },
  };
}

test("XBRL parseCompanyFactsToFundamentals derives YTD-differenced quarters, Q4, forensic ratios, and TTM per-share metrics", () => {
  const result = parseCompanyFactsToFundamentals("ACME", buildMockCompanyFacts(), {
    nowIso: "2026-05-05T00:00:00Z",
  });

  assert.equal(result.ticker, "ACME");
  assert.equal(result.cik, "0001234567");
  assert.equal(result.currency, "USD");
  assert.equal(result.source, "sec_xbrl");
  assert.equal(result.quarterly.length, 5);
  assert.equal(result.annual.length, 1);

  // Latest quarter (2026-03-31): Rev 14,000M, COGS 4,200M -> GP 9,800M (70%), OpInc 5,600M (40%), NI 4,000M, OCF 4,800M, CapEx 1,000M -> FCF 3,800M
  const qLatest = result.quarterly[0];
  assert.ok(qLatest);
  assert.equal(qLatest.period_end, "2026-03-31");
  assert.equal(qLatest.revenue_m, 14000);
  assert.equal(qLatest.gross_profit_m, 9800);
  assert.equal(qLatest.gross_margin_pct, 70);
  assert.equal(qLatest.operating_margin_pct, 40);
  assert.equal(qLatest.ocf_m, 4800);
  assert.equal(qLatest.capex_m, 1000);
  assert.equal(qLatest.fcf_m, 3800);
  assert.equal(qLatest.ocf_to_ni_pct, 120);
  assert.equal(qLatest.sbc_pct_rev, 5);
  // DSO = (9,125 / 14,000) * 91.25 = 59.47 -> 59.5 days
  assert.equal(qLatest.dso_days, 59.5);
  // DIO = (2,100 / 4,200) * 91.25 = 45.6 days
  assert.equal(qLatest.dio_days, 45.6);
  // Net cash = (25B - 10B) = 15B
  assert.equal(qLatest.net_cash_b, 15);

  // Q4 (2025-12-31) derived via FY - 9M YTD: Rev 13,000M, OCF 4,500M, CapEx 900M -> FCF 3,600M
  const q4 = result.quarterly[1];
  assert.ok(q4);
  assert.equal(q4.period_end, "2025-12-31");
  assert.equal(q4.revenue_m, 13000);
  assert.equal(q4.ocf_m, 4500);
  assert.equal(q4.capex_m, 900);
  assert.equal(q4.fcf_m, 3600);

  // Q3 (2025-09-30) derived via 9M - 6M YTD: OCF 4,200M, CapEx 800M -> FCF 3,400M
  const q3 = result.quarterly[2];
  assert.ok(q3);
  assert.equal(q3.ocf_m, 4200);
  assert.equal(q3.fcf_m, 3400);

  // Latest ratios: diluted shares YoY = (980 - 1000) / 1000 = -2.0%
  assert.equal(result.latest_ratios.diluted_shares_yoy_pct, -2);
  // TTM Rev = 14B + 13B + 12B + 11B = 50B / 980M shares = 51.02/sh
  assert.equal(result.latest_ratios.ttm_rev_per_share, 51.02);
  // TTM FCF = 3.8B + 3.6B + 3.4B + 3.2B = 14.0B / 980M = 14.29/sh
  assert.equal(result.latest_ratios.ttm_fcf_per_share, 14.29);
  // TTM EPS = sum of 4Q eps_diluted
  assert.ok(result.latest_ratios.ttm_eps && result.latest_ratios.ttm_eps > 14);
});

test("XBRL parseCompanyFactsToFundamentals guards zero and sub-threshold micro-cap diluted_shares_m cleanly", () => {
  const microPayload: SecCompanyFactsPayload = {
    cik: 9999999,
    entityName: "MICRO SHELL CORP",
    facts: {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { start: "2024-01-01", end: "2024-12-31", val: 5_000_000, fy: 2024, fp: "FY", form: "10-K", filed: "2025-03-01", accn: "0009999999-25-000001" },
              { start: "2025-01-01", end: "2025-12-31", val: 8_000_000, fy: 2025, fp: "FY", form: "10-K", filed: "2026-03-01", accn: "0009999999-26-000001" },
              { start: "2026-01-01", end: "2026-03-31", val: 2_000_000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0009999999-26-000010" },
            ],
          },
        },
        WeightedAverageNumberOfDilutedSharesOutstanding: {
          units: {
            shares: [
              // Zero shares, microscopic 10 shares (rounds to 0 at 4 decimals), and 4000 shares (0.004M)
              { start: "2024-01-01", end: "2024-12-31", val: 0, fy: 2024, fp: "FY", form: "10-K", filed: "2025-03-01", accn: "0009999999-25-000001" },
              { start: "2025-01-01", end: "2025-12-31", val: 10, fy: 2025, fp: "FY", form: "10-K", filed: "2026-03-01", accn: "0009999999-26-000001" },
              { start: "2026-01-01", end: "2026-03-31", val: 4000, fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-05-01", accn: "0009999999-26-000010" },
            ],
          },
        },
      },
    },
  };

  const parsed = parseCompanyFactsToFundamentals("MICRO", microPayload, { nowIso: "2026-05-05T00:00:00Z" });
  assert.equal(parsed.annual.length, 2);
  assert.equal(parsed.annual[0]?.diluted_shares_m, null); // 10 shares -> rounds to 0 -> guarded to null
  assert.equal(parsed.annual[1]?.diluted_shares_m, null); // 0 shares -> guarded to null
  assert.equal(parsed.quarterly[0]?.diluted_shares_m, 0.004); // 4000 shares preserved accurately
});

test("syncFundamentalsXbrl preserves existing overrides and respects conditional caching", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-xbrl-"));
  try {
    const profile = ProfileSchema.parse({});
    // Pre-seed existing fundamentals with custom overrides and stale timestamp
    saveDossierFundamentals(tempDir, "ACME", {
      ticker: "ACME",
      cik: "0001234567",
      updated_at: "2026-01-01T00:00:00Z",
      source: "hybrid",
      currency: "USD",
      latest_periodic_accession: "0001234567-25-000030",
      overrides: {
        dso_days: 48.5,
        basis_note: "Adjusted for supply chain factoring",
      },
    });

    let companyFactsFetches = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) {
        return makeJsonResponse({
          "0": { cik_str: 1234567, ticker: "ACME", title: "ACME Corp" },
        });
      }
      if (url.includes("CIK0001234567.json")) {
        companyFactsFetches += 1;
        return makeJsonResponse(buildMockCompanyFacts());
      }
      return makeJsonResponse({}, 404);
    };

    const res1 = await syncFundamentalsXbrl(tempDir, profile, ["ACME", "NO_SUCH"], {
      nowIso: "2026-05-05T00:00:00Z",
      fetchImpl: mockFetch,
    });
    assert.deepEqual(res1.updated, ["ACME"]);
    assert.deepEqual(res1.skipped, ["NO_SUCH"]);
    assert.equal(companyFactsFetches, 1);

    const saved = loadDossierFundamentals(tempDir, "ACME");
    assert.ok(saved);
    assert.equal(saved.source, "hybrid");
    assert.deepEqual(saved.overrides, {
      dso_days: 48.5,
      basis_note: "Adjusted for supply chain factoring",
    });
    // Numeric override applies to latest_ratios while raw quarterly preserves GAAP XBRL 59.5
    assert.equal(saved.latest_ratios.dso_days, 48.5);
    assert.equal(saved.quarterly[0]?.dso_days, 59.5);

    // Repeat sync 1 day later with no newer accession -> uses cache, 0 network fetches!
    const res2 = await syncFundamentalsXbrl(tempDir, profile, ["ACME"], {
      nowIso: "2026-05-06T00:00:00Z",
      edgarFilingsByTicker: {
        ACME: [
          {
            form: "10-Q",
            filingDate: "2026-05-01",
            accession: "0001234567-26-000015",
            url: "https://www.sec.gov/Archives/edgar/data/1234567/doc.htm",
          },
        ],
      },
      fetchImpl: mockFetch,
    });
    assert.deepEqual(res2.cached, ["ACME"]);
    assert.equal(companyFactsFetches, 1);

    // Newer periodic accession in EDGAR triggers immediate conditional refresh even within 7d!
    const res3 = await syncFundamentalsXbrl(tempDir, profile, ["ACME"], {
      nowIso: "2026-05-06T12:00:00Z",
      edgarFilingsByTicker: {
        ACME: [
          {
            form: "10-Q",
            filingDate: "2026-05-06",
            accession: "0001234567-26-000099",
            url: "https://www.sec.gov/Archives/edgar/data/1234567/doc2.htm",
          },
        ],
      },
      fetchImpl: mockFetch,
    });
    assert.deepEqual(res3.updated, ["ACME"]);
    assert.equal(companyFactsFetches, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("EDGAR retains 4 periodic + 10 event filings separately, evaluates SEC gates across all, and detects red flags", () => {
  const forms: string[] = [];
  const dates: string[] = [];
  const accns: string[] = [];
  const docs: string[] = [];
  const items: Array<string | string[]> = [];

  // 12 noisy 8-K filings BEFORE an older 10-Q and 10-K (previously truncated by slice(0, 5)!)
  for (let i = 0; i < 12; i += 1) {
    forms.push(i === 1 ? "NT 10-Q" : i === 2 ? "8-K/A" : "8-K");
    dates.push(`2026-11-${String(20 - i).padStart(2, "0")}`);
    accns.push(`0001234567-26-0001${String(i).padStart(2, "0")}`);
    docs.push(`f${i}.htm`);
    items.push(
      i === 0
        ? ["4.02", "8.01"]
        : i === 2
          ? "4.01,5.02"
          : i === 3
            ? "1.02,3.02"
            : "2.02",
    );
  }
  // Periodic filings deeper in the submissions feed
  forms.push("10-Q", "10-Q/A", "10-K", "10-Q", "10-Q");
  dates.push("2026-10-28", "2026-08-15", "2026-02-20", "2025-11-01", "2025-08-01");
  accns.push("0001234567-26-000050", "0001234567-26-000040", "0001234567-26-000010", "0001234567-25-000090", "0001234567-25-000080");
  docs.push("q3.htm", "q2a.htm", "fy25.htm", "q3_25.htm", "q2_25.htm");
  items.push("", "", "", "", "");

  const submissions: SecSubmissionsPayload = {
    filings: {
      recent: {
        form: forms,
        filingDate: dates,
        accessionNumber: accns,
        primaryDocument: docs,
        items,
      },
    },
  };

  const retained = extractFilingsFromSubmissions(submissions, "0001234567");
  const periodicCount = retained.filter((r) => ["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A"].includes(r.form)).length;
  const eventCount = retained.length - periodicCount;
  assert.equal(periodicCount, 4);
  assert.equal(eventCount, 10);
  assert.equal(retained.length, 14);

  // SEC gate must clear on the 10-Q filed 2026-10-28 despite 12 newer 8-Ks!
  const catalysts: CatalystRecord[] = [
    {
      date: "2026-11-01",
      ticker: "ACME",
      title: "Q3 10-Q Gate",
      detail: "Verify clean filing",
      urgency: "high",
      sec_gate: {
        form: "10-Q",
        filed_after: "2026-10-01",
        description: "Confirm timely 10-Q",
      },
    },
  ];
  const gateEvals = evaluateSecGates(catalysts, { ACME: retained });
  assert.equal(gateEvals.length, 1);
  assert.equal(gateEvals[0]?.cleared, true);
  assert.equal(gateEvals[0]?.latest_matching_date, "2026-10-28");

  // Forensic red flag extraction: NT 10-Q + 8-K items 4.02, 4.01, 5.02, 1.02, 3.02
  const flags = extractSecRedFlags({ ACME: retained });
  const codes = flags.map((f) => f.code);
  assert.ok(codes.includes("NT 10-Q"));
  assert.ok(codes.includes("8-K:4.02"));
  assert.ok(codes.includes("8-K:4.01"));
  assert.ok(codes.includes("8-K:5.02"));
  assert.ok(codes.includes("8-K:1.02"));
  assert.ok(codes.includes("8-K:3.02"));
  assert.equal(flags.find((f) => f.code === "8-K:4.02")?.severity, "high");
  assert.equal(flags.find((f) => f.code === "NT 10-Q")?.severity, "high");
  assert.equal(flags.find((f) => f.code === "8-K:5.02")?.severity, "medium");
});

test("Form 4 XML parser separates discretionary buys/sells from 10b5-1 plans and flags C-suite clusters + incremental sync", async () => {
  const buyXml = `<?xml version="1.0"?>
  <ownershipDocument>
    <aff10b5One>0</aff10b5One>
    <reportingOwner>
      <reportingOwnerId><rptOwnerName>JANE DOE</rptOwnerName></reportingOwnerId>
      <reportingOwnerRelationship>
        <isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle>
      </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-10-15</value></transactionDate>
        <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>5000</value></transactionShares>
          <transactionPricePerShare><value>120.50</value></transactionPricePerShare>
        </transactionAmounts>
      </nonDerivativeTransaction>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-10-15</value></transactionDate>
        <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>10000</value></transactionShares>
          <transactionPricePerShare><value>0</value></transactionPricePerShare>
        </transactionAmounts>
      </nonDerivativeTransaction>
    </nonDerivativeTable>
  </ownershipDocument>`;

  const mixedSellXml = `<?xml version="1.0"?>
  <ownershipDocument>
    <aff10b5One>0</aff10b5One>
    <reportingOwner>
      <reportingOwnerId><reportingOwnerName>JOHN SMITH</reportingOwnerName></reportingOwnerId>
      <reportingOwnerRelationship>
        <isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle>
      </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-10-20</value></transactionDate>
        <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>10000</value></transactionShares>
          <transactionPricePerShare><value>130</value><footnoteId id="F1"/></transactionPricePerShare>
        </transactionAmounts>
      </nonDerivativeTransaction>
      <nonDerivativeTransaction>
        <transactionDate><value>2026-10-21</value></transactionDate>
        <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>2000</value></transactionShares>
          <transactionPricePerShare><value>131</value></transactionPricePerShare>
        </transactionAmounts>
      </nonDerivativeTransaction>
    </nonDerivativeTable>
    <footnotes>
      <footnote id="F1">Sale executed pursuant to a Rule 10b5-1 trading plan adopted in 2025.</footnote>
    </footnotes>
  </ownershipDocument>`;

  const buyTxs = parseForm4Xml(buyXml);
  assert.equal(buyTxs.length, 1); // Code A grant ignored
  assert.equal(buyTxs[0]?.owner_name, "JANE DOE");
  assert.equal(buyTxs[0]?.code, "P");
  assert.equal(buyTxs[0]?.is_10b5_1, false);
  assert.equal(buyTxs[0]?.value_usd, 602500);

  const sellTxs = parseForm4Xml(mixedSellXml);
  assert.equal(sellTxs.length, 2);
  assert.equal(sellTxs[0]?.is_10b5_1, true);
  assert.equal(sellTxs[0]?.value_usd, 1_300_000);
  assert.equal(sellTxs[1]?.is_10b5_1, false);
  assert.equal(sellTxs[1]?.value_usd, 262_000);

  // Aggregation & C-suite buy cluster flags
  const agg = aggregateInsiderFilings(
    "ACME",
    [
      {
        filing_date: "2026-10-15",
        accession: "0001-26-0001",
        form: "4",
        owner_name: "JANE DOE",
        title: "Chief Executive Officer",
        is_director: true,
        code: "P",
        shares: 5000,
        price: 120.5,
        value_usd: 602500,
        is_10b5_1: false,
      },
      {
        filing_date: "2026-10-18",
        accession: "0001-26-0002",
        form: "4",
        owner_name: "ALICE DIRECTOR",
        title: "",
        is_director: true,
        code: "P",
        shares: 1000,
        price: 125,
        value_usd: 125000,
        is_10b5_1: false,
      },
      {
        filing_date: "2026-10-20",
        accession: "0001-26-0003",
        form: "4",
        owner_name: "JOHN SMITH",
        title: "Chief Financial Officer",
        is_director: false,
        code: "S",
        shares: 10000,
        price: 130,
        value_usd: 1_300_000,
        is_10b5_1: true,
      },
      {
        filing_date: "2026-03-01", // >90d, within 12m
        accession: "0001-26-0000",
        form: "4",
        owner_name: "JOHN SMITH",
        title: "Chief Financial Officer",
        is_director: false,
        code: "S",
        shares: 5000,
        price: 100,
        value_usd: 500_000,
        is_10b5_1: false,
      },
    ],
    { nowIso: "2026-11-25T00:00:00Z" },
  );

  assert.equal(agg.window_90d.disc_buy_usd, 727500);
  assert.equal(agg.window_90d.distinct_buyers, 2);
  assert.equal(agg.window_90d.plan_sell_usd, 1_300_000);
  assert.equal(agg.window_90d.disc_sell_usd, 0);
  assert.equal(agg.window_12m.disc_sell_usd, 500_000);
  assert.ok(agg.flags.some((f) => f.startsWith("DISCRETIONARY_BUY_CLUSTER")));
  assert.ok(agg.flags.some((f) => f.startsWith("C_SUITE_DISCRETIONARY_BUY")));

  // Incremental accession caching in syncInsidersForm4 (strips xsl prefix & avoids repeat XML fetch)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-insiders-"));
  try {
    let xmlFetches = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("company_tickers.json")) {
        return makeJsonResponse({ "0": { cik_str: 1234567, ticker: "ACME", title: "ACME Corp" } });
      }
      if (url.includes("submissions/CIK0001234567.json")) {
        return makeJsonResponse({
          filings: {
            recent: {
              form: ["4", "SC 13D"],
              filingDate: ["2026-10-15", "2026-09-10"],
              accessionNumber: ["0001234567-26-000101", "0001234567-26-000099"],
              primaryDocument: ["xslF345X05/form4.xml", "sc13d.htm"],
            },
          },
        });
      }
      if (url.endsWith("/form4.xml") && !url.includes("xslF345X05")) {
        xmlFetches += 1;
        return makeXmlResponse(buyXml);
      }
      return makeJsonResponse({}, 404);
    };

    const profile = ProfileSchema.parse({});
    const run1 = await syncInsidersForm4(tempDir, profile, ["ACME"], {
      nowIso: "2026-11-25T00:00:00Z",
      fetchImpl: mockFetch,
    });
    assert.deepEqual(run1.updated, ["ACME"]);
    assert.equal(xmlFetches, 1);
    assert.equal(run1.byTicker.ACME?.window_90d.disc_buy_usd, 602500);
    assert.ok(run1.byTicker.ACME?.flags.some((f) => f.startsWith("ACTIVIST_13D_FILING")));

    // Second run with same accession: 0 XML fetches!
    const run2 = await syncInsidersForm4(tempDir, profile, ["ACME"], {
      nowIso: "2026-11-26T00:00:00Z",
      fetchImpl: mockFetch,
    });
    assert.deepEqual(run2.cached, ["ACME"]);
    assert.equal(xmlFetches, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("market.ts supports extended-hours quotes, macro regime classification, IBKR 7d TTL expiry, FX & daily benchmark history", async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("chart/ACME") && url.includes("interval=1d")) {
      return makeJsonResponse({
        chart: {
          result: [
            {
              meta: {
                regularMarketPrice: 150.0,
                postMarketPrice: 156.25,
                regularMarketTime: 1763990400,
                postMarketTime: 1764001200,
                fiftyTwoWeekHigh: 180.5,
                fiftyTwoWeekLow: 95.25,
                chartPreviousClose: 140.0,
                currency: "USD",
                marketState: "POST",
              },
              indicators: { quote: [{ close: [142, 146, 150] }] },
            },
          ],
        },
      });
    }
    const macroPrices: Record<string, number> = {
      "%5EVIX": 29.5,
      "%5ETNX": 4.45,
      "%5EIRX": 4.3,
      HYG: 79.0,
      IEF: 96.0,
      "DX-Y.NYB": 105.2,
    };
    for (const [k, px] of Object.entries(macroPrices)) {
      if (url.includes(`chart/${k}`)) {
        return makeJsonResponse({
          chart: {
            result: [{ meta: { regularMarketPrice: px, currency: "USD" }, indicators: { quote: [{ close: [px] }] } }],
          },
        });
      }
    }
    // Weekly / daily history mock
    return makeJsonResponse({
      chart: {
        result: [
          {
            meta: { currency: "USD" },
            timestamp: [1735689600, 1736294400, 1736899200],
            indicators: {
              adjclose: [{ adjclose: [100, 102, 105] }],
              quote: [{ close: [100, 102, 105] }],
            },
          },
        ],
      },
    });
  };

  // Extended-hours quote
  const quote = await fetchYahooChartQuote("ACME", 5000, mockFetch);
  assert.ok(quote);
  assert.equal(quote.price, 150);
  assert.equal(quote.regular_price, 150);
  assert.equal(quote.extended_price, 156.25);
  assert.equal(quote.market_state, "POST");
  assert.equal(quote.fifty_two_week_high, 180.5);
  assert.equal(quote.fifty_two_week_low, 95.25);
  assert.ok(quote.quote_time);

  // Macro regime fetch & classification
  const macro = await fetchMacroRegime({ nowIso: "2026-11-25T00:00:00Z", fetchImpl: mockFetch });
  assert.equal(macro.vix, 29.5);
  assert.equal(macro.us10y_pct, 4.45);
  assert.equal(macro.us3m_pct, 4.3);
  assert.equal(macro.dxy, 105.2);
  assert.equal(macro.regime_label, "HIGH_VOL");
  assert.equal(classifyMacroRegime(15, 0.84), "CALM");
  assert.equal(classifyMacroRegime(22, 0.82), "ELEVATED");
  assert.equal(classifyMacroRegime(36, 0.8), "STRESS");
  assert.equal(classifyMacroRegime(29, 0.75), "STRESS");

  // IBKR 7-day TTL expiry fix + FX weekly + daily benchmark caching
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-mkt-"));
  try {
    const stalePts = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
    }));
    saveHistoryCache(tempDir, {
      updated_at: "2026-10-01T00:00:00Z",
      series: {
        // Stale IBKR series (>7 days old, >=20 points — previously stuck forever!)
        ACME: { symbol: "ACME", currency: "USD", source: "ibkr", updated_at: "2026-11-01T00:00:00Z", points: stalePts },
      },
    });
    const refreshed = await ensureHistorySeries(tempDir, ["ACME"], {
      nowMs: Date.parse("2026-11-25T00:00:00Z"),
      fxCurrencies: ["EUR"],
      dailyBenchmarkSymbol: "VWRA.L",
      fetchImpl: mockFetch,
    });
    // Expired IBKR series must have refreshed to Yahoo
    assert.equal(refreshed.series.ACME?.source, "yahoo");
    assert.ok(refreshed.series["EURUSD=X"]);
    assert.ok(refreshed.series["daily:VWRA.L"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
