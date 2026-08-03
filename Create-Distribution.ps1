param(
  [string]$Version = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $appRoot "package.json") | ConvertFrom-Json
if (-not $Version) {
  $Version = [string]$packageJson.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
  throw "Invalid package version: $Version"
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $appRoot "dist"
}

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path -LiteralPath $bundledNode) {
  $nodePath = $bundledNode
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $nodePath = if ($node) { $node.Source } else { "" }
}
if (-not $nodePath) {
  throw "Node.js was not found. Install Node.js 18 or newer before packaging."
}
& $nodePath --check (Join-Path $appRoot "server.js")
if ($LASTEXITCODE -ne 0) { throw "Server syntax validation failed." }
& $nodePath --check (Join-Path $appRoot "public\app.js")
if ($LASTEXITCODE -ne 0) { throw "Browser script syntax validation failed." }
& $nodePath --check (Join-Path $appRoot "public\geometry.mjs")
if ($LASTEXITCODE -ne 0) { throw "Geometry module syntax validation failed." }
Push-Location $appRoot
try {
  & $nodePath --test
  if ($LASTEXITCODE -ne 0) { throw "Automated tests failed." }
} finally {
  Pop-Location
}

$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$packageName = "AstroBin-Sky-Mapper-$Version"
$stageRoot = Join-Path $OutputDirectory $packageName
$zipPath = Join-Path $OutputDirectory "$packageName.zip"
$checksumPath = "$zipPath.sha256"

$stageRoot = [System.IO.Path]::GetFullPath($stageRoot)
if (-not $stageRoot.StartsWith($OutputDirectory + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Unsafe staging path: $stageRoot"
}

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path $checksumPath) {
  Remove-Item -LiteralPath $checksumPath -Force
}

New-Item -ItemType Directory -Path $stageRoot | Out-Null

$excludeNames = @(
  "config.json",
  "server.log",
  "celestial-overlay-preview.png",
  "dist",
  "data",
  "tests",
  ".git",
  ".github",
  ".gitignore"
)

Get-ChildItem -LiteralPath $appRoot -Force | ForEach-Object {
  if ($excludeNames -contains $_.Name) {
    return
  }

  $target = Join-Path $stageRoot $_.Name
  if ($_.PSIsContainer) {
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
  } else {
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
  }
}

$dataDir = Join-Path $stageRoot "data"
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir | Out-Null
}
@{
  version = 1
  images = @{}
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dataDir "wcs-cache.json") -Encoding UTF8

Copy-Item -LiteralPath (Join-Path $appRoot "config.example.json") -Destination (Join-Path $stageRoot "config.example.json") -Force

Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -Force
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $packageName.zip" -Encoding ASCII

Write-Host "Created distribution package:"
Write-Host $zipPath
Write-Host $checksumPath
Write-Host ""
Write-Host "Private config.json, server log, solve cache, and solve downloads were not included."
