# Invoked only by the owned Windows Sandbox configuration. PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ status = 'started'; os = (Get-CimInstance Win32_OperatingSystem).Caption; computer = $env:COMPUTERNAME }
$report.memoryMiB = [math]::Round((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize / 1024)
# A stalled probe cannot keep this disposable guest alive indefinitely.
& C:\Windows\System32\shutdown.exe /s /t 720 | Out-Null
try {
  $manifest = Get-Content -LiteralPath C:\Input\manifest.json -Raw | ConvertFrom-Json
  $report.externalProbePhase = if ($manifest.mode -eq 'Offline') { 'Networking disabled at guest boot' } else { 'Before guest firewall setup; no provider or credential present' }
  if ((Get-FileHash -LiteralPath C:\Input\payload.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.payloadSha256) { throw 'Payload hash mismatch' }
  $report.hostFileVisible = Test-Path -LiteralPath $manifest.hostSentinel
  $report.hostProcessVisible = @((Get-CimInstance Win32_Process) | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($manifest.hostProcessMarker) }).Count -gt 0
  $report.inputWriteBlocked = $false
  try { Add-Content -LiteralPath C:\Input\readonly-sentinel.txt -Value 'unexpected guest write' -ErrorAction Stop } catch { $report.inputWriteBlocked = $true }
  $report.networkAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,Status)
  $tcp = New-Object System.Net.Sockets.TcpClient
  try { $attempt = $tcp.BeginConnect('1.1.1.1',443,$null,$null); $report.externalConnected = $attempt.AsyncWaitHandle.WaitOne(2000) -and $tcp.Connected } catch { $report.externalConnected = $false } finally { $tcp.Close() }
  if ($report.hostFileVisible -or $report.hostProcessVisible -or !$report.inputWriteBlocked) { throw 'Host-sharing boundary check failed' }
  if ($manifest.mode -eq 'Offline' -and ($report.externalConnected -or $report.networkAdapters.Count)) { throw 'Offline network boundary failed' }
  if ($manifest.mode -ne 'Offline') {
    # Only the disposable guest's firewall is changed. No host policy or shared service changes.
    Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Block
    Get-NetFirewallRule -Direction Outbound -Enabled True | Disable-NetFirewallRule
    New-NetFirewallRule -DisplayName 'Threadlight fixed API addresses' -Direction Outbound -Action Allow -Protocol TCP -RemotePort 443 -RemoteAddress $manifest.apiAddresses | Out-Null
    New-NetFirewallRule -DisplayName 'Threadlight block host and private ranges' -Direction Outbound -Action Block -RemoteAddress @('10.0.0.0/8','100.64.0.0/10','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16') | Out-Null
    # Windows can regenerate packaged-app allow rules. Explicit denies take precedence.
    function AddressNumber([string]$address) {
      $bytes=[Net.IPAddress]::Parse($address).GetAddressBytes()
      return [uint64]$bytes[0]*16777216+[uint64]$bytes[1]*65536+[uint64]$bytes[2]*256+[uint64]$bytes[3]
    }
    function AddressText([uint64]$number) {
      return ('{0}.{1}.{2}.{3}' -f (($number -shr 24) -band 255),(($number -shr 16) -band 255),(($number -shr 8) -band 255),($number -band 255))
    }
    $blockedRanges=@(); [uint64]$first=1
    foreach ($number in @($manifest.apiAddresses | ForEach-Object { AddressNumber $_ } | Sort-Object -Unique)) {
      if ($number -gt $first) { $blockedRanges += ((AddressText $first)+'-'+(AddressText ($number-1))) }
      $first=$number+1
    }
    if ($first -lt 4294967295) { $blockedRanges += ((AddressText $first)+'-255.255.255.254') }
    New-NetFirewallRule -DisplayName 'Threadlight deny every other IPv4 destination' -Direction Outbound -Action Block -RemoteAddress $blockedRanges | Out-Null
    New-NetFirewallRule -DisplayName 'Threadlight deny non-TLS API ports' -Direction Outbound -Action Block -Protocol TCP -RemoteAddress $manifest.apiAddresses -RemotePort @('0-442','444-65535') | Out-Null
    New-NetFirewallRule -DisplayName 'Threadlight deny UDP' -Direction Outbound -Action Block -Protocol UDP | Out-Null
    New-NetFirewallRule -DisplayName 'Threadlight deny ICMP' -Direction Outbound -Action Block -Protocol ICMPv4 | Out-Null
    Get-NetAdapterBinding -ComponentID ms_tcpip6 | Disable-NetAdapterBinding
    foreach ($address in $manifest.apiAddresses) { Add-Content -LiteralPath C:\Windows\System32\drivers\etc\hosts -Value ($address+' api.moonshot.ai') -Encoding ASCII }
    $network = [ordered]@{ status='checking'; apiAddresses=$manifest.apiAddresses; profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore | Select-Object Name,Enabled,DefaultOutboundAction); outboundAllowRules=@(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Enabled True -Action Allow | Select-Object DisplayName) }
    $network.deniedRanges=@((Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName 'Threadlight deny every other IPv4 destination' | Get-NetFirewallAddressFilter).RemoteAddress)
    $network.ipv6Enabled=@(Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object Enabled).Count -gt 0
    if (@($network.profiles | Where-Object { !$_.Enabled -or $_.DefaultOutboundAction -ne 'Block' }).Count -or $network.ipv6Enabled -or $network.deniedRanges.Count -ne $blockedRanges.Count) { throw 'Effective guest network policy differs' }
    $allow=Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName 'Threadlight fixed API addresses' | Where-Object { $_.Direction -eq 'Outbound' -and $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }
    $network.allowedAddresses=@(($allow | Get-NetFirewallAddressFilter).RemoteAddress)
    $network.allowedPort=($allow | Get-NetFirewallPortFilter).RemotePort
    if ((($network.allowedAddresses | Sort-Object) -join ',') -ne (($manifest.apiAddresses | Sort-Object) -join ',') -or $network.allowedPort -ne '443') { throw 'Effective API address/port differs' }
    $network.blockedTargets = @()
    $gateway = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1 -ExpandProperty NextHop
    foreach ($target in @('1.1.1.1',$gateway)) {
      $tcp = New-Object System.Net.Sockets.TcpClient
      try { $attempt=$tcp.BeginConnect($target,443,$null,$null); $connected=$attempt.AsyncWaitHandle.WaitOne(2000) -and $tcp.Connected } catch { $connected=$false } finally { $tcp.Close() }
      $network.blockedTargets += @{ address=$target; connected=$connected }
      if ($connected) { throw 'Non-API connection succeeded' }
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request=[Net.HttpWebRequest]::Create('https://api.moonshot.ai/v1/models')
    $request.Proxy=$null; $request.AllowAutoRedirect=$false; $request.Timeout=15000
    $response=$null
    try { $response=$request.GetResponse() } catch [Net.WebException] { $response=$_.Exception.Response; if (!$response) { throw 'API TLS route failed' } }
    $network.unauthenticatedStatus=[int]$response.StatusCode; $response.Close()
    if ($network.unauthenticatedStatus -ne 401) { throw 'Expected unauthenticated API response was not observed' }
    $network.status='observed'
    $network | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath C:\Evidence\network.json -Encoding UTF8
    if ($manifest.mode -eq 'OnlinePreflight') { $report.status='observed'; return }
  }
  'Extracting curated payload' | Set-Content -LiteralPath C:\Evidence\progress.txt
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory('C:\Input\payload.zip','C:\KimiProof')
  New-Item -ItemType Directory -Path C:\KimiProof\phase2b | Out-Null
  $env:PATH = 'C:\KimiProof\node;C:\KimiProof\node\git\cmd;C:\Windows\System32;C:\Windows'
  $env:NODE_OPTIONS = $null
  $env:NODE_PATH = $null
  Set-Location -LiteralPath C:\KimiProof\threadlight
  if ($manifest.mode -eq 'Live') {
    $env:THREADLIGHT_KIMI_GUEST_READY='online-checked'
    Write-Host 'Dedicated Moonshot API key. Input is hidden. It stays in this disposable guest.'
    $secure=Read-Host -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:THREADLIGHT_KIMI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    try { & C:\KimiProof\node\node.exe test/live/kimi-acp.proof.mjs moonshot-single 1>C:\Evidence\live.stdout.txt 2>C:\Evidence\live.stderr.txt; $liveExit=$LASTEXITCODE } finally { $env:THREADLIGHT_KIMI_API_KEY=$null }
    if ($liveExit -ne 0) { throw 'Live operation failed or was uncertain; no replay' }
    $report.status='observed'; return
  }
  'Running scripted runtime' | Set-Content -LiteralPath C:\Evidence\progress.txt
  & C:\KimiProof\node\node.exe test/live/kimi-acp.proof.mjs scripted C:\KimiProof\runtime C:\KimiProof\phase2b\offline-four 1>C:\Evidence\scripted.stdout.txt 2>C:\Evidence\scripted.stderr.txt
  $report.scriptedExit = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw 'Scripted Kimi exercise failed; do not replay' }
  'Running API wire rehearsal' | Set-Content -LiteralPath C:\Evidence\progress.txt
  & C:\KimiProof\node\node.exe test/live/kimi-acp.proof.mjs api-rehearsal C:\KimiProof\runtime C:\KimiProof\phase2b\api-rehearsal 1>C:\Evidence\rehearsal.stdout.txt 2>C:\Evidence\rehearsal.stderr.txt
  $report.rehearsalExit = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw 'API wire rehearsal failed; do not replay' }
  $report.remainingOwnedNode = @((Get-CimInstance Win32_Process) | Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -like 'C:\KimiProof\*' }).Count
  if ($report.remainingOwnedNode) { throw 'Owned Node activity remains' }
  $report.status = 'observed'
} catch {
  $report.status = 'failed'
  $report.error = $_.Exception.Message
  $report.errorLine = $_.InvocationInfo.ScriptLineNumber
} finally {
  if ($network) { $network | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath C:\Evidence\network.json -Encoding UTF8 }
  $report.remainingOwnedNode = @((Get-CimInstance Win32_Process) | Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -like 'C:\KimiProof\*' }).Count
  if ($report.remainingOwnedNode) { $report.status='failed'; $report.error='Owned activity did not settle before guest retirement' }
  # Only synthetic receipts leave the guest; no generated executable is run on the host.
  if (Test-Path -LiteralPath C:\KimiProof\phase2b\offline-four\report.json) { Copy-Item -LiteralPath C:\KimiProof\phase2b\offline-four\report.json -Destination C:\Evidence\scripted-report.json }
  if (Test-Path -LiteralPath C:\KimiProof\phase2b\api-rehearsal\report.json) { Copy-Item -LiteralPath C:\KimiProof\phase2b\api-rehearsal\report.json -Destination C:\Evidence\rehearsal-report.json }
  if (Test-Path -LiteralPath C:\KimiProof\phase2b\scripted-budget.json) { Copy-Item -LiteralPath C:\KimiProof\phase2b\scripted-budget.json -Destination C:\Evidence\budget.json }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath C:\Evidence\boundary.json -Encoding UTF8
  & C:\Windows\System32\shutdown.exe /a | Out-Null
  & C:\Windows\System32\shutdown.exe /s /t 0 | Out-Null
}
