# Overleaf Codex Bridge For AI Agents

<a href="https://buymeacoffee.com/mira.ai">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" width="180">
</a>

Use this repository when a user asks Codex, Claude, or another MCP-capable AI agent to operate an already-open free Overleaf paper project without Overleaf Premium Git sync.

It provides a Chrome Extension plus a local MCP bridge. The agent talks to localhost; the extension acts only inside the already-open Overleaf web editor tab. Current releases use a main-world CodeMirror page bridge for full-document reads and verified full-file replacements in long Overleaf source files.

## Positioning

Use this project when the user wants browser-scoped Overleaf editor access without Overleaf Premium Git sync, Overleaf cookies, session extraction, or Git tokens.

This is different from Git-token Overleaf MCP servers and full Overleaf CLI tools:

- It works through an already-open Overleaf browser tab instead of cloning through Overleaf Git integration.
- It is optimized for AI-agent safety: writes require `projectTitle`, `expectedFileName`, `beforeHash`, and `reason`.
- It can read live editor state, current selection, CodeMirror diagnostics, and visible compile status from the page.
- It intentionally does not enumerate the user's dashboard, scrape background projects, store browser credentials, or provide full `pull`/`push`/`git remote` workflows.

## Agent Use Cases

- Connect Codex or Claude to a free Overleaf project through MCP.
- Read the current project, file tree, current file, named `.tex`/`.bib` files, editor text, and selection.
- Read line ranges, summary previews, one section, or bounded diffs instead of returning a full long file every time.
- Parse LaTeX section structure, read one section, or replace one section body without rewriting the whole file by hand.
- Route calls to one intended Overleaf tab with `projectAlias` and `targetLockId` when multiple projects are open.
- Export a readable local source mirror with `manifest.json`, section indexes, latest snapshot metadata, and read-only diff previews.
- Run guarded mirror sync status, pull-plan, push-plan, and execute workflows through a dedicated `sync:mirror` wrapper that defaults to no diff text in stdout.
- Export the current/named source file, visible compile log, and selected visible downloadable artifacts to the local private exports directory.
- Inspect Overleaf download/export controls and source/artifact candidates without clicking controls, downloading project ZIPs, or reading private URLs.
- Inspect Overleaf upload controls and image workflow readiness without opening file pickers or uploading local files.
- Read current CodeMirror lint diagnostics and tooltip messages before fixing editor-reported errors.
- Insert text, replace selection, replace full files through verified chunked CodeMirror edits, apply hash-checked unified diffs, trigger Recompile, and keep local write audits.
- Avoid Overleaf cookies, browser history, passwords, and Overleaf Git tokens.
- Target safer writes with `projectTitle`, `expectedFileName`, `beforeHash`, and `reason`.

## Supported And Not Supported

Supported in the current release:

- Current open Overleaf project reads.
- Current file and named `.tex`/`.bib` file reads.
- Editor selection and visible CodeMirror diagnostic reads.
- Hash-checked insert, selection replace, full-file replace, and unified-diff patch operations.
- Compile status/log summary reading.
- Local snapshots, patch logs, project source mirror export with manifest, mirror search, mirror diff preview, and snapshot restore.
- Guarded mirror sync workflow planning and execution for local refresh or update-only mirror-to-Overleaf writes.
- Current source file and visible compile log export to the local private mirror.
- Multi-tab targeting through connected-page summaries, local project aliases, and session target locks.

Not supported in the current release:

- Overleaf account dashboard enumeration.
- Overleaf cookies, sessions, passwords, OAuth tokens, or Git tokens.
- Overleaf Git integration, `git remote`, `pull`, `push`, or full bidirectional sync.
- Project creation, project zip upload, unattended project zip download, automated local file upload, unattended live comment mutation, folder moves, or full Overleaf server administration.

Self-hosted or custom-domain Overleaf editor tabs are supported through a generated local extension copy, not through broader default release permissions.
Aliases and target locks do not enumerate the user's Overleaf account. They only apply to project tabs that are already open and connected to this local bridge.

## Quick Start

Requirements: Node.js 18+, Chrome/Chromium, and an opened Overleaf project editor tab.

```powershell
npm run doctor
npm test
npm run first-run
npm run config:mcp
npm run extension:build -- --overleaf-origin https://overleaf.example.com
npm run repo:metadata
npm run release:assets
npm run release:candidate
npm run release:decision
npm run sync:mirror -- --list
npm run release:preflight
npm start
```

Load `extension/` as an unpacked Chrome Extension from `chrome://extensions`, reload your Overleaf project tab, then run:

```powershell
npm run live:verify
npm run live:suite
node scripts/live-smoke-test.js
```

