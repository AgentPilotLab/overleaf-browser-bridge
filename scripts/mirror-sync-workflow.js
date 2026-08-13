#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");
const COMMANDS = ["status", "review-plan", "pull-plan", "push-plan", "execute"];

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.list) {
    printJson({
      ok: true,
      commands: COMMANDS,
      safety: {
        defaultIncludesDiffText: false,
        mutatingCommands: ["execute"],
        requiresConfirmationForExecute: true,
        supportsAutomaticSync: false
      }
    });
    return;
  }

  const request = buildToolRequest(options);
  const rawResponse = await callTool(options.serverInfoPath, request.toolName, request.arguments);
  const rawResult = unwrapToolResponse(rawResponse);
  const result = sanitizeToolResult(options.command, rawResult);
  printJson({
    ok: Boolean(rawResult && rawResult.ok !== false),
    command: options.command,
    toolName: request.toolName,
    defaultIncludesDiffText: false,
    supportsAutomaticSync: false,
    ...result
  });
}

function parseArgs(argv) {
  const options = {
    command: "",
    includeExtensions: [],
    maxDiffLines: undefined,
    serverInfoPath: DEFAULT_INFO_PATH
  };
  const args = [...argv];
  const first = args[0];
  if (!first || first === "--help" || first === "-h") {
    options.help = true;
    return options;
  }
  if (first === "--list") {
    options.list = true;
    return options;
  }
  if (!COMMANDS.includes(first)) {
    throw new Error(`Unknown mirror sync command: ${first}`);
  }
  options.command = args.shift();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-title") {
      options.projectTitle = takeValue(args, ++index, arg);
    } else if (arg === "--project-alias") {
      options.projectAlias = takeValue(args, ++index, arg);
    } else if (arg === "--target-lock-id") {
      options.targetLockId = takeValue(args, ++index, arg);
    } else if (arg === "--client-id") {
      options.clientId = takeValue(args, ++index, arg);
    } else if (arg === "--mirror-root") {
      options.mirrorRoot = takeValue(args, ++index, arg);
    } else if (arg === "--reason") {
      options.reason = takeValue(args, ++index, arg);
    } else if (arg === "--confirmation-token") {
      options.confirmationToken = takeValue(args, ++index, arg);
    } else if (arg === "--confirmation-phrase") {
      options.confirmationPhrase = takeValue(args, ++index, arg);
    } else if (arg === "--sync-plan-hash") {
      options.syncPlanHash = takeValue(args, ++index, arg);
    } else if (arg === "--include-extension") {
      options.includeExtensions.push(takeValue(args, ++index, arg));
    } else if (arg === "--include-extensions") {
      options.includeExtensions.push(...takeValue(args, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean));
    } else if (arg === "--max-diff-lines") {
      options.maxDiffLines = Number(takeValue(args, ++index, arg));
      if (!Number.isFinite(options.maxDiffLines) || options.maxDiffLines < 0) {
        throw new Error("--max-diff-lines must be a non-negative number");
      }
    } else if (arg === "--server-info") {
      options.serverInfoPath = path.resolve(takeValue(args, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function buildToolRequest(options) {
  const base = buildTargetArgs(options);
  if (options.command === "status") {
    return {
      toolName: "preview_mirror_diff",
      arguments: base
    };
  }
  if (options.command === "review-plan") {
    return {
      toolName: "prepare_mirror_sync_plan",
      arguments: { ...base, direction: "review_only", reason: options.reason || "review mirror drift" }
    };
  }
  if (options.command === "pull-plan") {
    return {
      toolName: "prepare_mirror_sync_plan",
      arguments: { ...base, direction: "overleaf_to_mirror", reason: options.reason || "prepare local mirror refresh" }
    };
  }
  if (options.command === "push-plan") {
    return {
      toolName: "prepare_mirror_sync_plan",
      arguments: { ...base, direction: "mirror_to_overleaf", reason: options.reason || "prepare update-only mirror write-back" }
    };
  }
  if (options.command === "execute") {
    for (const key of ["confirmationToken", "confirmationPhrase", "syncPlanHash"]) {
      if (!options[key]) throw new Error(`execute requires --${camelToFlag(key)}`);
    }
    return {
      toolName: "execute_mirror_sync_plan",
      arguments: {
        ...base,
        confirmationToken: options.confirmationToken,
        confirmationPhrase: options.confirmationPhrase,
        syncPlanHash: options.syncPlanHash,
        reason: options.reason || "execute approved mirror sync plan"
      }
    };
  }
  throw new Error(`Unsupported command: ${options.command}`);
}

function buildTargetArgs(options) {
  const args = {};
  for (const key of ["projectTitle", "projectAlias", "targetLockId", "clientId", "mirrorRoot", "reason"]) {
    if (options[key]) args[key] = options[key];
  }
  if (options.includeExtensions.length > 0) args.includeExtensions = options.includeExtensions;
  if (Number.isFinite(options.maxDiffLines)) args.maxDiffLines = options.maxDiffLines;
  return args;
}

async function callTool(serverInfoPath, toolName, args) {
  const info = readServerInfo(serverInfoPath);
  const response = await fetch(`${info.serverUrl}/tools/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${info.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: toolName, arguments: args })
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Bridge returned non-JSON response: ${sanitizeMessage(text || error.message)}`);
  }
  if (!response.ok) {
    throw new Error(sanitizeMessage(parsed.error || parsed.message || text || `Bridge HTTP ${response.status}`));
  }
  return parsed;
}

function unwrapToolResponse(response) {
  if (response && typeof response === "object" && response.result && typeof response.result === "object") {
    return response.result;
  }
  return response;
}

function readServerInfo(serverInfoPath) {
  if (!fs.existsSync(serverInfoPath)) {
    throw new Error(`Server info not found: ${sanitizePath(serverInfoPath)}. Start the bridge first.`);
  }
  const info = JSON.parse(fs.readFileSync(serverInfoPath, "utf8"));
  if (!info.serverUrl || !info.token) {
    throw new Error(`Server info is missing serverUrl or token: ${sanitizePath(serverInfoPath)}`);
  }
  return info;
}

function sanitizeToolResult(command, raw) {
  const cleaned = stripDiffFields(sanitizeValue(raw));
  if (command === "status") {
    return {
      projectTitle: cleaned.projectTitle || "",
      mirrorRoot: cleaned.mirrorRoot || "",
      manifestPath: cleaned.manifestPath || "",
      comparedFileCount: Number(cleaned.comparedFileCount || 0),
      changedFileCount: Number(cleaned.changedFileCount || 0),
      addedFileCount: Number(cleaned.addedFileCount || 0),
      removedFileCount: Number(cleaned.removedFileCount || 0),
      unchangedFileCount: countStatus(cleaned.files, "unchanged"),
      files: Array.isArray(cleaned.files) ? cleaned.files.map(summarizeFileDiff) : []
    };
  }
  return cleaned;
}

function summarizeFileDiff(file) {
  return {
    path: file.path || "",
    fileName: file.fileName || "",
    status: file.status || "",
    currentHash: file.currentHash || "",
    mirrorHash: file.mirrorHash || "",
    diffLineCount: Number(file.diffLineCount || 0),
    diffTruncated: Boolean(file.diffTruncated)
  };
}

function countStatus(files, status) {
  return Array.isArray(files) ? files.filter((file) => file && file.status === status).length : 0;
}

function stripDiffFields(value) {
  if (Array.isArray(value)) return value.map(stripDiffFields);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "diff" || key === "text" || key === "content" || key === "raw") continue;
    out[key] = stripDiffFields(item);
  }
  return out;
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeValue(item);
    return out;
  }
  if (typeof value === "string") return sanitizeMessage(value);
  return value;
}

