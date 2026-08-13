# Usage

This guide expands the short README into the full local workflow.

## Why This Exists

Overleaf Cloud Git integration and GitHub synchronization requirePremium or institution access. This bridge uses the already-open Overleaf web editor instead, so it works with a free account and gives near-real-time edits.

## Project Layout

- `extension/`:Chrome Extension injected only on official `https://*.overleaf.com/project/*` domains by default.
- `extension/pageBridge.js`:main-world CodeMirror bridge for full-document reads and verified full-file replacements.
- `server/overleaf-bridge-mcp.js`:local MCP server plus localhost HTTP command bridge.
- `scripts/`:startup, smoke-test, manual tool-call, doctor, and packaging helpers.
- `config/`:Codex MCP config examples.
- `%USERPROFILE%\.codex\overleaf-bridge\projects\`:default private local mirror for before/after write records, diffs, sync snapshots, and patch logs.

## Start The Local Bridge

```powershell
npm start
```

If `node` is not on PATH in your terminal, use your local Node.js executable directly:

```powershell
node server/overleaf-bridge-mcp.js
```

The server writes connection details here after startup:

```text
.runtime/server-info.json
.runtime/bridge-token.txt
```

The token is only a local bridge token. It is not an Overleaf token, cookie, or password.

## Load The Chrome Extension

For official Overleaf, load the tracked `extension/` directory.

For a self-hosted or custom-domain Overleaf editor, generate and load a private local copy:

```powershell
npm run extension:build -- --overleaf-origin https://overleaf.example.com
```

The generated directory is under `.runtime/extension-builds/` by default. Keep it private and untracked because it can contain private origins.

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository's `extension/` directory.
5. Open or reload an Overleaf project editor tab.

The extension can connect to the local bridge without pasting the token. The runtime token is still required for `/tools/call`, `call-tool.js`, and Codex MCP clients. This is not an Overleaf token, cookie, or password.

If Chrome shows per-site access toggles, allow:

- `https://*.overleaf.com/*`
- `http://127.0.0.1:38475/*`
- `http://localhost:38475/*`

## Live Smoke Test

After the extension is loaded and an Overleaf project editor tab is open:

```powershell
npm run live:suite
node scripts/live-smoke-test.js
```

`npm run live:suite` is the preferred combined browser-side gate. It runs only metadata, read-only, and non-mutating planning checks, and reports `blocked_no_page` when no Overleaf project tab is connected. The single smoke script checks `/health`, calls `health_check`, reads the current project, and lists visible file-tree metadata. It does not call `read_current_file`, build `paper_context`, print manuscript text, or print source previews.

## Manual Tool Calls

Package entrypoint:

```powershell
npx overleaf-browser-bridge --help
npx overleaf-browser-bridge --port 38475
npx overleaf-browser-bridge doctor
npx overleaf-browser-bridge live-suite --allow-no-page
```

Source-tree entrypoint:

```powershell
node server/overleaf-bridge-mcp.js
```

Package helper commands:

```powershell
npx overleaf-browser-bridge --list-commands
npx overleaf-browser-bridge first-run
npx overleaf-browser-bridge config --mode package
npx overleaf-browser-bridge sync-mirror --list
npx overleaf-browser-bridge release-preflight
```

Check connected pages and token-protected bridge status:

```powershell
node scripts/call-tool.js health_check
```

Read the current file by project title:

```powershell
node scripts/call-tool.js read_current_file "{""projectTitle"":""Codex Free Sync Test""}"
```

When multiple Overleaf tabs are open, create a local alias and lock the intended tab before repeated reads or writes:

```powershell
node scripts/call-tool.js set_project_alias "{""alias"":""paper"",""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js lock_target_project "{""projectAlias"":""paper""}"
node scripts/call-tool.js read_current_file "{""targetLockId"":""<TARGET_LOCK_ID>"",""expectedFileName"":""main.tex""}"
```

