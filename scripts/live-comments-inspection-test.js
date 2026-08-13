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

  const comments = await callTool(info, "inspect_visible_comments", {
    projectTitle: current.projectTitle
  });

  if (comments.reloadRequired) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      comments: {
        reloadRequired: true,
        reason: comments.reason || "",
        contentScriptVersion: comments.contentScriptVersion || ""
      }
    }, null, 2));
    return;
  }

  if (comments.nonMutating !== true) {
    throw new Error("inspect_visible_comments must be non-mutating");
  }
  if (comments.supportsWriteActions !== false) {
    throw new Error("inspect_visible_comments must not report comment write support");
  }

  console.log(JSON.stringify({
    ok: true,
    current: summarizeCurrent(current),
    comments: {
      threadCount: comments.threadCount,
      visibleThreadCount: Array.isArray(comments.threads)
        ? comments.threads.filter((thread) => thread.visible).length
        : 0,
      actionControlCount: comments.actionControlCount,
      supportsWriteActions: comments.supportsWriteActions,
      requiresUserConfirmation: comments.requiresUserConfirmation,
      blockerCount: (comments.blockers || []).length
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
