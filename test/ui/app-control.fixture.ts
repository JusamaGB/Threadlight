// Real Panel, preload and sender boundary, isolated profile and synthetic provider state.
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppControlService, type ControlCaller } from '../../src/main/appControl/service'
import { registerAppControl } from '../../src/main/appControl/integration'
import { registerArtifacts } from '../../src/main/artifactIntegration'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { IDLE_AGENT } from '../../src/shared/agent'
import { IDLE_MOTION } from '../../src/shared/motion'
import type { Session } from '../../src/shared/types'
import type { TimelineItem } from '../../src/shared/threadTimeline'

const directory = mkdtempSync(join(tmpdir(), 'threadlight-control-native-'))
app.setPath('userData', directory)
void app.whenReady().then(async () => {
  const panel = new BrowserWindow({
    width: 550,
    height: 850,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const thread: Session = {
    id: 'codex:11111111-1111-4111-8111-111111111111',
    provider: 'codex',
    appId: null,
    title: 'Control fixture',
    state: 'working',
    tracked: true,
    cwd: directory,
    lastActiveAt: Date.now(),
    focusedAt: 0,
    stage: 'Fixture',
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
    thinking: false,
    pullRequests: [],
  }
  const snapshot = {
    sessions: [thread],
    lookupSessions: [thread],
    workspaces: [],
    allWorkspaces: [{ id: directory, name: 'Fixture' }],
    currentWorkspace: null,
    currentThreadId: null,
  }
  const spaceId = '22222222-2222-4222-8222-222222222222'
  const spaces = {
    ideas: [],
    activeId: null,
    agent: IDLE_AGENT,
    workspaces: [],
    spaceOwners: {},
    documents: [],
    locations: [],
  }
  const memory = {
    spaces: [{ id: spaceId, title: 'Design' }],
    folders: [],
    items: [],
    connections: [],
    subscriptions: [],
    participants: [],
    tasks: [],
    messages: [],
    grants: [],
    events: [],
    cursor: 0,
    seen: 0,
    drafts: {},
    endpoint: null,
  }
  const settings = { ...DEFAULT_SETTINGS, enabledProviders: ['codex'] as ['codex'] }
  const cards = ['first', 'second'].map((id) => ({
    id,
    role: 'activity',
    text: id,
    kind: 'tool',
    phase: 'final',
    at: null,
    turnId: 'turn',
    complete: true,
    source: 'fixture',
    fileChanges: [
      { path: 'same.ts', added: 1, removed: 1, diff: `@@ -1 +1 @@\n-${id}\n+${id}-changed` },
    ],
  })) as TimelineItem[]
  const fixturePath = join(directory, 'artifact.txt'),
    transcript = join(directory, 'thread.jsonl')
  writeFileSync(fixturePath, 'Exact fixture artifact')
  writeFileSync(
    transcript,
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `[View artifact](<${fixturePath}>)` }],
      },
    }) + '\n',
  )
  let catalog: (
    id: string,
  ) => Promise<import('../../src/shared/artifacts').ThreadArtifact[]> = async () => []
  registerArtifacts(
    panel,
    join(directory, 'artifacts'),
    (id) => id === thread.id,
    () => ({
      provider: 'codex',
      transcript,
      cwd: directory,
      transcriptRoots: [directory],
      roots: [directory],
    }),
    (read) => {
      catalog = read
    },
  )
  const decisions: ((allow: boolean) => void)[] = []
  let restartCount = 0
  const service = new AppControlService(
    {
      settings: () => settings,
      updateSettings: async (patch) => {
        Object.assign(settings, patch)
        return { ok: true }
      },
      workspaces: () => [{ id: directory, name: 'Fixture', path: directory, parentId: null }],
      spaces: () => [{ id: spaceId, title: 'Design', workspaceId: directory }],
      artifacts: (id) => catalog(id),
      changes: async () => ({ files: [] }),
      createSpace: async () => ({ ok: true, spaceId }),
      createChat: async () => ({ ok: true, sessionId: thread.id }),
      busy: () => ({ agent: true, otherWork: false }),
      send: (command) => panel.webContents.send('control:command', command),
      restart: () => {
        restartCount++
      },
    },
    join(directory, 'operations.json'),
    2500,
  )
  const caller: ControlCaller = {
    active: true,
    owner: () => 'fixture',
    resolve: (ref) => (ref === 'resolved' ? { id: thread.id } : null),
    cards: async () => cards,
    approve: (_id, _title, _detail, decide) => {
      decisions.push(decide)
    },
  }
  registerAppControl(panel, service)
  const replies: Record<string, unknown> = {
    [IPC.getSettings]: settings,
    [IPC.getSnapshot]: snapshot,
    [IPC.getSessions]: [thread],
    [IPC.getRelays]: [],
    [IPC.getStt]: { state: 'ready' },
    [IPC.agentGet]: IDLE_AGENT,
    [IPC.getMotion]: IDLE_MOTION,
    [IPC.getVersion]: 'control-test',
    [IPC.spacesRequest]: { ok: true, snapshot: spaces },
    [IPC.memoryRequest]: { ok: true, snapshot: memory },
    [IPC.communicationRequest]: { ok: false, reason: 'Disabled in fixture.' },
    [IPC.getChanges]: { branch: 'fixture', files: [] },
    [IPC.getWorktreeChanges]: { branch: 'fixture', files: [] },
    [IPC.getComposerDraft]: { text: '', revision: 0, attachments: [] },
  }
  for (const channel of Object.values(IPC))
    if (![IPC.artifacts, IPC.artifactPreview].includes(channel as never))
      ipcMain.handle(channel, (_event, value) =>
        channel === IPC.panelLayout
          ? { cardWidth: value === 'dual' ? 475 : 300 }
          : (replies[channel] ?? null),
      )
  Object.assign(globalThis, {
    controlProof: {
      directory,
      panel,
      service,
      caller,
      decisions,
      cards,
      settings,
      catalog,
      restartCount: () => restartCount,
    },
  })
  await panel.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'panel' } })
  service.ready()
})
