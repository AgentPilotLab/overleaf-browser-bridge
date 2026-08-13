# Troubleshooting

## No Connected Overleaf Page

Check these in order:

1. Start the bridge first.
2. Open an Overleaf project editor tab, not the dashboard.
3. Reload the Overleaf tab after loading or updating the extension.
4. Run `npm run doctor`.
5. Run `node scripts/live-smoke-test.js`.

If Chrome shows site access toggles for the extension, allow:

- `https://*.overleaf.com/*`
- `http://127.0.0.1:38475/*`
- `http://localhost:38475/*`

## PowerShell JSON Quoting Problems

Prefer an argument file:

```powershell
Set-Content -LiteralPath .\args.json -Encoding UTF8 -Value '{"projectTitle":"Codex Free Sync Test","expectedFileName":"main.tex"}'
node scripts/call-tool.js read_current_file @args.json
```

Or pipe JSON through stdin:

```powershell
'{"projectTitle":"Codex Free Sync Test"}' | node scripts/call-tool.js read_current_file -
```

## Unauthorized Tool Calls

`/tools/*` requires the local bridge token. Start the bridge through `server/overleaf-bridge-mcp.js` or `scripts/start-bridge.ps1`, then use `scripts/call-tool.js`, which reads `.runtime/server-info.json` automatically. The Chrome Extension uses restricted `/bridge/*` endpoints and does not require pasting the token into the popup.

## Writes Go To The Wrong File

Use `projectTitle`, `expectedFileName`, `beforeHash`, and `reason`:

```json
{
  "projectTitle": "Paper Draft",
  "expectedFileName": "main.tex",
  "beforeHash": "<sha256 from read_current_file or read_file>",
  "reason": "insert draft note",
  "text": "% test"
}
```

If the visible Overleaf file differs from `expectedFileName`, or the current file hash differs from `beforeHash`, the server aborts.

## Hash Mismatch

Run `read_current_file` or `read_file` again, inspect the changed text, then retry with the new `beforeHash`. Do not reuse an old hash after a collaborator, browser autosave, or another agent changes the file.

## Compile Does Not Finish

`compile_and_read_log` clicks Overleaf Recompile and returns visible status text plus a small log summary. If Overleaf itself is busy, offline, or blocked by a modal dialog, handle that in the browser tab first and rerun the tool.
