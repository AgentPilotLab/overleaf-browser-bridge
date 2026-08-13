#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, ".runtime", "first-run");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  const checks = [];

  fs.mkdirSync(outDir, { recursive: true });

  checkNodeVersion(checks);
  checkRequiredFiles(checks);
  checkVersionConsistency(checks);
  checkPackageMetadata(checks);
  runConfigGeneration(checks, outDir);
  await checkOptionalLiveBridge(checks, options.requireLive === true);

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  const result = {
    ok: failed.length === 0,
    failed: failed.length,
    warnings: warned.length,
    outDir,
    checks,
    nextSteps: buildNextSteps(checks),
    safeToCommitGeneratedFiles: false
  };

  console.log(JSON.stringify(result, null, 2));
  if (failed.length > 0) process.exit(1);
}

function checkNodeVersion(checks) {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(major) && major >= 18) {
    pass(checks, "node_version", `Node.js ${process.version} satisfies >=18`);
  } else {
    fail(checks, "node_version", `Node.js >=18 is required, got ${process.version}`);
  }
}

function checkRequiredFiles(checks) {
  const required = [
    "README.md",
    "LICENSE",
    "llms.txt",
    "AGENTS.md",
    "package.json",
    "server/overleaf-bridge-mcp.js",
    "bin/overleaf-browser-bridge.js",
    "extension/manifest.json",
    "extension/background.js",
    "extension/contentScript.js",
    "extension/pageBridge.js",
    "config/codex-mcp.example.toml",
    "config/mcp-launch.example.json",
    "docs/AI_AGENT_GUIDE.md",
    "docs/INSTALLATION.md"
  ];
  const missing = required.filter((relativePath) => !fs.existsSync(path.join(ROOT, relativePath)));
  if (missing.length === 0) {
    pass(checks, "required_files", `${required.length} required files are present`);
  } else {
    fail(checks, "required_files", `Missing required files: ${missing.join(", ")}`);
  }
}

function checkVersionConsistency(checks) {
  try {
    const pkg = readJson("package.json");
    const manifest = readJson("extension/manifest.json");
    const contentScript = fs.readFileSync(path.join(ROOT, "extension/contentScript.js"), "utf8");
    const server = fs.readFileSync(path.join(ROOT, "server/overleaf-bridge-mcp.js"), "utf8");
    const version = pkg.version;
    const problems = [];
    if (manifest.version !== version) problems.push(`manifest=${manifest.version}`);
    if (!contentScript.includes(`BRIDGE_VERSION = "${version}"`)) problems.push("contentScript");
    if (!server.includes(`version: "${version}"`)) problems.push("serverInfo");
    if (problems.length === 0) {
      pass(checks, "version_consistency", `All version markers match ${version}`);
    } else {
      fail(checks, "version_consistency", `Version mismatch for: ${problems.join(", ")}`);
    }
  } catch (error) {
    fail(checks, "version_consistency", error.message);
  }
}

function checkPackageMetadata(checks) {
  try {
    const pkg = readJson("package.json");
    const requiredScripts = ["doctor", "test", "first-run", "live:verify", "live:suite", "config:mcp", "extension:build", "package:npm", "package:extension", "repo:metadata", "release:assets", "release:preflight", "release:candidate", "release:decision", "sync:mirror"];
    const missingScripts = requiredScripts.filter((scriptName) => !pkg.scripts || !pkg.scripts[scriptName]);
    const hasBin = pkg.bin
      && pkg.bin["overleaf-browser-bridge"] === "bin/overleaf-browser-bridge.js"
      && pkg.bin["overleaf-browser-bridge-mcp"] === "bin/overleaf-browser-bridge.js";
    const hasRepository = String(pkg.repository && pkg.repository.url || "").includes("AgentPilotLab/overleaf-browser-bridge");
    const problems = [];
    if (missingScripts.length > 0) problems.push(`missing scripts: ${missingScripts.join(", ")}`);
    if (!hasBin) problems.push("missing package bin aliases");
    if (!hasRepository) problems.push("repository metadata");
    if (pkg.license !== "SEE LICENSE IN LICENSE") problems.push("license field");
    if (problems.length === 0) {
      pass(checks, "package_metadata", "Package metadata supports local and package-style installs");
    } else {
      fail(checks, "package_metadata", problems.join("; "));
    }
  } catch (error) {
    fail(checks, "package_metadata", error.message);
  }
}

