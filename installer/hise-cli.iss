; ── Inno Setup script for hise-cli ───────────────────────────────────
;
; Per-user install (no UAC). Drops hise-cli.exe into
; %LOCALAPPDATA%\Programs\hise-cli\, adds that directory to the user's
; PATH (HKCU\Environment), and registers an uninstaller.
;
; Build:   iscc installer\hise-cli.iss
; Output:  dist\hise-cli-setup.exe
; Silent:  hise-cli-setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES

#define AppName       "hise-cli"
#define AppPublisher  "Christoph Hart"
#define AppURL        "https://github.com/christophhart/hise-cli"
#define AppExeName    "hise-cli.exe"

; AppVersion is injected on the iscc command line via /DAppVersion=...
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
AppId={{9E3A8E22-3F2C-4B5D-9A4E-6C2C9F3E8A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=hise-cli-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Files]
Source: "..\dist\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Idempotent PATH append for the current user. Inno Setup re-evaluates
; the value at install time, so multiple installs don't duplicate.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
  ValueData: "{olddata};{app}"; \
  Check: NeedsAddPath(ExpandConstant('{app}'))

[Code]
function NeedsAddPath(Param: string): Boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  // Case-insensitive, surround in ; to match exact dir entries.
  Result := Pos(';' + Lowercase(Param) + ';', ';' + Lowercase(OrigPath) + ';') = 0;
end;
