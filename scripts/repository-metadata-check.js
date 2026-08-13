#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SUPPORT_URL = "https://buymeacoffee.com/mira.ai";
const RECOMMENDED_DESCRIPTION = "AI-agent Overleaf browser bridge for Codex, Claude, MCP, safe LaTeX edits, local mirrors, and free workflows without Premium Git sync.";
const RECOMMENDED_TOPICS = [
  "overleaf",
  "mcp",
  "model-context-protocol",
  "codex",
  "claude",
  "ai-agent",
  "chrome-extension",
  "latex",
  "browser-bridge",
  "local-first",
  "overleaf-mcp",
  "research-writing"
];

const CHECKS = [
  "package_metadata",
  "readme_ai_discovery",
  "ai_entry_points",
  "license_and_support",
  "agent_guidance_boundary",
  "privacy_metadata_boundary",
  "no_publish_boundary"
];

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--list")) {
    printJson({
      ok: true,
      checks: CHECKS.map((name) => ({ name })),
      recommendedDescription: RECOMMENDED_DESCRIPTION,
      recommendedTopics: RECOMMENDED_TOPICS,
      safeToCommit: true,
      publishActionsPerformed: [],
      published: false
    });
    return;
  }

  const results = [
    runCheck("package_metadata", checkPackageMetadata),
    runCheck("readme_ai_discovery", checkReadmeAiDiscovery),
    runCheck("ai_entry_points", checkAiEntryPoints),
    runCheck("license_and_support", checkLicenseAndSupport),
    runCheck("agent_guidance_boundary", checkAgentGuidanceBoundary),
    runCheck("privacy_metadata_boundary", checkPrivacyMetadataBoundary),
    runCheck("no_publish_boundary", checkNoPublishBoundary)
  ];

  const failed = results.filter((check) => check.status !== "pass");
  const summary = {
    ok: failed.length === 0,
    version: readJson("package.json").version,
    checks: results,
    failed: failed.length,
    recommendedDescription: RECOMMENDED_DESCRIPTION,
    recommendedTopics: RECOMMENDED_TOPICS,
    safeToCommit: true,
    publishActionsPerformed: [],
    published: false
  };

  printJson(summary);
  if (failed.length > 0) process.exit(1);
}

function runCheck(name, fn) {
  try {
    return {
      name,
      status: "pass",
      ...fn()
    };
  } catch (error) {
    return {
      name,
      status: "fail",
      message: sanitizeMessage(error.message || String(error))
    };
  }
}

function checkPackageMetadata() {
  const pkg = readJson("package.json");
  const description = String(pkg.description || "");
  const keywords = new Set(Array.isArray(pkg.keywords) ? pkg.keywords : []);
  const requiredKeywords = [
    "overleaf",
    "codex",
    "claude",
    "mcp",
    "model-context-protocol",
    "ai-agent",
    "chrome-extension",
    "latex",
    "browser-bridge",
    "local-first"
  ];

  requireIncludes(description, ["AI-agent", "Overleaf", "Codex", "Claude", "Premium Git sync"], "package.json description");
  for (const keyword of requiredKeywords) {
    if (!keywords.has(keyword)) throw new Error(`package.json keywords is missing ${keyword}`);
  }
  if (pkg.license !== "SEE LICENSE IN LICENSE") throw new Error("package.json license must be SEE LICENSE IN LICENSE");
  if (!String(pkg.repository && pkg.repository.url || "").includes("AgentPilotLab/overleaf-browser-bridge")) {
    throw new Error("package.json repository must point to AgentPilotLab/overleaf-browser-bridge");
  }
  if (!String(pkg.homepage || "").includes("AgentPilotLab/overleaf-browser-bridge#readme")) {
    throw new Error("package.json homepage should point to the repository README");
  }

  return {
    keywordCount: keywords.size,
    descriptionLength: description.length
  };
}

function checkReadmeAiDiscovery() {
  const readme = readText("README.md");
  const firstScreen = readme.split(/\r?\n/).slice(0, 200).join("\n");
  requireIncludes(firstScreen, [
    "Codex",
    "Claude",
    "MCP-capable AI agent",
    "Overleaf",
    "Overleaf Premium Git sync",
    "Chrome Extension",
    "local MCP bridge",
    "Agent Use Cases",
    "Quick Start",
    "release:preflight"
  ], "README first 200 lines");

  for (const heading of [
    "## Codex Setup",
    "## Claude Code Setup",
    "## MCP Tool Surface",
    "## License",
    "## AI Entry Points",
    "## Support"
  ]) {
    if (!readme.includes(heading)) throw new Error(`README is missing ${heading}`);
  }
  if (!readme.includes(SUPPORT_URL)) throw new Error("README is missing support URL");

  return { firstScreenLines: 200 };
}

