#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_CACHE_DIR = path.join(ROOT, ".runtime", "npm-cache");

function main() {
  const output = runNpmPackDryRun();
  const result = JSON.parse(output);
  const pack = Array.isArray(result) ? result[0] : result;
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error("npm pack --dry-run did not return a file list");
  }

  const files = pack.files.map((entry) => String(entry.path || "").replace(/\\/g, "/")).sort();
  const required = [
    "bin/overleaf-browser-bridge.js",
    "server/overleaf-bridge-mcp.js",
    "extension/manifest.json",
    "extension/background.js",
    "extension/contentScript.js",
    "extension/pageBridge.js",
    "scripts/first-run-check.js",
    "scripts/generate-mcp-config.js",
    "scripts/mirror-sync-workflow.js",
    "scripts/live-safe-suite.js",
    "scripts/post-install-live-check.js",
    "scripts/prepare-extension-build.js",
    "scripts/prepare-release-assets.js",
    "scripts/release-preflight.js",
    "scripts/repository-metadata-check.js",
    "scripts/release-candidate-check.js",
    "scripts/release-decision-report.js",
    "config/codex-mcp.example.toml",
    "config/mcp-launch.example.json",
    "docs/AI_AGENT_GUIDE.md",
    "docs/INSTALLATION.md",
    "README.md",
    "LICENSE",
    "llms.txt",
    "package.json"
  ];
  const forbiddenPatterns = [
    /^STATE\.md$/i,
    /^\.runtime\//i,
    /^dist\//i,
    /^node_modules\//i,
    /^local-notes\//i,
    /^snapshots\//i,
    /(^|\/)\.env$/i,
    /(^|\/)bridge-token\.txt$/i,
    /(^|\/)project-aliases\.json$/i
  ];

  const missing = required.filter((entry) => !files.includes(entry));
  if (missing.length > 0) {
    throw new Error(`npm package is missing required files: ${missing.join(", ")}`);
  }

  const forbidden = files.filter((entry) => forbiddenPatterns.some((pattern) => pattern.test(entry)));
  if (forbidden.length > 0) {
    throw new Error(`npm package includes forbidden local/private files: ${forbidden.join(", ")}`);
  }

  console.log(JSON.stringify({
    ok: true,
    name: pack.name,
    version: pack.version,
    fileCount: files.length,
    unpackedSize: pack.unpackedSize,
    requiredFilesPresent: required.length,
    forbiddenFiles: 0
  }, null, 2));
}

function runNpmPackDryRun() {
  fs.mkdirSync(NPM_CACHE_DIR, { recursive: true });
  const env = {
    ...process.env,
    npm_config_cache: NPM_CACHE_DIR,
    npm_config_loglevel: "error"
  };
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, "pack", "--dry-run", "--json"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }
  return execFileSync(npmCommand, ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
}

main();
