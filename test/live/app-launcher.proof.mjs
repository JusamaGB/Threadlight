// Run with Node, which starts this checkout's Electron. Uses a temporary profile, a separate temporary
// Run entry, and a disabled watcher; never starts or stops the regular Threadlight.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const electron = require('electron')
if (typeof electron === 'string') {
  const profile = mkdtempSync(join(tmpdir(), "threadlight launcher's proof with spaces-"))
  if (!resolve(profile).startsWith(resolve(tmpdir()) + '\\'))
    throw new Error('Unexpected proof path.')
  try {
    const env = { ...process.env, THREADLIGHT_LAUNCHER_PROOF_PROFILE: profile }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30_000,
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
} else {
  const { app } = electron
  const ts = require('typescript')
  require.extensions['.ts'] = (module, filename) =>
    module._compile(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      filename,
    )
  const { loginItem } = require(join(root, 'src/main/loginItem.ts'))
  const { launcherPaths } = require(join(root, 'src/main/sessions/paths.ts'))
  const profile = process.env.THREADLIGHT_LAUNCHER_PROOF_PROFILE
  if (!profile) throw new Error('Run this proof with Node so its parent owns profile cleanup.')
  const name = `Threadlight Launcher Proof ${randomUUID()}`
  const literal = (value) => `'${value.replaceAll("'", "''")}'`
  app.setPath('userData', profile)
  app.disableHardwareAcceleration()
  let exitCode = 1
  let entry
  void app.whenReady().then(() => {
    try {
      entry = { ...loginItem(true, profile), name }
      const paths = launcherPaths(profile)
      copyFileSync(join(root, 'resources/app-launcher.ps1'), paths.script)
      writeFileSync(paths.config, JSON.stringify({ enabled: false }))
      app.setLoginItemSettings(entry)
      const command = JSON.parse(
        execFileSync(
          entry.path,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Get-ItemPropertyValue -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${literal(name)} | ConvertTo-Json -Compress`,
          ],
          { windowsHide: true, encoding: 'utf8', timeout: 10_000 },
        ),
      )
      const prefix = command.startsWith('"') ? `"${entry.path}"` : entry.path
      assert.ok(
        command.length <= 260,
        `Windows Run command exceeds its 260-character limit (${command.length}).`,
      )
      assert.equal(command.startsWith(prefix), true)
      const argumentsText = command.slice(prefix.length).trimStart()
      const harness = join(profile, 'invoke registry command.ps1')
      writeFileSync(
        harness,
        `$ErrorActionPreference = 'Stop'
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = ${literal(entry.path)}
$info.Arguments = ${literal(argumentsText)}
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardError = $true
$child = [System.Diagnostics.Process]::Start($info)
if (-not $child.WaitForExit(10000)) { $child.Kill(); throw 'Watcher did not exit.' }
if ($child.ExitCode -ne 0) { throw $child.StandardError.ReadToEnd() }
$child.Dispose()
`,
      )
      execFileSync(
        entry.path,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness],
        { windowsHide: true, timeout: 15_000, stdio: 'pipe' },
      )
      assert.equal(
        app
          .getLoginItemSettings({ path: entry.path, args: entry.args })
          .launchItems.some((item) => item.name === name),
        true,
      )
      console.log(
        'PASS: actual Windows sign-in command launches the watcher with spaces and apostrophes.',
      )
      exitCode = 0
    } catch (error) {
      console.error(error)
    } finally {
      if (entry) app.setLoginItemSettings({ ...entry, openAtLogin: false })
      app.exit(exitCode)
    }
  })
}
