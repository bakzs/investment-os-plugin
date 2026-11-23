import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

fs.mkdirSync(distDir, { recursive: true });

// 1. Bundle Node CJS MCP Server for zero-dependency agy-node execution
await esbuild.build({
  entryPoints: [path.join(rootDir, "src", "server", "index.ts")],
  outfile: path.join(distDir, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  minify: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  logLevel: "info",
});

try {
  fs.chmodSync(path.join(distDir, "server.cjs"), 0o755);
} catch {
  // Ignore on filesystems without POSIX chmod
}

// 2. Bundle single-file MCP App HTML UI
const uiJs = await esbuild.build({
  entryPoints: [path.join(rootDir, "src", "ui", "main.ts")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: ["es2022"],
});

const uiCss = await esbuild.build({
  entryPoints: [path.join(rootDir, "src", "ui", "styles.css")],
  bundle: true,
  write: false,
  minify: true,
});

const jsCode = uiJs.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");
const cssCode = uiCss.outputFiles[0].text.replace(/<\/style>/gi, "<\\/style>");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Investment OS Dashboard</title>
<style>${cssCode}</style>
</head>
<body>
<div id="app">Loading Investment OS dashboard...</div>
<script>${jsCode}</script>
</body>
</html>
`;

const htmlPath = path.join(distDir, "dashboard.html");
fs.writeFileSync(htmlPath, html, "utf-8");

const serverSizeKb = (fs.statSync(path.join(distDir, "server.cjs")).size / 1024).toFixed(1);
const htmlBytes = Buffer.byteLength(html, "utf-8");
if (htmlBytes > 1_000_000) {
  throw new Error(`dashboard.html exceeds 1 MB sanity budget: ${htmlBytes} bytes`);
}
console.log(`Built dist/server.cjs (${serverSizeKb} KB) and dist/dashboard.html (${(htmlBytes / 1024).toFixed(1)} KB)`);
