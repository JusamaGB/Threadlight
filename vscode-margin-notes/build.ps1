$ErrorActionPreference='Stop'
$framework=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$out=Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
$sources=(Get-ChildItem (Join-Path $PSScriptRoot 'windows') -Filter '*.cs').FullName
& "$framework/csc.exe" /nologo /target:exe /platform:anycpu /optimize+ /unsafe "/out:$out/MarginNotes.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "/r:$framework/WPF/UIAutomationClient.dll" "/r:$framework/WPF/UIAutomationTypes.dll" "/r:$framework/WPF/WindowsBase.dll" $sources
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
