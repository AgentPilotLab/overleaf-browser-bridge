#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const REQUIRED_EXTENSION_FILES = [
  "manifest.json",
  "background.js",
  "contentScript.js",
  "pageBridge.js",
  "popup.html",
  "popup.js"
];

function main() {
  const pkg = readJson("package.json");
  const manifest = readJson("extension/manifest.json");
  if (pkg.version !== manifest.version) {
    throw new Error(`package.json version ${pkg.version} does not match extension version ${manifest.version}`);
  }

  const version = pkg.version;
  const releaseDir = path.join(DIST_DIR, `release-v${version}`);
  fs.mkdirSync(releaseDir, { recursive: true });

  runPowerShell(["-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "package-extension.ps1")]);
  const npmDryRun = JSON.parse(runNodeScript("scripts/package-npm-check.js"));

  const extensionZip = path.join(DIST_DIR, `overleaf-browser-bridge-v${version}.zip`);
  if (!fs.existsSync(extensionZip)) {
    throw new Error(`Missing extension zip: ${path.relative(ROOT, extensionZip)}`);
  }
  verifyExtensionZip(extensionZip);

  const releaseZip = path.join(releaseDir, path.basename(extensionZip));
  fs.copyFileSync(extensionZip, releaseZip);
  const zipHash = sha256(releaseZip);
  const zipBytes = fs.statSync(releaseZip).size;

  const assetManifest = {
    name: pkg.name,
    version,
    repository: "AgentPilotLab/overleaf-browser-bridge",
    publishActionsPerformed: [],
    assets: [
      {
        type: "chrome-extension-zip",
        file: path.basename(releaseZip),
        sha256: zipHash,
        bytes: zipBytes,
        requiredFiles: REQUIRED_EXTENSION_FILES
      }
    ],
    npmPackageDryRun: npmDryRun,
    checks: [
      "Chrome extension zip contains only the whitelisted extension files",
      "npm package dry run contains required files and no local/private files",
      "No GitHub release, npm publish, or repository visibility change was performed"
    ]
  };

  writeJson(path.join(releaseDir, "release-assets-manifest.json"), assetManifest);
  fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), `${zipHash}  ${path.basename(releaseZip)}\n`, "utf8");
  fs.writeFileSync(path.join(releaseDir, "RELEASE_NOTES.md"), buildReleaseNotes(pkg.name, version, assetManifest), "utf8");

  console.log(JSON.stringify({
    ok: true,
    version,
    releaseDir: path.relative(ROOT, releaseDir).replace(/\\/g, "/"),
    extensionZip: path.relative(ROOT, releaseZip).replace(/\\/g, "/"),
    extensionZipSha256: zipHash,
    extensionZipBytes: zipBytes,
    npmPackageDryRun: npmDryRun,
    published: false
  }, null, 2));
}

function runNodeScript(relativePath) {
  return execFileSync(process.execPath, [path.join(ROOT, relativePath)], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runPowerShell(args) {
  const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function verifyExtensionZip(zipPath) {
  const output = execFileSync("tar", ["-tf", zipPath], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const entries = output
    .split(/\r?\n/)
    .map((entry) => entry.trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .map((entry) => path.posix.basename(entry))
    .sort();
  const expected = [...REQUIRED_EXTENSION_FILES].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error(`Extension zip contents differ from whitelist. Expected ${expected.join(", ")}, got ${entries.join(", ")}`);
  }
}

function buildReleaseNotes(name, version, manifest) {
  const zip = manifest.assets[0];
  return [
    `# ${name} ${version}`,
    "",
    "This release asset set is prepared locally for a GitHub Release. It does not publish to npm, create a GitHub Release, or change repository visibility.",
    "",
    "## Assets",
    "",
    `- ${zip.file}`,
    `- SHA-256: ${zip.sha256}`,
    `- Size: ${zip.bytes} bytes`,
    "",
    "## Verification",
    "",
    "- Chrome extension zip whitelist passed.",
    `- npm package dry run passed with ${manifest.npmPackageDryRun.fileCount} files and ${manifest.npmPackageDryRun.forbiddenFiles} forbidden files.`,
    "- Private/local files are excluded from the npm dry-run package check.",
    "",
    "## Install",
    "",
    "Download the zip, extract it locally, then load the extracted extension folder from `chrome://extensions` with Developer Mode enabled.",
    ""
  ].join("\n");
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

main();
