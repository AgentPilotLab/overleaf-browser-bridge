# Installation

Use this guide when installing `overleaf-browser-bridge` from source, from a prepared GitHub Release asset, or through a future npm/npx package entrypoint.

## Source Tree Install

Requirements:

- Node.js 18 or newer.
- Chrome or Chromium.
- An already-open Overleaf project editor tab.

Run:

```bash
npm run doctor
npm test
npm run first-run
npm run config:mcp
npm start
```

Then open `chrome://extensions`, enable Developer Mode, choose `Load unpacked`, and select the repository `extension/` directory.

`npm run first-run` performs local setup diagnostics, writes generated helper files under `.runtime/first-run/`, and reports next steps. It does not read Overleaf cookies, sessions, Git tokens, passwords, OAuth tokens, or manuscript text.

`npm run config:mcp` writes local Codex and Claude-style MCP config snippets under `.runtime/generated-configs/`. These generated files can include local absolute paths, so keep them private and do not commit them.

## Self-Hosted Or Custom Overleaf Origin

The default source extension remains scoped to official Overleaf:

```text
https://*.overleaf.com/project/*
```

For a self-hosted or custom-domain Overleaf editor, generate a private local extension copy:

```bash
npm run extension:build -- --overleaf-origin https://overleaf.example.com
```

By default this writes to `.runtime/extension-builds/<origin>/`. Load that generated directory with `chrome://extensions` for the custom origin. The generated copy can contain private domains or bridge origins, so keep it out of git and do not package it as the default release zip.

After the bridge is running and the unpacked Chrome Extension has been loaded or refreshed, reload the Overleaf project tab and run:

```bash
npm run live:verify
npm run live:suite
```

This post-install live verifier checks bridge reachability, connected Overleaf tabs, and content script version freshness. If it reports a stale content script, reload the unpacked extension and refresh the Overleaf tab again.

`npm run live:suite` runs the safe browser-side gate set after `live:verify`: metadata smoke test, read-only workflow inspections, and non-mutating action-plan checks. It reports `blocked_no_page` when the bridge is healthy but no Overleaf project tab is connected.

## GitHub Release Zip Install

Release assets are prepared locally with:

```bash
npm run release:assets
```

This creates `dist/release-v<version>/` with:

- `overleaf-browser-bridge-v<version>.zip`
- `release-assets-manifest.json`
- `SHA256SUMS.txt`
- `RELEASE_NOTES.md`

To install from the zip, extract it to a local folder, open `chrome://extensions`, enable Developer Mode, choose `Load unpacked`, and select the extracted folder. The zip contains only:

- `manifest.json`
- `background.js`
- `contentScript.js`
- `pageBridge.js`
- `popup.html`
- `popup.js`

## Package Entrypoint

Package-style MCP launch is available through:

```bash
npx overleaf-browser-bridge --help
npx overleaf-browser-bridge --port 38475
npx overleaf-browser-bridge doctor
npx overleaf-browser-bridge live-suite --allow-no-page
npx overleaf-browser-bridge sync-mirror --list
npx overleaf-browser-bridge release-candidate
npx overleaf-browser-bridge release-decision
```

The package entrypoint starts the local MCP stdio server when run with server flags. It also exposes helper subcommands for setup diagnostics, MCP config generation, live verification, safe live suite checks, guarded mirror sync workflows, release asset preparation, release-candidate review, release-decision packets, release preflight, custom extension builds, package dry runs, and manual tool calls. It still requires the Chrome extension and an already-open Overleaf project tab for browser-side checks. The package dry-run gate is:

```bash
npm run package:npm
```

For package-style config snippets, run:

```bash
node scripts/generate-mcp-config.js --mode package
npx overleaf-browser-bridge config --mode package
```

## Safety Boundaries

- Do not paste Overleaf cookies, session tokens, Git tokens, passwords, or OAuth tokens into this tool.
- Do not commit `.runtime/`, `dist/`, local mirrors, generated archives, or private manuscript text.
- Reload the unpacked extension after updating source files or installing a new release zip.
- Treat GitHub Release creation, npm publishing, repository visibility, and Chrome Web Store publication as explicit human decisions.
