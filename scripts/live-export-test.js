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

  const file = await callTool(info, "export_current_file", {
    projectTitle: current.projectTitle,
    expectedFileName: current.fileName
  });
  if (!file.exportPath || !fs.existsSync(file.exportPath)) {
    throw new Error("export_current_file did not write an export file");
  }

  const log = await callTool(info, "export_compile_log", {
    projectTitle: current.projectTitle
  });
  if (!log.exportPath || !fs.existsSync(log.exportPath)) {
    throw new Error("export_compile_log did not write an export file");
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    sourceExport: {
      fileName: file.fileName,
      beforeHash: file.beforeHash,
      textLength: file.textLength,
      exportPath: file.exportPath,
      manifestPath: file.manifestPath
    },
    compileLogExport: {
      fileName: log.fileName,
      errors: log.compileSummary ? log.compileSummary.errors : null,
      warnings: log.compileSummary ? log.compileSummary.warnings : null,
      pages: log.compileSummary ? log.compileSummary.pages : null,
      exportPath: log.exportPath,
      manifestPath: log.manifestPath
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
