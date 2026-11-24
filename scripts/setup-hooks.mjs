import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

if (!fs.existsSync(path.join(rootDir, ".git"))) {
  console.log("Skipping git hooks setup (no .git directory present).");
  process.exit(0);
}

for (const hookName of ["pre-commit", "pre-push"]) {
  const hookPath = path.join(rootDir, ".githooks", hookName);
  if (fs.existsSync(hookPath)) {
    fs.chmodSync(hookPath, 0o755);
  }
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: rootDir,
  stdio: "inherit",
});
console.log("Configured git core.hooksPath -> .githooks");
