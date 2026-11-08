import { armRestartWatchdog } from './restartWatchdog'

/** Shared by the tray, panel and Agent. Normal before-quit cleanup runs before the fallback. */
export function restartAction(
  application: {
    relaunch(): void
    quit(): void
    exit(code: number): void
  },
  watchdog = armRestartWatchdog,
) {
  let restarting = false
  return () => {
    if (restarting) return
    restarting = true
    let cancel: (() => void) | undefined
    try {
      cancel = watchdog()
      application.relaunch()
    } catch (error) {
      cancel?.()
      restarting = false
      console.error('Could not schedule Threadlight restart.', error)
      return
    }
    // Fast in-process fallback for delayed cleanup. The independent watchdog also
    // covers blocked JavaScript and native teardown after Electron stops timers.
    setTimeout(() => application.exit(0), 6000).unref()
    application.quit()
  }
}
