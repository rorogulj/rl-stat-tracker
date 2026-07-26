# RL Stat Tracker - one-line installer / updater for Windows.
#
#   irm https://raw.githubusercontent.com/rorogulj/rl-stat-tracker/main/install.ps1 | iex
#
# What it does: downloads the app (no git needed), a portable Node runtime if the
# machine has none, installs dependencies, builds the UI, creates Desktop +
# Startup shortcuts and starts the tracker at http://localhost:7845.
# Re-running it updates the app in place; your database is never touched
# (it lives in %LOCALAPPDATA%\RLStatTracker\data, outside the app folder).
#
# -FromUpdate  internal: launched by the server's Update button; waits for the
#              server to exit instead of stopping it.
# -RepoZip     install from a local zip instead of downloading (offline/testing).

param(
  [switch]$FromUpdate,
  [string]$RepoZip = '',
  [string]$Branch = 'main',
  [string]$InstallRoot = '',   # testing: install somewhere else
  [switch]$NoShortcuts         # testing: skip Desktop/Startup shortcuts
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo        = 'rorogulj/rl-stat-tracker'
$Port        = 7845
$NodeVersion = 'v22.14.0'
$Root        = if ($InstallRoot) { $InstallRoot } else { Join-Path $env:LOCALAPPDATA 'RLStatTracker' }
$AppDir      = Join-Path $Root 'app'
$DataDir     = Join-Path $Root 'data'
$NodeDir     = Join-Path $Root 'node'
$Launcher    = Join-Path $Root 'rl-stat-tracker.vbs'

function Say($msg) { Write-Host "  $msg" -ForegroundColor Cyan }

Write-Host ''
Write-Host '  RL STAT TRACKER installer' -ForegroundColor Green
Write-Host ''

New-Item -ItemType Directory -Force $Root, $DataDir | Out-Null

# ---------- 1. make sure no server holds the port / node.exe ----------
function Test-Port {
  try { (Invoke-WebRequest "http://localhost:$Port/api/status" -UseBasicParsing -TimeoutSec 2) | Out-Null; $true }
  catch { $false }
}
$portBusy = $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($portBusy -and -not (Test-Port)) {
  # something is listening on 7845 but it does not answer like the tracker —
  # never kill a foreign application, and the server could not start anyway
  throw "Port $Port is in use by another application. Close it and run the installer again."
}
if (Test-Port) {
  if ($FromUpdate) {
    Say 'waiting for the server to shut down...'
    $tries = 0
    while ((Test-Port) -and $tries -lt 60) { Start-Sleep -Milliseconds 1000; $tries++ }
  } else {
    Say 'stopping the running tracker...'
    try {
      $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
      Stop-Process -Id $conn[0].OwningProcess -Force -Confirm:$false
      Start-Sleep -Seconds 2
    } catch { Say 'could not stop it automatically - close it and re-run if the install fails' }
  }
}

# ---------- 2. Node runtime ----------
$NodeExe = Join-Path $NodeDir 'node.exe'
if (-not (Test-Path $NodeExe)) {
  $sysNode = Get-Command node -ErrorAction SilentlyContinue
  # the version number is not enough: node:sqlite ships unflagged only in newer 22.x —
  # actually try to load it, and fall back to the portable runtime if that fails
  $nodeOk = $false
  if ($sysNode) {
    cmd /c "node -e `"require('node:sqlite')`" > nul 2>&1"
    if ($LASTEXITCODE -eq 0) { $nodeOk = $true }
  }
  if ($nodeOk) {
    $NodeExe = $sysNode.Source
    $NodeDir = Split-Path $NodeExe
    Say "using system Node $(& node -v)"
  } else {
    Say "downloading portable Node $NodeVersion (~30 MB)..."
    $zip = Join-Path $env:TEMP 'rl-node.zip'
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
    $tmp = Join-Path $env:TEMP 'rl-node-extract'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $zip -DestinationPath $tmp
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item (Join-Path $tmp "node-$NodeVersion-win-x64") $NodeDir
    Remove-Item $zip -Force; Remove-Item -Recurse -Force $tmp
    $NodeExe = Join-Path $NodeDir 'node.exe'
  }
}
$env:PATH = "$NodeDir;$env:PATH"
$Npm = Join-Path $NodeDir 'npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = 'npm' } # system node case

# ---------- 3. download the app ----------
# Installs the latest tagged release, not the tip of main: the version is read
# from package.json on main, then the immutable tag zip (vX.Y.Z) is downloaded,
# so what runs is always an auditable, fixed snapshot.
if ($RepoZip -and (Test-Path $RepoZip)) {
  Say "installing from local zip: $RepoZip"
  $zip = $RepoZip
} else {
  $zip = Join-Path $env:TEMP 'rl-tracker.zip'
  $ref = "refs/heads/$Branch"
  try {
    $ver = (Invoke-RestMethod "https://raw.githubusercontent.com/$Repo/$Branch/package.json" -TimeoutSec 15).version
    if ($ver) { $ref = "refs/tags/v$ver" }
  } catch { }
  Say "downloading $ref from GitHub..."
  try {
    Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$ref" -OutFile $zip -UseBasicParsing
  } catch {
    Say 'tag not found - falling back to the main branch'
    Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip -UseBasicParsing
  }
}
$tmp = Join-Path $env:TEMP 'rl-tracker-extract'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive $zip -DestinationPath $tmp
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
Move-Item $inner.FullName $AppDir
if (-not $RepoZip) { Remove-Item $zip -Force }
Remove-Item -Recurse -Force $tmp

# ---------- 4. dependencies + UI build ----------
Say 'fetching the replay parser (official rrrocket release, SHA-256 verified)...'
Push-Location $AppDir
& $NodeExe tools\fetch-rrrocket.mjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'replay parser download failed' }
Pop-Location

Say 'installing server dependencies...'
Push-Location (Join-Path $AppDir 'server')
cmd /c "`"$Npm`" ci --omit=dev --no-audit --no-fund > nul 2>&1"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install failed (server)' }
Pop-Location

Say 'building the interface (takes a minute)...'
Push-Location (Join-Path $AppDir 'client')
cmd /c "`"$Npm`" ci --no-audit --no-fund > nul 2>&1"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install failed (client)' }
cmd /c "`"$Npm`" run build > nul 2>&1"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'client build failed' }
Pop-Location

# ---------- 5. launcher + shortcuts ----------
$serverDir = (Join-Path $AppDir 'server') -replace '"', ''
@"
' RL Stat Tracker launcher - starts the server hidden; with the "open" argument
' it also opens the tracker in the default browser. Safe to double-click while
' the server is already running (the second copy exits quietly).
Dim sh, env
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")
env("RL_DATA_DIR") = "$DataDir"
sh.CurrentDirectory = "$serverDir"
sh.Run """$NodeExe"" src\index.js", 0, False
If WScript.Arguments.Count > 0 Then
  WScript.Sleep 1500
  sh.Run "http://localhost:$Port"
End If
"@ | Out-File -Encoding unicode $Launcher # UTF-16: paths may contain non-ASCII user names (č, š, é...)

$wsh = New-Object -ComObject WScript.Shell
if (-not $NoShortcuts) {
foreach ($s in @(
  @{ Path = Join-Path $wsh.SpecialFolders('Desktop') 'RL Stat Tracker.lnk'; Args = """$Launcher"" open" },
  @{ Path = Join-Path $wsh.SpecialFolders('Startup') 'RL Stat Tracker.lnk'; Args = """$Launcher""" }
)) {
  $lnk = $wsh.CreateShortcut($s.Path)
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = $s.Args
  $lnk.WorkingDirectory = $Root
  $lnk.Description = 'RL Stat Tracker - local Rocket League stats'
  $ico = Join-Path $AppDir 'client\public\logo.ico'
  if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
  $lnk.Save()
}
}

# ---------- 6. start ----------
Say 'starting the tracker...'
if ($FromUpdate) {
  Start-Process wscript.exe -ArgumentList """$Launcher"""
} else {
  Start-Process wscript.exe -ArgumentList """$Launcher""", 'open'
}

$ver = ''
try { $ver = 'v' + (Get-Content (Join-Path $AppDir 'package.json') | ConvertFrom-Json).version } catch {}
Write-Host ''
Write-Host "  Done - RL Stat Tracker $ver is installed." -ForegroundColor Green
Write-Host "  It starts automatically at login and lives at http://localhost:$Port"
Write-Host '  Re-run this installer anytime to update.'
Write-Host ''
