# Publishing

This project can be published as a normal GitHub repository. It does not need npm publishing for local use, but the package metadata now supports future npm/npx installs.

The package binary supports both server launch and helper subcommands. For a package-style smoke check before publishing, run:

```powershell
node bin/overleaf-browser-bridge.js --list-commands
node bin/overleaf-browser-bridge.js live-suite --list
```

## Pre-Release Checklist

Run from the repository root:

```powershell
npm run release:check
npm run package:extension
npm run package:npm
npm run extension:build -- --overleaf-origin https://overleaf.example.com
npm run repo:metadata
npm run release:assets
npm run release:candidate
npm run release:decision
npm run release:preflight
```

Then manually load `extension/` in Chrome and run:

```powershell
npm run live:suite
node scripts/live-smoke-test.js
node scripts/live-noop-release-test.js
```

Use the root [Release Checklist](../RELEASE_CHECKLIST.md) as the release gate source of truth.

## Versioning

Keep these versions identical:

- `package.json`
- `extension/manifest.json`
- `serverInfo.version` in `server/overleaf-bridge-mcp.js`
- content script version in `extension/contentScript.js`

Record user-visible changes in `CHANGELOG.md`.

## GitHub Release Asset

`npm run package:extension` creates:

```text
dist/overleaf-browser-bridge-v<version>.zip
```

Upload that zip as a GitHub Release asset. Users who prefer source installs can still load the unpacked `extension/` directory.

`npm run release:assets` prepares a complete local release asset directory:

```text
dist/release-v<version>/
  overleaf-browser-bridge-v<version>.zip
  release-assets-manifest.json
  SHA256SUMS.txt
  RELEASE_NOTES.md
```

The script verifies the extension zip whitelist, runs the npm package dry-run check, writes SHA-256 sums, and drafts release notes. It does not call the GitHub API, publish to npm, or change repository visibility.

`npm run repo:metadata` checks package metadata, README AI-discovery cues, `llms.txt`, `AGENTS.md`, license/support disclosure, privacy-sensitive metadata, and no-publish markers. It writes no files and performs no publishing actions.

`npm run release:candidate` checks whether the locally prepared asset set is a coherent release candidate. It verifies the release asset manifest, npm package dry run, repository metadata, install paths, human-decision boundaries, and no-publish markers. It does not call the GitHub API, publish to npm, or change repository visibility.

`npm run release:decision` creates a local human decision packet from the current release candidate. It summarizes the prepared asset, recommended repository metadata, install paths, and the explicit GitHub Release, npm, Chrome Web Store, and repository metadata choices that still require human approval. With `-- --write`, it writes ignored files under `.runtime/release-decision/`.

`npm run release:preflight` is the final non-publishing gate. It runs version consistency checks, doctor, tests, first-run diagnostics, offline live verification, MCP config generation, mirror sync workflow discovery, repository metadata readiness, local release asset preparation, release-candidate review, release-decision packet validation, unstaged/staged diff checks, tracked-source privacy scanning, and a no-publish boundary check. It still does not create a GitHub Release, publish to npm, or change repository visibility.

## Custom Extension Builds

`npm run extension:build -- --overleaf-origin https://overleaf.example.com` creates a custom unpacked extension copy under `.runtime/extension-builds/` by default. This is for self-hosted or custom-domain Overleaf editor tabs.

The tracked default manifest and release zip stay scoped to official `https://*.overleaf.com/project/*` domains. Do not upload generated custom builds as the default GitHub Release asset, because they can contain private domains or bridge origins.

## npm Package Dry Run

`npm run package:npm` runs `npm pack --dry-run --json` and checks that the package includes the CLI entrypoint, MCP server, extension files, docs, config templates, README, license, and `llms.txt`.

It also rejects local/private package entries such as:

- `STATE.md`
- `.runtime/`
- `dist/`
- `node_modules/`
- `local-notes/`
- bridge token or project alias runtime files

Do not publish to npm until repository visibility, package name ownership, support expectations, and license wording have been reviewed.

## Chrome Web Store

Chrome Web Store publication is optional. The current target is local unpacked installation, which is enough for personal Codex and Overleaf workflows.

Before any store submission, re-check permissions, screenshots, privacy policy wording, and the latest Chrome Web Store policy.
