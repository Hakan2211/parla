# Desktop-shortcut launcher: rebuild if sources changed, then start Electron.
# The app itself finds-or-spawns the Python voice server (app/src/main/voice-server.ts),
# so nothing else has to be started here.
# Runs hidden via scripts/parla-launch.vbs; all output goes to the log below.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$builtMain = Join-Path $app 'out\main\index.js'

$logDir = Join-Path $env:LOCALAPPDATA 'Parla'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'launcher.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Remove-Item $log -Force }
function Log($msg) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding utf8 }

function Fail($msg) {
    Log "FAILED: $msg"
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "$msg`n`nDetails: $log", 'Parla could not start',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    exit 1
}

Log "--- launch ---"

if (-not (Test-Path $electron)) { Fail "Electron is not installed. Run: cd $app; npm install" }

# Already running? Don't start a second copy.
$running = @(Get-Process -Name electron -ErrorAction SilentlyContinue |
    Where-Object { try { $_.Path -eq $electron } catch { $false } })
if ($running.Count -gt 0) { Log "already running (pid $($running[0].Id)) - nothing to do"; exit 0 }

# Rebuild only when something under app/src (or the build config) is newer than the output.
$stale = $true
if (Test-Path $builtMain) {
    $builtAt = (Get-Item $builtMain).LastWriteTimeUtc
    $newest = Get-ChildItem -Path (Join-Path $app 'src') -Recurse -File |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    $configs = @('electron.vite.config.ts', 'package.json') |
        ForEach-Object { Join-Path $app $_ } | Where-Object { Test-Path $_ } | Get-Item
    $srcAt = @(@($newest) + @($configs) | Where-Object { $_ } |
        ForEach-Object { $_.LastWriteTimeUtc } | Sort-Object -Descending)[0]
    $stale = $srcAt -gt $builtAt
}

if ($stale) {
    Log "sources changed - building"
    $outLog = Join-Path $logDir 'build.log'
    $errLog = Join-Path $logDir 'build.err.log'
    $build = Start-Process -FilePath (Join-Path $app 'node_modules\.bin\electron-vite.cmd') `
        -ArgumentList 'build' -WorkingDirectory $app -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    if ($build.ExitCode -ne 0) { Fail "Build failed (exit $($build.ExitCode)). See $outLog" }
    Log "build ok"
} else {
    Log "build up to date"
}

$proc = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $app -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'electron.log') `
    -RedirectStandardError (Join-Path $logDir 'electron.err.log')
Log "started electron (pid $($proc.Id))"

# Catch an immediate crash so failure isn't silent; otherwise let it run and exit.
Start-Sleep -Seconds 3
if ($proc.HasExited -and $proc.ExitCode -ne 0) {
    Fail "Electron exited immediately (code $($proc.ExitCode)). See $logDir\electron.err.log"
}
