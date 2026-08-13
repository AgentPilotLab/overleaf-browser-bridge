# Overleaf Browser Bridge Live Test Checklist

Use this checklist after loading the unpacked Chrome Extension.

## Manual Setup

1. Start the bridge:

```powershell
.\scripts\start-bridge.ps1
```

2. Open Chrome `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked:

```text
<ABSOLUTE_REPO_PATH>\extension
```

5. If the extension was already loaded before the latest code edits, click Update on `chrome://extensions`.
6. If Chrome shows per-site access toggles, allow:

```text
https://www.overleaf.com/*
http://127.0.0.1:38475/*
http://localhost:38475/*
```

7. Open or reload the Overleaf test project:

```text
Codex Free Sync Test 2026-07-02
```

The extension-to-bridge connection does not require pasting the bridge token into the popup. The token is still used by local tool scripts and MCP clients. This token is not an Overleaf credential.

## Smoke Test

Run:

```powershell
node scripts/live-smoke-test.js
```

Pass criteria:

- `connectedClients` is at least`1`.
- `health_check` shows at least one connected page.
- The script reports current project metadata and visible file-tree metadata.
- The output does not print manuscript text, source previews, cookies, sessions, or raw private project URLs.

## Write Test

Run a small insert into the test project only:

```powershell
node scripts/call-tool.js read_current_file "{""projectTitle"":""Codex Free Sync Test"",""expectedFileName"":""main.tex""}"
```

Copy the returned `beforeHash`, then run:

```powershell
node scripts/call-tool.js insert_text "{""projectTitle"":""Codex Free Sync Test"",""expectedFileName"":""main.tex"",""beforeHash"":""<BEFORE_HASH>"",""reason"":""Bridge live write test"",""text"":""% Bridge live write test\r\n""}"
```

Then run:

```powershell
node scripts/call-tool.js compile_and_read_log "{""projectTitle"":""Codex Free Sync Test"",""expectedFileName"":""main.tex""}"
```

Pass criteria:

- The inserted comment appears in Overleaf immediately.
- `%USERPROFILE%\.codex\overleaf-bridge\projects\...\patch-log.jsonl` has a new record.
- Recompile returns a visible status.
- Refreshing Overleaf keeps the inserted text.
- `restore_from_snapshot` can restore the returned `snapshotPath` after a fresh read supplies the current `beforeHash`.

## No-Op Release Gate

When only a real project tab is available, run the no-op release gate instead of inserting a marker:

```powershell
node scripts/live-noop-release-test.js
```

Pass criteria:

- The currently open project is connected.
- `paper_context`, `get_editor_diagnostics`, `read_current_file`, `replace_file`, and `compile_and_read_log` all return successfully.
- `replace_file`, `apply_patch_to_file`, and `restore_from_snapshot` each run with no content change, and the before/after hash remains unchanged.
- The output does not print manuscript text, only metadata, hashes, counts, and compile summary.

## Section No-Op Gate

For section-aware releases, run:

```powershell
node scripts/live-section-noop-test.js
```

Pass criteria:

- `get_sections` finds at least one LaTeX section in the current file.
- `get_section_content` returns section metadata, text length, and `beforeHash`.
- `replace_section` writes the same section body back with `preserveHeading=true`.
- The after hash equals the original hash.
- The output does not print manuscript text, only metadata, title/path, lengths, and hashes.

## Context Budget Gate

For low-token read releases, run:

```powershell
node scripts/live-context-budget-test.js
```

Pass criteria:

- `read_current_file` establishes a cached `beforeHash`.
- `contextBudget:"summary"` returns metadata and preview length without full text.
- `read_file_range` returns range metadata and a `rangeHash`.
- `read_file_since_hash` reports unchanged for the freshly cached hash.
- The output does not print manuscript text, only metadata, lengths, and hashes.

## Target Lock Gate

For multi-tab targeting releases, run this non-destructive check against the currently connected test tab:

```powershell
node scripts/live-target-lock-test.js
```

Pass criteria:

- The alias is stored in `.runtime/project-aliases.json`.
- `lock_target_project` returns one `targetLockId`, `clientId`, and project title.
- `list_target_locks` shows the active lock.
- A subsequent summary read can pass `targetLockId` and `expectedFileName` without printing manuscript text.
- The script clears the temporary alias and unlocks the target before exiting.
- Alias records contain only local alias names and project title matching text, not cookies, sessions, tokens, account project lists, or project IDs.

## Mirror Gate

For local mirror releases, run:

```powershell
node scripts/live-mirror-test.js
```

Pass criteria:

- `sync_project_snapshot` writes a local mirror root and `manifest.json`.
- The manifest includes file hashes, line counts, and section indexes when LaTeX sections exist.
- `find_in_project_mirror` can locate the current file from the mirror.
- `preview_mirror_diff` reports zero changed files immediately after sync.
- `prepare_mirror_sync_plan` returns `nonMutating:true`, a plan hash, a confirmation phrase, and no manuscript text.
- `execute_mirror_sync_plan` runs only approved mirror sync plans. `overleaf_to_mirror` creates a new local mirror snapshot. `mirror_to_overleaf` only updates existing files after fresh diff and `beforeHash` checks, and does not create or delete Overleaf files.
- The output does not print manuscript text, only metadata, paths, hashes, counts, and lengths.

## Local Export Gate

For read-only source/log export releases, run:

```powershell
node scripts/live-export-test.js
```

