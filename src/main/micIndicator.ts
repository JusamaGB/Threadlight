import { ipcMain } from 'electron'
import { spokenReplySchema } from '../shared/spokenReply'
import { IPC } from '../shared/ipc'
import type { WindowManager } from './windows'
import { IDLE_MOTION, readMotion } from '../shared/motion'

/** Only scalar levels cross windows; the panel remains the sole owner of microphone audio. */
export function registerMicIndicator(
  windows: WindowManager,
  onInput?: (level: number) => void,
): void {
  let live = false
  let level = 0
  let motion = IDLE_MOTION
  ipcMain.handle(IPC.getMotion, () => motion)
  ipcMain.on(IPC.motion, (event, value: unknown) => {
    if (event.sender !== windows.panel.webContents) return
    const next = readMotion(value)
    if (!next) return
    if (!next.inputMuted) onInput?.(next.input.level)
    motion = next
    windows.dot.webContents.send(IPC.motion, motion)
  })
  const publish = (next: boolean) => {
    live = next
    if (!live) level = 0
    windows.setOpenMicLive(live)
    windows.dot.webContents.send(IPC.openMicLive, live)
    if (!live) windows.dot.webContents.send(IPC.openMicLevel, 0)
  }
  ipcMain.handle(IPC.openMicIndicator, () => ({ live, level }))
  ipcMain.on(IPC.openMicLive, (event, value: unknown) => {
    if (event.sender === windows.panel.webContents) publish(value === true)
  })
  ipcMain.on(IPC.openMicLevel, (event, value: unknown) => {
    if (
      event.sender !== windows.panel.webContents ||
      !live ||
      typeof value !== 'number' ||
      !Number.isFinite(value)
    )
      return
    level = Math.max(0, Math.min(1, value))
    windows.dot.webContents.send(IPC.openMicLevel, level)
  })
  ipcMain.handle(IPC.micMenu, (event, open: unknown) =>
    event.sender === windows.dot.webContents && live ? windows.setMicMenu(open === true) : null,
  )
  ipcMain.on(IPC.micAction, (event, action: unknown) => {
    if (event.sender !== windows.dot.webContents || !live) return
    if (action === 'pause' || action === 'resume' || action === 'stopSpeaking')
      windows.panel.webContents.send(IPC.micAction, action)
  })
  ipcMain.on(IPC.spokenReply, (event, value: unknown) => {
    if (event.sender !== windows.panel.webContents) return
    const parsed = live && spokenReplySchema.safeParse(value)
    windows.setSpokenReply(parsed && parsed.success ? parsed.data : null)
  })
  ipcMain.handle(IPC.spokenReply, (event) => windows.getSpokenReply(event.sender))
  ipcMain.on(IPC.spokenReplySize, (event, width: number, height: number) =>
    windows.setSpokenReplySize(event.sender, width, height),
  )
  ipcMain.on(IPC.stopOpenMic, (event) => {
    if (event.sender !== windows.dot.webContents || !live) return
    windows.panel.webContents.send(IPC.stopOpenMic)
  })
  // A renderer reload releases its media stream; do not leave a stale live indicator behind.
  const reset = () => {
    publish(false)
    motion = IDLE_MOTION
    windows.dot.webContents.send(IPC.motion, motion)
  }
  windows.panel.webContents.on('did-start-loading', reset)
  windows.panel.webContents.on('render-process-gone', reset)
}
