/** Shared by the tray, panel and Agent. Normal before-quit cleanup runs before the fallback. */
export function restartAction(application: {
  relaunch(): void
  quit(): void
  exit(code: number): void
}) {
  let restarting = false
  return () => {
    if (restarting) return
    restarting = true
    application.relaunch()
    setTimeout(() => application.exit(0), 6000).unref()
    application.quit()
  }
}
