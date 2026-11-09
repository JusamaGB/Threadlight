param([switch]$Live, [switch]$Keyboard, [switch]$TraceAgent, [switch]$PythonModel, [switch]$Proposals, [switch]$Walkthrough, [string]$CompatibilityCompanion)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$codeCli = (Get-Command code.cmd).Source
$editor = Join-Path (Split-Path (Split-Path $codeCli)) 'Code.exe'
$proof = Join-Path ([IO.Path]::GetTempPath()) ('threadlight-editor-coach-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $proof | Out-Null
$env:THREADLIGHT_COACH_TEST_DIR = $proof
$env:THREADLIGHT_PROPOSALS_ONLY = if ($Proposals) { '1' } else { '0' }
$env:THREADLIGHT_TEST_NODE = (Get-Command node.exe).Source
$env:THREADLIGHT_TRACE_AGENT = if ($TraceAgent) { '1' } else { '0' }
$env:THREADLIGHT_LIVE_SMOKE = if ($Live) { '1' } else { '0' }
$env:THREADLIGHT_WALKTHROUGH_ONLY = if ($Walkthrough) { '1' } else { '0' }
if ($Walkthrough) { $Keyboard = $true }
$companion = Join-Path $root 'vscode-coach'
$env:THREADLIGHT_COACH_COMPATIBILITY = if ($CompatibilityCompanion) { '1' } else { '0' }
if ($CompatibilityCompanion) {
  $companion = (Resolve-Path -LiteralPath $CompatibilityCompanion).Path
}
if (($Live -or $TraceAgent) -and -not $env:THREADLIGHT_CODEX_CLI) { throw 'Set THREADLIGHT_CODEX_CLI to the signed-in Codex executable.' }
$testPath = Join-Path $root 'test/live/editor-coach.vscode.cjs'
if ($PythonModel) {
  $Keyboard = $true
  $testPath = Join-Path $root 'test/live/python-model.vscode.cjs'
  $testExtensions = Join-Path $proof 'extensions'
  New-Item -ItemType Directory -Path $testExtensions | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'test/live/python-model-fixture') -Destination (Join-Path $testExtensions 'threadlight-test.coach-test-model-0.0.1') -Recurse
}
$arguments = @(
  '--new-window', '--disable-workspace-trust', '--disable-gpu', '--skip-welcome', '--skip-release-notes',
  "--user-data-dir=`"$proof/profile`"", "--extensions-dir=`"$proof/extensions`"",
  "--extensionDevelopmentPath=`"$companion`"",
  "--extensionTestsPath=`"$testPath`"", "`"$proof`""
)
$env:THREADLIGHT_COACH_KEYBOARD = if ($Keyboard) { '1' } else { '0' }
if ($Keyboard) { $arguments += '--remote-debugging-port=0' }
$hostProcess = Start-Process -FilePath $editor -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$proof/out.log" -RedirectStandardError "$proof/error.log"
Write-Output "Isolated editor evidence at $proof"
$deadline = if ($Live) { 360000 } else { 210000 }
if (-not $hostProcess.WaitForExit($deadline)) {
  $hostProcess.Kill()
  throw 'The isolated editor check timed out.'
}
$hostProcess.WaitForExit()
if ($hostProcess.ExitCode -ne 0) {
  Get-Content -LiteralPath "$proof/error.log" -Tail 20
  throw 'The isolated editor check failed.'
}
Select-String -LiteralPath "$proof/out.log" -Pattern '^PASS'
