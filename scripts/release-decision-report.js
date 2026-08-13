#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  HUMAN_DECISIONS,
  buildSummary: buildCandidateSummary
} = require("./release-candidate-check");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, ".runtime", "release-decision");

const CHECKS = [
  "release_candidate",
  "release_artifacts",
  "distribution_targets",
  "human_decision_packet",
  "no_publish_boundary"
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.list) {
    printJson({
      ok: true,
      checks: CHECKS.map((name) => ({ name })),
      publishActionsPerformed: [],
      published: false
    });
    return;
  }

  const report = buildDecisionReport();
  if (options.write) {
    fs.mkdirSync(options.outDir, { recursive: true });
    const markdownPath = path.join(options.outDir, "release-decision-report.md");
    const jsonPath = path.join(options.outDir, "release-decision-report.json");
    fs.writeFileSync(markdownPath, `${report.markdown}\n`, "utf8");
    report.outputPath = path.relative(ROOT, markdownPath).replace(/\\/g, "/");
    report.jsonOutputPath = path.relative(ROOT, jsonPath).replace(/\\/g, "/");
    report.safeToCommitGeneratedFiles = false;
    fs.writeFileSync(jsonPath, `${JSON.stringify(withoutMarkdown(report), null, 2)}\n`, "utf8");
  }

  if (!options.includeMarkdown) delete report.markdown;
  printJson(report);
  if (!report.ok) process.exit(1);
}

function buildDecisionReport() {
  const candidate = buildCandidateSummary();
  const version = candidate.version;
  const releaseDir = candidate.releaseDir || `dist/release-v${version}`;
  const artifact = candidate.extensionAsset || {};
  const checks = [
    runCheck("release_candidate", () => checkReleaseCandidate(candidate)),
    runCheck("release_artifacts", () => checkReleaseArtifacts(candidate)),
    runCheck("distribution_targets", () => checkDistributionTargets(candidate)),
    runCheck("human_decision_packet", () => checkHumanDecisionPacket(candidate)),
    runCheck("no_publish_boundary", () => checkNoPublishBoundary(candidate))
  ];
  const failed = checks.filter((check) => check.status !== "pass");
  const decisions = buildDecisionItems(candidate);
  const markdown = renderMarkdown({
    version,
    releaseDir,
    artifact,
    candidate,
    checks,
    decisions
  });
  return {
    ok: failed.length === 0,
    version,
    readyForHumanReleaseDecision: failed.length === 0,
    releaseDir,
    extensionAsset: artifact.file ? artifact : null,
    checks,
    failed: failed.length,
    decisions,
    recommendedDescription: candidate.recommendedDescription,
    recommendedTopics: candidate.recommendedTopics || [],
    installPaths: candidate.installPaths || [],
    humanDecisionRequired: candidate.humanDecisionRequired || HUMAN_DECISIONS,
    markdown,
    safeToCommit: true,
    publishActionsPerformed: [],
    published: false
  };
}

function checkReleaseCandidate(candidate) {
  if (!candidate.ok || !candidate.releaseCandidate) {
    throw new Error("release candidate is not ready; run npm run release:preflight and inspect failures");
  }
  return {
    failed: candidate.failed,
    checkCount: Array.isArray(candidate.checks) ? candidate.checks.length : 0
  };
}

function checkReleaseArtifacts(candidate) {
  const asset = candidate.extensionAsset;
  if (!asset || !asset.file) throw new Error("missing extension release asset");
  if (!asset.sha256 || String(asset.sha256).length !== 64) throw new Error("extension asset is missing SHA-256");
  if (!Number.isFinite(Number(asset.bytes)) || Number(asset.bytes) <= 0) throw new Error("extension asset byte size is invalid");
  return {
    file: asset.file,
    sha256: asset.sha256,
    bytes: asset.bytes
  };
}

function checkDistributionTargets(candidate) {
  const installPaths = Array.isArray(candidate.installPaths) ? candidate.installPaths : [];
  for (const required of ["source-tree", "github-release-zip", "package-entrypoint"]) {
    if (!installPaths.includes(required)) throw new Error(`missing install path: ${required}`);
  }
  return { installPaths: installPaths.length };
}

function checkHumanDecisionPacket(candidate) {
  const decisions = Array.isArray(candidate.humanDecisionRequired) ? candidate.humanDecisionRequired : [];
  for (const decision of HUMAN_DECISIONS) {
    if (!decisions.includes(decision)) throw new Error(`missing human decision: ${decision}`);
  }
  return { humanDecisionRequired: decisions.length };
}

