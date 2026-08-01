!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "MUI2.nsh"
!include "getProcessInfo.nsh"

!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"

Var MonolithInstallLogPath

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro MonolithAppendLog MESSAGE
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  CreateDirectory "$LOCALAPPDATA\MonolithSSH"
  CreateDirectory "$LOCALAPPDATA\MonolithSSH\logs"
  StrCpy $MonolithInstallLogPath "$LOCALAPPDATA\MonolithSSH\logs\installer.log"
  ${GetTime} "" "L" $R0 $R1 $R2 $R3 $R4 $R5 $R6
  FileOpen $R7 "$MonolithInstallLogPath" a
  FileSeek $R7 0 END
  FileWrite $R7 "$R2-$R1-$R0 $R4:$R5:$R6 | ${MESSAGE}$\r$\n"
  FileClose $R7
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

LangString MonolithOptionsTitle 1033 "Installation options"
LangString MonolithOptionsTitle 2052 "安装选项"
LangString MonolithOptionsSubtitle 1033 "Choose how MonolithSSH integrates with Windows."
LangString MonolithOptionsSubtitle 2052 "选择 MonolithSSH 与 Windows 的集成方式。"
LangString MonolithOptionsDescription 1033 "You can change these options later by running the installer again."
LangString MonolithOptionsDescription 2052 "以后可以再次运行安装程序来更改这些选项。"
LangString MonolithDesktopShortcut 1033 "Create a desktop shortcut"
LangString MonolithDesktopShortcut 2052 "创建桌面快捷方式"
LangString MonolithStartMenuShortcut 1033 "Create a Start menu shortcut"
LangString MonolithStartMenuShortcut 2052 "创建开始菜单快捷方式"
LangString MonolithAutoStart 1033 "Start MonolithSSH when I sign in to Windows"
LangString MonolithAutoStart 2052 "登录 Windows 后自动启动 MonolithSSH"
LangString MonolithDataNote 1033 "Application data is preserved during upgrades and standard uninstall."
LangString MonolithDataNote 2052 "升级和常规卸载时默认保留应用数据。"
LangString MonolithRemoveData 1033 "Remove local instances, rules, credentials, and audit data"
LangString MonolithRemoveData 2052 "删除本地实例、规则、凭据和审计数据"
LangString MonolithLogInstallDirectory 1033 "Installation directory"
LangString MonolithLogInstallDirectory 2052 "安装目录"
LangString MonolithLogInstallMode 1033 "Installation mode"
LangString MonolithLogInstallMode 2052 "安装模式"
LangString MonolithLogDesktop 1033 "Desktop shortcut"
LangString MonolithLogDesktop 2052 "桌面快捷方式"
LangString MonolithLogStartMenu 1033 "Start menu shortcut"
LangString MonolithLogStartMenu 2052 "开始菜单快捷方式"
LangString MonolithLogAutoStart 1033 "Start with Windows"
LangString MonolithLogAutoStart 2052 "Windows 登录后启动"
LangString MonolithLogSaved 1033 "Installer log"
LangString MonolithLogSaved 2052 "安装日志"
LangString MonolithLogEnabled 1033 "enabled"
LangString MonolithLogEnabled 2052 "已启用"
LangString MonolithLogDisabled 1033 "disabled"
LangString MonolithLogDisabled 2052 "未启用"
LangString MonolithLogPreparing 1033 "Preparing MonolithSSH installation..."
LangString MonolithLogPreparing 2052 "正在准备安装 MonolithSSH..."
LangString MonolithLogChecking 1033 "Checking running processes and installation environment..."
LangString MonolithLogChecking 2052 "正在检查运行进程和安装环境..."

