// Isolated native-window fixture: real window manager, preload and renderer; no services.
import { app, ipcMain, screen } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PinnedCodeStore } from '../../src/main/pinnedCode'
import { WindowManager } from '../../src/main/windows'
import { ModifierStepper } from '../../src/main/modifierStepper'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { IDLE_AGENT } from '../../src/shared/agent'
import { registerMicIndicator } from '../../src/main/micIndicator'

const directory = mkdtempSync(join(tmpdir(), 'threadlight-hover-'))
app.setPath('userData', directory)
async function start() {
  await app.whenReady()
  // Keep desktop pointer movement out of the test; Chromium pointer events are
  // dispatched by Playwright while native hit testing uses matching screen points.
  let cursor = { x: 50, y: 50 }
  screen.getCursorScreenPoint = () => ({ ...cursor })
  const heldKeys = new Set<number>()
  const windows = new WindowManager((key) => heldKeys.has(key))
  if (process.env['THREADLIGHT_STARTUP_PROOF']) {
    // Reproduce slow service initialization without allowing renderer requests through.
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (windows.panel.webContents.getURL() || windows.dot.webContents.getURL())
      throw Error('Renderer mounted before handlers were registered')
  }
  const pins = new PinnedCodeStore(join(directory, 'pins.json'), (state) =>
    windows.pinsChanged(state),
  )
  const modifiers = new ModifierStepper(
    (stage) => windows.setModifierStage(stage),
    (key) => heldKeys.has(key),
  )
  modifiers.start()
  app.on('will-quit', () => modifiers.dispose())
  const events: unknown[] = []
  const record = (event: string, value?: unknown) =>
    events.push({
      at: Date.now(),
      event,
      value,
      cursor: screen.getCursorScreenPoint(),
      panel: windows.panel.getBounds(),
      visible: windows.panel.isVisible(),
    })
  let mouseIgnored = false
  const ignoreMouse = windows.panel.setIgnoreMouseEvents.bind(windows.panel)
  windows.panel.setIgnoreMouseEvents = (ignore, options) => {
    mouseIgnored = ignore
    ignoreMouse(ignore, options)
  }
  for (const win of [windows.dot, windows.panel]) {
    const view = win === windows.dot ? 'dot' : 'panel'
    for (const name of ['show', 'hide', 'blur', 'focus', 'resize', 'move'])
      win.on(name as 'show', () => record(`${view}:${name}`))
  }
  const snapshot = {
    sessions: [] as unknown[],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
    currentThreadId: null,
  }
  let settings = {
    ...DEFAULT_SETTINGS,
    openOn: 'hover',
    ...(process.env['THREADLIGHT_STARTUP_PROOF']
      ? {
          enabledProviders: ['codex'],
          workspaceWires: process.env['THREADLIGHT_STARTUP_WIRES'] === '1',
        }
      : {}),
  }
  const replies: Record<string, () => unknown> = {
    [IPC.getSettings]: () => settings,
    [IPC.getSnapshot]: () => snapshot,
    [IPC.getSessions]: () => snapshot.sessions,
    [IPC.getRelays]: () => [],
    [IPC.getStt]: () => ({ state: 'ready' }),
    [IPC.agentGet]: () =>
      ['agent-height', 'live-hover-handoff'].includes(process.env.THREADLIGHT_UI_FOCUS ?? '')
        ? {
            ...IDLE_AGENT,
            status: 'ready',
            items: [{ kind: 'you', text: 'Read this sample conversation.' }],
          }
        : IDLE_AGENT,
    [IPC.agentHistory]: () => [],
    [IPC.getAttentionMotion]: () => windows.attentionMotion,
    [IPC.getVersion]: () => 'hover-test',
    [IPC.artifacts]: () => ({ ok: true, items: [] }),
    [IPC.memoryRequest]: () => ({ ok: false, reason: 'No memory service in this window fixture.' }),
    [IPC.spacesRequest]: () => ({ ok: false, reason: 'No Spaces service in this window fixture.' }),
  }
  ipcMain.handle('control:hello', () => null)
  ipcMain.handle('control:claim', () => false)
  registerMicIndicator(windows)
  for (const channel of Object.values(IPC).filter(
    (channel) =>
      ![IPC.getMotion, IPC.openMicIndicator, IPC.spokenReply, IPC.micMenu, IPC.copyText].some(
        (handled) => handled === channel,
      ),
  ))
    ipcMain.handle(channel, (_event, ...args) => {
      if (channel === IPC.pinnedCode) return pins.request(args[0])
      if (channel === IPC.workspacePanel) return windows.setWorkspacePanel(args[0])
      if (channel === IPC.panelLayout) return windows.setPanelLayout(args[0], args[1])
      if (channel === IPC.workspaceWireGutter) return windows.setWorkspaceWireGutter(args[0])
      if (channel === IPC.updateSettings) {
        settings = { ...settings, ...args[0] }
        windows.send(IPC.settingsChanged, settings)
        return settings
      }
      return replies[channel]?.() ?? null
    })
  ipcMain.on(IPC.pinnedCodeSize, (event, visible, height) => {
    if (windows.codeWindow(event.sender)) windows.setPinnedCode(visible, height)
  })
  ipcMain.on(IPC.codePan, (event, id, active) => {
    const win = windows.codeWindow(event.sender)
    if (win) windows.codePan(id, active, win)
  })
  ipcMain.handle(IPC.copyText, (_event, value) => {
    record(IPC.copyText, value)
    return true
  })
  ipcMain.on(IPC.dotDrag, (_event, dx, dy) => windows.dragDot(dx, dy))
  ipcMain.on(IPC.dotDragEnd, () => windows.endDrag())
  const actions: Record<string, (value: unknown) => void> = {
    [IPC.dotHover]: () => windows.openFromDot(true),
    [IPC.dotClick]: () => windows.openFromDot(),
    [IPC.panelClose]: () => windows.closePanel(),
    [IPC.panelLeave]: () => windows.closeOnPointerLeave(),
    [IPC.panelResize]: (height) => {
      if (typeof height === 'number') windows.resizePanel(height)
    },
    [IPC.panelStayOpen]: (on) => windows.setStayOpen(on === true),
    [IPC.workspaceWireControl]: (value) => windows.setWorkspaceWireControl(value),
  }
  for (const [channel, action] of Object.entries(actions))
    ipcMain.on(channel, (_event, value: unknown) => {
      record(channel, value)
      action(value)
    })
  const move = (x: number, y: number) => {
    cursor = { x, y }
  }
  Object.assign(globalThis, {
    hoverProof: {
      windows,
      pins,
      events,
      directory,
      move,
      holdLeft(held: boolean) {
        if (held) heldKeys.add(1)
        else heldKeys.delete(1)
      },
      modifiers(control: boolean, alt: boolean) {
        heldKeys.clear()
        if (control) heldKeys.add(0x11)
        if (alt) heldKeys.add(0x12)
      },
      wireGroup(on: boolean) {
        snapshot.sessions = on
          ? [0, 1].map((i) => ({
              id: `codex:wire-native-${i}`,
              provider: 'codex',
              appId: null,
              title: `Wire native ${i}`,
              state: 'idle',
              tracked: true,
              cwd: 'C:/synthetic-wire',
              lastActiveAt: Date.now() - i * 60000,
              focusedAt: 0,
              stage: 'Ready',
              lastPrompt: null,
              plan: [],
              currentStep: null,
              recap: null,
              lastReply: null,
              lastAction: null,
              turnStartedAt: null,
              backgroundTasks: [],
              live: false,
              git: null,
              contextUsed: 0.1,
              attention: null,
              permissionMode: null,
              model: null,
              pullRequests: [],
            }))
          : []
        windows.send(IPC.snapshotChanged, snapshot)
      },
      get mouseIgnored() {
        return mouseIgnored
      },
    },
  })
  await windows.loadRenderers()
  await Promise.all(
    [windows.dot, windows.panel].map(
      (win) =>
        new Promise<void>((done) => {
          if (!win.webContents.isLoading()) return done()
          win.webContents.once('did-finish-load', () => done())
        }),
    ),
  )
  if (!process.env['THREADLIGHT_STARTUP_PROOF']) windows.setClaudeRunning(true)
  app.on('window-all-closed', () => {})
}
void start().catch((error) => {
  console.error(error)
  app.exit(1)
})
