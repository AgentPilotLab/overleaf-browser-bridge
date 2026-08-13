$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Node = "node"
$Server = Join-Path $Root "server\overleaf-bridge-mcp.js"
$Extension = Join-Path $Root "extension"

Write-Host "Starting Overleaf Codex Bridge..."
Write-Host "Extension directory: $Extension"
Write-Host "After startup, load or update the unpacked extension and reload the Overleaf project tab."
Write-Host "The token in .runtime\bridge-token.txt is used by local tool scripts and MCP clients."
& $Node $Server
