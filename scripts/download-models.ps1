# Fetches local models into voice/models/ (gitignored).
#  - sherpa-onnx Parakeet TDT 0.6B v2 (int8) for STT
#  - Kokoro-82M is pulled from Hugging Face automatically on first TTS init.
$root = Split-Path -Parent $PSScriptRoot
$models = Join-Path $root "voice\models"
New-Item -ItemType Directory -Force $models | Out-Null

$parakeetDir = Join-Path $models "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
if (Test-Path (Join-Path $parakeetDir "encoder.int8.onnx")) {
    Write-Host "Parakeet already present: $parakeetDir"
} else {
    $url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
    $archive = Join-Path $models "parakeet.tar.bz2"
    Write-Host "Downloading Parakeet TDT 0.6B v2 int8..."
    curl.exe -L --fail -o $archive $url
    if ($LASTEXITCODE -ne 0) { throw "download failed" }
    tar -xjf $archive -C $models
    Remove-Item $archive
    Write-Host "Parakeet ready: $parakeetDir"
}
