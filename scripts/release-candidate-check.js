#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  RECOMMENDED_DESCRIPTION,
  RECOMMENDED_TOPICS
} = require("./repository-metadata-check");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, ".runtime", "release-candidate");

const CHECKS = [
  "release_asset_manifest",
  "npm_package_dry_run",
  "repository_metadata",
  "install_paths",
  "human_decision_boundary",
  "no_publish_boundary"
];

const HUMAN_DECISIONS = [
  "Create a GitHub Release from the prepared local assets",
  "Choose whether and when to publish to npm",
  "Confirm repository visibility and package-name ownership",
  "Decide whether Chrome Web Store publication is in scope",
  "Confirm commercial support expectations before wider distribution"
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

  const summary = buildSummary();
  if (options.write) {
    fs.mkdirSync(options.outDir, { recursive: true });
    const outPath = path.join(options.outDir, "release-candidate-summary.json");
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    summary.outputPath = path.relative(ROOT, outPath).replace(/\\/g, "/");
    summary.safeToCommitGeneratedFiles = false;
  }

  printJson(summary);
  if (!summary.ok) process.exit(1);
}

function buildSummary() {
  const pkg = readJson("package.json");
  const version = pkg.version;
  const checks = [
    runCheck("release_asset_manifest", () => checkReleaseAssetManifest(version)),
    runCheck("npm_package_dry_run", () => checkNpmPackageDryRun(version)),
    runCheck("repository_metadata", checkRepositoryMetadata),
    runCheck("install_paths", checkInstallPaths),
    runCheck("human_decision_boundary", checkHumanDecisionBoundary),
    runCheck("no_publish_boundary", () => checkNoPublishBoundary(version))
  ];
  const failed = checks.filter((check) => check.status !== "pass");
  const releaseManifest = readReleaseManifest(version);
  const asset = releaseManifest && Array.isArray(releaseManifest.assets) ? releaseManifest.assets[0] : null;
  return {
    ok: failed.length === 0,
    version,
    releaseCandidate: failed.length === 0,
    checks,
    failed: failed.length,
    releaseDir: `dist/release-v${version}`,
    extensionAsset: asset ? {
      file: asset.file,
      sha256: asset.sha256,
      bytes: asset.bytes
    } : null,
    recommendedDescription: RECOMMENDED_DESCRIPTION,
    recommendedTopics: RECOMMENDED_TOPICS,
    installPaths: [
      "source-tree",
      "github-release-zip",
      "package-entrypoint"
    ],
    humanDecisionRequired: HUMAN_DECISIONS,
    safeToCommit: true,
    publishActionsPerformed: [],
    published: false
  };
}

function checkReleaseAssetManifest(version) {
  const manifest = readReleaseManifest(version);
  if (!manifest) throw new Error(`Missing release asset manifest for ${version}; run npm run release:assets first`);
  if (manifest.version !== version) throw new Error(`Release manifest version ${manifest.version} does not match package ${version}`);
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const zip = assets.find((asset) => asset.type === "chrome-extension-zip");
  if (!zip) throw new Error("Release manifest is missing chrome-extension-zip asset");
  const zipPath = path.join(ROOT, `dist/release-v${version}`, zip.file);
  if (!fs.existsSync(zipPath)) throw new Error(`Missing release zip asset: ${zip.file}`);
  if (!zip.sha256 || String(zip.sha256).length !== 64) throw new Error("Release zip asset is missing SHA-256");
  if (!Number.isFinite(Number(zip.bytes)) || Number(zip.bytes) <= 0) throw new Error("Release zip asset byte size is invalid");
  return {
    releaseDir: `dist/release-v${version}`,
    assetFile: zip.file,
    assetBytes: zip.bytes
  };
}

