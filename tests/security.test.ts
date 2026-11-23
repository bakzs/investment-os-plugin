import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDashboardPayload } from "../src/server/engine.js";
import { CurrencySchema, normalizeTicker, PositionInputSchema, ProfileSchema } from "../src/server/schema.js";
import { atomicWriteFile, ensureDataDir, resolveDataDir, safeResolve, SecurityError } from "../src/server/storage.js";

test("safeResolve blocks path traversal, absolute escapes, and null bytes", () => {
  const base = path.join(os.tmpdir(), "ios-sandbox-base");
  assert.throws(() => safeResolve(base, "../etc/passwd"), SecurityError);
  assert.throws(() => safeResolve(base, "theses", "../../secret.txt"), SecurityError);
  assert.throws(() => safeResolve(base, "/etc/passwd"), SecurityError);
  assert.throws(() => safeResolve(base, "foo\0bar"), SecurityError);
  assert.equal(safeResolve(base, "theses", "AAPL.md"), path.resolve(base, "theses", "AAPL.md"));
});

test("normalizeTicker and Zod schemas reject malformed or out-of-range inputs", () => {
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
});

test("resolveDataDir ignores unexpanded ${PLUGIN_DATA} placeholder", () => {
  const resolved = resolveDataDir(["--data-dir=${PLUGIN_DATA}"], {});
  assert.equal(resolved, path.resolve(os.homedir(), ".investment-os"));

  const explicit = resolveDataDir(["--data-dir=/tmp/custom-ios"], {});
  assert.equal(explicit, path.resolve("/tmp/custom-ios"));
});

test("atomicWriteFile & ensureDataDir enforce restrictive permissions and empty dir boots cleanly", async () => {
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
    const dirMode = fs.statSync(subDataDir).mode & 0o777;
    assert.equal(dirMode, 0o700);

    const secretPath = safeResolve(subDataDir, "profile.yaml");
    atomicWriteFile(secretPath, "base_currency: USD\n");
    const fileMode = fs.statSync(secretPath).mode & 0o777;
    assert.equal(fileMode, 0o600);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
