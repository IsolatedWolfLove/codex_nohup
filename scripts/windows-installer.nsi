Unicode True
!include "MUI2.nsh"
Name "Nohop Codex"
OutFile "..\build\bin\nohop-codex-amd64-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\Nohop Codex"
RequestExecutionLevel user
!define MUI_ICON "..\build\windows\icon.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Nohop Codex"
 SetOutPath "$INSTDIR"
 File "..\build\bin\nohop-codex.exe"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateShortcut "$SMPROGRAMS\Nohop Codex.lnk" "$INSTDIR\nohop-codex.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NohopCodex" "DisplayName" "Nohop Codex"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NohopCodex" "DisplayVersion" "${PRODUCT_VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NohopCodex" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
 Delete "$SMPROGRAMS\Nohop Codex.lnk"
 Delete "$INSTDIR\nohop-codex.exe"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\NohopCodex"
SectionEnd
