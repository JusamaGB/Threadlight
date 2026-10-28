$ErrorActionPreference='Stop'
$result=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o');phase='identity';complete=$false}
$out='C:\ThreadlightResults\result.json'
function Save-Result { $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out }
$owned=@()
try {
  $system=Get-CimInstance Win32_ComputerSystem
  if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $system.Model -notmatch 'Virtual' -or (Test-Path 'Z:\UserProfile')) { throw 'Requires isolated Windows Sandbox guest.' }
  $result.guestGuard=$true
  $result.phase='copy-distribution'; Save-Result
  $root='C:\ThreadlightGuest'
  New-Item -ItemType Directory -Path "$root\bin","$root\home" -Force | Out-Null
  Copy-Item -LiteralPath 'C:\ThreadlightDistribution\bin\codex.exe' -Destination "$root\bin\codex.exe"
  Copy-Item -LiteralPath 'C:\ThreadlightDistribution\bin\node.exe' -Destination "$root\bin\node.exe"
  Copy-Item -LiteralPath 'C:\ThreadlightDistribution\desktop' -Destination "$root\desktop" -Recurse
  Copy-Item -LiteralPath 'C:\ThreadlightProbe\observer.cjs' -Destination "$root\observer.cjs"
  $result.cliVersion=(& "$root\bin\codex.exe" --version | Out-String).Trim()
  $result.cliHash=(Get-FileHash "$root\bin\codex.exe").Hash
  $result.archiveHash=(Get-FileHash "$root\desktop\resources\app.asar").Hash
  $env:CODEX_HOME="$root\home"
  $env:CODEX_ELECTRON_USER_DATA_PATH="$root\desktop-profile"
  $env:CODEX_CLI_PATH="$root\bin\codex.exe"
  $env:CODEX_APP_SERVER_WS_URL='ws://127.0.0.1:45101'
  $env:CODEX_SPARKLE_ENABLED='false'
  [IO.File]::WriteAllText("$root\home\config.toml","[analytics]`nenabled = false`n")
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes); $rng.Dispose()
  $token=[Convert]::ToBase64String($bytes)
  [IO.File]::WriteAllText("$root\token.txt",$token)
  function Connect-Probe([string]$label,[string]$credential) {
    $socket=New-Object System.Net.WebSockets.ClientWebSocket
    $cancel=New-Object System.Threading.CancellationTokenSource
    $cancel.CancelAfter(12000)
    try {
      if ($credential) { $socket.Options.SetRequestHeader('Authorization','Bearer '+$credential) }
      $socket.ConnectAsync([uri]'ws://127.0.0.1:45101',$cancel.Token).GetAwaiter().GetResult() | Out-Null
      $init=@{id=1;method='initialize';params=@{clientInfo=@{name="threadlight_cards_$label";version='0.0.1'};capabilities=@{experimentalApi=$true}}} | ConvertTo-Json -Depth 6 -Compress
      $data=[Text.Encoding]::UTF8.GetBytes($init)
      $segment=New-Object 'System.ArraySegment[byte]' -ArgumentList (,$data)
      $socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult() | Out-Null
      for ($i=0;$i -lt 5;$i++) {
        $buffer=New-Object byte[] 65536
        $received=$socket.ReceiveAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList (,$buffer)),$cancel.Token).GetAwaiter().GetResult()
        $reply=[Text.Encoding]::UTF8.GetString($buffer,0,$received.Count) | ConvertFrom-Json
        if ($reply.id -eq 1) { return @{connected=$true;initialized=($null -ne $reply.result)} }
      }
      return @{connected=$true;initialized=$false}
    } catch { return @{connected=$false;error=$_.Exception.Message} }
    finally { $socket.Abort(); $socket.Dispose(); $cancel.Dispose() }
  }
  $result.phase='start-server'; Save-Result
  $server=Start-Process "$root\bin\codex.exe" -ArgumentList @('app-server','--listen','ws://127.0.0.1:45100','--ws-auth','capability-token','--ws-token-file',"$root\token.txt") -WindowStyle Hidden -RedirectStandardOutput "$root\server.out" -RedirectStandardError "$root\server.err" -PassThru
  $owned+=$server.Id
  $observer=Start-Process "$root\bin\node.exe" -ArgumentList "$root\observer.cjs" -WindowStyle Hidden -RedirectStandardOutput "$root\observer.out" -RedirectStandardError "$root\observer.err" -PassThru
  $owned+=$observer.Id
  Start-Sleep -Seconds 3
  $result.phase='negative-control'; Save-Result
  $result.noToken=Connect-Probe 'missing' ''
  Save-Result
  $result.wrongToken=Connect-Probe 'wrong' 'synthetic-wrong-token'
  Save-Result
  $result.phase='positive-control'; Save-Result
  $result.correctToken=Connect-Probe 'valid' $token
  Save-Result
  if (-not $result.correctToken.initialized -or $result.noToken.connected -or $result.wrongToken.connected) { throw 'Authentication controls failed; desktop not launched.' }
  $result.phase='desktop'; Save-Result
  $desktop=Start-Process "$root\desktop\ChatGPT.exe" -WorkingDirectory "$root\desktop" -WindowStyle Hidden -RedirectStandardOutput "$root\desktop.out" -RedirectStandardError "$root\desktop.err" -PassThru
  $owned+=$desktop.Id
  Start-Sleep -Seconds 30
  $result.desktopRunning=($null -ne (Get-Process -Id $desktop.Id -ErrorAction SilentlyContinue))
  $result.handshakes=@(Get-Content "$root\handshakes.jsonl" | ForEach-Object { $_ | ConvertFrom-Json })
  $result.complete=$true
} catch { $result.failure=$_.Exception.Message }
finally {
  $result.phase='results-saved'; $result.finishedAt=[DateTime]::UtcNow.ToString('o'); Save-Result
  foreach ($ownedId in $owned) { Stop-Process -Id $ownedId -Force -ErrorAction SilentlyContinue }
  $result.phase='finished'; Save-Result
}
