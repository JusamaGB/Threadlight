// The tray icon: the one place Threadlight always shows, even while the dot is hidden.

import { join } from 'node:path'

import { app, Menu, nativeImage, Tray } from 'electron'

export interface TrayActions {
  showSessions: () => void
  openSettings: () => void
  setPaused: (paused: boolean) => void
  isPaused: () => boolean
  quit: () => void
}

export function createTray(actions: TrayActions): Tray {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon-32.png'))
  const tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Threadlight')

  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show sessions', click: actions.showSessions },
        { label: 'Settings', click: actions.openSettings },
        { type: 'separator' },
        {
          label: 'Pause talk hotkey',
          type: 'checkbox',
          checked: actions.isPaused(),
          click: (item) => {
            actions.setPaused(item.checked)
            rebuild()
          },
        },
        { type: 'separator' },
        { label: 'Quit Threadlight', click: actions.quit },
      ]),
    )
  rebuild()
  tray.on('click', actions.showSessions)
  return tray
}
