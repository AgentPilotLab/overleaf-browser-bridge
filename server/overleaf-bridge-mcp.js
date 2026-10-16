#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, ".runtime");
const DEFAULT_ALIAS_FILE = path.join(RUNTIME_DIR, "project-aliases.json");
const DEFAULT_SNAPSHOT_DIR = path.join(osHomeDir(), ".codex", "overleaf-bridge", "projects");
const DEFAULT_PORT = 38475;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_COMPILE_TIMEOUT_MS = 90000;
const CLIENT_STALE_MS = 90_000;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
// Base64 for the largest supported artifact, plus its JSON envelope.
const MAX_BRIDGE_RESULT_CHARS = 4 * Math.ceil(MAX_ARTIFACT_BYTES / 3) + 64 * 1024;

const TOOL_DEFINITIONS = [
  {
    name: "health_check",
    description: "Check bridge health, connected Overleaf project tabs, token protection, and optional editor readiness.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "list_project_aliases",
    description: "List user-defined project aliases for connected Overleaf tabs. Aliases store title matching rules only, never credentials.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "set_project_alias",
    description: "Create or update a local project alias that maps a short name to an Overleaf project title substring.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Short local alias such as paper or thesis." },
        projectTitle: { type: "string", description: "Substring of the target Overleaf project title." }
      },
      required: ["alias", "projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "clear_project_alias",
    description: "Remove a local project alias from the bridge alias file.",
    inputSchema: {
      type: "object",
      properties: {
        alias: { type: "string", description: "Alias to remove." }
      },
      required: ["alias"],
      additionalProperties: false
    }
  },
  {
    name: "lock_target_project",
    description: "Lock a connected Overleaf tab as the target for later calls, preventing accidental routing to another project tab.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "unlock_target_project",
    description: "Release a target project lock created by lock_target_project.",
    inputSchema: {
      type: "object",
      properties: {
        targetLockId: { type: "string", description: "Lock id returned by lock_target_project." }
      },
      required: ["targetLockId"],
      additionalProperties: false
    }
  },
  {
    name: "list_target_locks",
    description: "List active in-memory target project locks for this bridge server session.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "get_current_project",
    description: "Read current Overleaf project metadata from the selected browser tab.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "paper_context",
    description: "Return project files, current file, likely main entry file, bib candidates, and recent compile status.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "list_open_project_files",
    description: "Read the visible Overleaf file tree for the selected open project tab.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "open_file",
    description: "Open a .tex/.bib or related source file from the current Overleaf file tree.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "File name or visible file-tree path to open." }
      },
      required: ["projectTitle", "fileName"],
      additionalProperties: false
    }
  },
  {
    name: "read_current_file",
    description: "Read the currently open Overleaf source editor file text, optionally with contextBudget summary, section, or diff mode.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        ...readBudgetSchemaProperties()
      },
      additionalProperties: false
    }
  },
  {
    name: "read_file",
    description: "Open a specific visible project file and read its editor text, optionally with contextBudget summary, section, or diff mode.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        ...readBudgetSchemaProperties(),
        fileName: { type: "string", description: "File name or visible file-tree path to read." }
      },
      required: ["projectTitle", "fileName"],
      additionalProperties: false
    }
  },
  {
    name: "read_file_range",
    description: "Read a line range from the current or selected Overleaf source file without returning the full file text.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "Optional file name or visible file-tree path to read." },
        startLine: { type: "number", description: "1-based first line to include." },
        endLine: { type: "number", description: "1-based last line to include." },
        maxChars: { type: "number", description: "Optional maximum returned characters." }
      },
      required: ["projectTitle", "startLine", "endLine"],
      additionalProperties: false
    }
  },
  {
    name: "read_file_since_hash",
    description: "Read the current or selected file relative to a previously observed hash, returning unchanged, bounded diff, or summary metadata.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "Optional file name or visible file-tree path to read." },
        sinceHash: { type: "string", description: "Previously observed full-file SHA-256 hash." },
        beforeHash: { type: "string", description: "Alias for sinceHash." },
        mode: { type: "string", enum: ["summary", "diff"], description: "Return changed summary or bounded diff. Defaults to diff." },
        maxDiffLines: { type: "number", description: "Maximum diff lines to return." }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "get_sections",
    description: "Parse LaTeX section headings from the current or selected Overleaf source file.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "Optional file name or visible file-tree path to parse." }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_section_content",
    description: "Return one LaTeX section by title, path, level, or 1-based sectionIndex from the current or selected file.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "Optional file name or visible file-tree path to parse." },
        title: { type: "string", description: "Section title to match, case-insensitive after lightweight LaTeX cleanup." },
        path: { type: "string", description: "Slash-separated section path, such as Introduction/Motivation." },
        level: { type: ["string", "number"], description: "Optional level filter, such as section, subsection, or 2." },
        sectionIndex: { type: "number", description: "1-based index in the parsed section list." },
        includeHeading: { type: "boolean", description: "Return the heading plus body when true; default returns body only." }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_selection",
    description: "Read selected text and nearby context from the current Overleaf editor.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "get_editor_diagnostics",
    description: "Read visible Overleaf editor diagnostics, lint tooltips, and nearby UI error text from the current source editor.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "replace_section",
    description: "Replace one LaTeX section body or full section after project, file, section, and beforeHash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        fileName: { type: "string", description: "Optional file name or visible file-tree path to edit." },
        title: { type: "string", description: "Section title to match, case-insensitive after lightweight LaTeX cleanup." },
        path: { type: "string", description: "Slash-separated section path, such as Introduction/Motivation." },
        level: { type: ["string", "number"], description: "Optional level filter, such as section, subsection, or 2." },
        sectionIndex: { type: "number", description: "1-based index in the parsed section list." },
        text: { type: "string", description: "Replacement text. By default this replaces the section body while preserving the heading." },
        preserveHeading: { type: "boolean", description: "Preserve the matched heading and replace only the body. Defaults to true." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "text"],
      additionalProperties: false
    }
  },
  {
    name: "insert_text",
    description: "Insert text at the current cursor in the selected Overleaf editor after hash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        text: { type: "string", description: "Text to insert at the current cursor." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "text"],
      additionalProperties: false
    }
  },
  {
    name: "replace_selection",
    description: "Replace the current Overleaf editor selection after hash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        text: { type: "string", description: "Replacement text for the current selection." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "text"],
      additionalProperties: false
    }
  },
  {
    name: "replace_file",
    description: "Replace the full current file only when project, file, and beforeHash match.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        text: { type: "string", description: "Full replacement file text." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "text"],
      additionalProperties: false
    }
  },
  {
    name: "apply_patch_to_file",
    description: "Apply a hash-checked unified diff to a selected file and record before/after snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        patch: { type: "string", description: "Unified diff patch for the target file." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "patch"],
      additionalProperties: false
    }
  },
  {
    name: "compile_and_read_log",
    description: "Trigger Overleaf Recompile and return errors, warnings, pages, and key visible log text.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      additionalProperties: false
    }
  },
  {
    name: "sync_project_snapshot",
    description: "Save readable source files from the open Overleaf project to the local private project mirror and write a manifest.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        includeExtensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file extensions to sync, such as .tex and .bib."
        }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "preview_mirror_diff",
    description: "Compare the current open Overleaf project against a local mirror snapshot without writing back to Overleaf.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        mirrorRoot: { type: "string", description: "Optional root returned by sync_project_snapshot. Defaults to the latest mirror for projectTitle." },
        includeExtensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file extensions to compare."
        },
        maxDiffLines: { type: "number", description: "Maximum diff lines per changed file." }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "prepare_mirror_sync_plan",
    description: "Prepare a non-mutating sync plan between the current open Overleaf project and a local mirror snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        mirrorRoot: { type: "string", description: "Optional root returned by sync_project_snapshot. Defaults to the latest mirror for projectTitle." },
        direction: {
          type: "string",
          enum: ["review_only", "overleaf_to_mirror", "mirror_to_overleaf"],
          description: "Planning direction. Defaults to review_only and never executes changes."
        },
        includeExtensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of file extensions to compare."
        },
        maxDiffLines: { type: "number", description: "Maximum diff lines per changed file." },
        reason: { type: "string", description: "Why the agent is preparing this sync plan." }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "execute_mirror_sync_plan",
    description: "Execute a prepared mirror sync plan after explicit confirmation. Supports local mirror refresh and update-only mirror-to-Overleaf write-back with fresh hash checks.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        confirmationToken: { type: "string", description: "Token returned by prepare_mirror_sync_plan." },
        confirmationPhrase: { type: "string", description: "Exact confirmation phrase returned by prepare_mirror_sync_plan." },
        syncPlanHash: { type: "string", description: "Plan hash returned by prepare_mirror_sync_plan." },
        reason: { type: "string", description: "Why the agent is executing this guarded mirror sync plan." }
      },
      required: ["projectTitle", "confirmationToken", "confirmationPhrase", "syncPlanHash", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "find_in_project_mirror",
    description: "Search or locate files and LaTeX sections inside a local project mirror snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        projectTitle: { type: "string", description: "Project title used to find the latest local mirror." },
        mirrorRoot: { type: "string", description: "Optional root returned by sync_project_snapshot." },
        fileName: { type: "string", description: "Optional file name or mirror-relative path to inspect." },
        query: { type: "string", description: "Optional text query to search across mirrored files." },
        title: { type: "string", description: "Optional LaTeX section title to locate." },
        path: { type: "string", description: "Optional slash-separated LaTeX section path." },
        sectionIndex: { type: "number", description: "Optional 1-based section index inside the selected file." },
        level: { type: ["string", "number"], description: "Optional LaTeX section level filter." },
        maxMatches: { type: "number", description: "Maximum file or text matches to return." },
        maxChars: { type: "number", description: "Maximum returned section or snippet characters." }
      },
      additionalProperties: false
    }
  },
  {
    name: "export_current_file",
    description: "Export the current or selected Overleaf source file to the local private export directory without changing Overleaf.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        fileName: { type: "string", description: "Optional visible file-tree path to export." }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "export_compile_log",
    description: "Trigger or read visible Overleaf compile status and save the visible log summary locally without using cookies.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "list_visible_artifacts",
    description: "List visible Overleaf PDF/log/download artifact candidates from the current browser page without downloading files or reading cookies.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "export_artifact_inventory",
    description: "Export a local private JSON inventory of visible Overleaf artifact candidates without downloading private artifacts.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "export_visible_artifact",
    description: "Export one visible downloadable Overleaf artifact candidate to the local private export directory without exposing cookies, sessions, or raw private URLs.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        artifactIndex: { type: "number", description: "Optional zero-based index from list_visible_artifacts." },
        artifactType: { type: "string", enum: ["pdf", "bbl", "aux", "blg", "log", "download"], description: "Optional artifact type selector." },
        labelContains: { type: "string", description: "Optional visible label substring selector." },
        outputFileName: { type: "string", description: "Optional local export file name. Path separators are sanitized." },
        maxBytes: { type: "number", description: "Maximum artifact bytes to export. Default 10485760, maximum 26214400." }
      },
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "inspect_file_operation_ui",
    description: "Inspect visible Overleaf file-management controls for create, rename, delete, and upload readiness without clicking them.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "inspect_upload_workflow",
    description: "Inspect visible Overleaf upload controls, file input constraints, drop zones, and image candidates without opening a picker or uploading files.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "inspect_download_workflow",
    description: "Inspect visible Overleaf download/export controls and downloadable candidates without clicking controls, downloading files, or reading cookies.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "inspect_visible_comments",
    description: "Inspect visible Overleaf comment and review-thread UI metadata without replying, resolving, reopening, or clicking controls.",
    inputSchema: {
      type: "object",
      properties: targetSchemaProperties(),
      required: ["projectTitle"],
      additionalProperties: false
    }
  },
  {
    name: "prepare_comment_action",
    description: "Prepare a non-mutating confirmation plan for a future visible comment reply, resolve, reopen, or delete-comment action. This never clicks or changes Overleaf.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        action: { type: "string", enum: ["reply", "resolve", "reopen", "delete-comment"], description: "Comment action to plan, not execute." },
        threadIndex: { type: "number", description: "Optional zero-based index from inspect_visible_comments." },
        previewContains: { type: "string", description: "Optional visible preview substring used to select a thread." },
        lineNumber: { type: "number", description: "Optional visible line number hint used to select a thread." },
        reason: { type: "string", description: "Short reason recorded in the non-mutating confirmation plan." }
      },
      required: ["projectTitle", "action", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "execute_comment_action",
    description: "Execute a previously prepared visible comment action only after exact confirmation token, phrase, and fresh thread-list hash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        confirmationToken: { type: "string", description: "Token returned by prepare_comment_action." },
        confirmationPhrase: { type: "string", description: "Exact confirmation phrase returned by prepare_comment_action." },
        threadListHash: { type: "string", description: "Visible thread-list hash returned by prepare_comment_action; rechecked before execution." },
        replyText: { type: "string", description: "Reply text, required only when the prepared action is reply. The bridge returns only its length." },
        reason: { type: "string", description: "Short reason recorded for this execution." }
      },
      required: ["projectTitle", "confirmationToken", "confirmationPhrase", "threadListHash", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "prepare_file_operation",
    description: "Prepare a non-mutating confirmation plan for a future create, rename, or delete file operation. This never clicks or changes Overleaf.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        operation: { type: "string", enum: ["create", "rename", "delete"], description: "File operation to plan, not execute." },
        fileName: { type: "string", description: "Target file path for create/delete, or source file path for rename." },
        newFileName: { type: "string", description: "Destination file path for rename." },
        reason: { type: "string", description: "Short reason recorded in the non-mutating confirmation plan." }
      },
      required: ["projectTitle", "operation", "fileName", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "execute_file_operation",
    description: "Execute a previously prepared create, rename, or delete file operation only after exact confirmation token, phrase, and fresh file-list hash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetSchemaProperties(),
        confirmationToken: { type: "string", description: "Token returned by prepare_file_operation." },
        confirmationPhrase: { type: "string", description: "Exact confirmation phrase returned by prepare_file_operation." },
        fileListHash: { type: "string", description: "File-list hash returned by prepare_file_operation; rechecked before execution." },
        reason: { type: "string", description: "Short reason recorded for this execution." }
      },
      required: ["projectTitle", "confirmationToken", "confirmationPhrase", "fileListHash", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "get_recent_patch_log",
    description: "Return recent local patch/snapshot records made by this bridge.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum records to return." }
      },
      additionalProperties: false
    }
  },
  {
    name: "restore_from_snapshot",
    description: "Restore a recorded before/after snapshot back into the current expected file after hash validation.",
    inputSchema: {
      type: "object",
      properties: {
        ...writeSchemaProperties(),
        snapshotPath: { type: "string", description: "Path returned by a previous snapshot record." }
      },
      required: ["projectTitle", "expectedFileName", "beforeHash", "reason", "snapshotPath"],
      additionalProperties: false
    }
  }
];

function targetSchemaProperties() {
  return {
    clientId: { type: "string", description: "Specific connected browser client id." },
    targetLockId: { type: "string", description: "Session target lock returned by lock_target_project." },
    projectAlias: { type: "string", description: "User-defined local alias from the bridge alias file." },
    projectTitle: { type: "string", description: "Substring of target Overleaf project title." },
    expectedFileName: { type: "string", description: "Abort if the current file name differs." }
  };
}

function readBudgetSchemaProperties() {
  return {
    contextBudget: { type: "string", enum: ["full", "summary", "section", "diff"], description: "Return full text, summary, one section, or diff relative to sinceHash." },
    context_budget: { type: "string", enum: ["full", "summary", "section", "diff"], description: "Snake-case alias for contextBudget." },
    sinceHash: { type: "string", description: "Previously observed full-file hash for diff mode." },
    maxChars: { type: "number", description: "Maximum characters for summary/range text preview." },
    maxDiffLines: { type: "number", description: "Maximum diff lines for diff mode." },
    sectionIndex: { type: "number", description: "1-based section index for section contextBudget." },
    title: { type: "string", description: "Section title for section contextBudget." },
    path: { type: "string", description: "Section path for section contextBudget." },
    level: { type: ["string", "number"], description: "Optional section level filter for section contextBudget." }
  };
}

