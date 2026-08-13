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

  const listed = await callTool(info, "list_visible_artifacts", {
    projectTitle: current.projectTitle
  });
  const artifacts = Array.isArray(listed.artifacts) ? listed.artifacts : [];
  const firstDownloadableIndex = artifacts.findIndex((item) => item.url && !item.actionOnly);
  const selector = firstDownloadableIndex >= 0
    ? { artifactIndex: firstDownloadableIndex }
    : { artifactType: "pdf" };

  const exported = await callTool(info, "export_visible_artifact", {
    projectTitle: current.projectTitle,
    ...selector,
    maxBytes: 10 * 1024 * 1024
  });

  if (exported.reloadRequired) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      visibleArtifactExport: {
        reloadRequired: true,
        reason: exported.reason || listed.reason || "",
        contentScriptVersion: exported.contentScriptVersion || listed.contentScriptVersion || ""
      }
    }, null, 2));
    return;
  }

  if (!exported.ok) {
    console.log(JSON.stringify({
      ok: true,
      current: summarizeCurrent(current),
      visibleArtifactExport: {
        skipped: true,
        reason: exported.reason || "no visible downloadable artifact matched the selector",
        artifactCount: artifacts.length
      }
    }, null, 2));
    return;
  }

  if (!exported.exportPath || !fs.existsSync(exported.exportPath)) {
    throw new Error("export_visible_artifact did not write an artifact file");
  }
  if (!exported.manifestPath || !fs.existsSync(exported.manifestPath)) {
    throw new Error("export_visible_artifact did not write a manifest file");
  }

  console.log(JSON.stringify({
    ok: true,
    current: summarizeCurrent(current),
    visibleArtifactExport: {
      artifactType: exported.artifactType,
      fileName: exported.fileName,
      selectedIndex: exported.selectedIndex,
      mimeType: exported.mimeType,
      byteLength: exported.byteLength,
      hash: exported.hash,
      exportPath: exported.exportPath,
      manifestPath: exported.manifestPath
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
