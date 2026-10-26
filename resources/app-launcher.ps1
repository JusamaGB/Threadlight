param([string] $ConfigPath)

# A window is required: background Claude Code / Codex CLI workers must not wake Threadlight.
# Codex Desktop currently calls its executable ChatGPT.exe; the product distinguishes it
# from the separate ChatGPT application. Requiring the product also excludes CLI consoles.
function Get-DesktopApps {
    foreach ($candidate in @(Get-Process -Name Claude, Codex, ChatGPT -ErrorAction SilentlyContinue)) {
        try {
            if ($candidate.MainWindowHandle -eq 0) { continue }
            $product = $candidate.MainModule.FileVersionInfo.ProductName
            if ($product -notin @('Claude', 'Codex')) { continue }
            '{0}:{1}' -f $candidate.Id, $candidate.StartTime.ToUniversalTime().Ticks
        } catch { } # A process can exit between enumeration and inspection.
    }
}

function Test-LauncherOwner($Owner) {
    if ($null -eq $Owner) { return $false }
    try {
        $candidate = Get-Process -Id $Owner.id -ErrorAction Stop
        $started = [datetimeoffset]::Parse($Owner.startedAt).UtcDateTime
        return [math]::Abs(($candidate.StartTime.ToUniversalTime() - $started).TotalSeconds) -lt 2
    } catch { return $false }
}

function Start-Threadlight($Config) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Config.executable
    $info.Arguments = $Config.arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($key in @('ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'CLAUDECODE',
        'CODEX_THREAD_ID', 'CODEX_TURN_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE')) {
        $info.EnvironmentVariables.Remove($key)
    }
    $child = [System.Diagnostics.Process]::Start($info)
    try {
        return @{ id = $child.Id; startedAt = $child.StartTime.ToUniversalTime().ToString('o') }
    } finally { $child.Dispose() }
}

function Invoke-LauncherPoll($Config, $State, [string[]] $Apps) {
    $opened = @($Apps | Where-Object { $_ -notin $State.Seen }).Count -gt 0
    # Remember openings even while Threadlight is running. Quit stays respected until
    # another desktop app opens, rather than reopening Threadlight on the next poll.
    $State.Seen = @($Apps)
    if (Test-LauncherOwner $Config.owner) { $State.Owner = $Config.owner }
    if ($opened -and -not (Test-LauncherOwner $State.Owner)) {
        $State.Owner = Start-Threadlight $Config
    }
}

function Watch-DesktopApps {
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $identity = [BitConverter]::ToString($hash.ComputeHash(
            [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($ConfigPath).ToLowerInvariant())
        )).Replace('-', '')
    } finally { $hash.Dispose() }
    $mutex = New-Object System.Threading.Mutex($false, "Local\ThreadlightLauncher-$identity")
    $owned = $false
    try {
        # Allow a previous watcher to finish disabling during a quick off/on change.
        try { $owned = $mutex.WaitOne(3000) }
        catch [System.Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { return }
        $state = @{ Seen = @(); Owner = $null }
        while ($true) {
            try {
                $config = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
            } catch {
                # Atomic replacements can be briefly unavailable; never guess enabled.
                if (-not (Test-Path -LiteralPath $ConfigPath)) { return }
                Start-Sleep -Seconds 2
                continue
            }
            if ($config.enabled -ne $true) { return }
            try { Invoke-LauncherPoll $config $state @(Get-DesktopApps) } catch { }
            Start-Sleep -Seconds 2
        }
    } finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

# Dot-sourcing exposes the same functions to isolated tests without starting a watcher.
if ($MyInvocation.InvocationName -ne '.') { Watch-DesktopApps }
