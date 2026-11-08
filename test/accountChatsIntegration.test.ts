import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ handle: vi.fn(), connect: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => 'unused-test-profile' },
  ipcMain: { handle: mock.handle },
}))
vi.mock('../src/main/accountChats/adapters', () => ({
  ChatGPTReader: { connect: mock.connect },
  PerplexityChatReader: { connect: mock.connect },
}))
import { registerAccountChats } from '../src/main/accountChats/integration'
import type { BrowserWindow } from 'electron'
import { IPC } from '../src/shared/ipc'

describe('account chat IPC entry', () => {
  it('allows only the panel main frame and rejects arbitrary dispatch before connecting', async () => {
    const mainFrame = {},
      sender = { mainFrame }
    const panel = { webContents: sender } as unknown as BrowserWindow
    const contexts = vi.fn(async () => [])
    const service = registerAccountChats(panel, contexts, () => true)
    const handler = mock.handle.mock.calls.find((call) => call[0] === IPC.accountChats)![1]
    for (const event of [
      { sender: {}, senderFrame: mainFrame },
      { sender, senderFrame: {} },
    ]) {
      expect(await handler(event, { action: 'contexts' })).toMatchObject({ ok: false })
    }
    expect(contexts).not.toHaveBeenCalled()
    expect(await handler({ sender, senderFrame: mainFrame }, { action: 'contexts' })).toEqual({
      ok: true,
      kind: 'contexts',
      contexts: [],
    })
    expect(
      await handler(
        { sender, senderFrame: mainFrame },
        { action: 'send', source: 'chatgpt', message: 'no' },
      ),
    ).toMatchObject({ ok: false })
    expect(mock.connect).not.toHaveBeenCalled()
    service.close()
  })
})
