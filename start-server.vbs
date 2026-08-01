' RL Stat Tracker — starts the server invisibly and supervises it:
' output goes to server\run.log, a crash (non-zero exit) restarts the server,
' a clean exit (second copy already running / self-update shutdown) ends the loop.
' A copy of this in the Startup folder = automatic start at login.
' To stop the server for good: kill the wscript.exe process first, then node.
Dim shell, fso, root, logFile, rc, fastFails, t0, dt
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root & "\server"
logFile = root & "\server\run.log"
fastFails = 0
Do
  On Error Resume Next
  If fso.FileExists(logFile) Then
    If fso.GetFile(logFile).Size > 5000000 Then fso.DeleteFile logFile
  End If
  On Error Goto 0
  t0 = Timer
  ' cmd wrapper so stdout+stderr land in run.log (crash diagnostics); 0 = hidden, True = wait
  rc = shell.Run("cmd /c node src\index.js >> """ & logFile & """ 2>&1", 0, True)
  If rc = 0 Then Exit Do ' clean exit: another copy already runs, or the self-update takes over
  dt = Timer - t0
  If dt >= 0 And dt < 60 Then
    fastFails = fastFails + 1
    If fastFails >= 10 Then Exit Do ' persistent crash loop — give up, run.log has the reason
  Else
    fastFails = 0
  End If
  WScript.Sleep 5000
Loop
