#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SAFE_GATES = [
  {
    name: "live_smoke",
    script: "scripts/live-smoke-test.js",
    description: "Bridge, current project metadata, and visible file-tree metadata."
  },
  {
    name: "download_workflow",
    script: "scripts/live-download-workflow-test.js",
    description: "Read-only Overleaf download/export workflow inspection."
  },
  {
    name: "artifact_inventory",
    script: "scripts/live-artifact-inventory-test.js",
    description: "Metadata-only visible artifact inventory."
  },
  {
    name: "file_operation_ui",
    script: "scripts/live-file-operation-ui-test.js",
    description: "Read-only file-operation control discovery."
  },
  {
    name: "upload_workflow",
    script: "scripts/live-upload-workflow-test.js",
    description: "Read-only upload/image workflow inspection."
  },
  {
    name: "visible_comments",
    script: "scripts/live-comments-inspection-test.js",
    description: "Read-only visible comment/thread inspection."
  },
  {
    name: "prepare_file_operation",
    script: "scripts/live-prepare-file-operation-test.js",
    description: "Non-mutating file-operation confirmation plan."
  },
  {
    name: "prepare_comment_action",
    script: "scripts/live-prepare-comment-action-test.js",
    description: "Non-mutating comment action confirmation plan."
  }
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.list) {
    console.log(JSON.stringify({
      ok: true,
      mutating: false,
      gates: SAFE_GATES
    }, null, 2));
    return;
  }

  const verification = runLiveVerifier(options);
  const result = {
    ok: false,
    status: "running",
    mutating: false,
    expectedContentScriptVersion: packageVersion(),
    precheck: verification,
    gates: [],
    nextSteps: []
  };

  if (!verification.ok) {
    result.status = "failed";
    result.nextSteps = verification.nextSteps || ["Start the bridge and refresh an Overleaf project tab."];
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  if (!Array.isArray(verification.pages) || verification.pages.length === 0) {
    result.status = "blocked_no_page";
    result.ok = Boolean(options.allowNoPage);
    result.nextSteps = [
      "Open or refresh the target Overleaf project tab.",
      "Run npm run live:suite again after the tab reports content script freshness."
    ];
    console.log(JSON.stringify(result, null, 2));
    process.exit(options.allowNoPage ? 0 : 1);
  }

  for (const gate of SAFE_GATES) {
    result.gates.push(runScriptGate(gate));
  }

  const failed = result.gates.filter((gate) => gate.status !== "pass");
  result.ok = failed.length === 0;
  result.status = result.ok ? "passed" : "failed";
  result.nextSteps = result.ok
    ? ["Use guarded write/comment execution only after explicit user approval for an exact safe-target action."]
    : failed.map((gate) => `Fix ${gate.name}: ${gate.summary || gate.error || "gate failed"}`);

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function runLiveVerifier(options) {
  const args = [path.join(ROOT, "scripts", "post-install-live-check.js")];
  if (options.allowNoPage) args.push("--allow-no-page");
  const parsed = runJson(process.execPath, args, "live_verify");
  return parsed.json;
}

function runScriptGate(gate) {
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, gate.script)], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      name: gate.name,
      status: "pass",
      durationMs: Date.now() - startedAt,
      summary: summarizeOutput(stdout)
    };
  } catch (error) {
    return {
      name: gate.name,
      status: "fail",
      durationMs: Date.now() - startedAt,
      summary: summarizeOutput(error.stdout || ""),
      error: summarizeOutput(error.stderr || error.message || "")
    };
  }
}

function runJson(command, args, gateName) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { json: JSON.parse(stdout) };
  } catch (error) {
    const stdout = String(error.stdout || "");
    try {
      return { json: JSON.parse(stdout) };
    } catch (_) {
      throw new Error(`${gateName} failed: ${summarizeOutput(error.stderr || error.message || stdout)}`);
    }
  }
}

function summarizeOutput(output) {
  const text = String(output || "").trim();
  if (!text) return "";
  return text.split(/\r?\n/).slice(-8).join("\n");
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--list") {
      options.list = true;
    } else if (arg === "--allow-no-page") {
      options.allowNoPage = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/live-safe-suite.js [options]

Options:
  --list            Print the safe live gate plan without running browser checks.
  --allow-no-page   Return ok when the bridge is healthy but no Overleaf project tab is connected.
  -h, --help        Show this help.

The suite runs only metadata, read-only, or non-mutating planning gates.
It does not execute file operations, comment actions, uploads, downloads, or manuscript writes.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  SAFE_GATES,
  parseArgs,
  summarizeOutput
};
