; Fleabook's Windows installer.
;
; Per-user by design: everything lands under %LOCALAPPDATA%, nothing is written
; to Program Files or HKLM, and RequestExecutionLevel is `user`. That is what
; keeps the install free of a UAC prompt — which matters more than usual here,
; because the people this is for are not administrators of the machines they
; are installing it on.
;
; Compiled from Linux by scripts/build-windows.mjs (`makensis`), which passes
; PAYLOAD and VERSION in with -D. It is not meant to be compiled by hand.

Unicode true
ManifestDPIAware true

; PAYLOAD, OUTFILE and RESOURCES are host paths and arrive as -D from the build
; script. They use forward slashes: makensis on Linux does not treat a backslash
; as a path separator when reading files off the build machine. Paths that the
; *installed* program will see keep Windows backslashes.
!ifndef PAYLOAD
  !error "PAYLOAD is not defined - build this with scripts/build-windows.mjs, not makensis directly"
!endif
!ifndef OUTFILE
  !error "OUTFILE is not defined - build this with scripts/build-windows.mjs, not makensis directly"
!endif
!ifndef RESOURCES
  !error "RESOURCES is not defined - build this with scripts/build-windows.mjs, not makensis directly"
!endif
!ifndef LICENSEFILE
  !error "LICENSEFILE is not defined - build this with scripts/build-windows.mjs, not makensis directly"
!endif
!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!define APPNAME    "Fleabook"
!define PUBLISHER  "Fleabook"
!define UNINSTKEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
; The WebView2 Runtime's Edge Update client GUID. Stable, published by Microsoft.
!define WV2GUID    "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WV2URL     "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "${APPNAME}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
SetCompressor /SOLID lzma

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} installer"
VIAddVersionKey "FileVersion"     "${VERSION}.0"
VIAddVersionKey "ProductVersion"  "${VERSION}.0"
VIAddVersionKey "LegalCopyright"  "${PUBLISHER}"

!define MUI_ICON   "${RESOURCES}/fleabook.ico"
!define MUI_UNICON "${RESOURCES}/fleabook.ico"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Install ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT  "Fleabook turns photos of your things into Facebook Marketplace listings.$\r$\n$\r$\nIt installs for you only, in your own user folder, so Windows will not ask for an administrator password.$\r$\n$\r$\nYour listings and photos stay on this computer."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSEFILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME} now"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; Fleabook holds port 5180 and its node.exe child, so a running copy has to go
; before files are replaced. Killing Fleabook.exe is enough: the launcher puts
; the server in a job object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so node
; dies with it. Do not broaden this to `taskkill /IM node.exe` — that would take
; out unrelated Node processes the user is running.
!macro StopFleabook
  DetailPrint "Closing ${APPNAME} if it is running..."
  nsExec::ExecToLog 'taskkill /F /IM "${APPNAME}.exe"'
  Pop $0
  Sleep 500
!macroend

Function EnsureWebView2
  ; A machine-wide runtime is recorded under HKLM (32-bit view, which is where
  ; a 32-bit installer's HKLM reads land anyway); a per-user one under HKCU.
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WV2GUID}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WV2GUID}" "pv"
  ${EndIf}

  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    DetailPrint "Microsoft Edge WebView2 Runtime found (version $0)."
    Return
  ${EndIf}

  DetailPrint "Downloading the Microsoft Edge WebView2 Runtime..."
  StrCpy $1 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"

  ; PowerShell rather than an NSIS download plugin: the fwlink is https, which
  ; the bundled NSISdl cannot do, and this avoids depending on a plugin that
  ; may not ship with the Linux makensis package.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ProgressPreference = $\'SilentlyContinue$\'; Invoke-WebRequest -Uri $\'${WV2URL}$\' -OutFile $\'$1$\' -UseBasicParsing"'
  Pop $2

  ${If} $2 == 0
  ${AndIf} ${FileExists} "$1"
    DetailPrint "Installing the Microsoft Edge WebView2 Runtime..."
    ; Unelevated, this performs a per-user runtime install, which is what we want.
    ExecWait '"$1" /silent /install' $3
    DetailPrint "WebView2 Runtime installer finished (exit code $3)."
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "${APPNAME} could not download the Microsoft Edge WebView2 Runtime, which it needs for its window.$\r$\n$\r$\nInstallation will continue. If ${APPNAME} opens in your browser instead of its own window, install the WebView2 Runtime from Microsoft and start it again."
  ${EndIf}
FunctionEnd

Function .onInit
  InitPluginsDir
FunctionEnd

Section "Install"
  !insertmacro StopFleabook

  SetOutPath "$INSTDIR"

  ; Wipe the parts of a previous install that are file trees rather than single
  ; files, so an upgrade cannot leave an orphaned module or route behind. User
  ; data is not here — it lives in %LOCALAPPDATA%\Fleabook — so this is safe.
  RMDir /r "$INSTDIR\build"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\node_modules"

  ; `*` rather than the usual `*.*`: node_modules is full of extensionless files
  ; (LICENSE, README, .bin entries) and on a POSIX makensis `*.*` needs a literal
  ; dot, so it would drop them without saying so.
  File /r "${PAYLOAD}/*"

  Call EnsureWebView2

  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; HKCU, so the entry shows in Settings > Apps for this user without elevation.
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKCU "${UNINSTKEY}" "DisplayIcon"     "$INSTDIR\${APPNAME}.exe"
  WriteRegStr   HKCU "${UNINSTKEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  !insertmacro StopFleabook

  RMDir /r "$INSTDIR\build"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\node_modules"
  Delete "$INSTDIR\${APPNAME}.exe"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
  RMDir  "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"

  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"

  ; Listings and photos are the user's, not ours. Default to keeping them: a
  ; reinstall picks them straight back up, and there is no other copy. A silent
  ; uninstall never deletes them — there is nobody there to be asked.
  IfSilent keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete your listings, photos and settings?$\r$\n$\r$\nThey are stored in $LOCALAPPDATA\${APPNAME} and are not backed up anywhere else. Choose No to keep them for a future reinstall." \
    IDYES delete_data IDNO keep_data

delete_data:
  RMDir /r "$LOCALAPPDATA\${APPNAME}"
  Goto data_done

keep_data:
  DetailPrint "Kept your listings and photos in $LOCALAPPDATA\${APPNAME}."

data_done:
SectionEnd
