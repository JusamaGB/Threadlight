// Windows sign-in starts a small watcher; Threadlight itself waits for Claude or Codex.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { app, type Settings as LoginItemSettings } from 'electron'

import { launcherPaths, launcherSource, windowsPowerShell } from './sessions/paths'

/** ProcessStartInfo on Windows PowerShell uses a command line, rather than an argv array. */
export function windowsArguments(args: string[]): string {
  return args
    .map((arg) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`)
    .join(' ')
}

function watcherCommand(userData: string) {
  const paths = launcherPaths(userData)
  return {
    path: windowsPowerShell(),
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass', // only this helper process; no saved PowerShell policy is changed
      '-File',
      paths.script,
      // The script loads its sibling config. Repeating the full profile path here
      // pushes ordinary Windows Run entries past their 260-character limit.
    ],
  }
}

export function loginItem(
  openAtLogin: boolean,
  userData = app.getPath('userData'),
): LoginItemSettings {
  return {
    openAtLogin,
    name: 'Threadlight',
    ...watcherCommand(userData),
  }
}

/** `startWatcher: false` lets installer setup change sign-in without opening the app. */
export function setLaunchAtSignIn(
  enabled: boolean,
  options: { userData?: string; startWatcher?: boolean } = {},
): void {
  if (process.platform !== 'win32') return
  const userData = options.userData ?? app.getPath('userData')
  const paths = launcherPaths(userData)
  mkdirSync(dirname(paths.config), { recursive: true })
  if (enabled) writeFileSync(paths.script, readFileSync(launcherSource(app.getAppPath())))
  const previous = existsSync(paths.config) ? readFileSync(paths.config) : null
  const temporary = `${paths.config}.tmp`
  writeFileSync(
    temporary,
    JSON.stringify({
      enabled,
      executable: process.execPath,
      arguments: windowsArguments(app.isPackaged ? [] : [app.getAppPath()]),
      owner:
        options.startWatcher === false
          ? null
          : {
              id: process.pid,
              startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
            },
    }),
  )
  renameSync(temporary, paths.config)
  try {
    app.setLoginItemSettings(loginItem(enabled, userData))
  } catch (error) {
    // A refused setting must not leave a previously running watcher disabled.
    if (previous === null) rmSync(paths.config, { force: true })
    else {
      writeFileSync(temporary, previous)
      renameSync(temporary, paths.config)
    }
    throw error
  }
  if (enabled && options.startWatcher !== false) {
    const command = watcherCommand(userData)
    // The short bootstrap starts an independent hidden process, so quitting
    // Threadlight cannot close an inherited console and stop the watcher.
    execFileSync(command.path, [...command.args, '-StartHidden'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    })
  }
}

export function launchesAtSignIn(userData = app.getPath('userData')): boolean {
  // Also recognise the previous direct-app entry before an upgrade reconciles it.
  return [
    loginItem(true, userData),
    { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] },
  ].some(({ path, args }) => {
    const found = app.getLoginItemSettings({ path, args })
    return found.openAtLogin || found.launchItems.some((item) => item.name === 'Threadlight')
  })
}
