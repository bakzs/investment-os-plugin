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

test("bundled dist/server.cjs passes end-to-end stdio MCP App lifecycle", async () => {
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
    { name: "investment-os-test-client", version: "0.3.0" },
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
    assert.deepEqual(openMeta?.ui, { resourceUri: "ui://investment-os/v3/dashboard.html" });
    const agyUi = openMeta?.["com.google.antigravity/ui"] as { entrypoints?: Array<{ type: string; title: string }> };
    assert.equal(agyUi?.entrypoints?.length, 2);

    const recordTool = byName.get("record_thesis_test");
    assert.ok(recordTool);
    assert.deepEqual((recordTool._meta as Record<string, unknown>)?.ui, {
      resourceUri: "ui://investment-os/v3/dashboard.html",
    });

    for (const appToolName of [
      "app_get_dashboard",
      "app_check_edgar",
      "app_save_external_wealth",
      "app_save_trigger",
      "app_upsert_hypothesis",
    ]) {
      const appTool = byName.get(appToolName);
      assert.ok(appTool, `missing ${appToolName}`);
      assert.deepEqual((appTool._meta as Record<string, unknown>)?.ui, { visibility: ["app"] });
    }

    // 2. Verify resource listing and HTML content
    const resList = await client.listResources();
    assert.equal(resList.resources[0]?.uri, "ui://investment-os/v3/dashboard.html");
    assert.equal(resList.resources[0]?.mimeType, "text/html;profile=mcp-app");

    const resRead = await client.readResource({ uri: "ui://investment-os/v3/dashboard.html" });
    const item = resRead.contents[0];
    assert.ok(item && "text" in item);
    assert.equal(item.mimeType, "text/html;profile=mcp-app");
    assert.equal(item.text.includes("Investment OS"), true);
    assert.equal(item.text.includes("v0.3"), true);
    assert.equal(item.text.includes("Thesis &amp; Catalyst Action Queue") || item.text.includes("Thesis & Catalyst Action Queue"), true);
    assert.equal(item.text.includes("<dialog id=\"stock-inspector\""), true);
    assert.equal(Buffer.byteLength(item.text, "utf-8") < 1_000_000, true);

    // 3. Empty data directory boots cleanly without initializing files
    const emptyCall = await client.callTool({ name: "open_dashboard", arguments: {} });
    const emptyPayload = emptyCall.structuredContent as { initialized: boolean; is_demo: boolean };
    assert.equal(emptyPayload.initialized, false);
    assert.equal(fs.readdirSync(tempDataDir).length, 0);

    // 4. Demo mode renders synthetic preview without writing files
    const demoCall = await client.callTool({ name: "app_get_dashboard", arguments: { demo: true } });
    const demoPayload = demoCall.structuredContent as {
      initialized: boolean;
      is_demo: boolean;
      portfolio: { positions: unknown[] };
    };
    assert.equal(demoPayload.initialized, true);
    assert.equal(demoPayload.is_demo, true);
    assert.equal(demoPayload.portfolio.positions.length > 0, true);
    assert.equal(fs.readdirSync(tempDataDir).length, 0);

    // 5. Full agent round-trip persistence
    await client.callTool({
      name: "update_profile",
      arguments: {
        base_currency: "GBP",
        timezone: "Europe/London",
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
      name: "update_thesis",
      arguments: {
        ticker: "AAPL",
        buy_zone_low: 190,
        buy_zone_high: 215,
        trim_zone: 260,
        decision_log_note: "Round-trip stdio test decision.",
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
        },
      },
    });

    await client.callTool({
      name: "record_thesis_test",
      arguments: {
        ticker: "AAPL",
        verdict: "HIGH_CONVICTION",
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
            evidence: "10-Q confirmed Services gross margin expanded above 72%.",
          },
        ],
      },
    });

    const finalCall = await client.callTool({ name: "open_dashboard", arguments: {} });
    const finalPayload = finalCall.structuredContent as {
      initialized: boolean;
      base_currency: string;
      portfolio: { nav_base: number; positions: Array<{ ticker: string }> };
      theses: Array<{
        ticker: string;
        verdict: string | null;
        hypothesis_counts: { total: number; supported: number };
        recent_tests: Array<{ verdict: string }>;
      }>;
      catalysts: Array<{ ticker: string }>;
      edgar: { gate_evaluations: Array<{ ticker: string; cleared: boolean }> };
    };
    assert.equal(finalPayload.initialized, true);
    assert.equal(finalPayload.base_currency, "GBP");
    // 100*175*0.8 (14,000) + 50*220*0.8 (8,800) + 10,000 cash = GBP 32,800
    assert.equal(finalPayload.portfolio.nav_base, 32800);
    assert.equal(finalPayload.theses[0]?.ticker, "AAPL");
    assert.equal(finalPayload.theses[0]?.verdict, "HIGH_CONVICTION");
    assert.equal(finalPayload.theses[0]?.hypothesis_counts.total, 1);
    assert.equal(finalPayload.theses[0]?.hypothesis_counts.supported, 1);
    assert.equal(finalPayload.theses[0]?.recent_tests.length, 1);
    assert.equal(fs.existsSync(path.join(tempDataDir, "test_log.jsonl")), true);
    assert.equal(finalPayload.catalysts[0]?.ticker, "AAPL");
    assert.equal(finalPayload.edgar.gate_evaluations[0]?.ticker, "AAPL");
    assert.equal(finalPayload.edgar.gate_evaluations[0]?.cleared, false);
  } finally {
    await client.close();
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
});
