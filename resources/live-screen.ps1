param([switch]$SelfTest, [switch]$InspectOnly)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'LiveScreen.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Core
if ($SelfTest) { [ThreadlightLiveScreen]::SelfTest(); exit }
[ThreadlightLiveScreen]::Run(-not $InspectOnly)
