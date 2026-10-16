# Changelog

## 0.5.32 - 2026-10-16

- Update React-controlled Overleaf file-name inputs through the native value setter before dispatching input events.
- Require the create or rename dialog to close after confirmation before treating the operation as submitted.

## 0.5.31 - 2026-10-16

- Detect unrelated visible Overleaf dialogs before file creation instead of clicking through an overlay.
- Recognize Chinese file-name fields and confirmation actions while excluding Chinese sharing and invitation inputs.
- Scope create and rename confirmation buttons to the active file-operation dialog.

## 0.5.30 - 2026-10-16

- Recognize localized Overleaf file-tree actions, including Chinese `新建文件`, without confusing editor menus or PDF zoom controls for file operations.
- Treat a refreshed Overleaf PDF build URL as successful compile completion when the log panel remains closed, while leaving unavailable error and warning counts unknown.
- Require file-operation UI schema 8 so stale 0.5.29 content scripts are detected after extension reloads.

## 0.5.29 - 2026-08-13

- Added localized compile-button detection for English and Chinese Overleaf interfaces.
- Kept compile-options controls excluded from the compile action and added DOM regression coverage.

## 0.5.28 - 2026-08-13

- Changed extension command polling to authenticated-origin POST requests while retaining GET compatibility for older clients.
- Added a regional-origin integration test covering register, command polling, and result delivery through the bridge protocol.

## 0.5.27 - 2026-08-13

- Routed local bridge HTTP traffic through an extension service worker so regional Overleaf pages do not depend on per-site local-network access.
- Restricted the service worker proxy to the bridge register, poll, and result endpoints.
- Kept pending browser commands attached to the response lifecycle so service-worker long polls receive queued work reliably.
- Updated popup project detection and extension build assets for official Overleaf subdomains.

## 0.5.26 - 2026-08-13

- Added Chrome Extension support for official regional Overleaf hosts through `https://*.overleaf.com/project/*`, including `cn.overleaf.com`.
- Updated bridge Origin authorization to accept HTTPS Overleaf subdomains while rejecting lookalike domains.
- Added regression coverage and documentation for regional-host setup and live verification.

## 0.5.25 - 2026-07-26

- Fixed compile status parsing so explicit `Errors0` and `Warnings0` counts take priority over keyword counting.
- Normalized `compile_and_read_log` top-level `visibleStatus` from the parsed compile summary to avoid stale UI status text.
- Parsed `Output written on output.pdf (N pages, ...)` for reliable page counts.

## 0.5.24 - 2026-07-06

- Restored reliable Overleaf folder detection for real file-tree folders whose tree items only expose `aria-label` and `aria-expanded`.
- Kept LaTeX outline headings out of `visibleFolders` by excluding tree items under Overleaf `outline-*` containers.
- Derived nested file paths from Overleaf's nested `role=tree` DOM structure when tree items do not provide `aria-level`.
- Allowed basename-vs-path matches for current-file safety checks, so tools can read/write `sections/file.tex` when Overleaf reports the current editor file as `file.tex`.
- Raised the file-operation UI schema to v7 so stale `0.5.21` through `0.5.23` pages must be reloaded before nested create operations.

## 0.5.21 - 2026-07-06

- Tightened folder detection so LaTeX outline tree items are excluded from `visibleFolders`.
- Raised the file-operation UI schema to v4 so stale `0.5.20` pages must be reloaded before nested create operations.

## 0.5.20 - 2026-07-06

- Scoped file-tree scanning to the real Overleaf file panel so LaTeX outline headings are no longer reported as folders.
- Expanded the parent folder before nested file creation and revealed the created file before server-side verification.
- Broadened file-name detection so extension-bearing project files and `README` are not misreported as folders.

## 0.5.19 - 2026-07-06

- Added a file-operation UI schema marker so the bridge can distinguish refreshed content scripts from stale injected pages.
- `prepare_file_operation` now reports a reload-required blocker for stale file-operation UI schemas instead of misreporting nested folders as invisible.
- `npm run live:verify` now checks the non-mutating file-operation UI schema on connected pages in addition to the content script version.

## 0.5.18 - 2026-07-05

- Added `npm run sync:mirror` and `scripts/mirror-sync-workflow.js` for guarded mirror status, review-plan, pull-plan, push-plan, and execute workflows.
- Added package CLI alias `sync-mirror` for future npm/npx users.
- The wrapper strips raw diff text from status output by default and still requires confirmation token, exact phrase, and sync plan hash before execution.

