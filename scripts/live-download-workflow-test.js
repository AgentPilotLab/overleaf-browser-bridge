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

  const workflow = await callTool(info, "inspect_download_workflow", {
    projectTitle: current.projectTitle
  });

  if (workflow.reloadRequired) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      downloadWorkflow: {
        reloadRequired: true,
        reason: workflow.reason || "",
        contentScriptVersion: workflow.contentScriptVersion || ""
      }
    }, null, 2));
    return;
  }

  if (workflow.nonMutating !== true) {
    throw new Error("inspect_download_workflow must be non-mutating");
  }
  if (workflow.requiresUserConfirmation !== true) {
    throw new Error("inspect_download_workflow must require user confirmation");
  }
  if (workflow.supportedDirectDownload !== false) {
    throw new Error("inspect_download_workflow must not claim direct download support");
  }

  console.log(JSON.stringify({
    ok: true,
    current: summarizeCurrent(current),
    downloadWorkflow: {
      downloadControlCount: workflow.downloadControlCount,
      downloadCandidateCount: workflow.downloadCandidateCount,
      downloadTypes: uniqueTypes(workflow.downloadControls || [], workflow.downloadCandidates || []),
      supportedDirectDownload: workflow.supportedDirectDownload,
      requiresUserConfirmation: workflow.requiresUserConfirmation,
      blockerCount: (workflow.blockers || []).length
    }
  }, null, 2));
}

function uniqueTypes(controls, candidates) {
  return Array.from(new Set(controls.concat(candidates).map((item) => item.downloadType).filter(Boolean))).sort();
}

function summarizeCurrent(current) {
  return {
    projectTitle: current.projectTitle,
    fileName: current.fileName || "",
    editorMode: current.editorMode || ""
  };
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
