$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ManifestPath = Join-Path $Root "extension\manifest.json"
$DistDir = Join-Path $Root "dist"

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Missing extension manifest: $ManifestPath"
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = $Manifest.version
if (-not $Version) {
  throw "Missing manifest version"
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$ZipPath = Join-Path $DistDir "overleaf-browser-bridge-v$Version.zip"
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

$ExtensionFiles = @(
  "manifest.json",
  "background.js",
  "contentScript.js",
  "pageBridge.js",
  "popup.html",
  "popup.js"
) | ForEach-Object { Join-Path $Root "extension\$_" }

foreach ($File in $ExtensionFiles) {
  if (-not (Test-Path -LiteralPath $File)) {
    throw "Missing extension package file: $File"
  }
}

Compress-Archive -Path $ExtensionFiles -DestinationPath $ZipPath -CompressionLevel Optimal -Force
Write-Host "Packaged extension: $ZipPath"
