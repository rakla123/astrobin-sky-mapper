$ErrorActionPreference = "Continue"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $appRoot "server.log"
$port = 8787
$configPath = Join-Path $appRoot "config.json"

if (Test-Path $configPath) {
  try {
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    if ($config.app.port) { $port = [int]$config.app.port }
  } catch {
    Write-Host "Could not read app.port from config.json. Using port $port."
  }
}

$url = "http://127.0.0.1:$port"

Write-Host ""
Write-Host "Testing AstroBin Sky Mapper..."
Write-Host "Address: $url"
Write-Host ""

try {
  $config = Invoke-WebRequest -UseBasicParsing "$url/api/config" -TimeoutSec 5
  Write-Host "OK: server is responding."
  Write-Host $config.Content
} catch {
  Write-Host "ERROR: server is not responding."
  Write-Host $_.Exception.Message
}

Write-Host ""
if (Test-Path $log) {
  Write-Host "Server-Log:"
  Get-Content -LiteralPath $log
} else {
  Write-Host "No server.log found yet."
}

Write-Host ""
Read-Host "Press Enter to close"
