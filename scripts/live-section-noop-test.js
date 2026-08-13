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

  const sections = await callTool(info, "get_sections", target);
  if (!sections.sectionCount) {
    throw new Error("get_sections did not find any LaTeX sections in the current file");
  }
  const first = sections.sections[0];
  const content = await callTool(info, "get_section_content", {
    ...target,
    sectionIndex: first.index
  });
  if (!content.beforeHash || typeof content.text !== "string") {
    throw new Error("get_section_content did not return text and beforeHash");
  }

  const replaced = await callTool(info, "replace_section", {
    ...target,
    beforeHash: content.beforeHash,
    reason: "section no-op write channel verification",
    sectionIndex: first.index,
    text: content.text
  });

  const after = await callTool(info, "read_current_file", target);
  if (after.beforeHash !== content.beforeHash) {
    throw new Error(`no-op replace_section changed hash: ${content.beforeHash} -> ${after.beforeHash}`);
  }

  console.log(JSON.stringify({
    ok: true,
    current: {
      projectTitle: current.projectTitle,
      fileName: current.fileName,
      editorMode: current.editorMode
    },
    sections: {
      sectionCount: sections.sectionCount,
      firstSection: {
        index: first.index,
        command: first.command,
        title: first.title,
        path: first.path,
        lineStart: first.lineStart,
        lineEnd: first.lineEnd
      }
    },
    sectionContent: {
      beforeHash: content.beforeHash,
      textLength: content.text.length,
      includeHeading: content.includeHeading
    },
    noopReplaceSection: {
      beforeHash: content.beforeHash,
      afterHash: replaced.afterHash,
      verifiedUnchanged: after.beforeHash === content.beforeHash,
      preserveHeading: replaced.preserveHeading
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

