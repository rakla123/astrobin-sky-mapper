$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $appRoot "server.js"
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$appName = "AstroBin Sky Mapper"
$port = 8787

if (Test-Path $bundledNode) {
  $node = $bundledNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    Write-Host "Node.js was not found. Please install Node.js or use the Codex runtime."
    Read-Host "Press Enter to close"
    exit 1
  }
  $node = $nodeCommand.Source
}

$nodeMajor = & $node -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 18) {
  Write-Host "AstroBin Sky Mapper requires Node.js 18 or newer."
  Write-Host "Detected: $(& $node --version)"
  Read-Host "Press Enter to close"
  exit 1
}

$log = Join-Path $appRoot "server.log"

$config = Join-Path $appRoot "config.json"
$configExample = Join-Path $appRoot "config.example.json"
if (-not (Test-Path $config) -and (Test-Path $configExample)) {
  Copy-Item -LiteralPath $configExample -Destination $config
  Write-Host "A new config.json was created from config.example.json."
  Write-Host "Please edit config.json and enter your AstroBin username, API key, and API secret."
  Write-Host ""
  Start-Process -FilePath "notepad.exe" -ArgumentList $config
  Read-Host "Press Enter after editing config.json"
}

if (Test-Path $config) {
  try {
    $configJson = Get-Content -Raw -LiteralPath $config | ConvertFrom-Json
    if ($configJson.app.name) { $appName = [string]$configJson.app.name }
    if ($configJson.app.port) { $port = [int]$configJson.app.port }
  } catch {
    Write-Host "Could not read app name/port from config.json. Using defaults."
  }
}

$url = "http://127.0.0.1:$port"

Write-Host ""
Write-Host $appName
Write-Host ("-" * [Math]::Max(3, $appName.Length))
Write-Host "Starting local server..."
Write-Host "App-Folder: $appRoot"
Write-Host "Server-Log: $log"
Write-Host ""

if (Test-Path $log) {
  Remove-Item -LiteralPath $log -Force
}

$job = Start-Job -ArgumentList $appRoot, $node, $server, $log, $port -ScriptBlock {
  param($appRoot, $node, $server, $log, $port)
  Set-Location $appRoot
  $env:PORT = [string]$port
  & $node $server *> $log
}

try {
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ($job.State -ne "Running") {
      break
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing "$url/api/config" -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not $ready) {
    Write-Host "The server could not be started."
    Write-Host ""
    if (Test-Path $log) {
      Write-Host "Server-Log:"
      Get-Content -LiteralPath $log
    } else {
      Write-Host "No server log found."
    }
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
  }

  Write-Host "Server is running."
  Write-Host "Address: $url"
  Write-Host ""

  try {
    Start-Process $url
  } catch {
    Write-Host "The browser could not be opened automatically."
    Write-Host "Please open this address manually: $url"
  }

  Write-Host "Keep this window open while using the app."
  Write-Host "Press Enter to stop."
  Read-Host
} finally {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -ErrorAction SilentlyContinue
}
