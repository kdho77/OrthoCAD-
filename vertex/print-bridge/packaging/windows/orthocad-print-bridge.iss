; OrthoCAD Print Bridge — double-click Windows installer.
; Build on Windows with Inno Setup 6 after packaging/build-payload.mjs.
; The shop user does not open a command window.

#define MyAppName "OrthoCAD Print Bridge"
#define MyAppVersion "2026.11.10.1"
#define MyAppPublisher "Vertex Orthopedic"

[Setup]
AppId={{A7E1C3B2-9F04-4C1A-9B2E-0C5D6E7F8091}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\OrthoCAD\PrintBridge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputBaseFilename=OrthoCAD-Print-Bridge-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\OrthoCADPrintBridge.exe

[Files]
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "OrthoCADPrintBridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "OrthoCADPrintBridge.xml"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\node\node.exe"; Parameters: """{app}\prepare-config.mjs"""; Flags: runhidden waituntilterminated
Filename: "{app}\OrthoCADPrintBridge.exe"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{app}\OrthoCADPrintBridge.exe"; Parameters: "start"; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\OrthoCADPrintBridge.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated
Filename: "{app}\OrthoCADPrintBridge.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated
