#define InstallerName "LosslessAudioSonoBusRelay"
#define SourceRoot GetEnv("GITHUB_WORKSPACE")

[Setup]
AppId={{E8B37F25-9855-4B70-B5C6-79CCF5F97A20}
AppName=Lossless Audio SonoBus Relay
AppVersion={#SBVERSION}
AppPublisher=xinzhihong-ship-it
AppPublisherURL=https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay
AppSupportURL=https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay
AppUpdatesURL=https://github.com/xinzhihong-ship-it/lossless-audio-sonobus-relay/releases
DefaultDirName={autopf}\Lossless Audio SonoBus Relay
DefaultGroupName=Lossless Audio SonoBus Relay
UninstallDisplayIcon={app}\SonoBus.exe
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile={#SourceRoot}\installer-input\SonoBus\LICENSE
OutputDir={#SourceRoot}\installer-output
OutputBaseFilename={#InstallerName}-{#SBVERSION}{#SBASIOSUFFIX}-Setup

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full installation"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "app"; Description: "Standalone application"; Types: full custom; Flags: fixed
Name: "vst3"; Description: "VST3 plugins"; Types: full custom

[Files]
Source: "{#SourceRoot}\installer-input\SonoBus\SonoBus.exe"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\README.md"; DestDir: "{app}"; Components: app; Flags: ignoreversion isreadme
Source: "{#SourceRoot}\installer-input\SonoBus\LICENSE"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\LICENSE_EXCEPTION"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\NOTICE.md"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\sonobus-LICENSE"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\sonobus-LICENSE_EXCEPTION"; DestDir: "{app}"; Components: app; Flags: ignoreversion
Source: "{#SourceRoot}\installer-input\SonoBus\SonoBus.vst3\*"; DestDir: "{commoncf}\VST3\SonoBus.vst3"; Components: vst3; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\installer-input\SonoBus\SonoBusInstrument.vst3\*"; DestDir: "{commoncf}\VST3\SonoBusInstrument.vst3"; Components: vst3; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\SonoBus"; Filename: "{app}\SonoBus.exe"
Name: "{group}\README"; Filename: "{app}\README.md"
Name: "{group}\Uninstall"; Filename: "{uninstallexe}"
Name: "{autodesktop}\SonoBus"; Filename: "{app}\SonoBus.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Run]
Filename: "{app}\SonoBus.exe"; Description: "Launch SonoBus"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{commoncf}\VST3\SonoBus.vst3"
Type: filesandordirs; Name: "{commoncf}\VST3\SonoBusInstrument.vst3"