## 0.5.17 - 2026-07-05

- Added `npm run release:decision` and `scripts/release-decision-report.js` to generate a local human release-decision packet from the current release candidate.
- The report summarizes prepared release assets, recommended repository metadata, install paths, and explicit GitHub Release, npm, Chrome Web Store, and repository metadata decisions.
- Added the decision packet check to the package CLI and `npm run release:preflight`; it performs no GitHub API calls, npm publication, Chrome Web Store submission, or repository visibility changes.

## 0.5.16 - 2026-07-05

- Added guarded `mirror_to_overleaf` execution for update-only mirror sync plans.
- The executor now rechecks the mirror diff, validates the prepared `syncPlanHash`, requires the exact confirmation phrase, reads each current Overleaf file, verifies `beforeHash`, writes through the snapshot-protected `replace_file` path, and verifies the final hash matches the mirror file.
- `mirror_to_overleaf` plans that would create or delete Overleaf files remain blocked and must use the explicit file-operation approval workflow instead.

## 0.5.15 - 2026-07-05

- Added `npm run release:candidate` and `scripts/release-candidate-check.js` as a non-publishing release-candidate review gate.
- The check summarizes prepared release assets, npm package dry-run status, repository metadata, install paths, human decision boundaries, and no-publish status.
- Exposed the same check through the package CLI as `release:candidate` and `release-candidate`, and included it in `npm run release:preflight`.

## 0.5.14 - 2026-07-05

- Added `npm run repo:metadata` and `scripts/repository-metadata-check.js` as a local read-only repository metadata readiness gate for AI discovery, license/support disclosure, privacy-sensitive metadata, and no-publish boundaries.
- Exposed the same check through the package CLI as `repo:metadata` and `repo-metadata`.
- Included repository metadata readiness in `npm run release:preflight` so release checks cover AI entry points before packaging.

## 0.5.13 - 2026-07-05

- Added MCP tool `execute_mirror_sync_plan` for the safe `overleaf_to_mirror` path.
- The executor requires a prepared sync plan token, exact confirmation phrase, matching `syncPlanHash`, matching project, and a fresh mirror diff check before creating a new local mirror snapshot.
- It only writes a new local mirror and latest-manifest pointer; it never uploads to Overleaf, deletes Overleaf files, or executes `mirror_to_overleaf` plans.

## 0.5.12 - 2026-07-05

- Added MCP tool `prepare_mirror_sync_plan` for non-mutating sync planning between the current open Overleaf project and a local mirror snapshot.
- The plan classifies changed, added, and removed files into review actions for `review_only`, `overleaf_to_mirror`, or `mirror_to_overleaf` direction, with a plan hash, confirmation token, exact phrase, blockers, and `nonMutating:true`.
- The tool does not write Overleaf, does not update mirror files, and keeps full sync execution gated on future explicit user approval and fresh hash checks.

## 0.5.11 - 2026-07-05

- Added package CLI subcommands so future npm/npx users can run `doctor`, `first-run`, `config:mcp`, `live:verify`, `live:suite`, `release:assets`, `release:preflight`, `extension:build`, `package:npm`, and `call-tool` through `overleaf-browser-bridge`.
- Kept the existing server launch behavior: passing `--port`, `--token`, or `--snapshot-dir` still starts the local MCP stdio server.
- Added `--list-commands` and test coverage for CLI command discovery and the `live-suite --list` alias path.

## 0.5.10 - 2026-07-05

- Added `npm run live:suite` and `scripts/live-safe-suite.js` as the combined safe browser-side validation gate.
- The suite checks live bridge/page/version readiness, then runs metadata-only, read-only, and non-mutating planning gates for smoke, download workflow, artifact inventory, file-operation UI, upload workflow, visible comments, prepared file operations, and prepared comment actions.
- The suite does not execute file operations, comment actions, uploads, downloads, or manuscript writes, and reports `blocked_no_page` when no Overleaf project tab is connected.

## 0.5.9 - 2026-07-05

- Added `npm run extension:build` and `scripts/prepare-extension-build.js` for self-hosted or custom-domain Overleaf editor origins.
- The helper generates an ignored local extension copy under `.runtime/extension-builds/`, rewrites only the generated manifest and default bridge origin, and marks the output `safeToCommit:false`.
- The tracked default Chrome Extension remains scoped to official `https://*.overleaf.com/project/*` domains and keeps the same no-cookie/no-history/no-tabs permission boundary.

## 0.5.8 - 2026-07-05

