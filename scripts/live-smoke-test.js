#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");

async function main() {
  const info = readServerInfo();
  const health = await getJson(`${info.serverUrl}/health`);
  console.log("health:", JSON.stringify(health));
  if (!health.connectedClients) {
    console.log("No connected Overleaf page yet. Check that the extension is loaded, configured, and an Overleaf project tab is open.");
    process.exit(1);
  }

  const bridgeHealth = await callTool(info, "health_check", {});
  console.log("bridge health:", JSON.stringify(bridgeHealth.result, null, 2));

  const current = await callTool(info, "get_current_project", {});
  console.log("current project:", JSON.stringify(current.result, null, 2));

  const files = await callTool(info, "list_open_project_files", {
    projectTitle: current.result.projectTitle || undefined
  });
  const visibleFiles = Array.isArray(files.result.files) ? files.result.files : [];
  console.log("file tree:", JSON.stringify({
    projectTitle: files.result.projectTitle,
    currentFile: files.result.fileName,
    fileCount: visibleFiles.length,
    selectedFile: visibleFiles.find((file) => file.selected) || null,
    mainFileCandidates: visibleFiles
      .map((file) => file.path || file.fileName || "")
      .filter((name) => /(^|\/|\\)(main|paper|manuscript|article)\.tex$/i.test(name)),
    bibFileCandidates: visibleFiles
      .map((file) => file.path || file.fileName || "")
      .filter((name) => /\.bib$/i.test(name))
  }, null, 2));
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
  return JSON.parse(text);
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed: ${text}`);
  return JSON.parse(text);
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
