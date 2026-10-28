// Real artifact IPC, store, preload and viewer. No provider processes or real profile.
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, toNamespacedPath } from 'node:path'
import { registerArtifacts } from '../../src/main/artifactIntegration'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { IDLE_AGENT } from '../../src/shared/agent'
import { IDLE_MOTION } from '../../src/shared/motion'

const directory = mkdtempSync(join(tmpdir(), 'threadlight-artifacts-native-'))
app.setPath('userData', directory)
void app.whenReady().then(async () => {
  const panel = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const fixturePath = join(directory, 'Artifact test.html')
  writeFileSync(
    fixturePath,
    `<!doctype html><html><head><style>
    body { font: 16px sans-serif; padding: 18px; background: #edf3ff; }
    @keyframes pulse { to { opacity: .3; } } #pulse { animation: pulse .5s infinite alternate; }
    </style></head><body><h1>Native artifact test</h1>
    <button id="counter">Count: 0</button><label>Size <input id="size" type="range" min="10" max="100" value="30"></label>
    <div id="pulse">Animation running</div><canvas id="canvas" width="100" height="50"></canvas>
    <script>
      let count = 0;
      document.querySelector('#counter').onclick = () => document.querySelector('#counter').textContent = 'Count: ' + (++count);
      document.querySelector('#size').oninput = event => document.querySelector('#pulse').style.fontSize = event.target.value + 'px';
      document.querySelector('#canvas').getContext('2d').fillRect(0, 0, 50, 50);
    </script></body></html>`,
  )
  const transcript = join(directory, 'thread.jsonl')
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
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] })
  const thread = {
    id: 'codex:artifact-native-test',
    provider: 'codex',
    appId: null,
    title: 'Artifact test thread',
    state: 'working',
    tracked: true,
    cwd: directory,
    lastActiveAt: Date.now(),
    focusedAt: 0,
    stage: 'Testing artifacts',
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
  }
  const snapshot = {
    sessions: [thread],
    workspaces: [],
    allWorkspaces: [],
    currentWorkspace: null,
    currentThreadId: null,
  }
  const replies: Record<string, unknown> = {
    [IPC.getSettings]: { ...DEFAULT_SETTINGS, enabledProviders: ['codex'] },
    [IPC.getSnapshot]: snapshot,
    [IPC.getSessions]: [thread],
    [IPC.getRelays]: [],
    [IPC.getStt]: { state: 'ready' },
    [IPC.agentGet]: IDLE_AGENT,
    [IPC.getMotion]: IDLE_MOTION,
    [IPC.getVersion]: 'artifact-test',
    [IPC.spacesRequest]: { ok: false, reason: 'Shared Spaces disabled in this isolated test.' },
    [IPC.memoryRequest]: { ok: false, reason: 'Shared memory disabled in this isolated test.' },
    [IPC.communicationRequest]: {
      ok: false,
      reason: 'Communication disabled in this isolated test.',
    },
  }
  for (const channel of Object.values(IPC)) {
    if (channel !== IPC.artifacts && channel !== IPC.artifactPreview)
      ipcMain.handle(channel, (_event, value) =>
        channel === IPC.panelLayout
          ? { cardWidth: value === 'dual' ? 475 : 238 }
          : (replies[channel] ?? null),
      )
  }
  registerArtifacts(
    panel,
    join(directory, 'thread-artifacts'),
    (id) => id === thread.id || id === 'codex:other-artifact-thread',
    (id) =>
      id === thread.id
        ? {
            provider: 'codex',
            transcript,
            transcriptRoots: [directory],
            cwd: toNamespacedPath(directory),
            roots: [toNamespacedPath(directory)],
          }
        : null,
  )
  Object.assign(globalThis, { artifactProof: { directory, panel, fixturePath, transcript } })
  await panel.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'panel' } })
})
