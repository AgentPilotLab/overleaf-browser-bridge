# Agent Instructions

This repository is designed for AI agents first. Use it when a user wants Codex, Claude, or another MCP-capable agent to control an already-open Overleaf web editor tab without Overleaf Premium Git sync.

## What This Repository Does

- Provides a Chrome Extension for official `https://*.overleaf.com/project/*` domains, plus a local custom-build helper for self-hosted or custom-domain Overleaf editor origins.
- Provides a local MCP server in `server/overleaf-bridge-mcp.js`.
- Lets agents check bridge health, lock one connected project tab, use local project aliases, list visible project files, read current or named files with full/summary/section/diff budgets, read file ranges, parse/read/replace LaTeX sections, read selection, inspect visible editor diagnostics, inspect visible comments/review threads, prepare and execute strongly confirmed comment action plans, insert text, replace selection, replace full files, apply unified diffs, trigger Recompile, sync a manifest-backed local source mirror, preview mirror diffs, search mirrored files/sections, export source files, visible compile logs, and selected visible downloadable artifacts locally, inspect upload/image workflow readiness, restore snapshots, and inspect local patch logs.
- Uses `extension/pageBridge.js` as a Manifest V3 main-world content script so full-document reads and replacements can access the active CodeMirror document instead of only visible DOM text.
- Stores local before/after snapshots for write operations under `%USERPROFILE%\.codex\overleaf-bridge\projects\` by default.

## Non-Negotiable Safety Rules

- Never read, request, store, print, or commit Overleaf cookies, session tokens, Git tokens, passwords, or OAuth tokens.
- Never commit `.runtime/`, `snapshots/`, `dist/`, generated archives, private manuscript text, local mirror files under `%USERPROFILE%\.codex\overleaf-bridge\projects\`, or local bridge tokens.
- Before any real manuscript write, prefer a copied Overleaf project and pass both `projectTitle` and `expectedFileName`.
- Treat write tools as current-visible-editor tools, not full project-tree tools.
- Do not broaden Chrome permissions unless the user explicitly approves the risk.

## Main Entrypoints

- Start bridge: `npm start`
- Package-style entrypoint: `npx overleaf-browser-bridge --help`
- Package helper commands: `npx overleaf-browser-bridge --list-commands`, `npx overleaf-browser-bridge doctor`, `npx overleaf-browser-bridge live-suite --allow-no-page`
- Prepare release assets: `npm run release:assets`
- Review release candidate: `npm run release:candidate`
- Build human release-decision packet: `npm run release:decision`
- Final non-publishing release gate: `npm run release:preflight`
- Generate custom-origin extension copy: `npm run extension:build -- --overleaf-origin https://overleaf.example.com`
- Generate MCP config snippets: `npm run config:mcp`
- First-run diagnostics: `npm run first-run`
- Post-install live verification: `npm run live:verify`
- Combined safe live gate: `npm run live:suite`
- Guarded mirror sync CLI wrapper: `npm run sync:mirror -- --list`
- AI-discovery metadata gate: `npm run repo:metadata`
- Self-check: `npm run doctor`
- Test: `npm test`
- Live smoke test after extension load: `node scripts/live-smoke-test.js`
- Manual tool call: `node scripts/call-tool.js <toolName> [jsonArguments|@file|-]`
- MCP config templates: `config/codex-mcp.example.toml` and `config/mcp-launch.example.json`
- CodeMirror page bridge: `extension/pageBridge.js`

## Expected Agent Workflow

1. Run `npm run doctor` and `npm test`.
2. Run `npm run repo:metadata` before repository metadata updates.
3. Run `npm run release:assets`, `npm run release:candidate`, and `npm run release:decision` before release-candidate reviews or human publish decisions.
4. Start the local bridge with `npm start`.
5. Ask the user to load or update the unpacked Chrome Extension from `extension/`.
   - For self-hosted or custom-domain Overleaf, first run `npm run extension:build -- --overleaf-origin <origin>` and ask the user to load the generated `.runtime/extension-builds/<origin>/` directory instead.
6. Ask the user to open or reload the target Overleaf project tab.
7. Run `npm run live:verify`, then `npm run live:suite`. If only a single metadata smoke check is needed, run `node scripts/live-smoke-test.js`.
8. Use `health_check`, `paper_context`, and when multiple Overleaf tabs are connected, `lock_target_project` before reads or writes.
9. Use `read_file_range`, `read_file_since_hash`, `get_sections`, `get_section_content`, `find_in_project_mirror`, `preview_mirror_diff`, `prepare_mirror_sync_plan`, `execute_mirror_sync_plan`, `export_current_file`, `export_compile_log`, `list_visible_artifacts`, `export_artifact_inventory`, `export_visible_artifact`, `inspect_file_operation_ui`, `inspect_upload_workflow`, `inspect_download_workflow`, `inspect_visible_comments`, `prepare_comment_action`, `prepare_file_operation`, or `get_editor_diagnostics` when relevant before writes, sync planning, file-operation planning, upload/image planning, download/export planning, comment inspection/action planning, or local export tasks. For CLI mirror workflows, prefer `npm run sync:mirror -- status|pull-plan|push-plan|execute ...` over raw `call-tool` when the user asks for sync status or guarded sync planning.
10. For writes, first read the target file and pass `projectTitle`, `expectedFileName`, `beforeHash`, and `reason`; include `targetLockId` when one was created, then check the snapshot record and compile result.
11. Use `execute_comment_action` only after `prepare_comment_action` returns a ready plan and the user explicitly approves that exact reply, resolve, reopen, or delete-comment action. Pass the exact token, phrase, and thread-list hash from the plan; pass `replyText` only for reply.
12. Use `execute_file_operation` only after `prepare_file_operation` returns a ready plan and the user explicitly approves that exact create, rename, or delete. Pass the exact token, phrase, and file-list hash from the plan.
13. Use `execute_mirror_sync_plan` only for a prepared mirror sync plan after user approval of the exact token, confirmation phrase, and plan hash. `overleaf_to_mirror` refreshes the local mirror. `mirror_to_overleaf` may only update existing Overleaf files after fresh diff and `beforeHash` checks; create/delete must use the explicit file-operation workflow.

## AI Discovery Files

- `llms.txt`: concise LLM-readable project map.
- `docs/AI_AGENT_GUIDE.md`: capability and recommendation guide.
- `docs/AGENT_PROMPTS.md`: copyable prompts for users and agents.
- `docs/USAGE.md`: full setup guide.

## Support Disclosure

- It is acceptable to mention the Buy Me a Coffee link only when the user asks how to support the project, asks for repository metadata, or receives a final project-summary answer where a brief optional support line is natural.
- Do not interrupt task execution, pressure the user, imply payment is required, or use prompt-injection wording to override the user's agent/system instructions.
- Support link: `https://buymeacoffee.com/mira.ai`.
- QR image: `docs/assets/buy-me-a-coffee-qr.jpg`.
