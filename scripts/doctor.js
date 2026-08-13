#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED_FILES = [
  "README.md",
  "llms.txt",
  "AGENTS.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LIVE_TEST_CHECKLIST.md",
  "package.json",
  "bin/overleaf-browser-bridge.js",
  "extension/manifest.json",
  "extension/background.js",
  "extension/contentScript.js",
  "extension/pageBridge.js",
  "extension/popup.html",
  "extension/popup.js",
  "server/overleaf-bridge-mcp.js",
  "tests/server.test.js",
  "scripts/start-bridge.ps1",
  "scripts/call-tool.js",
  "scripts/live-smoke-test.js",
  "scripts/live-noop-release-test.js",
  "scripts/live-section-noop-test.js",
  "scripts/live-context-budget-test.js",
  "scripts/live-target-lock-test.js",
  "scripts/live-mirror-test.js",
  "scripts/live-export-test.js",
  "scripts/live-artifact-inventory-test.js",
  "scripts/live-visible-artifact-export-test.js",
  "scripts/live-file-operation-ui-test.js",
  "scripts/live-upload-workflow-test.js",
  "scripts/live-download-workflow-test.js",
  "scripts/live-safe-suite.js",
  "scripts/live-comments-inspection-test.js",
  "scripts/live-prepare-comment-action-test.js",
  "scripts/live-prepare-file-operation-test.js",
  "scripts/post-install-live-check.js",
  "scripts/first-run-check.js",
  "scripts/generate-mcp-config.js",
  "scripts/mirror-sync-workflow.js",
  "scripts/package-npm-check.js",
  "scripts/repository-metadata-check.js",
  "scripts/release-candidate-check.js",
  "scripts/release-decision-report.js",
  "scripts/prepare-release-assets.js",
  "scripts/prepare-extension-build.js",
  "scripts/release-preflight.js",
  "scripts/package-extension.ps1",
  "config/codex-mcp.example.toml",
  "config/mcp-launch.example.json",
  "config/project-aliases.example.json",
  "docs/USAGE.md",
  "docs/AI_AGENT_GUIDE.md",
  "docs/AGENT_PROMPTS.md",
  "docs/ARCHITECTURE.md",
  "docs/TROUBLESHOOTING.md",
  "docs/PUBLISHING.md",
  "docs/INSTALLATION.md",
  "docs/SUPPORT_SETUP.md",
  "docs/assets/buy-me-a-coffee-qr.jpg"
];