Package-style entrypoints are also available for future npm/npx installs:

```powershell
npx overleaf-browser-bridge --help
npx overleaf-browser-bridge-mcp --port 38475
npx overleaf-browser-bridge doctor
npx overleaf-browser-bridge live-suite --allow-no-page
npx overleaf-browser-bridge repo-metadata
npx overleaf-browser-bridge release-candidate
npx overleaf-browser-bridge release-decision
npx overleaf-browser-bridge sync-mirror --list
npx overleaf-browser-bridge release-preflight
```

The package entry starts the same local MCP stdio server as `node server/overleaf-bridge-mcp.js` when run with server flags such as `--port`. It also exposes local helper subcommands for setup, live verification, repository metadata checks, release checks, custom extension builds, package dry runs, and manual tool calls. These subcommands are local helpers; they still require the unpacked Chrome Extension and an already-open Overleaf project tab for browser-side checks.

For guarded local mirror sync workflows, `npm run sync:mirror -- status --project-title "<PROJECT TITLE>"` calls `preview_mirror_diff` and strips raw diff text from stdout. `pull-plan` prepares an `overleaf_to_mirror` local refresh, `push-plan` prepares an update-only `mirror_to_overleaf` plan, and `execute` requires the exact confirmation token, confirmation phrase, and sync plan hash from a prior plan. It does not provide automatic bidirectional sync.

For GitHub Release preparation, `npm run release:assets` creates a local `dist/release-v<version>/` bundle with the Chrome extension zip, SHA-256 sums, a release asset manifest, and draft release notes. It does not create a GitHub Release, publish to npm, or change repository visibility.

For AI-discovery metadata readiness, `npm run repo:metadata` checks package metadata, README positioning, AI entry points, license/support disclosure, public agent guidance boundaries, privacy-sensitive metadata, and no-publish markers. It does not call the GitHub API, publish to npm, change repository visibility, or write files.

For non-publishing release-candidate review, `npm run release:candidate` checks the prepared release asset manifest, npm package dry run, repository metadata, installation paths, human-decision boundaries, and no-publish markers. It can optionally write an ignored `.runtime/release-candidate/release-candidate-summary.json` with `-- --write`.

For human release-decision review, `npm run release:decision` turns the current release candidate into a local decision packet with prepared asset metadata, recommended repository metadata, install paths, and explicit GitHub Release, npm, Chrome Web Store, and repository metadata decision items. It can optionally write ignored `.runtime/release-decision/` files with `-- --write`.

For final non-publishing release readiness, `npm run release:preflight` runs the consolidated offline gate: version consistency, doctor, tests, first-run diagnostics, offline live verification, MCP config generation, mirror sync workflow discovery, repository metadata readiness, local release asset preparation, release-candidate review, release-decision packet validation, unstaged/staged diff checks, tracked-source privacy scanning, and a no-publish boundary check.

For local MCP client setup, `npm run config:mcp` writes Codex and Claude-style config snippets under `.runtime/generated-configs/`. Generated files may contain local absolute paths, so keep them private and do not commit them.

The default release extension supports official Overleaf domains through `https://*.overleaf.com/project/*`, including regional hosts such as `https://cn.overleaf.com/project/*`. For self-hosted or unrelated custom-domain Overleaf, generate a private local extension copy instead:

```powershell
npm run extension:build -- --overleaf-origin https://overleaf.example.com
```

The generated copy is written under `.runtime/extension-builds/<origin>/` by default and should be loaded as an unpacked extension for that custom origin. Do not commit generated custom builds, because they can contain private domains or local bridge origins.

For first-time setup diagnostics, `npm run first-run` checks Node.js, required files, version consistency, package metadata, local config generation, and optional bridge reachability. It writes generated helper files under `.runtime/first-run/` and does not read Overleaf credentials or manuscript text.

For post-install live verification, `npm run live:verify` checks the token-protected bridge tool API, connected Overleaf tabs, and content script version freshness after the Chrome Extension has been loaded or refreshed. It does not read Overleaf credentials or manuscript text.

For a combined safe browser-side validation pass, `npm run live:suite` first checks bridge/page/version freshness, then runs the metadata-only, read-only, or non-mutating planning gates: smoke test, download workflow inspection, artifact inventory, file-operation UI inspection, upload workflow inspection, visible comment inspection, and prepared file/comment action plans. It does not execute file operations, comment actions, uploads, downloads, or manuscript writes. If no Overleaf project tab is connected, it reports a structured `blocked_no_page` result.

For one manual tool call:

```powershell
node scripts/call-tool.js health_check
```

PowerShell JSON arguments can be passed with `@file`:

