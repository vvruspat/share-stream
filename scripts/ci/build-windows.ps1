$ErrorActionPreference = 'Stop'
cmake -S . -B build -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build build --config Release --target stream_probe --parallel 3
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
ctest --test-dir build -C Release -R '^stream_transport$' --output-on-failure
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build build --config Release --parallel 3
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
ctest --test-dir build -C Release -E '^stream_transport$' --output-on-failure
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$version = (Select-String -Path CMakeLists.txt -Pattern 'project\(ShareStream VERSION ([\d.]+)').Matches.Groups[1].Value
$compiler = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (!(Test-Path $compiler)) { throw 'Inno Setup 6 is required' }
& $compiler "/DAppVersion=$version" packaging/windows.iss
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Smoke-test the actual installer and uninstaller, not just its generation.
$setup = Start-Process dist/ShareStream-Setup-Windows-x64.exe -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Setup failed: $($setup.ExitCode)" }
$receiver = "$env:LOCALAPPDATA\Programs\Share Stream\Share Stream.exe"
$vst = "$env:LOCALAPPDATA\Programs\Common\VST3\Share Stream.vst3"
if (!(Test-Path $receiver) -or !(Test-Path $vst)) { throw 'Installer did not install both components' }
# A locked VST3 must reject the whole update before replacing the receiver.
[IO.File]::AppendAllText($receiver, 'CI-old-version-marker')
$oldHash = (Get-FileHash $receiver).Hash
$module = Get-ChildItem $vst -Recurse -File -Filter '*.vst3' | Select-Object -First 1
if (!$module) { throw 'Installed VST3 module missing' }
$locked = [IO.File]::Open($module.FullName, 'Open', 'Read', 'None')
try {
  $blocked = Start-Process dist/ShareStream-Setup-Windows-x64.exe -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
  if ($blocked.ExitCode -eq 0) { throw 'Setup ignored an in-use VST3' }
  if ((Get-FileHash $receiver).Hash -ne $oldHash) { throw 'Setup partially updated a locked installation' }
} finally { $locked.Dispose() }
$update = Start-Process dist/ShareStream-Setup-Windows-x64.exe -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
if ($update.ExitCode -ne 0) { throw "Update failed: $($update.ExitCode)" }
if ((Get-FileHash $receiver).Hash -ne (Get-FileHash 'build/ShareStreamReceiver_artefacts/Release/Share Stream.exe').Hash) { throw 'Update did not restore the current receiver' }
$uninstall = Start-Process "$env:LOCALAPPDATA\Programs\Share Stream\unins000.exe" -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Uninstall failed: $($uninstall.ExitCode)" }
if ((Test-Path $receiver) -or (Test-Path $vst)) { throw 'Uninstaller did not remove both components' }
