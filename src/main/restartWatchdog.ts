import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { windowsPowerShell } from './sessions/paths'

const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64')
const run = (script: string) =>
  execFileSync(
    windowsPowerShell(),
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded(script)],
    { windowsHide: true, timeout: 7000, stdio: 'pipe', encoding: 'utf8' },
  )

/** Keep a handle to this exact process: graceful exit and PID reuse cannot target another app. */
export function armRestartWatchdog(pid = process.pid, timeoutMs = 8000): () => void {
  if (process.platform !== 'win32') return () => {}
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30000
  )
    throw new Error('Invalid restart watchdog target or deadline.')
  const identity = `Local\\ThreadlightRestart-${randomUUID()}`
  // Start-Process gives the helper its own hidden console; it must survive Electron's shutdown.
  // Both events exist before launch. A failed readiness handshake cancels the helper before quitting.
  run(`$ErrorActionPreference = 'Stop'
$original = [Diagnostics.Process]::GetProcessById(${pid})
$started = $original.StartTime.ToUniversalTime().Ticks
$ready = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, '${identity}-ready')
$cancel = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, '${identity}-cancel')
try {
  $helper = @'
$ErrorActionPreference = 'Stop'
$ready = [Threading.EventWaitHandle]::OpenExisting('${identity}-ready')
$cancel = [Threading.EventWaitHandle]::OpenExisting('${identity}-cancel')
try {
  if ($cancel.WaitOne(0)) { exit }
  $original = [Diagnostics.Process]::GetProcessById(${pid})
  if ($original.StartTime.ToUniversalTime().Ticks -ne STARTED_TICKS) { exit }
  $null = $original.Handle
  $null = $ready.Set()
  $elapsed = [Diagnostics.Stopwatch]::StartNew()
  while (-not $original.WaitForExit(100)) {
    if ($cancel.WaitOne(0)) { exit }
    if ($elapsed.ElapsedMilliseconds -ge ${timeoutMs}) {
      $original.Kill()
      break
    }
  }
} finally {
  if ($null -ne $original) { $original.Dispose() }
  $ready.Dispose()
  $cancel.Dispose()
}
'@
  $helper = $helper.Replace('STARTED_TICKS', $started.ToString())
  $command = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
  $null = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', $command) -WindowStyle Hidden -PassThru
  if (-not $ready.WaitOne(4000)) {
    $null = $cancel.Set()
    throw 'Restart watchdog did not become ready.'
  }
} finally {
  $original.Dispose()
  $ready.Dispose()
  $cancel.Dispose()
}`)
  return () => {
    try {
      run(
        `$event = [Threading.EventWaitHandle]::OpenExisting('${identity}-cancel'); $null = $event.Set(); $event.Dispose()`,
      )
    } catch {
      /* A completed helper has already released the event. */
    }
  }
}
