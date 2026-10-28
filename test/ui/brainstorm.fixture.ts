import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SpacesStore } from '../../src/main/spaces/store'
import { SpacesService } from '../../src/main/spaces/service'
import { registerSpaces } from '../../src/main/spaces/integration'
import { MemoryStore } from '../../src/main/memory/store'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { IDLE_AGENT, type AgentItem } from '../../src/shared/agent'
import { IDLE_MOTION } from '../../src/shared/motion'
import { AppControlService, type ControlCaller } from '../../src/main/appControl/service'
import { registerAppControl } from '../../src/main/appControl/integration'

const directory = mkdtempSync(join(tmpdir(), 'threadlight-brainstorm-native-'))
app.setPath('userData', directory)
void app.whenReady().then(async () => {
  const panel = new BrowserWindow({
    width: 650,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const settings = { ...DEFAULT_SETTINGS, agentProvider: 'codex' as const }
  const memory = new MemoryStore(join(directory, 'memory.sqlite'))
  const spaces = new SpacesService(
    new SpacesStore(join(directory, 'spaces.sqlite')),
    () => memory,
    () => [],
    {
      workspace: join(directory, 'agent'),
      index: join(directory, 'agent.json'),
      claudeProjects: directory,
      settings: () => settings,
      snapshot: () => ({
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }),
      cli: async () => null,
      onChange: () => {},
      onRateLimit: () => {},
    },
    (snapshot) => panel.webContents.send(IPC.spacesChanged, snapshot),
    () => [directory],
  )
  await spaces.start()
  const created = await spaces.request({
    action: 'create_space',
    id: randomUUID(),
    root: directory,
    title: 'Threadlight',
  })
  if (!created.ok) throw Error(created.reason)
  await spaces.request({
    action: 'create_space',
    id: randomUUID(),
    root: directory,
    title: 'Design',
  })
  const histories = new Map<string, AgentItem[]>()
  const calls: string[] = []
  spaces.agent.send = async (value, visible) => {
    const text = String(value)
    calls.push(text)
    const old = spaces.agent.current,
      id = old.conversationId && !old.ended ? old.conversationId : `codex:${randomUUID()}`
    const note = spaces.store.all()[0]
    const items: AgentItem[] = [
      ...(histories.get(id) ?? []),
      { kind: 'you', text: visible ?? text },
      {
        kind: 'agent',
        text: note
          ? `Proposed plan based on note:${note.id}@${note.revision}. No work was dispatched.`
          : 'Start by capturing constraints. This is a proposal.',
      },
    ]
    histories.set(id, items)
    // Test-only provider boundary. Real service/store/preload/UI handle everything else.
    ;(spaces.agent as unknown as { publish: (state: unknown) => void }).publish({
      ...old,
      conversationId: id,
      sessionId: id.slice(6),
      provider: 'codex',
      model: 'Synthetic Brainstorm',
      ended: false,
      status: 'ready',
      items,
    })
    return { ok: true }
  }
  spaces.agent.read = async (id) => ({ items: histories.get(String(id)) ?? [], cursor: null })
  registerSpaces(panel, spaces, '')
  ipcMain.handle(IPC.memoryRequest, () => ({ ok: true, snapshot: memory.snapshot() }))
  const snapshot = {
    sessions: [],
    lookupSessions: [],
    workspaces: [],
    allWorkspaces: [{ id: directory, name: 'Fixture' }],
    currentWorkspace: null,
    currentThreadId: null,
  }
  const replies: Record<string, unknown> = {
    [IPC.getSettings]: settings,
    [IPC.getSnapshot]: snapshot,
    [IPC.getSessions]: [],
    [IPC.getRelays]: [],
    [IPC.getStt]: { state: 'ready' },
    [IPC.agentGet]: IDLE_AGENT,
    [IPC.getMotion]: IDLE_MOTION,
    [IPC.getVersion]: 'brainstorm-test',
    [IPC.communicationRequest]: { ok: false, reason: 'Read-only fixture' },
    [IPC.getComposerDraft]: { text: '', revision: 0, attachments: [] },
  }
  for (const channel of Object.values(IPC))
    if (![IPC.spacesRequest, IPC.spacesRespond, IPC.memoryRequest].includes(channel as never))
      ipcMain.handle(channel, (_event, value) =>
        channel === IPC.panelLayout
          ? { cardWidth: value === 'dual' ? 475 : 300 }
          : (replies[channel] ?? null),
      )
  const control = new AppControlService(
    {
      settings: () => settings,
      updateSettings: async () => ({ ok: false }),
      workspaces: () => [],
      spaces: () =>
        memory.snapshot().spaces.map((s) => ({ id: s.id, title: s.title, workspaceId: directory })),
      artifacts: async () => [],
      changes: async () => null,
      createSpace: async () => ({ ok: false }),
      createChat: async () => ({ ok: false }),
      busy: () => ({ agent: false, otherWork: false }),
      send: (command) => panel.webContents.send('control:command', command),
      restart: () => {},
    },
    join(directory, 'operations.json'),
  )
  const caller: ControlCaller = {
    active: true,
    owner: () => 'fixture',
    resolve: () => null,
    cards: async () => null,
    approve: (_id, _title, _detail, decide) => decide(false),
  }
  registerAppControl(panel, control)
  Object.assign(globalThis, {
    brainstormProof: {
      spaces,
      memory,
      calls,
      control,
      caller,
      directory,
      spaceId: created.spaceId,
    },
  })
  await panel.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'panel' } })
  control.ready()
  app.once('will-quit', () => {
    spaces.contextServer.close()
    memory.close()
    spaces.store.close()
  })
})