function sanitizeMessage(message) {
  return sanitizePath(String(message || ""));
}

function sanitizePath(text) {
  return String(text || "")
    .replace(new RegExp(escapeRegExp(ROOT), "gi"), "<REPO_ROOT>")
    .replace(/C:\\Users\\[^\\\r\n]+/gi, "C:\\Users\\<USER>")
    .replace(new RegExp(`/${"Users"}/[^/\\r\\n]+`, "gi"), `/${"Users"}/<USER>`)
    .replace(new RegExp(`/${"home"}/[^/\\r\\n]+`, "gi"), `/${"home"}/<USER>`);
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function camelToFlag(key) {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/mirror-sync-workflow.js <command> [options]

Commands:
  status       Preview mirror drift with diff text removed from stdout.
  review-plan  Prepare a non-mutating review-only sync plan.
  pull-plan    Prepare an overleaf_to_mirror local refresh plan.
  push-plan    Prepare an update-only mirror_to_overleaf write-back plan.
  execute      Execute a previously approved plan with token, phrase, and hash.

Options:
  --project-title <title>          Target project title.
  --project-alias <alias>          Target project alias.
  --target-lock-id <id>            Target lock id.
  --client-id <id>                 Connected bridge client id.
  --mirror-root <path>             Mirror root returned by sync_project_snapshot.
  --reason <text>                  Human-readable reason for the plan or execute step.
  --confirmation-token <token>     Required for execute.
  --confirmation-phrase <phrase>   Required for execute.
  --sync-plan-hash <hash>          Required for execute.
  --include-extension <ext>        Repeatable extension filter, such as .tex.
  --include-extensions <list>      Comma-separated extension filter.
  --max-diff-lines <number>        Limit server-side diff computation.
  --server-info <path>             Path to server-info.json. Defaults to .runtime/server-info.json.
  --list                           Print machine-readable command metadata.
  --help, -h                       Print this help.

Safety:
  This wrapper does not perform automatic bidirectional sync.
  Status output removes diff text by default.
  Execute requires a token, exact phrase, and sync plan hash from a prior plan.
`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeMessage(error.message || String(error)));
    process.exit(1);
  });
}

module.exports = {
  COMMANDS,
  buildToolRequest,
  parseArgs,
  sanitizeToolResult,
  unwrapToolResponse
};
