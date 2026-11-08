import { checkHandoffsCanvas } from './handoffs-canvas.smoke.mjs'
import { checkWorkflowGraph } from './workflow-graph.smoke.mjs'
import { checkPerplexity } from './perplexity.smoke.mjs'
import { checkAccountChats } from './account-chats.smoke.mjs'
import { checkAccountChatReplies } from './account-chat-replies.smoke.mjs'
import { checkProviderSettings } from './provider-settings.smoke.mjs'
import { checkThreadAttention } from './thread-attention.smoke.mjs'
import { checkPinnedActive } from './pinned-active.smoke.mjs'
import { checkNotesPurpose } from './notes-purpose.smoke.mjs'
import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
import { checkSpacesRecovery } from './spaces-recovery.smoke.mjs'
import { checkNotesComposer } from './notes-composer.smoke.mjs'
import { checkChangeWorkflow } from './change-workflow.smoke.mjs'
import { checkWorkspaceScope } from './workspace-scope.smoke.mjs'
import { checkHeaderMenu } from './header-menu.smoke.mjs'
// Run after npm run build. Uses Playwright from THREADLIGHT_PLAYWRIGHT or local resolution.
// All IPC is synthetic; this never launches Threadlight, hooks or either provider CLI.
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { readFileSync, statSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkVoiceRouting } from './voice-routing.smoke.mjs'
import { setupVoiceInput } from './voice-input.fixture.mjs'
import { checkHotkeys } from './hotkeys.smoke.mjs'
import { checkSpokenReply } from './spoken-reply.smoke.mjs'
import { checkMicPill } from './mic-pill.smoke.mjs'
import { readMotionFrame } from './motion-pixels.mjs'
import {
  checkAgentSelection,
  checkAgentSettings,
  checkFooterSettings,
} from './agent-selection.smoke.mjs'
import { checkThreadReading } from './thread-reading.smoke.mjs'
import { checkPanelHeight, checkWorkspaceHeight } from './panel-height.smoke.mjs'
import { checkTips, checkLastActive, checkFooterExpansion } from './tips.smoke.mjs'
import { checkHelpModes } from './help-modes.smoke.mjs'
import { checkHoverMotion } from './hover-motion.smoke.mjs'

import { checkNowTimer } from './now-timer.smoke.mjs'
import { checkToolbar, checkRecentLimit, checkSubpagePinning } from './toolbar.smoke.mjs'
import { checkDualDetails, checkDualLong, checkPanelLayout } from './panel-layout.smoke.mjs'
import { checkWorkspacePaths } from './workspace-paths.smoke.mjs'
import { checkWorkspacePicker } from './workspace-picker.smoke.mjs'
import { checkChecklistDiff } from './checklist-diff.smoke.mjs'
import {
  setupCommunication,
  checkCommunication,
  checkConversationEvents,
} from './communication.smoke.mjs'
import { checkThreadDiffs } from './thread-diffs.smoke.mjs'
import { checkArtifacts } from './artifacts.smoke.mjs'
import { checkViewCache } from './view-cache.smoke.mjs'
import { checkCompaction } from './compaction.smoke.mjs'
import { checkManagedQuestions } from './managed-questions.smoke.mjs'
import { checkNativeCodexQuestions } from './native-codex-questions.smoke.mjs'
import { checkCodexNextStepComposer } from './question-composer.smoke.mjs'
import { checkNativeCodexMessages } from './native-codex-messages.smoke.mjs'
import { checkCodexQueue } from './codex-queue.smoke.mjs'
import { checkThreadTimeline } from './thread-timeline.smoke.mjs'
import { checkThreadCopy } from './thread-copy.smoke.mjs'
import { checkPinList } from './pin-list.smoke.mjs'
import { checkAgentDecision } from './agent-decision.smoke.mjs'
import { checkAgentContinuous } from './agent-continuous.smoke.mjs'
import { checkCompletionNotices } from './completion-notices.smoke.mjs'
import { checkConnectionSetup } from './connection-setup.smoke.mjs'
import { checkBrainstormVoice } from './brainstorm-voice.smoke.mjs'
import { checkSourceReview } from './source-review.smoke.mjs'
import { checkSpacesLibrary } from './spaces-library.smoke.mjs'
import { checkBrainstormChat } from './brainstorm-chat.smoke.mjs'
import { checkProjectParticipants } from './project-participants.smoke.mjs'
import { checkWorkspaceLinks } from './workspace-links.smoke.mjs'
import { checkDualWires } from './dual-wires.smoke.mjs'
import { checkInputNavigation } from './input-navigation.smoke.mjs'
import { checkActivityRings } from './activity-rings.smoke.mjs'

import { checkThreadBadges } from './thread-badges.smoke.mjs'
import { checkIgnoreInput } from './ignore-input.smoke.mjs'

import { setupMemory, checkMemory } from './memory.smoke.mjs'
import { setupSpaces, checkSpaces, checkSpacesSetup } from './spaces.smoke.mjs'

