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

  const full = await callTool(info, "read_current_file", target);
  if (!full.beforeHash || typeof full.text !== "string") {
    throw new Error("read_current_file did not return text and beforeHash");
  }

  const summary = await callTool(info, "read_current_file", {
    ...target,
    contextBudget: "summary",
    maxChars: 120
  });
  if (summary.text !== undefined) throw new Error("summary read should not return full text");

  const range = await callTool(info, "read_file_range", {
    ...target,
    startLine: 1,
    endLine: 5,
    maxChars: 500
  });
  if (!range.rangeHash || !range.returnedLineCount) {
    throw new Error("read_file_range did not return range metadata");
  }

  const since = await callTool(info, "read_file_since_hash", {
    ...target,
    sinceHash: full.beforeHash
  });
  if (since.changed !== false || since.diff !== "") {
    throw new Error("read_file_since_hash should report unchanged for the freshly cached hash");
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    fullRead: {
      beforeHash: full.beforeHash,
      textLength: full.textLength
    },
    summary: {
      beforeHash: summary.beforeHash,
      textLength: summary.textLength,
      lineCount: summary.lineCount,
      previewLength: String(summary.preview || "").length,
      previewTruncated: summary.previewTruncated
    },
    range: {
      startLine: range.startLine,
      endLine: range.endLine,
      returnedLineCount: range.returnedLineCount,
      returnedTextLength: range.returnedTextLength,
      rangeHash: range.rangeHash,
      truncated: range.truncated
    },
    sinceHash: {
      sinceHash: since.sinceHash,
      beforeHash: since.beforeHash,
      changed: since.changed,
      diffAvailable: since.diffAvailable,
      diffLength: String(since.diff || "").length
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

