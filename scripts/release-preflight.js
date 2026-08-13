#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".ps1",
  ".toml",
  ".txt",
  ".yml"
]);

const PRIVACY_PATTERNS = [
  { name: "Windows user path", pattern: /C:\\Users\\/i },
  { name: "macOS user path", pattern: /\/Users\//i },
  { name: "Linux home path", pattern: /\/home\//i },
  { name: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { name: "Overleaf session cookie", pattern: /\boverleaf_session\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
  { name: "Overleaf session2 cookie", pattern: /\bsession2\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
  { name: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9_]{20,}/i },
  { name: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}/i },
  { name: "bridge token assignment", pattern: /\bOVERLEAF_BRIDGE_TOKEN\s*=\s*["']?[A-Za-z0-9._~+/=-]{12,}/i }
];

function main(argv = process.argv.slice(2)) {
  const plan = buildGatePlan();
  if (argv.includes("--list")) {
    console.log(JSON.stringify({
      ok: true,
      gates: plan.map((gate) => ({ name: gate.name, command: gate.commandLabel || "internal" })),
      publishActionsPerformed: []
    }, null, 2));
    return;
  }

  const results = [];
  const failures = [];

  for (const gate of plan) {
    const result = runGate(gate);
    results.push(result);
    if (result.status !== "pass") failures.push(result);
  }

  const ok = failures.length === 0;
  const summary = {
    ok,
    version: readPackageVersion(),
    gates: results,
    publishActionsPerformed: [],
    published: false
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

function buildGatePlan() {
  return [
    { name: "version_consistency", run: checkVersionConsistency },
    { name: "doctor", command: [process.execPath, ["scripts/doctor.js"]] },
    { name: "server_tests", command: [process.execPath, ["tests/server.test.js"]] },
    { name: "first_run", command: [process.execPath, ["scripts/first-run-check.js"]] },
    { name: "post_install_live_verify_allow_offline", command: [process.execPath, ["scripts/post-install-live-check.js", "--allow-offline"]] },
    { name: "mcp_config_generation", command: [process.execPath, ["scripts/generate-mcp-config.js"]] },
    { name: "mirror_sync_workflow", command: [process.execPath, ["scripts/mirror-sync-workflow.js", "--list"]] },
    { name: "repository_metadata", command: [process.execPath, ["scripts/repository-metadata-check.js"]] },
    { name: "release_assets", command: [process.execPath, ["scripts/prepare-release-assets.js"]] },
    { name: "release_candidate", command: [process.execPath, ["scripts/release-candidate-check.js"]] },
    { name: "release_decision", command: [process.execPath, ["scripts/release-decision-report.js"]] },
    { name: "git_diff_check", command: ["git", ["diff", "--check"]] },
    { name: "git_cached_diff_check", command: ["git", ["diff", "--cached", "--check"]] },
    { name: "tracked_privacy_scan", run: scanTrackedFilesForPrivacy },
    { name: "no_publish_boundary", run: checkNoPublishBoundary }
  ].map((gate) => ({
    ...gate,
    commandLabel: gate.command ? [path.basename(gate.command[0]), ...gate.command[1]].join(" ") : undefined
  }));
}

function runGate(gate) {
  const started = Date.now();
  try {
    let details = {};
    if (gate.run) {
      details = gate.run();
    } else {
      const [command, args] = gate.command;
      const stdout = execFileSync(command, args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      details = parseJsonOrSummarize(stdout);
    }
    return {
      name: gate.name,
      status: "pass",
      durationMs: Date.now() - started,
      ...details
    };
  } catch (error) {
    return {
      name: gate.name,
      status: "fail",
      durationMs: Date.now() - started,
      message: sanitizeMessage(error.stderr || error.stdout || error.message || String(error))
    };
  }
}

function checkVersionConsistency() {
  const pkg = readJson("package.json");
  const manifest = readJson("extension/manifest.json");
  const version = pkg.version;
  const contentScript = readText("extension/contentScript.js");
  const server = readText("server/overleaf-bridge-mcp.js");
  const mismatches = [];
  if (manifest.version !== version) mismatches.push("extension/manifest.json");
  if (!contentScript.includes(`BRIDGE_VERSION = "${version}"`)) mismatches.push("extension/contentScript.js");
  if (!server.includes(`serverInfo: { name: "overleaf-browser-bridge", version: "${version}" }`)) {
    mismatches.push("server/overleaf-bridge-mcp.js");
  }
  if (mismatches.length > 0) throw new Error(`Version mismatch in ${mismatches.join(", ")}`);
  return { version };
}

function scanTrackedFilesForPrivacy() {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split("\0")
    .filter(Boolean)
    .filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));

  const hits = [];
  for (const file of files) {
    const text = readText(file);
    for (const privacy of PRIVACY_PATTERNS) {
      if (privacy.pattern.test(text)) hits.push(`${file}: ${privacy.name}`);
    }
  }
  if (hits.length > 0) throw new Error(`Privacy scan found tracked-source hits: ${hits.join("; ")}`);
  return { scannedFiles: files.length, hits: 0 };
}

function checkNoPublishBoundary() {
  const version = readPackageVersion();
  const manifestPath = path.join(ROOT, "dist", `release-v${version}`, "release-assets-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing release asset manifest for ${version}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const publishActions = Array.isArray(manifest.publishActionsPerformed) ? manifest.publishActionsPerformed : [];
  if (publishActions.length > 0) {
    throw new Error(`Release asset manifest contains publish actions: ${publishActions.join(", ")}`);
  }
  return {
    releaseDir: path.posix.join("dist", `release-v${version}`),
    publishActionsPerformed: 0,
    published: false
  };
}

function parseJsonOrSummarize(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return summarizeJson(parsed);
  } catch (_error) {
    return { summary: text.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") };
  }
}

function summarizeJson(parsed) {
  const summary = {};
  for (const key of ["ok", "failed", "warnings", "version", "fileCount", "unpackedSize", "forbiddenFiles", "published"]) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) summary[key] = parsed[key];
  }
  if (parsed.releaseDir) summary.releaseDir = parsed.releaseDir;
  if (parsed.extensionZipSha256) summary.extensionZipSha256 = parsed.extensionZipSha256;
  if (parsed.expectedContentScriptVersion) summary.expectedContentScriptVersion = parsed.expectedContentScriptVersion;
  return summary;
}

function sanitizeMessage(message) {
  return String(message || "")
    .replace(new RegExp(escapeRegExp(ROOT), "gi"), "<REPO_ROOT>")
    .replace(/C:\\Users\\[^\\\r\n]+/gi, "C:\\Users\\<USER>")
    .replace(new RegExp(`/${"Users"}/[^/\\r\\n]+`, "gi"), `/${"Users"}/<USER>`)
    .replace(new RegExp(`/${"home"}/[^/\\r\\n]+`, "gi"), `/${"home"}/<USER>`)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-6)
    .join(" | ");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readPackageVersion() {
  return readJson("package.json").version;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module) main();

module.exports = {
  buildGatePlan,
  scanTrackedFilesForPrivacy,
  checkVersionConsistency,
  checkNoPublishBoundary
};
