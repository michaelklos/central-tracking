; Custom NSIS installer hooks for Central Tracking
; Writes a ct.cmd wrapper and adds the install directory to the user PATH.

!macro customInstall
  ; Write ct.cmd so the CLI is accessible from any terminal
  FileOpen $0 "$INSTDIR\ct.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "set ELECTRON_RUN_AS_NODE=1$\r$\n"
  FileWrite $0 '"$INSTDIR\Central Tracking.exe" "$INSTDIR\resources\app.asar.unpacked\dist\cli\cli\main.js" %*$\r$\n'
  FileClose $0

  ; Add install dir to user PATH via PowerShell (no-op if already present)
  FileOpen $1 "$PLUGINSDIR\ct-addpath.ps1" w
  FileWrite $1 '$$d = "$INSTDIR";$\n'
  FileWrite $1 '$$p = [Environment]::GetEnvironmentVariable("PATH","User");$\n'
  FileWrite $1 '$$parts = if ($$p) { $$p -split ";" } else { @() };$\n'
  FileWrite $1 'if ($$parts -notcontains $$d) { [Environment]::SetEnvironmentVariable("PATH", ($$parts + $$d | Where-Object { $$_ }) -join ";", "User") }$\n'
  FileClose $1
  nsExec::ExecToLog 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ct-addpath.ps1"'
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  Delete "$INSTDIR\ct.cmd"
  ; PATH entry left in place — the directory will be gone so it is harmless,
  ; and removing it reliably is fragile.
!macroend
