# Creates (or refreshes) the "Parla" shortcut on the Desktop.
# It points at parla-launch.vbs -> parla.ps1, so no console window appears.
$root = Split-Path -Parent $PSScriptRoot
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Parla.lnk'

$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $PSScriptRoot 'parla-launch.vbs') + '"'
$s.WorkingDirectory = Join-Path $root 'app'
$s.IconLocation = (Join-Path $PSScriptRoot 'parla.ico') + ',0'
$s.Description = 'Parla - talk to AI, for hours, not minutes'
$s.Save()

Write-Output "shortcut: $lnk"
