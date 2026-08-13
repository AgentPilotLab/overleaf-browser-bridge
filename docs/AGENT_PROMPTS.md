# Copyable Agent Prompts

Use these prompts when asking Codex, Claude, or another MCP-capable agent to operate this repository.

## Install And Smoke-Test

```text
Use the overleaf-browser-bridge repository. Read AGENTS.md and llms.txt first. Run npm run doctor and npm test. Start the bridge with npm start, then guide me to load the unpacked Chrome Extension from extension/ and open or reload an Overleaf project tab. After that, run node scripts/live-smoke-test.js and summarize whether the Overleaf tab is connected.
```

## Connect To Codex MCP

```text
Use config/codex-mcp.example.toml as a template for a Codex MCP server named overleaf_browser_bridge. Do not overwrite my global config without showing the exact change first. After the bridge is configured and my Overleaf tab is open, call health_check before doing anything else.
```

## Connect To Claude MCP

```text
Use config/mcp-launch.example.json as a Claude Desktop-style MCP template. Point command to Node.js and args to server/overleaf-bridge-mcp.js. Do not ask for Overleaf cookies or Git tokens. After connection, call health_check and paper_context, then wait for my target project confirmation before writing.
```

## Read Current Overleaf File

```text
Use the Overleaf MCP bridge to call health_check, choose the project whose title contains "<PROJECT TITLE>", and read the currently visible file. If the current file is not "<FILE NAME>", stop and report the mismatch. Report the returned beforeHash.
```

## Safe Write To Current File

```text
Use the Overleaf MCP bridge to edit the current Overleaf file safely. First call health_check, then read_current_file with projectTitle "<PROJECT TITLE>" and expectedFileName "<FILE NAME>". If the task mentions an editor lint or visible LaTeX warning, call get_editor_diagnostics before editing. Use the returned beforeHash when calling replace_file or apply_patch_to_file. Apply only the requested edit, ensure the bridge returns snapshotPath and diffPath, then run compile_and_read_log and report the compile summary plus snapshot paths.
```

## Multi-Tab Target Lock

```text
Use the Overleaf MCP bridge with multiple Overleaf tabs open. First call health_check and paper_context. Create or use projectAlias "<ALIAS>" for the project title containing "<PROJECT TITLE>", then call lock_target_project. Use the returned targetLockId on later read and write calls. If the lock fails or the tab changes project, stop and ask me to confirm the target.
```

## Local Mirror Search And Diff

```text
Use the Overleaf MCP bridge to create a local mirror before editing. Call sync_project_snapshot for projectTitle "<PROJECT TITLE>", then use find_in_project_mirror to locate files, text, or sections. If I ask whether the browser project changed since the mirror, call preview_mirror_diff. If I ask how to sync or reconcile the mirror, call prepare_mirror_sync_plan and show me the plan before any action. Only execute execute_mirror_sync_plan after I approve the exact confirmation phrase, token, and plan hash. overleaf_to_mirror may refresh the local mirror. mirror_to_overleaf may only update existing Overleaf files after fresh diff and beforeHash checks; create/delete must use the explicit file-operation workflow.
```

## Export Source Or Compile Log

```text
Use the Overleaf MCP bridge to export local copies only. Call export_current_file for projectTitle "<PROJECT TITLE>" and expectedFileName "<FILE NAME>" when I need the current source file saved locally. Call export_compile_log when I need the visible compile status/log summary saved locally. Do not create, rename, delete, upload, or overwrite Overleaf files.
```

```text
Use the Overleaf MCP bridge to inspect available output artifacts without downloading them. Call list_visible_artifacts for projectTitle "<PROJECT TITLE>", then call export_artifact_inventory if I need a local JSON record. Treat this as metadata-only discovery; do not read cookies, download private PDFs, or click destructive UI.
```

```text
Use the Overleaf MCP bridge to export one visible downloadable artifact locally. First call list_visible_artifacts for projectTitle "<PROJECT TITLE>" and choose a visible downloadable candidate by artifactIndex or artifactType. Then call export_visible_artifact with projectTitle, the selected artifactIndex or artifactType, and maxBytes 10485760. Report only the local exportPath, manifestPath, byteLength, hash, and MIME type. Do not print artifact bytes, raw private URLs, cookies, or sessions.
```