function checkAiEntryPoints() {
  const requiredFiles = [
    "AGENTS.md",
    "llms.txt",
    "docs/AI_AGENT_GUIDE.md",
    "docs/AGENT_PROMPTS.md",
    "docs/USAGE.md",
    "docs/PUBLISHING.md"
  ];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`Missing AI entry point: ${file}`);
  }

  const llms = readText("llms.txt");
  requireIncludes(llms, [
    "Agent Start Here",
    "Core Implementation",
    "Paper Workspace Tools",
    "Release preflight",
    "execute_mirror_sync_plan"
  ], "llms.txt");

  const guide = readText("docs/AI_AGENT_GUIDE.md");
  requireIncludes(guide, [
    "Codex",
    "Claude",
    "MCP",
    "release:preflight",
    "AI agent"
  ], "docs/AI_AGENT_GUIDE.md");

  return { entryPoints: requiredFiles.length };
}

function checkLicenseAndSupport() {
  const license = readText("LICENSE");
  const readme = readText("README.md");
  const supportDoc = readText("docs/SUPPORT_SETUP.md");
  if (!license.includes("AgentPilotLab Non-Commercial License")) {
    throw new Error("LICENSE is missing AgentPilotLab Non-Commercial License");
  }
  requireIncludes(readme, [
    "non-commercial",
    "Commercial use requires",
    SUPPORT_URL,
    "docs/assets/buy-me-a-coffee-qr.jpg"
  ], "README license/support sections");
  requireIncludes(supportDoc, [SUPPORT_URL, "AI tools"], "docs/SUPPORT_SETUP.md");
  if (!fs.existsSync(path.join(ROOT, "docs/assets/buy-me-a-coffee-qr.jpg"))) {
    throw new Error("Missing Buy Me a Coffee QR asset");
  }
  return { supportUrl: SUPPORT_URL };
}

function checkAgentGuidanceBoundary() {
  const agents = readText("AGENTS.md");
  const requiredSections = [
    "What This Repository Does",
    "Non-Negotiable Safety Rules",
    "Main Entrypoints",
    "Expected Agent Workflow",
    "AI Discovery Files",
    "Support Disclosure"
  ];
  requireIncludes(agents, [
    "# Agent Instructions",
    "This repository is designed for AI agents first",
    ...requiredSections.map((section) => `## ${section}`)
  ], "AGENTS.md");

  const topLevelSections = Array.from(agents.matchAll(/^##\s+(.+?)\s*$/gm), (match) => match[1]);
  const unexpectedSections = topLevelSections.filter((section) => !requiredSections.includes(section));
  if (unexpectedSections.length > 0) {
    throw new Error(`AGENTS.md contains unexpected top-level sections: ${unexpectedSections.join(", ")}`);
  }
  return { toolSpecificGuidance: true, topLevelSections: topLevelSections.length };
}

function checkPrivacyMetadataBoundary() {
  const files = [
    "README.md",
    "AGENTS.md",
    "llms.txt",
    "docs/AI_AGENT_GUIDE.md",
    "docs/PUBLISHING.md",
    "docs/SUPPORT_SETUP.md",
    "package.json"
  ];
  const patterns = [
    { name: "Windows user path", pattern: /C:\\Users\\/i },
    { name: "macOS user path", pattern: new RegExp(`/${"Users"}/`, "i") },
    { name: "Linux home path", pattern: new RegExp(`/${"home"}/`, "i") },
    { name: "GitHub token", pattern: /\bgh[opsu]_[A-Za-z0-9_]{20,}/i },
    { name: "Overleaf session", pattern: /\boverleaf_session|session2\s*[:=]/i }
  ];
  const hits = [];
  for (const file of files) {
    const text = readText(file);
    for (const privacy of patterns) {
      if (privacy.pattern.test(text)) hits.push(`${file}: ${privacy.name}`);
    }
  }
  if (hits.length > 0) throw new Error(`Metadata privacy boundary failed: ${hits.join("; ")}`);
  return { scannedFiles: files.length, hits: 0 };
}

function checkNoPublishBoundary() {
  const releasePreflight = readText("scripts/release-preflight.js");
  const packageJson = readText("package.json");
  requireIncludes(releasePreflight, [
    "publishActionsPerformed: []",
    "published: false",
    "checkNoPublishBoundary"
  ], "scripts/release-preflight.js");
  if (/npm\s+publish|gh\s+release\s+create|gh\s+repo\s+edit/i.test(packageJson)) {
    throw new Error("package.json appears to contain a publishing command");
  }
  return {
    publishActionsPerformed: 0,
    published: false
  };
}

function requireIncludes(text, needles, label) {
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${label} is missing ${needle}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function sanitizeMessage(message) {
  return String(message || "")
    .replace(new RegExp(escapeRegExp(ROOT), "gi"), "<REPO_ROOT>")
    .replace(/C:\\Users\\[^\\\r\n]+/gi, "C:\\Users\\<USER>")
    .replace(new RegExp(`/${"Users"}/[^/\\r\\n]+`, "gi"), `/${"Users"}/<USER>`)
    .replace(new RegExp(`/${"home"}/[^/\\r\\n]+`, "gi"), `/${"home"}/<USER>`);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module) main();

module.exports = {
  CHECKS,
  RECOMMENDED_DESCRIPTION,
  RECOMMENDED_TOPICS,
  checkPackageMetadata,
  checkReadmeAiDiscovery,
  checkNoPublishBoundary
};
