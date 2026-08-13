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
      commentPlan: {
        reloadRequired: true,
        reason: comments.reason || "",
        contentScriptVersion: comments.contentScriptVersion || ""
      }
    }, null, 2));
    return;
  }

  const candidate = chooseCommentActionCandidate(comments.threads || []);
  if (!candidate) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      commentPlan: {
        visibleThreadCount: comments.threadCount || 0,
        actionControlCount: comments.actionControlCount || 0,
        planCreated: false,
        reason: "no visible comment thread with a supported action was detected"
      }
    }, null, 2));
    return;
  }

  const planned = await callTool(info, "prepare_comment_action", {
    projectTitle: current.projectTitle,
    action: candidate.action,
    threadIndex: candidate.threadIndex,
    reason: "live non-mutating comment action plan"
  });

  if (planned.nonMutating !== true) {
    throw new Error("prepare_comment_action must be non-mutating");
  }
  if (planned.supportsWriteActions !== false) {
    throw new Error("prepare_comment_action must not report write support");
  }
  if (!planned.threadListHash || planned.threadListHash.length !== 64) {
    throw new Error("prepare_comment_action did not return a threadListHash");
  }

  console.log(JSON.stringify({
    ok: true,
    current: summarizeCurrent(current),
    commentPlan: {
      action: planned.action,
      readyToExecute: planned.readyToExecute,
      visibleThreadCount: planned.visibleThreadCount,
      selectedThreadIndex: planned.selectedThread ? planned.selectedThread.threadIndex : null,
      selectedThreadResolved: planned.selectedThread ? planned.selectedThread.resolved : null,
      threadListHash: planned.threadListHash,
      confirmationPhrasePrefix: String(planned.confirmationPhrase || "").split(" ").slice(0, 4).join(" "),
      blockerCount: (planned.blockers || []).length,
      nonMutating: planned.nonMutating,
      supportsWriteActions: planned.supportsWriteActions
    }
  }, null, 2));
}

function chooseCommentActionCandidate(threads) {
  for (const [index, thread] of (threads || []).entries()) {
    const actions = new Set((thread.actions || []).map((action) => action.action).filter(Boolean));
    if (!thread.resolved && actions.has("resolve")) return { threadIndex: index, action: "resolve" };
    if (!thread.resolved && actions.has("reply")) return { threadIndex: index, action: "reply" };
    if (thread.resolved && actions.has("reopen")) return { threadIndex: index, action: "reopen" };
  }
  return null;
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