function writeSchemaProperties() {
  return {
    projectTitle: { type: "string", description: "Substring of target Overleaf project title. Required for writes." },
    projectAlias: { type: "string", description: "Optional user-defined local alias for the target Overleaf project." },
    targetLockId: { type: "string", description: "Optional session target lock returned by lock_target_project." },
    expectedFileName: { type: "string", description: "Exact current file name expected before writing." },
    beforeHash: { type: "string", description: "SHA-256 of the file text read before this write." },
    reason: { type: "string", description: "Short Codex task summary recorded in the local patch log." },
    clientId: { type: "string", description: "Optional connected browser client id." }
  };
}

function createBridgeServer(options = {}) {
  const port = Number(options.port !== undefined ? options.port : (process.env.OVERLEAF_BRIDGE_PORT || DEFAULT_PORT));
  const token = String(options.token || process.env.OVERLEAF_BRIDGE_TOKEN || ensureRuntimeToken());
  const snapshotDir = path.resolve(options.snapshotDir || process.env.OVERLEAF_BRIDGE_SNAPSHOT_DIR || DEFAULT_SNAPSHOT_DIR);
  const aliasFile = path.resolve(options.aliasFile || process.env.OVERLEAF_BRIDGE_ALIAS_FILE || DEFAULT_ALIAS_FILE);
  const commandTimeoutMs = Number(options.commandTimeoutMs || DEFAULT_TIMEOUT_MS);
  const compileCommandTimeoutMs = Number(options.compileCommandTimeoutMs || Math.max(commandTimeoutMs, DEFAULT_COMPILE_TIMEOUT_MS));

  const state = {
    port,
    token,
    snapshotDir,
    aliasFile,
    commandTimeoutMs,
    compileCommandTimeoutMs,
    server: null,
    clients: new Map(),
    pendingById: new Map(),
    patchLog: [],
    readCache: new Map(),
    projectAliases: loadProjectAliases(aliasFile),
    targetLocks: new Map(),
    pendingFileOperations: new Map(),
    pendingCommentActions: new Map(),
    pendingMirrorSyncPlans: new Map()
  };

  const server = http.createServer((req, res) => {
    handleHttpRequest(state, req, res).catch((error) => {
      writeJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    });
  });
  state.server = server;

  return {
    state,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    async callTool(name, args = {}) {
      return callTool(state, name, args);
    },
    tools() {
      return TOOL_DEFINITIONS;
    }
  };
}

