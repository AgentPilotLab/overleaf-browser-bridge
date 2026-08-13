#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");
const PROJECT_TITLE = process.env.OVERLEAF_BRIDGE_TEST_PROJECT || "Codex Free Sync Test 2026-07-02";
const EXPECTED_FILE = process.env.OVERLEAF_BRIDGE_TEST_FILE || "main.tex";

async function main() {
  const info = readServerInfo();
  const context = await callTool(info, "paper_context", { projectTitle: PROJECT_TITLE });
  const contextResult = context.result;
  if (!contextResult || contextResult.fileCount < 1) {
    throw new Error(`paper_context returned no files for ${PROJECT_TITLE}`);
  }
  if (!contextResult.files.some((file) => file.fileName === EXPECTED_FILE || file.path === EXPECTED_FILE)) {
    throw new Error(`paper_context did not include ${EXPECTED_FILE}`);
  }

  const namedRead = (await callTool(info, "read_file", {
    projectTitle: PROJECT_TITLE,
    fileName: EXPECTED_FILE,
    expectedFileName: EXPECTED_FILE
  })).result;
  if (!namedRead || namedRead.fileName !== EXPECTED_FILE || !namedRead.beforeHash) {
    throw new Error(`read_file did not return ${EXPECTED_FILE}`);
  }

  const sync = (await callTool(info, "sync_project_snapshot", {
    projectTitle: PROJECT_TITLE,
    includeExtensions: [".tex"]
  })).result;
  if (!sync || !sync.ok || !Array.isArray(sync.files) || !sync.files.some((file) => file.fileName === EXPECTED_FILE)) {
    throw new Error(`sync_project_snapshot did not save ${EXPECTED_FILE}`);
  }

  const before = (await callTool(info, "read_current_file", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE
  })).result;
  if (!before || before.fileName !== EXPECTED_FILE || !before.beforeHash) {
    throw new Error(`read_current_file did not return ${EXPECTED_FILE}`);
  }

  const marker = `% Bridge live gate ${new Date().toISOString()}`;
  const patch = createInsertAfterFirstLinePatch(EXPECTED_FILE, before.text || "", marker);
  const patched = (await callTool(info, "apply_patch_to_file", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE,
    beforeHash: before.beforeHash,
    reason: "live write/compile/restore gate",
    patch
  })).result;
  if (!patched || !patched.ok || !patched.snapshotPath || !patched.diffPath || !patched.afterHash) {
    throw new Error("apply_patch_to_file did not return snapshot metadata");
  }

  const afterPatch = (await callTool(info, "read_current_file", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE
  })).result;
  if (!String(afterPatch.text || "").includes(marker)) {
    throw new Error("patched marker was not visible in Overleaf after write");
  }

  const compile = (await callTool(info, "compile_and_read_log", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE
  })).result;

  const restored = (await callTool(info, "restore_from_snapshot", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE,
    beforeHash: afterPatch.beforeHash,
    reason: "restore live write gate marker",
    snapshotPath: patched.snapshotPath
  })).result;
  if (!restored || !restored.ok || !restored.afterHash) {
    throw new Error("restore_from_snapshot did not report success");
  }

  const afterRestore = (await callTool(info, "read_current_file", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE
  })).result;
  if (String(afterRestore.text || "").includes(marker)) {
    throw new Error("restore_from_snapshot left the live marker in the file");
  }
  if (afterRestore.beforeHash !== before.beforeHash) {
    throw new Error(`restore hash mismatch: expected ${before.beforeHash}, got ${afterRestore.beforeHash}`);
  }

  const restoreCompile = (await callTool(info, "compile_and_read_log", {
    projectTitle: PROJECT_TITLE,
    expectedFileName: EXPECTED_FILE
  })).result;

  console.log(JSON.stringify({
    ok: true,
    projectTitle: PROJECT_TITLE,
    fileName: EXPECTED_FILE,
    beforeHash: before.beforeHash,
    namedReadHash: namedRead.beforeHash,
    patchedHash: patched.afterHash,
    restoredHash: afterRestore.beforeHash,
    syncRoot: sync.root,
    snapshotPath: patched.snapshotPath,
    diffPath: patched.diffPath,
    compileSummary: compile.compileSummary || null,
    restoreCompileSummary: restoreCompile.compileSummary || null
  }, null, 2));
}

function createInsertAfterFirstLinePatch(fileName, text, marker) {
  const lines = splitLines(text);
  const context = lines.length ? lines.slice(0, Math.min(2, lines.length)) : [""];
  const oldCount = context.length;
  const newCount = oldCount + 1;
  const patch = [
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    `@@ -1,${oldCount} +1,${newCount} @@`
  ];
  patch.push(` ${context[0] || ""}`);
  patch.push(`+${marker}`);
  for (const line of context.slice(1)) patch.push(` ${line}`);
  return `${patch.join("\n")}\n`;
}

function splitLines(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

async function callTool(info, name, args) {
  const response = await fetch(`${info.serverUrl}/tools/call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${info.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, arguments: args })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${text}`);
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(`${name} failed: ${text}`);
  return json;
}

function readServerInfo() {
  if (!fs.existsSync(INFO_PATH)) {
    throw new Error(`Server info not found: ${INFO_PATH}. Start the bridge first.`);
  }
  return JSON.parse(fs.readFileSync(INFO_PATH, "utf8"));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