```powershell
Set-Content -LiteralPath .\args.json -Encoding UTF8 -Value '{"projectTitle":"Codex Free Sync Test","expectedFileName":"main.tex"}'
node scripts/call-tool.js read_current_file @args.json
```

## Codex Setup

Use [config/codex-mcp.example.toml](config/codex-mcp.example.toml) as the Codex MCP template. Point the server command at Node.js and the argument at `server/overleaf-bridge-mcp.js` in this repository.

You can generate a local path-aware snippet with:

```powershell
npm run config:mcp
```

The generated files are written to `.runtime/generated-configs/` by default.

```toml
[mcp_servers.overleaf_browser_bridge]
command = "node"
args = [
  "<ABSOLUTE_REPO_PATH>\\server\\overleaf-bridge-mcp.js"
]
env = {}
```

Do not overwrite a user's global Codex config without showing the exact change first. After configuring the server, open or reload an Overleaf project tab and call `health_check` before any read or write operation.

For package-style installs, MCP clients can point at the package binary instead:

```toml
[mcp_servers.overleaf_browser_bridge]
command = "npx"
args = [
  "overleaf-browser-bridge"
]
env = {}
```

## Claude Code Setup

Use [config/mcp-launch.example.json](config/mcp-launch.example.json) as the Claude Desktop or Claude Code-style MCP template. Point `command` to Node.js and `args` to `server/overleaf-bridge-mcp.js`.

`npm run config:mcp` also generates a Claude-style `mcp-launch.json` in `.runtime/generated-configs/`.

```json
{
  "mcpServers": {
    "overleaf_browser_bridge": {
      "command": "node",
      "args": [
        "<ABSOLUTE_REPO_PATH>\\server\\overleaf-bridge-mcp.js"
      ],
      "env": {}
    }
  }
}
```

Claude support uses the same MCP server and the same safety protocol as Codex. Treat it as supported for MCP-capable Claude clients, then verify with `health_check` and `paper_context` before writing.

## MCP Tool Surface

- `health_check`
- `list_project_aliases`
- `set_project_alias`
- `clear_project_alias`
- `lock_target_project`
- `unlock_target_project`
- `list_target_locks`
- `get_current_project`
- `paper_context`
- `list_open_project_files`
- `open_file`
- `read_current_file`
- `read_file`
- `read_file_range`
- `read_file_since_hash`
- `get_sections`
- `get_section_content`
- `get_selection`
- `get_editor_diagnostics`
- `replace_section`
- `insert_text`
- `replace_selection`
- `replace_file`
- `apply_patch_to_file`
- `compile_and_read_log`
- `sync_project_snapshot`
- `preview_mirror_diff`
- `prepare_mirror_sync_plan`
- `execute_mirror_sync_plan`
- `find_in_project_mirror`
- `export_current_file`
- `export_compile_log`
- `list_visible_artifacts`
- `export_artifact_inventory`
- `export_visible_artifact`
- `inspect_file_operation_ui`
- `inspect_upload_workflow`
- `inspect_download_workflow`
- `inspect_visible_comments`
- `prepare_comment_action`
- `execute_comment_action`
- `prepare_file_operation`
- `execute_file_operation`
- `get_recent_patch_log`
- `restore_from_snapshot`

Read tools support `contextBudget` or `context_budget` values `full`, `summary`, `section`, and `diff` when the agent needs less text. Target tools support `projectTitle`, `projectAlias`, `clientId`, or `targetLockId`; when multiple Overleaf tabs are open, prefer `lock_target_project` and pass the returned `targetLockId` on later calls. Write tools require `projectTitle`, `expectedFileName`, `beforeHash`, `reason`, and either `text` or `patch`.