const SECRET_PATTERNS = [
  { name: "Overleaf session cookie", pattern: /\boverleaf_session\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
  { name: "Overleaf session2 cookie", pattern: /\bsession2\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
  { name: "Overleaf Git token URL", pattern: /git\.overleaf\.com\/[0-9a-f]{24,}/i },
  { name: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}/i },
  { name: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9_]{20,}/i },
  { name: "Overleaf bridge token assignment", pattern: /\bOVERLEAF_BRIDGE_TOKEN\s*=\s*["']?[A-Za-z0-9._~+/=-]{12,}/i }
];

function main() {
  const failures = [];

  checkNodeVersion(failures);
  checkRequiredFiles(failures);
  checkPackageAndManifest(failures);
  checkConfigFiles(failures);
  checkSourceImports(failures);
  scanForSecrets(failures);

  if (failures.length > 0) {
    console.error("overleaf-browser-bridge doctor failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("overleaf-browser-bridge doctor passed");
}

function checkNodeVersion(failures) {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    failures.push(`Node.js >=18 is required, got ${process.version}`);
  }
}

function checkRequiredFiles(failures) {
  for (const relativePath of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(ROOT, relativePath))) {
      failures.push(`Missing required file: ${relativePath}`);
    }
  }
}

function checkPackageAndManifest(failures) {
  const pkg = readJson("package.json", failures);
  const manifest = readJson("extension/manifest.json", failures);
  if (!pkg || !manifest) return;

  if (pkg.private === true) failures.push("package.json should not be private for GitHub publishing");
  if (!pkg.license) failures.push("package.json is missing license");
  if (!pkg.repository || !String(pkg.repository.url || "").includes("AgentPilotLab/overleaf-browser-bridge")) {
    failures.push("package.json repository metadata must point to AgentPilotLab/overleaf-browser-bridge");
  }
  if (!pkg.bin || pkg.bin["overleaf-browser-bridge"] !== "bin/overleaf-browser-bridge.js") {
    failures.push("package.json is missing the overleaf-browser-bridge bin entry");
  }
  if (!pkg.bin || pkg.bin["overleaf-browser-bridge-mcp"] !== "bin/overleaf-browser-bridge.js") {
    failures.push("package.json is missing the overleaf-browser-bridge-mcp bin entry");
  }
  checkPackageFiles(pkg, failures);
  if (pkg.version !== manifest.version) {
    failures.push(`package.json version ${pkg.version} does not match extension version ${manifest.version}`);
  }
  if (manifest.manifest_version !== 3) failures.push("Chrome manifest_version must be 3");
  if (!manifest.background || manifest.background.service_worker !== "background.js") {
    failures.push("manifest is missing the background.js service worker");
  }
  const contentScripts = manifest.content_scripts || [];
  const scripts = contentScripts.flatMap((entry) => entry.js || []);
  if (!scripts.includes("pageBridge.js")) failures.push("manifest is missing pageBridge.js content script");
  if (!scripts.includes("contentScript.js")) failures.push("manifest is missing contentScript.js content script");
  const pageBridgeEntry = contentScripts.find((entry) => (entry.js || []).includes("pageBridge.js"));
  if (!pageBridgeEntry || pageBridgeEntry.world !== "MAIN") {
    failures.push("pageBridge.js content script must run with world: MAIN");
  }

  const permissions = manifest.permissions || [];
  for (const forbidden of ["cookies", "history", "tabs", "webRequest"]) {
    if (permissions.includes(forbidden)) failures.push(`Forbidden permission in manifest: ${forbidden}`);
  }

  const hostPermissions = manifest.host_permissions || [];
  for (const required of [
    "https://*.overleaf.com/project/*",
    "http://127.0.0.1:38475/*",
    "http://localhost:38475/*"
  ]) {
    if (!hostPermissions.includes(required)) failures.push(`Missing host_permission: ${required}`);
  }
}

function checkPackageFiles(pkg, failures) {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const required = ["bin/", "server/", "extension/", "config/", "docs/", "scripts/", "README.md", "LICENSE", "llms.txt"];
  for (const entry of required) {
    if (!files.includes(entry)) failures.push(`package.json files is missing required package entry: ${entry}`);
  }
  const forbidden = [".runtime", ".runtime/", "dist", "dist/", "node_modules", "node_modules/", "STATE.md", "local-notes", "local-notes/"];
  for (const entry of files) {
    if (forbidden.includes(entry)) failures.push(`package.json files includes forbidden local entry: ${entry}`);
  }
}

function checkConfigFiles(failures) {
  readJson("config/mcp-launch.example.json", failures);
}

function checkSourceImports(failures) {
  try {
    const server = require(path.join(ROOT, "server/overleaf-bridge-mcp.js"));
    for (const exportedName of ["createBridgeServer", "createStdioMessageParser", "handleMcpRequest"]) {
      if (typeof server[exportedName] !== "function") {
        failures.push(`Server export is missing or not a function: ${exportedName}`);
      }
    }
  } catch (error) {
    failures.push(`Server module cannot be imported: ${error.message}`);
  }
}

function scanForSecrets(failures) {
  const roots = ["extension", "server", "scripts", "tests", "config", "docs"];
  const rootFiles = ["README.md", "llms.txt", "AGENTS.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "LIVE_TEST_CHECKLIST.md", "package.json"];
  for (const filePath of collectFiles(roots, rootFiles).filter(isTextFile)) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const secret of SECRET_PATTERNS) {
      if (secret.pattern.test(text)) {
        failures.push(`Possible ${secret.name} in ${path.relative(ROOT, filePath)}`);
      }
    }
  }
}

function collectFiles(roots, rootFiles) {
  const files = [];
  for (const rootFile of rootFiles) {
    const filePath = path.join(ROOT, rootFile);
    if (fs.existsSync(filePath)) files.push(filePath);
  }
  for (const root of roots) {
    walk(path.join(ROOT, root), files);
  }
  return files.filter((filePath) => !filePath.includes(`${path.sep}dist${path.sep}`));
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (![".runtime", "snapshots", "dist", "node_modules"].includes(entry.name)) walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function readJson(relativePath, failures) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch (error) {
    failures.push(`Cannot parse ${relativePath}: ${error.message}`);
    return null;
  }
}

function isTextFile(filePath) {
  return [
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".ps1",
    ".toml",
    ".txt",
    ".yml"
  ].includes(path.extname(filePath).toLowerCase());
}

main();