Aliases are stored locally in `.runtime/project-aliases.json` by default. They contain only alias names and Overleaf project title matching text, not cookies, sessions, tokens, or account project lists. Use `config/project-aliases.example.json` as the handwritten config shape.

Read visible CodeMirror diagnostics and lint tooltips:

```powershell
node scripts/call-tool.js get_editor_diagnostics "{""projectTitle"":""Codex Free Sync Test""}"
```

Parse and read LaTeX sections:

```powershell
node scripts/call-tool.js get_sections "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex""}"
node scripts/call-tool.js get_section_content "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex"",""title"":""Introduction""}"
```

Use lower-token reads for long files:

```powershell
node scripts/call-tool.js read_file_range "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex"",""startLine"":1,""endLine"":40}"
node scripts/call-tool.js read_file "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex"",""contextBudget"":""summary"",""maxChars"":800}"
node scripts/call-tool.js read_file_since_hash "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex"",""sinceHash"":""<PREVIOUS_BEFORE_HASH>""}"
```

Create and inspect a local source mirror:

```powershell
node scripts/call-tool.js sync_project_snapshot "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js find_in_project_mirror "{""projectTitle"":""Codex Free Sync Test"",""query"":""Introduction"",""maxMatches"":5}"
node scripts/call-tool.js find_in_project_mirror "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""title"":""Introduction""}"
node scripts/call-tool.js preview_mirror_diff "{""projectTitle"":""Codex Free Sync Test"",""mirrorRoot"":""<MIRROR_ROOT>""}"
node scripts/call-tool.js prepare_mirror_sync_plan "{""projectTitle"":""Codex Free Sync Test"",""mirrorRoot"":""<MIRROR_ROOT>"",""direction"":""review_only"",""reason"":""review mirror drift before editing""}"
node scripts/call-tool.js execute_mirror_sync_plan "{""projectTitle"":""Codex Free Sync Test"",""confirmationToken"":""<CONFIRMATION_TOKEN>"",""confirmationPhrase"":""<EXACT_CONFIRMATION_PHRASE>"",""syncPlanHash"":""<SYNC_PLAN_HASH>"",""reason"":""execute approved mirror sync plan""}"
```

`sync_project_snapshot` writes a readable mirror plus `manifest.json` and `latest-manifest.json` metadata under the private bridge mirror directory. `preview_mirror_diff` is read-only: it compares the current open Overleaf tab against the mirror and does not upload local files back to Overleaf. `prepare_mirror_sync_plan` converts that comparison into review actions and blockers. `execute_mirror_sync_plan` executes approved `overleaf_to_mirror` plans by writing a new local mirror snapshot after a fresh diff check. It can also execute approved `mirror_to_overleaf` plans only when every action updates an existing Overleaf file; each write uses a fresh `beforeHash` check and snapshot-protected `replace_file`. It does not create or delete Overleaf files.

For an agent-friendly CLI wrapper around the same mirror tools:

```powershell
npm run sync:mirror -- status --project-title "Codex Free Sync Test" --mirror-root "<MIRROR_ROOT>"
npm run sync:mirror -- pull-plan --project-title "Codex Free Sync Test" --mirror-root "<MIRROR_ROOT>"
npm run sync:mirror -- push-plan --project-title "Codex Free Sync Test" --mirror-root "<MIRROR_ROOT>"
npm run sync:mirror -- execute --project-title "Codex Free Sync Test" --confirmation-token "<CONFIRMATION_TOKEN>" --confirmation-phrase "<EXACT_CONFIRMATION_PHRASE>" --sync-plan-hash "<SYNC_PLAN_HASH>"
```

`sync:mirror status` strips raw diff text from stdout by default. `pull-plan` prepares `overleaf_to_mirror`; `push-plan` prepares update-only `mirror_to_overleaf`; `execute` still requires the exact token, phrase, and plan hash from the prepared plan. It is not automatic bidirectional sync.