async function handleHttpRequest(state, req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/health" && req.method === "GET") {
    pruneStaleClients(state);
    writeJson(res, 200, {
      ok: true,
      service: "overleaf-browser-bridge",
      connectedClients: state.clients.size,
      tokenProtected: true,
      serverTime: new Date().toISOString()
    });
    return;
  }

  if (url.pathname === "/bridge/register" && req.method === "POST") {
    if (!isBridgeAuthorized(state, req)) {
      writeJson(res, 401, { ok: false, error: "unauthorized bridge client" });
      return;
    }
    const body = await readJsonBody(req);
    const clientId = sanitizeId(body.clientId) || crypto.randomUUID();
    const now = new Date().toISOString();
    const existing = state.clients.get(clientId);
    const client = existing || {
      id: clientId,
      queue: [],
      waiters: [],
      createdAt: now,
      lastSeenAt: now,
      pageUrl: "",
      projectTitle: "",
      fileName: "",
      editorMode: "",
      contentScriptVersion: ""
    };
    client.lastSeenAt = now;
    client.pageUrl = String(body.pageUrl || client.pageUrl || "");
    client.projectTitle = cleanOverleafLabel(String(body.projectTitle || client.projectTitle || ""));
    client.fileName = cleanOverleafFileName(String(body.fileName || client.fileName || ""));
    client.editorMode = String(body.editorMode || client.editorMode || "");
    client.contentScriptVersion = String(body.contentScriptVersion || client.contentScriptVersion || "");
    state.clients.set(clientId, client);
    writeJson(res, 200, { ok: true, clientId, serverTime: now });
    return;
  }

  if (url.pathname === "/tools/list" && req.method === "GET") {
    if (!isAuthorized(state, req)) {
      writeJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    writeJson(res, 200, { ok: true, tools: TOOL_DEFINITIONS });
    return;
  }

  if (url.pathname === "/tools/call" && req.method === "POST") {
    if (!isAuthorized(state, req)) {
      writeJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody(req);
    const name = String(body.name || "");
    const args = body.arguments || {};
    const result = await callTool(state, name, args);
    writeJson(res, 200, { ok: true, result });
    return;
  }

  if (url.pathname === "/bridge/next" && ["GET", "POST"].includes(req.method)) {
    if (!isBridgeAuthorized(state, req)) {
      writeJson(res, 401, { ok: false, error: "unauthorized bridge client" });
      return;
    }
    const client = getClientById(state, url.searchParams.get("clientId"));
    if (!client) {
      writeJson(res, 404, { ok: false, error: "unknown client" });
      return;
    }
    client.lastSeenAt = new Date().toISOString();
    const command = client.queue.shift();
    if (command) {
      writeJson(res, 200, { ok: true, command });
      return;
    }
    const timeout = setTimeout(() => {
      removeWaiter(client, waiter);
      writeJson(res, 200, { ok: true, command: null });
    }, 25000);
    const waiter = { res, timeout };
    client.waiters.push(waiter);
    res.on("close", () => {
      if (res.writableEnded) return;
      clearTimeout(timeout);
      removeWaiter(client, waiter);
    });
    return;
  }

  if (url.pathname === "/bridge/result" && req.method === "POST") {
    if (!isBridgeAuthorized(state, req)) {
      writeJson(res, 401, { ok: false, error: "unauthorized bridge client" });
      return;
    }
    const body = await readJsonBody(req, MAX_BRIDGE_RESULT_CHARS);
    const pending = state.pendingById.get(String(body.id || ""));
    if (!pending) {
      writeJson(res, 404, { ok: false, error: "unknown command id" });
      return;
    }
    state.pendingById.delete(pending.id);
    clearTimeout(pending.timeout);
    if (body.ok) {
      const payload = normalizeBrowserPayload(body.payload || {});
      refreshClientMetadata(pending.client, payload);
      pending.resolve(payload);
    } else {
      pending.reject(new Error(String(body.error || "browser command failed")));
    }
    writeJson(res, 200, { ok: true });
    return;
  }

  writeJson(res, 404, { ok: false, error: "not found" });
}

async function callTool(state, name, args = {}) {
  pruneStaleClients(state);
  if (name === "health_check") {
    const base = {
      ok: true,
      service: "overleaf-browser-bridge",
      tokenProtected: true,
      connectedClients: state.clients.size,
      pages: listClients(state),
      projectAliases: listProjectAliases(state),
      targetLocks: listTargetLocks(state)
    };
    if (state.clients.size === 0 || !hasTargetSelector(args)) return base;
    return { ...base, editor: await sendCommand(state, args, "health_check", args) };
  }
  if (name === "list_project_aliases") {
    return { aliasFile: state.aliasFile, aliases: listProjectAliases(state) };
  }
  if (name === "set_project_alias") {
    return setProjectAlias(state, args);
  }
  if (name === "clear_project_alias") {
    return clearProjectAlias(state, args);
  }
  if (name === "lock_target_project") {
    return lockTargetProject(state, args);
  }
  if (name === "unlock_target_project") {
    return unlockTargetProject(state, args);
  }
  if (name === "list_target_locks") {
    return { locks: listTargetLocks(state) };
  }
  if (name === "get_recent_patch_log") {
    const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
    return { records: state.patchLog.slice(-limit).reverse() };
  }

  if (name === "get_current_project") {
    return sendCommand(state, args, "get_current_project", args);
  }
  if (name === "paper_context") {
    return paperContext(state, args);
  }
  if (name === "list_open_project_files") {
    return sendCommand(state, args, "list_open_project_files", args);
  }
  if (name === "open_file") {
    if (!args.fileName) throw new Error("open_file requires fileName");
    return sendCommand(state, args, "open_file", args);
  }
  if (name === "read_current_file") {
    const read = rememberRead(state, await sendCommand(state, args, "read_current_file", args));
    return applyReadBudget(state, read, args);
  }
  if (name === "read_file") {
    return readFile(state, args);
  }
  if (name === "read_file_range") {
    return readFileRange(state, args);
  }
  if (name === "read_file_since_hash") {
    return readFileSinceHash(state, args);
  }
  if (name === "get_sections") {
    return getSections(state, args);
  }
  if (name === "get_section_content") {
    return getSectionContent(state, args);
  }
  if (name === "get_selection") {
    return sendCommand(state, args, "get_selection", args);
  }
  if (name === "get_editor_diagnostics") {
    return sendCommand(state, args, "get_editor_diagnostics", args);
  }
  if (name === "replace_section") {
    if (typeof args.text !== "string") throw new Error("replace_section requires text");
    return replaceSection(state, args);
  }
  if (name === "insert_text") {
    if (!args.text) throw new Error("insert_text requires text");
    return writeWithSnapshots(state, args, "insert_text", { text: args.text });
  }
  if (name === "replace_selection") {
    const replacement = args.text !== undefined ? args.text : args.replacement;
    if (typeof replacement !== "string") throw new Error("replace_selection requires text");
    return writeWithSnapshots(state, args, "replace_selection", { replacement });
  }
  if (name === "replace_file") {
    if (typeof args.text !== "string") throw new Error("replace_file requires text");
    return replaceFileWithSnapshots(state, args, args.text, "replace_file");
  }
  if (name === "apply_patch_to_file") {
    if (typeof args.patch !== "string") throw new Error("apply_patch_to_file requires patch");
    const before = await readFileForWrite(state, args);
    const nextText = applyUnifiedPatch(String(before.text || ""), args.patch);
    return replaceFileWithSnapshots(state, args, nextText, "apply_patch_to_file", before);
  }
  if (name === "compile_and_read_log") {
    const result = await sendCommand(state, args, "compile_project", args, state.compileCommandTimeoutMs);
    const compileSummary = summarizeCompileLog(result);
    return { ...result, visibleStatus: compileSummary.statusText || result.visibleStatus || "", compileSummary };
  }
  if (name === "sync_project_snapshot") {
    return syncProjectSnapshot(state, args);
  }
  if (name === "preview_mirror_diff") {
    return previewMirrorDiff(state, args);
  }
  if (name === "prepare_mirror_sync_plan") {
    return prepareMirrorSyncPlan(state, args);
  }
  if (name === "execute_mirror_sync_plan") {
    return executeMirrorSyncPlan(state, args);
  }
  if (name === "find_in_project_mirror") {
    return findInProjectMirror(state, args);
  }
  if (name === "export_current_file") {
    return exportCurrentFile(state, args);
  }
  if (name === "export_compile_log") {
    return exportCompileLog(state, args);
  }
  if (name === "list_visible_artifacts") {
    return listVisibleArtifacts(state, args);
  }
  if (name === "export_artifact_inventory") {
    return exportArtifactInventory(state, args);
  }
  if (name === "export_visible_artifact") {
    return exportVisibleArtifact(state, args);
  }
  if (name === "inspect_file_operation_ui") {
    return inspectFileOperationUi(state, args);
  }
  if (name === "inspect_upload_workflow") {
    return inspectUploadWorkflow(state, args);
  }
  if (name === "inspect_download_workflow") {
    return inspectDownloadWorkflow(state, args);
  }
  if (name === "inspect_visible_comments") {
    return inspectVisibleComments(state, args);
  }
  if (name === "prepare_comment_action") {
    return prepareCommentAction(state, args);
  }
  if (name === "execute_comment_action") {
    return executeCommentAction(state, args);
  }
  if (name === "prepare_file_operation") {
    return prepareFileOperation(state, args);
  }
  if (name === "execute_file_operation") {
    return executeFileOperation(state, args);
  }
  if (name === "restore_from_snapshot") {
    const text = readSnapshotText(state, args.snapshotPath);
    return replaceFileWithSnapshots(state, args, text, "restore_from_snapshot");
  }

  throw new Error(`unknown tool: ${name}`);
}

async function writeWithSnapshots(state, args, commandType, payload) {
  validateWriteArgs(args);
  const before = await readFileForWrite(state, args);
  const result = await sendCommand(state, args, commandType, { ...args, ...payload });
  const after = addTextHash(await sendCommand(state, args, "read_current_file", args));
  validateExpectedFile(after, args);
  const record = await saveSnapshotPair(state, before, after, commandType, args.reason || summarizePayload(payload));
  return writeResultPayload(before, after, record, result);
}

async function replaceFileWithSnapshots(state, args, text, operation, existingBefore) {
  validateWriteArgs(args);
  const before = existingBefore || await readFileForWrite(state, args);
  const result = await sendCommand(state, args, "replace_file", { ...args, text });
  const after = addTextHash(await sendCommand(state, args, "read_current_file", args));
  validateExpectedFile(after, args);
  const record = await saveSnapshotPair(state, before, after, operation, args.reason || operation);
  return writeResultPayload(before, after, record, result);
}

async function readFile(state, args) {
  if (!args.fileName) throw new Error("read_file requires fileName");
  await sendCommand(state, args, "open_file", args);
  const readArgs = { ...args, expectedFileName: args.expectedFileName || args.fileName };
  const read = rememberRead(state, await sendCommand(state, readArgs, "read_current_file", readArgs));
  validateExpectedFile(read, readArgs);
  return applyReadBudget(state, read, args);
}

async function readFileForWrite(state, args) {
  const before = args.fileName ? await readFile(state, { ...args, contextBudget: "full" }) : rememberRead(state, await sendCommand(state, args, "read_current_file", args));
  validateExpectedFile(before, args);
  if (before.beforeHash && before.beforeHash !== args.beforeHash) {
    throw new Error(`hash mismatch: expected ${args.beforeHash}, got ${before.beforeHash}`);
  }
  return before;
}

async function readFileForSections(state, args) {
  return args.fileName ? readFile(state, { ...args, contextBudget: "full" }) : rememberRead(state, await sendCommand(state, args, "read_current_file", args));
}

async function readFileRange(state, args) {
  const read = await readFileForSections(state, args);
  validateExpectedFile(read, args);
  const range = sliceLineRange(String(read.text || ""), args);
  return {
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    beforeHash: read.beforeHash,
    textLength: read.textLength,
    ...range
  };
}

async function readFileSinceHash(state, args) {
  const read = await readFileForSections(state, args);
  validateExpectedFile(read, args);
  return diffReadSinceHash(state, read, {
    sinceHash: args.sinceHash || args.beforeHash,
    mode: args.mode || "diff",
    maxDiffLines: args.maxDiffLines
  });
}

async function getSections(state, args) {
  const read = await readFileForSections(state, args);
  validateExpectedFile(read, args);
  const sections = parseLatexSections(String(read.text || ""));
  return {
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    beforeHash: read.beforeHash,
    textLength: read.textLength,
    sectionCount: sections.length,
    sections: sections.map(sectionPublicPayload)
  };
}

async function getSectionContent(state, args) {
  const read = await readFileForSections(state, args);
  validateExpectedFile(read, args);
  const sections = parseLatexSections(String(read.text || ""));
  const section = chooseLatexSection(sections, args);
  const includeHeading = Boolean(args.includeHeading);
  const start = includeHeading ? section.startOffset : section.contentStartOffset;
  const text = String(read.text || "").slice(start, section.endOffset);
  return {
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    beforeHash: read.beforeHash,
    textLength: read.textLength,
    section: sectionPublicPayload(section),
    includeHeading,
    text
  };
}

async function replaceSection(state, args) {
  validateWriteArgs(args);
  const before = await readFileForWrite(state, args);
  const beforeText = String(before.text || "");
  const sections = parseLatexSections(beforeText);
  const section = chooseLatexSection(sections, args);
  const preserveHeading = args.preserveHeading !== false;
  const start = preserveHeading ? section.contentStartOffset : section.startOffset;
  const replacement = normalizeReplacementText(String(args.text || ""), beforeText);
  const nextText = beforeText.slice(0, start) + replacement + beforeText.slice(section.endOffset);
  const result = await replaceFileWithSnapshots(state, args, nextText, "replace_section", before);
  return {
    ...result,
    section: sectionPublicPayload(section),
    preserveHeading
  };
}

async function paperContext(state, args) {
  const current = await sendCommand(state, args, "get_current_project", args);
  let files = [];
  try {
    const listed = await sendCommand(state, args, "list_open_project_files", args);
    files = listed.files || [];
  } catch (error) {
    files = [];
  }
  const names = files.map((file) => file.path || file.fileName || "").filter(Boolean);
  let currentFileHash = "";
  let currentSectionCandidates = [];
  try {
    const currentRead = rememberRead(state, await sendCommand(state, args, "read_current_file", args));
    currentFileHash = currentRead.beforeHash;
    currentSectionCandidates = parseLatexSections(String(currentRead.text || "")).slice(0, 30).map((section) => ({
      index: section.index,
      command: section.command,
      title: section.title,
      path: section.path,
      lineStart: section.lineStart,
      lineEnd: section.lineEnd
    }));
  } catch (error) {
    currentFileHash = "";
    currentSectionCandidates = [];
  }
  return {
    projectTitle: current.projectTitle || "",
    currentFile: current.fileName || "",
    currentFileHash,
    fileCount: names.length,
    files,
    mainFileCandidates: names.filter((name) => /(^|\/|\\)(main|paper|manuscript|article)\.tex$/i.test(name)),
    bibFileCandidates: names.filter((name) => /\.bib$/i.test(name)),
    currentSectionCandidates,
    recentCompileStatus: current.visibleStatus || "",
    connectedPages: listClients(state),
    projectAliases: listProjectAliases(state),
    targetLocks: listTargetLocks(state)
  };
}

function setProjectAlias(state, args) {
  const alias = normalizeAliasName(args.alias);
  const projectTitle = cleanOverleafLabel(args.projectTitle);
  if (!alias) throw new Error("set_project_alias requires alias");
  if (!projectTitle) throw new Error("set_project_alias requires projectTitle");
  const now = new Date().toISOString();
  const existing = state.projectAliases.get(alias);
  const record = {
    alias,
    projectTitle,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  state.projectAliases.set(alias, record);
  saveProjectAliases(state);
  return { ok: true, aliasFile: state.aliasFile, alias: record };
}

function clearProjectAlias(state, args) {
  const alias = normalizeAliasName(args.alias);
  if (!alias) throw new Error("clear_project_alias requires alias");
  const removed = state.projectAliases.delete(alias);
  saveProjectAliases(state);
  return { ok: true, aliasFile: state.aliasFile, alias, removed };
}

function lockTargetProject(state, args) {
  const resolved = resolveTarget(state, args || {});
  const client = chooseClient(state, resolved);
  const now = new Date().toISOString();
  const lock = {
    targetLockId: crypto.randomUUID(),
    clientId: client.id,
    projectTitle: cleanOverleafLabel(client.projectTitle || resolved.projectTitle || ""),
    projectAlias: resolved.projectAlias ? normalizeAliasName(resolved.projectAlias) : "",
    fileName: cleanOverleafFileName(client.fileName || ""),
    createdAt: now,
    lastVerifiedAt: now
  };
  if (!lock.projectTitle) throw new Error("cannot lock target without a project title");
  state.targetLocks.set(lock.targetLockId, lock);
  return { ok: true, lock };
}

function unlockTargetProject(state, args) {
  const targetLockId = String(args.targetLockId || "");
  if (!targetLockId) throw new Error("unlock_target_project requires targetLockId");
  const removed = state.targetLocks.delete(targetLockId);
  return { ok: true, targetLockId, removed };
}

async function syncProjectSnapshot(state, args) {
  const listed = await sendCommand(state, args, "list_open_project_files", args);
  const extensions = new Set((args.includeExtensions || [".tex", ".bib", ".sty", ".cls", ".bst"]).map((item) => String(item).toLowerCase()));
  const files = (listed.files || []).filter((file) => extensions.has(path.extname(file.path || file.fileName || "").toLowerCase()));
  const projectTitle = listed.projectTitle || args.projectTitle || "unknown-project";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = projectMirrorDir(state, projectTitle);
  const root = path.join(projectDir, "sync", stamp);
  const saved = [];
  for (const file of files) {
    const fileName = file.path || file.fileName;
    const read = await readFile(state, { ...args, fileName, expectedFileName: file.fileName || path.basename(fileName) });
    const relative = sanitizeRelativePath(fileName);
    const outPath = path.join(root, relative);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const text = String(read.text || "");
    fs.writeFileSync(outPath, text, "utf8");
    const sections = parseLatexSections(text).map(sectionPublicPayload);
    saved.push({
      fileName: read.fileName,
      path: relative,
      hash: read.beforeHash,
      textLength: text.length,
      lineCount: splitTextLines(text).length,
      sectionCount: sections.length,
      sections,
      snapshotPath: outPath
    });
  }
  const manifest = writeMirrorManifest(projectDir, root, {
    projectTitle,
    createdAt: new Date().toISOString(),
    includeExtensions: Array.from(extensions).sort(),
    fileCount: saved.length,
    files: saved.map((file) => ({
      fileName: file.fileName,
      path: file.path,
      hash: file.hash,
      textLength: file.textLength,
      lineCount: file.lineCount,
      sectionCount: file.sectionCount,
      sections: file.sections
    }))
  });
  return { ok: true, projectTitle, root, manifestPath: manifest.manifestPath, latestManifestPath: manifest.latestManifestPath, files: saved };
}

async function previewMirrorDiff(state, args) {
  const manifestInfo = readMirrorManifestForArgs(state, args);
  const manifest = manifestInfo.manifest;
  const listed = await sendCommand(state, args, "list_open_project_files", args);
  const extensions = new Set((args.includeExtensions || manifest.includeExtensions || [".tex", ".bib", ".sty", ".cls", ".bst"]).map((item) => String(item).toLowerCase()));
  const files = (listed.files || []).filter((file) => extensions.has(path.extname(file.path || file.fileName || "").toLowerCase()));
  const currentByPath = new Map();
  const compared = [];
  for (const file of files) {
    const visiblePath = file.path || file.fileName;
    const relative = sanitizeRelativePath(visiblePath);
    const read = await readFile(state, { ...args, fileName: visiblePath, expectedFileName: file.fileName || path.basename(visiblePath), contextBudget: "full" });
    const currentText = String(read.text || "");
    currentByPath.set(relative, { read, text: currentText });
    const mirrored = readMirrorFile(manifestInfo.root, relative);
    if (!mirrored.exists) {
      compared.push({ path: relative, fileName: read.fileName, status: "added", currentHash: read.beforeHash, mirrorHash: "", diff: "", diffLineCount: 0, diffTruncated: false });
      continue;
    }
    const mirrorHash = sha256(mirrored.text);
    if (mirrorHash === read.beforeHash) {
      compared.push({ path: relative, fileName: read.fileName, status: "unchanged", currentHash: read.beforeHash, mirrorHash, diff: "", diffLineCount: 0, diffTruncated: false });
      continue;
    }
    const diff = buildChangedRangeDiff(mirrored.text, currentText, { fileName: relative, maxDiffLines: args.maxDiffLines });
    compared.push({ path: relative, fileName: read.fileName, status: "changed", currentHash: read.beforeHash, mirrorHash, ...diff });
  }
  const manifestPaths = new Set((manifest.files || []).map((file) => sanitizeRelativePath(file.path || file.fileName || "")));
  for (const mirrorPath of manifestPaths) {
    if (!currentByPath.has(mirrorPath)) {
      const mirrored = readMirrorFile(manifestInfo.root, mirrorPath);
      compared.push({ path: mirrorPath, fileName: path.basename(mirrorPath), status: "removed", currentHash: "", mirrorHash: mirrored.exists ? sha256(mirrored.text) : "", diff: "", diffLineCount: 0, diffTruncated: false });
    }
  }
  return {
    ok: true,
    projectTitle: listed.projectTitle || args.projectTitle || manifest.projectTitle || "",
    mirrorRoot: manifestInfo.root,
    manifestPath: manifestInfo.manifestPath,
    comparedFileCount: compared.length,
    changedFileCount: compared.filter((file) => file.status === "changed").length,
    addedFileCount: compared.filter((file) => file.status === "added").length,
    removedFileCount: compared.filter((file) => file.status === "removed").length,
    files: compared
  };
}

async function prepareMirrorSyncPlan(state, args) {
  const direction = String(args.direction || "review_only").toLowerCase();
  if (!["review_only", "overleaf_to_mirror", "mirror_to_overleaf"].includes(direction)) {
    throw new Error("prepare_mirror_sync_plan direction must be review_only, overleaf_to_mirror, or mirror_to_overleaf");
  }

  const diff = await previewMirrorDiff(state, args);
  const changedFiles = (diff.files || []).filter((file) => file.status !== "unchanged");
  const actions = changedFiles.map((file) => mirrorSyncActionForFile(file, direction));
  const blockers = [];

  if (changedFiles.length === 0) {
    blockers.push("mirror and current Overleaf project already match for the compared files");
  }
  if (direction === "mirror_to_overleaf") {
    if (actions.some((action) => action.operation === "create_overleaf_file_from_mirror")) {
      blockers.push("mirror_to_overleaf would create files in Overleaf; use prepare_file_operation plus an explicit file-operation approval instead");
    }
    if (actions.some((action) => action.operation === "delete_overleaf_file")) {
      blockers.push("mirror_to_overleaf would delete visible Overleaf files; use prepare_file_operation plus an explicit file-operation approval instead");
    }
  }

  const syncPlanHash = buildMirrorSyncPlanHash({
    direction,
    projectTitle: diff.projectTitle,
    mirrorRoot: diff.mirrorRoot,
    manifestPath: diff.manifestPath,
    actions
  });
  const confirmationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const confirmationPhrase = buildMirrorSyncConfirmationPhrase(direction, diff.projectTitle, changedFiles.length);
  const readyToExecute = ["overleaf_to_mirror", "mirror_to_overleaf"].includes(direction) && changedFiles.length > 0 && blockers.length === 0;
  const plan = {
    ok: true,
    projectTitle: diff.projectTitle,
    mirrorRoot: diff.mirrorRoot,
    manifestPath: diff.manifestPath,
    direction,
    reason: String(args.reason || "").trim(),
    comparedFileCount: diff.comparedFileCount,
    changedFileCount: diff.changedFileCount,
    addedFileCount: diff.addedFileCount,
    removedFileCount: diff.removedFileCount,
    actionCount: actions.length,
    actions,
    blockers,
    readyForReview: true,
    readyToExecute,
    nonMutating: true,
    supportsAutomaticSync: false,
    supportsLocalMirrorRefresh: direction === "overleaf_to_mirror",
    supportsOverleafWriteBack: direction === "mirror_to_overleaf",
    mirrorToOverleafMode: direction === "mirror_to_overleaf" ? "update_existing_files_only" : "",
    syncPlanHash,
    confirmationToken,
    confirmationPhrase,
    expiresAt,
    nextStep: changedFiles.length === 0
      ? "No sync action is needed for the compared files."
      : readyToExecute
        ? direction === "overleaf_to_mirror"
          ? "After explicit user approval, execute_mirror_sync_plan can create a fresh local mirror snapshot without writing Overleaf."
          : "After explicit user approval, execute_mirror_sync_plan can update existing Overleaf files from the mirror after fresh diff and beforeHash checks."
        : "Review this plan with the user before any future guarded sync executor."
  };

  state.pendingMirrorSyncPlans.set(confirmationToken, {
    ...plan,
    createdAt: new Date().toISOString(),
    target: {
      clientId: args.clientId || "",
      projectTitle: args.projectTitle || "",
      projectAlias: args.projectAlias || "",
      targetLockId: args.targetLockId || ""
    },
    prepareArgs: {
      projectTitle: args.projectTitle || diff.projectTitle,
      projectAlias: args.projectAlias || "",
      targetLockId: args.targetLockId || "",
      clientId: args.clientId || "",
      mirrorRoot: diff.mirrorRoot,
      includeExtensions: Array.isArray(args.includeExtensions) ? args.includeExtensions.map(String) : undefined,
      maxDiffLines: args.maxDiffLines
    }
  });
  return plan;
}

async function executeMirrorSyncPlan(state, args) {
  const token = String(args.confirmationToken || "").trim();
  const plan = token ? state.pendingMirrorSyncPlans.get(token) : null;
  if (!plan) throw new Error("mirror sync confirmation token not found or already used");
  if (Date.parse(plan.expiresAt || "") <= Date.now()) {
    state.pendingMirrorSyncPlans.delete(token);
    throw new Error("mirror sync confirmation token expired");
  }
  if (String(args.confirmationPhrase || "") !== plan.confirmationPhrase) {
    throw new Error("mirror sync confirmation phrase mismatch");
  }
  if (String(args.syncPlanHash || "") !== plan.syncPlanHash) {
    throw new Error("mirror syncPlanHash argument does not match the prepared plan");
  }
  if (!["overleaf_to_mirror", "mirror_to_overleaf"].includes(plan.direction)) {
    throw new Error(`execute_mirror_sync_plan does not support ${plan.direction} plans`);
  }
  if (!plan.readyToExecute) {
    throw new Error(`mirror sync plan is not ready: ${(plan.blockers || []).join("; ")}`);
  }
  if (!projectTitlesCompatible(args.projectTitle || "", plan.projectTitle || "")) {
    throw new Error(`mirror sync project mismatch: prepared ${plan.projectTitle}, got ${args.projectTitle}`);
  }

  const prepareArgs = {
    ...(plan.prepareArgs || {}),
    ...args,
    mirrorRoot: plan.mirrorRoot,
    includeExtensions: plan.prepareArgs ? plan.prepareArgs.includeExtensions : undefined,
    maxDiffLines: plan.prepareArgs ? plan.prepareArgs.maxDiffLines : undefined
  };
  const freshDiff = await previewMirrorDiff(state, prepareArgs);
  const freshActions = (freshDiff.files || [])
    .filter((file) => file.status !== "unchanged")
    .map((file) => mirrorSyncActionForFile(file, plan.direction));
  const freshPlanHash = buildMirrorSyncPlanHash({
    direction: plan.direction,
    projectTitle: freshDiff.projectTitle,
    mirrorRoot: freshDiff.mirrorRoot,
    manifestPath: freshDiff.manifestPath,
    actions: freshActions
  });
  if (freshPlanHash !== plan.syncPlanHash) {
    throw new Error("mirror diff changed after prepare_mirror_sync_plan; prepare a fresh mirror sync plan");
  }
  if (freshActions.length === 0) {
    state.pendingMirrorSyncPlans.delete(token);
    return {
      ok: true,
      action: plan.direction,
      projectTitle: freshDiff.projectTitle || plan.projectTitle,
      noChanges: true,
      oldMirrorRoot: plan.mirrorRoot,
      syncPlanHash: plan.syncPlanHash,
      confirmationToken: token,
      nonMutatingOverleaf: plan.direction === "overleaf_to_mirror",
      mutatingOverleaf: false,
      reason: String(args.reason || "").trim()
    };
  }

  if (plan.direction === "mirror_to_overleaf") {
    const unsupported = freshActions.filter((action) => action.operation !== "update_overleaf_file_from_mirror");
    if (unsupported.length > 0) {
      throw new Error(`mirror_to_overleaf can only update existing Overleaf files; unsupported operations: ${unsupported.map((action) => `${action.path}:${action.operation}`).join(", ")}`);
    }
    const writtenFiles = [];
    for (const action of freshActions) {
      const mirrored = readMirrorFile(plan.mirrorRoot, action.path);
      if (!mirrored.exists) {
        throw new Error(`mirror file missing for ${action.path}`);
      }
      const expectedFileName = path.basename(action.path);
      const write = await replaceFileWithSnapshots(state, {
        ...args,
        fileName: action.path,
        expectedFileName,
        beforeHash: action.currentHash,
        reason: String(args.reason || "").trim() || `mirror_to_overleaf update ${action.path}`
      }, mirrored.text, "execute_mirror_sync_plan");
      if (write.afterHash !== action.mirrorHash) {
        throw new Error(`mirror_to_overleaf post-write hash mismatch for ${action.path}: expected ${action.mirrorHash}, got ${write.afterHash}`);
      }
      writtenFiles.push({
        path: action.path,
        fileName: write.fileName || expectedFileName,
        beforeHash: write.beforeHash,
        afterHash: write.afterHash,
        mirrorHash: action.mirrorHash,
        snapshotPath: write.snapshotPath,
        afterPath: write.afterPath,
        diffPath: write.diffPath
      });
    }
    state.pendingMirrorSyncPlans.delete(token);
    return {
      ok: true,
      action: "mirror_to_overleaf",
      projectTitle: freshDiff.projectTitle || plan.projectTitle,
      mirrorRoot: plan.mirrorRoot,
      manifestPath: plan.manifestPath,
      plannedActionCount: plan.actionCount,
      updatedFileCount: writtenFiles.length,
      writtenFiles,
      syncPlanHash: plan.syncPlanHash,
      confirmationToken: token,
      nonMutatingOverleaf: false,
      mutatingOverleaf: true,
      mirrorWritten: false,
      mode: "update_existing_files_only",
      reason: String(args.reason || "").trim()
    };
  }

  const synced = await syncProjectSnapshot(state, {
    ...args,
    includeExtensions: plan.prepareArgs ? plan.prepareArgs.includeExtensions : undefined
  });
  state.pendingMirrorSyncPlans.delete(token);
  return {
    ok: true,
    action: "overleaf_to_mirror",
    projectTitle: synced.projectTitle || freshDiff.projectTitle || plan.projectTitle,
    oldMirrorRoot: plan.mirrorRoot,
    newMirrorRoot: synced.root,
    oldManifestPath: plan.manifestPath,
    newManifestPath: synced.manifestPath,
    latestManifestPath: synced.latestManifestPath,
    fileCount: Array.isArray(synced.files) ? synced.files.length : 0,
    plannedActionCount: plan.actionCount,
    syncPlanHash: plan.syncPlanHash,
    confirmationToken: token,
    nonMutatingOverleaf: true,
    mirrorWritten: true,
    reason: String(args.reason || "").trim()
  };
}

function buildMirrorSyncPlanHash(plan) {
  return sha256(JSON.stringify({
    direction: plan.direction,
    projectTitle: plan.projectTitle,
    mirrorRoot: plan.mirrorRoot,
    manifestPath: plan.manifestPath,
    actions: (plan.actions || []).map((action) => ({
      path: action.path,
      operation: action.operation,
      status: action.status,
      currentHash: action.currentHash,
      mirrorHash: action.mirrorHash
    }))
  }));
}

function mirrorSyncActionForFile(file, direction) {
  const status = String(file.status || "");
  const base = {
    path: sanitizeRelativePath(file.path || file.fileName || ""),
    fileName: file.fileName || path.basename(file.path || ""),
    status,
    currentHash: file.currentHash || "",
    mirrorHash: file.mirrorHash || "",
    diffLineCount: Number(file.diffLineCount || 0),
    diffTruncated: Boolean(file.diffTruncated)
  };
  if (direction === "overleaf_to_mirror") {
    const operation = status === "removed"
      ? "remove_mirror_file"
      : status === "added"
        ? "add_mirror_file_from_overleaf"
        : "update_mirror_file_from_overleaf";
    return { ...base, operation, source: "overleaf", target: "mirror", requiresUserApproval: true };
  }
  if (direction === "mirror_to_overleaf") {
    const operation = status === "removed"
      ? "create_overleaf_file_from_mirror"
      : status === "added"
        ? "delete_overleaf_file"
        : "update_overleaf_file_from_mirror";
    return { ...base, operation, source: "mirror", target: "overleaf", requiresUserApproval: true, requiresFreshHashCheck: true };
  }
  return { ...base, operation: "review_difference", source: "overleaf_and_mirror", target: "human_review", requiresUserApproval: false };
}

function findInProjectMirror(state, args) {
  const manifestInfo = readMirrorManifestForArgs(state, args);
  const manifest = manifestInfo.manifest;
  const maxMatches = clampNumber(args.maxMatches, 1, 100, 20);
  const maxChars = clampNumber(args.maxChars, 0, 8000, 800);
  const candidateFiles = (manifest.files || []).filter((file) => {
    if (!args.fileName) return true;
    const needle = String(args.fileName).toLowerCase();
    const relative = String(file.path || file.fileName || "").toLowerCase();
    return relative === needle || relative.endsWith(`/${needle}`) || String(file.fileName || "").toLowerCase() === needle;
  });
  const matches = [];
  for (const file of candidateFiles) {
    if (matches.length >= maxMatches) break;
    const relative = sanitizeRelativePath(file.path || file.fileName || "");
    const mirrored = readMirrorFile(manifestInfo.root, relative);
    if (!mirrored.exists) continue;
    const text = mirrored.text;
    const sections = parseLatexSections(text);
    const hasSectionSelector = args.title || args.path || args.sectionIndex || args.level;
    if (hasSectionSelector) {
      try {
        const section = chooseLatexSection(sections, args);
        const sectionText = text.slice(section.contentStartOffset, section.endOffset);
        matches.push({
          type: "section",
          path: relative,
          fileName: file.fileName || path.basename(relative),
          hash: sha256(text),
          section: sectionPublicPayload(section),
          textLength: sectionText.length,
          preview: sectionText.slice(0, maxChars),
          previewTruncated: maxChars > 0 && sectionText.length > maxChars
        });
      } catch (error) {
        // Keep searching other files when a section selector is not present in this file.
      }
      continue;
    }
    if (args.query) {
      const query = String(args.query);
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();
      let index = lowerText.indexOf(lowerQuery);
      while (index >= 0 && matches.length < maxMatches) {
        const start = Math.max(0, index - Math.floor(maxChars / 2));
        const end = maxChars > 0 ? Math.min(text.length, start + maxChars) : index;
        matches.push({
          type: "text",
          path: relative,
          fileName: file.fileName || path.basename(relative),
          hash: sha256(text),
          line: lineNumberAt(text, index),
          matchOffset: index,
          preview: maxChars > 0 ? text.slice(start, end) : "",
          previewTruncated: maxChars > 0 && (start > 0 || end < text.length)
        });
        index = lowerText.indexOf(lowerQuery, index + Math.max(1, lowerQuery.length));
      }
      continue;
    }
    matches.push({
      type: "file",
      path: relative,
      fileName: file.fileName || path.basename(relative),
      hash: sha256(text),
      textLength: text.length,
      lineCount: splitTextLines(text).length,
      sectionCount: sections.length
    });
  }
  return {
    ok: true,
    projectTitle: manifest.projectTitle || args.projectTitle || "",
    mirrorRoot: manifestInfo.root,
    manifestPath: manifestInfo.manifestPath,
    matchCount: matches.length,
    matches
  };
}

async function exportCurrentFile(state, args) {
  const read = args.fileName ? await readFile(state, { ...args, contextBudget: "full" }) : rememberRead(state, await sendCommand(state, args, "read_current_file", args));
  validateExpectedFile(read, args);
  const projectTitle = read.projectTitle || args.projectTitle || "unknown-project";
  const relative = sanitizeRelativePath(args.fileName || read.fileName || "current.tex");
  const exported = writeProjectExport(state, projectTitle, relative, String(read.text || ""), {
    kind: "source-file",
    fileName: read.fileName || path.basename(relative),
    hash: read.beforeHash,
    textLength: read.textLength,
    lineCount: splitTextLines(String(read.text || "")).length
  });
  return {
    ok: true,
    projectTitle,
    fileName: read.fileName || path.basename(relative),
    beforeHash: read.beforeHash,
    textLength: read.textLength,
    exportPath: exported.exportPath,
    manifestPath: exported.manifestPath
  };
}

async function exportCompileLog(state, args) {
  const result = await sendCommand(state, args, "compile_project", args, state.compileCommandTimeoutMs);
  const compileSummary = summarizeCompileLog(result);
  const projectTitle = result.projectTitle || args.projectTitle || "unknown-project";
  const text = [
    `Project: ${projectTitle}`,
    `File: ${result.fileName || ""}`,
    `Status: ${compileSummary.statusText || ""}`,
    "",
    compileSummary.logSnippet || ""
  ].join("\n");
  const exported = writeProjectExport(state, projectTitle, "compile.log", text, {
    kind: "compile-log",
    fileName: result.fileName || "",
    visibleStatus: result.visibleStatus || "",
    compileSummary,
    hash: sha256(text),
    textLength: text.length,
    lineCount: splitTextLines(text).length
  });
  return {
    ok: true,
    projectTitle,
    fileName: result.fileName || "",
    compileSummary,
    exportPath: exported.exportPath,
    manifestPath: exported.manifestPath
  };
}

async function exportArtifactInventory(state, args) {
  const result = await listVisibleArtifacts(state, args);
  const projectTitle = result.projectTitle || args.projectTitle || "unknown-project";
  const inventory = {
    kind: "artifact-inventory",
    projectTitle,
    fileName: result.fileName || "",
    createdAt: new Date().toISOString(),
    reloadRequired: Boolean(result.reloadRequired),
    reason: result.reason || "",
    contentScriptVersion: result.contentScriptVersion || "",
    artifactCount: Array.isArray(result.artifacts) ? result.artifacts.length : 0,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : []
  };
  const text = JSON.stringify(inventory, null, 2) + "\n";
  const exported = writeProjectExport(state, projectTitle, "artifact-inventory.json", text, {
    kind: "artifact-inventory",
    fileName: result.fileName || "",
    artifactCount: inventory.artifactCount,
    reloadRequired: inventory.reloadRequired,
    reason: inventory.reason,
    contentScriptVersion: inventory.contentScriptVersion,
    hash: sha256(text),
    textLength: text.length,
    lineCount: splitTextLines(text).length
  });
  return {
    ok: true,
    projectTitle,
    fileName: result.fileName || "",
    artifactCount: inventory.artifactCount,
    artifacts: inventory.artifacts,
    reloadRequired: inventory.reloadRequired,
    reason: inventory.reason,
    contentScriptVersion: inventory.contentScriptVersion,
    exportPath: exported.exportPath,
    manifestPath: exported.manifestPath
  };
}

async function exportVisibleArtifact(state, args) {
  const maxBytes = clampArtifactMaxBytes(args.maxBytes);
  const result = await exportVisibleArtifactFromBrowser(state, { ...args, maxBytes });
  if (result.reloadRequired) return result;
  if (!result.ok) {
    return {
      ok: false,
      projectTitle: result.projectTitle || args.projectTitle || "",
      reason: result.reason || "visible artifact export did not complete"
    };
  }
  if (!result.base64 || typeof result.base64 !== "string") {
    throw new Error("export_visible_artifact did not return artifact bytes");
  }
  const bytes = Buffer.from(result.base64, "base64");
  if (bytes.length > maxBytes) {
    throw new Error(`artifact exceeded maxBytes after transfer: ${bytes.length} > ${maxBytes}`);
  }
  const projectTitle = result.projectTitle || args.projectTitle || "unknown-project";
  const fileName = sanitizeArtifactExportName(args.outputFileName || result.fileName || `${result.type || "artifact"}.bin`, result.type || "download");
  const hash = sha256(bytes);
  const redactedUrl = scrubArtifactUrl(result.url || "");
  const exported = writeProjectBinaryExport(state, projectTitle, `artifacts/${fileName}`, bytes, {
    kind: "visible-artifact",
    artifactType: result.type || "download",
    fileName,
    label: String(result.label || "").slice(0, 160),
    source: result.source || "",
    selectedIndex: Number.isFinite(result.selectedIndex) ? result.selectedIndex : null,
    redactedUrl,
    mimeType: result.mimeType || "",
    byteLength: bytes.length,
    hash,
    maxBytes
  });
  return {
    ok: true,
    projectTitle,
    artifactType: result.type || "download",
    fileName,
    label: String(result.label || "").slice(0, 160),
    source: result.source || "",
    selectedIndex: Number.isFinite(result.selectedIndex) ? result.selectedIndex : null,
    redactedUrl,
    mimeType: result.mimeType || "",
    byteLength: bytes.length,
    hash,
    exportPath: exported.exportPath,
    manifestPath: exported.manifestPath
  };
}

async function listVisibleArtifacts(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return await sendCommand(state, args, "list_visible_artifacts", args);
  } catch (error) {
    if (!/unknown command:\s*list_visible_artifacts/i.test(String(error && error.message ? error.message : error))) {
      throw error;
    }
    return {
      ok: true,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      artifactCount: 0,
      artifacts: [],
      reloadRequired: true,
      reason: "connected Overleaf content script does not support list_visible_artifacts yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
    };
  }
}

async function exportVisibleArtifactFromBrowser(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return await sendCommand(state, args, "export_visible_artifact", args);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/no downloadable visible artifact candidate matched/i.test(message)) {
      return {
        ok: false,
        projectTitle: client.projectTitle || args.projectTitle || "",
        fileName: client.fileName || "",
        editorMode: client.editorMode || "",
        pageUrl: scrubProjectUrl(client.pageUrl || ""),
        contentScriptVersion: client.contentScriptVersion || "",
        reason: "no visible downloadable artifact candidate matched the selector"
      };
    }
    if (!/unknown command:\s*export_visible_artifact/i.test(message)) {
      throw error;
    }
    return {
      ok: false,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      reloadRequired: true,
      reason: "connected Overleaf content script does not support export_visible_artifact yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
    };
  }
}

