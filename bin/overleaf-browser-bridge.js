#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const pkg = require("../package.json");

const ROOT = path.resolve(__dirname, "..");
const COMMANDS = {
  doctor: {
    script: "scripts/doctor.js",
    summary: "Run repository and packaging diagnostics."
  },
  "first-run": {
    script: "scripts/first-run-check.js",
    summary: "Run local first-time setup checks."
  },
  "config:mcp": {
    script: "scripts/generate-mcp-config.js",
    summary: "Generate local Codex and Claude MCP config snippets."
  },
  "live:verify": {
    script: "scripts/post-install-live-check.js",
    summary: "Verify bridge health, connected pages, and content script freshness."
  },
  "live:suite": {
    script: "scripts/live-safe-suite.js",
    summary: "Run the combined safe browser-side validation suite."
  },
  "repo:metadata": {
    script: "scripts/repository-metadata-check.js",
    summary: "Check AI discovery, license, support, and no-publish metadata."
  },
  "release:assets": {
    script: "scripts/prepare-release-assets.js",
    summary: "Prepare local release assets without publishing."
  },
  "release:preflight": {
    script: "scripts/release-preflight.js",
    summary: "Run the final non-publishing release preflight gate."
  },
  "release:candidate": {
    script: "scripts/release-candidate-check.js",
    summary: "Summarize the current non-publishing release candidate."
  },
  "release:decision": {
    script: "scripts/release-decision-report.js",
    summary: "Generate a local human release decision packet without publishing."
  },
  "sync:mirror": {
    script: "scripts/mirror-sync-workflow.js",
    summary: "Run guarded mirror sync status, plan, and execute workflows."
  },
  "extension:build": {
    script: "scripts/prepare-extension-build.js",
    summary: "Create a private custom-domain extension copy."
  },
  "package:npm": {
    script: "scripts/package-npm-check.js",
    summary: "Run npm package dry-run validation without publishing."
  },
  "call-tool": {
    script: "scripts/call-tool.js",
    summary: "Call one local MCP tool through the token-protected bridge API."
  }
};

const ALIASES = {
  config: "config:mcp",
  "live-verify": "live:verify",
  "live-suite": "live:suite",
  "repo-metadata": "repo:metadata",
  "release-assets": "release:assets",
  "release-preflight": "release:preflight",
  "release-candidate": "release:candidate",
  "release-decision": "release:decision",
  "sync-mirror": "sync:mirror",
  "extension-build": "extension:build",
  "package-npm": "package:npm"
};

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (argv.includes("--list-commands")) {
    printCommandList();
    return;
  }

  const [command, ...rest] = argv;
  if (command && ["start", "server", "mcp"].includes(command)) {
    startServer(rest);
    return;
  }
  if (command && !command.startsWith("-")) {
    runCommand(command, rest);
    return;
  }

  startServer(argv);
}

function startServer(argv) {
  const {
    runStdioServer,
    parseCliArgs
  } = require("../server/overleaf-bridge-mcp");
  runStdioServer(parseCliArgs(argv)).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

function runCommand(command, argv) {
  const resolvedCommand = ALIASES[command] || command;
  const definition = COMMANDS[resolvedCommand];
  if (!definition) {
    console.error(`Unknown command: ${command}`);
    console.error("Run `overleaf-browser-bridge --help` to list supported commands.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [path.join(ROOT, definition.script), ...argv], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error && result.error.stack ? result.error.stack : result.error);
    process.exit(1);
  }
  process.exit(typeof result.status === "number" ? result.status : 1);
}

function printHelp() {
  const script = path.basename(process.argv[1] || "overleaf-browser-bridge");
  process.stdout.write([
    "overleaf-browser-bridge",
    "",
    "Start the local MCP stdio server, or run local setup, live, and release helper commands for an already-open Overleaf project tab.",
    "",
    "Usage:",
    `  ${script} [--port <number>] [--token <token>] [--snapshot-dir <path>]`,
    `  ${script} <command> [...args]`,
    "",
    "Options:",
    "  --port <number>          Local HTTP bridge port. Defaults to 38475.",
    "  --token <token>          Local bridge token for MCP/tool clients.",
    "  --snapshot-dir <path>    Private local snapshot/export directory.",
    "  --list-commands          Print machine-readable command names.",
    "  --version, -v            Print package version.",
    "  --help, -h               Print this help.",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([name, definition]) => `  ${name.padEnd(18)} ${definition.summary}`),
    "",
    "Aliases:",
    "  live-suite, live-verify, repo-metadata, release-preflight, release-candidate, release-decision, release-assets, sync-mirror, extension-build, package-npm",
    "",
    "Safety:",
    "  This tool does not ask for Overleaf cookies, sessions, passwords, OAuth tokens, or Git tokens.",
    "  Load the Chrome extension from extension/ and open or reload the target Overleaf project tab."
  ].join("\n") + "\n");
}

function printCommandList() {
  process.stdout.write(JSON.stringify({
    ok: true,
    commands: Object.keys(COMMANDS),
    aliases: ALIASES
  }, null, 2) + "\n");
}

main(process.argv.slice(2));
