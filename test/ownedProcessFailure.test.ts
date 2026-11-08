import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { spawnOwnedProcess, closeOwnedProcesses } from '../src/main/agent/ownedProcess'

vi.mock('../src/main/agent/windowsProcessJob', () => ({
  windowsProcessJob: () => ({
    assign: () => {
      throw Error('Synthetic assignment failure')
    },
    terminate: () => {},
    active: () => 0,
    close: () => {},
  }),
}))

it.skipIf(process.platform !== 'win32')(
  'never launches the provider if Windows process ownership cannot be established',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'threadlight-owned-failure-'))
    const marker = join(folder, 'provider-started')
    try {
      expect(() =>
        spawnOwnedProcess(
          process.execPath,
          ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`],
          folder,
        ),
      ).toThrow('assignment failure')
      await closeOwnedProcesses()
      expect(existsSync(marker)).toBe(false)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  },
)