!ifndef BUILD_UNINSTALLER
  Var pid
  Var MonolithDesktopCheckbox
  Var MonolithStartMenuCheckbox
  Var MonolithAutoStartCheckbox
  Var MonolithDesktopState
  Var MonolithStartMenuState
  Var MonolithAutoStartState

  !macro customPageAfterChangeDir
    Page custom MonolithOptionsCreate MonolithOptionsLeave
  !macroend

  !macro customInit
    !insertmacro MonolithAppendLog "installer started | version=${VERSION}"
  !macroend

  !macro customCheckAppRunning
    SetDetailsPrint both
    SetDetailsView show
    DetailPrint "$(MonolithLogPreparing)"
    DetailPrint "$(MonolithLogInstallDirectory): $INSTDIR"
    DetailPrint "$(MonolithLogChecking)"
    DetailPrint "$(MonolithLogSaved): $MonolithInstallLogPath"
    !insertmacro MonolithAppendLog "installation phase started | directory=$INSTDIR"
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !macroend

  Function MonolithOptionsCreate
    !insertmacro MUI_HEADER_TEXT "$(MonolithOptionsTitle)" "$(MonolithOptionsSubtitle)"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "$(MonolithOptionsDescription)"
    Pop $0

    ${NSD_CreateCheckbox} 0 38u 100% 14u "$(MonolithDesktopShortcut)"
    Pop $MonolithDesktopCheckbox
    ${NSD_CreateCheckbox} 0 64u 100% 14u "$(MonolithStartMenuShortcut)"
    Pop $MonolithStartMenuCheckbox
    ${NSD_CreateCheckbox} 0 90u 100% 14u "$(MonolithAutoStart)"
    Pop $MonolithAutoStartCheckbox
    ${NSD_CreateLabel} 0 126u 100% 28u "$(MonolithDataNote)"
    Pop $0

    ClearErrors
    ReadRegDWORD $MonolithDesktopState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithDesktopShortcut"
    ${If} ${Errors}
      StrCpy $MonolithDesktopState ${BST_CHECKED}
    ${EndIf}

    ClearErrors
    ReadRegDWORD $MonolithStartMenuState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithStartMenuShortcut"
    ${If} ${Errors}
      StrCpy $MonolithStartMenuState ${BST_CHECKED}
    ${EndIf}

    ClearErrors
    ReadRegDWORD $MonolithAutoStartState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithAutoStart"
    ${If} ${Errors}
      StrCpy $MonolithAutoStartState ${BST_UNCHECKED}
    ${EndIf}

    ${NSD_SetState} $MonolithDesktopCheckbox $MonolithDesktopState
    ${NSD_SetState} $MonolithStartMenuCheckbox $MonolithStartMenuState
    ${NSD_SetState} $MonolithAutoStartCheckbox $MonolithAutoStartState
    nsDialogs::Show
  FunctionEnd

  Function MonolithOptionsLeave
    ${NSD_GetState} $MonolithDesktopCheckbox $MonolithDesktopState
    ${NSD_GetState} $MonolithStartMenuCheckbox $MonolithStartMenuState
    ${NSD_GetState} $MonolithAutoStartCheckbox $MonolithAutoStartState
    !insertmacro MonolithAppendLog "options selected | directory=$INSTDIR | desktop=$MonolithDesktopState | start-menu=$MonolithStartMenuState | auto-start=$MonolithAutoStartState"
  FunctionEnd

  !macro customInstall
    ${If} ${Silent}
      ClearErrors
      ReadRegDWORD $MonolithDesktopState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithDesktopShortcut"
      ${If} ${Errors}
        StrCpy $MonolithDesktopState ${BST_CHECKED}
      ${EndIf}

      ClearErrors
      ReadRegDWORD $MonolithStartMenuState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithStartMenuShortcut"
      ${If} ${Errors}
        StrCpy $MonolithStartMenuState ${BST_CHECKED}
      ${EndIf}

      ClearErrors
      ReadRegDWORD $MonolithAutoStartState SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithAutoStart"
      ${If} ${Errors}
        StrCpy $MonolithAutoStartState ${BST_UNCHECKED}
      ${EndIf}
    ${EndIf}

    ${If} $MonolithDesktopState != ${BST_CHECKED}
      Delete "$newDesktopLink"
    ${EndIf}

    ${If} $MonolithStartMenuState != ${BST_CHECKED}
      Delete "$newStartMenuLink"
      RMDir "$SMPROGRAMS\MonolithSSH"
    ${EndIf}

    ${If} $MonolithAutoStartState == ${BST_CHECKED}
      WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Run" "MonolithSSH" "$\"$appExe$\""
    ${Else}
      DeleteRegValue SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Run" "MonolithSSH"
    ${EndIf}

    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithDesktopShortcut" $MonolithDesktopState
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithStartMenuShortcut" $MonolithStartMenuState
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "MonolithAutoStart" $MonolithAutoStartState

    !insertmacro MonolithAppendLog "installation completed | version=${VERSION} | mode=$installMode | directory=$INSTDIR"
    SetDetailsPrint both
    DetailPrint "$(MonolithLogInstallDirectory): $INSTDIR"
    DetailPrint "$(MonolithLogInstallMode): $installMode"
    ${If} $MonolithDesktopState == ${BST_CHECKED}
      DetailPrint "$(MonolithLogDesktop): $(MonolithLogEnabled)"
    ${Else}
      DetailPrint "$(MonolithLogDesktop): $(MonolithLogDisabled)"
    ${EndIf}
    ${If} $MonolithStartMenuState == ${BST_CHECKED}
      DetailPrint "$(MonolithLogStartMenu): $(MonolithLogEnabled)"
    ${Else}
      DetailPrint "$(MonolithLogStartMenu): $(MonolithLogDisabled)"
    ${EndIf}
    ${If} $MonolithAutoStartState == ${BST_CHECKED}
      DetailPrint "$(MonolithLogAutoStart): $(MonolithLogEnabled)"
    ${Else}
      DetailPrint "$(MonolithLogAutoStart): $(MonolithLogDisabled)"
    ${EndIf}
    DetailPrint "$(MonolithLogSaved): $MonolithInstallLogPath"
    SetDetailsView show
  !macroend
!else
  !macro customUnInit
    SetDetailsPrint both
    SetDetailsView show
    !insertmacro MonolithAppendLog "uninstaller started | version=${VERSION}"
  !macroend

  !macro customUnInstall
    DeleteRegValue SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Run" "MonolithSSH"
    !insertmacro MonolithAppendLog "uninstall completed | version=${VERSION} | local-data=preserved"
    SetDetailsPrint both
    DetailPrint "$(MonolithLogSaved): $MonolithInstallLogPath"
    SetDetailsView show
  !macroend

  !macro customUnInstallSection
    Section /o "$(MonolithRemoveData)" SEC_REMOVE_MONOLITH_DATA
      !insertmacro MonolithAppendLog "local data removal requested"
      CopyFiles /SILENT "$MonolithInstallLogPath" "$TEMP\MonolithSSH-uninstall.log"
      RMDir /r "$APPDATA\MonolithSSH"
      RMDir /r "$LOCALAPPDATA\MonolithSSH"
      DetailPrint "$(MonolithLogSaved): $TEMP\MonolithSSH-uninstall.log"
    SectionEnd
  !macroend
!endif
