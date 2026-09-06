Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root & "\desktop"
exe = root & "\desktop\node_modules\electron\dist\electron.exe"
If files.FileExists(exe) Then
  shell.Run """" & exe & """ """ & root & "\desktop" & """", 1, False
Else
  MsgBox "Run npm install in the desktop folder, then npm run build in the frontend folder first.", 48, "Rail Insights setup"
End If
