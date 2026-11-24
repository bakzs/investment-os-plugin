import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const htmlPath = path.join(rootDir, "dist", "dashboard.html");
if (!fs.existsSync(htmlPath)) {
  throw new Error("dist/dashboard.html is missing — run `npm run build` first.");
}

const html = fs.readFileSync(htmlPath, "utf-8");
const bytes = Buffer.byteLength(html, "utf-8");
if (bytes > 1_000_000) {
  throw new Error(`dist/dashboard.html exceeds 1 MB budget (${bytes} bytes).`);
}

const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
if (scriptMatches.length === 0) {
  throw new Error("dist/dashboard.html has no inline <script> block.");
}
for (const [idx, match] of scriptMatches.entries()) {
  const attrs = match[1] ?? "";
  if (/\bsrc\s*=/i.test(attrs)) {
    throw new Error(`External <script src> tag is forbidden in dist/dashboard.html (CSP policy).`);
  }
  const code = match[2] ?? "";
  try {
    new vm.Script(code, { filename: `dist/dashboard.html#script-${idx}` });
  } catch (err) {
    throw new Error(`Inline script syntax validation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const externalStylePatterns = [
  /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*href\s*=\s*["']?https?:/i,
  /@import\s+(?:url\()?\s*["']?https?:/i,
];
for (const re of externalStylePatterns) {
  if (re.test(html)) {
    throw new Error(`External CDN stylesheet reference detected (${re}) — dashboard.html must remain strictly self-contained.`);
  }
}

const bannedHexes = ["#3b82f6", "#ec4899", "#10b981", "#38bdf8"];
for (const hex of bannedHexes) {
  if (new RegExp(hex, "i").test(html)) {
    throw new Error(`Banned legacy rainbow color hex ${hex} found inside dist/dashboard.html.`);
  }
}

// Version alignment across plugin.json, package.json, and src/server/index.ts
const pluginJson = JSON.parse(fs.readFileSync(path.join(rootDir, "plugin.json"), "utf-8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
const serverSrc = fs.readFileSync(path.join(rootDir, "src", "server", "index.ts"), "utf-8");
const skillMd = fs.readFileSync(path.join(rootDir, "skills", "investment-os", "SKILL.md"), "utf-8");

const serverVerMatch = serverSrc.match(/name:\s*"investment-os-dashboard",\s*version:\s*"([^"]+)"/);
if (!serverVerMatch) {
  throw new Error("Could not locate investment-os-dashboard Server version inside src/server/index.ts.");
}
const versions = {
  "plugin.json": pluginJson.version,
  "package.json": packageJson.version,
  "src/server/index.ts": serverVerMatch[1],
};
if (new Set(Object.values(versions)).size !== 1) {
  throw new Error(`Version mismatch across manifests/server: ${JSON.stringify(versions)}`);
}

// APP_URI alignment across src/server/index.ts and SKILL.md
const appUriMatch = serverSrc.match(/const\s+APP_URI\s*=\s*"([^"]+)"/);
if (!appUriMatch) {
  throw new Error("Could not locate APP_URI constant inside src/server/index.ts.");
}
const appUri = appUriMatch[1];
if (!skillMd.includes(appUri)) {
  throw new Error(`skills/investment-os/SKILL.md does not reference current APP_URI (${appUri}).`);
}

// Read-only sovereignty check on declared MCP tools
const toolsBlockMatch = serverSrc.match(/const\s+TOOLS[^=]*=\s*\[([\s\S]*?)\n\];/);
if (!toolsBlockMatch) {
  throw new Error("Could not parse TOOLS registry inside src/server/index.ts.");
}
const toolNames = [...toolsBlockMatch[1].matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1]);
const forbiddenToolRe = /(place|submit|cancel|modify|execute|create|send)_?(order|trade|transfer|withdrawal|wire)/i;
for (const toolName of toolNames) {
  if (forbiddenToolRe.test(toolName)) {
    throw new Error(`Read-only policy violation: forbidden trading/transfer tool "${toolName}" declared.`);
  }
}

console.log(
  `Bundle & contract verify PASSED (version=${versions["plugin.json"]}, appUri=${appUri}, tools=${toolNames.length}, htmlBytes=${bytes}).`,
);
