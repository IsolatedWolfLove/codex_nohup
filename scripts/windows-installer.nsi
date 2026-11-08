Unicode True
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\IsolatedWolfLoveNohop Codex"
Name "Nohop Codex"
OutFile "..\build\bin\nohop-codex-amd64-installer.exe"
InstallDir "$PROGRAMFILES64\IsolatedWolfLove\Nohop Codex"
InstallDirRegKey HKLM "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel admin
ManifestDPIAware True
!define MUI_ICON "..\build\windows\icon.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
 SetRegView 64
 ; Wails 2 stored the uninstall command but no InstallLocation.
 ReadRegStr $0 HKLM "${UNINSTALL_KEY}" "InstallLocation"
 ${If} $0 != ""
  StrCpy $INSTDIR $0
 ${Else}
  ReadRegStr $0 HKLM "${UNINSTALL_KEY}" "UninstallString"
  ${If} $0 != ""
   StrCpy $1 $0 1
   ${If} $1 == '$\"'
    StrCpy $0 $0 -1 1
   ${EndIf}
   ${GetParent} "$0" $INSTDIR
  ${EndIf}
 ${EndIf}
FunctionEnd

Section "Nohop Codex"
 SetShellVarContext all
 SetRegView 64
 SetOutPath "$INSTDIR"
 ; Abort rather than report success while the previous executable is in use.
 ClearErrors
 File "..\build\bin\nohop-codex.exe"
 IfErrors 0 +3
  MessageBox MB_ICONSTOP "无法更新程序，请关闭所有 Nohop Codex 窗口后重试。"
  Abort
 WriteUninstaller "$INSTDIR\uninstall.exe"
 CreateShortcut "$SMPROGRAMS\Nohop Codex.lnk" "$INSTDIR\nohop-codex.exe"
 CreateShortcut "$DESKTOP\Nohop Codex.lnk" "$INSTDIR\nohop-codex.exe"
 ; Replace the current user's shortcuts left by releases 3.1.0–3.1.2.
 SetShellVarContext current
 CreateShortcut "$SMPROGRAMS\Nohop Codex.lnk" "$INSTDIR\nohop-codex.exe"
 IfFileExists "$DESKTOP\Nohop Codex.lnk" 0 +2
  CreateShortcut "$DESKTOP\Nohop Codex.lnk" "$INSTDIR\nohop-codex.exe"
 SetShellVarContext all
 WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "Nohop Codex"
 WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "IsolatedWolfLove"
 WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
 WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\nohop-codex.exe"
 WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\uninstall.exe$\"'
SectionEnd
Section "Uninstall"
 SetShellVarContext all
 SetRegView 64
 Delete "$SMPROGRAMS\Nohop Codex.lnk"
 Delete "$DESKTOP\Nohop Codex.lnk"
 Delete "$INSTDIR\nohop-codex.exe"
 Delete "$INSTDIR\uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKLM "${UNINSTALL_KEY}"
SectionEnd
