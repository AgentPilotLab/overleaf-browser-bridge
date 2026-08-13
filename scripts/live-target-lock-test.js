#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");
const TEST_ALIAS = "live-target-lock";

async function main() {
  const info = readServerInfo();
  const current = await callTool(info, "get_current_project", {});
  if (!current.projectTitle || !current.fileName) {
    throw new Error("get_current_project did not return a project title and file name");
  }

  await callTool(info, "set_project_alias", {
    alias: TEST_ALIAS,
    projectTitle: current.projectTitle
  });

  const lock = await callTool(info, "lock_target_project", { projectAlias: TEST_ALIAS });
  if (!lock.lock || !lock.lock.targetLockId) {
    throw new Error("lock_target_project did not return targetLockId");
  }

  const locks = await callTool(info, "list_target_locks", {});
  if (!Array.isArray(locks.locks) || !locks.locks.some((item) => item.targetLockId === lock.lock.targetLockId)) {
    throw new Error("list_target_locks did not include the new lock");
  }

  const lockedRead = await callTool(info, "read_current_file", {
    targetLockId: lock.lock.targetLockId,
    expectedFileName: current.fileName,
    contextBudget: "summary",
    maxChars: 120
  });
  if (!lockedRead.beforeHash || lockedRead.text !== undefined) {
    throw new Error("locked summary read did not return expected metadata-only payload");
  }

  await callTool(info, "unlock_target_project", { targetLockId: lock.lock.targetLockId });
  await callTool(info, "clear_project_alias", { alias: TEST_ALIAS });

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    lock: {
      targetLockId: lock.lock.targetLockId,
      clientId: lock.lock.clientId,
      projectTitle: lock.lock.projectTitle,
      fileName: lock.lock.fileName
    },
    lockedRead: {
      beforeHash: lockedRead.beforeHash,
      textLength: lockedRead.textLength,
      previewLength: String(lockedRead.preview || "").length
    }
  }, null, 2));
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