async function inspectFileOperationUi(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return normalizeFileOperationUiInspection(await sendCommand(state, args, "inspect_file_operation_ui", args), client, args);
  } catch (error) {
    if (!/unknown command:\s*inspect_file_operation_ui/i.test(String(error && error.message ? error.message : error))) {
      throw error;
    }
    return {
      ok: true,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      fileOperationUiSchemaVersion: 0,
      capabilities: {},
      controlCount: 0,
      visibleFolderCount: 0,
      visibleFolders: [],
      controls: [],
      reloadRequired: true,
      reason: "connected Overleaf content script does not support inspect_file_operation_ui yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
    };
  }
}

function normalizeFileOperationUiInspection(ui, client, args) {
  const result = ui && typeof ui === "object" ? { ...ui } : {};
  const controls = Array.isArray(result.controls) ? result.controls : [];
  const hasSchemaMarker = Number(result.fileOperationUiSchemaVersion || 0) >= 11;
  const hasVisibleFolders = Array.isArray(result.visibleFolders);
  const hasControlScores = controls.every((control) => control && typeof control.score === "number");
  const hasCapabilities = result.capabilities && result.capabilities.rankedOperationControls === true && result.capabilities.visibleFolders === true;
  const stale = !hasSchemaMarker || !hasVisibleFolders || !hasControlScores || !hasCapabilities;
  if (!stale) {
    return {
      ...result,
      reloadRequired: Boolean(result.reloadRequired),
      reason: result.reason || ""
    };
  }
  return {
    ...result,
    projectTitle: result.projectTitle || (client && client.projectTitle) || args.projectTitle || "",
    fileName: result.fileName || (client && client.fileName) || "",
    editorMode: result.editorMode || (client && client.editorMode) || "",
    pageUrl: scrubProjectUrl(result.pageUrl || (client && client.pageUrl) || ""),
    contentScriptVersion: result.contentScriptVersion || (client && client.contentScriptVersion) || "",
    fileOperationUiSchemaVersion: Number(result.fileOperationUiSchemaVersion || 0),
    capabilities: result.capabilities || {},
    visibleFolderCount: Array.isArray(result.visibleFolders) ? result.visibleFolders.length : 0,
    visibleFolders: Array.isArray(result.visibleFolders) ? result.visibleFolders : [],
    controls,
    reloadRequired: true,
    staleSchema: true,
    reason: "connected Overleaf content script returned stale file-operation UI schema; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
  };
}

