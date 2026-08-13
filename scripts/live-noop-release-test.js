#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");

async function main() {
  const info = readServerInfo();
  const current = await callTool(info, "get_current_project", {});
  if (!current.projectTitle || !current.fileName) {
    throw new Error("get_current_project did not return a project title and file name");
  }

  const target = {
    projectTitle: current.projectTitle,
    expectedFileName: current.fileName
  };

  const health = await callTool(info, "health_check", { projectTitle: current.projectTitle });
  const context = await callTool(info, "paper_context", { projectTitle: current.projectTitle });
  const diagnostics = await callTool(info, "get_editor_diagnostics", target);
  const before = await callTool(info, "read_current_file", target);
  if (!before.beforeHash || typeof before.text !== "string") {
    throw new Error("read_current_file did not return text and beforeHash");
  }

  const noop = await callTool(info, "replace_file", {
    ...target,
    beforeHash: before.beforeHash,
    reason: "release no-op write channel verification",
    text: before.text
  });

  const after = await callTool(info, "read_current_file", target);
  if (after.beforeHash !== before.beforeHash) {
    throw new Error(`no-op replace changed hash: ${before.beforeHash} -> ${after.beforeHash}`);
  }

  const noopPatch = createNoopPatch(current.fileName, before.text);
  const patched = await callTool(info, "apply_patch_to_file", {
    ...target,
    beforeHash: after.beforeHash,
    reason: "release no-op patch channel verification",
    patch: noopPatch
  });

  const afterPatch = await callTool(info, "read_current_file", target);
  if (afterPatch.beforeHash !== before.beforeHash) {
    throw new Error(`no-op patch changed hash: ${before.beforeHash} -> ${afterPatch.beforeHash}`);
  }

  const restored = await callTool(info, "restore_from_snapshot", {
    ...target,
    beforeHash: afterPatch.beforeHash,
    reason: "release no-op restore channel verification",
    snapshotPath: patched.snapshotPath
  });

  const afterRestore = await callTool(info, "read_current_file", target);
  if (afterRestore.beforeHash !== before.beforeHash) {
    throw new Error(`no-op restore changed hash: ${before.beforeHash} -> ${afterRestore.beforeHash}`);
  }

  const compile = await callTool(info, "compile_and_read_log", target);

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    health: {
      connectedClients: health.connectedClients,
      pages: (health.pages || []).map((page) => ({
        projectTitle: page.projectTitle,
        fileName: page.fileName,
        editorMode: page.editorMode,
        contentScriptVersion: page.contentScriptVersion
      }))
    },
    context: {
      fileCount: context.fileCount,
      currentFile: context.currentFile,
      mainFileCandidates: context.mainFileCandidates,
      bibFileCandidates: context.bibFileCandidates
    },
    diagnostics: {
      diagnosticCount: diagnostics.diagnosticCount,
      visibleCount: (diagnostics.visibleDiagnostics || []).length
    },
    read: {
      textLength: before.textLength,
      beforeHash: before.beforeHash
    },
    noopReplace: {
      beforeHash: before.beforeHash,
      afterHash: noop.afterHash,
      verifiedUnchanged: after.beforeHash === before.beforeHash
    },
    noopPatch: {
      beforeHash: after.beforeHash,
      afterHash: patched.afterHash,
      verifiedUnchanged: afterPatch.beforeHash === before.beforeHash
    },
    noopRestore: {
      beforeHash: afterPatch.beforeHash,
      afterHash: restored.afterHash,
      verifiedUnchanged: afterRestore.beforeHash === before.beforeHash
    },
    compile: {
      errors: compile.compileSummary && compile.compileSummary.errors,
      warnings: compile.compileSummary && compile.compileSummary.warnings,
      pages: compile.compileSummary && compile.compileSummary.pages,
      statusText: String((compile.compileSummary && compile.compileSummary.statusText) || "").slice(0, 200)
    }
  }, null, 2));
}

function createNoopPatch(fileName, text) {
  const firstLine = String(text || "").replace(/\r\n/g, "\n").split("\n")[0] || "";
  return [
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    "@@ -1,1 +1,1 @@",
    `-${firstLine}`,
    `+${firstLine}`,
    ""
  ].join("\n");
}

async function callTool(info, name, args) {
  const response = await fetch(`${info.serverUrl}/tools/call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${info.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, arguments: args || {} })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed with ${response.status}: ${text}`);
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(`${name} failed: ${text}`);
  return json.result;
}

function readServerInfo() {
  if (!fs.existsSync(INFO_PATH)) {
    throw new Error(`Server info not found: ${INFO_PATH}. Start the bridge first.`);
  }
  return JSON.parse(fs.readFileSync(INFO_PATH, "utf8"));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
