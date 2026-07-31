param(
  [string]$Title = "",
  [string]$Id = "",
  [string]$Hash = "",
  [switch]$All,
  [switch]$RetryFailed,
  [switch]$RetryBlocked,
  [switch]$InvalidateBad,
  [int]$BatchSize = 1,
  [string]$Server = ""
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ConfiguredServerUrl {
  $port = 8787
  $config = Join-Path $appRoot "config.json"
  if (Test-Path $config) {
    try {
      $configJson = Get-Content -Raw -LiteralPath $config | ConvertFrom-Json
      if ($configJson.app.port) { $port = [int]$configJson.app.port }
    } catch {
      Write-Host "Could not read app.port from config.json. Using port $port."
    }
  }
  return "http://127.0.0.1:$port"
}

if (-not $Server) {
  $Server = Get-ConfiguredServerUrl
}

function Invoke-LocalJsonEndpoint {
  param(
    [string]$Url,
    [ValidateSet("GET", "POST")][string]$Method = "GET"
  )

  try {
    return Invoke-WebRequest -UseBasicParsing $Url -Method $Method | Select-Object -ExpandProperty Content
  } catch {
    $response = $_.Exception.Response
    $statusCode = if ($response) { [int]$response.StatusCode } else { 0 }
    if ($statusCode -eq 404) {
      Write-Host ""
      Write-Host "The running local server does not know this endpoint yet."
      Write-Host "Close the old AstroBin Sky Projector PowerShell/server window, start it again, then rerun this command."
      Write-Host ""
      Write-Host "Start from this folder:"
      Write-Host "  .\Start-AstroBinSky.bat"
      Write-Host ""
      Write-Host "Then retry:"
      Write-Host "  .\Solve-With-ASTAP.ps1 -All"
      exit 2
    }
    throw
  }
}

function New-QueryString {
  param([hashtable]$Query)

  $pairs = $Query.GetEnumerator() | ForEach-Object {
    "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString([string]$_.Value)
  }
  return $pairs -join "&"
}

function Write-CacheStatus {
  param($Result)

  if ($Result.cacheStatus) {
    $solvedCached = if ($null -ne $Result.cacheStatus.solvedCached) { $Result.cacheStatus.solvedCached } else { 0 }
    $failedCached = if ($null -ne $Result.cacheStatus.failedCached) { $Result.cacheStatus.failedCached } else { 0 }
    $blockedCached = if ($null -ne $Result.cacheStatus.blockedCached) { $Result.cacheStatus.blockedCached } else { 0 }
    $metadataCached = if ($null -ne $Result.cacheStatus.metadataCached) { $Result.cacheStatus.metadataCached } else { 0 }
    $uncached = if ($null -ne $Result.cacheStatus.uncached) { $Result.cacheStatus.uncached } else { 0 }
    $bypassedValid = if ($null -ne $Result.bypassedValid) { $Result.bypassedValid } else { $solvedCached }
    $remaining = if ($null -ne $Result.remaining) { $Result.remaining } else { 0 }
    Write-Host ("Status: solved cached {0}, failed cached {1}, blocked cached {2}, metadata-only cached {3}, uncached {4}, bypassed valid {5}, remaining {6}" -f `
      $solvedCached, `
      $failedCached, `
      $blockedCached, `
      $metadataCached, `
      $uncached, `
      $bypassedValid, `
      $remaining)
  }
}

function Format-Number {
  param($Value, [int]$Digits = 4)

  if ($null -eq $Value) { return "missing" }
  try {
    return ([double]$Value).ToString("N$Digits")
  } catch {
    return "missing"
  }
}

function Get-AstapAttemptStatus {
  param($Attempt)

  $text = (($Attempt.stdout, $Attempt.stderr, $Attempt.error) -join " ")
  if ($text -match "PLTSOLVD=T") { return "solved output" }
  if ($text -match "Large FOV") { return "large FOV warning" }
  if ($text -match "No solution found") { return "no solution" }
  if ($text -match "Set FOV=|scale") { return "scale warning" }
  if ($Attempt.error) { return "error" }
  return "completed"
}

if ($All) {
  $remaining = $null
  $retryBefore = (Get-Date).ToUniversalTime().ToString("o")
  $batchNumber = 0
  do {
    $batchNumber += 1
    $query = @{
      limit = [Math]::Max(1, $BatchSize)
    }
    if ($RetryFailed) {
      $query["retry"] = "1"
      $query["retryBefore"] = $retryBefore
    }
    if ($RetryBlocked) {
      $query["retry"] = "1"
      $query["retryBlocked"] = "1"
      $query["retryBefore"] = $retryBefore
    }

    $planQuery = $query.Clone()
    $planQuery["dryRun"] = "1"
    $planUrl = "$Server/api/solve-missing?" + (New-QueryString $planQuery)
    Write-Host ("[{0}] Checking next batch {1}..." -f (Get-Date -Format "HH:mm:ss"), $batchNumber)
    $planContent = Invoke-LocalJsonEndpoint $planUrl -Method POST
    $plan = $planContent | ConvertFrom-Json
    Write-CacheStatus $plan

    if ([int]$plan.selected -eq 0) {
      Write-Host "No images selected. Batch run is complete."
      exit 0
    }

    Write-Host ("Next batch: {0} image(s)" -f $plan.selected)
    foreach ($item in @($plan.next)) {
      $missing = @($item.missingSolveHints)
      $hintText = if ($missing.Count -gt 0) { " | missing: " + ($missing -join ", ") } else { "" }
      Write-Host ("  - {0} | FOV {1} deg | RA {2} h | Dec {3} deg{4}" -f `
        $item.title, `
        (Format-Number $item.solveParameters.fovDeg 4), `
        (Format-Number $item.solveParameters.raHours 6), `
        (Format-Number $item.solveParameters.decDeg 4), `
        $hintText)
    }
    Write-Host ""

    $url = "$Server/api/solve-missing?" + (New-QueryString $query)
    Write-Host ("[{0}] Solving batch {1} with ASTAP..." -f (Get-Date -Format "HH:mm:ss"), $batchNumber)
    Write-Host $url
    Write-Host ""
    $content = Invoke-LocalJsonEndpoint $url -Method POST
    $result = $content | ConvertFrom-Json

    Write-Host ("[{0}] Batch {1} finished: selected {2}, solved {3}, failed {4}" -f `
      (Get-Date -Format "HH:mm:ss"), `
      $batchNumber, `
      $result.selected, `
      $result.solved, `
      $result.failed)

    foreach ($item in @($result.results)) {
      Write-Host ("  SOLVED: {0}" -f $item.title)
    }
    foreach ($item in @($result.failures)) {
      $statusLabel = if ($item.solveBlocked) { "BLOCKED" } else { "FAILED" }
      Write-Host ("  {0}: {1}" -f $statusLabel, $item.title)
      if ($item.solveBlocked -and $item.blockedReason) {
        Write-Host ("          Reason: {0}" -f $item.blockedReason)
      }
      if ($item.solveParameters) {
        Write-Host ("          FOV {0} deg ({1}), RA {2} h, Dec {3} deg, radius {4} deg" -f `
          (Format-Number $item.solveParameters.fovDeg 4), `
          $item.solveParameters.fovSource, `
          (Format-Number $item.solveParameters.raHours 6), `
          (Format-Number $item.solveParameters.decDeg 4), `
          (Format-Number $item.solveParameters.radiusDeg 2))
      }
      if ($item.error) {
        Write-Host ("          {0}" -f $item.error)
      }
      $attempts = @($item.astapAttempts)
      if ($attempts.Count -gt 0) {
        Write-Host ("          ASTAP attempts: {0}" -f $attempts.Count)
        foreach ($attempt in $attempts) {
          $params = $attempt.solveParameters
          $label = if ($attempt.label) { $attempt.label } else { "attempt" }
          $exitCode = if ($null -ne $attempt.exitCode) { $attempt.exitCode } elseif ($null -ne $attempt.code) { $attempt.code } else { "?" }
          $toleranceText = if ($attempt.tolerance) { $attempt.tolerance } else { "-" }
          if ($params) {
            Write-Host ("            - {0}: FOV {1} deg, radius {2} deg, tolerance {3}, exit {4}, {5}" -f `
              $label, `
              (Format-Number $params.fovDeg 4), `
              (Format-Number $params.radiusDeg 2), `
              $toleranceText, `
              $exitCode, `
              (Get-AstapAttemptStatus $attempt))
          } else {
            Write-Host ("            - {0}: exit {1}, {2}" -f $label, $exitCode, (Get-AstapAttemptStatus $attempt))
          }
        }
      }
      foreach ($sidecar in @($item.sidecarFiles)) {
        if ($sidecar.text) {
          $firstLines = (($sidecar.text -split "`r?`n") | Select-Object -First 4) -join " | "
          Write-Host ("          ASTAP sidecar: {0}" -f $firstLines)
        }
      }
    }
    Write-CacheStatus $result
    Write-Host ""

    $remaining = [int]$result.remaining
  } while ($remaining -gt 0)
  exit 0
}

