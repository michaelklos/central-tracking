; Custom NSIS installer hooks for Central Tracking
; Writes a ct.cmd wrapper and adds the install directory to the user PATH.

!macro customInstall
  ; The two steps below (ct.cmd wrapper + PATH edit) are CLI conveniences, not
  ; the app itself. On locked-down corporate machines they can fail (e.g.
  ; AppLocker / Constrained Language Mode blocking the PowerShell call). Treat
  ; them as best-effort: surface a visible message in the install details, but
  ; never abort the install over them — the app is already on disk by this point.

  ; Write ct.cmd so the CLI is accessible from any terminal
  ClearErrors
  FileOpen $0 "$INSTDIR\ct.cmd" w
  ${If} ${Errors}
    DetailPrint "Warning: could not create the 'ct' CLI wrapper ($INSTDIR\ct.cmd). The app will still work; see the README to set up the CLI manually."
  ${Else}
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "set ELECTRON_RUN_AS_NODE=1$\r$\n"
    FileWrite $0 '"$INSTDIR\Central Tracking.exe" "$INSTDIR\resources\app.asar.unpacked\dist\cli\cli\main.js" %*$\r$\n'
    FileClose $0
  ${EndIf}

  ; Add install dir to user PATH via PowerShell (no-op if already present)
  ClearErrors
  FileOpen $1 "$PLUGINSDIR\ct-addpath.ps1" w
  ${If} ${Errors}
    DetailPrint "Warning: could not stage the PATH-update script. The 'ct' command may not be on your PATH; add '$INSTDIR' manually if you need it."
  ${Else}
    FileWrite $1 '$$d = "$INSTDIR";$\n'
    FileWrite $1 '$$p = [Environment]::GetEnvironmentVariable("PATH","User");$\n'
    FileWrite $1 '$$parts = if ($$p) { $$p -split ";" } else { @() };$\n'
    FileWrite $1 'if ($$parts -notcontains $$d) { [Environment]::SetEnvironmentVariable("PATH", ($$parts + $$d | Where-Object { $$_ }) -join ";", "User") }$\n'
    FileClose $1
    ; nsExec pushes the process exit code (or "error" if it could not launch).
    nsExec::ExecToLog 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\ct-addpath.ps1"'
    Pop $2
    ${If} $2 != 0
      DetailPrint "Warning: updating your PATH failed (PowerShell exit code: $2). This is usually a corporate security policy blocking the script. The app is installed and works normally; add '$INSTDIR' to your PATH manually to use the 'ct' command."
    ${EndIf}
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$INSTDIR\ct.cmd"
  ; PATH entry left in place — the directory will be gone so it is harmless,
  ; and removing it reliably is fragile.
!macroend