function checkNpmPackageDryRun(version) {
  const manifest = readReleaseManifest(version);
  const dryRun = manifest && manifest.npmPackageDryRun;
  if (!dryRun || dryRun.ok !== true) throw new Error("Release manifest is missing a successful npm package dry run");
  if (dryRun.version !== version) throw new Error(`npm dry-run version ${dryRun.version} does not match ${version}`);
  if (dryRun.forbiddenFiles !== 0) throw new Error(`npm dry run found ${dryRun.forbiddenFiles} forbidden file(s)`);
  return {
    fileCount: dryRun.fileCount,
    forbiddenFiles: dryRun.forbiddenFiles
  };
}

function checkRepositoryMetadata() {
  const result = runNodeJson("scripts/repository-metadata-check.js");
  if (!result.ok) throw new Error("Repository metadata check failed");
  if (result.published !== false) throw new Error("Repository metadata check must report published:false");
  if (!Array.isArray(result.publishActionsPerformed) || result.publishActionsPerformed.length !== 0) {
    throw new Error("Repository metadata check must not perform publish actions");
  }
  return {
    metadataChecks: Array.isArray(result.checks) ? result.checks.length : 0,
    recommendedTopics: Array.isArray(result.recommendedTopics) ? result.recommendedTopics.length : 0
  };
}

function checkInstallPaths() {
  const installation = readText("docs/INSTALLATION.md");
  for (const phrase of [
    "Source Tree Install",
    "GitHub Release Zip Install",
    "Package Entrypoint",
    "Safety Boundaries"
  ]) {
    if (!installation.includes(phrase)) throw new Error(`docs/INSTALLATION.md is missing ${phrase}`);
  }
  const readme = readText("README.md");
  for (const command of ["npm run first-run", "npm run live:verify", "npm run release:preflight"]) {
    if (!readme.includes(command)) throw new Error(`README.md is missing ${command}`);
  }
  return { installPaths: 3 };
}

function checkHumanDecisionBoundary() {
  const publishing = readText("docs/PUBLISHING.md");
  for (const phrase of [
    "does not call the GitHub API",
    "Do not publish to npm",
    "repository visibility"
  ]) {
    if (!publishing.includes(phrase)) throw new Error(`docs/PUBLISHING.md is missing human boundary phrase: ${phrase}`);
  }
  return { humanDecisionRequired: HUMAN_DECISIONS.length };
}

function checkNoPublishBoundary(version) {
  const manifest = readReleaseManifest(version);
  const publishActions = manifest && Array.isArray(manifest.publishActionsPerformed) ? manifest.publishActionsPerformed : [];
  if (publishActions.length > 0) throw new Error(`Release manifest contains publish actions: ${publishActions.join(", ")}`);
  const packageText = readText("package.json");
  if (/npm\s+publish|gh\s+release\s+create|gh\s+repo\s+edit/i.test(packageText)) {
    throw new Error("package.json appears to contain a publishing command");
  }
  return {
    publishActionsPerformed: 0,
    published: false
  };
}

function runCheck(name, fn) {
  try {
    return { name, status: "pass", ...fn() };
  } catch (error) {
    return { name, status: "fail", message: sanitizeMessage(error.message || String(error)) };
  }
}

function readReleaseManifest(version) {
  const manifestPath = path.join(ROOT, "dist", `release-v${version}`, "release-assets-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function runNodeJson(relativeScript) {
  const { execFileSync } = require("child_process");
  const output = execFileSync(process.execPath, [path.join(ROOT, relativeScript)], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
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

function printHelp() {
  console.log(`Usage: node scripts/release-candidate-check.js [options]

Options:
  --list              Print the release-candidate check plan.
  --write             Write .runtime/release-candidate/release-candidate-summary.json.
  --out-dir <path>    Output directory for --write.
  --help, -h          Print this help.
`);
}

if (require.main === module) main();

module.exports = {
  CHECKS,
  HUMAN_DECISIONS,
  buildSummary,
  checkReleaseAssetManifest,
  checkNoPublishBoundary
};
