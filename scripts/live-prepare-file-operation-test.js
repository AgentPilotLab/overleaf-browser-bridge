#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");

async function main() {
  const info = readServerInfo();
  const current = await callTool(info, "get_current_project", {});
  if (!current.projectTitle) {
    throw new Error("get_current_project did not return a project title");
  }

  const planned = await callTool(info, "prepare_file_operation", {
    projectTitle: current.projectTitle,
    operation: "create",
    fileName: "__bridge_plan_probe__.tex",
    reason: "non-mutating live confirmation-plan gate"
  });
  if (!planned.confirmationToken || !planned.confirmationPhrase) {
    throw new Error("prepare_file_operation did not return a confirmation plan");
  }
  if (planned.nonMutating !== true) {
    throw new Error("prepare_file_operation must report nonMutating=true");
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName || "",
      editorMode: current.editorMode
    },
    plan: {
      operation: planned.operation,
      fileName: planned.fileName,
      readyToExecute: planned.readyToExecute,
      blockerCount: Array.isArray(planned.blockers) ? planned.blockers.length : 0,
      reloadRequired: Boolean(planned.ui && planned.ui.reloadRequired),
      contentScriptVersion: planned.ui ? planned.ui.contentScriptVersion || "" : "",
      confirmationPhrase: planned.confirmationPhrase,
      fileListHash: planned.fileListHash,
      visibleFileCount: planned.visibleFileCount,
      nonMutating: planned.nonMutating
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