if ($InvalidateBad) {
  $url = "$Server/api/wcs-cache/invalidate-bad"
  Write-Host "Checking cached WCS solutions for false positives:"
  Write-Host $url
  Write-Host ""
  $content = Invoke-LocalJsonEndpoint $url -Method POST
  Write-Host $content
  exit 0
}

if (-not $Title -and -not $Id -and -not $Hash) {
  Write-Host "Provide one selector:"
  Write-Host "  .\Solve-With-ASTAP.ps1 -Title ""Sh2-103"""
  Write-Host "  .\Solve-With-ASTAP.ps1 -Id ""123456"""
  Write-Host "  .\Solve-With-ASTAP.ps1 -Hash ""abc123"""
  Write-Host "  .\Solve-With-ASTAP.ps1 -All"
  Write-Host "  .\Solve-With-ASTAP.ps1 -All -BatchSize 5"
  Write-Host "  .\Solve-With-ASTAP.ps1 -All -RetryFailed"
  Write-Host "  .\Solve-With-ASTAP.ps1 -All -RetryBlocked"
  Write-Host "  .\Solve-With-ASTAP.ps1 -InvalidateBad"
  exit 1
}

$query = @{}
if ($Title) { $query["title"] = $Title }
if ($Id) { $query["id"] = $Id }
if ($Hash) { $query["hash"] = $Hash }

$pairs = $query.GetEnumerator() | ForEach-Object {
  "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString($_.Value)
}
$url = "$Server/api/solve?" + ($pairs -join "&")

Write-Host "Calling local solver endpoint:"
Write-Host $url
Write-Host ""
Invoke-LocalJsonEndpoint $url -Method POST
