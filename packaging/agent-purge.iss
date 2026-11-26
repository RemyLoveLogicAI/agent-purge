; Inno Setup 6: package only the Node thin build verified by scripts/build-setup.mjs.
;
; Why not a single-file exe: bundled Bun/Node SEA runtimes start at 90 MB for a 700 KB
; configuration tool. This installs the JS tree + agent-purge.cmd shim and requires Node.js 20+ (checked at install).
;
; Uninstall runs clean --keep-failed first (restore from ledger, logging skipped failures in clean-leftovers.log), then removes the install directory.
; Uninstall reverts modifications recorded in shared user data, not only the installation directory, as the confirmation explains. Personas and settings are retained.
; The version comes from dist\version.iss, derived from package.json by scripts/build-setup.mjs.
#include "..\dist\version.iss"
#define AppName "agent-purge"

[Setup]
AppId={{8E4C1D07-2B39-4C6E-9F3A-5D1B7C0A6E42}
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher=agent-purge
DefaultDirName={localappdata}\Programs\agent-purge
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputDir=..\dist
OutputBaseFilename=agent-purge-{#AppVer}-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\web\assets\agent-purge.ico
UninstallDisplayName={#AppName}
DisableProgramGroupPage=yes
; A live launcher or native window must close before payload replacement/removal.
AppMutex=agent-purge-desktop-active

[Files]
Source: "..\dist\agent-purge\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional options:"; Flags: unchecked

[Icons]
Name: "{group}\{#AppName} Desktop client"; Filename: "{app}\agent-purge.exe"; Parameters: "web --desktop"; WorkingDir: "{app}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\agent-purge.exe"; Parameters: "web --desktop"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\agent-purge.exe"; Parameters: "web --desktop"; Description: "启动 {#AppName} 桌面Desktop client"; Flags: postinstall nowait skipifsilent

[Messages]
; Uninstall also reverts changes in shared data, not just program files; the confirmation explains this.
ConfirmUninstall=Completely remove %1?%n%nThis also reverts modifications and restores configuration files for AI tools in the shared data directory, not just program files.

[Code]
const NodeUrl = 'https://nodejs.org/';

function HasNode(): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/d /c node -e "process.exit(Number(process.versions.node.split(''.'')[0]) >= 20 ? 0 : 1)"', '', SW_HIDE,
    ewWaitUntilTerminated, Code) and (Code = 0);
end;

function InitializeSetup(): Boolean;
var
  Code: Integer;
begin
  Result := True;
  if HasNode() then
    Exit;
  if SuppressibleMsgBox('This installer includes the Node thin package and requires Node.js 20 or later. For use without Node, choose the standalone portable exe.' + Chr(10) +
      'Open the download page now?', mbConfirmation, MB_YESNO, IDNO) = IDYES then
    ShellExec('open', NodeUrl, '', '', SW_SHOWNORMAL, ewNoWait, Code);
  Result := False;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
  CleanComplete: Boolean;
begin
  // InitializeUninstall runs before confirmation; cleaning there would undo settings even if the user cancels.
  // usUninstall runs after confirmation and before deletion; throwing here stops uninstall and retains recovery material.
  if CurUninstallStep <> usUninstall then
    Exit;
  Code := -1;
  // --keep-failed logs old ledger entries that cannot be restored in the data directory clean-leftovers.log,
  // rather than blocking uninstall forever. Exit code 3 means cleanup finished with skipped entries and uninstall may proceed.
  CleanComplete := Exec(ExpandConstant('{app}\agent-purge.exe'), 'clean --keep-failed',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) and ((Code = 0) or (Code = 3));
  if not CleanComplete then
    RaiseException('Cleanup did not fully succeed. The program and recovery material have been retained. Run agent-purge clean to inspect and resolve remaining items before uninstalling.');
  if Code = 3 then
    SuppressibleMsgBox('Some old records could not be restored and were skipped and logged in the data directory clean-leftovers.log. Uninstall will continue. Run agent-purge clean to inspect them if needed.',
      mbInformation, MB_OK, IDOK);
end;
