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

  const sync = await callTool(info, "sync_project_snapshot", {
    projectTitle: current.projectTitle
  });
  if (!sync.root || !sync.manifestPath || !Array.isArray(sync.files) || sync.files.length === 0) {
    throw new Error("sync_project_snapshot did not return mirror root, manifest, and files");
  }
  if (!fs.existsSync(sync.manifestPath)) throw new Error(`manifest was not written: ${sync.manifestPath}`);

  const find = await callTool(info, "find_in_project_mirror", {
    mirrorRoot: sync.root,
    fileName: current.fileName,
    maxMatches: 5,
    maxChars: 0
  });
  if (!find.matches || find.matches.length === 0) {
    throw new Error("find_in_project_mirror did not find the current file");
  }

  const diff = await callTool(info, "preview_mirror_diff", {
    projectTitle: current.projectTitle,
    mirrorRoot: sync.root,
    maxDiffLines: 20
  });
  if (!Array.isArray(diff.files) || diff.changedFileCount !== 0) {
    throw new Error("preview_mirror_diff should report no changed files immediately after sync");
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    mirror: {
      root: sync.root,
      manifestPath: sync.manifestPath,
      fileCount: sync.files.length,
      sectionIndexedFileCount: sync.files.filter((file) => Number(file.sectionCount || 0) > 0).length
    },
    find: {
      matchCount: find.matchCount,
      firstMatch: find.matches[0] ? {
        type: find.matches[0].type,
        path: find.matches[0].path,
        hash: find.matches[0].hash,
        sectionCount: find.matches[0].sectionCount
      } : null
    },
    diff: {
      comparedFileCount: diff.comparedFileCount,
      changedFileCount: diff.changedFileCount,
      addedFileCount: diff.addedFileCount,
      removedFileCount: diff.removedFileCount
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
