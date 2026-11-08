import { ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { PerplexityVault } from './vault'
import { PerplexityComputer } from './computer'
import { discoverPerplexity } from './discovery'
import { PerplexityService } from './service'

export function registerPerplexity(panel: BrowserWindow, userData: string) {
  const vault = new PerplexityVault(join(userData, 'perplexity'), safeStorage)
  const open = (url: string) => shell.openExternal(url)
  const service = new PerplexityService({
    vault,
    discover: discoverPerplexity,
    connection: (authorizing) => new PerplexityComputer(vault, open, authorizing),
    open,
    changed: () => {
      if (!panel.isDestroyed()) panel.webContents.send(IPC.perplexityChanged)
    },
  })
  ipcMain.handle(IPC.perplexity, (event, input: unknown) => {
    if (event.sender !== panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, reason: 'Perplexity is only available in the main panel.' }
    return service.request(input)
  })
  return service
}