async function inspectUploadWorkflow(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return await sendCommand(state, args, "inspect_upload_workflow", args);
  } catch (error) {
    if (!/unknown command:\s*inspect_upload_workflow/i.test(String(error && error.message ? error.message : error))) {
      throw error;
    }
    return {
      ok: true,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      uploadControlCount: 0,
      uploadControls: [],
      dropzoneCount: 0,
      dropzones: [],
      acceptValues: [],
      imageCandidateCount: 0,
      imageCandidates: [],
      supportedLocalSelection: false,
      requiresUserFilePicker: true,
      nonMutating: true,
      reloadRequired: true,
      reason: "connected Overleaf content script does not support inspect_upload_workflow yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab",
      blockers: [
        "connected Overleaf content script does not support inspect_upload_workflow yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
      ],
      recommendations: []
    };
  }
}

async function inspectDownloadWorkflow(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return await sendCommand(state, args, "inspect_download_workflow", args);
  } catch (error) {
    if (!/unknown command:\s*inspect_download_workflow/i.test(String(error && error.message ? error.message : error))) {
      throw error;
    }
    return {
      ok: true,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      downloadControlCount: 0,
      downloadControls: [],
      downloadCandidateCount: 0,
      downloadCandidates: [],
      supportedDirectDownload: false,
      requiresUserConfirmation: true,
      nonMutating: true,
      reloadRequired: true,
      reason: "connected Overleaf content script does not support inspect_download_workflow yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab",
      blockers: [
        "connected Overleaf content script does not support inspect_download_workflow yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
      ],
      recommendations: []
    };
  }
}

async function inspectVisibleComments(state, args) {
  const client = selectClientForDiagnostic(state, args);
  try {
    return await sendCommand(state, args, "inspect_visible_comments", args);
  } catch (error) {
    if (!/unknown command:\s*inspect_visible_comments/i.test(String(error && error.message ? error.message : error))) {
      throw error;
    }
    return {
      ok: true,
      projectTitle: client.projectTitle || args.projectTitle || "",
      fileName: client.fileName || "",
      editorMode: client.editorMode || "",
      pageUrl: scrubProjectUrl(client.pageUrl || ""),
      contentScriptVersion: client.contentScriptVersion || "",
      threadCount: 0,
      threads: [],
      actionControlCount: 0,
      actionControls: [],
      nonMutating: true,
      supportsWriteActions: false,
      requiresUserConfirmation: true,
      reloadRequired: true,
      reason: "connected Overleaf content script does not support inspect_visible_comments yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab",
      blockers: [
        "connected Overleaf content script does not support inspect_visible_comments yet; reload the unpacked Chrome extension from this repository and refresh the Overleaf tab"
      ],
      recommendations: []
    };
  }
}

async function prepareCommentAction(state, args) {
  const action = normalizeCommentAction(args.action);
  if (!action) {
    throw new Error("prepare_comment_action requires action reply, resolve, reopen, or delete-comment");
  }
  if (!String(args.reason || "").trim()) {
    throw new Error("prepare_comment_action requires reason");
  }

  const inspected = await inspectVisibleComments(state, args);
  const threads = normalizeVisibleCommentThreads(inspected.threads || []);
  const selected = chooseVisibleCommentThread(threads, args);
  const blockers = [];

  if (inspected.reloadRequired) {
    blockers.push(inspected.reason || "reload the unpacked Chrome extension and refresh the Overleaf tab");
  }
  if (threads.length === 0) {
    blockers.push("no visible comment or review-thread was detected");
  }
  if (!selected) {
    blockers.push("no visible comment thread matched the selector; pass threadIndex, previewContains, or lineNumber from inspect_visible_comments");
  }
  if (selected && selected.resolved && action === "resolve") {
    blockers.push("selected comment thread already appears resolved");
  }
  if (selected && !selected.resolved && action === "reopen") {
    blockers.push("selected comment thread does not appear resolved");
  }

  const selectedActions = selected ? new Set((selected.actions || []).map((item) => item.action).filter(Boolean)) : new Set();
  if (selected && !selectedActions.has(action)) {
    blockers.push(`no visible ${action} control was detected for the selected comment thread`);
  }

  const threadListHash = hashVisibleCommentThreads(threads);
  const confirmationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const selectedThreadSignature = selected ? selected.signature : "";
  const confirmationPhrase = buildCommentActionConfirmationPhrase(action, selected || null);
  const readyToExecute = blockers.length === 0;
  const plan = {
    action,
    projectTitle: inspected.projectTitle || args.projectTitle || "unknown-project",
    fileName: inspected.fileName || "",
    reason: String(args.reason || "").trim(),
    readyToExecute,
    blockers,
    confirmationToken,
    confirmationPhrase,
    expiresAt,
    threadListHash,
    visibleThreadCount: threads.length,
    selectedThread: selected ? {
      threadIndex: selected.threadIndex,
      label: selected.label,
      preview: selected.preview,
      lineNumber: selected.lineNumber,
      resolved: selected.resolved,
      actionTypes: (selected.actions || []).map((item) => item.action).filter(Boolean),
      signature: selected.signature
    } : null,
    ui: {
      reloadRequired: Boolean(inspected.reloadRequired),
      reason: inspected.reason || "",
      contentScriptVersion: inspected.contentScriptVersion || "",
      threadCount: Number(inspected.threadCount || threads.length || 0),
      actionControlCount: Number(inspected.actionControlCount || 0)
    },
    nonMutating: true,
    supportsWriteActions: false,
    nextStep: readyToExecute
      ? "A future comment execution tool must receive this token, the exact confirmationPhrase, and a fresh threadListHash check before mutating Overleaf comments."
      : "Resolve blockers before attempting any mutating comment action."
  };
  state.pendingCommentActions.set(confirmationToken, {
    ...plan,
    createdAt: new Date().toISOString(),
    target: {
      clientId: args.clientId || "",
      projectTitle: args.projectTitle || "",
      projectAlias: args.projectAlias || "",
      targetLockId: args.targetLockId || ""
    }
  });
  return { ok: true, ...plan };
}

async function executeCommentAction(state, args) {
  const token = String(args.confirmationToken || "").trim();
  const plan = token ? state.pendingCommentActions.get(token) : null;
  if (!plan) throw new Error("comment action confirmation token not found or already used");
  if (Date.parse(plan.expiresAt || "") <= Date.now()) {
    state.pendingCommentActions.delete(token);
    throw new Error("comment action confirmation token expired");
  }
  if (String(args.confirmationPhrase || "") !== plan.confirmationPhrase) {
    throw new Error("comment action confirmation phrase mismatch");
  }
  if (String(args.threadListHash || "") !== plan.threadListHash) {
    throw new Error("comment action threadListHash argument does not match the prepared plan");
  }
  if (!plan.readyToExecute) {
    throw new Error(`comment action plan is not ready: ${(plan.blockers || []).join("; ")}`);
  }
  if (!projectTitlesCompatible(args.projectTitle || "", plan.projectTitle || "")) {
    throw new Error(`comment action project mismatch: prepared ${plan.projectTitle}, got ${args.projectTitle}`);
  }
  const replyText = String(args.replyText || "");
  if (plan.action === "reply" && !replyText.trim()) {
    throw new Error("execute_comment_action reply requires replyText");
  }

  const freshInspected = await inspectVisibleComments(state, args);
  const freshThreads = normalizeVisibleCommentThreads(freshInspected.threads || []);
  const freshThreadListHash = hashVisibleCommentThreads(freshThreads);
  if (freshThreadListHash !== plan.threadListHash) {
    throw new Error("visible comment thread list changed after prepare_comment_action; prepare a fresh comment action plan");
  }
  const selectedThread = findMatchingCommentThread(plan.selectedThread, freshThreads);
  if (!selectedThread) {
    throw new Error("selected comment thread is no longer visible; prepare a fresh comment action plan");
  }

  const result = await sendCommand(state, args, "execute_comment_action", {
    ...args,
    action: plan.action,
    threadIndex: selectedThread.threadIndex,
    selectedThreadSignature: selectedThread.signature,
    replyText,
    confirmationToken: token
  });
  const afterInspected = await inspectVisibleComments(state, args);
  const afterThreads = normalizeVisibleCommentThreads(afterInspected.threads || []);
  const verification = verifyCommentActionResult(plan.action, plan.selectedThread, afterThreads, result);
  if (!verification.ok) throw new Error(verification.error);
  state.pendingCommentActions.delete(token);
  return {
    ok: true,
    projectTitle: result.projectTitle || afterInspected.projectTitle || plan.projectTitle,
    fileName: result.fileName || afterInspected.fileName || plan.fileName || "",
    action: plan.action,
    confirmationToken: token,
    threadListHashBefore: plan.threadListHash,
    threadListHashAfter: hashVisibleCommentThreads(afterThreads),
    visibleThreadCountBefore: plan.visibleThreadCount,
    visibleThreadCountAfter: afterThreads.length,
    selectedThread: plan.selectedThread,
    replyTextLength: plan.action === "reply" ? replyText.length : 0,
    result: sanitizeCommentExecutionResult(result),
    verification,
    reason: String(args.reason || "").trim()
  };
}

async function prepareFileOperation(state, args) {
  const operation = String(args.operation || "").toLowerCase();
  if (!["create", "rename", "delete"].includes(operation)) {
    throw new Error("prepare_file_operation requires operation create, rename, or delete");
  }
  if (!String(args.reason || "").trim()) {
    throw new Error("prepare_file_operation requires reason");
  }
  const fileName = normalizeFileOperationPath(args.fileName);
  const newFileName = operation === "rename" ? normalizeFileOperationPath(args.newFileName) : "";
  if (!fileName) throw new Error("prepare_file_operation requires fileName");
  if (operation === "rename" && !newFileName) throw new Error("prepare_file_operation rename requires newFileName");

  const listed = await sendCommand(state, args, "list_open_project_files", args);
  const ui = await inspectFileOperationUi(state, args);
  const projectTitle = listed.projectTitle || ui.projectTitle || args.projectTitle || "unknown-project";
  const files = normalizeListedFiles(listed.files || []);
  const fileSet = new Set(files.map((file) => file.key));
  const targetKey = normalizeFileKey(fileName);
  const newKey = normalizeFileKey(newFileName);
  const blockers = [];

  if (operation === "create" && fileSet.has(targetKey)) {
    blockers.push(`target file already exists: ${fileName}`);
  }
  if ((operation === "rename" || operation === "delete") && !fileSet.has(targetKey)) {
    blockers.push(`source file is not visible in the current Overleaf file tree: ${fileName}`);
  }
  if (operation === "rename" && fileSet.has(newKey)) {
    blockers.push(`destination file already exists: ${newFileName}`);
  }
  if (ui.reloadRequired) {
    blockers.push(ui.reason || "reload the unpacked Chrome extension and refresh the Overleaf tab");
  }
  if (!ui.reloadRequired && operation === "create") {
    const parentPath = parentFolderPathForFileOperation(fileName);
    if (parentPath) {
      const visibleFolderSet = new Set(normalizeVisibleFolders(ui.visibleFolders || []).map((folder) => folder.key));
      if (!visibleFolderSet.has(normalizeFileKey(parentPath))) {
        blockers.push(`parent folder is not visible in the current Overleaf file tree: ${parentPath}`);
      }
    }
  }

  const controls = Array.isArray(ui.controls) ? ui.controls : [];
  const activeControls = controls.filter((control) => control && control.visible && !control.disabled);
  const hasOperationControl = activeControls.some((control) => control.operation === operation || control.operation === "file-menu");
  if (!ui.reloadRequired && !hasOperationControl) {
    blockers.push(`no visible enabled ${operation} or file-menu control was detected`);
  }

  const fileListHash = hashFileList(files);
  const confirmationToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const confirmationPhrase = buildFileOperationConfirmationPhrase(operation, fileName, newFileName);
  const readyToExecute = blockers.length === 0;
  const plan = {
    operation,
    projectTitle,
    fileName,
    newFileName,
    reason: String(args.reason || "").trim(),
    readyToExecute,
    blockers,
    confirmationToken,
    confirmationPhrase,
    expiresAt,
    fileListHash,
    visibleFileCount: files.length,
    selectedFile: listed.fileName || ui.fileName || "",
    ui: {
      reloadRequired: Boolean(ui.reloadRequired),
      reason: ui.reason || "",
      contentScriptVersion: ui.contentScriptVersion || "",
      fileOperationUiSchemaVersion: Number(ui.fileOperationUiSchemaVersion || 0),
      staleSchema: Boolean(ui.staleSchema),
      controlCount: controls.length,
      visibleFolderCount: Array.isArray(ui.visibleFolders) ? ui.visibleFolders.length : 0,
      operationTypes: Array.from(new Set(controls.map((control) => control.operation).filter(Boolean))).sort()
    },
    nonMutating: true,
    nextStep: readyToExecute
      ? "A future execution tool must receive this token, the exact confirmationPhrase, and a fresh fileListHash check before mutating Overleaf."
      : "Resolve blockers before attempting any mutating file operation."
  };
  state.pendingFileOperations.set(confirmationToken, {
    ...plan,
    createdAt: new Date().toISOString(),
    target: {
      clientId: args.clientId || "",
      projectTitle: args.projectTitle || "",
      projectAlias: args.projectAlias || "",
      targetLockId: args.targetLockId || ""
    }
  });
  return { ok: true, ...plan };
}

async function executeFileOperation(state, args) {
  const token = String(args.confirmationToken || "").trim();
  const plan = token ? state.pendingFileOperations.get(token) : null;
  if (!plan) throw new Error("file operation confirmation token not found or already used");
  if (Date.parse(plan.expiresAt || "") <= Date.now()) {
    state.pendingFileOperations.delete(token);
    throw new Error("file operation confirmation token expired");
  }
  if (String(args.confirmationPhrase || "") !== plan.confirmationPhrase) {
    throw new Error("file operation confirmation phrase mismatch");
  }
  if (String(args.fileListHash || "") !== plan.fileListHash) {
    throw new Error("file operation fileListHash argument does not match the prepared plan");
  }
  if (!plan.readyToExecute) {
    throw new Error(`file operation plan is not ready: ${(plan.blockers || []).join("; ")}`);
  }
  if (!projectTitlesCompatible(args.projectTitle || "", plan.projectTitle || "")) {
    throw new Error(`file operation project mismatch: prepared ${plan.projectTitle}, got ${args.projectTitle}`);
  }

  const freshListed = await sendCommand(state, args, "list_open_project_files", args);
  const freshFiles = normalizeListedFiles(freshListed.files || []);
  const freshFileListHash = hashFileList(freshFiles);
  if (freshFileListHash !== plan.fileListHash) {
    throw new Error("visible file tree changed after prepare_file_operation; prepare a fresh file operation plan");
  }

  const result = await sendCommand(state, args, "execute_file_operation", {
    ...args,
    operation: plan.operation,
    fileName: plan.fileName,
    newFileName: plan.newFileName,
    confirmationToken: token
  });
  const afterListed = await sendCommand(state, args, "list_open_project_files", args);
  const afterFiles = normalizeListedFiles(afterListed.files || []);
  const afterKeys = new Set(afterFiles.map((file) => file.key));
  const targetKey = normalizeFileKey(plan.fileName);
  const newKey = normalizeFileKey(plan.newFileName);
  const verification = verifyFileOperationResult(plan.operation, targetKey, newKey, afterKeys);
  if (!verification.ok) throw new Error(verification.error);
  state.pendingFileOperations.delete(token);
  return {
    ok: true,
    projectTitle: result.projectTitle || afterListed.projectTitle || plan.projectTitle,
    operation: plan.operation,
    fileName: plan.fileName,
    newFileName: plan.newFileName,
    confirmationToken: token,
    fileListHashBefore: plan.fileListHash,
    fileListHashAfter: hashFileList(afterFiles),
    visibleFileCountBefore: plan.visibleFileCount,
    visibleFileCountAfter: afterFiles.length,
    result,
    verification,
    reason: String(args.reason || "").trim()
  };
}