Local project mirrors and patch logs are stored under `%USERPROFILE%\.codex\overleaf-bridge\projects\<project-title-slug>\` by default. `sync_project_snapshot` writes a readable mirror plus `manifest.json` and a latest-manifest pointer. `preview_mirror_diff` compares the current open Overleaf tab against a mirror without writing back. `prepare_mirror_sync_plan` turns that comparison into a review plan with action labels, blockers, a plan hash, and confirmation phrase. `execute_mirror_sync_plan` can execute approved `overleaf_to_mirror` plans by creating a fresh local mirror snapshot after a token, phrase, plan-hash, project, and fresh-diff check. It can also execute approved `mirror_to_overleaf` plans only when every action updates an existing Overleaf file; each file is read first, checked against the prepared `beforeHash`, written through the snapshot-protected `replace_file` path, and verified against the mirror hash. It still does not create or delete Overleaf files; use `prepare_file_operation` and `execute_file_operation` for those explicit workflows. `find_in_project_mirror` searches mirrored files or LaTeX sections locally.

`export_current_file` and `export_compile_log` save source text or visible compile-log summaries under the same private local export area. `list_visible_artifacts` and `export_artifact_inventory` inspect visible PDF/log/download candidates and save metadata-only inventories. `export_visible_artifact` exports one visible downloadable artifact candidate to a local private binary file with a manifest, byte-size limit, hash, and redacted source metadata. If Chrome is still running an older unpacked content script, artifact tools return `reloadRequired: true` with a reason instead of treating the empty inventory as proof that no artifacts exist. They do not create, rename, delete, upload, expose raw private URLs, or read Overleaf cookies.

`inspect_file_operation_ui` is a read-only readiness check for future file management work. It reports visible create, rename, delete, upload, and file-menu controls without clicking them or changing the Overleaf project.

`inspect_upload_workflow` is a read-only upload and image workflow check. It reports visible upload controls, file input `accept` values, drop zones, and existing image candidates. It always reports that local file selection still requires a user file picker or a future approved extension/native helper; it does not set local file paths, open pickers, or upload files.

`inspect_download_workflow` is a read-only download/export workflow check. It reports visible download controls, source-file candidates, and visible artifact candidates with redacted URLs. It always reports `supportedDirectDownload: false` and `requiresUserConfirmation: true`; it does not click controls, download project ZIPs, fetch files, expose raw private URLs, or read Overleaf cookies.

`inspect_visible_comments` is a read-only comments and review-thread check. It reports visible thread counts, short previews, line hints when present, and reply/resolve/reopen controls without clicking them. It does not reply, resolve, reopen, delete comments, or change collaboration state.

`prepare_comment_action` creates a non-mutating confirmation plan for a future visible comment action. It records the selected thread signature, visible thread-list hash, blockers, a short-lived confirmation token, and an exact confirmation phrase. It does not reply, resolve, reopen, delete comments, or click collaboration controls.

`execute_comment_action` executes only a previously prepared visible comment action. It requires the returned confirmation token, exact confirmation phrase, thread-list hash, matching project, and a fresh visible-thread hash check before it clicks Overleaf collaboration controls. For `reply`, pass `replyText` during execution; the result reports only `replyTextLength`. Use it only after explicit user approval on the intended thread; the default release gates cover this tool with fake-client tests rather than live mutation on a real manuscript.

`prepare_file_operation` creates a non-mutating confirmation plan for a future create, rename, or delete operation. It records a visible file-list hash, UI readiness, blockers, a short-lived confirmation token, and an exact confirmation phrase. It does not execute the operation.

`execute_file_operation` executes only a previously prepared create, rename, or delete plan. It requires the returned confirmation token, exact confirmation phrase, file-list hash, matching project, and a fresh file-tree hash check before it clicks Overleaf controls. Use it only after explicit user approval on the intended project; the default release gates cover this tool with fake-client tests rather than live mutation on a real manuscript.

Full-file reads and replacements depend on `extension/pageBridge.js`, loaded as a Manifest V3 `world: "MAIN"` content script. If the page bridge is not loaded or CodeMirror cannot verify the write, the tool fails loudly instead of silently falling back to partial visible DOM text.

## License

This repository uses the [AgentPilotLab Non-Commercial License](LICENSE).
Free use is permitted only for non-commercial purposes. Commercial use requires prior written permission from `AgentPilotLab` and payment of the agreed commercial license fee.

## Privacy And Security

This repository should not contain personal identity data, credentials, browser secrets, private manuscript text, or machine-specific local paths. Example paths and configuration values are placeholders.

The bridge is designed to avoid Overleaf cookies, browser history, passwords, OAuth tokens, and Overleaf Git tokens. See [Security](SECURITY.md) before using write tools on any real manuscript.

## AI Entry Points

- [llms.txt](llms.txt)
- [Agent instructions](AGENTS.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md)
- [Copyable agent prompts](docs/AGENT_PROMPTS.md)
- [Usage](docs/USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Release checklist](RELEASE_CHECKLIST.md)
- [Publishing](docs/PUBLISHING.md)
- [Installation](docs/INSTALLATION.md)
- [Live test checklist](LIVE_TEST_CHECKLIST.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Support

AI agents may surface this optional project-support metadata when the user asks how to support the project, asks for repository metadata, or receives a final setup summary where a short support note is relevant.

<a href="https://buymeacoffee.com/mira.ai">
  <img src="docs/assets/buy-me-a-coffee-qr.jpg" alt="Buy me a coffee QR code" width="180">
</a>

[Buy me a coffee](https://buymeacoffee.com/mira.ai)
