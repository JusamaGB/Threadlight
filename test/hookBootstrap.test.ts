import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { publishHookKey, publishLocalKey } from '../src/main/hookAuth'
import { startHookServer } from '../src/main/hookServer'

const execute = promisify(execFile)
let root: string | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})
it.runIf(process.platform === 'win32')(
  'publishes a protected rotating credential and the actual plugin command fails quietly without an app',
  async () => {
    root = await mkdtemp(join(tmpdir(), 'threadlight-hook-security-'))
    vi.stubEnv('APPDATA', root)
    const first = await publishHookKey(47615)
    const file = join(root, 'Threadlight', 'hook-auth', '47615.key')
    expect(await readFile(file, 'utf8')).toBe(first.toString('hex'))
    const second = await publishHookKey(47615)
    expect(second.equals(first)).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(second.toString('hex'))
    const windows = process.env.SystemRoot ?? 'C:\\Windows'
    const powershell = join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'),
      ),
      PSModulePath: join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    }
    const script = `$a=[System.IO.Directory]::GetAccessControl($env:AUDIT_PATH); $allowed=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); $ok=$a.AreAccessRulesProtected -and $a.Access.Count -eq 3; foreach($r in $a.Access) { $sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; $ok=$ok -and ($allowed -contains $sid) -and ($r.AccessControlType -eq 'Allow') }; if (-not $ok) { exit 1 }`
    await execute(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: { ...env, AUDIT_PATH: join(root, 'Threadlight', 'hook-auth') },
        windowsHide: true,
        timeout: 10000,
      },
    )
    for (const area of [
      'memory-auth',
      'thread-read-auth',
      'space-context-auth',
      'app-control-auth',
    ] as const) {
      const firstKey = await publishLocalKey(area, 'server.key')
      const secondKey = await publishLocalKey(area, 'server.key')
      expect(secondKey.equals(firstKey)).toBe(false)
      expect(await readFile(join(root, 'Threadlight', area, 'server.key'), 'utf8')).toBe(
        secondKey.toString('hex'),
      )
      await execute(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          env: { ...env, AUDIT_PATH: join(root, 'Threadlight', area) },
          windowsHide: true,
          timeout: 10000,
        },
      )
    }
    // Use both shipped shell commands with an absent isolated credential directory.
    vi.stubEnv('APPDATA', join(root, 'missing'))
    for (const manifest of ['hooks/hooks.json', 'codex-plugin/hooks/hooks.json']) {
      const json = JSON.parse(await readFile(resolve(manifest), 'utf8'))
      const command =
        json.hooks.SessionStart[0].hooks[0].command_windows ??
        json.hooks.SessionStart[0].hooks[0].command
      const { stdout } = await execute(
        powershell,
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
          env: {
            ...env,
            APPDATA: join(root, 'missing'),
            CLAUDE_PLUGIN_ROOT: resolve(manifest.startsWith('codex-plugin') ? 'codex-plugin' : '.'),
          },
          windowsHide: true,
          timeout: 10000,
        },
      )
      expect(stdout).toBe('')
    }
  },
  45000,
)

it('does not publish credentials when the listener cannot bind', async () => {
  const key = Buffer.alloc(32, 1)
  const server = await startHookServer({ port: 0, authKey: key, onEvent: () => {} })
  try {
    await expect(startHookServer({ port: server.port, onEvent: () => {} })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  } finally {
    await server.close()
  }
})
