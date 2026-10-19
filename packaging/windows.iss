#ifndef AppVersion
  #error AppVersion must be supplied by CI
#endif
[Setup]
AppId=audio.sharestream.windows
AppName=Share Stream
AppVersion={#AppVersion}
AppPublisher=Share Stream
AppPublisherURL=https://github.com/vvruspat/share-stream
DefaultDirName={localappdata}\Programs\Share Stream
DefaultGroupName=Share Stream
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=ShareStream-Setup-Windows-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\Share Stream.exe
SetupMutex=ShareStreamSetup
DisableProgramGroupPage=yes
InfoBeforeFile=windows-before.txt
[Files]
Source: "..\build\ShareStreamReceiver_artefacts\Release\Share Stream.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\ShareStream_artefacts\Release\VST3\Share Stream.vst3\*"; DestDir: "{usercf}\VST3\Share Stream.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\vendor\monocypher\LICENCE.md"; DestDir: "{app}"; DestName: "Monocypher-LICENCE.md"; Flags: ignoreversion
[Icons]
Name: "{group}\Share Stream"; Filename: "{app}\Share Stream.exe"
Name: "{group}\Uninstall Share Stream"; Filename: "{uninstallexe}"
[Run]
Filename: "{app}\Share Stream.exe"; Description: "Open Share Stream"; Flags: nowait postinstall skipifsilent
[Code]
function FileUnavailable(const FileName: String): Boolean;
var
  Stream: TFileStream;
begin
  Result := False;
  if not FileExists(FileName) then Exit;
  try
    Stream := TFileStream.Create(FileName, fmOpenReadWrite or fmShareExclusive);
    Stream.Free;
  except
    Result := True;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if FileUnavailable(ExpandConstant('{app}\Share Stream.exe')) or
     FileUnavailable(ExpandConstant('{usercf}\VST3\Share Stream.vst3\Contents\x86_64-win\Share Stream.vst3')) then
    Result := 'Save your session and close Share Stream and your DAW, then run Setup again. No files have been changed. If they are already closed, check write access to the installation folders.';
end;