Export the current source file or visible compile log locally:

```powershell
node scripts/call-tool.js export_current_file "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex""}"
node scripts/call-tool.js export_compile_log "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js list_visible_artifacts "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js export_artifact_inventory "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js export_visible_artifact "{""projectTitle"":""Codex Free Sync Test"",""artifactType"":""pdf"",""maxBytes"":10485760}"
node scripts/call-tool.js inspect_file_operation_ui "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js inspect_upload_workflow "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js inspect_download_workflow "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js inspect_visible_comments "{""projectTitle"":""Codex Free Sync Test""}"
node scripts/call-tool.js prepare_comment_action "{""projectTitle"":""Codex Free Sync Test"",""action"":""resolve"",""threadIndex"":0,""reason"":""prepare comment resolve only""}"
node scripts/call-tool.js execute_comment_action "{""projectTitle"":""Codex Free Sync Test"",""confirmationToken"":""<CONFIRMATION_TOKEN>"",""confirmationPhrase"":""<EXACT_CONFIRMATION_PHRASE>"",""threadListHash"":""<THREAD_LIST_HASH>"",""reason"":""execute approved comment action""}"
node scripts/call-tool.js prepare_file_operation "{""projectTitle"":""Codex Free Sync Test"",""operation"":""create"",""fileName"":""sections/new_section.tex"",""reason"":""prepare file creation only""}"
node scripts/call-tool.js execute_file_operation "{""projectTitle"":""Codex Free Sync Test"",""confirmationToken"":""<CONFIRMATION_TOKEN>"",""confirmationPhrase"":""<EXACT_CONFIRMATION_PHRASE>"",""fileListHash"":""<FILE_LIST_HASH>"",""reason"":""execute approved file operation""}"
```

`list_visible_artifacts` and `export_artifact_inventory` are metadata-only. They inspect visible PDF/log/download candidates from the current page and save a JSON inventory locally, but they do not read cookies. If the result includes `reloadRequired: true`, reload the unpacked Chrome Extension from this repository and refresh the Overleaf tab, then run the command again.

`export_visible_artifact` saves one visible downloadable candidate, selected by `artifactIndex`, `artifactType`, or `labelContains`, to the private local export directory. The result reports the local path, manifest path, byte length, hash, MIME type, and redacted source metadata; it does not expose raw private URLs, cookies, sessions, or artifact bytes in tool output.

These tools write under the private local export directory and do not create, rename, delete, upload, or overwrite Overleaf files.

`inspect_file_operation_ui` is a read-only UI readiness check. It reports file-management controls but does not click or execute create, rename, delete, or upload actions.

`inspect_upload_workflow` is also read-only. It reports upload controls, `input[type=file]` constraints, drop zones, existing image candidates, and blockers. It does not open file pickers, assign local file paths, upload images, or expose local filesystem paths.

`inspect_download_workflow` is also read-only. It reports visible download/export controls, source-file candidates, and artifact candidates with redacted URLs. It does not click controls, download project ZIPs, fetch files, expose raw private URLs, or read cookies. Treat `supportedDirectDownload: false` and `requiresUserConfirmation: true` as hard boundaries.

`inspect_visible_comments` is also read-only. It reports visible comment/review-thread counts, short previews, line hints, and reply/resolve/reopen controls. It does not reply, resolve, reopen, delete comments, or mutate collaboration state.

`prepare_comment_action` is also non-mutating. It returns a selected thread signature, thread-list hash, confirmation token, exact phrase, and blockers for a future comment action; it does not execute the action.

`execute_comment_action` is the guarded execution step for a prepared visible comment action. It requires the exact values returned by `prepare_comment_action`, rechecks the visible thread list before clicking, and verifies the result afterward. For `reply`, pass `replyText` during execution; output returns only `replyTextLength`. Do not run this on a real manuscript unless the user explicitly approves the specific reply, resolve, reopen, or delete-comment action.

