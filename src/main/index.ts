import { app, ipcMain } from 'electron'

import { IPC } from '../shared/ipc'
import { createDotWindow } from './windows'

// One Threadlight per user: a second launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  ipcMain.handle(IPC.getVersion, () => app.getVersion())

  void app.whenReady().then(() => {
    createDotWindow()
  })

  // Threadlight lives in the tray, not in windows; closing windows never quits it.
  app.on('window-all-closed', () => {})
}