- Added `npm run release:preflight` and `scripts/release-preflight.js` as a consolidated non-publishing release gate.
- The preflight runs version checks, doctor, tests, first-run diagnostics, offline live verification, MCP config generation, release asset preparation, unstaged/staged diff checks, tracked-source privacy scanning, and a no-publish boundary check.
- Added test coverage for the preflight plan so future releases keep the privacy scan and no-publish gate visible.

## 0.5.7 - 2026-07-05

- Hardened `scripts/live-smoke-test.js` into a metadata-only connection smoke test.
- The smoke test no longer calls `read_current_file` or `paper_context`; it checks bridge health, current project metadata, and visible file-tree metadata without reading or printing manuscript text.
- Added test coverage that prevents the smoke script from reintroducing current-file previews.

## 0.5.6 - 2026-07-05

- Added `inspect_download_workflow` for read-only Overleaf download/export workflow inspection.
- The tool reports visible download controls, source-file candidates, visible artifact candidates, redacted URLs, blockers, and hard boundaries: `supportedDirectDownload: false` and `requiresUserConfirmation: true`.
- Added fake-client tests, stale content-script diagnostics, docs, and a live metadata-only download workflow gate. It does not click controls, download project ZIPs, fetch files, read cookies, or expose raw private URLs.

## 0.5.5 - 2026-07-05

- Added `execute_comment_action` for guarded execution of prepared visible comment actions.
- Execution requires the short-lived confirmation token, exact confirmation phrase, prepared thread-list hash, matching project, fresh visible-thread hash check, and explicit user approval for the exact action.
- Added fake-client tests for resolve, reopen, delete-comment, and wrong confirmation phrase rejection. Live comment mutation is not part of the default release gate.

## 0.5.4 - 2026-07-05

- Added `npm run live:verify` and `scripts/post-install-live-check.js` for post-install live bridge verification.
- The live verifier checks the token-protected bridge tool API, connected Overleaf tabs, and whether every connected page reports the current content script version.
- Missing offline state can be treated as a warning with `--allow-offline`; the verifier does not read Overleaf credentials or manuscript text.

## 0.5.3 - 2026-07-05

- Added `npm run first-run` and `scripts/first-run-check.js` for local setup diagnostics.
- The first-run checker validates Node.js, required files, version consistency, package metadata, local MCP config generation, and optional live bridge reachability.
- Generated first-run artifacts stay under ignored `.runtime/first-run/`; the checker does not read Overleaf credentials or manuscript text.

## 0.5.2 - 2026-07-05

- Added `npm run config:mcp` and `scripts/generate-mcp-config.js` to generate local Codex and Claude-style MCP configuration snippets.
- Generated config files are written under `.runtime/generated-configs/` by default and are treated as private local install helpers because they may contain absolute paths.
- Updated installation docs, AI guide, usage guide, release checklist, and tests for the config generation workflow.

## 0.5.1 - 2026-07-05

- Added `npm run release:assets` to prepare local GitHub Release asset bundles without publishing or changing repository visibility.
- Release asset preparation builds the extension zip, verifies its file whitelist, runs the npm package dry-run check, and writes `release-assets-manifest.json`, `SHA256SUMS.txt`, and draft `RELEASE_NOTES.md` under `dist/release-v<version>/`.
- Added installation documentation covering source installs, release zip installs, and package-style MCP entrypoints.

## 0.5.0 - 2026-07-05

- Added package-style CLI entrypoints `overleaf-browser-bridge` and `overleaf-browser-bridge-mcp` for future npm/npx launches.
- Added package metadata, npm files whitelist, repository metadata, and `npm run package:npm` dry-run validation.
- Exported the stdio server runner for the CLI wrapper and added tests for `--help`, `--version`, and MCP server version metadata.
- Updated publishing docs and release gates to verify npm package contents without publishing.

## 0.4.1 - 2026-07-05

- Added `prepare_comment_action` to create non-mutating confirmation plans for future visible comment reply, resolve, reopen, and delete-comment actions.
- Plans include a selected thread signature, visible thread-list hash, short-lived confirmation token, exact confirmation phrase, UI summary, blockers, and `nonMutating: true`.
- Added fake-client tests, docs, and a live metadata-only comment action planning gate. No comment execution tool was added.

## 0.4.0 - 2026-07-05

- Added `inspect_visible_comments` for read-only visible Overleaf comment and review-thread inspection.
- The tool reports thread counts, short previews, line hints when present, and reply/resolve/reopen control metadata without clicking controls or mutating collaboration state.
- Added fake-client tests, stale content-script diagnostics, docs, and a live metadata-only comment inspection gate.

