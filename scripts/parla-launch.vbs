' Starts scripts/parla.ps1 with no console window (what the Desktop shortcut points at).
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "parla.ps1""", 0, False
