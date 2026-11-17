# Starts the voice server in a separate window, then the Electron app in this one.
# The app will detect and adopt the already-running voice server.
$root = Split-Path -Parent $PSScriptRoot

$env:PYTHONUTF8 = "1"   # keep Claude CLI subprocess output UTF-8 on Windows
Start-Process -FilePath "uv" -ArgumentList "run", "parla-voice", "--port", "8790" `
    -WorkingDirectory (Join-Path $root "voice")

Set-Location (Join-Path $root "app")
npm run dev