## 0.3.8 - 2026-07-05

- Added `inspect_upload_workflow` to inspect visible Overleaf upload controls, file input constraints, drop zones, and existing image candidates without opening a picker or uploading files.
- The tool reports `requiresUserFilePicker: true`, `supportedLocalSelection: false`, and explicit blockers explaining why content scripts cannot assign local files to `input[type=file]`.
- Added fake-client tests, stale content-script diagnostics, docs, and a live metadata-only upload workflow gate.

## 0.3.7 - 2026-07-05

- Added `export_visible_artifact` to export one visible downloadable Overleaf artifact candidate, such as a PDF or generated output file, to the local private exports directory.
- The browser page fetches only visible artifact URLs and returns bytes through the local bridge without exposing Overleaf cookies, sessions, Git tokens, or raw private URLs.
- Added byte-size limits, local binary export manifests, stale content-script diagnostics, fake-client tests, and a live metadata-only export gate script.

## 0.3.6 - 2026-07-05

- Added `execute_file_operation` for guarded execution of prepared create, rename, and delete file operations.
- Execution requires the short-lived confirmation token, exact confirmation phrase, prepared file-list hash, matching project title, a ready plan, and a fresh visible file-tree hash check before clicking Overleaf controls.
- Added post-execution verification that confirms created files appear, renamed files move to the destination, and deleted files disappear.
- Added fake-client tests for create, rename, delete, and wrong confirmation phrase rejection. No real live mutation gate was added for this release.

## 0.3.5 - 2026-07-05

- Added `prepare_file_operation` to create non-mutating confirmation plans for future create, rename, and delete file operations.
- Plans include a short-lived confirmation token, exact confirmation phrase, visible file-list hash, UI readiness summary, blockers, and `nonMutating: true`.
- Added tests and a live gate proving the planning path does not click or change Overleaf files.

## 0.3.4 - 2026-07-05

- Added `inspect_file_operation_ui` for read-only discovery of visible create, rename, delete, upload, and file-menu controls in the open Overleaf page.
- Added stale-extension diagnostics for the file-operation UI inspector so agents get `reloadRequired` instead of raw unknown-command failures.
- Added tests and a live gate for file-operation UI readiness without clicking or changing Overleaf project files.

## 0.3.3 - 2026-07-05

- Added structured stale-extension diagnostics for `list_visible_artifacts` when Chrome is still running an older content script.
- `export_artifact_inventory` now writes a metadata-only diagnostic inventory with `reloadRequired`, `reason`, and `contentScriptVersion` instead of failing with a 500 for stale unpacked extensions.
- Updated the live artifact inventory gate to surface reload-required status safely.

## 0.3.2 - 2026-07-05

- Added `list_visible_artifacts` to inspect visible PDF/log/download artifact candidates from the already-open Overleaf page without downloading files.
- Added `export_artifact_inventory` to save a private local JSON inventory of visible artifact candidates.
- Added tests and a live artifact inventory gate for the read-only artifact discovery workflow.
- Kept artifact handling metadata-only; no cookie/session extraction or private binary download path was added.

## 0.3.1 - 2026-07-05

- Added read-only local export tools: `export_current_file` and `export_compile_log`.
- Source exports save the current or named editor file under the private local exports directory with manifest metadata.
- Compile-log exports save visible compile status and log summaries locally without cookies, Git tokens, or Overleaf project archive downloads.
- Added tests for source-file export and compile-log export.

## 0.3.0 - 2026-07-05

- Enhanced `sync_project_snapshot` to write a readable local mirror with `manifest.json`, `latest-manifest.json`, file hashes, line counts, and LaTeX section indexes.
- Added `preview_mirror_diff` for read-only comparison between the current open Overleaf tab and a local mirror snapshot.
- Added `find_in_project_mirror` for local mirror file lookup, text search, and LaTeX section lookup.
- Added tests for mirror manifest generation, latest mirror resolution, mirror text/section lookup, and mirror diff preview.
- Kept the mirror workflow export-and-preview only; no automatic bidirectional sync or write-back was added.

## 0.2.15 - 2026-07-04