function runConfigGeneration(checks, outDir) {
  try {
    const configOutDir = path.join(outDir, "generated-configs");
    const output = execFileSync(process.execPath, [
      path.join(ROOT, "scripts/generate-mcp-config.js"),
      "--out-dir",
      configOutDir
    ], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const parsed = JSON.parse(output);
    const codexExists = fs.existsSync(path.join(configOutDir, "codex-mcp.toml"));
    const claudeExists = fs.existsSync(path.join(configOutDir, "mcp-launch.json"));
    if (parsed.ok && parsed.safeToCommit === false && codexExists && claudeExists) {
      pass(checks, "config_generation", `Generated local MCP snippets under ${path.relative(ROOT, configOutDir).replace(/\\/g, "/")}`);
    } else {
      fail(checks, "config_generation", "Config generator did not produce the expected private snippets");
    }
  } catch (error) {
    fail(checks, "config_generation", error.message);
  }
}

async function checkOptionalLiveBridge(checks, requireLive) {
  const infoPath = path.join(ROOT, ".runtime", "server-info.json");
  if (!fs.existsSync(infoPath)) {
    const message = "No live bridge server-info found; start the bridge and run live smoke tests when Chrome is ready";
    if (requireLive) fail(checks, "live_bridge", message);
    else warn(checks, "live_bridge", message);
    return;
  }
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    const response = await fetch(`${info.serverUrl}/health`, {
      headers: { "Authorization": `Bearer ${info.token}` }
    });
    const body = await response.json();
    if (response.ok && body.ok) {
      pass(checks, "live_bridge", `Bridge health endpoint is reachable with ${body.connectedClients || 0} connected page(s)`);
    } else {
      const message = `Bridge health endpoint returned ${response.status}`;
      if (requireLive) fail(checks, "live_bridge", message);
      else warn(checks, "live_bridge", message);
    }
  } catch (error) {
    const message = `Bridge health check skipped or unreachable: ${error.message}`;
    if (requireLive) fail(checks, "live_bridge", message);
    else warn(checks, "live_bridge", message);
  }
}

function buildNextSteps(checks) {
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.length > 0) return failed.map((check) => `Fix ${check.name}: ${check.message}`);
  const steps = [
    "Load or reload extension/ as an unpacked Chrome extension.",
    "Open or refresh the target Overleaf project tab.",
    "Start the bridge with npm start.",
    "Run node scripts/live-smoke-test.js before any read or write task."
  ];
  if (checks.some((check) => check.name === "live_bridge" && check.status === "pass")) {
    steps.unshift("Live bridge is reachable; run the relevant live gate for the task.");
  }
  return steps;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--out-dir") {
      options.outDir = takeValue(argv, ++index, arg);
    } else if (arg === "--require-live") {
      options.requireLive = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function pass(checks, name, message) {
  checks.push({ name, status: "pass", message });
}

function warn(checks, name, message) {
  checks.push({ name, status: "warn", message });
}

function fail(checks, name, message) {
  checks.push({ name, status: "fail", message });
}

function printHelp() {
  console.log(`Usage: node scripts/first-run-check.js [options]

Options:
  --out-dir <path>   Output directory for generated first-run artifacts. Defaults to .runtime/first-run.
  --require-live     Fail if the local bridge health endpoint is not reachable.
  -h, --help         Show this help.

The script does not read Overleaf cookies, sessions, Git tokens, passwords, OAuth tokens, or manuscript text.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildNextSteps,
  parseArgs
};
