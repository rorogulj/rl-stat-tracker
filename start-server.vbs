' RL Stat Tracker — starts the server invisibly (no console window).
' A copy of this in the Startup folder = automatic start at login.
Dim shell, fso, root
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root & "\server"
' 0 = hidden window, False = don't wait
shell.Run """node"" src\index.js", 0, False