function hashFileList(files) {
  return sha256(JSON.stringify((files || []).map((file) => file.path).sort()));
}

function verifyFileOperationResult(operation, targetKey, newKey, afterKeys) {
  if (operation === "create") {
    if (!afterKeys.has(targetKey)) return { ok: false, error: "file operation create did not produce the target file" };
    return { ok: true, status: "created" };
  }
  if (operation === "rename") {
    if (afterKeys.has(targetKey)) return { ok: false, error: "file operation rename left the original file visible" };
    if (!afterKeys.has(newKey)) return { ok: false, error: "file operation rename did not produce the destination file" };
    return { ok: true, status: "renamed" };
  }
  if (operation === "delete") {
    if (afterKeys.has(targetKey)) return { ok: false, error: "file operation delete left the target file visible" };
    return { ok: true, status: "deleted" };
  }
  return { ok: false, error: `unsupported file operation verification: ${operation}` };
}

function normalizeListedFiles(files) {
  const seen = new Set();
  const normalized = [];
  for (const file of files || []) {
    const raw = String((file && (file.path || file.fileName)) || "").trim();
    const pathName = normalizeFileOperationPath(raw);
    if (!pathName) continue;
    const key = normalizeFileKey(pathName);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      path: pathName,
      fileName: String(file.fileName || path.basename(pathName)).trim(),
      selected: Boolean(file.selected),
      depth: Number(file.depth || 1),
      key
    });
  }
  return normalized;
}

function normalizeVisibleFolders(folders) {
  const seen = new Set();
  const normalized = [];
  for (const folder of folders || []) {
    const raw = String((folder && (folder.path || folder.folderName || folder.fileName)) || "").trim();
    const folderPath = normalizeFileOperationPath(raw);
    if (!folderPath) continue;
    const key = normalizeFileKey(folderPath);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      path: folderPath,
      folderName: String(folder.folderName || folder.fileName || path.basename(folderPath)).trim(),
      selected: Boolean(folder.selected),
      depth: Number(folder.depth || 1),
      expanded: Boolean(folder.expanded),
      key
    });
  }
  return normalized;
}

function parentFolderPathForFileOperation(fileName) {
  const normalized = normalizeFileOperationPath(fileName);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function normalizeFileOperationPath(value) {
  const text = String(value || "").replace(/\\/g, "/").trim();
  if (!text || /^[a-z]+:\/\//i.test(text) || /^[a-z]:\//i.test(text) || text.startsWith("/")) return "";
  return sanitizeRelativePath(text).replace(/\\/g, "/");
}

function normalizeFileKey(value) {
  return normalizeFileOperationPath(value).toLowerCase();
}

function buildFileOperationConfirmationPhrase(operation, fileName, newFileName) {
  const target = operation === "rename" ? `${fileName} -> ${newFileName}` : fileName;
  return `CONFIRM ${operation.toUpperCase()} ${target}`;
}

function buildMirrorSyncConfirmationPhrase(direction, projectTitle, actionCount) {
  const safeTitle = cleanOverleafLabel(projectTitle || "unknown-project");
  return `CONFIRM MIRROR SYNC ${direction.toUpperCase()} ${safeTitle} ${actionCount} FILES`;
}

function normalizeCommentAction(value) {
  const action = String(value || "").trim().toLowerCase();
  if (["reply", "resolve", "reopen", "delete-comment"].includes(action)) return action;
  if (action === "delete") return "delete-comment";
  return "";
}

function normalizeVisibleCommentThreads(threads) {
  return (threads || []).map((thread, index) => {
    const actions = (thread.actions || []).map((action) => ({
      action: normalizeCommentAction(action.action || action.label),
      label: cleanOverleafLabel(action.label || ""),
      visible: Boolean(action.visible),
      disabled: Boolean(action.disabled),
      actionOnly: true
    })).filter((action) => action.action);
    const normalized = {
      threadIndex: index,
      source: cleanOverleafLabel(thread.source || ""),
      role: cleanOverleafLabel(thread.role || ""),
      label: cleanOverleafLabel(thread.label || "").slice(0, 160),
      preview: cleanOverleafLabel(thread.preview || "").slice(0, 220),
      visible: Boolean(thread.visible),
      resolved: Boolean(thread.resolved),
      lineNumber: Number.isFinite(Number(thread.lineNumber)) ? Number(thread.lineNumber) : null,
      actionCount: Number(thread.actionCount || actions.length || 0),
      actions
    };
    normalized.signature = hashCommentThread(normalized);
    return normalized;
  });
}

function chooseVisibleCommentThread(threads, args) {
  if (Number.isFinite(Number(args.threadIndex))) {
    const index = Number(args.threadIndex);
    return threads.find((thread) => thread.threadIndex === index) || null;
  }
  if (args.previewContains) {
    const needle = cleanOverleafLabel(args.previewContains).toLowerCase();
    if (needle) {
      const matched = threads.filter((thread) => String(thread.preview || "").toLowerCase().includes(needle));
      if (matched.length === 1) return matched[0];
      return null;
    }
  }
  if (Number.isFinite(Number(args.lineNumber))) {
    const lineNumber = Number(args.lineNumber);
    const matched = threads.filter((thread) => thread.lineNumber === lineNumber);
    if (matched.length === 1) return matched[0];
    return null;
  }
  return threads.length === 1 ? threads[0] : null;
}

function hashVisibleCommentThreads(threads) {
  return sha256(JSON.stringify((threads || []).map((thread) => ({
    threadIndex: thread.threadIndex,
    label: thread.label,
    preview: thread.preview,
    lineNumber: thread.lineNumber,
    resolved: thread.resolved,
    actionTypes: (thread.actions || []).map((action) => action.action).sort()
  }))));
}

function hashCommentThread(thread) {
  return sha256(JSON.stringify({
    label: thread.label,
    preview: thread.preview,
    lineNumber: thread.lineNumber,
    resolved: thread.resolved,
    actionTypes: (thread.actions || []).map((action) => action.action).sort()
  })).slice(0, 16);
}

function findMatchingCommentThread(beforeThread, threads) {
  if (!beforeThread) return null;
  const beforeIndex = Number(beforeThread.threadIndex);
  const sameIndex = threads.find((thread) => thread.threadIndex === beforeIndex);
  if (sameIndex && stableCommentThreadKey(sameIndex) === stableCommentThreadKey(beforeThread)) return sameIndex;
  return threads.find((thread) => stableCommentThreadKey(thread) === stableCommentThreadKey(beforeThread)) || null;
}

function stableCommentThreadKey(thread) {
  return JSON.stringify({
    label: cleanOverleafLabel(thread && thread.label || ""),
    preview: cleanOverleafLabel(thread && thread.preview || ""),
    lineNumber: Number.isFinite(Number(thread && thread.lineNumber)) ? Number(thread.lineNumber) : null
  });
}

function verifyCommentActionResult(action, beforeThread, afterThreads, result) {
  if (!result || result.executed !== true) {
    return { ok: false, error: "comment action did not report execution" };
  }
  if (action === "reply") {
    if (!Number.isFinite(Number(result.replyTextLength)) || Number(result.replyTextLength) < 1) {
      return { ok: false, error: "comment reply did not report a replyTextLength" };
    }
    return { ok: true, status: "replied", replyTextLength: Number(result.replyTextLength) };
  }
  const after = findMatchingCommentThread(beforeThread, afterThreads);
  if (action === "resolve") {
    if (!after || after.resolved !== true) return { ok: false, error: "comment resolve did not mark the selected thread resolved" };
    return { ok: true, status: "resolved" };
  }
  if (action === "reopen") {
    if (!after || after.resolved !== false) return { ok: false, error: "comment reopen did not mark the selected thread unresolved" };
    return { ok: true, status: "reopened" };
  }
  if (action === "delete-comment") {
    if (after) return { ok: false, error: "comment delete left the selected thread visible" };
    return { ok: true, status: "deleted" };
  }
  return { ok: false, error: `unsupported comment action verification: ${action}` };
}

function sanitizeCommentExecutionResult(result) {
  return {
    projectTitle: result.projectTitle || "",
    fileName: result.fileName || "",
    editorMode: result.editorMode || "",
    pageUrl: scrubProjectUrl(result.pageUrl || ""),
    action: normalizeCommentAction(result.action || ""),
    threadIndex: Number.isFinite(Number(result.threadIndex)) ? Number(result.threadIndex) : null,
    executed: Boolean(result.executed),
    replyTextLength: Number(result.replyTextLength || 0)
  };
}

function buildCommentActionConfirmationPhrase(action, thread) {
  const target = thread ? `thread ${thread.threadIndex} ${thread.signature}` : "unselected thread";
  return `CONFIRM COMMENT ${action.toUpperCase()} ${target}`;
}

function selectClientForDiagnostic(state, args) {
  const resolvedTarget = resolveTarget(state, args || {});
  const client = chooseClient(state, resolvedTarget);
  return {
    clientId: client.id,
    projectTitle: client.projectTitle,
    fileName: client.fileName,
    editorMode: client.editorMode,
    pageUrl: client.pageUrl,
    contentScriptVersion: client.contentScriptVersion
  };
}

function validateExpectedFile(filePayload, args) {
  if (args.expectedFileName && filePayload.fileName && !fileNameMatches(filePayload.fileName, args.expectedFileName)) {
    throw new Error(`expected file ${args.expectedFileName}, got ${filePayload.fileName}`);
  }
}

function fileNameMatches(current, expected) {
  const a = normalizeOverleafPath(current);
  const b = normalizeOverleafPath(expected);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizeOverleafPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validateWriteArgs(args) {
  for (const name of ["projectTitle", "expectedFileName", "beforeHash", "reason"]) {
    if (!args[name]) throw new Error(`write requires ${name}`);
  }
}

function addTextHash(payload) {
  const text = String(payload && payload.text !== undefined ? payload.text : "");
  return { ...payload, beforeHash: sha256(text), textLength: text.length };
}

function rememberRead(state, payload) {
  const read = addTextHash(payload);
  const text = String(read.text || "");
  state.readCache.set(read.beforeHash, {
    text,
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    textLength: read.textLength,
    cachedAt: new Date().toISOString()
  });
  if (state.readCache.size > 50) {
    const firstKey = state.readCache.keys().next().value;
    state.readCache.delete(firstKey);
  }
  return read;
}

function applyReadBudget(state, read, args = {}) {
  const mode = normalizeContextBudget(args.contextBudget || args.context_budget);
  if (mode === "full") return read;
  if (mode === "summary") return summarizeReadPayload(read, args);
  if (mode === "section") {
    const sections = parseLatexSections(String(read.text || ""));
    const section = chooseLatexSection(sections, args);
    const text = String(read.text || "").slice(section.contentStartOffset, section.endOffset);
    return {
      ...summarizeReadPayload(read, args),
      contextBudget: "section",
      section: sectionPublicPayload(section),
      text,
      returnedTextLength: text.length
    };
  }
  if (mode === "diff") {
    return diffReadSinceHash(state, read, {
      sinceHash: args.sinceHash || args.beforeHash,
      mode: "diff",
      maxDiffLines: args.maxDiffLines
    });
  }
  return read;
}

function normalizeContextBudget(value) {
  const mode = String(value || "full").toLowerCase().replace(/[_-]/g, "");
  if (mode === "summary") return "summary";
  if (mode === "section") return "section";
  if (mode === "diff") return "diff";
  return "full";
}

function summarizeReadPayload(read, args = {}) {
  const text = String(read.text || "");
  const maxChars = clampNumber(args.maxChars, 0, 8000, 800);
  return {
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    beforeHash: read.beforeHash,
    textLength: read.textLength,
    lineCount: splitTextLines(text).length,
    contextBudget: "summary",
    preview: maxChars > 0 ? text.slice(0, maxChars) : "",
    previewTruncated: maxChars > 0 && text.length > maxChars
  };
}

function sliceLineRange(text, args) {
  const lines = splitTextLines(text);
  const startLine = Number(args.startLine);
  const endLine = Number(args.endLine);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error("read_file_range requires 1-based startLine and endLine with endLine >= startLine");
  }
  const selected = lines.slice(startLine - 1, Math.min(endLine, lines.length));
  const joined = selected.join("\n");
  const maxChars = clampNumber(args.maxChars, 0, 20000, 0);
  const returnedText = maxChars > 0 ? joined.slice(0, maxChars) : joined;
  return {
    startLine,
    endLine: Math.min(endLine, lines.length),
    lineCount: lines.length,
    returnedLineCount: selected.length,
    text: returnedText,
    returnedTextLength: returnedText.length,
    rangeHash: sha256(joined),
    truncated: maxChars > 0 && joined.length > maxChars
  };
}

function diffReadSinceHash(state, read, args = {}) {
  const sinceHash = String(args.sinceHash || "");
  if (!sinceHash) throw new Error("read_file_since_hash or contextBudget=diff requires sinceHash");
  const currentText = String(read.text || "");
  const currentHash = read.beforeHash || sha256(currentText);
  const base = state.readCache.get(sinceHash);
  const changed = currentHash !== sinceHash;
  const basePayload = {
    projectTitle: read.projectTitle || "",
    fileName: read.fileName || "",
    sinceHash,
    beforeHash: currentHash,
    textLength: read.textLength,
    changed,
    contextBudget: "diff"
  };
  if (!changed) {
    return { ...basePayload, diffAvailable: true, summary: { changedLineStart: null, removedLineCount: 0, addedLineCount: 0 }, diff: "" };
  }
  if (!base) {
    return {
      ...basePayload,
      diffAvailable: false,
      reason: "sinceHash is not in this bridge server's read cache; read the file once first, then call again with that hash."
    };
  }
  const diff = buildChangedRangeDiff(base.text, currentText, {
    fileName: read.fileName || "current.tex",
    maxDiffLines: args.maxDiffLines
  });
  if (args.mode === "summary") {
    const { diff: _diff, ...withoutDiff } = diff;
    return { ...basePayload, diffAvailable: true, ...withoutDiff };
  }
  return { ...basePayload, diffAvailable: true, ...diff };
}

function buildChangedRangeDiff(beforeText, afterText, options = {}) {
  const before = splitTextLines(beforeText);
  const after = splitTextLines(afterText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const beforeChanged = before.slice(prefix, before.length - suffix);
  const afterChanged = after.slice(prefix, after.length - suffix);
  const contextStart = Math.max(0, prefix - 2);
  const contextEndBefore = Math.min(before.length, before.length - suffix + 2);
  const contextBefore = before.slice(contextStart, prefix);
  const contextAfter = before.slice(before.length - suffix, contextEndBefore);
  const lines = [
    `--- a/${options.fileName || "current.tex"}`,
    `+++ b/${options.fileName || "current.tex"}`,
    `@@ changed:${prefix + 1} removed:${beforeChanged.length} added:${afterChanged.length} @@`
  ];
  for (const line of contextBefore) lines.push(` ${line}`);
  for (const line of beforeChanged) lines.push(`-${line}`);
  for (const line of afterChanged) lines.push(`+${line}`);
  for (const line of contextAfter) lines.push(` ${line}`);

  const maxDiffLines = clampNumber(options.maxDiffLines, 10, 1000, 160);
  const truncated = lines.length > maxDiffLines;
  const limited = truncated ? lines.slice(0, maxDiffLines).concat([`... truncated ${lines.length - maxDiffLines} diff lines ...`]) : lines;
  return {
    summary: {
      changedLineStart: prefix + 1,
      beforeChangedLineEnd: before.length - suffix,
      afterChangedLineEnd: after.length - suffix,
      removedLineCount: beforeChanged.length,
      addedLineCount: afterChanged.length,
      unchangedPrefixLineCount: prefix,
      unchangedSuffixLineCount: suffix
    },
    diff: limited.join("\n") + "\n",
    diffLineCount: lines.length,
    diffTruncated: truncated
  };
}

function splitTextLines(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function writeResultPayload(before, after, record, commandResult) {
  return {
    ok: true,
    projectTitle: after.projectTitle || before.projectTitle || "",
    fileName: after.fileName || before.fileName || "",
    beforeHash: record.beforeHash,
    afterHash: record.afterHash,
    snapshotPath: record.beforePath,
    afterPath: record.afterPath,
    diffPath: record.diffPath,
    commandResult
  };
}

function sendCommand(state, target, type, payload, timeoutMs = state.commandTimeoutMs) {
  const resolvedTarget = resolveTarget(state, target || {});
  const client = chooseClient(state, resolvedTarget);
  const id = crypto.randomUUID();
  const command = {
    id,
    type,
    payload: sanitizeBrowserPayload(payload, resolvedTarget)
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pendingById.delete(id);
      reject(new Error(`timeout waiting for browser command ${type}`));
    }, timeoutMs);
    state.pendingById.set(id, { id, client, resolve, reject, timeout });
    enqueueCommand(client, command);
  });
}

function sanitizeBrowserPayload(payload, target) {
  const out = { ...(payload || {}) };
  if (target && target.projectTitle) out.expectedProjectTitle = String(target.projectTitle);
  return out;
}

function normalizeBrowserPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const normalized = { ...payload };
  if (typeof normalized.projectTitle === "string") normalized.projectTitle = cleanOverleafLabel(normalized.projectTitle);
  if (typeof normalized.fileName === "string") normalized.fileName = cleanOverleafFileName(normalized.fileName);
  return normalized;
}

