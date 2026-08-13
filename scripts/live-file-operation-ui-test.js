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

  const inspected = await callTool(info, "inspect_file_operation_ui", {
    projectTitle: current.projectTitle
  });
  if (!Array.isArray(inspected.controls)) {
    throw new Error("inspect_file_operation_ui did not return a controls array");
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName || "",
      editorMode: current.editorMode
    },
    fileOperationUi: {
      controlCount: inspected.controlCount,
      operationTypes: Array.from(new Set((inspected.controls || []).map((item) => item.operation))).sort(),
      reloadRequired: Boolean(inspected.reloadRequired),
      reason: inspected.reason || "",
      contentScriptVersion: inspected.contentScriptVersion || ""
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
