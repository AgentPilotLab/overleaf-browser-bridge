# Architecture

Overleaf Codex Browser Bridge is a local-only paper workspace bridge between an already-open Overleaf project tab and Codex-compatible MCP clients.

```text
Codex or MCP client
  |
  | stdio MCP or token-protected localhost HTTP
  v
server/overleaf-bridge-mcp.js
  |
  | localhost long polling
  v
extension/contentScript.js
  |
  | DOM editor operations, diagnostics, and command polling
  v
extension/pageBridge.js (MAIN world)
  |
  | CodeMirror document reads and verified chunked full-file replacements
  v
Overleaf web editor
```

## Components

- `extension/manifest.json`:Chrome Manifest V3 entrypoint. The tracked default manifest only matches official `https://*.overleaf.com/project/*` domains.
- `extension/background.js`:restricted service-worker proxy for local bridge registration, polling, and results, avoiding per-site local-network access differences across official Overleaf domains.
- `extension/contentScript.js`:registers the current Overleaf editor tab with the local bridge, polls for commands, reads the visible file tree, opens files, reads selection, reads focused editor diagnostics, delegates full-document reads/writes to the page bridge, and triggers Recompile.
- `extension/pageBridge.js`:runs in the page's main world so it can access CodeMirror internals for full-document text reads and verified chunked full-file replacements.
- `server/overleaf-bridge-mcp.js`:starts the localhost bridge, exposes MCP tools over stdio, exposes a token-protected localHTTP test API, validates write hashes, applies unified diffs, stores write snapshots, and keeps a manifest-backed private project mirror for local search and diff preview.
- `scripts/prepare-extension-build.js`:generates an ignored local extension copy for a self-hosted or custom-domain Overleaf origin without broadening the tracked default manifest.
- `scripts/start-bridge.ps1`:starts the local bridge on Windows.
- `scripts/call-tool.js`:manual localHTTP tool caller for smoke testing.
- `scripts/live-smoke-test.js`:checks that the bridge and current Overleaf tab are connected without reading or printing manuscript text.

## Trust Boundary

The bridge does not ask for Overleaf cookies, passwords, Git tokens, or OAuth tokens. The browser extension acts only inside the current Overleaf editor tab that the user has opened manually.

The local bridge token protects `/tools/*` calls from other local processes. Restricted `/bridge/*` endpoints accept the Chrome Extension or Overleaf page origin so the already-open Overleaf tab can register without requiring users to paste a token. The token is local-only and is not an Overleaf credential.

## Data Written Locally

Runtime and audit files are local and gitignored:

- `.runtime/server-info.json`
- `.runtime/bridge-token.txt`
- `%USERPROFILE%\.codex\overleaf-bridge\projects\<project-title-slug>\patches\`
- `%USERPROFILE%\.codex\overleaf-bridge\projects\<project-title-slug>\sync\`
- `%USERPROFILE%\.codex\overleaf-bridge\projects\<project-title-slug>\patch-log.jsonl`

Write tools create before/after snapshots and a unified diff before reporting success. Patch logs include time, project title, file name, operation, reason, beforeHash, afterHash, and local diff path, but not Overleaf project IDs, cookies, sessions, Git tokens, or passwords.

`sync_project_snapshot` writes readable source files plus `manifest.json` and `latest-manifest.json` metadata. Mirror tools only search or compare local text snapshots; they do not push files back to Overleaf.

## Current Scope

This release works only with already-open Overleaf project tabs. It reads the visible file tree from the page, not private Overleaf APIs, and it does not enumerate the user's dashboard or use Overleaf Git integration. Full source text comes from the active CodeMirror document through the main-world page bridge. Creating projects, uploading zips, or setting the main document remain browser UI tasks.