function refreshClientMetadata(client, payload) {
  if (!client || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
  client.lastSeenAt = new Date().toISOString();
  if (typeof payload.pageUrl === "string" && payload.pageUrl) client.pageUrl = payload.pageUrl;
  if (typeof payload.projectTitle === "string" && payload.projectTitle) client.projectTitle = payload.projectTitle;
  if (typeof payload.fileName === "string" && payload.fileName) client.fileName = payload.fileName;
  if (typeof payload.editorMode === "string" && payload.editorMode) client.editorMode = payload.editorMode;
}

function hasTargetSelector(args) {
  return Boolean(args && (args.clientId || args.projectTitle || args.projectAlias || args.targetLockId));
}

function resolveTarget(state, target) {
  const resolved = { ...(target || {}) };
  if (resolved.projectAlias) {
    const alias = normalizeAliasName(resolved.projectAlias);
    const record = state.projectAliases.get(alias);
    if (!record) throw new Error(`project alias not found: ${resolved.projectAlias}`);
    if (!resolved.projectTitle) {
      resolved.projectTitle = record.projectTitle;
    } else if (!projectTitlesCompatible(resolved.projectTitle, record.projectTitle)) {
      throw new Error(`project alias ${alias} targets ${record.projectTitle}, not ${resolved.projectTitle}`);
    }
    resolved.projectAlias = alias;
  }
  if (resolved.targetLockId) {
    const lock = state.targetLocks.get(String(resolved.targetLockId));
    if (!lock) throw new Error(`target lock not found: ${resolved.targetLockId}`);
    const lockedClient = state.clients.get(lock.clientId);
    if (!lockedClient) throw new Error(`target lock client disconnected: ${resolved.targetLockId}`);
    if (lockedClient.projectTitle && lock.projectTitle && !sameProjectTitle(lockedClient.projectTitle, lock.projectTitle)) {
      throw new Error(`target lock project changed: expected ${lock.projectTitle}, got ${lockedClient.projectTitle}`);
    }
    if (resolved.clientId && String(resolved.clientId) !== lock.clientId) {
      throw new Error(`target lock ${resolved.targetLockId} belongs to client ${lock.clientId}, not ${resolved.clientId}`);
    }
    if (resolved.projectTitle && !projectTitlesCompatible(resolved.projectTitle, lock.projectTitle)) {
      throw new Error(`target lock ${resolved.targetLockId} is for ${lock.projectTitle}, not ${resolved.projectTitle}`);
    }
    resolved.clientId = lock.clientId;
    resolved.projectTitle = resolved.projectTitle || lock.projectTitle;
  }
  return resolved;
}

function chooseClient(state, target) {
  pruneStaleClients(state);
  const clients = Array.from(state.clients.values());
  if (clients.length === 0) {
    throw new Error("no Overleaf browser page is connected");
  }
  if (target.clientId) {
    const client = state.clients.get(String(target.clientId));
    if (!client) throw new Error(`clientId not connected: ${target.clientId}`);
    return client;
  }
  if (target.projectTitle) {
    const needle = String(target.projectTitle).toLowerCase();
    const matches = clients.filter((client) => String(client.projectTitle || "").toLowerCase().includes(needle));
    if (matches.length === 0) throw new Error(`no connected project title matches: ${target.projectTitle}`);
    if (matches.length > 1) throw new Error(`multiple connected project titles match: ${target.projectTitle}`);
    return matches[0];
  }
  clients.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  return clients[0];
}

function getClientById(state, clientId) {
  if (!clientId) return null;
  return state.clients.get(String(clientId)) || null;
}

function pruneStaleClients(state) {
  const now = Date.now();
  for (const [clientId, client] of state.clients) {
    const lastSeen = Date.parse(client.lastSeenAt || client.createdAt || "");
    if (Number.isFinite(lastSeen) && now - lastSeen <= CLIENT_STALE_MS) continue;
    for (const waiter of client.waiters || []) {
      clearTimeout(waiter.timeout);
      writeJson(waiter.res, 410, { ok: false, error: "stale client disconnected" });
    }
    for (const command of client.queue || []) {
      const pending = state.pendingById.get(command.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("stale client disconnected"));
        state.pendingById.delete(command.id);
      }
    }
    state.clients.delete(clientId);
  }
}

function enqueueCommand(client, command) {
  client.queue.push(command);
  const waiter = client.waiters.shift();
  if (waiter) {
    clearTimeout(waiter.timeout);
    const next = client.queue.shift();
    writeJson(waiter.res, 200, { ok: true, command: next });
  }
}

function removeWaiter(client, waiter) {
  const index = client.waiters.indexOf(waiter);
  if (index >= 0) client.waiters.splice(index, 1);
}

async function saveSnapshotPair(state, before, after, operation, summary) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = sanitizeFileName(before.fileName || "current.tex");
  const projectDir = projectMirrorDir(state, before.projectTitle || "unknown-project");
  const dir = path.join(projectDir, "patches", day);
  fs.mkdirSync(dir, { recursive: true });

  const beforeText = String(before.text || "");
  const afterText = after ? String(after.text || "") : "";
  const beforePath = path.join(dir, `${file}.before.${stamp}.tex`);
  fs.writeFileSync(beforePath, beforeText, "utf8");

  let afterPath = null;
  let diffPath = null;
  if (after) {
    afterPath = path.join(dir, `${file}.after.${stamp}.tex`);
    diffPath = path.join(dir, `${file}.patch.${stamp}.diff`);
    fs.writeFileSync(afterPath, afterText, "utf8");
    fs.writeFileSync(diffPath, createUnifiedDiff(file, beforeText, afterText), "utf8");
  }

  const record = {
    timestamp: now.toISOString(),
    projectTitle: before.projectTitle || "",
    fileName: before.fileName || "",
    operation,
    reason: summary,
    beforeHash: sha256(beforeText),
    afterHash: after ? sha256(afterText) : null,
    beforePath,
    afterPath,
    diffPath
  };
  state.patchLog.push(record);
  const logPath = path.join(projectDir, "patch-log.jsonl");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");
  return record;
}

function projectMirrorDir(state, projectTitle) {
  return path.join(state.snapshotDir, slugify(projectTitle || "unknown-project"));
}

