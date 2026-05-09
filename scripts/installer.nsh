; Custom NSIS installer hooks for Central Tracking
; Writes a ct.cmd wrapper and adds the install directory to the user PATH.

!macro customInstall
  ; Write ct.cmd so the CLI is accessible from any terminal
  FileOpen $0 "$INSTDIR\ct.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "set ELECTRON_RUN_AS_NODE=1$\r$\n"
  FileWrite $0 '"$INSTDIR\Central Tracking.exe" "$INSTDIR\resources\app.asar.unpacked\dist\cli\main.js" %*$\r$\n'
  FileClose $0

  ; Add install directory to user PATH if not already present
  ReadRegStr $R0 HKCU "Environment" "PATH"
  StrStr $R1 "$R0" "$INSTDIR"
  StrCmp $R1 "" 0 ct_path_done
    StrCmp $R0 "" ct_path_empty ct_path_append
    ct_path_empty:
      WriteRegExpandStr HKCU "Environment" "PATH" "$INSTDIR"
      Goto ct_path_notify
    ct_path_append:
      WriteRegExpandStr HKCU "Environment" "PATH" "$R0;$INSTDIR"
      Goto ct_path_notify
    ct_path_notify:
      SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
  ct_path_done:
!macroend

!macro customUnInstall
  Delete "$INSTDIR\ct.cmd"
  ; PATH entry left in place — the directory will be gone so it is harmless,
  ; and removing it reliably via NSIS string manipulation is fragile.
!macroend