`prepare_file_operation` is also non-mutating. It returns a confirmation token, exact phrase, file-list hash, and blockers for a future operation; it does not execute the operation.

`execute_file_operation` is the guarded execution step for a prepared create, rename, or delete plan. It requires the exact values returned by `prepare_file_operation`, rechecks the visible file tree before clicking, and verifies the resulting file tree afterward. Do not run this on a real manuscript unless the user explicitly approves the specific create, rename, or delete operation.

Avoid PowerShell quoting problems with `@file`:

```powershell
Set-Content -LiteralPath .\args.json -Encoding UTF8 -Value '{"projectTitle":"Codex Free Sync Test","expectedFileName":"main.tex"}'
node scripts/call-tool.js read_current_file @args.json
```

Or stdin:

```powershell
'{"projectTitle":"Codex Free Sync Test"}' | node scripts/call-tool.js read_current_file -
```

## Codex MCP Configuration

Example config files are provided in:

```text
config/
```

- `codex-mcp.example.toml`
- `mcp-launch.example.json`

These are examples only. They do not modify your global Codex config. Use them after the extension has passed the live smoke test.

To generate local path-aware snippets without editing global agent config files, run:

```powershell
npm run config:mcp
```

The generated files are written under `.runtime/generated-configs/`. They may include local absolute paths, so do not commit them.

For a broader first-run diagnostic, run:

```powershell
npm run first-run
```

This writes setup artifacts under `.runtime/first-run/` and reports next steps before live browser validation.

After the bridge is running and the Chrome Extension has been loaded or refreshed, run:

```powershell
npm run live:verify
```

This returns JSON diagnostics for bridge health, connected Overleaf pages, and stale content script versions without reading manuscript text.

## Snapshot And Patch Logs

Write tools require a fresh `beforeHash`. First read the target file:

```powershell
node scripts/call-tool.js read_file "{""projectTitle"":""Codex Free Sync Test"",""fileName"":""main.tex"",""expectedFileName"":""main.tex""}"
```

Then pass the returned `beforeHash` into `replace_section`, `replace_file`, `replace_selection`, `insert_text`, or `apply_patch_to_file`.

`replace_section` preserves the matched heading by default and replaces only the section body. Use `sectionIndex`, `path`, `title`, and optional `level` to disambiguate. `replace_file` and `replace_section` use the main-world CodeMirror page bridge and verify the full editor document after chunked replacement. If the bridge is not loaded or verification fails, the operation returns an explicit error instead of writing through a partial visible-DOM fallback.

For multi-tab workflows, include the `targetLockId` returned by `lock_target_project` on the read and write calls. If the browser tab changes to a different Overleaf project after it was locked, the bridge rejects the command.

Local records are written under:

```text
%USERPROFILE%\.codex\overleaf-bridge\projects\<project-title-slug>\
```

Each write stores a before file, after file, diff, hashes, and `patch-log.jsonl`. The log does not record Overleaf cookies, session tokens, passwords, Git tokens, or raw project IDs.

Mirror snapshots also live under this directory. They are local source exports for search, section lookup, and diff preview; they are not automatic bidirectional sync.

## Local HTTP Tool API

The MCP server also exposes a local token-protected HTTP tool API for smoke tests:

- `GET /tools/list`
- `POST /tools/call`

Request shape:

```json
{
  "name": "read_current_file",
  "arguments": {
    "projectTitle": "Codex Free Sync Test"
  }
}
```

The HTTP tool API is only for local testing and requires the bridge token. The browser extension uses restricted `/bridge/*` endpoints instead.

## Package The Extension

Create a release zip:

```powershell
npm run package:extension
```

The archive is written to:

```text
dist/overleaf-browser-bridge-v<version>.zip
```

Users can either load the unpacked `extension/` directory or download the release zip and unpack it locally.
