import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const targetDir = path.resolve(process.argv[2] || process.cwd());

const GENERIC_RULES = [
  { name: "macOS user home path", regex: /\/Users\/[A-Za-z0-9._-]+/ },
  { name: "Linux user home path", regex: /\/home\/[A-Za-z0-9._-]+/ },
  { name: "Windows user home path", regex: /C:\\Users\\[A-Za-z0-9._-]+/ },
  { name: "IBKR account ID", regex: /\b(?:U|DU)[0-9]{7,8}\b/ },
  { name: "Private key header", regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: "GitHub PAT token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "API secret key", regex: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{35})\b/ },
];

const FORBIDDEN_EXTS = new Set([".csv", ".pdf", ".xlsx", ".xls", ".pem", ".key"]);
const FORBIDDEN_ROOT_DIRS = new Set(["theses", "dossiers", "themes", "macro", "notes", "local", "scratch"]);
const FORBIDDEN_VAULT_NAMES = new Set([
  "portfolio.json",
  "profile.yaml",
  "catalysts.yaml",
  "market_cache.json",
  "edgar_cache.json",
  "edgar_latest.json",
  "history_cache.json",
  "pa_performance.json",
  "test_log.jsonl",
  "alerts_log.jsonl",
  "intel_history.jsonl",
  "privacy-denylist.json",
]);

function loadLocalDenylistRules() {
  const candidates = [];
  const envRules = process.env.INVESTMENT_OS_PRIVACY_RULES?.trim();
  if (envRules && !envRules.includes("${")) candidates.push(path.resolve(envRules));

  const envDataDir = process.env.INVESTMENT_OS_DATA_DIR?.trim();
  if (envDataDir && !envDataDir.includes("${")) {
    candidates.push(path.join(path.resolve(envDataDir), "privacy-denylist.json"));
  }

  candidates.push(
    path.join(os.homedir(), ".gemini", "antigravity", "plugin_data", "investment-os", "privacy-denylist.json"),
    path.join(os.homedir(), ".investment-os", "privacy-denylist.json"),
  );

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      const entries = Array.isArray(parsed?.rules) ? parsed.rules : [];
      const loaded = [];
      for (const entry of entries) {
        if (!entry || typeof entry.name !== "string" || typeof entry.pattern !== "string" || !entry.pattern) continue;
        const flags = typeof entry.flags === "string" ? entry.flags.replace(/g/g, "") : "";
        try {
          loaded.push({ name: entry.name, regex: new RegExp(entry.pattern, flags) });
        } catch {
          console.error(`Skipping invalid local privacy regex rule "${entry.name}".`);
        }
      }
      return loaded;
    } catch {
      console.error("Warning: failed to parse local privacy-denylist.json; continuing with generic rules.");
      return [];
    }
  }
  return [];
}

const IGNORE_DIRS = new Set([".git", "node_modules", ".venv", "coverage"]);
const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ico"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

const localRules = loadLocalDenylistRules();
const rules = [...GENERIC_RULES, ...localRules];
const files = walk(targetDir);
const hits = [];

for (const file of files) {
  const rel = path.relative(targetDir, file).replaceAll("\\", "/");
  const base = path.basename(rel);
  const ext = path.extname(rel).toLowerCase();
  const topDir = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";

  if (FORBIDDEN_EXTS.has(ext)) {
    hits.push({ rel, rule: "Forbidden private extension", sample: ext });
  }
  if (FORBIDDEN_ROOT_DIRS.has(topDir)) {
    hits.push({ rel, rule: "Forbidden vault directory", sample: `${topDir}/` });
  }
  if (FORBIDDEN_VAULT_NAMES.has(base) || (base === "etf_weights.json" && rel !== "defaults/etf_weights.json")) {
    hits.push({ rel, rule: "Forbidden vault filename", sample: base });
  }

  if (BINARY_EXTS.has(ext)) continue;

  const content = fs.readFileSync(file, "utf-8");
  for (const rule of rules) {
    const match = content.match(rule.regex);
    if (match) {
      hits.push({ rel, rule: rule.name, sample: match[0] });
    }
  }
}

if (hits.length > 0) {
  console.error(`Privacy check FAILED with ${hits.length} match(es) in ${path.basename(targetDir)}:`);
  for (const h of hits) {
    console.error(`  - ${h.rel} [${h.rule}]: ${h.sample}`);
  }
  process.exit(1);
}

console.log(
  `Privacy check PASSED (${files.length} files scanned in ${path.basename(targetDir)}; ${GENERIC_RULES.length} generic + ${localRules.length} local rules).`,
);
