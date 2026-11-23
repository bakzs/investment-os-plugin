import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const targetDir = path.resolve(
  process.argv[2] || path.join(os.homedir(), ".gemini", "config", "plugins", "investment-os"),
);

const INCLUDE_ITEMS = [
  "plugin.json",
  "mcp_config.json",
  "assets",
  "defaults",
  "dist",
  "docs",
  "skills",
  "LICENSE",
  "README.md",
];

for (const rel of ["plugin.json", "mcp_config.json", "dist/server.cjs", "dist/dashboard.html"]) {
  if (!fs.existsSync(path.join(rootDir, rel))) {
    throw new Error(`Missing required build/plugin file before staging: ${rel}`);
  }
}

fs.mkdirSync(targetDir, { recursive: true });
for (const existing of fs.readdirSync(targetDir)) {
  fs.rmSync(path.join(targetDir, existing), { recursive: true, force: true });
}

for (const item of INCLUDE_ITEMS) {
  const src = path.join(rootDir, item);
  const dst = path.join(targetDir, item);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
  }
}

console.log(`Staged clean runtime plugin bundle to ${targetDir}`);