Pass criteria:

- `export_current_file` writes the current source file to the private local exports directory.
- `export_compile_log` writes visible compile status/log summary to the private local exports directory.
- No Overleaf files are created, renamed, deleted, uploaded, or overwritten.
- The output does not print manuscript text or compile log text, only metadata, hashes, counts, and paths.

## Artifact Inventory Gate

For metadata-only artifact discovery releases, run:

```powershell
node scripts/live-artifact-inventory-test.js
```

Pass criteria:

- `list_visible_artifacts` returns an artifacts array, even if the current page exposes no output links.
- `export_artifact_inventory` writes a local JSON inventory under the private exports directory.
- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating artifact counts as authoritative.
- The gate does not download private PDFs, `.bbl`, `.aux`, or other output binaries.
- The output does not print manuscript text or raw private artifact URLs, only metadata, artifact types, counts, and paths.

## Visible Artifact Export Gate

For read-only visible artifact export releases, run:

```powershell
node scripts/live-visible-artifact-export-test.js
```

Pass criteria:

- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating export support as available.
- If a visible downloadable artifact candidate exists, `export_visible_artifact` writes one private local file plus `manifest.json`.
- The output does not print artifact bytes, manuscript text, raw private URLs, cookies, or sessions; it prints only metadata, byte length, hash, MIME type, and local paths.
- The gate does not create, rename, delete, upload, or overwrite Overleaf project files.

## File Operation UI Gate

For read-only file-management readiness releases, run:

```powershell
node scripts/live-file-operation-ui-test.js
```

Pass criteria:

- `inspect_file_operation_ui` returns a controls array, even if no relevant controls are currently visible.
- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating operation counts as authoritative.
- The gate does not click create, rename, delete, upload, or menu controls.
- The output does not print manuscript text or raw private URLs, only metadata, operation types, counts, and reload status.

## Upload Workflow Gate

For read-only upload and image workflow releases, run:

```powershell
node scripts/live-upload-workflow-test.js
```

Pass criteria:

- `inspect_upload_workflow` returns upload control counts, accept values, drop zone counts, image candidate counts, and blockers.
- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating upload readiness as authoritative.
- The gate reports `requiresUserFilePicker: true` and `supportedLocalSelection: false`.
- The gate does not open file pickers, assign local file paths, upload files, click upload controls, print local filesystem paths, or mutate Overleaf files.

## Download Workflow Gate

For read-only download and export workflow releases, run:

```powershell
node scripts/live-download-workflow-test.js
```

Pass criteria:

- `inspect_download_workflow` returns download control counts, candidate counts, download types, non-mutating status, and blockers.
- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating download readiness as authoritative.
- The gate reports `requiresUserConfirmation: true` and `supportedDirectDownload: false`.
- The gate does not click download controls, download project ZIPs, fetch files, print raw private URLs, read cookies, or mutate Overleaf files.

## Comments Inspection Gate

For read-only comment and review-thread inspection releases, run:

```powershell
node scripts/live-comments-inspection-test.js
```

Pass criteria:

- `inspect_visible_comments` returns thread counts, action-control counts, non-mutating status, and blockers.
- If the connected tab still runs an older content script, the gate may pass with `reloadRequired: true`; reload the unpacked extension and rerun before treating comment counts as authoritative.
- The gate reports `nonMutating: true` and `supportsWriteActions: false`.
- The gate does not reply, resolve, reopen, delete comments, click collaboration controls, print full comment text, or mutate Overleaf files.

## Comment Action Plan Gate

For non-mutating comment action confirmation-plan releases, run:

```powershell
node scripts/live-prepare-comment-action-test.js
```

Pass criteria:

- `prepare_comment_action` returns a confirmation token, exact confirmation phrase prefix, thread-list hash, selected thread index when available, and `nonMutating: true`.
- The gate may report no visible comments or `reloadRequired: true`; that is acceptable until the comments panel is open and the unpacked extension is reloaded.
- The gate reports `supportsWriteActions: false`.
- The gate does not reply, resolve, reopen, delete comments, click collaboration controls, print full comment text, or mutate Overleaf files.

## File Operation Plan Gate

For non-mutating file-operation confirmation-plan releases, run:

```powershell
node scripts/live-prepare-file-operation-test.js
```

Pass criteria:

- `prepare_file_operation` returns a confirmation token, exact confirmation phrase, file-list hash, and `nonMutating: true`.
- The gate may report blockers or `reloadRequired: true`; that is acceptable until the unpacked extension is reloaded.
- The gate does not click create, rename, delete, upload, or menu controls.
- The output does not print manuscript text or raw private URLs.

## File Operation Execution Offline Gate

For guarded file-operation execution releases, run the normal offline test suite:

```powershell
npm test
```

Pass criteria:

- `execute_file_operation` rejects the wrong confirmation phrase.
- Fake-client create, rename, and delete operations pass after `prepare_file_operation`.
- The server requires the prepared confirmation token, exact phrase, file-list hash, matching project, and fresh file-tree hash before execution.
- Do not run live create, rename, or delete against a real Overleaf manuscript unless the user explicitly approves that exact operation.

## Stop Conditions

- If the extension cannot connect, make sure the unpacked extension is loaded from this repo's `extension/` directory and reload the Overleaf tab.
- If `connectedClients` remains`0`, reload the extension and the Overleaf tab.
- Do not run write tests on real paper projects until the test project passes.