function checkNoPublishBoundary(candidate) {
  if (candidate.published !== false) throw new Error("candidate must report published:false");
  const actions = Array.isArray(candidate.publishActionsPerformed) ? candidate.publishActionsPerformed : [];
  if (actions.length > 0) throw new Error(`publish actions were performed: ${actions.join(", ")}`);
  return {
    publishActionsPerformed: 0,
    published: false
  };
}

function buildDecisionItems(candidate) {
  const topics = Array.isArray(candidate.recommendedTopics) ? candidate.recommendedTopics : [];
  return [
    {
      id: "github_release",
      label: "Create GitHub Release",
      status: "human_decision",
      recommendedNextAction: "Upload the prepared extension zip and release notes only after confirming repository visibility.",
      evidence: candidate.extensionAsset ? `${candidate.extensionAsset.file} SHA-256 ${candidate.extensionAsset.sha256}` : "missing asset"
    },
    {
      id: "npm_publish",
      label: "Publish npm package",
      status: "human_decision",
      recommendedNextAction: "Confirm package-name ownership, support burden, and license wording before any npm publish.",
      evidence: "package dry run is checked by release:candidate and release:preflight"
    },
    {
      id: "chrome_web_store",
      label: "Submit Chrome Web Store listing",
      status: "human_decision",
      recommendedNextAction: "Prepare store screenshots, privacy policy wording, and permission review before any submission.",
      evidence: "current release target remains local unpacked or GitHub Release zip install"
    },
    {
      id: "repository_metadata",
      label: "Apply repository description and topics",
      status: "human_decision",
      recommendedNextAction: "Use the recommended description and topics if the repository is ready for wider discovery.",
      evidence: `${topics.length} recommended topics available`
    }
  ];
}

function renderMarkdown(context) {
  const { version, releaseDir, artifact, candidate, checks, decisions } = context;
  const lines = [
    `# overleaf-browser-bridge ${version} Release Decision Packet`,
    "",
    "This packet is generated locally for a human release decision. It does not create a GitHub Release, publish to npm, submit to the Chrome Web Store, or change repository visibility.",
    "",
    "## Status",
    "",
    `- Release candidate: ${candidate.ok && candidate.releaseCandidate ? "ready" : "not ready"}`,
    `- Release directory: \`${releaseDir}\``,
    `- Published: ${candidate.published === false ? "false" : "unknown"}`,
    `- Publish actions performed: ${(candidate.publishActionsPerformed || []).length}`,
    "",
    "## Prepared Asset",
    "",
    artifact && artifact.file
      ? `- Extension zip: \`${artifact.file}\``
      : "- Extension zip: missing",
    artifact && artifact.sha256
      ? `- SHA-256: \`${artifact.sha256}\``
      : "- SHA-256: missing",
    artifact && artifact.bytes
      ? `- Bytes: ${artifact.bytes}`
      : "- Bytes: missing",
    "",
    "## Recommended Repository Metadata",
    "",
    `- Description: ${candidate.recommendedDescription || ""}`,
    `- Topics: ${(candidate.recommendedTopics || []).join(", ")}`,
    "",
    "## Decision Checklist",
    "",
    ...decisions.map((decision) => `- [ ] ${decision.label}: ${decision.recommendedNextAction} Evidence: ${decision.evidence}.`),
    "",
    "## Gate Summary",
    "",
    ...checks.map((check) => `- ${check.status === "pass" ? "PASS" : "FAIL"} ${check.name}${check.message ? `: ${check.message}` : ""}`),
    "",
    "## Safety Boundary",
    "",
    "- This report is local review material only.",
    "- Keep `.runtime/release-decision/` ignored and out of commits.",
    "- Do not run publishing commands until the human decision checklist is explicitly approved."
  ];
  return lines.join("\n");
}

function runCheck(name, fn) {
  try {
    return { name, status: "pass", ...fn() };
  } catch (error) {
    return { name, status: "fail", message: sanitizeMessage(error.message || String(error)) };
  }
}

function parseArgs(argv) {
  const options = { outDir: DEFAULT_OUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--list") {
      options.list = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--include-markdown") {
      options.includeMarkdown = true;
    } else if (arg === "--out-dir") {
      options.outDir = path.resolve(takeValue(argv, ++index, arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function withoutMarkdown(report) {
  const copy = { ...report };
  delete copy.markdown;
  return copy;
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

function printHelp() {
  console.log(`Usage: node scripts/release-decision-report.js [options]

Options:
  --list                Print the release-decision check plan.
  --write               Write ignored .runtime/release-decision report files.
  --include-markdown    Include the Markdown report in JSON stdout.
  --out-dir <path>      Output directory for --write.
  --help, -h            Print this help.
`);
}

if (require.main === module) main();

module.exports = {
  CHECKS,
  buildDecisionReport,
  renderMarkdown
};
