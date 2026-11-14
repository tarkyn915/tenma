; Reuse the previous Tenma installation when adopting the Tenma Player name.
; Keep the native bundle ID and executable name unchanged for stored app data.
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R7 SHCTX "Software\tenma\Tenma" ""
  ReadRegStr $R8 SHCTX "Software\tenma\Tenma Player" ""
  ${If} $R8 == ""
  ${AndIf} $R7 != ""
  ${AndIf} ${FileExists} "$R7\tenma.exe"
    StrCpy $INSTDIR $R7
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R7 SHCTX "Software\tenma\Tenma" ""
  ReadRegStr $R8 SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tenma" "MainBinaryName"
  ${If} $R7 == $INSTDIR
  ${AndIf} $R7 != ""
  ${AndIf} $R8 == "tenma.exe"
    ; Only retire the old registration after successfully replacing its binary.
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\Tenma"
    DeleteRegKey SHCTX "Software\tenma\Tenma"

    !insertmacro IsShortcutTarget "$SMPROGRAMS\Tenma.lnk" "$INSTDIR\tenma.exe"
    Pop $R8
    ${If} $R8 = 1
      CreateShortcut "$SMPROGRAMS\Tenma Player.lnk" "$INSTDIR\tenma.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Tenma Player.lnk"
      Delete "$SMPROGRAMS\Tenma.lnk"
    ${EndIf}

    !insertmacro IsShortcutTarget "$DESKTOP\Tenma.lnk" "$INSTDIR\tenma.exe"
    Pop $R8
    ${If} $R8 = 1
      CreateShortcut "$DESKTOP\Tenma Player.lnk" "$INSTDIR\tenma.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\Tenma Player.lnk"
      Delete "$DESKTOP\Tenma.lnk"
    ${EndIf}
  ${EndIf}
!macroend
