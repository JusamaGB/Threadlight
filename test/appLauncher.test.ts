// Execute the shipped PowerShell functions with synthetic apps and a harmless Node child.
// No login entry, provider process or real Threadlight instance is modified.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loginItem, windowsArguments } from '../src/main/loginItem'
import { launcherPaths, windowsPowerShell } from '../src/main/sessions/paths'
import { sandbox, type Sandbox } from './helpers'

const run = promisify(execFile)
const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`
const source = resolve('resources/app-launcher.ps1')
let box: Sandbox
const children = new Set<ChildProcess>()
beforeEach(async () => (box = await sandbox()))
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
  children.clear()
  await box.cleanup()
})

async function powershell(body: string) {
  const file = join(box.root, 'harness.ps1')
  await writeFile(file, `$ErrorActionPreference = 'Stop'\n. ${psLiteral(source)}\n${body}`)
  const result = await run(
    windowsPowerShell(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { windowsHide: true, timeout: 10_000 },
  )
  return JSON.parse(result.stdout.trim())
}

describe.skipIf(process.platform !== 'win32')('background app launcher', () => {
  it('starts once for either or both apps, respects Quit, and detects a later opening', async () => {
    expect(
      await powershell(`
$script:launches = 0
$script:alive = $false
function Test-LauncherOwner($Owner) { return $script:alive }
function Start-Threadlight($Config) { $script:launches++; $script:alive = $true; return @{ id = 1 } }
$state = @{ Seen = @(); Owner = $null }
$config = @{ owner = $null }
Invoke-LauncherPoll $config $state @()
$before = $script:launches
Invoke-LauncherPoll $config $state @('claude:1', 'codex:2')
$both = $script:launches
Invoke-LauncherPoll $config $state @('claude:1', 'codex:2')
$script:alive = $false
Invoke-LauncherPoll $config $state @('claude:1', 'codex:2')
$afterQuit = $script:launches
Invoke-LauncherPoll $config $state @('codex:2')
Invoke-LauncherPoll $config $state @('claude:3', 'codex:2')
@{ before = $before; both = $both; afterQuit = $afterQuit; reopened = $script:launches } | ConvertTo-Json
`),
    ).toEqual({ before: 0, both: 1, afterQuit: 1, reopened: 2 })
  })

  it('suppresses a launch when Threadlight is already running and rejects reused PIDs', async () => {
    expect(
      await powershell(`
$current = Get-Process -Id $PID
$owner = @{ id = $PID; startedAt = $current.StartTime.ToUniversalTime().ToString('o') }
$valid = Test-LauncherOwner $owner
$reused = Test-LauncherOwner @{ id = $PID; startedAt = '2000-01-01T00:00:00Z' }
function Start-Threadlight($Config) { throw 'Already running: must not launch.' }
$state = @{ Seen = @(); Owner = $null }
Invoke-LauncherPoll @{ owner = $owner } $state @('codex:2')
@{ valid = $valid; reused = $reused; remembered = $state.Seen } | ConvertTo-Json
`),
    ).toEqual({ valid: true, reused: false, remembered: ['codex:2'] })
  })

  it('recognises Codex inside ChatGPT.exe while excluding CLIs and the separate ChatGPT app', async () => {
    const result = await powershell(`
function Fake-App($id, $window, $product) {
    return [pscustomobject]@{ Id = $id; MainWindowHandle = $window; StartTime = [datetime]'2026-01-01';
        MainModule = @{ FileVersionInfo = @{ ProductName = $product } } }
}
function Get-Process {
    Fake-App 1 10 'Claude'
    Fake-App 2 20 'Codex'
    Fake-App 3 0 'Claude'
    Fake-App 4 30 'Claude Code'
    Fake-App 5 40 'ChatGPT'
}
@(Get-DesktopApps) | ConvertTo-Json
`)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatch(/^1:/)
    expect(result[1]).toMatch(/^2:/)
  })

  it('starts a real child with spaced/quoted arguments and clears inherited executor context', async () => {
    const childScript = join(box.root, 'harmless child.mjs')
    const resultFile = join(box.root, 'child result.json')
    const args = ["space and apostrophe's", 'quoted"value', 'C:\\trailing path\\']
    await writeFile(
      childScript,
      `import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3),context:process.env.CODEX_THREAD_ID,electron:process.env.ELECTRON_RUN_AS_NODE}));
setTimeout(() => {}, 1200);`,
    )
    const config = join(box.root, 'child config.json')
    await writeFile(
      config,
      JSON.stringify({
        executable: process.execPath,
        arguments: windowsArguments([childScript, resultFile, ...args]),
      }),
    )
    const result = await powershell(`
$env:CODEX_THREAD_ID = 'synthetic-executor'
$env:ELECTRON_RUN_AS_NODE = '1'
$config = Get-Content -LiteralPath ${psLiteral(config)} -Raw | ConvertFrom-Json
$owner = Start-Threadlight $config
$alive = Test-LauncherOwner $owner
Wait-Process -Id $owner.id -ErrorAction SilentlyContinue
@{ alive = $alive } | ConvertTo-Json
`)
    expect(result).toEqual({ alive: true })
    expect(JSON.parse(await readFile(resultFile, 'utf8'))).toEqual({ args })
  })

  it('allows one watcher per profile and stops it when sign-in is disabled', async () => {
    const { config, script } = launcherPaths(box.root)
    await copyFile(source, script)
    const owner = {
      id: process.pid,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    }
    await writeFile(config, JSON.stringify({ enabled: true, owner }))
    const entry = loginItem(true, box.root)
    const start = () => {
      const child = spawn(entry.path!, entry.args!, { windowsHide: true, stdio: 'ignore' })
      children.add(child)
      return child
    }
    const first = start()
    // The second process has to reach the same mutex after the first has acquired it.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(first.exitCode).toBeNull()
    const second = start()
    expect(await once(second, 'exit')).toEqual([0, null])
    expect(first.exitCode).toBeNull()
    await writeFile(`${config}.tmp`, JSON.stringify({ enabled: false }))
    await rename(`${config}.tmp`, config)
    expect(await once(first, 'exit')).toEqual([0, null])
  }, 15_000)

  it('keeps the hidden watcher alive after its launching parent exits', async () => {
    const { config, script } = launcherPaths(box.root)
    await copyFile(source, script)
    await writeFile(
      config,
      JSON.stringify({
        enabled: true,
        owner: {
          id: process.pid,
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
      }),
    )
    const entry = loginItem(true, box.root)
    const parent = join(box.root, 'parent.cjs')
    const result = join(box.root, 'watcher-pid.json')
    await writeFile(
      parent,
      `
const {execFileSync} = require('node:child_process');
const id = execFileSync(${JSON.stringify(entry.path)}, ${JSON.stringify([...entry.args!, '-StartHidden'])}, {windowsHide:true,encoding:'utf8',timeout:10000});
require('node:fs').writeFileSync(${JSON.stringify(result)}, id.trim());
`,
    )
    await run(process.execPath, [parent], { windowsHide: true, timeout: 12_000 })
    const watcherPid = Number(await readFile(result, 'utf8'))
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(() => process.kill(watcherPid, 0)).not.toThrow()
      await writeFile(`${config}.tmp`, JSON.stringify({ enabled: false }))
      await rename(`${config}.tmp`, config)
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        try {
          process.kill(watcherPid, 0)
        } catch {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Watcher did not stop after sign-in was disabled.')
    } finally {
      try {
        process.kill(watcherPid)
      } catch {
        /* Already stopped. */
      }
    }
  }, 20_000)
})
