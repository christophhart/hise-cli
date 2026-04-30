; ── Inno Setup template for HISE plugin installers ─────────────────
;
; Generic, parameterized template invoked by hise-cli's
; `publishBuildInstaller` task. All variable inputs come in via /D
; switches:
;
;   iscc /DAppName=MyPlugin /DAppVersion=1.0.0 /DOutputDir=C:\proj\dist \
;        /DVst3Source=C:\proj\dist\payload\MyPlugin.vst3 \
;        /DAaxSource=C:\proj\dist\payload\MyPlugin.aaxplugin \
;        /DStandaloneSource=C:\proj\dist\payload\MyPlugin.exe \
;        /DEulaSource=C:\proj\eula.txt \
;        installer\build_installer.iss
;
; Empty `/D` switches are treated as "skip that file" via the HasSource
; predicate in [Code] — so the same template works for any subset of
; payloads.
;
; Output:  <OutputDir>\<AppName>-<AppVersion>-setup.exe

#ifndef AppName
  #define AppName "Plugin"
#endif

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#ifndef Vst3Source
  #define Vst3Source ""
#endif

#ifndef AaxSource
  #define AaxSource ""
#endif

#ifndef StandaloneSource
  #define StandaloneSource ""
#endif

#ifndef EulaSource
  #define EulaSource ""
#endif

#ifndef AppPublisher
  #define AppPublisher "HISE Plugin"
#endif

#ifndef AppId
  ; Stable AppId per project would normally be derived from
  ; BundleIdentifier. For first-cut hise-cli output this hardcoded GUID
  ; is fine; subsequent releases can override with /DAppId={...}.
  #define AppId "{{B7D2E0FF-9F11-4E0E-A8C5-3E0F2A5C6F71}"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={commonpf64}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
DisableReadyPage=yes
PrivilegesRequired=admin
OutputDir={#OutputDir}
OutputBaseFilename={#AppName}-{#AppVersion}-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
#if EulaSource != ""
LicenseFile={#EulaSource}
#endif

[Files]
; VST3 — installs into the system VST3 folder. Bundle is a directory; use
; recursesubdirs so the entire .vst3 plugin is copied.
Source: "{#Vst3Source}\*"; DestDir: "{commoncf64}\VST3\{#AppName}.vst3"; \
  Flags: ignoreversion recursesubdirs createallsubdirs; \
  Check: HasSource('{#Vst3Source}')

; AAX — installs into Avid's plug-in folder. Bundle is also a directory.
Source: "{#AaxSource}\*"; DestDir: "{commoncf64}\Avid\Audio\Plug-Ins\{#AppName}.aaxplugin"; \
  Flags: ignoreversion recursesubdirs createallsubdirs; \
  Check: HasSource('{#AaxSource}')

; Standalone .exe — installed alongside other app artifacts in {app}.
Source: "{#StandaloneSource}"; DestDir: "{app}"; Flags: ignoreversion; \
  Check: HasSource('{#StandaloneSource}')

[Code]
function HasSource(P: string): Boolean;
begin
  if Length(P) = 0 then
  begin
    Result := False;
    exit;
  end;
  // Bundles are directories; standalone is a single file. Accept either.
  Result := DirExists(P) or FileExists(P);
end;
