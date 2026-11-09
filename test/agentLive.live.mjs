import { memoryFixture } from './live/memory-transport.fixture.mjs'
// Opt-in native integration check. Uses the existing ChatGPT sign-in, synthetic silence,
// and one short test message. Never opens a physical microphone or plays through speakers.
/* global window, AudioContext */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
if (process.env.THREADLIGHT_LIVE_SMOKE !== '1') {
  console.log('Skipped: set THREADLIGHT_LIVE_SMOKE=1 and THREADLIGHT_CODEX_CLI to opt in.')
  process.exit(0)
}
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )
const { AgentService } = require('../src/main/agent/agentService.ts')
const { DEFAULT_SETTINGS } = require('../src/shared/settings.ts')
const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const { DatabaseSync } = require('node:sqlite')
const { CommunicationStore } = require('../src/main/communication/store.ts')
const { ConversationEventService } = require('../src/main/communication/conversationEvents.ts')
const eventDb = new DatabaseSync(':memory:'),
  eventStore = new CommunicationStore(eventDb),
  eventFeed = new ConversationEventService(eventStore)
const eventSnapshot = {
  messages: [],
  questions: [],
  workflows: [],
  assignments: [],
  events: [],
  cursor: 0,
  snapshotRequired: false,
  nativeRequests: [],
}
const { OwnedRequests } = require('../src/main/communication/ownedRequests.ts')
const ownedRequests = new OwnedRequests(() => (service ? [service] : []))
const projectFeed = (owner) => {
  if (questionProof) eventSnapshot.nativeRequests = ownedRequests.list()
  return eventFeed.project(owner, eventSnapshot, () => 'Build')
}
const folder = mkdtempSync(join(tmpdir(), 'threadlight-live-check-'))
let browser, page, service, readServer, target
let controlServer
const browserProof = process.env.THREADLIGHT_LIVE_BROWSER === '1'
const browserReads = []
const windowProof = process.env.THREADLIGHT_LIVE_WINDOW === '1'
const coachProfileProof = process.env.THREADLIGHT_LIVE_COACH_PROFILE === '1'
const coachDescriptor = process.env.THREADLIGHT_LIVE_COACH
const wholeReview = process.env.THREADLIGHT_LIVE_REVIEW === '1'
const proposalProof = process.env.THREADLIGHT_LIVE_PROPOSAL === '1'
const proposalWalk = process.env.THREADLIGHT_LIVE_PROPOSAL_WALK === '1'
let walkedLine
let proposalVisible = false,
  traceShown = false
const guideProof = process.env.THREADLIGHT_LIVE_GUIDE === '1'
const ghostWalk = process.env.THREADLIGHT_GHOST_ONLY === '1'
const fileWalk = process.env.THREADLIGHT_WALKTHROUGH_ONLY === '1'
const walkedSpeech = []
const guideEvents = []
let guideSpeechCount = 0,
  voiceProgress = false
const reviewPages = []
let coach,
  coachShown = false,
  coachDiff = false,
  coachInline = false,
  spokeBeforeHighlight = false
let focused = 'Orchid'
const windowReads = []
const readProof = process.env.THREADLIGHT_LIVE_THREAD_READ === '1'
const announcementProof = process.env.THREADLIGHT_LIVE_ANNOUNCEMENT === '1'
const questionProof = process.env.THREADLIGHT_LIVE_QUESTION === '1'
const bufferedOpening = process.env.THREADLIGHT_LIVE_BUFFERED === '1'
if (bufferedOpening) assert.ok(process.env.THREADLIGHT_LIVE_INITIAL_WAV)
let message =
  process.env.THREADLIGHT_LIVE_TEST_MESSAGE ||
  'This is a voice connection test. Reply briefly with voice connection ready. Do not use tools.'
