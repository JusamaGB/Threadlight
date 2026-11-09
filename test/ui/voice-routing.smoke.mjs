import { openHeaderPage } from './header-navigation.mjs'
/* global window, document, AudioContext */
import assert from 'node:assert/strict'
import { checkVoiceTarget } from './voice-target.smoke.mjs'

/** Uses the provider smoke test's generated audio stream; never opens a real microphone. */
export async function checkVoiceRouting(page) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      voiceMode: 'local-stt',
      voiceTarget: 'agent',
      talkMode: 'toggle',
    }),
  )
  await page.evaluate(() => {
    // Calibrate against processed quiet audio, rather than a wall-clock delay that can
    // expire before Chromium delivers its first audio buffers on a busy machine.
    const createProcessor = AudioContext.prototype.createScriptProcessor
    window.proof.createProcessor = createProcessor
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const processor = createProcessor.apply(this, args)
      window.proof.audioProcessor = processor
      window.proof.quietAudioMs = 0
      window.proof.voicedAudioMs = 0
      processor.addEventListener('audioprocess', (event) => {
        if (window.proof.audioProcessor !== processor) return
        const frame = event.inputBuffer.getChannelData(0)
        if (frame.every((sample) => Math.abs(sample) < 0.001))
          window.proof.quietAudioMs += (frame.length / this.sampleRate) * 1000
        else window.proof.voicedAudioMs += (frame.length / this.sampleRate) * 1000
      })
      return processor
    }
    window.proof.nativePeer = window.RTCPeerConnection
    window.proof.livePeers = []
    window.RTCPeerConnection = class {
      connectionState = 'new'
      channel = { readyState: 'connecting' }
      constructor() {
        window.proof.livePeers.push(this)
      }
      addTrack(_track, stream) {
        this.stream = stream
        this.context = new AudioContext()
        this.analyser = this.context.createAnalyser()
        this.context.createMediaStreamSource(stream).connect(this.analyser)
      }
      createDataChannel() {
        return this.channel
      }
      async createOffer() {
        return { type: 'offer', sdp: 'v=0\r\nsynthetic' }
      }
      async setLocalDescription(value) {
        this.localDescription = value
      }
      async setRemoteDescription() {
        this.connectionState = 'connected'
        this.channel.readyState = 'open'
        this.channel.onmessage?.({ data: JSON.stringify({ type: 'session.started' }) })
      }
      close() {
        this.connectionState = 'closed'
        void this.context?.close()
      }
    }
    window.threadlight.agentLiveStart = async (id) => {
      window.proof.calls.push(['liveStart', id])
      if (window.proof.liveFailure) return { ok: false, reason: window.proof.liveFailure }
      if (window.proof.holdLive)
        await new Promise((resolve) => {
          window.proof.connectLive = resolve
        })
      return { ok: true, sdp: 'v=0\r\nanswer' }
    }
    window.threadlight.agentLiveOpen = async (id, text) => {
      window.proof.calls.push(['liveOpen', id, text])
      window.proof.livePeers.at(-1).channel.onmessage?.({
        data: JSON.stringify({ type: 'turn.created' }),
      })
      return { ok: true }
    }
    window.threadlight.agentLiveStop = (id) => window.proof.calls.push(['liveStop', id])
  })
  const agentSends = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentSend'))
  const open = async () => {
    await page.evaluate(() => {
      window.proof.quietAudioMs = 0
      window.proof.emit('onTalkToggle')
    })
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
    await page.waitForFunction(() => window.proof.quietAudioMs >= 650)
  }
  const close = async () => {
    await page.evaluate(() => window.proof.emit('onTalkToggle'))
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  }
  const say = async (text, level = 0.18) => {
    await page.evaluate((volume) => {
      delete window.proof.finishTranscript
      window.proof.voicedAudioMs = 0
      window.proof.setAudioLevel(volume)
    }, level)
    // Start the utterance duration after the real audio callback has detected the tone.
    // Browser/GPU startup can otherwise consume most of a short synthetic utterance.
    await page.waitForFunction(() => document.documentElement.dataset.openMic === 'hearing')
    await page.waitForFunction(() => window.proof.voicedAudioMs >= 350)
    await page.evaluate(() => window.proof.setAudioLevel(0))
    await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
    await page.evaluate((words) => window.proof.finishTranscript(words), text)
    await page.waitForFunction(() =>
      ['listening', 'off'].includes(document.documentElement.dataset.openMic),
    )
  }

  const before = (await agentSends()).length
  await open()
  await say('Open.', 0.049) // quiet speech must reach transcription, not just loud test tones
  await page.locator('[data-mic-mode="commands"]').waitFor()
  await page.locator('[data-card][data-pinned]').waitFor()
  await say('Please check the build')
  await page
    .getByText(
      'No thread matched “Please check the build”. Say the title shown in the list, or click the thread.',
      { exact: true },
    )
    .waitFor()
  await say('agent')
  assert.equal((await agentSends()).length, before)

  const codexRow = page.locator(
    '[data-session-id="codex:11111111-1111-4111-8111-111111111111"] button[aria-expanded]',
  )
  await say('Synthetic Codex')
  assert.equal(await page.getByText(/^No thread matched/).count(), 0)
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal(await codexRow.evaluate((node) => node === document.activeElement), true)
  await say('open Synthetic Codex')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal((await agentSends()).length, before)

  // Composer dictation stays dictation even while command mode is latched.
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Talk', exact: true })
    .click()
  await page.evaluate(() => {
    delete window.proof.finishTranscript
  })
  await page.waitForTimeout(300)
  await page
    .getByRole('group', { name: 'Codex message composer' })
    .getByRole('button', { name: 'Stop and transcribe', exact: true })
    .click()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('Composer words'))
  await page.waitForFunction(() =>
    document
      .querySelector('textarea[placeholder="Type a message…"]')
      ?.value.includes('Composer words'),
  )
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal((await agentSends()).length, before)
  await close()

  // A single utterance also chooses commands from a fresh session.
  await page.evaluate(() => window.proof.patch({ title: 'Review Threadlight' }))
  await codexRow.getByText('Review Threadlight', { exact: true }).waitFor()
  // A misheard first title must not choose the Agent, even with its view already open.
  for (const fromAgent of [false, true]) {
    if (fromAgent) await openHeaderPage(page, 'Agent')
    await open()
    await say('Open review thread lines.')
    await page.locator('[data-mic-mode="commands"]').waitFor()
    await page
      .getByText(
        'No thread matched “Open review thread lines.”. Say the title shown in the list, or click the thread.',
        { exact: true },
      )
      .waitFor()
    assert.equal(await codexRow.isVisible(), true)
    assert.equal((await agentSends()).length, before)
    await say('Open review thread light.')
    assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
    assert.equal((await agentSends()).length, before)
    await close()
  }
  await open()
  await say('Open review thread light.')
  await page.locator('[data-mic-mode="commands"]').waitFor()
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal((await agentSends()).length, before)
  await codexRow.click()
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'false')
  await say('review thread light')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  await close()
  await page.evaluate(() => window.proof.patch({ title: 'Synthetic Codex' }))

  // Names from both providers can be ambiguous; disambiguation never sends a message.
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await open()
  await say('Open Synthetic')
  await page.getByText(/^Several threads match:/).waitFor()
  await page.locator('[data-mic-mode="commands"]').waitFor()
  await say('Synthetic Claude')
  const claudeRow = page.locator('[data-session-id="synthetic-claude"] button[aria-expanded]')
  assert.equal(await claudeRow.getAttribute('aria-expanded'), 'true')
  await say('Synthetic Codex')
  assert.equal(await codexRow.getAttribute('aria-expanded'), 'true')
  assert.equal(await claudeRow.getAttribute('aria-expanded'), 'false')
  assert.equal(await page.getByText(/^Several threads match:/).count(), 0)
  assert.equal((await agentSends()).length, before)
  await close()
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['codex'] }))

  await page.evaluate(() => window.threadlight.updateSettings({ agentProvider: 'codex' }))

  // Codex with Local STT must still send text, without opening any native peer.
  await page.evaluate(() =>
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null }),
  )
  const peersBefore = await page.evaluate(() => window.proof.livePeers.length)
  await open()
  await say('Please review the plan locally.')
  await page.waitForFunction(() =>
    window.proof.calls.some(
      (c) => c[0] === 'agentSend' && c[1] === 'Please review the plan locally.',
    ),
  )
  await page.locator('[data-mic-mode="agent"]').waitFor()
  assert.equal(await page.evaluate(() => window.proof.livePeers.length), peersBefore)
  await close()

  // GPT Live ignores the local destination/hold preference and needs no STT model.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      voiceMode: 'gpt-live',
      voiceTarget: 'thread',
      talkMode: 'hold',
    })
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null })
    window.proof.emit('onStt', { state: 'missing' })
    delete window.proof.finishTranscript
    window.proof.holdLive = true
    delete window.proof.connectLive
  })
  await openHeaderPage(page, 'Agent')
  const draft = page.getByRole('textbox', { name: 'Message to Agent' })
  if (!(await draft.isVisible())) await page.getByRole('button', { name: 'Reply to Agent' }).click()
  await draft.fill('Keep this draft through the call')
  await page.evaluate(() => window.proof.agent({ conversationId: 'codex:voice-proof' }))
  const sendsBeforeLive = (await agentSends()).length
  await open()
  await page.getByText('Connecting…', { exact: true }).waitFor()
  await page.waitForFunction(() => typeof window.proof.connectLive === 'function')
  // Speak while setup is blocked, then stop before releasing the connection.
  await page.evaluate(() => {
    window.proof.voicedAudioMs = 0
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForFunction(() => window.proof.voicedAudioMs >= 500)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => {
    const analyser = window.proof.livePeers.at(-1).analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.every((value) => Math.abs(value) < 0.001)
  })
  await page.evaluate(() => {
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page.getByText('Connecting…', { exact: true }).waitFor({ state: 'detached' })
  await page.waitForFunction(() => {
    const analyser = window.proof.livePeers.at(-1).analyser
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)
    return samples.some((value) => Math.abs(value) > 0.01)
  })
  await page.evaluate(() => window.proof.setAudioLevel(0))
  assert.equal(await page.evaluate(() => typeof window.proof.finishTranscript), 'undefined')
  assert.equal((await agentSends()).length, sendsBeforeLive)
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'liveOpen').length),
    0,
  )
  const beforeCaptions = await page.evaluate(() => window.threadlight.getAgent())
  await openHeaderPage(page, 'Agent')
  await page.evaluate(() => window.proof.agent({ live: 'active' }))
  const wire = (event) =>
    page.evaluate(
      (e) => window.proof.livePeers.at(-1).channel.onmessage({ data: JSON.stringify(e) }),
      event,
    )
  await wire({
    type: 'turn.created',
    turn: { id: 'input-proof', role: 'user', transcript: 'Please' },
  })
  const draftRow = page.locator('[data-message-id="live:preview-input-proof"]')
  await draftRow.getByText('Please', { exact: true }).waitFor()
  await wire({ type: 'turn.delta', turn_id: 'input-proof', delta: ' repeat those colors.' })
  await draftRow.getByText('Please repeat those colors.', { exact: true }).waitFor()
  await wire({
    type: 'turn.done',
    turn: { id: 'input-proof', role: 'user', transcript: 'Please repeat those colours.' },
  })
  await draftRow.getByText('Please repeat those colours.', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.proof.agent({
      items: [
        {
          id: 'live:authoritative',
          kind: 'you',
          liveComplete: true,
          text: 'Please repeat those colours.',
        },
      ],
    }),
  )
  await draftRow.waitFor({ state: 'detached' })
  assert.equal(await page.getByText('Please repeat those colours.', { exact: true }).count(), 1)
  await wire({
    type: 'turn.created',
    turn: { id: 'second-input', role: 'user', transcript: 'Please' },
  })
  await wire({ type: 'turn.delta', turn_id: 'input-proof', delta: ' stale words' })
  await wire({ type: 'turn.delta', turn_id: 'assistant-turn', delta: ' assistant words' })
  const nextDraft = page.locator('[data-message-id="live:preview-second-input"]')
  await nextDraft.getByText('Please', { exact: true }).waitFor()
  assert.equal(await page.getByText(/stale words|assistant words/).count(), 0)
  await wire({ type: 'turn.done', turn: { id: 'second-input', role: 'user', transcript: '' } })
  await nextDraft.waitFor({ state: 'detached' })
  assert.equal((await agentSends()).length, sendsBeforeLive)
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ spokenReplyCompanion: true })
    const source = {
      kind: 'agent',
      id: 'caption-source',
      backingTurnId: 'turn',
      text: 'Unspoken explanation\n\n```python\nprint(42)\n```',
    }
    const link = { sessionId: 'test-call', turnId: 'turn', itemId: source.id }
    window.proof.agent({
      live: 'active',
      items: [
        source,
        {
          kind: 'agent',
          id: 'live:lead',
          text: 'Start here.',
          narrationOf: { ...link, excerpt: 'Start here.' },
        },
        {
          kind: 'agent',
          id: 'live:tail',
          text: 'Run this.',
          narrationOf: { ...link, tailAfter: 'Start here.' },
        },
      ],
    })
  })
  await page.waitForFunction(() => window.proof.spokenReply?.text === 'Start here. Run this.')
  const spoken = await page.evaluate(() => window.proof.spokenReply)
  assert.equal(spoken.blocks[0].value, 'print(42)')
  assert.ok(!JSON.stringify(spoken).includes('Unspoken explanation'))
  // Real receipt regression: the caption existed before its fenced backing item was available.
  await page.evaluate(() => {
    const user = {
      kind: 'you',
      id: 'live:receipt-request',
      text: 'Show me the Python',
      voiceDelegationIds: [],
    }
    const request = {
      kind: 'you',
      id: 'receipt-envelope',
      backingTurnId: 'receipt-turn',
      text: 'Show me the Python',
    }
    const caption = {
      kind: 'agent',
      id: 'live:receipt-caption',
      liveAfter: 'receipt-answer',
      liveComplete: true,
      text: 'Here it is: order contains names like "apple". The loop puts each name into entry, then inv[entry] looks up its price.',
    }
    window.proof.receiptItems = [user, request, caption]
    window.proof.agent({ coachGuideToken: 'receipt-guide', items: window.proof.receiptItems })
  })
  await page.waitForFunction(() => window.proof.spokenReply?.id === 'live:receipt-caption')
  assert.equal(await page.evaluate(() => window.proof.spokenReply.blocks.length), 0)
  await page.evaluate(() => {
    const [user, request, caption] = window.proof.receiptItems
    const py = 'for entry in order:\n    print(entry, inv[entry])'
    const fence = String.fromCharCode(96).repeat(3)
    const answer = {
      kind: 'agent',
      id: 'receipt-answer',
      backingTurnId: 'receipt-turn',
      timingSession: 'test-call',
      text:
        'Here it is:\n\n' +
        fence +
        'python\n' +
        py +
        '\n' +
        fence +
        '\n\norder contains names like "apple". The loop puts each name into entry, then inv[entry] looks up its price.',
    }
    window.proof.receiptItems = [user, request, answer, caption]
    window.proof.agent({ items: window.proof.receiptItems })
  })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
      ),
  )
  assert.equal(await page.evaluate(() => window.proof.spokenReply.blocks.length), 0)
  await page.evaluate(() => {
    const [user, ...rest] = window.proof.receiptItems
    window.proof.receiptItems = [{ ...user, voiceDelegationIds: ['receipt-envelope'] }, ...rest]
    window.proof.agent({ items: window.proof.receiptItems })
  })
  await page.waitForFunction(() =>
    window.proof.spokenReply.blocks[0]?.value.includes('print(entry, inv[entry])'),
  )
  const displayed = await page.evaluate(() => window.proof.spokenReply)
  await page.evaluate(() => {
    window.proof.receiptItems.push({
      kind: 'agent',
      id: 'live:extra-speech',
      liveAfter: 'live:receipt-caption',
      text: 'total = 0.0 for name, info in items dot items(): total += info["quantity"] * info["price"]',
    })
    window.proof.agent({ items: [...window.proof.receiptItems] })
  })
  await page.waitForFunction(() => window.proof.spokenReply?.id === 'live:extra-speech')
  const retained = await page.evaluate(() => window.proof.spokenReply)
  assert.equal(retained.exampleId, displayed.exampleId)
  assert.deepEqual(retained.blocks, displayed.blocks)
  assert.ok(!retained.text.includes('total'))
  await page.evaluate(() => {
    window.proof.receiptItems.push({
      kind: 'you',
      id: 'live:replay-this',
      text: 'Could you show me that again?',
    })
    window.proof.agent({ items: [...window.proof.receiptItems] })
  })
  await page.waitForFunction(() => window.proof.spokenReply?.userItemId === 'live:replay-this')
  assert.deepEqual(await page.evaluate(() => window.proof.spokenReply.blocks), displayed.blocks)
  await page.evaluate(() => {
    const answer = {
      kind: 'agent',
      id: 'receipt-followup',
      timingSession: 'test-call',
      backingTurnId: 'followup-turn',
      text:
        'The print expression ' +
        String.fromCharCode(96) +
        'print(entry, inv[entry])' +
        String.fromCharCode(96) +
        ' is correct.',
    }
    const caption = {
      kind: 'agent',
      id: 'live:followup',
      text: 'The print expression is correct.',
      liveComplete: true,
      narrationOf: { sessionId: 'test-call', turnId: 'followup-turn', itemId: answer.id },
    }
    window.proof.followupItems = [...window.proof.receiptItems, answer, caption]
    window.proof.agent({ items: [...window.proof.receiptItems, caption] })
  })
  await page.waitForFunction(
    () =>
      window.proof.spokenReply?.id.includes('receipt-followup') &&
      window.proof.spokenReply.blocks[0]?.value.includes('print(entry, inv[entry])'),
  )
  await page.evaluate(() => {
    window.proof.agent({ items: window.proof.followupItems })
  })
  await page.waitForFunction(
    () =>
      window.proof.spokenReply?.text === 'The print expression is correct.' &&
      window.proof.spokenReply.blocks.length === 1,
  )
  await page.evaluate(() => window.proof.agent({ coachGuideToken: 'invalidated-receipt-guide' }))
  await page.waitForFunction(
    () =>
      window.proof.spokenReply?.text === 'The print expression is correct.' &&
      window.proof.spokenReply.blocks.length === 0,
  )
  await page.evaluate(async (state) => {
    await window.threadlight.updateSettings({ spokenReplyCompanion: false })
    window.proof.agent({ live: state.live, items: state.items })
  }, beforeCaptions)
  await page.waitForFunction(() => window.proof.spokenReply === null)
  const controls = page.getByRole('group', { name: 'Live call controls' })
  const leaveCount = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'leavePanel').length)
  const reopenWave = () =>
    page.evaluate(() =>
      window.proof.emit('onPanelOpened', {
        maxHeight: 800,
        opensDown: true,
        fresh: false,
        fromMic: true,
      }),
    )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Return to call' }).count(), 0)
  assert.equal(await controls.count(), 0)
  await page.evaluate(() =>
    window.proof.agent({
      recent: {
        id: 'codex:voice-proof',
        provider: 'codex',
        at: Date.now(),
        waiting: true,
        summary: 'Current call',
      },
    }),
  )
  await page.getByRole('button', { name: 'Agent is waiting for your answer' }).click()
  await controls.waitFor()
  assert.equal(await draft.inputValue(), 'Keep this draft through the call')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const pinnedPanel = page.locator('[data-card][data-pinned]')
  if (await pinnedPanel.count()) {
    const pinnedLeaves = await leaveCount()
    await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
    assert.equal(await leaveCount(), pinnedLeaves, 'explicit pin still holds the call panel')
    await page.locator('header[aria-label="Panel header"]').dispatchEvent('click', { detail: 2 })
    await pinnedPanel.waitFor({ state: 'detached' })
  }
  const leaves = await leaveCount()
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaveCount(), leaves + 1, 'leaving another page can collapse an active call')
  await reopenWave()
  await controls.waitFor()
  assert.equal(await draft.inputValue(), 'Keep this draft through the call')
  assert.equal(
    await page.evaluate(() => window.proof.livePeers.at(-1).connectionState),
    'connected',
  )
  await draft.focus()
  const held = await leaveCount()
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaveCount(), held, 'focused composer holds the live panel')
  const bounds = await controls.boundingBox()
  const buttons = await controls
    .locator('button')
    .evaluateAll((nodes) => nodes.map((el) => el.getBoundingClientRect().toJSON()))
  assert.equal(buttons.length, 5)
  assert.equal(await controls.locator('button').last().getAttribute('aria-label'), 'Reply to Agent')
  assert.ok(
    buttons.every((b) => b.width >= 23 && b.height >= 23 && Math.abs(b.y - buttons[0].y) <= 1),
  )
  const callReply = controls.getByRole('button', { name: 'Reply to Agent' })
  await callReply.press('Enter')
  await draft.waitFor({ state: 'hidden' })
  await callReply.press('Enter')
  assert.equal(await draft.inputValue(), 'Keep this draft through the call')
  assert.ok(
    Math.abs((buttons[0].left + buttons.at(-1).right) / 2 - (bounds.x + bounds.width / 2)) <= 1,
  )
  assert.ok(bounds.height <= 24)
  await controls.getByRole('button', { name: 'Mute microphone' }).click()
  await page.waitForFunction(() => window.proof.motion?.inputMuted)
  await controls.getByRole('button', { name: 'Mute speaker' }).click()
  await page.evaluate(() => window.proof.emit('onLiveMuteShortcut'))
  await controls.getByRole('button', { name: 'Mute microphone' }).waitFor()
  await controls.getByRole('button', { name: 'Unmute speaker' }).click()
  await controls.getByRole('button', { name: 'Stop speaking' }).click()
  assert.equal(
    await page.evaluate(() => window.proof.livePeers.at(-1).connectionState),
    'connected',
  )
  await page.evaluate(() => window.proof.agent({ status: 'working', requests: [] }))
  await page.waitForFunction(() => window.proof.motion?.agentWorking)
  await page.evaluate(() => window.proof.agent({ status: 'waiting', requests: [] }))
  await page.waitForFunction(() => !window.proof.motion?.agentWorking)
  await page.evaluate(() => window.proof.agent({ status: 'ready' }))
  // Enter a Smart Thread from the Agent while the same native Live peer stays connected.
  await page.evaluate(() =>
    window.proof.agent({ status: 'ready', live: 'active', pendingSpeechTurn: 'receipt-turn' }),
  )
  await page.getByText('Waiting for voice playback…', { exact: true }).waitFor()
  await page.waitForFunction(() => window.proof.motion?.agentWorking)
  await page.evaluate(() =>
    window.proof.agent({
      pendingSpeechTurn: null,
      chatActivity: { working: true, message: 'Starting the Codex chat in Threadlight…' },
    }),
  )
  await page.getByText('Starting the Codex chat in Threadlight…', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.proof.agent({
      chatActivity: {
        working: false,
        message: 'The Codex chat was linked to Threadlight using gpt-6.1-sol.',
      },
    }),
  )
  await page
    .getByText('The Codex chat was linked to Threadlight using gpt-6.1-sol.', { exact: true })
    .waitFor()
  await page.waitForFunction(() => !window.proof.motion?.agentWorking)
  await page.evaluate(() =>
    window.proof.agent({ live: null, chatActivity: undefined, pendingSpeechTurn: null }),
  )
  await page.evaluate(async () => {
    window.threadlight.threadTimeline = async ({ threadId }) => ({
      ok: true,
      timeline: {
        threadId,
        revision: 1,
        connection: 'live',
        hasMore: false,
        items: [],
        loadingOlder: false,
      },
    })
    await window.threadlight.updateSettings({ pinnedActiveThreads: true })
    window.proof.emit('onStt', { state: 'ready' })
    window.proof.setAudioLevel(0.18)
    window.proof.liveGain = window.proof.voiceSourceGain
  })
  await openHeaderPage(page, 'Agent')
  await page
    .getByRole('region', { name: 'Pinned Active threads' })
    .getByRole('button', { name: /Synthetic Codex/ })
    .click()
  const composer = page
    .getByRole('region', { name: 'Pinned Active threads' })
    .getByRole('group', { name: 'Codex message composer' })
    .last()
  await composer.getByRole('button', { name: 'Talk', exact: true }).click()
  const mutedWave = page
    .getByRole('region', { name: 'Voice waveform' })
    .getByRole('img', { name: 'Live microphone muted' })
  await mutedWave.waitFor()
  assert.equal(await mutedWave.getAttribute('data-waveform-only'), 'true')
  await page.waitForFunction(() => window.proof.motion?.inputMuted === true)
  await composer.getByRole('img', { name: 'Listening...', exact: true }).waitFor()
  await page.waitForFunction(() => {
    const peer = window.proof.livePeers.at(-1),
      a = peer.analyser,
      samples = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(samples)
    return peer.connectionState === 'connected' && samples.every((v) => Math.abs(v) < 0.001)
  })
  await composer.getByRole('button', { name: 'Stop and transcribe' }).click()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await page.evaluate(() => window.proof.finishTranscript('Only the composer should hear this'))
  await mutedWave.waitFor({ state: 'detached' })
  await page.waitForFunction(() => !window.proof.motion?.inputMuted)
  await page.waitForFunction(() => {
    const peer = window.proof.livePeers.at(-1),
      a = peer.analyser,
      samples = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(samples)
    return peer.connectionState === 'connected' && samples.some((v) => Math.abs(v) > 0.01)
  })
  assert.ok(
    (await composer.getByRole('textbox').inputValue()).includes(
      'Only the composer should hear this',
    ),
  )
  await page.evaluate(async () => {
    window.proof.liveGain.gain.value = 0
    await window.threadlight.updateSettings({ pinnedActiveThreads: false })
  })
  await page.evaluate(() =>
    window.proof.agent({
      status: 'waiting',
      requests: [
        {
          id: 'decision',
          kind: 'approval',
          title: 'Review fixture',
          detail: 'Still pending',
          canAllow: true,
        },
      ],
    }),
  )
  if (!(await controls.isVisible())) await reopenWave()
  const pendingLeaves = await leaveCount()
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(
    await leaveCount(),
    pendingLeaves,
    'pending Agent decisions keep the panel available',
  )
  await controls.getByRole('button', { name: 'End call', exact: true }).click()
  const choices = page.getByRole('group', { name: 'Agent conversation controls' })
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  assert.equal(await choices.count(), 0, 'the list has no post-call controls')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await choices.count(), 0, 'Settings has no post-call controls')
  await openHeaderPage(page, 'Shared Spaces')
  assert.equal(await choices.count(), 0, 'Spaces has no post-call controls')
  await openHeaderPage(page, 'Agent')
  await choices.waitFor()
  assert.ok(
    await choices.getByRole('button', { name: 'Close conversation', exact: true }).isDisabled(),
  )
  assert.ok(await choices.getByRole('button', { name: 'Start fresh' }).isDisabled())
  assert.equal(await draft.inputValue(), 'Keep this draft through the call')
  assert.equal(await page.getByRole('button', { name: 'Keep chat' }).count(), 0)
  await page.evaluate(() => window.proof.agent({ status: 'ready', requests: [] }))
  await page.evaluate(() => window.threadlight.updateSettings({ voiceMode: 'local-stt' }))
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')

  // No fallback or delayed connection after switching away during setup.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    window.proof.holdLive = true
    delete window.proof.connectLive
    window.proof.emit('onTalkToggle')
  })
  await page.waitForFunction(() => typeof window.proof.connectLive === 'function')
  await page.getByText('Connecting…', { exact: true }).waitFor()
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'local-stt' })
    window.proof.holdLive = false
    window.proof.connectLive()
  })
  await page.waitForFunction(() => window.proof.livePeers.at(-1).connectionState === 'closed')
  assert.equal((await agentSends()).length, sendsBeforeLive)

  // Runtime startup must not wait for the operating system to grant the microphone.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.proof.savedBufferedAcquire = acquire
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (options) => {
        await new Promise((resolve) => {
          window.proof.allowBufferedMic = resolve
        })
        return acquire(options)
      },
    })
    window.proof.holdLive = true
    delete window.proof.connectLive
    window.proof.emit('onTalkToggle')
  })
  await page.waitForFunction(
    () =>
      typeof window.proof.connectLive === 'function' &&
      typeof window.proof.allowBufferedMic === 'function',
  )
  await page.getByText('Connecting…', { exact: true }).waitFor()
  const stoppedBeforeLateMic = await page.evaluate(() => window.proof.stoppedTracks)
  await page.getByRole('button', { name: 'Cancel call setup', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'local-stt' })
    window.proof.holdLive = false
    window.proof.connectLive()
    window.proof.allowBufferedMic()
  })
  await page.waitForFunction((n) => window.proof.stoppedTracks > n, stoppedBeforeLateMic)
  assert.equal(await page.evaluate(() => window.proof.livePeers.at(-1).connectionState), 'closed')
  await page.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: window.proof.savedBufferedAcquire,
    }),
  )

  await page.evaluate(() => {
    window.threadlight.finishCallChat = async (id, choice) => {
      window.proof.calls.push(['post-call', id, choice])
      window.proof.agent({ ended: true, status: 'idle', live: null })
      return { ok: true }
    }
  })
  if (!(await choices.isVisible())) await openHeaderPage(page, 'Agent')
  await choices.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await choices
    .getByRole('button', { name: 'Close conversation', exact: true })
    .waitFor({ state: 'detached' })
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'post-call').at(-1)),
    ['post-call', 'codex:voice-proof', 'archive'],
  )
  const beforePreparation = await page.evaluate(() => {
    const previous = window.threadlight.getAgent
    window.threadlight.getAgent = () =>
      new Promise((resolve) => {
        window.proof.releaseProviderLookup = async () => {
          window.threadlight.getAgent = previous
          resolve(await previous())
        }
      })
    window.proof.emit('onTalkToggle', { liveSessionId: 'synthetic-cancelled-lookup' })
    return window.proof.livePeers.length
  })
  await page.waitForFunction(() => typeof window.proof.releaseProviderLookup === 'function')
  await page.getByRole('button', { name: 'Cancel call setup', exact: true }).click()
  await page.evaluate(() => window.proof.releaseProviderLookup())
  await choices
    .getByRole('button', { name: 'Close conversation', exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.proof.livePeers.length), beforePreparation)
  assert.equal(await page.getByRole('button', { name: 'Keep chat' }).count(), 0)
  // A native failure stays a native failure and releases the microphone.
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ voiceMode: 'gpt-live' })
    window.proof.liveFailure = 'Synthetic Live unavailable'
    window.proof.emit('onTalkToggle')
  })
  await page
    .getByLabel('Live voice error')
    .getByText('Synthetic Live unavailable', { exact: true })
    .waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  assert.equal((await agentSends()).length, sendsBeforeLive)
  await page.evaluate(async () => {
    window.proof.liveFailure = null
    window.proof.agent({ provider: 'claude', status: 'ready', ended: false, live: null })
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    )
    window.proof.emit('onTalkToggle')
  })
  await page
    .getByText(
      'GPT Live requires a Codex Agent conversation. Choose Codex in Agent settings; end an existing Claude conversation first.',
      { exact: true },
    )
    .first()
    .waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.openMic), 'off')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      voiceMode: 'local-stt',
      voiceTarget: 'agent',
      talkMode: 'toggle',
    })
    window.proof.emit('onStt', { state: 'ready' })
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    )
  })
  // Closing while transcription is pending cannot leak a command or agent request.
  await open()
  await page.evaluate(() => {
    delete window.proof.finishTranscript
    window.proof.voicedAudioMs = 0
    window.proof.setAudioLevel(0.18)
  })
  await page.waitForFunction(() => window.proof.voicedAudioMs >= 350)
  await page.evaluate(() => window.proof.setAudioLevel(0))
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  await close()
  const count = (await agentSends()).length
  await page.evaluate(() => window.proof.finishTranscript('Do not send this'))
  await page.waitForTimeout(150)
  assert.equal((await agentSends()).length, count)
  await page.evaluate(() => {
    // Keep the synthetic peer for target/activation coverage below.
  })
  await checkVoiceTarget(page)
  const liveSessionId = 'aaaa1111-bbbb-4ccc-8ddd-eeee11112222'
  await page.evaluate(async (id) => {
    await window.threadlight.updateSettings({
      agentProvider: 'codex',
      voiceMode: 'local-stt',
      talkMode: 'hold',
      voiceTarget: 'thread',
    })
    window.proof.agent({ provider: 'codex', status: 'ready', ended: false, live: null })
    window.proof.emit('onTalkToggle', { liveSessionId: id })
  }, liveSessionId)
  await page.waitForFunction(
    (id) => window.proof.calls.some((c) => c[0] === 'liveStart' && c[1] === id),
    liveSessionId,
  )
  await page.evaluate(() =>
    window.proof.emit('onTalkToggle', { liveSessionId: 'bbbb2222-cccc-4ddd-8eee-ffff11112222' }),
  )
  await page.waitForFunction(
    (id) => window.proof.calls.some((c) => c[0] === 'liveStop' && c[1] === id),
    liveSessionId,
  )
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).voiceMode),
    'local-stt',
  )
  const stoppedFromPill = 'cccc3333-dddd-4eee-8fff-aaaa11112222'
  await page.evaluate(
    (id) => window.proof.emit('onTalkToggle', { liveSessionId: id }),
    stoppedFromPill,
  )
  await page.waitForFunction(
    (id) => window.proof.calls.some((c) => c[0] === 'liveStart' && c[1] === id),
    stoppedFromPill,
  )
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'listening')
  await page.evaluate(() => window.proof.emit('onStopOpenMic'))
  await page.waitForFunction(
    (id) => window.proof.calls.some((c) => c[0] === 'liveStop' && c[1] === id),
    stoppedFromPill,
  )
  await page.waitForFunction(() => document.documentElement.dataset.openMic === 'off')
  await page.evaluate(() => {
    window.RTCPeerConnection = window.proof.nativePeer
    AudioContext.prototype.createScriptProcessor = window.proof.createProcessor
  })
  await page.evaluate(() => window.proof.agent({ status: 'idle', provider: null, items: [] }))
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
}
