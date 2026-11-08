# Owned disposable guest only. No feature installation or host security changes. PowerShell 5.1.
param(
  [Parameter(Mandatory=$true)][string]$PayloadZip,
  [Parameter(Mandatory=$true)][string]$RunRoot,
  [ValidateSet('Offline','OnlinePreflight','Live')][string]$Mode='Offline',
  [string]$AuthorizationJson
)
$ErrorActionPreference = 'Stop'
if (Get-Process WindowsSandbox,WindowsSandboxClient -ErrorAction SilentlyContinue) { throw 'An existing Sandbox must be left alone' }
$payload = (Resolve-Path -LiteralPath $PayloadZip).Path
$ownedRoot = [System.IO.Path]::GetFullPath($RunRoot)
if (![System.IO.Path]::IsPathRooted($RunRoot) -or (Test-Path -LiteralPath $ownedRoot)) { throw 'An absolute fresh run folder is required' }
$parent = Get-Item -LiteralPath ([System.IO.Path]::GetDirectoryName($ownedRoot))
if ($parent.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Run parent must not be a junction' }
$feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='Containers-DisposableClientVM'"
if ($feature.InstallState -ne 1) { throw 'Windows Sandbox is not already enabled' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($payload)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -notmatch '^(node|runtime|threadlight)/' -or $entry.FullName -match '(^|[\\/])\.\.([\\/]|$)|:|^[/\\]') { throw 'Unexpected payload path' }
  }
  foreach ($required in @('node/node.exe','node/git/usr/bin/bash.exe','threadlight/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node','threadlight/test/fixtures/kimi-api-fetch-guard.mjs')) {
    if (!$zip.GetEntry($required)) { throw ('Missing payload dependency: '+$required) }
  }
} finally { $zip.Dispose() }
if ($Mode -eq 'Live' -and !$AuthorizationJson) { throw 'Live requires the separately recorded explicit usage authorization' }
$apiAddresses = @()
if ($Mode -ne 'Offline') {
  $apiAddresses = @(Resolve-DnsName api.moonshot.ai -Type A | Where-Object { $_.Type -eq 'A' } | Select-Object -ExpandProperty IPAddress -Unique)
  if (!$apiAddresses.Count) { throw 'No current API address' }
  foreach ($address in $apiAddresses) {
    if ($address -notmatch '^\d+\.\d+\.\d+\.\d+$' -or $address -match '^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\.') { throw 'API address is not public IPv4' }
  }
}
$inputRoot = Join-Path $ownedRoot 'input'
$outputRoot = Join-Path $ownedRoot 'evidence'
New-Item -ItemType Directory -Path $ownedRoot,$inputRoot,$outputRoot | Out-Null
Copy-Item -LiteralPath $payload -Destination (Join-Path $inputRoot 'payload.zip')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../fixtures/kimi-sandbox-guest.ps1') -Destination (Join-Path $inputRoot 'guest.ps1')
if ($Mode -eq 'Live') { Copy-Item -LiteralPath $AuthorizationJson -Destination (Join-Path $inputRoot 'authorization.json') }
'Synthetic read-only input.' | Set-Content -LiteralPath (Join-Path $inputRoot 'readonly-sentinel.txt') -Encoding UTF8
$hostSentinel = Join-Path $ownedRoot 'host-only-sentinel.txt'
'Synthetic host-only sentinel.' | Set-Content -LiteralPath $hostSentinel -Encoding UTF8
$sentinelScript = Join-Path $ownedRoot 'host-sentinel.cjs'
'setInterval(() => {}, 1000)' | Set-Content -LiteralPath $sentinelScript -Encoding UTF8
$sentinel = $null
$instance = $null
$networking = if ($Mode -eq 'Offline') { 'Disable' } else { 'Enable' }
$hostReport = [ordered]@{ status='prepared'; mode=$Mode; networking=$networking; memoryMiB=2048; sharing='curated input read-only; fresh evidence output writable'; started=(Get-Date).ToUniversalTime().ToString('o') }
try {
  $sentinel = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList ('"'+$sentinelScript+'"') -WindowStyle Hidden -PassThru
  $before = (Get-FileHash -LiteralPath $hostSentinel -Algorithm SHA256).Hash
  $readonlyBefore = (Get-FileHash -LiteralPath (Join-Path $inputRoot 'readonly-sentinel.txt') -Algorithm SHA256).Hash
  @{ mode=$Mode; apiAddresses=$apiAddresses; payloadSha256=(Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant(); hostSentinel=$hostSentinel; hostProcessMarker=$sentinelScript } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $inputRoot 'manifest.json') -Encoding UTF8
  $inputXml = [System.Security.SecurityElement]::Escape($inputRoot)
  $outputXml = [System.Security.SecurityElement]::Escape($outputRoot)
  $config = @"
<Configuration>
<VGpu>Disable</VGpu><Networking>$networking</Networking>
<AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection><ClipboardRedirection>Disable</ClipboardRedirection>
<ProtectedClient>Enable</ProtectedClient><MemoryInMB>2048</MemoryInMB>
<MappedFolders><MappedFolder><HostFolder>$inputXml</HostFolder><SandboxFolder>C:\Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>$outputXml</HostFolder><SandboxFolder>C:\Evidence</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders>
<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Input\guest.ps1</Command></LogonCommand>
</Configuration>
"@
  $configPath = Join-Path $ownedRoot 'offline.wsb'
  $config | Set-Content -LiteralPath $configPath -Encoding UTF8
  $hostReport.configSha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
  $windowStyle = if ($Mode -eq 'Live') { 'Normal' } else { 'Hidden' }
  $instance = Start-Process -FilePath "$env:WINDIR/System32/WindowsSandbox.exe" -ArgumentList ('"'+$configPath+'"') -WindowStyle $windowStyle -PassThru
  $hostReport.launcherPid = $instance.Id
  $deadline = (Get-Date).AddMinutes(15)
  while (!$instance.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500; $instance.Refresh() }
  if (!$instance.HasExited) { throw 'Owned guest did not retire by deadline; no automatic retry' }
  $hostReport.guestRetired = $true
  $hostReport.hostFileUnchanged = (Get-FileHash -LiteralPath $hostSentinel -Algorithm SHA256).Hash -eq $before
  $hostReport.readonlyInputUnchanged = (Get-FileHash -LiteralPath (Join-Path $inputRoot 'readonly-sentinel.txt') -Algorithm SHA256).Hash -eq $readonlyBefore
  $hostReport.hostProcessUnaffected = !$sentinel.HasExited
  $receipt = Get-Content -LiteralPath (Join-Path $outputRoot 'boundary.json') -Raw | ConvertFrom-Json
  if ($receipt.status -ne 'observed' -or !$hostReport.hostFileUnchanged -or !$hostReport.readonlyInputUnchanged -or !$hostReport.hostProcessUnaffected) { throw 'Boundary/runtime evidence did not pass' }
  $hostReport.status = 'observed'
} catch { $hostReport.status='failed'; $hostReport.error=$_.Exception.Message; throw }
finally {
  if ($instance -and !$instance.HasExited) {
    # Never stop shared Hyper-V/WSL services or workers. Only this launcher's client.
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($instance.Id)" | Where-Object { $_.Name -eq 'WindowsSandboxClient.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    $instance.Kill()
    $hostReport.guestRetirementUnverified = $true
  }
  if ($sentinel -and !$sentinel.HasExited) { $sentinel.Kill(); $sentinel.WaitForExit() }
  $hostReport.finished = (Get-Date).ToUniversalTime().ToString('o')
  $hostReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ownedRoot 'host-report.json') -Encoding UTF8
}
