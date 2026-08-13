#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT, ".runtime", "server-info.json");

async function main() {
  const [toolName, jsonArgs] = process.argv.slice(2);
  if (!toolName) {
    console.error("Usage: node scripts/call-tool.js <toolName> [jsonArguments|@file|-]");
    process.exit(2);
  }
  const info = readServerInfo();
  const args = await readToolArguments(jsonArgs);
  const response = await fetch(`${info.serverUrl}/tools/call`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${info.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: toolName, arguments: args })
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(JSON.stringify(JSON.parse(text), null, 2));
}

function readServerInfo() {
  if (!fs.existsSync(INFO_PATH)) {
    throw new Error(`Server info not found: ${INFO_PATH}. Start the bridge first.`);
  }
  return JSON.parse(fs.readFileSync(INFO_PATH, "utf8"));
}

function readToolArguments(source) {
  if (!source) return {};
  if (source === "-") return readStdinJson();
  if (source.startsWith("@")) {
    const filePath = path.resolve(process.cwd(), source.slice(1));
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return JSON.parse(source);
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