function writeMirrorManifest(projectDir, root, manifest) {
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  const latestManifestPath = path.join(projectDir, "sync", "latest-manifest.json");
  const payload = { ...manifest, root };
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.mkdirSync(path.dirname(latestManifestPath), { recursive: true });
  fs.writeFileSync(latestManifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { manifestPath, latestManifestPath };
}

function writeProjectExport(state, projectTitle, relativePath, text, metadata) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = projectMirrorDir(state, projectTitle);
  const root = path.join(projectDir, "exports", stamp);
  const safeRelative = sanitizeRelativePath(relativePath);
  const exportPath = path.join(root, safeRelative);
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  fs.writeFileSync(exportPath, String(text || ""), "utf8");
  const manifestPath = path.join(root, "manifest.json");
  const manifest = {
    projectTitle,
    createdAt: new Date().toISOString(),
    root,
    exportPath,
    path: safeRelative,
    ...metadata
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { root, exportPath, manifestPath, manifest };
}

function writeProjectBinaryExport(state, projectTitle, relativePath, bytes, metadata) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = projectMirrorDir(state, projectTitle);
  const root = path.join(projectDir, "exports", stamp);
  const safeRelative = sanitizeRelativePath(relativePath);
  const exportPath = path.join(root, safeRelative);
  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  fs.writeFileSync(exportPath, bytes);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = {
    projectTitle,
    createdAt: new Date().toISOString(),
    root,
    exportPath,
    path: safeRelative,
    ...metadata
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { root, exportPath, manifestPath, manifest };
}

function readMirrorManifestForArgs(state, args) {
  const root = resolveMirrorRoot(state, args);
  const manifestPath = path.join(root, "manifest.json");
  const latestManifestPath = path.join(root, "latest-manifest.json");
  const readableManifestPath = fs.existsSync(manifestPath) ? manifestPath : latestManifestPath;
  if (!fs.existsSync(readableManifestPath)) {
    throw new Error(`mirror manifest not found: ${readableManifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(readableManifestPath, "utf8"));
  const manifestRoot = path.resolve(manifest.root || root);
  const resolvedRoot = fs.existsSync(path.join(manifestRoot, "manifest.json")) ? manifestRoot : root;
  return { root: resolvedRoot, manifestPath: readableManifestPath, manifest };
}

function resolveMirrorRoot(state, args) {
  if (args.mirrorRoot) {
    const root = path.resolve(String(args.mirrorRoot));
    ensureMirrorRootInsideSnapshotDir(state, root);
    return root;
  }
  if (!args.projectTitle) throw new Error("projectTitle or mirrorRoot is required to locate a project mirror");
  const latest = path.join(projectMirrorDir(state, args.projectTitle), "sync", "latest-manifest.json");
  const latestManifest = fs.existsSync(latest) ? latest : findLatestMirrorManifestByProjectTitle(state, args.projectTitle);
  if (!latestManifest) throw new Error(`latest mirror manifest not found for projectTitle: ${args.projectTitle}`);
  const manifest = JSON.parse(fs.readFileSync(latestManifest, "utf8"));
  const root = path.resolve(manifest.root || path.dirname(latestManifest));
  ensureMirrorRootInsideSnapshotDir(state, root);
  return root;
}

function findLatestMirrorManifestByProjectTitle(state, projectTitle) {
  const needle = cleanOverleafLabel(projectTitle).toLowerCase();
  if (!needle || !fs.existsSync(state.snapshotDir)) return "";
  const matches = [];
  for (const entry of fs.readdirSync(state.snapshotDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(state.snapshotDir, entry.name, "sync", "latest-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const title = cleanOverleafLabel(manifest.projectTitle || "").toLowerCase();
      if (title.includes(needle)) {
        matches.push({ manifestPath, createdAt: String(manifest.createdAt || "") });
      }
    } catch (_) {}
  }
  if (matches.length === 0) return "";
  matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0].manifestPath;
}

function readMirrorFile(root, relativePath) {
  const safeRelative = sanitizeRelativePath(relativePath);
  const filePath = path.resolve(root, safeRelative);
  if (!filePath.startsWith(path.resolve(root) + path.sep) && filePath !== path.resolve(root)) {
    throw new Error(`mirror path escapes root: ${relativePath}`);
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return { exists: false, text: "", filePath };
  return { exists: true, text: fs.readFileSync(filePath, "utf8"), filePath };
}

function ensureMirrorRootInsideSnapshotDir(state, root) {
  const resolvedRoot = path.resolve(root);
  const resolvedSnapshotDir = path.resolve(state.snapshotDir);
  if (!resolvedRoot.startsWith(resolvedSnapshotDir + path.sep) && resolvedRoot !== resolvedSnapshotDir) {
    throw new Error("mirrorRoot must be inside the local Overleaf bridge project mirror");
  }
}

function readSnapshotText(state, snapshotPath) {
  const resolved = path.resolve(String(snapshotPath || ""));
  const root = path.resolve(state.snapshotDir);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("snapshotPath must be inside the local Overleaf bridge project mirror");
  }
  if (!fs.existsSync(resolved)) throw new Error(`snapshot not found: ${snapshotPath}`);
  return fs.readFileSync(resolved, "utf8");
}

function applyUnifiedPatch(beforeText, patchText) {
  const before = splitLines(beforeText);
  const patch = splitLines(patchText).filter((line) => !line.startsWith("--- ") && !line.startsWith("+++ "));
  const out = [];
  let sourceIndex = 0;
  let i = 0;
  let sawHunk = false;

  while (i < patch.length) {
    const header = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(patch[i]);
    if (!header) {
      i += 1;
      continue;
    }
    sawHunk = true;
    const oldStart = Number(header[1]) - 1;
    if (oldStart < sourceIndex) throw new Error("patch hunks overlap or move backwards");
    while (sourceIndex < oldStart) out.push(before[sourceIndex++]);
    i += 1;

    while (i < patch.length && !patch[i].startsWith("@@ ")) {
      const line = patch[i];
      if (line.startsWith("\\")) {
        i += 1;
        continue;
      }
      const marker = line.slice(0, 1);
      const value = line.slice(1);
      if (marker === " ") {
        if (before[sourceIndex] !== value) throw new Error(`patch context mismatch near: ${value}`);
        out.push(before[sourceIndex++]);
      } else if (marker === "-") {
        if (before[sourceIndex] !== value) throw new Error(`patch removal mismatch near: ${value}`);
        sourceIndex += 1;
      } else if (marker === "+") {
        out.push(value);
      } else if (line === "") {
        if (before[sourceIndex] !== "") throw new Error("patch context mismatch near blank line");
        out.push(before[sourceIndex++]);
      } else {
        throw new Error(`unsupported patch line: ${line}`);
      }
      i += 1;
    }
  }

  if (!sawHunk) throw new Error("patch must contain at least one unified diff hunk");
  while (sourceIndex < before.length) out.push(before[sourceIndex++]);
  return joinLines(out, beforeText);
}

function splitLines(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function joinLines(lines, originalText) {
  const joined = lines.join("\n");
  return String(originalText || "").endsWith("\n") ? `${joined}\n` : joined;
}

const LATEX_SECTION_LEVELS = new Map([
  ["part", 0],
  ["chapter", 1],
  ["section", 2],
  ["subsection", 3],
  ["subsubsection", 4],
  ["paragraph", 5],
  ["subparagraph", 6]
]);

function parseLatexSections(text) {
  const source = String(text || "");
  const pattern = /\\(subparagraph|subsubsection|subsection|paragraph|chapter|section|part)\s*(\*)?\s*(?:\[[^\]\n]*\])?\s*\{/g;
  const found = [];
  let match;
  while ((match = pattern.exec(source))) {
    if (isLatexCommentedAt(source, match.index)) continue;
    const openBrace = pattern.lastIndex - 1;
    const parsedTitle = readBalancedGroup(source, openBrace);
    if (!parsedTitle) continue;
    const command = match[1];
    const level = LATEX_SECTION_LEVELS.get(command);
    const contentStartOffset = sectionBodyStart(source, parsedTitle.endOffset);
    found.push({
      index: found.length + 1,
      command,
      level,
      starred: Boolean(match[2]),
      title: parsedTitle.value.trim(),
      normalizedTitle: normalizeLatexTitle(parsedTitle.value),
      startOffset: match.index,
      headingEndOffset: parsedTitle.endOffset,
      contentStartOffset,
      endOffset: source.length,
      lineStart: lineNumberAt(source, match.index),
      contentLineStart: lineNumberAt(source, contentStartOffset)
    });
    pattern.lastIndex = parsedTitle.endOffset;
  }

  for (let i = 0; i < found.length; i += 1) {
    const current = found[i];
    for (let j = i + 1; j < found.length; j += 1) {
      if (found[j].level <= current.level) {
        current.endOffset = found[j].startOffset;
        break;
      }
    }
    current.lineEnd = lineNumberAt(source, Math.max(current.startOffset, current.endOffset - 1));
  }

  const stack = [];
  for (const section of found) {
    while (stack.length && stack[stack.length - 1].level >= section.level) stack.pop();
    section.path = [...stack.map((item) => item.title), section.title];
    section.normalizedPath = section.path.map(normalizeLatexTitle).join("/");
    stack.push(section);
  }
  return found;
}

function chooseLatexSection(sections, args) {
  if (!sections.length) throw new Error("no LaTeX sections found in the selected file");
  if (args.sectionIndex !== undefined) {
    const index = Number(args.sectionIndex);
    if (!Number.isInteger(index) || index < 1 || index > sections.length) {
      throw new Error(`sectionIndex must be between 1 and ${sections.length}`);
    }
    return sections[index - 1];
  }

  let candidates = sections;
  if (args.level !== undefined && args.level !== "") {
    const wanted = normalizeSectionLevel(args.level);
    candidates = candidates.filter((section) => section.command === wanted.command || section.level === wanted.level);
  }
  if (args.path) {
    const normalizedPath = normalizeSectionPath(args.path);
    candidates = candidates.filter((section) => section.normalizedPath === normalizedPath);
  }
  if (args.title) {
    const normalizedTitle = normalizeLatexTitle(args.title);
    candidates = candidates.filter((section) => section.normalizedTitle === normalizedTitle);
  }
  if (!args.path && !args.title && args.level === undefined) {
    throw new Error("section selector requires sectionIndex, path, title, or level");
  }
  if (candidates.length === 0) throw new Error("no section matched the requested selector");
  if (candidates.length > 1) {
    const choices = candidates.slice(0, 5).map((section) => `${section.index}:${section.command}:${section.path.join("/")}`).join("; ");
    throw new Error(`section selector matched ${candidates.length} sections; use sectionIndex or path. Candidates: ${choices}`);
  }
  return candidates[0];
}

function sectionPublicPayload(section) {
  return {
    index: section.index,
    command: section.command,
    level: section.level,
    starred: section.starred,
    title: section.title,
    normalizedTitle: section.normalizedTitle,
    path: section.path,
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
    contentLineStart: section.contentLineStart,
    startOffset: section.startOffset,
    contentStartOffset: section.contentStartOffset,
    endOffset: section.endOffset
  };
}

function readBalancedGroup(text, openOffset) {
  if (text[openOffset] !== "{") return null;
  let depth = 0;
  for (let i = openOffset; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(openOffset + 1, i), endOffset: i + 1 };
      }
    }
  }
  return null;
}

function isLatexCommentedAt(text, offset) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  for (let i = lineStart; i < offset; i += 1) {
    if (text[i] === "%" && !isEscaped(text, i)) return true;
  }
  return false;
}

function isEscaped(text, offset) {
  let count = 0;
  for (let i = offset - 1; i >= 0 && text[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function sectionBodyStart(text, offset) {
  let i = offset;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  if (text[i] === "\r" && text[i + 1] === "\n") return i + 2;
  if (text[i] === "\n") return i + 1;
  return i;
}

function lineNumberAt(text, offset) {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function normalizeLatexTitle(value) {
  return String(value || "")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}$]/g, " ")
    .replace(/\\([_%&#$])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeSectionPath(value) {
  return String(value || "").split(/[>/]/).map(normalizeLatexTitle).filter(Boolean).join("/");
}

function normalizeSectionLevel(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const level = Number(value);
    const command = Array.from(LATEX_SECTION_LEVELS.entries()).find((entry) => entry[1] === level);
    if (!command) throw new Error(`unknown section level: ${value}`);
    return { command: command[0], level };
  }
  const command = String(value || "").replace(/^\\/, "").toLowerCase();
  if (!LATEX_SECTION_LEVELS.has(command)) throw new Error(`unknown section level: ${value}`);
  return { command, level: LATEX_SECTION_LEVELS.get(command) };
}

function normalizeReplacementText(value, originalText) {
  const text = String(value || "");
  if (!text) return "";
  if (text.endsWith("\n")) return text;
  return String(originalText || "").includes("\r\n") ? `${text}\r\n` : `${text}\n`;
}

function summarizeCompileLog(result) {
  if (result.compileCompleted === false) {
    return {
      errors: null,
      warnings: null,
      pages: null,
      completed: false,
      timedOut: Boolean(result.compileTimedOut),
      statusText: String(result.visibleStatus || "Compile incomplete"),
      logSnippet: ""
    };
  }
  const text = String(result.logSnippet || result.visibleStatus || "");
  const hasExplicitCounts = /\bErrors?\s*:?\s*\d+\b|\bWarnings?\s*:?\s*\d+\b/i.test(String(result.logSnippet || ""));
  if (result.compileEvidence === "pdf-output-refreshed" && !hasExplicitCounts) {
    return {
      errors: null,
      warnings: null,
      pages: null,
      completed: true,
      timedOut: false,
      evidence: "pdf-output-refreshed",
      statusText: String(result.visibleStatus || "Compile completed: PDF output refreshed; log counts unavailable"),
      logSnippet: ""
    };
  }
  const parsed = parseCompileStatusText(text);
  const errors = parsed.errors === null ? 0 : parsed.errors;
  const warnings = parsed.warnings === null ? 0 : parsed.warnings;
  const pages = parsed.pages;
  return {
    errors,
    warnings,
    pages,
    completed: true,
    timedOut: false,
    statusText: formatCompileStatusText(errors, warnings, pages, result.visibleStatus),
    logSnippet: text.slice(0, 4000)
  };
}

function parseCompileStatusText(value) {
  const text = String(value || "");
  const explicitErrors = matchLastNumber(text, /\bErrors?\s*:?\s*(\d+)\b/gi);
  const explicitWarnings = matchLastNumber(text, /\bWarnings?\s*:?\s*(\d+)\b/gi);
  const explicitPages = matchLastNumber(text, /\b(?:Pages?|pages)\s*:?\s*(\d+)\b/gi);
  const outputPages = matchLastNumber(text, /\bOutput written on\b[\s\S]*?\((\d+)\s+pages?\b/gi);
  return {
    errors: explicitErrors === null ? countImplicitCompileIssues(text, /\b(fatal|undefined control sequence|missing \$|emergency stop)\b/gi) : explicitErrors,
    warnings: explicitWarnings === null ? countImplicitCompileIssues(text, /\bwarning\b/gi) : explicitWarnings,
    pages: outputPages === null ? explicitPages : outputPages
  };
}

function matchLastNumber(text, pattern) {
  let value = null;
  for (const match of String(text || "").matchAll(pattern)) value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function countImplicitCompileIssues(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function formatCompileStatusText(errors, warnings, pages, fallback) {
  if (errors === null && warnings === null && pages === null) return String(fallback || "");
  return `Errors ${errors || 0} | Warnings ${warnings || 0}${pages === null ? "" : ` | Pages ${pages}`}`;
}

function createUnifiedDiff(fileName, beforeText, afterText) {
  if (beforeText === afterText) return "";
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  const lines = [`--- a/${fileName}`, `+++ b/${fileName}`];
  lines.push(`@@ before:${before.length} after:${after.length} @@`);
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i += 1) {
    if (before[i] === after[i]) {
      lines.push(` ${before[i] || ""}`);
    } else {
      if (i < before.length) lines.push(`-${before[i] || ""}`);
      if (i < after.length) lines.push(`+${after[i] || ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

function listClients(state) {
  return Array.from(state.clients.values()).map((client) => ({
    clientId: client.id,
    projectTitle: client.projectTitle,
    fileName: client.fileName,
    editorMode: client.editorMode,
    contentScriptVersion: client.contentScriptVersion,
    pageUrl: scrubProjectUrl(client.pageUrl),
    lastSeenAt: client.lastSeenAt
  }));
}

function listProjectAliases(state) {
  return Array.from(state.projectAliases.values())
    .sort((a, b) => a.alias.localeCompare(b.alias))
    .map((alias) => ({ ...alias }));
}

function listTargetLocks(state) {
  return Array.from(state.targetLocks.values())
    .filter((lock) => state.clients.has(lock.clientId))
    .map((lock) => ({ ...lock }));
}

function loadProjectAliases(aliasFile) {
  const aliases = new Map();
  try {
    if (!fs.existsSync(aliasFile)) return aliases;
    const parsed = JSON.parse(fs.readFileSync(aliasFile, "utf8"));
    const entries = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed.aliases || parsed) : {};
    for (const [name, value] of Object.entries(entries || {})) {
      const alias = normalizeAliasName(name);
      if (!alias) continue;
      const projectTitle = cleanOverleafLabel(typeof value === "string" ? value : value && (value.projectTitle || value.titleContains));
      if (!projectTitle) continue;
      aliases.set(alias, {
        alias,
        projectTitle,
        createdAt: typeof value === "object" && value ? String(value.createdAt || "") : "",
        updatedAt: typeof value === "object" && value ? String(value.updatedAt || "") : ""
      });
    }
  } catch (error) {
    throw new Error(`failed to read project aliases from ${aliasFile}: ${error.message}`);
  }
  return aliases;
}

function saveProjectAliases(state) {
  const aliases = {};
  for (const alias of listProjectAliases(state)) {
    aliases[alias.alias] = {
      projectTitle: alias.projectTitle,
      createdAt: alias.createdAt || undefined,
      updatedAt: alias.updatedAt || undefined
    };
  }
  fs.mkdirSync(path.dirname(state.aliasFile), { recursive: true });
  fs.writeFileSync(state.aliasFile, JSON.stringify({ aliases }, null, 2) + "\n", "utf8");
}

function normalizeAliasName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sameProjectTitle(left, right) {
  return cleanOverleafLabel(left).toLowerCase() === cleanOverleafLabel(right).toLowerCase();
}

function projectTitlesCompatible(left, right) {
  const a = cleanOverleafLabel(left).toLowerCase();
  const b = cleanOverleafLabel(right).toLowerCase();
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function cleanOverleafLabel(value) {
  return String(value || "")
    .replace(/keyboard_arrow_down|more_vert|description|expand_more|chevron_right/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOverleafFileName(value) {
  const cleaned = cleanOverleafLabel(value);
  const match = cleaned.match(/[A-Za-z0-9_. -]+\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|svg|txt|md|csv|dat)\b/i);
  return match ? match[0].trim() : cleaned;
}

function scrubProjectUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (url.hostname.endsWith("overleaf.com") && url.pathname.startsWith("/project/")) {
      return `${url.origin}/project/<redacted>`;
    }
  } catch (_) {}
  return pageUrl || "";
}

function scrubArtifactUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.pathname = url.pathname
      .replace(/\/project\/[^/?#]+/g, "/project/<redacted>")
      .replace(/\/download\/project\/[^/?#]+/g, "/download/project/<redacted>")
      .replace(/\/compile\/[^/?#]+/g, "/compile/<redacted>");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return String(value || "").replace(/[A-Za-z0-9]{24,}/g, "<redacted>");
  }
}

function isAuthorized(state, req) {
  const header = String(req.headers.authorization || "");
  return header === `Bearer ${state.token}`;
}

function isOfficialOverleafOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      (url.hostname === "overleaf.com" || url.hostname.endsWith(".overleaf.com"));
  } catch (_) {
    return false;
  }
}

function isBridgeAuthorized(state, req) {
  if (isAuthorized(state, req)) return true;
  const origin = String(req.headers.origin || "");
  return isOfficialOverleafOrigin(origin) || origin.startsWith("chrome-extension://");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function writeJson(res, status, body) {
  if (res.writableEnded) return;
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxLength = 5_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxLength) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function ensureRuntimeToken() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tokenPath = path.join(RUNTIME_DIR, "bridge-token.txt");
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, "utf8").trim();
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(tokenPath, token + "\n", "utf8");
  return token;
}

function sanitizeId(value) {
  const text = String(value || "");
  return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : "";
}

function sanitizeFileName(value) {
  return String(value || "file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function sanitizeRelativePath(value) {
  const safeParts = String(value || "file")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => sanitizeFileName(part).replace(/^\.+$/, "_"))
    .filter(Boolean);
  return safeParts.length ? path.join(...safeParts) : "file";
}

function sanitizeArtifactExportName(value, type) {
  const safe = sanitizeFileName(path.basename(String(value || "artifact.bin")));
  if (/\.[A-Za-z0-9]{1,8}$/.test(safe)) return safe;
  const extension = {
    pdf: "pdf",
    bbl: "bbl",
    aux: "aux",
    blg: "blg",
    log: "log"
  }[String(type || "").toLowerCase()] || "bin";
  return `${safe}.${extension}`;
}

function clampArtifactMaxBytes(value) {
  const requested = Number(value || 10 * 1024 * 1024);
  if (!Number.isFinite(requested) || requested <= 0) return 10 * 1024 * 1024;
  return Math.min(Math.floor(requested), MAX_ARTIFACT_BYTES);
}

function slugify(value) {
  return String(value || "project")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "project";
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function osHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || ROOT;
}

function summarizePayload(payload) {
  const text = String(payload.text || payload.replacement || "");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function makeMcpContent(payload) {
  return [{ type: "text", text: JSON.stringify(payload, null, 2) }];
}

async function handleMcpRequest(bridge, request) {
  const { id, method, params } = request;
  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "overleaf-browser-bridge", version: "0.5.33" }
        }
      };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: bridge.tools() } };
    }
    if (method === "tools/call") {
      const result = await bridge.callTool(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result: { content: makeMcpContent(result) } };
    }
    if (!id) return null;
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (error) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: String(error && error.message ? error.message : error) } };
  }
}

async function runStdioServer(options = {}) {
  const bridge = createBridgeServer(options);
  const address = await bridge.start();
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, "server-info.json"), JSON.stringify({
    serverUrl: `http://127.0.0.1:${address.port}`,
    token: bridge.state.token,
    snapshotDir: bridge.state.snapshotDir
  }, null, 2), "utf8");
  console.error(`[overleaf-bridge] HTTP bridge listening on http://127.0.0.1:${address.port}`);
  console.error(`[overleaf-bridge] Token saved at ${path.join(RUNTIME_DIR, "bridge-token.txt")}`);

  const parser = createStdioMessageParser(async (raw, mode) => {
    let request;
    try {
      request = JSON.parse(raw);
    } catch (error) {
      writeMcpResponse({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }, mode);
      return;
    }
    const response = await handleMcpRequest(bridge, request);
    if (response) writeMcpResponse(response, mode);
  });
  process.stdin.on("data", parser.feed);
}

function createStdioMessageParser(onMessage) {
  let buffer = "";

  function feed(chunk) {
    buffer += chunk.toString("utf8");
    drain();
  }

  function drain() {
    while (buffer.length > 0) {
      if (/^Content-Length:/i.test(buffer)) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.slice(0, headerEnd);
        const match = /^Content-Length:\s*(\d+)/im.exec(header);
        if (!match) {
          buffer = "";
          return;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const body = buffer.slice(bodyStart, bodyStart + length);
        buffer = buffer.slice(bodyStart + length);
        onMessage(body, "content-length");
        continue;
      }

      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onMessage(line, "jsonl");
    }
  }

  return { feed };
}

function writeMcpResponse(response, mode) {
  const json = JSON.stringify(response);
  if (mode === "content-length") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") out.port = Number(argv[++i]);
    if (arg === "--token") out.token = String(argv[++i]);
    if (arg === "--snapshot-dir") out.snapshotDir = String(argv[++i]);
  }
  return out;
}

if (require.main === module) {
  runStdioServer(parseCliArgs(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createBridgeServer,
  runStdioServer,
  createStdioMessageParser,
  handleMcpRequest,
  parseCliArgs,
  TOOL_DEFINITIONS,
  createUnifiedDiff,
  applyUnifiedPatch,
  parseLatexSections,
  isOfficialOverleafOrigin
};
