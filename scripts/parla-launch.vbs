' Starts scripts/parla.ps1 with no console window (what the Desktop shortcut points at).
' Arguments are passed through, e.g. Studio's "Talk it through":
'   wscript parla-launch.vbs --studio-project <id>
Dim sh, dir, args, i
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & Replace(WScript.Arguments(i), """", "") & """"
Next
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "parla.ps1""" & args, 0, False