// Voice choices open a hover menu; clicking the value button holds it open for the pick.
const chooseSetting = async (page, setting, option) => {
  await page.getByRole('button', { name: new RegExp(`^${setting}:`) }).click()
  // The value already chosen is not listed in its own menu.
  const item = page.getByRole('menuitem', { name: option, exact: true })
  if ((await item.count()) === 0) return page.keyboard.press('Escape')
  await item.click()
}

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { DEFAULT_SETTINGS, validatePatch, applySettingsPatch } = require(
  join(root, 'src/shared/settings.ts'),
)
const { combinedSnapshot, providerView } = require(join(root, 'src/shared/providers.ts'))
const { withManagedQuestions } = require(join(root, 'src/shared/managedQuestions.ts'))
const { IDLE_AGENT } = require(join(root, 'src/shared/agent.ts'))
const { summarizeCodex } = require(join(root, 'src/main/codex/tracker.ts'))
const { codexState } = require(join(root, 'src/main/codex/state.ts'))
const readableSummary = summarizeCodex([
  {
    type: 'userMessage',
    content:
      '# Files mentioned by the user:\n\n## preview.png: C:/synthetic/preview.png\nImage attachment: true\n\n## My request:\nPlease make the edge tint narrower and extend it through the expanded thread.',
  },
  {
    type: 'agentMessage',
    phase: 'commentary',
    text: 'I’m checking the expanded layout and narrowing the provider tint.',
  },
  { type: 'commandExecution', command: 'C:/synthetic/pwsh.exe -Command "git diff --stat"' },
  {
    type: 'agentMessage',
    phase: 'final_answer',
    text: 'Done: the tint is now **20px wide** and continues through the expanded thread.\n\n![Preview](C:/synthetic/preview.png)\n\nBuild and UI checks pass.',
  },
])
const { chromium } = require(process.env['THREADLIGHT_PLAYWRIGHT'] || 'playwright')
let settings = structuredClone(DEFAULT_SETTINGS)
const workspaceFixture = mkdtempSync(join(tmpdir(), 'threadlight-ui-workspace-'))
const folder = join(workspaceFixture, 'shared').replaceAll('\\', '/')
mkdirSync(folder)
const session = (provider) => ({
  provider,
  id: provider === 'codex' ? 'codex:11111111-1111-4111-8111-111111111111' : 'synthetic-claude',
  appId: provider === 'codex' ? 'codex:11111111-1111-4111-8111-111111111111' : 'local_synthetic',
  title: `Synthetic ${provider === 'codex' ? 'Codex' : 'Claude'}`,
  state: 'waiting',
  tracked: true,
  cwd: folder,
  lastActiveAt: Date.now() - (provider === 'claude' ? 3600_000 : 600_000),
  focusedAt: 0,
  stage: 'Waiting for you',
  lastPrompt: 'Synthetic prompt',
  plan: [],
  currentStep: null,
  recap: null,
  lastReply: null,
  lastAction: null,
  turnStartedAt: null,
  backgroundTasks: [],
  live: false,
  git: null,
  contextUsed: 0.2,
  attention:
    provider === 'codex'
      ? {
          kind: 'next-step',
          recap: null,
          ask: 'Blue or green?',
          actions: [],
          answerableUntil: Date.now() + 60000,
          holdId: 'synthetic-nonce',
        }
      : null,
  permissionMode: null,
  model: null,
  pullRequests: [],
})
const chats = { claude: session('claude'), codex: session('codex') }
chats.codex.plan = [
  { content: 'Inspect the data', status: 'completed' },
  { content: 'Build the display', status: 'in_progress' },
  { content: 'Verify the display', status: 'pending' },
]
const trackedPlan = structuredClone(chats.codex.plan)
const heldAttention = structuredClone(chats.codex.attention)
let codexQuota = {
  at: Date.now(),
  fiveHour: null,
  week: { used: 0.27, resetsAt: Date.now() + 86400_000 },
}
let workspacePaths = null
let workspaceFolders = null
let workspaceRows = null
let workspaceViews = {}
const source = (provider) => ({
  provider,
  codexUsage: provider === 'codex' ? codexQuota : undefined,
  sessions: [chats[provider]],
  currentWorkspace: workspaceFolders?.[provider]?.[0]?.id ?? workspacePaths?.[provider] ?? folder,
  currentThreadId: chats[provider].id,
  allWorkspaces: workspaceFolders?.[provider] ?? [
    { id: workspacePaths?.[provider] ?? folder, name: 'shared' },
  ],
  workspaces:
    workspaceRows === 0
      ? []
      : [
          {
            id: workspacePaths?.[provider] ?? folder,
            name: 'shared',
            threadCount: workspaceRows ?? 1,
            activeCount: 1,
            anyWorking: false,
            threads:
              !workspacePaths ||
              workspaceViews[provider]?.everything ||
              workspaceViews[provider]?.expanded?.includes(workspacePaths[provider])
                ? Array.from({ length: workspaceRows ?? 1 }, (_, i) => ({
                    session:
                      workspaceRows === null
                        ? chats[provider]
                        : {
                            ...chats[provider],
                            id: `${provider === 'codex' ? 'codex:' : ''}height-${provider}-${i}`,
                            title: `Workspace height ${provider} ${i}`,
                          },
                    children: [],
                  }))
                : [],
            hiddenCount: 0,
            worktrees: 0,
          },
        ],
})
const state = () => ({
  settings,
  snapshot: combinedSnapshot(
    settings.enabledProviders,
    {
      claude: withManagedQuestions(
        source('claude'),
        memoryProof?.store.communications.list('question') ?? [],
      ),
      codex: withManagedQuestions(
        source('codex'),
        memoryProof?.store.communications.list('question') ?? [],
      ),
    },
    settings.maxSessions,
  ),
})
const output = resolve(process.env.THREADLIGHT_TEST_RENDERER || resolve(root, 'out/renderer'))
const server = createServer((request, response) => {
  const target = resolve(output, '.' + new URL(request.url, 'http://localhost').pathname)
  if (target !== output && !target.startsWith(output + sep)) return response.writeHead(403).end()
  try {
    const file = statSync(target).isDirectory() ? join(target, 'index.html') : target
    response.setHeader(
      'content-type',
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] ||
        'application/octet-stream',
    )
    response.end(readFileSync(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let browser, memoryProof, spacesProof, communicationProof, testPage
checks: try {
  // Synthetic hotkeys are IPC events, not Chromium user-activation gestures.
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.THREADLIGHT_CHROMIUM || undefined,
    // Verify app scrollbar styling instead of hiding every track in headless Chromium.
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const page = await browser.newPage({
    viewport: { width: 460, height: 900 },
    deviceScaleFactor: process.env.THREADLIGHT_UI_FOCUS === 'spoken-reply' ? 2 : 1,
  })
  await page.clock.install()
  memoryProof = await setupMemory(
    page,
    require(join(root, 'src/main/memory/store.ts')).MemoryStore,
    require(join(root, 'src/main/memory/server.ts')).MemoryServer,
  )
  communicationProof = await setupCommunication(
    page,
    require(join(root, 'src/main/communication/service.ts')).CommunicationService,
    memoryProof.store,
    require(join(root, 'src/main/communication/conversationEvents.ts')).ConversationEventService,
  )
  testPage = page
  spacesProof = await setupSpaces(
    page,
    {
      SpacesStore: require(join(root, 'src/main/spaces/store.ts')).SpacesStore,
      SpacesService: require(join(root, 'src/main/spaces/service.ts')).SpacesService,
    },
    memoryProof.store,
    memoryProof.directory,
    chats,
    () => settings,
  )
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(String(error))
    console.error(error)
  })
  await page.exposeFunction('mockState', state)
  await page.exposeFunction('mockUpdate', async (patch) => {
    const result = validatePatch(patch)
    assert.equal(result.ok, true)
    settings = applySettingsPatch(settings, result.patch)
    if (!settings.enabledProviders.includes('codex')) {
      chats.codex.attention.answerableUntil = null
      delete chats.codex.attention.holdId
    }
    return { ok: true, ...state() }
  })
  await page.exposeFunction('mockPatch', (patch) => {
    Object.assign(chats.codex, patch)
    return state().snapshot
  })
  await page.exposeFunction('mockQuota', (value) => {
    codexQuota = value
    return state().snapshot
  })
  await page.exposeFunction('mockWorkspacePaths', (paths) => {
    workspacePaths = paths
    workspaceViews = {}
    return state().snapshot
  })
  await page.exposeFunction('mockView', (view) => {
    const views = settings.enabledProviders.map((provider) => ({
      provider,
      view: providerView(settings.enabledProviders, provider, view),
    }))
    for (const { provider, view } of views) workspaceViews[provider] = view
    return { views, snapshot: workspacePaths ? state().snapshot : null }
  })
  await page.exposeFunction('mockWorkspaceFolders', (folders) => {
    workspaceFolders = folders
    return state().snapshot
  })
  await page.exposeFunction('mockWorkspaceRows', (count) => {
    workspaceRows = count
    return state().snapshot
  })
  await page.addInitScript(
    ({ agent, startupRecovery, providerHealth }) => {
      const listeners = new Map()
      const drafts = new Map()
      const emit = (name, value) => {
        for (const fn of listeners.get(name) || []) fn(value)
      }
      window.proof = {
        calls: [],
        resizes: [],
        failSettings: startupRecovery,
        emit,
        agent(next) {
          agent = { ...agent, ...next, revision: agent.revision + 1 }
          emit('onAgent', agent)
        },
        async patch(patch) {
          emit('onSnapshot', await window.mockPatch(patch))
        },
        async quota(value) {
          emit('onSnapshot', await window.mockQuota(value))
        },
      }
      window.threadlight = new Proxy(
        {
          // App-control handshakes belong to their dedicated integration fixtures.
          controlHello: undefined,
          readDraft: undefined,
          writeDraft: undefined,
          readDraftSelection: undefined,
          writeDraftSelection: undefined,
          historyCurrentId: undefined,
          pinnedCode: async (cmd) => {
            const key = 'fixture.pinnedState',
              stored = localStorage.getItem(key)
            const state = stored
              ? JSON.parse(stored)
              : {
                  version: 1,
                  generation: 0,
                  files: JSON.parse(cmd.legacy || '[]'),
                  selectedId: null,
                }
            if (cmd.action === 'add') {
              state.files.push({ ...cmd.file, revision: 1 })
              state.selectedId = cmd.file.id
            }
            if (cmd.action === 'fold')
              state.files.find((f) => f.id === cmd.id).collapsed = cmd.collapsed
            if (cmd.action === 'remove') state.files = state.files.filter((f) => f.id !== cmd.id)
            if (cmd.action === 'select') state.selectedId = cmd.id
            state.generation++
            localStorage.setItem(key, JSON.stringify(state))
            emit('onPinsChanged', state)
            return state
          },
          codexQueue: async () => ({ ok: true, items: [] }),
          communicationRequest: (input) => window.mockCommunication(input),
          memoryRequest: (input) => window.mockMemory(input),
          spacesRequest: (input) => {
            if (startupRecovery && input.action === 'list' && !window.proof.startupList) {
              window.proof.startupList = true
              return new Promise((_resolve, reject) => {
                window.proof.rejectSpaces = reject
              })
            }
            return window.mockSpaces(input)
          },
          getComposerDraft: async (id) => ({
            ok: true,
            draft: drafts.get(id) || { text: '', revision: 0, updatedAt: 0 },
          }),
          saveComposerDraft: async (id, text, revision) => {
            if ((drafts.get(id)?.revision || 0) !== revision)
              return { ok: false, reason: 'Conflicting draft revision' }
            const draft = { text, revision: revision + 1, updatedAt: Date.now() }
            drafts.set(id, draft)
            return { ok: true, draft }
          },
          getSettings: async () => {
            if (window.proof.failSettings) throw Error('Synthetic initial settings failure')
            return (await window.mockState()).settings
          },
          getSnapshot: async () => (await window.mockState()).snapshot,
          getAttentionMotion: async () => ({ active: false }),
          getSessions: async () => (await window.mockState()).snapshot.sessions,
          artifacts: async () => ({ ok: true, items: [] }),
          // Legacy fixture mode; the live-timeline focus installs the full feed contract.
          threadTimeline: undefined,
          // Browser-only fixtures use the static preview; native previews have an Electron fixture.
          artifactPreview: undefined,
          updateSettings: async (patch) => {
            const result = await window.mockUpdate(patch)
            emit('onSnapshot', result.snapshot)
            emit('onSettings', result.settings)
            return result
          },
          setTreeView: (view) => {
            void window.mockView(view).then(({ views, snapshot }) => {
              window.proof.calls.push(['views', views])
              if (snapshot) emit('onSnapshot', snapshot)
            })
          },
          getRelays: async () => [],
          getStt: async () => ({ state: 'missing' }),
          getOpenMicIndicator: async () => ({ live: false, level: 0 }),
          setMotion: (value) => {
            window.proof.motion = value
          },
          setTalkState: (state) => {
            window.proof.talkState = state
          },
          getMotion: async () => ({
            mode: 'idle',
            input: { level: 0, low: 0, mid: 0, high: 0 },
            output: { level: 0, low: 0, mid: 0, high: 0 },
          }),
          dotClick: () => window.proof.calls.push(['dotClick']),
          dotHover: () => window.proof.calls.push(['dotHover']),
          dotDrag: (dx, dy) => window.proof.calls.push(['dotDrag', dx, dy]),
          dotDragEnd: () => window.proof.calls.push(['dotDragEnd']),
          leavePanel: () => window.proof.calls.push(['leavePanel']),
          resizePanel: (height) => window.proof.resizes.push(height),
          setPanelLayout: async (layout) => {
            window.proof.layouts = [...(window.proof.layouts ?? []), layout]
            return { cardWidth: layout === 'dual' ? 475 : 238 }
          },
          setWorkspaceWireRegions: (regions) => {
            window.proof.wireRegions = regions
          },
          setWorkspaceWireGutter: async (width) => {
            window.proof.rightWireGutter = width
            return null
          },
          publishSpokenReply: (reply) => {
            window.proof.spokenReply = reply
            emit('onSpokenReply', reply)
          },
          getSpokenReply: async () => window.proof.spokenReply ?? null,
          setSpokenReplySize: (width, height) => {
            ;(window.proof.pillSizes ??= []).push([width, height])
          },
          setMicMenu: async (open) => (open ? { x: 0, y: 0, menuY: 26 } : null),
          micAction: (action) => window.proof.calls.push(['micAction', action]),
          stopOpenMic: () => window.proof.calls.push(['stopOpenMic']),
          getAgent: async () => agent,
          getUsage: async () => ({
            at: Date.now(),
            fiveHour: { used: 0.2, resetsAt: Date.now() + 3600_000 },
            week: { used: 0.6, resetsAt: Date.now() + 86400_000 },
          }),
          ...(providerHealth && {
            accountChats: async (command) => {
              window.proof.healthCalls ??= []
              window.proof.healthCalls.push(command)
              if (command.action !== 'list') throw Error('Unexpected probe')
              if (command.source === 'chatgpt' && !window.proof.healthReady)
                return {
                  ok: false,
                  reason: window.proof.healthLimit
                    ? 'The provider is limiting requests. Try again after the cooldown.'
                    : 'The desktop chat format changed.',
                }
              return { ok: true, kind: 'list', chats: [], hasMore: false, recentOnly: false }
            },
          }),
          getVersion: async () => 'preview',
          transcribe: () =>
            new Promise((resolve) => {
              window.proof.finishTranscript = resolve
            }),
          agentApps: async () => [],
          agentModels: async () => ({
            error: null,
            models: [
              {
                id: 'future-fast',
                name: 'Future Fast',
                isDefault: true,
                hidden: false,
                efforts: ['low', 'medium'],
                defaultEffort: 'low',
              },
              {
                id: 'future-deep',
                name: 'Future Deep',
                isDefault: false,
                hidden: true,
                efforts: ['high', 'ultra'],
                defaultEffort: 'high',
              },
            ],
          }),
          agentHistory: async () => [
            {
              id: 'codex:past',
              provider: 'codex',
              model: 'future-fast',
              title: 'Synthetic earlier agent',
              at: Date.now(),
            },
          ],
          agentReadPage: async (_id, cursor) => ({
            items: [{ kind: 'agent', text: cursor ? 'An older reply' : 'A saved reply' }],
            cursor: cursor ? null : 'older',
          }),
          agentResume: async (id) => {
            window.proof.calls.push(['agentResume', id])
            return { ok: true }
          },
          agentRespond: async (...args) => {
            window.proof.calls.push(['agentRespond', ...args])
            window.proof.agent({ status: 'working', requests: [] })
            return { ok: true }
          },
          agentSend: async (text) => {
            window.proof.calls.push(['agentSend', text])
            window.proof.agent({
              status: 'working',
              provider: 'codex',
              model: 'future-deep',
              reasoning: 'ultra',
              items: [{ kind: 'you', text }],
              conversationId: 'codex:active',
            })
            return { ok: true }
          },
          agentInterrupt: async () => {
            window.proof.agent({ status: 'interrupted', requests: [] })
            return { ok: true }
          },
          agentClose: () =>
            window.proof.agent({ status: 'idle', ended: true, requests: [], conversationId: null }),
          composerFilePath: () => '',
          composerAttachments: async () => ({ ok: true, items: [] }),
          sendMessage: async (...args) => {
            window.proof.calls.push(['send', ...args])
            return { ok: true }
          },
          answerCodex: async (...args) => {
            window.proof.calls.push(['answer', ...args])
            return { ok: true }
          },
          copyText: async (...args) => {
            window.proof.calls.push(['copy', ...args])
            return true
          },
          openInClaude: (...args) => window.proof.calls.push(['open', ...args]),
          ignoreNeedsInput: (...args) => window.proof.calls.push(['ignore', ...args]),
          restartApp: () => window.proof.calls.push(['restart']),
        },
        {
          get(target, name) {
            if (name in target) return target[name]
            if (String(name).startsWith('on'))
              return (fn) => {
                const set = listeners.get(name) || new Set()
                listeners.set(name, set)
                set.add(fn)
                return () => set.delete(fn)
              }
            return () => {}
          },
        },
      )
    },
    {
      agent: IDLE_AGENT,
      startupRecovery: process.env.THREADLIGHT_UI_FOCUS === 'spaces-recovery',
      providerHealth: process.env.THREADLIGHT_UI_FOCUS === 'provider-health',
    },
  )
  const url = `http://127.0.0.1:${server.address().port}/`
  await page.goto(url + '?view=panel')
  const row = (provider) =>
    page.getByRole('button', { name: new RegExp(`Synthetic ${provider}`) }).first()
  const compose = async (provider) => {
    await row(provider).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Compose', exact: true }).click()
  }
  const toggle = async (provider) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('switch', { name: provider === 'Codex' ? 'OpenAI' : provider, exact: true })
      .click()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  }
  const capture = async (name) => {
    const dir = process.env['THREADLIGHT_SCREENSHOTS']
    if (dir) {
      mkdirSync(dir, { recursive: true })
      const stage = await page.locator('#root > :first-child').boundingBox()
      const tips = await page
        .getByRole('tooltip')
        .or(page.getByRole('menu'))
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()))
      const bounds = [stage, ...tips]
      const x = Math.min(...bounds.map((box) => box.x))
      const y = Math.min(...bounds.map((box) => box.y))
      await page.screenshot({
        path: join(dir, `${name}.local.png`),
        clip: {
          x,
          y,
          width: Math.max(...bounds.map((box) => box.x + box.width)) - x,
          height: Math.max(...bounds.map((box) => box.y + box.height)) - y,
        },
      })
    }
  }
  const box = page.getByPlaceholder('Type a message…')
  if (process.env.THREADLIGHT_UI_FOCUS === 'hotkeys') {
    await checkHotkeys(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'spoken-reply') {
    await checkSpokenReply(page, url)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'mic-indicator') {
    await page.goto(url + '?view=dot')
    await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: [] }))
    await checkMicPill(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'provider-health') {
    const warning = page.locator('[data-provider-errors]')
    await warning.getByText('The desktop chat format changed.', { exact: false }).first().waitFor()
    assert.equal(
      await page.locator('[data-thread-filter]').getAttribute('data-thread-filter'),
      'code-computer',
    )
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'off' }))
    assert.ok(await warning.isVisible())
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    assert.ok(await warning.isVisible())
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.evaluate(() => {
      window.proof.healthLimit = true
    })
    await page.getByRole('button', { name: 'Retry ChatGPT connection', exact: true }).click()
    await warning.getByText('ChatGPT · Chat list', { exact: true }).waitFor()
    await warning.getByText(/Refresh paused after a rate limit/).waitFor()
    assert.ok(await warning.locator('[data-paused]').isVisible())
    await page.evaluate(() => {
      window.proof.healthReady = true
    })
    await page.getByRole('button', { name: 'Retry ChatGPT connection', exact: true }).click()
    await warning.waitFor({ state: 'detached' })
    await page.evaluate(() =>
      window.proof.emit('onSharedDeliveryStatus', { source: 'chatgpt', sequence: 2, failed: true }),
    )
    await warning.getByText('Shared message', { exact: false }).first().waitFor()
    await page.evaluate(() =>
      window.proof.emit('onSharedDeliveryStatus', {
        source: 'chatgpt',
        sequence: 1,
        failed: false,
      }),
    )
    assert.ok(await warning.isVisible())
    await page.evaluate(() =>
      window.proof.emit('onRelays', [
        {
          sessionId: 'codex:private-id',
          state: 'failed',
          at: Date.now(),
          detail: 'Private failure detail',
        },
      ]),
    )
    await warning.getByText('Private failure detail', { exact: false }).first().waitFor()
    await warning.getByRole('button', { name: 'Copy diagnostics' }).click()
    const copied = await page.evaluate(() => window.proof.calls.find((c) => c[0] === 'copy')?.[1])
    assert.equal(JSON.parse(copied).issues.length, 2)
    assert.ok(!copied.includes('Private failure detail') && !copied.includes('private-id'))
    await page.evaluate(() => {
      window.proof.emit('onSharedDeliveryStatus', { source: 'chatgpt', sequence: 3, failed: false })
      window.proof.emit('onRelays', [])
    })
    await warning.waitFor({ state: 'detached' })
    assert.ok(await page.evaluate(() => window.proof.healthCalls.every((c) => c.action === 'list')))
    assert.deepEqual(errors, [])
    const calls = () =>
      page.evaluate(() => window.proof.healthCalls.filter((c) => c.source === 'chatgpt').length)
    const idle = await calls()
    await page.clock.fastForward(125000)
    assert.equal(await calls(), idle, 'healthy ChatGPT discovery stays idle off the chat list')
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await page.evaluate(() => window.threadlight.updateSettings({ conversationFilter: 'all' }))
    await page.waitForFunction(
      (n) => window.proof.healthCalls.filter((c) => c.source === 'chatgpt').length > n,
      idle,
    )
    const first = await calls()
    await page.clock.fastForward(55000)
    assert.equal(await calls(), first, 'the visible ChatGPT list does not poll every five seconds')
    await page.clock.fastForward(10000)
    await page.waitForFunction(
      (n) => window.proof.healthCalls.filter((c) => c.source === 'chatgpt').length > n,
      first,
    )
    console.log(
      'PASS: first-load discovery, cooldown recovery, off-list idle, minute-spaced visible refresh, zero sends.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'provider-settings') {
    await checkProviderSettings(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'screen-region-settings') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const group = page.getByRole('group', { name: 'Screen regions', exact: true })
    const live = group.getByRole('switch', { name: 'In Live', exact: true })
    const outside = group.getByRole('switch', { name: 'Outside Live', exact: true })
    const speech = page.getByRole('switch', { name: 'Speak outside-Live replies' })
    assert.ok(await live.isChecked())
    assert.ok(!(await outside.isChecked()))
    await outside.click()
    await speech.waitFor()
    assert.ok((await live.isChecked()) && (await outside.isChecked()))
    await speech.click()
    await page.waitForFunction(
      async () => !(await window.threadlight.getSettings()).speakScreenReply,
    )
    await live.click()
    await page.waitForFunction(
      async () => (await window.threadlight.getSettings()).screenRegionModes.join() === 'outside',
    )
    await capture('screen-region-settings')
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await outside.waitFor()
    assert.ok(
      (await outside.isChecked()) && !(await live.isChecked()) && !(await speech.isChecked()),
    )
    await outside.click()
    await speech.waitFor({ state: 'detached' })
    assert.ok(!(await live.isChecked()) && !(await outside.isChecked()))
    assert.deepEqual(errors, [])
    console.log(
      'PASS: independent Live and outside selections, both, neither, persisted speech preference.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'account-chats') {
    await checkAccountChats(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'account-chat-replies') {
    await checkAccountChatReplies(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'perplexity') {
    await checkPerplexity(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'workflow-graph') {
    await checkWorkflowGraph(page, memoryProof, communicationProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'pinned-active') {
    await checkPinnedActive(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'handoffs-canvas') {
    await checkHandoffsCanvas(page, memoryProof, spacesProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'notes-purpose') {
    await checkNotesPurpose(page, spacesProof, memoryProof, capture)
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'notes-composer') {
    await checkNotesComposer(page, spacesProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'spaces-recovery') {
    await checkSpacesRecovery(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'change-workflow') {
    await checkChangeWorkflow(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'workspace-scope') {
    await checkWorkspaceScope(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'header-menu') {
    await checkHeaderMenu(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'completion-notices') {
    await checkCompletionNotices(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (['agent-continuous', 'agent-grouped'].includes(process.env.THREADLIGHT_UI_FOCUS)) {
    await checkAgentContinuous(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'agent-decision') {
    await checkAgentDecision(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'pin-list') {
    await checkPinList(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-copy') {
    await checkThreadCopy(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-attention') {
    await checkThreadAttention(page, capture)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: one normal-height reader, card at live edge, earlier history on scroll, reopen and resolution.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-timeline') {
    await checkThreadTimeline(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'project-participants') {
    await checkProjectParticipants(page, memoryProof, spacesProof, chats, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'brainstorm-chat') {
    await checkBrainstormChat(page, spacesProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (['brainstorm-voice', 'hotkeys-routes'].includes(process.env.THREADLIGHT_UI_FOCUS)) {
    await checkBrainstormVoice(page, spacesProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'source-review') {
    await checkSourceReview(page, spacesProof, memoryProof)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'spaces-library') {
    await checkSpacesLibrary(page, spacesProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'connection-setup') {
    await checkConnectionSetup(page, memoryProof, communicationProof, capture, chats.codex.id)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'input-navigation') {
    await checkInputNavigation(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'memory-security') {
    await checkMemory(page, memoryProof, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'memory-navigation') {
    await checkMemory(page, memoryProof, capture)
    await checkSpaces(page, spacesProof, memoryProof.store, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'view-cache') {
    await checkViewCache(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'compaction') {
    await checkCompaction(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'native-codex-questions') {
    await checkNativeCodexQuestions(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'question-composer') {
    await checkCodexNextStepComposer(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'native-codex-messages') {
    await checkNativeCodexMessages(page, compose, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'codex-queue') {
    await checkCodexQueue(page, compose, capture)
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'managed-questions') {
    const changed = memoryProof.store.communications.onChange
    memoryProof.store.communications.onChange = () => {
      changed()
      void page
        .evaluate((snapshot) => window.proof.emit('onSnapshot', snapshot), state().snapshot)
        .catch(() => {})
    }
    await checkManagedQuestions(
      page,
      communicationProof,
      memoryProof.store,
      capture,
      chats.codex.id,
    )
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'artifacts') {
    await checkArtifacts(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'startup') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const signIn = page.getByRole('switch', { name: 'Launch at sign-in', exact: true })
    assert.equal(await page.getByRole('switch', { name: /Launch/ }).count(), 1)
    assert.equal(
      await page
        .getByText('Wait quietly in the background until Claude or Codex opens, then show the dot.')
        .count(),
      0,
    )
    assert.equal(await signIn.getAttribute('aria-checked'), 'false')
    await signIn.click()
    await page.waitForFunction(() => window.mockState().then((s) => s.settings.launchAtSignIn))
    assert.equal(await signIn.getAttribute('aria-checked'), 'true')
    await capture('startup-watcher')
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    assert.equal(await signIn.getAttribute('aria-checked'), 'true')
    await signIn.click()
    await page.waitForFunction(() => window.mockState().then((s) => !s.settings.launchAtSignIn))
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    assert.equal(await signIn.getAttribute('aria-checked'), 'false')
    assert.equal(await page.getByRole('switch', { name: /Launch/ }).count(), 1)
    // A way out if the app ever feels stuck: Restart sits in App, explains itself, and asks the
    // main process to relaunch.
    const restart = page.getByRole('button', { name: 'Restart now', exact: true })
    assert.equal(await restart.count(), 1)
    await page.getByText('Restart', { exact: true }).hover()
    assert.match(
      await page.getByRole('tooltip').innerText(),
      /Closes Threadlight and starts it again/,
    )
    assert.equal(
      await page.evaluate(() => window.proof.calls.filter(([name]) => name === 'restart').length),
      0,
      'hovering does not restart',
    )
    await restart.click()
    const restarting = page.getByRole('button', { name: 'Restarting…', exact: true })
    assert.equal(await restarting.isVisible(), true)
    assert.equal(await restarting.isDisabled(), true)
    await restarting.evaluate((button) => button.click())
    await capture('restart-pending')
    assert.equal(
      await page.evaluate(() => window.proof.calls.filter(([name]) => name === 'restart').length),
      1,
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: sign-in enable/disable and reload; Restart immediately shows pending feedback and prevents duplicate requests.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'conversation-events') {
    await checkConversationEvents(page, communicationProof, memoryProof.store, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'pinning') {
    await checkSubpagePinning(page)
    await checkThreadDiffs(page, capture)
    await checkToolbar(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'agent-settings') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const footer = page.getByText('An independent open-source project by HAAIL.', { exact: false })
    await footer.waitFor()
    assert.match(await footer.innerText(), /Threadlight preview/)
    await checkAgentSettings(page, capture)
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await openHeaderPage(page, 'Agent')
    await checkFooterSettings(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (['communication', 'communication-roles'].includes(process.env.THREADLIGHT_UI_FOCUS)) {
    await checkCommunication(
      page,
      communicationProof,
      memoryProof.store,
      capture,
      process.env.THREADLIGHT_UI_FOCUS === 'communication-roles',
    )
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'call-ready') {
    await setupVoiceInput(page)
    await (await import('./call-ready.smoke.mjs')).checkCallReady(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'voice-mode') {
    await page.evaluate(() =>
      window.threadlight.updateSettings({
        enabledProviders: ['codex'],
        voiceMode: 'local-stt',
        voiceTarget: 'thread',
      }),
    )
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await chooseSetting(page, 'Voice target', 'GPT Live')
    await page.getByRole('button', { name: 'Voice target: GPT Live', exact: true }).waitFor()
    await page.getByRole('button', { name: /^Send text to:/ }).waitFor({ state: 'detached' })
    await capture('voice-target-gpt-live')
    await chooseSetting(page, 'Voice target', 'Local STT')
    await page.getByRole('button', { name: /^Send text to:/ }).waitFor()
    await capture('voice-target-local-stt')
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await setupVoiceInput(page)
    await page.evaluate(() => {
      window.proof.quietInput = true
    })
    await compose('Codex')
    await checkVoiceRouting(page)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: explicit voice modes, local destinations, native first-turn audio, unavailable STT, cancellation and provider guard.',
    )
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-reading') {
    await openHeaderPage(page, 'Agent')
    await checkThreadReading(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'workspace-picker') {
    await checkWorkspacePicker(page, capture)
    await checkWorkspacePaths(page, capture)
    await checkToolbar(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'workspace-height') {
    await checkWorkspaceHeight(page, capture)
    await checkPanelHeight(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'activity-rings') {
    await checkActivityRings(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'panel-motion') {
    await checkDualLong(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'panel-layout') {
    await checkPanelLayout(page, capture)
    await checkDualDetails(page, capture)
    await checkDualLong(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'wire-routing') {
    await checkDualWires(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'recent-limit') {
    await checkRecentLimit(page, capture)
    await checkToolbar(page)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-hover') {
    await checkThreadDiffs(page, capture)
    await checkLastActive(page, row, capture)
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    await checkTips(page, row)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'compact-tips') {
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    await checkTips(page, row, capture)
    await checkFooterExpansion(page, row, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'help-modes') {
    await checkHelpModes(page, row, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'hover-motion') {
    await checkHoverMotion(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'compact-layout') {
    await checkThreadDiffs(page, capture)
    await checkWorkspaceLinks(page, capture)
    await checkToolbar(page)
    await checkSpacesSetup(page, spacesProof, capture)
    await checkMemory(page, memoryProof, capture)
    await checkSpaces(page, spacesProof, memoryProof.store, capture)
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    await checkTips(page, row)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'visual-updates') {
    await checkWorkspaceLinks(page, capture)
    assert.deepEqual(errors, [])
    break checks
  }
  if (process.env.THREADLIGHT_UI_FOCUS === 'thread-diff') {
    await checkThreadDiffs(page, capture)
    await checkChecklistDiff(page, row, capture)

    assert.deepEqual(errors, [])
    break checks
  }
  await checkWorkspacePaths(page, capture)
  await checkThreadBadges(page, capture)
  assert.deepEqual(errors, [])
  if (process.env.THREADLIGHT_UI_FOCUS === 'badges') break checks
  await checkIgnoreInput(page, capture)
  assert.deepEqual(errors, [])
  if (process.env.THREADLIGHT_UI_FOCUS === 'ignore-input') break checks
  if (process.env.THREADLIGHT_UI_FOCUS === 'workspace') {
    await checkToolbar(page)
    assert.deepEqual(errors, [])
    break checks
  }
  await checkChecklistDiff(page, row, capture)
  await checkPanelHeight(page)
  await checkToolbar(page)
  await checkSpacesSetup(page, spacesProof, capture)
  await checkMemory(page, memoryProof, capture)
  await checkSpaces(page, spacesProof, memoryProof.store, capture)
  assert.deepEqual(errors, [])
  if (process.env.THREADLIGHT_UI_FOCUS === 'spaces') break checks
  await page.reload()
  await compose('Claude')
  await box.fill('Claude draft')
  await toggle('Codex')
  assert.equal(await row('Claude').isVisible(), true)
  assert.equal(await row('Codex').isVisible(), true)
  assert.equal(await box.inputValue(), 'Claude draft')
  await checkTips(page, row)
  await checkNowTimer(page, row)
  await capture('thread-context-tooltip')
  await page.locator('[class*="header"]').first().hover()
  assert.equal(await row('Claude').getAttribute('data-provider'), 'claude')
  assert.equal(await row('Codex').getAttribute('data-provider'), 'codex')
  assert.equal(await row('Claude').locator('[class*="providerBadge"]').count(), 0)
  const claudeFade = await row('Claude').evaluate(
    (node) => getComputedStyle(node.parentElement, '::after').backgroundImage,
  )
  const codexFade = await row('Codex').evaluate(
    (node) => getComputedStyle(node.parentElement, '::after').backgroundImage,
  )
  assert.match(claudeFade, /linear-gradient/)
  assert.match(codexFade, /linear-gradient/)
  assert.notEqual(claudeFade, codexFade)
  await page.locator('header button[data-thread-view]').click()
  await capture('combined-list')
  await selectThreadView(page, 'active')
  await compose('Codex')
  await box.fill('Codex draft')
  await row('Codex').click()
  const plan = page.getByRole('region', { name: 'Codex plan' })
  await plan.getByText('Build the display', { exact: true }).waitFor()
  assert.equal(await plan.locator('li[data-status="completed"]').count(), 1)
  await page.getByLabel(/^Claude · 5-hour limit 20%/).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Claude · 5-hour limit 20%' }).waitFor()
  await page.getByLabel(/^Codex · Weekly limit 27%/).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Codex · Weekly limit 27%' }).waitFor()
  assert.equal(
    await page
      .getByRole('tooltip')
      .innerText()
      .then((text) => text.includes('5-hour')),
    false,
  )
  await page.locator('[class*="header"]').first().hover()
  await capture('codex-plan-usage')
  // Native Codex questions prepare answers without pretending to submit to a held hook.
  const nativeQuestion = {
    header: 'Preview colour',
    question: 'Which colour should the preview use for this workspace?',
    multiSelect: false,
    options: [
      {
        label: 'Follow the chat destination',
        description: 'Use the application colour.',
        recommended: true,
      },
      { label: 'Use the same colour everywhere', description: '', recommended: false },
    ],
  }
  await page.evaluate(
    (question) =>
      window.proof.patch({
        plan: [],
        attention: { kind: 'question', questions: [question], answerableUntil: null },
      }),
    nativeQuestion,
  )
  const questionCard = page.getByRole('region', { name: 'Codex question', exact: true })
  const customAnswer = questionCard.getByLabel('Answer for this Codex question')
  await questionCard.waitFor()
  assert.equal(await questionCard.getByRole('radio').first().isChecked(), true)
  await capture('codex-question')
  const beforeQuestion = await page.evaluate(
    () => window.proof.calls.filter((c) => ['send', 'answer'].includes(c[0])).length,
  )
  await questionCard.getByRole('radio').nth(1).check()
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Use the same colour everywhere'],
    ['open', chats.codex.appId],
  ])
  await customAnswer.fill('Use a softer blue for this workspace.')
  assert.equal(await questionCard.getByRole('radio').nth(1).isChecked(), false)
  await questionCard.getByRole('button', { name: 'Collapse question' }).click()
  await questionCard.waitFor({ state: 'detached' })
  await row('Codex').click()
  assert.equal(await customAnswer.inputValue(), 'Use a softer blue for this workspace.')
  await capture('codex-question-custom')
  await customAnswer.press('Control+Enter')
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Use a softer blue for this workspace.'],
    ['open', chats.codex.appId],
  ])
  await page.evaluate(
    (question) =>
      window.proof.patch({
        attention: {
          kind: 'question',
          questions: [
            question,
            {
              header: 'Details',
              question: 'What else should the preview show?',
              options: [],
              multiSelect: false,
            },
          ],
          answerableUntil: null,
        },
      }),
    nativeQuestion,
  )
  await questionCard.getByRole('button', { name: 'Next question' }).waitFor()
  assert.equal(
    await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).isDisabled(),
    true,
  )
  await questionCard.getByRole('button', { name: 'Next question' }).click()
  await customAnswer.fill('Keep the labels visible.')
  await toggle('Codex')
  await toggle('Codex')
  await row('Codex').click()
  assert.equal(await customAnswer.inputValue(), 'Keep the labels visible.')
  await questionCard.getByRole('button', { name: 'Previous question' }).click()
  assert.equal(await questionCard.getByRole('radio').first().isChecked(), true)
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    [
      'copy',
      `${nativeQuestion.question}\nFollow the chat destination\n\nWhat else should the preview show?\nKeep the labels visible.`,
    ],
    ['open', chats.codex.appId],
  ])
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((c) => ['send', 'answer'].includes(c[0])).length,
    ),
    beforeQuestion,
  )
  await page.evaluate((plan) => window.proof.patch({ plan }), trackedPlan)
  await page.evaluate(
    (question) =>
      window.proof.patch({
        attention: {
          kind: 'question',
          questions: [{ ...question, multiSelect: true }],
          answerableUntil: null,
        },
      }),
    nativeQuestion,
  )
  assert.equal(
    await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).isDisabled(),
    true,
  )
  await questionCard.getByRole('checkbox').first().check()
  await questionCard.getByRole('checkbox').nth(1).check()
  await questionCard.getByRole('button', { name: 'Copy & open', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.slice(-2)), [
    ['copy', 'Follow the chat destination, Use the same colour everywhere'],
    ['open', chats.codex.appId],
  ])
  await customAnswer.fill('Custom answer')
  await questionCard.getByRole('checkbox').first().check()
  assert.equal(await customAnswer.inputValue(), '')
  assert.equal(await questionCard.getByRole('checkbox').first().isChecked(), true)
  assert.equal(await questionCard.getByRole('checkbox').nth(1).isChecked(), false)
  assert.equal(await questionCard.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
  await page.evaluate(() =>
    window.proof.patch({
      attention: null,
      state: 'working',
      stage: '2/3 · Build the display',
    }),
  )
  await page.evaluate(
    (summary) =>
      window.proof.patch({
        lastPrompt: summary.lastPrompt,
        lastAction: summary.lastAction,
        lastReply: summary.lastReply,
      }),
    readableSummary,
  )
  await page.getByText('Working', { exact: true }).waitFor()
  await page.evaluate(
    (status) => window.proof.patch({ ...status, cwd: '\\\\?\\Z:\\synthetic\\workspace' }),
    codexState('inProgress', true, null, null),
  )
  await page.getByTitle('Z:\\synthetic\\workspace', { exact: true }).waitFor()
  assert.equal(await page.getByText('Working · state guessed', { exact: true }).count(), 0)
  await page.getByText(readableSummary.lastPrompt, { exact: true }).waitFor()
  await page.getByText(readableSummary.lastAction, { exact: true }).waitFor()
  await capture('codex-working-plan')
  await page.evaluate(() => window.proof.patch({ state: 'idle', stage: 'Done', plan: [] }))
  await page.getByText(readableSummary.lastReply, { exact: true }).waitFor()
  assert.equal(
    await page.getByText(/Files mentioned by the user|C:\/synthetic\/preview.png|pwsh.exe/).count(),
    0,
  )
  await capture('codex-readable-reply')
  await page.evaluate(() => window.proof.patch({ tracked: false }))
  await page.getByText('Status unavailable', { exact: true }).waitFor()
  await page.evaluate((cwd) => window.proof.patch({ tracked: true, cwd }), folder)
  await page.evaluate((plan) => window.proof.patch({ plan }), trackedPlan)
  await page.evaluate(
    (attention) => window.proof.patch({ attention, state: 'waiting', stage: 'Waiting for you' }),
    heldAttention,
  )
  await page.getByLabel('Answer for this Codex chat').waitFor()
  await page.evaluate(() =>
    window.proof.patch({
      plan: [],
      planText:
        '# Synthetic proposal\n- **Inspect** the data\n- Build `view.tsx`\n<script>not executable</script>',
    }),
  )
  await plan.getByRole('heading', { name: 'Synthetic proposal' }).waitFor()
  assert.equal(await plan.locator('script').count(), 0)
  await capture('codex-proposed-plan')
  await page.evaluate((plan) => window.proof.patch({ plan, planText: null }), trackedPlan)
  await page.getByLabel('Answer for this Codex chat').fill('Blue pending answer')
  await toggle('Claude')
  assert.equal(await page.getByLabel(/^Claude · 5-hour limit/).count(), 0)
  assert.equal(await box.inputValue(), 'Codex draft')
  await toggle('Claude')
  await toggle('Codex')
  assert.equal(await page.getByLabel(/^Codex · Weekly/).count(), 0)
  assert.equal(await box.count(), 0)
  await compose('Claude')
  assert.equal(await box.inputValue(), 'Claude draft')
  await toggle('Codex')
  assert.equal(await box.inputValue(), 'Claude draft')
  await compose('Codex')
  assert.equal(await box.inputValue(), 'Codex draft')
  await row('Codex').click()
  assert.equal(
    await page.getByLabel('Answer for this Codex chat').inputValue(),
    'Blue pending answer',
  )
  await page.evaluate(() => window.proof.patch({ live: true }))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.proof.calls.find((c) => c[0] === 'send')), [
    'send',
    chats.codex.id,
    'Codex draft',
  ])
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(
    await page.getByRole('switch', { name: 'Claude', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  assert.equal(
    await page.getByRole('switch', { name: 'OpenAI', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  // The merged open-mic control coexists with both provider switches; saving it never starts it.
  await chooseSetting(page, 'Voice target', 'Local STT')
  await chooseSetting(page, 'Send text to', 'Agent conversation')
  await page.getByText('Send countdown', { exact: true }).waitFor({ state: 'detached' })
  assert.equal(await page.getByText('Send countdown', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('switch', { name: 'Open mic', exact: true }).count(), 0)
  await chooseSetting(page, 'Send text to', 'Thread message')
  await page.getByText('Send countdown', { exact: true }).waitFor()
  await chooseSetting(page, 'Voice target', 'GPT Live')
  await page.getByRole('button', { name: 'Voice target: GPT Live', exact: true }).waitFor()
  await page.getByRole('button', { name: /^Send text to:/ }).waitFor({ state: 'detached' })
  await capture('voice-target-gpt-live')
  await chooseSetting(page, 'Voice target', 'Local STT')
  await chooseSetting(page, 'Send text to', 'Agent conversation')
  await capture('voice-target-local-stt')
  await page.getByText('Send countdown', { exact: true }).waitFor({ state: 'detached' })
  await capture('provider-toggles')
  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Open the mic for voice commands' }).count(),
    0,
  )
  await selectThreadView(page, 'all')
  assert.equal(await page.getByRole('button', { name: /^Claude · shared/ }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: /^Codex · shared/ }).isVisible(), true)
  await capture('combined-workspaces')
  await toggle('Claude')
  await toggle('Codex')
  assert.equal(
    await page
      .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
      .isVisible(),
    true,
  )
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  // Agent voice is independent of monitored chats; with no model it requests speech setup.
  await page
    .getByText('Voice needs the speech model first. Open the composer and press the mic.')
    .waitFor()
  await page.reload()
  await page
    .getByText('Chat monitoring is paused. Enable Claude or Codex in Settings.', { exact: true })
    .waitFor()
  await page.goto(url + '?view=dot')
  await page.getByRole('status', { name: /Chat monitoring is paused/ }).waitFor()
  await checkMicPill(page, capture)
  await page.goto(url + '?view=panel')
  await toggle('Codex')
  await page.evaluate(() =>
    window.proof.quota({
      at: Date.now() - 86400_000,
      fiveHour: null,
      week: { used: 0.99, resetsAt: Date.now() - 1000 },
    }),
  )
  await page.getByLabel(/^Codex · Weekly usage unavailable/).waitFor()
  assert.equal(await page.locator('[class*="codexUsage"] [class*="usageFill"]').count(), 0)
  // Use a generated audio stream, never the PC's microphone, to exercise the actual recorder UI.
  await setupVoiceInput(page)
  await compose('Codex')
  await box.fill('')
  assert.equal(
    await page
      .getByRole('group', { name: 'Codex message composer' })
      .getByRole('button', { name: 'Send', exact: true })
      .count(),
    0,
  )
  await box.fill('   ')
  assert.equal(
    await page
      .getByRole('group', { name: 'Codex message composer' })
      .getByRole('button', { name: 'Send', exact: true })
      .count(),
    0,
  )
  await box.fill('')
  const sendsBeforeRecording = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'send').length,
  )
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Talk', exact: true })
    .click()
  const waveform = page.getByRole('img', { name: 'Listening...', exact: true })
  await waveform.waitFor()
  const codexDivider = page.getByRole('region', { name: 'Voice waveform', exact: true })
  await codexDivider.waitFor()
  assert.equal(await page.locator('header canvas').count(), 1)
  await page.waitForFunction(() => window.proof.motion?.input.level > 0.1)
  await page.waitForTimeout(600) // finish the idle-to-ribbon morph before checking its full extent
  const ribbonPixels = await readMotionFrame(waveform)
  assert.ok(ribbonPixels.count > 0 && ribbonPixels.span > 0.85, JSON.stringify(ribbonPixels))
  const waveBounds = await waveform.boundingBox()
  const entryBounds = await waveform.locator('..').boundingBox()
  assert.ok(waveBounds.width > 220 && Math.abs(waveBounds.width - entryBounds.width) < 1)
  await capture('composer-listening')
  const firstFrame = await readMotionFrame(waveform)
  await page.waitForTimeout(150)
  assert.notEqual((await readMotionFrame(waveform)).hash, firstFrame.hash)
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Stop and transcribe', exact: true })
    .click()
  await waveform.waitFor({ state: 'detached' })
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('Synthetic transcript'))
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === 'Synthetic transcript',
  )
  assert.equal(await page.evaluate(() => window.proof.stoppedTracks), 1)
  await codexDivider.waitFor({ state: 'detached' })
  await box.fill('Existing draft')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Talk', exact: true })
    .click()
  await waveform.waitFor()
  await codexDivider.waitFor()
  assert.equal(await page.locator('textarea').inputValue(), 'Existing draft')
  assert.equal(await page.locator('textarea').isVisible(), true)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForTimeout(1800) // allow the measured envelope to settle before checking drift
  const stationary = await readMotionFrame(waveform)
  await page.waitForTimeout(180) // several animation frames: reduced motion must not scroll sideways
  assert.equal((await readMotionFrame(waveform)).hash, stationary.hash)
  const headerStill = await readMotionFrame(codexDivider)
  await page.waitForTimeout(180)
  assert.equal((await readMotionFrame(codexDivider)).hash, headerStill.hash)
  await capture('composer-listening-draft')
  await page.evaluate(() => {
    window.proof.finishTranscript = null
  })
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Stop and transcribe', exact: true })
    .click()
  await waveform.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.proof.stoppedTracks === 2)
  await page.getByPlaceholder('Transcribing...').waitFor()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('More words'))
  await page.waitForFunction(
    () => document.querySelector('textarea')?.value === 'Existing draft More words',
  )
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send').length),
    sendsBeforeRecording,
  )
  // The global open mic follows the built-in Claude agent, even with a Codex composer selected.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(async () => {
    window.proof.quietInput = true
    await window.threadlight.updateSettings({ voiceTarget: 'agent' })
  })
  assert.equal(
    await page
      .getByRole('button', { name: 'Open the mic for voice commands', exact: true })
      .count(),
    0,
  )
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  const divider = page.getByRole('region', { name: 'Voice waveform', exact: true })
  await divider.waitFor()
  assert.equal(await page.locator('header canvas').count(), 1)
  assert.equal(
    await page.getByRole('region', { name: 'Voice activity' }).locator('canvas').count(),
    0,
  )
  await page.waitForFunction(() => {
    return window.proof.motion?.input.level < 0.01
  })
  await capture('open-mic-quiet')
  const before = await page.locator('[data-card]').boundingBox()
  await page.evaluate(() => window.proof.setAudioLevel(0.18))
  await page.waitForFunction(() => {
    return window.proof.motion?.input.level > 0.2
  })
  assert.equal((await page.locator('[data-card]').boundingBox()).height, before.height)
  await capture('open-mic-speaking')
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => {
    return window.proof.motion?.input.level < 0.01
  })
  await page.evaluate(() => window.proof.emit('onTalkToggle'))
  await divider.waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.proof.stoppedTracks === 3)
  await checkVoiceRouting(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new Error('Synthetic microphone denied')
      },
    })
    window.proof.emit('onTalkToggle')
  })
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'blocked')
  await page.getByRole('alert').filter({ hasText: 'The microphone is blocked' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'The microphone is blocked', exact: true }).count(),
    0,
  )
  assert.equal(await divider.getByRole('img', { name: 'You speaking', exact: true }).count(), 0)

  // The hosted Agent is available independently of monitoring and uses a dynamic catalog.
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: [], voiceTarget: 'thread' }),
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await checkAgentSettings(page, capture)
  assert.equal(settings.agentCodexModel, 'future-deep')
  assert.equal(settings.agentCodexReasoning, 'ultra')
  await capture('agent-codex-settings')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await openHeaderPage(page, 'Agent')
  await page.getByRole('button', { name: 'Reply to Agent' }).click()
  await page.getByPlaceholder('Ask your agent…').fill('Synthetic agent question')
  await page.getByPlaceholder('Ask your agent…').press('Enter')
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await page.getByRole('button', { name: 'Agent effort: ultra', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to Agent', exact: true }).click()
  await page.evaluate(() =>
    window.proof.agent({
      status: 'waiting',
      requests: [
        {
          id: 'question-1',
          kind: 'questions',
          title: 'Choose a colour',
          detail: '',
          canAllow: true,
          questions: [
            { id: 'colour', text: 'Which colour?', options: ['Blue', 'Green'], other: true },
          ],
        },
      ],
    }),
  )
  assert.equal(await page.getByRole('radio', { name: 'Blue', exact: true }).isChecked(), false)
  await page.getByRole('radio', { name: 'Green', exact: true }).check()
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  const response = await page.evaluate(() =>
    window.proof.calls.filter((c) => c[0] === 'agentRespond').at(-1),
  )
  assert.deepEqual(response, [
    'agentRespond',
    'question-1',
    { action: 'answer', answers: { colour: 'Green' } },
  ])
  await page.evaluate(() =>
    window.proof.agent({
      status: 'waiting',
      requests: [
        {
          id: 'approval-1',
          kind: 'approval',
          title: 'Synthetic file change',
          detail: 'Full synthetic action details',
          canAllow: true,
        },
        { id: 'approval-2', kind: 'approval', title: 'Second action', detail: '', canAllow: true },
      ],
    }),
  )
  await page.getByText('Synthetic file change · 2 pending', { exact: true }).waitFor()
  await capture('agent-approval')
  await page.getByRole('button', { name: 'Deny', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentRespond').at(-1)),
    ['agentRespond', 'approval-1', { action: 'deny' }],
  )
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page
    .getByText('Turn stopped. You can continue this conversation.', { exact: true })
    .waitFor()
  await page.evaluate(() => {
    window.threadlight.finishCallChat = async () => {
      window.proof.agent({ ended: true, status: 'idle' })
      return { ok: true }
    }
  })
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await page.getByRole('button', { name: /Earlier · 1/ }).click()
  await page.getByRole('button', { name: /Synthetic earlier agent/ }).click()
  await page.getByText('A saved reply', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click()
  await page.getByText('An older reply', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentResume').at(-1)),
    ['agentResume', 'codex:past'],
  )
  assert.deepEqual(errors, [])
  await checkAgentSelection(page, capture)
  await checkThreadReading(page, capture)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: provider lists, drafts, sends, plans, usage, composer waveform and header waveform; Agent model settings, questions, queued approvals, Stop/End and history; no browser errors.',
  )
} catch (error) {
  if (process.env.THREADLIGHT_UI_FOCUS === 'voice-mode')
    console.log(
      await testPage?.evaluate(() => ({
        openMic: document.documentElement.dataset.openMic,
        quietMs: window.proof.quietAudioMs,
        voicedMs: window.proof.voicedAudioMs,
        source: window.proof.voiceSourceContext?.state,
        gain: window.proof.voiceSourceGain?.gain.value,
        processor: window.proof.audioProcessor?.context.state,
      })),
    )
  console.log((await testPage?.locator('body').innerText())?.slice(0, 6000))
  if (process.env.THREADLIGHT_SCREENSHOTS)
    await testPage?.screenshot({
      path: join(process.env.THREADLIGHT_SCREENSHOTS, 'memory-error.local.png'),
    })
  throw error
} finally {
  await browser?.close()
  memoryProof?.connections.close()
  spacesProof?.close()
  communicationProof?.close()
  memoryProof?.close()
  if (resolve(workspaceFixture).startsWith(resolve(tmpdir()) + sep + 'threadlight-ui-workspace-'))
    rmSync(workspaceFixture, { recursive: true, force: true })
  await new Promise((done) => server.close(done))
}
