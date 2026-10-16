#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const pkg = readJson("package.json");
  const infoPath = path.resolve(options.serverInfo || DEFAULT_INFO_PATH);
  const expectedVersion = options.expectedVersion || pkg.version;
  const checks = [];
  const pageSummaries = [];

  const info = readServerInfo(infoPath, checks, options.allowOffline);
  if (info) {
    await checkLiveBridge(info, expectedVersion, checks, pageSummaries, options);
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  const result = {
    ok: failed.length === 0,
    failed: failed.length,
    warnings: warned.length,
    expectedContentScriptVersion: expectedVersion,
    serverInfo: summarizeInfoPath(infoPath),
    checks,
    pages: pageSummaries,
    nextSteps: buildNextSteps(checks),
    safeToCommitGeneratedFiles: false
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = failed.length > 0 ? 1 : 0;
}

function readServerInfo(infoPath, checks, allowOffline) {
  if (!fs.existsSync(infoPath)) {
    const message = "No live bridge server-info found; start the bridge before running live verification";
    if (allowOffline) warn(checks, "server_info", message);
    else fail(checks, "server_info", message);
    return null;
  }

  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    if (!info.serverUrl || !info.token) {
      fail(checks, "server_info", "server-info.json is missing serverUrl or token");
      return null;
    }
    pass(checks, "server_info", "Found live bridge server metadata");
    return info;
  } catch (error) {
    fail(checks, "server_info", `Cannot read server-info.json: ${error.message}`);
    return null;
  }
}

async function checkLiveBridge(info, expectedVersion, checks, pageSummaries, options) {
  try {
    const body = await callTool(info, "health_check", {});
    if (!body.result || body.result.ok !== true) {
      const message = "Bridge health_check failed";
      if (options.allowOffline) warn(checks, "bridge_health", message);
      else fail(checks, "bridge_health", message);
      return;
    }

    const health = body.result;
    pass(checks, "bridge_health", `Bridge tool API is reachable with ${health.connectedClients || 0} connected page(s)`);
    if (health.tokenProtected === true) {
      pass(checks, "token_protection", "Bridge tool API reports token protection enabled");
    } else {
      fail(checks, "token_protection", "Bridge tool API did not report token protection");
    }

    const pages = Array.isArray(health.pages) ? health.pages : [];
    for (const page of pages) pageSummaries.push(summarizePage(page));
    if (pages.length === 0) {
      const message = "No connected Overleaf page is visible to the bridge";
      if (options.allowNoPage || options.allowOffline) warn(checks, "connected_pages", message);
      else fail(checks, "connected_pages", message);
      return;
    }

    pass(checks, "connected_pages", `${pages.length} connected Overleaf page(s) found`);
    const versions = Array.from(new Set(pages.map((page) => String(page.contentScriptVersion || "")).filter(Boolean)));
    const stalePages = pages.filter((page) => String(page.contentScriptVersion || "") !== expectedVersion);
    if (stalePages.length === 0) {
      pass(checks, "content_script_version", `All connected pages report content script ${expectedVersion}`);
    } else {
      fail(checks, "content_script_version", `Expected content script ${expectedVersion}, saw ${versions.length ? versions.join(", ") : "missing version"}`);
    }
    await checkFileOperationUiSchema(info, pages, pageSummaries, checks, options);
  } catch (error) {
    const message = `Bridge live verification failed: ${error.message}`;
    if (options.allowOffline) warn(checks, "bridge_health", message);
    else fail(checks, "bridge_health", message);
  }
}

async function checkFileOperationUiSchema(info, pages, pageSummaries, checks, options) {
  const stale = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    try {
      const body = await callTool(info, "inspect_file_operation_ui", { clientId: page.clientId || "" });
      const inspected = body.result || {};
      const summary = pageSummaries[index];
      if (summary) {
        summary.fileOperationUiSchemaVersion = Number(inspected.fileOperationUiSchemaVersion || 0);
        summary.fileOperationUiReloadRequired = Boolean(inspected.reloadRequired);
        summary.fileOperationUiStaleSchema = Boolean(inspected.staleSchema);
      }
      if (inspected.reloadRequired || Number(inspected.fileOperationUiSchemaVersion || 0) < 12 || !Array.isArray(inspected.visibleFolders)) {
        stale.push(`${page.projectTitle || page.clientId || "unknown page"}: ${inspected.reason || "missing file-operation UI schema v12"}`);
      }
    } catch (error) {
      stale.push(`${page.projectTitle || page.clientId || "unknown page"}: ${error.message}`);
    }
  }
  if (stale.length === 0) {
    pass(checks, "file_operation_ui_schema", "All connected pages report file-operation UI schema v12");
  } else {
    const message = `Stale file-operation UI schema detected; reload the unpacked Chrome extension and refresh Overleaf tab(s): ${stale.join("; ")}`;
    if (options.allowOffline) warn(checks, "file_operation_ui_schema", message);
    else fail(checks, "file_operation_ui_schema", message);
  }
}

async function callTool(info, name, args) {
  const response = await fetch(`${info.serverUrl}/tools/call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${info.token}`,
      "Connection": "close",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, arguments: args || {} })
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}`);
  }
  return body;
}

function summarizePage(page) {
  return {
    projectTitle: page.projectTitle || "",
    fileName: page.fileName || "",
    editorMode: page.editorMode || "",
    contentScriptVersion: page.contentScriptVersion || "",
    pageUrl: page.pageUrl || ""
  };
}

function summarizeInfoPath(infoPath) {
  const relative = path.relative(ROOT, infoPath).replace(/\\/g, "/");
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return "<external-server-info>";
}

function buildNextSteps(checks) {
  const failed = checks.filter((check) => check.status === "fail");
  if (failed.length === 0) {
    return [
      "Run node scripts/live-smoke-test.js.",
      "Run the task-specific live gate before using write or export tools."
    ];
  }

  const names = new Set(failed.map((check) => check.name));
  const steps = [];
  if (names.has("server_info") || names.has("bridge_health")) {
    steps.push("Start the bridge with npm start and keep the terminal running.");
  }
  if (names.has("connected_pages")) {
    steps.push("Open or refresh the target Overleaf project tab.");
  }
  if (names.has("content_script_version") || names.has("file_operation_ui_schema")) {
    steps.push("Reload the unpacked Chrome extension, then refresh the Overleaf project tab.");
  }
  if (names.has("token_protection")) {
    steps.push("Restart the bridge and reload the extension configuration.");
  }
  return steps.length ? steps : failed.map((check) => `Fix ${check.name}: ${check.message}`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--server-info") {
      options.serverInfo = takeValue(argv, ++index, arg);
    } else if (arg === "--expected-version") {
      options.expectedVersion = takeValue(argv, ++index, arg);
    } else if (arg === "--allow-offline") {
      options.allowOffline = true;
    } else if (arg === "--allow-no-page") {
      options.allowNoPage = true;
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
  console.log(`Usage: node scripts/post-install-live-check.js [options]

Options:
  --server-info <path>       Read bridge metadata from this file. Defaults to .runtime/server-info.json.
  --expected-version <semver> Override the expected content script version. Defaults to package.json version.
  --allow-offline            Treat missing or unreachable live bridge state as a warning.
  --allow-no-page            Treat zero connected Overleaf tabs as a warning.
  -h, --help                 Show this help.

The script checks live bridge health, connected Overleaf tabs, and content script version freshness without reading Overleaf credentials or manuscript text.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildNextSteps,
  parseArgs,
  summarizeInfoPath
};