- Added multi-tab target routing helpers: `list_project_aliases`, `set_project_alias`, `clear_project_alias`, `lock_target_project`, `unlock_target_project`, and `list_target_locks`.
- Added `projectAlias` and `targetLockId` targeting fields so agents can reuse a stable connected-tab target when multiple Overleaf projects are open.
- Added local alias persistence in `.runtime/project-aliases.json` by default. Alias records store title matching text only, never Overleaf credentials or account project lists.
- Added target-lock validation that rejects calls when a locked browser tab changes to a different project.
- Added tests for alias reads, lock reads, multi-tab health summaries, and changed-project lock rejection.
- Added `scripts/live-target-lock-test.js` for a non-destructive live alias and target-lock gate.

## 0.2.14 - 2026-07-04

- Added low-token read tools: `read_file_range` and `read_file_since_hash`.
- Added `contextBudget` / `context_budget` modes for `read_current_file` and `read_file`: `full`, `summary`, `section`, and `diff`.
- Added bounded line-diff summaries backed by this bridge server's read cache.
- Added tests for range reads, summary reads, section-budget reads, changed diff reads, and unchanged repeated reads.

## 0.2.13 - 2026-07-04

- Added section-aware LaTeX MCP tools: `get_sections`, `get_section_content`, and `replace_section`.
- Added a lightweight original section parser for `part`, `chapter`, `section`, `subsection`, `subsubsection`, `paragraph`, and `subparagraph` headings.
- Reused existing hash-checked full-file replacement, snapshots, diffs, and restore path for section writes.
- Added tests for ignored commented headings, nested paths, section content reads, and section body replacement.

## 0.2.12 - 2026-07-04

- Pruned stale browser clients before tool routing so old content-script registrations no longer block project-title selection after extension reloads.
- Added a regression test for stale duplicate project clients.
- Packaged only the required Chrome Extension files, excluding local backup files from release zips.
- Added the release checklist, live no-op gate documentation, and browser-bridge positioning notes for private beta release review.

## 0.2.11 - 2026-07-04

- Added `get_editor_diagnostics` for focused CodeMirror lint, diagnostic, and tooltip messages.
- Truncated diagnostic fields so agents can inspect current editor-reported issues without returning full editor or PDF-preview text.
- Injected `pageBridge.js` as a Manifest V3 main-world content script for CodeMirror document access.
- Reworked full-file replacement to use minimal-range chunked edits with page-side verification.

## 0.2.10 - 2026-07-04

- Added early editor diagnostic reading for visible Overleaf lint and error UI.

## 0.2.9 - 2026-07-04

- Moved CodeMirror page access to `pageBridge.js` as a Manifest V3 main-world content script.
- Removed inline page-bridge injection from `contentScript.js` to avoid Overleaf CSP blocking script execution.

## 0.2.8 - 2026-07-04

- Reworked full-file replacement in the page bridge to use minimal-range chunked edits instead of one large CodeMirror transaction.
- Added page-side verification after replacement so failed editor writes surface as explicit errors.

## 0.2.7 - 2026-07-04

- Removed `web_accessible_resources` from the Manifest V3 file to avoid Chrome rejecting the unpacked extension on that field.
- Inlined the page-world CodeMirror bridge injection from `contentScript.js`, later replaced by the main-world content script approach.

## 0.2.6 - 2026-07-04

- Surface page-bridge read failures instead of silently falling back to visible editor DOM reads.

## 0.2.5 - 2026-07-04

- Wait for the page-world bridge script to load before sending read or replace commands.
- Make full-document replacement fail loudly if the page bridge fails instead of falling back to visible DOM insertion.
- Simplify the CodeMirror replacement transaction to replace document text only.

## 0.2.4 - 2026-07-04

- Fixed Chrome manifest loading by using an origin-wide `web_accessible_resources.matches` pattern for Overleaf.
- Kept extension, package, and content script versions aligned at 0.2.4.

## 0.2.3 - 2026-07-04

- Added a page-world CodeMirror bridge for full-document reads and replacements in long Overleaf source files.
- Kept extension, package, and content script versions aligned at 0.2.3.

## 0.1.1 - 2026-07-02

- Added tokenless extension-to-local-bridge registration while keeping local tool calls token-protected.
- Added server-side cleanup for Overleaf icon text in project and file labels.
- Added JSONL and `Content-Length` stdio framing support for MCP clients.
- Added local HTTP tool API for smoke testing.
- Added live test checklist, MCP config examples, and release-readiness docs.
- Verified live against the Overleaf test project `Codex Free Sync Test 2026-07-02`.

## 0.1.0 - 2026-07-02

- Initial Chrome Extension and local MCP bridge.
- Added tools for current project metadata, file reading, selection, insertion, replacement, compile, snapshots, and patch logs.
- Added fake Overleaf client tests.