let expected = new RegExp(process.env.THREADLIGHT_LIVE_EXPECT || 'voice connection ready', 'i')
const waitReady = async (agent) => {
  const until = Date.now() + 120000
  while (Date.now() < until && !['ready', 'error', 'waiting'].includes(agent.current.status))
    await new Promise((r) => setTimeout(r, 200))
  assert.equal(agent.current.status, 'ready', agent.current.error ?? 'Target did not finish')
}
;(async () => {
  assert.ok(
    process.env.THREADLIGHT_CODEX_CLI,
    'Set THREADLIGHT_CODEX_CLI to the installed desktop-managed CLI executable',
  )
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.THREADLIGHT_CHROMIUM || undefined,
    // Mute the browser output. Muting the media element can stop Chrome decoding
    // incoming audio, leaving totalAudioEnergy at zero despite a completed transcript.
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  })
  page = await browser.newPage()
  await page.route('http://localhost:17896/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Threadlight native voice test</title>',
    }),
  )
  await page.goto('http://localhost:17896/')
  const options = {
    workspace: folder,
    index: join(folder, 'history.json'),
    claudeProjects: folder,
    settings: () => ({
      ...DEFAULT_SETTINGS,
      agentProvider: 'codex',
      agentLifetimeMinutes: 0,
      agentCodexModel: process.env.THREADLIGHT_LIVE_MODEL || DEFAULT_SETTINGS.agentCodexModel,
    }),
    snapshot: () => ({
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    }),
    cli: async () => ({ command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] }),
    onChange: () => {
      if (questionProof && page)
        void page.evaluate(() => window.communicationChanged?.()).catch(() => {})
    },
    onConversation: (state) => {
      if (state.conversationId)
        eventFeed.register(
          state.conversationId,
          state.sessionId ? `codex:${state.sessionId}` : undefined,
        )
    },
    announcements:
      announcementProof || questionProof
        ? {
            next: (owner, since, questionsOnly) => {
              projectFeed(owner)
              return eventFeed.reserve(owner, since, questionsOnly)
            },
            commit: (a) => {
              projectFeed(a.owner)
              return eventFeed.commit(a)
            },
            settle: (owner, id, state) => eventFeed.settle(owner, id, state),
          }
        : undefined,
    onRateLimit: () => {},
    onLive: (event) => {
      void page.evaluate((e) => window.voiceEvent?.(e), event).catch(() => {})
    },
  }
  if (browserProof || windowProof || coachDescriptor || coachProfileProof) {
    const { AppControlService } = require('../src/main/appControl/service.ts')
    const { AppControlServer } = require('../src/main/appControl/server.ts')
    controlServer = new AppControlServer(
      new AppControlService(
        {
          settings: options.settings,
          workspaces: () => [],
          spaces: () => [],
        },
        join(folder, 'operations.json'),
      ),
      memoryFixture(join(folder, 'control')),
    )
    await controlServer.start()
    options.appControl = controlServer
    options.foregroundWindow = async () => {
      windowReads.push(focused)
      return { application: focused + '.exe', title: focused, observedAt: Date.now() }
    }
    message = 'Can you help me with this app? Tell me which application is in front right now.'
    expected = /orchid/i
    if (browserProof) {
      const { setBrowserAccess } = require('../src/main/browser/registry.ts')
      const state = {
        id: 'lesson-browser',
        threadId: '@threadlight-browser',
        url: 'https://example.org/lesson',
        title: 'Return values lesson',
        visible: true,
        revision: 1,
        loading: false,
      }
      setBrowserAccess({
        call: async (_caller, command) => {
          browserReads.push(command.action)
          if (command.action === 'list') return { ok: true, browsers: [state] }
          if (command.action === 'inspect')
            return {
              ok: true,
              state,
              observation: [
                {
                  frame: 0,
                  url: state.url,
                  title: state.title,
                  text: '',
                  elements: [],
                  media: [
                    {
                      element: 1,
                      kind: 'video',
                      currentTime: 37.5,
                      duration: 120,
                      paused: true,
                      visible: true,
                      observedAt: Date.now(),
                      tracks: [
                        {
                          kind: 'captions',
                          language: 'en',
                          available: true,
                          nearby: [{ start: 30, end: 42, text: 'A function can return a value.' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          return { ok: false, reason: 'Read-only video discussion test.' }
        },
      })
      message =
        'I paused the video in the Threadlight browser. Where am I in the video, and what does the sentence I just heard about return values mean? Check the browser and explain briefly.'
      expected =
        /(?=.*(?:37|38|thirty.seven|thirty.eight))(?=.*(?:caller|result|gives back|sends back|hands back))/is
    }
    if (coachProfileProof) {
      const file = join(folder, 'coach-profile.json')
      writeFileSync(
        file,
        JSON.stringify({
          level: 'Harbour Python course, week three',
          teachingStyle: 'Ask one question at a time',
        }),
      )
      message = 'Select Threadlight Coach. What is the name and week of my saved course?'
      expected = /harbour|harbor/i
      assert.ok(process.env.THREADLIGHT_LIVE_TEST_WAV, 'Supply the spoken week-five update.')
      options.onChange = (state) => {
        const card = state.requests.find(
          (r) => r.title === 'Update coaching profile' && /five|5/i.test(r.detail),
        )
        if (card) setTimeout(() => service.respond(card.id, { action: 'allow' }), 0)
      }
    }
    if (coachDescriptor) {
      const { EditorCoach } = require('../src/main/editorCoach.ts')
      coach = new EditorCoach(
        () => service.activeLiveSession,
        async (id, text, first, proposal) => {
          if (proposalProof) assert.equal(proposal, true)
          if (!guideProof && !proposalProof) {
            assert.ok(first)
            assert.match(text, /lantern|total|assign|value/i)
          }
          coachShown = true
          await service.speakCoachStep(id, text, first, proposal)
          if (guideProof) {
            guideSpeechCount++
            if (guideSpeechCount === 2 || guideSpeechCount === 3)
              writeFileSync(
                join(
                  process.env.THREADLIGHT_COACH_TEST_DIR,
                  guideSpeechCount === 2 ? 'guide-second-speech' : 'guide-resumed-speech',
                ),
                '',
              )
          }
        },
        coachDescriptor,
        async (id, event) => {
          if (!guideProof && !fileWalk && !ghostWalk) return
          try {
            if (fileWalk && event.needsNotes && event.line === 77 && event.endLine === 79)
              writeFileSync(join(process.env.THREADLIGHT_COACH_TEST_DIR, 'section-requested'), '')
            await service.coachEvent(id, event)
            guideEvents.push(event)
            console.log('Guide receipt', event.status, event.step)
          } catch (error) {
            console.error('Guide event delivery:', error.message)
            throw error
          }
        },
        (id) => service.interruptProposal(id),
        async (id, text, signal) => {
          if (ghostWalk) {
            const marker = join(process.env.THREADLIGHT_COACH_TEST_DIR, 'ghost-typed')
            assert.ok(existsSync(marker), 'The learner started typing')
            console.log(
              'Typing to Live speech request:',
              Date.now() - Number(readFileSync(marker, 'utf8')),
              'ms',
            )
          }
          coachShown = true
          console.log('Walkthrough speech requested:', text)
          await service.speakWalkthrough(id, text, signal).catch((error) => {
            console.log('Walkthrough speech failed:', error.message)
            throw error
          })
          walkedSpeech.push(text)
        },
        undefined,
        fileWalk ? () => ({ arrow: true, x: 0, y: 0 }) : undefined,
      )
      options.editorCoach = async (id, command) => {
        const started = Date.now()
        const result = await coach.run(id, command)
        if (
          fileWalk &&
          command.action === 'walkthrough_notes' &&
          result.line === 76 &&
          !result.started
        ) {
          assert.equal(coachShown, false, 'Preparing did not speak the first line')
          writeFileSync(join(process.env.THREADLIGHT_COACH_TEST_DIR, 'file-walk-ready'), '')
        }
        if (ghostWalk && command.action === 'walkthrough_notes' && result.prepared)
          writeFileSync(join(process.env.THREADLIGHT_COACH_TEST_DIR, 'ghost-ready'), '')
        if (proposalProof || fileWalk || ghostWalk)
          console.log(
            'Editor receipt',
            command.action,
            result?.status ?? result?.tracing,
            Date.now() - started,
          )
        if (command.action === 'propose') proposalVisible = result.status === 'shown'
        if (command.action === 'proposal_line') walkedLine = result
        if (command.action === 'trace') traceShown = result.tracing === true
        if (command.action === 'review') reviewPages.push(result)
        if (guideProof && command.action === 'progress' && result.applied && result.step === 2)
          voiceProgress = true
        if (command.action === 'diff') coachDiff = true
        if (command.action === 'inline') coachInline = result?.awaitingEditorAcceptance === true
        return result
      }
      options.onChange = (state) => {
        coach.sync()
        if (
          !coachShown &&
          state.items.some(
            (i) =>
              i.id?.startsWith('live:') &&
              i.kind === 'agent' &&
              /starts at one|assigns (?:the )?(?:number |value )?[1one]+/i.test(i.text),
          )
        )
          spokeBeforeHighlight = true
      }
      message =
        'Coach me in the connected VS Code editor. Use the editor coaching context and guide tools. Highlight the assignment to total with one step. Set the spoken explanation to precisely “The lantern value starts at one.” Wait for my click.'
      expected = /lantern|total|assign|value/i
      if (ghostWalk) {
        message =
          'Select Threadlight Coach and make line 64 onwards in my current problem.py file ghost text for me to trace. Explain each line when I start typing it.'
        expected = /print|display|output|lantern|screen/i
      }
      if (fileWalk) {
        message =
          'Walk me through my Python file. Keep going to the end and explain what each line does.'
        expected = /apple|price|dictionary/i
      }
      if (guideProof) {
        message =
          'Could you show me one step at a time how this code assigns total and then prints it? Use those two steps.'
      }
      if (proposalProof) {
        message =
          'There is an undefined name in my file. Show me the inline diff and explain it aloud while I look at it.'
        expected = /lantern|undefined|defined|name/i
      }
      if (wholeReview) {
        message =
          'Something is wrong with the file I have open in VS Code. Review the whole file and tell me what you think is wrong, if anything.'
        expected =
          /missing(?:_|\s+(?:underscore\s+)?)lantern|name\s?error|(?:undefined|never defined|not defined)/i
      }
    }
  }
  if (readProof) {
    assert.ok(
      process.env.THREADLIGHT_LIVE_TEST_WAV,
      'Thread-reading proof requires follow-up speech WAV',
    )
    const { ThreadReadService } = require('../src/main/threadRead/service.ts')
    const { ThreadReadServer } = require('../src/main/threadRead/server.ts')
    const { CodexReadAdapter } = require('../src/main/threadRead/codex.ts')
    const { codexPaths } = require('../src/main/sessions/paths.ts')
    const { CodexClient } = require('../src/main/agent/codexClient.ts')
    readServer = new ThreadReadServer(
      new ThreadReadService([new CodexReadAdapter(codexPaths())], () => ['codex']),
      memoryFixture(join(folder, 'reader')),
    )
    await readServer.start()
    target = new AgentService({
      ...options,
      workspace: join(folder, 'target'),
      index: join(folder, 'target.json'),
      onLive: undefined,
    })
    const title = `Synthetic live reader ${Date.now()}`
    assert.equal(
      (await target.send('Reply exactly: synthetic colour amber. Do not use tools.')).ok,
      true,
    )
    await waitReady(target)
    const native = new CodexClient(
      { command: process.env.THREADLIGHT_CODEX_CLI, prefixArgs: [] },
      folder,
    )
    try {
      await native.initialize()
      await native.request('thread/name/set', { threadId: target.current.sessionId, name: title })
    } finally {
      native.close()
    }
    options.threadReads = readServer
    message = `What did the Codex chat named "${title}" say last? Read it now and tell me its colour.`
    expected = /amber/i
  }
  eventStore.onChange = () =>
    void page.evaluate(() => window.communicationChanged?.()).catch(() => {})
  service = new AgentService(options)
  await page.exposeFunction('startVoice', (id, sdp) => service.startLive(id, sdp))
  await page.exposeFunction('openVoice', (id, text) => service.openLive(id, text))
  await page.exposeFunction('livePlaybackBoundary', (id, kind, turn, words) =>
    service.playbackBoundary(id, kind, turn, words),
  )
  await page.exposeFunction('getAgent', () => service.current)
  await page.exposeFunction('announceVoice', (id, command) =>
    service.announcementCommand(id, command),
  )
  await page.exposeFunction('stopVoice', (id) => service.stopLive(id))
  await page.evaluate(() => {
    window.threadlight = {
      getAgent: window.getAgent,
      livePlaybackBoundary: window.livePlaybackBoundary,
      agentLiveStart: window.startVoice,
      agentAnnouncement: window.announceVoice,
      onCommunication: (fn) => {
        window.communicationChanged = fn
        return () => {
          window.communicationChanged = null
        }
      },
      agentLiveOpen: window.openVoice,
      agentLiveStop: window.stopVoice,
      onAgentLive: (fn) => {
        window.voiceEvent = fn
        return () => {
          window.voiceEvent = null
        }
      },
    }
    window.phases = []
    window.liveEvents = []
  })
  const { build } = await import('vite')
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: {
        entry: join(sourceRoot, 'src/renderer/lib/liveVoice.ts'),
        name: 'LiveVoiceProof',
        formats: ['iife'],
      },
    },
  })
  const output = Array.isArray(built) ? built[0].output : built.output
  const renderer = output.find((chunk) => chunk.type === 'chunk').code
  await page.addScriptTag({
    content: `${renderer}\nwindow.LiveVoiceConnection=LiveVoiceProof.LiveVoiceConnection;`,
  })
  await page.evaluate(async (buffered) => {
    window.context = new AudioContext({ sampleRate: 16000 })
    const osc = window.context.createOscillator(),
      gain = window.context.createGain(),
      dest = window.context.createMediaStreamDestination()
    gain.gain.value = 0
    const processor = window.context.createScriptProcessor(512, 1, 1)
    window.testProcessor = processor
    osc.connect(gain).connect(processor).connect(dest)
    window.connection = new window.LiveVoiceConnection(
      dest.stream,
      16000,
      (phase, error) => window.phases.push({ phase, error }),
      window.context,
    )
    window.connection.audio.muted = true
    window.connection.channel.addEventListener('message', ({ data }) => {
      try {
        const e = JSON.parse(data)
        window.liveEvents.push({
          type: e.type,
          keys: Object.keys(e),
          at: Date.now(),
          event_id: e.event_id,
          client_event_id: e.client_event_id,
          turn_id: e.turn_id,
          item_id: e.item_id,
          turn: e.turn,
          item: e.item,
          start_ms: e.start_ms,
          end_ms: e.end_ms,
        })
      } catch {
        /* Ignore non-JSON native transport frames in diagnostics. */
      }
    })
    processor.onaudioprocess = (e) =>
      window.connection.process(e.inputBuffer.getChannelData(0), e.outputBuffer.getChannelData(0))
    osc.start()
    await window.context.resume()
    if (buffered) {
      const ready = new Promise((resolve) => {
        window.releaseBufferedConnection = resolve
      })
      window.threadlight.agentLiveStart = async (...args) => {
        const result = await window.startVoice(...args)
        await ready
        return result
      }
    }
    window.connecting = window.connection.start({ bufferAudio: buffered })
    if (!buffered) await window.connecting
  }, bufferedOpening)
  if (bufferedOpening) {
    assert.equal(await page.evaluate(() => window.connection.connected), false)
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_INITIAL_WAV)]
    await page.evaluate(async (bytes) => {
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      await new Promise((resolve) => {
        speech.onended = resolve
        speech.start()
      })
      window.startupBufferedSeconds = window.connection.bufferedSeconds
    }, wave)
    assert.equal(service.current.items.length, 0, 'No speech may be submitted before readiness')
    assert.ok(
      await page.evaluate(() => window.startupBufferedSeconds > 1),
      'Opening audio must be buffered',
    )
    await page.evaluate(async () => {
      window.releaseBufferedConnection()
      await window.connecting
    })
  }
  assert.equal(
    await page.evaluate(() => window.connection.connected),
    true,
    JSON.stringify(await page.evaluate(() => window.phases)),
  )
  assert.equal(service.current.items.length, 0, 'Preparation must not send the opening')
  if (questionProof) {
    message =
      'Use request_user_input to show me exactly one question card: Which colour do you want? The choices are Red and Blue. I will answer on the card.'
    expected = /which colou?r do you want.*red or blue/is
  }
  if (process.env.THREADLIGHT_LIVE_INITIAL_WAV && !bufferedOpening) {
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_INITIAL_WAV)]
    await page.evaluate(async (bytes) => {
      window.connection.listen()
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      speech.start()
    }, wave)
  } else if (questionProof) {
    await page.evaluate((text) => window.connection.open(text), message)
  } else if (announcementProof) {
    expected = /Build has returned a result/i
    await page.evaluate(() => {
      window.connection.listen()
    })
    if (process.env.THREADLIGHT_LIVE_PROBE_INPUT) {
      const bytes = [...readFileSync(process.env.THREADLIGHT_LIVE_PROBE_INPUT)]
      await page.evaluate(async (bytes) => {
        const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
        const speech = window.context.createBufferSource()
        speech.buffer = buffer
        speech.connect(window.testProcessor)
        speech.start()
      }, bytes)
      await new Promise((r) => setTimeout(r, 12000))
    }
    const id = crypto.randomUUID(),
      targetId = crypto.randomUUID()
    eventStore.transaction(() =>
      eventStore.put(
        'message',
        {
          id,
          operationId: crypto.randomUUID(),
          sender: service.current.conversationId,
          senderKind: 'agent',
          rootId: id,
          kind: 'request',
          body: 'Synthetic background test',
          at: Date.now(),
          deliveries: [
            {
              target: targetId,
              phase: 'completed',
              attemptId: crypto.randomUUID(),
              reason: 'Native result fixture',
              reply: 'Tests finished.',
              observedAt: Date.now(),
            },
          ],
        },
        'Result',
      ),
    )
    projectFeed(service.current.conversationId)
  } else if (!bufferedOpening) await page.evaluate((text) => window.connection.open(text), message)
  if (process.env.THREADLIGHT_LIVE_CONTROLS === '1') {
    assert.ok(process.env.THREADLIGHT_LIVE_TEST_WAV, 'Supply a generated follow-up utterance.')
    await page.waitForFunction(() => !!window.connection.assistantTurn, undefined, {
      timeout: 60000,
    })
    const checked = await page.evaluate(() => {
      const voice = window.connection
      voice.setInputMuted(true)
      const input = new Float32Array([0.4]),
        output = new Float32Array([0.4])
      voice.process(input, output)
      const silentInput = output[0] === 0 && !voice.audio.muted
      voice.setOutputMuted(true)
      voice.setInputMuted(false)
      const independent = voice.audio.muted && !voice.inputMuted
      voice.setOutputMuted(false)
      voice.stopSpeaking()
      return {
        silentInput,
        independent,
        stopped: voice.audio.muted,
        active: voice.active,
        peer: voice.peer.connectionState,
        phases: window.phases,
      }
    })
    assert.ok(
      checked.silentInput &&
        checked.independent &&
        checked.stopped &&
        checked.active &&
        checked.peer === 'connected',
      JSON.stringify(checked),
    )
  }
  const spokenAnswer = () =>
    (!coachDescriptor || (wholeReview ? reviewPages.at(-1)?.status === 'complete' : coachShown)) &&
    (browserProof
      ? expected.test(
          service.current.items
            .filter((i) => i.kind === 'agent' && i.liveComplete && i.id?.startsWith('live:'))
            .map((i) => i.text)
            .join(' '),
        )
      : service.current.items.some(
          (i) =>
            i.kind === 'agent' &&
            i.liveComplete &&
            i.id?.startsWith('live:') &&
            expected.test(i.text),
        ))
  const deadline = Date.now() + (wholeReview || proposalProof || ghostWalk ? 120000 : 60000)
  while (
    !spokenAnswer() &&
    (await page.evaluate(() => window.connection.active)) &&
    Date.now() < deadline
  )
    await new Promise((r) => setTimeout(r, 250))
  if (browserProof)
    writeFileSync(
      join(folder, 'browser-discussion.json'),
      JSON.stringify(
        {
          passed: spokenAnswer(),
          browserReads,
          state: service.current,
          events: await page.evaluate(() => window.liveEvents),
        },
        null,
        2,
      ),
    )
  assert.ok(
    spokenAnswer(),
    'Expected a native spoken answer matching THREADLIGHT_LIVE_EXPECT, not just a filler acknowledgment',
  )
  if (announcementProof || questionProof) {
    const until = Date.now() + 45000
    while (
      eventFeed
        .get(service.current.conversationId)
        .cards.some(
          (c) => c.speech === 'pending' || c.speech === 'reserved' || c.speech === 'submitted',
        ) &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 200))
    assert.equal(
      eventFeed.get(service.current.conversationId).cards[0]?.speech,
      'announced',
      'Production scheduler must observe completion and audio playback',
    )
    if (questionProof) {
      const request = service.current.requests.find((r) => r.kind === 'questions')
      assert.ok(request, 'The spoken question must still be waiting for the user')
      const readouts = service.current.items.filter(
        (i) =>
          i.kind === 'agent' &&
          i.liveComplete &&
          i.id?.startsWith('live:') &&
          expected.test(i.text),
      )
      assert.equal(readouts.length, 1)
      const result = await service.respond(request.id, {
        action: 'answer',
        answers: { [request.questions[0].id]: 'Red' },
      })
      assert.ok(result.ok, result.reason)
      console.log(
        'PASS real native question card, spoken question and both options, one confirmed playback and accepted answer.',
      )
    }
  }
  // Let the native completed-item event persist the final transcript before stopping.
  await new Promise((r) => setTimeout(r, 2500))
  if (process.env.THREADLIGHT_LIVE_REGION) {
    const [, jpeg, thumbnail] = readFileSync(process.env.THREADLIGHT_LIVE_REGION, 'utf8')
      .trim()
      .split(' ')
    const before = new Set(service.current.items.map((item) => item.id))
    const result = await service.shareLiveRegion(service.activeLiveSession, { jpeg, thumbnail })
    assert.ok(result.ok, result.reason)
    const until = Date.now() + 60000
    const acknowledged = () =>
      service.current.items.find(
        (item) => item.liveComplete && item.kind === 'agent' && !before.has(item.id),
      )
    while (!acknowledged() && Date.now() < until) await new Promise((r) => setTimeout(r, 250))
    assert.ok(acknowledged(), 'Expected a spoken reply after sending the image without speech.')
    if (process.env.THREADLIGHT_LIVE_REGION_EXPECT)
      assert.match(acknowledged().text, new RegExp(process.env.THREADLIGHT_LIVE_REGION_EXPECT, 'i'))
    console.log('PASS: same Live session accepted a silent image and spoke:', acknowledged().text)
    await new Promise((r) => setTimeout(r, 1200))
  }
  if (process.env.THREADLIGHT_LIVE_TEST_WAV) {
    if (windowProof) focused = 'Marigold'
    const priorReads = service.current.items.filter(
      (i) => i.source?.tool === 'threadlight_read_thread',
    ).length
    if (readProof) {
      assert.ok(priorReads > 0, 'Opening must perform a real read')
      assert.equal(
        (await target.send('Reply exactly: synthetic colour cyan. Do not use tools.')).ok,
        true,
      )
      await waitReady(target)
    }
    const previousReplies = new Set(service.current.items.map((i) => i.id))
    const receivedAudioEnergy = () =>
      page.evaluate(async () => {
        const reports = [...(await window.connection.peer.getStats()).values()]
        return reports
          .filter((r) => r.type === 'inbound-rtp' && r.kind === 'audio')
          .reduce((sum, r) => sum + (r.totalAudioEnergy ?? 0), 0)
      })
    const beforeAudio = await receivedAudioEnergy()
    const followupExpected = new RegExp(
      windowProof
        ? 'marigold'
        : readProof
          ? 'cyan'
          : process.env.THREADLIGHT_LIVE_FOLLOWUP_EXPECT || '.+',
      'i',
    )
    const followupAnswer = () =>
      service.current.items.some(
        (i) =>
          i.kind === 'agent' &&
          i.liveComplete &&
          i.id?.startsWith('live:') &&
          !previousReplies.has(i.id) &&
          followupExpected.test(i.text.trim()),
      )
    const wave = [...readFileSync(process.env.THREADLIGHT_LIVE_TEST_WAV)]
    await page.evaluate(async (bytes) => {
      const buffer = await window.context.decodeAudioData(new Uint8Array(bytes).buffer)
      const speech = window.context.createBufferSource()
      speech.buffer = buffer
      speech.connect(window.testProcessor)
      speech.start()
    }, wave)
    const followupDeadline =
      Date.now() + (readProof || windowProof || coachDescriptor ? 120000 : 45000)
    while (
      (service.current.items.filter((i) => i.kind === 'you').length < 2 || !followupAnswer()) &&
      Date.now() < followupDeadline
    )
      await new Promise((r) => setTimeout(r, 250))
    assert.ok(
      service.current.items.filter((i) => i.kind === 'you').length >= 2,
      'Expected native microphone-input transcript',
    )
    assert.ok(
      followupAnswer(),
      'Expected native spoken follow-up answer matching THREADLIGHT_LIVE_FOLLOWUP_EXPECT',
    )
    // The transcript can finish before playout updates the receiver's energy counters.
    const audioDeadline = Date.now() + 10000
    let afterAudio = await receivedAudioEnergy()
    while (afterAudio <= beforeAudio && Date.now() < audioDeadline) {
      await new Promise((r) => setTimeout(r, 250))
      afterAudio = await receivedAudioEnergy()
    }
    assert.ok(
      afterAudio > beforeAudio,
      `Expected new non-silent incoming audio during the follow-up (${beforeAudio} -> ${afterAudio})`,
    )
    if (process.env.THREADLIGHT_LIVE_CONTROLS === '1') {
      assert.ok(
        await page.evaluate(() => window.connection.active && !window.connection.audio.muted),
      )
      console.log(
        'PASS signed-in Live input mute, independent speaker mute, stopped reply playback and audible next-turn audio on the same peer.',
      )
    }
    if (readProof) {
      assert.ok(
        service.current.items.filter((i) => i.source?.tool === 'threadlight_read_thread').length >
          priorReads,
        'Follow-up must perform a new backend read',
      )
      writeFileSync(
        join(folder, 'thread-read-live.json'),
        JSON.stringify(service.current.items, null, 2),
      )
      console.log(
        `PASS: fresh read after changed target on a later spoken turn. Evidence: ${folder}`,
      )
    }
    if (coachProfileProof) {
      const file = join(folder, 'coach-profile.json')
      const deadline = Date.now() + 30000
      let profile
      do {
        profile = JSON.parse(readFileSync(file, 'utf8'))
        if (/five|5/i.test(profile.level)) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      assert.match(profile.level, /five|5/i)
      assert.equal(profile.teachingStyle, 'Ask one question at a time')
      console.log(
        'PASS signed-in voice selected the coach, read the personal course and saved the approved spoken level update.',
      )
    }
    console.log(
      'PASS: generated speech entered the same Live conversation and received a follow-up reply.',
    )
    if (windowProof) {
      assert.ok(windowReads.includes('Orchid') && windowReads.includes('Marigold'))
      console.log('PASS: signed-in Agent queried both successive foreground-app observations.')
    }
  }
  if (browserProof) {
    assert(
      browserReads.includes('inspect'),
      'Live must inspect media before discussing the paused video',
    )
    assert(
      browserReads.every((action) => ['list', 'inspect', 'release'].includes(action)),
      'discussion preserves playback',
    )
    console.log(
      'PASS signed-in Live inspected the paused video context through its backing Agent.',
      JSON.stringify(browserReads),
    )
  }
  const stats = await page.evaluate(async () =>
    [...(await window.connection.peer.getStats())]
      .map(([, v]) => v)
      .filter((v) => v.type === 'inbound-rtp')
      .map((v) => ({ bytes: v.bytesReceived, packets: v.packetsReceived })),
  )
  assert.ok(
    stats.some((s) => s.bytes > 0),
    'Expected incoming native audio packets',
  )
  if (announcementProof) {
    writeFileSync(
      join(folder, 'announcement-events.json'),
      JSON.stringify(
        {
          events: await page.evaluate(() => window.liveEvents),
          items: service.current.items,
          stats,
        },
        null,
        2,
      ),
    )
    console.log('Announcement evidence:', folder)
  }
  const id = service.current.conversationId
  if (wholeReview) {
    assert.ok(reviewPages.length > 1)
    let received = ''
    for (const page of reviewPages) {
      assert.equal(page.snapshot, reviewPages[0].snapshot)
      assert.equal(page.startOffset, received.length)
      received += page.text
    }
    assert.equal(received.length, reviewPages.at(-1).totalUnits)
    assert.match(received, /print\(missing_lantern\)/)
    const finding = service.current.items.find(
      (i) =>
        i.kind === 'agent' && i.liveComplete && i.id?.startsWith('live:') && expected.test(i.text),
    )
    assert.match(
      finding.text,
      /line (?:98|ninety[- ]eight)\b[\s\S]*(?:missing|name\s?error|defined)/i,
    )
    console.log(
      'PASS signed-in Live requested all ' +
        reviewPages.length +
        ' whole-file pages and identified the late undefined name.',
    )
  } else if (coachDescriptor)
    assert.ok(coachShown, 'Live Agent actually presented the editor step before narration')
  assert.equal(
    spokeBeforeHighlight,
    false,
    'The coaching explanation preceded the visible highlight',
  )
  if (ghostWalk) {
    const deadline = Date.now() + 45000
    while (!walkedSpeech.length && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(walkedSpeech.length, 1)
    assert.ok(
      await page.evaluate(async () =>
        [...(await window.connection.peer.getStats()).values()].some(
          (r) => r.type === 'inbound-rtp' && r.kind === 'audio' && r.totalAudioEnergy > 0,
        ),
      ),
    )
    const typed = Number(
      readFileSync(join(process.env.THREADLIGHT_COACH_TEST_DIR, 'ghost-typed'), 'utf8'),
    )
    const playback = await page.evaluate(
      (at) =>
        window.liveEvents.find((e) => e.at >= at && /output_audio_buffer.started/.test(e.type))?.at,
      typed,
    )
    if (playback) console.log('Typing to receiver playback start:', playback - typed, 'ms')
    console.log('PASS signed-in ghost walkthrough prepared notes and delivered audio after typing.')
  } else if (fileWalk) {
    const until = Date.now() + 150000
    while (!guideEvents.some((event) => event.status === 'completed') && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(
      walkedSpeech.length,
      7,
      'One section explanation and six subsequent lines finished speaking',
    )
    assert.equal(
      guideEvents.filter((event) => event.needsNotes && event.line === 77 && event.endLine === 79)
        .length,
      1,
    )
    assert.ok(guideEvents.some((event) => event.needsNotes && event.line === 84))
    assert.equal(guideEvents.find((event) => event.status === 'completed')?.line, 85)
    assert.ok(
      await page.evaluate(async () =>
        [...(await window.connection.peer.getStats()).values()].some(
          (r) => r.type === 'inbound-rtp' && r.kind === 'audio' && r.totalAudioEnergy > 0,
        ),
      ),
    )
    console.log(
      'PASS one spoken section after gutter release, then six automatic lines including a second page on the native connection.',
    )
  }
  if (guideProof) {
    const until = Date.now() + 120000
    while (
      (!guideEvents.some((e) => e.status === 'completed') ||
        !service.current.items.some(
          (i) => i.kind === 'agent' && i.liveComplete && /guide (?:is )?complete/i.test(i.text),
        )) &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 200))
    assert.ok(voiceProgress)
    assert.equal(guideSpeechCount, 3)
    assert.deepEqual(
      guideEvents.map((e) => e.status),
      ['shown', 'shown', 'paused', 'refresh_requested', 'shown', 'completed'],
    )
    assert.ok(
      service.current.items.some(
        (i) => i.kind === 'agent' && i.liveComplete && /guide (?:is )?complete/i.test(i.text),
      ),
    )
    console.log(
      'PASS signed-in spoken next, edit, clicked refresh with fresh context, and clicked finish with native acknowledgement.',
    )
  } else if (proposalProof && proposalWalk) {
    assert.ok(proposalVisible && coachShown && walkedLine?.highlighted && walkedLine.row === 1)
    assert.equal(
      (await coach.run(service.activeLiveSession, { action: 'proposal_status' })).token,
      walkedLine.token,
    )
    console.log('PASS spoken follow-up highlighted the pending proposal and kept it open.')
  } else if (proposalProof) {
    assert.ok(
      proposalVisible && coachShown && traceShown,
      'Visible proposal, synchronized speech and spoken follow-up Trace',
    )
    console.log('PASS signed-in spoken selection-free proposal, narration and follow-up Trace.')
  } else if (coachDescriptor && process.env.THREADLIGHT_LIVE_TEST_WAV) {
    if (process.env.THREADLIGHT_LIVE_INLINE === '1')
      assert.ok(
        coachInline,
        'The spoken inline request presented a replacement in the original editor',
      )
    else assert.ok(coachDiff, 'The spoken preview request opened an actual editor diff')
  }
  await page.evaluate(() => {
    window.connection.stop()
    void window.context.close()
  })
  await service.stopLive()
  assert.equal(service.current.ended, false, 'Closing voice retains the Agent conversation')
  assert.equal(service.current.conversationId, id)
  const history = await service.read(id)
  if (!announcementProof)
    assert.ok(
      history.items.some(
        (i) =>
          i.kind === 'you' &&
          (process.env.THREADLIGHT_LIVE_INITIAL_WAV
            ? (questionProof ? /red.*blue/is : wholeReview ? /whole file/i : expected).test(i.text)
            : i.text === message),
      ),
    )
  assert.ok(history.items.some((i) => i.kind === 'agent' && i.text.trim()))
  assert.notEqual(service.store.get(id).archiveState, 'archived')
  await service.close()
  assert.equal(service.store.get(id).archiveState, 'archived')
  if (process.env.THREADLIGHT_LIVE_INITIAL_WAV) {
    writeFileSync(
      join(folder, bufferedOpening ? 'buffered-opening.json' : 'native-opening.json'),
      JSON.stringify(
        {
          pass: true,
          bufferedOpening,
          bufferedSeconds: await page.evaluate(() => window.startupBufferedSeconds ?? 0),
          history: history.items,
          stats,
        },
        null,
        2,
      ),
    )
    console.log(
      `PASS: native first spoken turn without a locally transcribed opening. Evidence: ${folder}`,
    )
  }
  console.log(
    announcementProof
      ? 'PASS: production journal, scoped feed, pause scheduler, native speech, matching completed transcript and observed playback; retained conversation on mic close.'
      : 'PASS: ChatGPT-authenticated WebRTC, opening sent once, native reply transcript and audio packets, voice history, retained conversation on mic close and archive on End.',
  )
})()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    coach?.close()
    if ((announcementProof || questionProof) && page) {
      const events = await page.evaluate(() => window.liveEvents).catch(() => [])
      writeFileSync(
        join(folder, 'announcement-diagnostic.json'),
        JSON.stringify(
          {
            events,
            items: service?.current.items,
            cards: eventStore.list('conversation'),
            scheduler: await page
              .evaluate(() => {
                const s = window.connection?.announcements
                return (
                  s && {
                    ready: s.ready,
                    dirty: s.dirty,
                    boundarySeen: s.boundarySeen,
                    user: [...s.user],
                    assistant: [...s.assistant],
                    lastInput: s.lastInput,
                    lastOutput: s.lastOutput,
                  }
                )
              })
              .catch(() => null),
          },
          null,
          2,
        ),
      )
      console.log('Live diagnostics:', folder)
    }
    await service?.close()
    await target?.close()
    readServer?.close()
    controlServer?.close()
    await browser?.close()
    eventDb.close()
  })