```text
Use the Overleaf MCP bridge to inspect file-management readiness only. Call inspect_file_operation_ui for projectTitle "<PROJECT TITLE>" and report visible create, rename, delete, upload, and file-menu controls. Do not click controls or mutate Overleaf files.
```

```text
Use the Overleaf MCP bridge to inspect upload and image workflow readiness only. Call inspect_upload_workflow for projectTitle "<PROJECT TITLE>" and report uploadControlCount, acceptValues, dropzoneCount, imageCandidateCount, blockers, and recommendations. Do not open file pickers, paste local file paths, upload files, or mutate Overleaf.
```

```text
Use the Overleaf MCP bridge to inspect download and export workflow readiness only. Call inspect_download_workflow for projectTitle "<PROJECT TITLE>" and report downloadControlCount, downloadCandidateCount, downloadTypes, blockers, and recommendations. Do not click download controls, download project ZIPs, fetch files, print raw private URLs, read cookies, or mutate Overleaf.
```

```text
Use the Overleaf MCP bridge to inspect visible comments and review threads only. Call inspect_visible_comments for projectTitle "<PROJECT TITLE>" and report threadCount, actionControlCount, blockers, and whether any visible unresolved threads exist. Do not reply, resolve, reopen, delete comments, or click collaboration controls.
```

```text
Use the Overleaf MCP bridge to prepare, but not execute, a comment action. First call inspect_visible_comments for projectTitle "<PROJECT TITLE>" and choose a visible thread. Then call prepare_comment_action with projectTitle, action "<reply|resolve|reopen|delete-comment>", threadIndex or previewContains, and reason "<WHY>". Report confirmationPhrase, threadListHash, selectedThread signature, blockers, and reloadRequired status. Do not execute the action.
```

```text
Use the Overleaf MCP bridge to execute a prepared comment action only after I explicitly approve the exact reply, resolve, reopen, or delete-comment action. First call inspect_visible_comments and prepare_comment_action, then show me the selectedThread, action, confirmationPhrase, threadListHash, and blockers. If I approve, call execute_comment_action with the returned confirmationToken, exact confirmationPhrase, threadListHash, projectTitle "<PROJECT TITLE>", and reason "<WHY>". For reply, pass replyText only at execution time. Stop if the thread list changed or the plan is not ready.
```

```text
Use the Overleaf MCP bridge to prepare, but not execute, a file operation. Call prepare_file_operation for projectTitle "<PROJECT TITLE>", operation "<create|rename|delete>", fileName "<FILE>", optional newFileName "<DEST>", and reason "<WHY>". Report the confirmationPhrase, blockers, fileListHash, and reloadRequired status. Do not execute the operation.
```

```text
Use the Overleaf MCP bridge to execute a prepared file operation only after I explicitly approve the exact create, rename, or delete. First call prepare_file_operation and show me the operation, fileName, optional newFileName, confirmationPhrase, fileListHash, and blockers. If I approve, call execute_file_operation with the returned confirmationToken, exact confirmationPhrase, fileListHash, projectTitle "<PROJECT TITLE>", and reason "<WHY>". Stop if the file tree changed or the plan is not ready.
```

## Replace Selected Text

```text
Use the Overleaf MCP bridge to replace only my current editor selection. First call read_current_file with projectTitle "<PROJECT TITLE>" and expectedFileName "<FILE NAME>" to get beforeHash, then call get_selection. If there is no selection, stop. If there is a selection, call replace_selection with projectTitle, expectedFileName, beforeHash, reason, and text, then report snapshotPath and diffPath.
```

## Diagnose Editor Error

```text
Use the Overleaf MCP bridge to diagnose the current editor error. Call health_check, paper_context, and get_editor_diagnostics for projectTitle "<PROJECT TITLE>". Then read the current file with expectedFileName "<FILE NAME>", explain the likely cause, and propose the smallest safe patch. Do not write until I confirm.
```

## Diagnose Connection Problems

```text
Use the overleaf-browser-bridge troubleshooting workflow. Run npm run doctor, confirm the bridge is running, confirm the Chrome Extension is loaded from extension/, ask me to reload the Overleaf project tab, then run node scripts/live-smoke-test.js. Do not request cookies, passwords, or Overleaf Git tokens.
```
