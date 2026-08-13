#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXTENSION_DIR = path.join(ROOT, "extension");
const DEFAULT_BRIDGE_ORIGIN = "http://127.0.0.1:38475";
const EXTENSION_FILES = [
  "manifest.json",
  "background.js",
  "contentScript.js",
  "pageBridge.js",
  "popup.html",
  "popup.js"
];
const FORBIDDEN_PERMISSIONS = ["cookies", "history", "tabs", "webRequest"];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.overleafOrigin) {
    throw new Error("--overleaf-origin is required for a custom extension build");
  }

  const overleafOrigin = normalizeOrigin(options.overleafOrigin, "--overleaf-origin");
  const bridgeOrigin = normalizeOrigin(options.bridgeOrigin || DEFAULT_BRIDGE_ORIGIN, "--bridge-origin");
  const outDir = path.resolve(options.outDir || path.join(ROOT, ".runtime", "extension-builds", originSlug(overleafOrigin)));

  const summary = prepareExtensionBuild({ overleafOrigin, bridgeOrigin, outDir });
  console.log(JSON.stringify(summary, null, 2));
}

function prepareExtensionBuild({ overleafOrigin, bridgeOrigin, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  const overleafMatch = `${overleafOrigin}/project/*`;
  const bridgeMatch = `${bridgeOrigin}/*`;
  const generatedManifest = buildManifest(manifest, overleafMatch, bridgeMatch);

  for (const fileName of EXTENSION_FILES) {
    const sourcePath = path.join(EXTENSION_DIR, fileName);
    const targetPath = path.join(outDir, fileName);
    if (fileName === "manifest.json") {
      fs.writeFileSync(targetPath, `${JSON.stringify(generatedManifest, null, 2)}\n`, "utf8");
    } else if (fileName === "contentScript.js" || fileName === "popup.js") {
      fs.writeFileSync(targetPath, rewriteDefaultServerUrl(fs.readFileSync(sourcePath, "utf8"), bridgeOrigin), "utf8");
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }

  const buildInfo = {
    ok: true,
    version: generatedManifest.version,
    overleafOrigin,
    bridgeOrigin,
    outDir: relativeFromRoot(outDir),
    files: EXTENSION_FILES,
    safeToCommit: false,
    permissionsBroadened: false,
    publishActionsPerformed: [],
    note: "Generated extension builds can contain private local or self-hosted origins. Keep them under .runtime or another private local directory."
  };
  fs.writeFileSync(path.join(outDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
  return buildInfo;
}

function buildManifest(manifest, overleafMatch, bridgeMatch) {
  const generated = JSON.parse(JSON.stringify(manifest));
  generated.host_permissions = unique([overleafMatch, bridgeMatch]);
  for (const entry of generated.content_scripts || []) {
    if ((entry.js || []).includes("pageBridge.js") || (entry.js || []).includes("contentScript.js")) {
      entry.matches = [overleafMatch];
    }
  }
  const permissions = generated.permissions || [];
  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    if (permissions.includes(forbidden)) {
      throw new Error(`Refusing to generate manifest with forbidden permission: ${forbidden}`);
    }
  }
  return generated;
}

function rewriteDefaultServerUrl(source, bridgeOrigin) {
  const replaced = source.replace(
    /const DEFAULT_SERVER_URL = "http:\/\/127\.0\.0\.1:38475";/,
    `const DEFAULT_SERVER_URL = "${bridgeOrigin}";`
  );
  if (replaced === source && !source.includes(`const DEFAULT_SERVER_URL = "${bridgeOrigin}";`)) {
    throw new Error("Could not rewrite DEFAULT_SERVER_URL");
  }
  return replaced;
}

function normalizeOrigin(value, flagName) {
  if (!value || typeof value !== "string") throw new Error(`${flagName} requires a URL origin`);
  if (value.includes("*")) throw new Error(`${flagName} must not contain wildcards`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${flagName} must be an absolute http(s) origin`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${flagName} must use http or https`);
  }
  if (!parsed.hostname) throw new Error(`${flagName} must include a hostname`);
  if (parsed.username || parsed.password) throw new Error(`${flagName} must not include credentials`);
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error(`${flagName} must be an origin only, without path, query, or hash`);
  }
  return parsed.origin;
}

function originSlug(origin) {
  const parsed = new URL(origin);
  return parsed.host.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "custom-overleaf";
}

function relativeFromRoot(targetPath) {
  const relative = path.relative(ROOT, path.resolve(targetPath)).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : path.resolve(targetPath);
}

function unique(values) {
  return [...new Set(values)];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--overleaf-origin") {
      options.overleafOrigin = takeValue(argv, ++index, arg);
    } else if (arg === "--bridge-origin") {
      options.bridgeOrigin = takeValue(argv, ++index, arg);
    } else if (arg === "--out-dir") {
      options.outDir = takeValue(argv, ++index, arg);
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

function printHelp() {
  console.log(`Usage: node scripts/prepare-extension-build.js --overleaf-origin <origin> [options]

Options:
  --overleaf-origin <origin>  Self-hosted or custom Overleaf origin, for example https://overleaf.example.com.
  --bridge-origin <origin>    Local bridge origin. Defaults to ${DEFAULT_BRIDGE_ORIGIN}.
  --out-dir <path>            Output directory. Defaults to .runtime/extension-builds/<origin-slug>.
  -h, --help                  Show this help.

The default extension supports official Overleaf domains via https://*.overleaf.com/project/*.
Generated custom builds can contain private origins; keep them out of git.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  buildManifest,
  normalizeOrigin,
  originSlug,
  prepareExtensionBuild,
  rewriteDefaultServerUrl
};
