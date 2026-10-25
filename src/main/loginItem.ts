// The Windows "start at sign-in" entry, in one place: the app keeps it in step with the
// setting, and the installer's setup mode can turn it off without starting the app.

import { app, type Settings as LoginItemSettings } from 'electron'

/**
 * A development build has no installed executable of its own, so it registers Electron with
 * the project folder as its argument.
 */
export function loginItem(openAtLogin: boolean): LoginItemSettings {
  return {
    openAtLogin,
    name: 'Threadlight',
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  }
}

export function setLaunchAtSignIn(enabled: boolean): void {
  app.setLoginItemSettings(loginItem(enabled))
}

export function launchesAtSignIn(): boolean {
  const { path, args } = loginItem(true)
  const found = app.getLoginItemSettings({ path, args })
  return found.openAtLogin || found.launchItems.some((item) => item.name === 'Threadlight')
}
