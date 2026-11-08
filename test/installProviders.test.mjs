import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url))

describe('source installer provider selection', () => {
  it('rejects an unknown provider before changing the installation', () => {
    const result = spawnSync(process.execPath, [script, '--providers', 'unknown'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/Choose.*codex.*commas/i)
  })

  it.skipIf(process.platform !== 'win32')(
    'checks only Codex when installing without Claude',
    () => {
      const profile = mkdtempSync(join(tmpdir(), 'threadlight-install-test-'))
      try {
        const data = join(profile, 'data')
        const result = spawnSync(process.execPath, [script, '--providers', 'codex', '--no-start'], {
          env: {
            ...process.env,
            LOCALAPPDATA: join(profile, 'local'),
            APPDATA: data,
            USERPROFILE: profile,
            PATH: join(process.env.SystemRoot, 'System32'),
          },
          encoding: 'utf8',
          windowsHide: true,
        })
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('Install the native Codex CLI')
        expect(result.stdout).not.toMatch(/Claude/i)
        expect(existsSync(join(data, 'Threadlight'))).toBe(false)
        expect(existsSync(join(profile, '.claude'))).toBe(false)
      } finally {
        rmSync(profile, { recursive: true, force: true })
      }
    },
  )
})
