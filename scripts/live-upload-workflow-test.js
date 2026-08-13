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

  const workflow = await callTool(info, "inspect_upload_workflow", {
    projectTitle: current.projectTitle
  });

  if (workflow.reloadRequired) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      uploadWorkflow: {
        reloadRequired: true,
        reason: workflow.reason || "",
        contentScriptVersion: workflow.contentScriptVersion || ""
      }
    }, null, 2));
    return;
  }

  if (workflow.nonMutating !== true) {
    throw new Error("inspect_upload_workflow must be non-mutating");
  }
  if (workflow.requiresUserFilePicker !== true) {
    throw new Error("inspect_upload_workflow must report user file picker requirement");
  }

  console.log(JSON.stringify({
    ok: true,
    current: summarizeCurrent(current),
    uploadWorkflow: {
      uploadControlCount: workflow.uploadControlCount,
      dropzoneCount: workflow.dropzoneCount,
      acceptValues: workflow.acceptValues || [],
      imageCandidateCount: workflow.imageCandidateCount,
      supportedLocalSelection: workflow.supportedLocalSelection,
      requiresUserFilePicker: workflow.requiresUserFilePicker,
      blockerCount: (workflow.blockers || []).length
    }
  }, null, 2));
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
