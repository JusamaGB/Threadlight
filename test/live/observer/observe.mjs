/* global window, document, location, RTCPeerConnection */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(
  process.env.THREADLIGHT_E2E_REPO || fileURLToPath(new URL('../../../', import.meta.url)),
)
const root = path.resolve(
  process.env.THREADLIGHT_E2E_DIR || path.join(repo, '..', 'threadlight-e2e'),
)
const panelUrl = pathToFileURL(path.join(repo, 'out/renderer/index.html')).href
const command = process.argv[2] || 'run'
const pointer = path.join(root, 'latest.json')
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
if (command !== 'run') {
  const latest = read(pointer)
  if (command === 'status')
    console.log(fs.readFileSync(path.join(latest.folder, 'status.json'), 'utf8'))
  else if (command === 'stop')
    fs.writeFileSync(path.join(latest.folder, 'stop'), new Date().toISOString())
  else if (command === 'mark')
    fs.appendFileSync(
      path.join(latest.folder, 'marks.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), text: process.argv.slice(3).join(' ') }) +
        '\n',
    )
  else throw new Error('Use run, status, mark <text>, or stop')
  process.exit(0)
}
fs.mkdirSync(root, { recursive: true })
if (fs.existsSync(pointer)) {
  const previous = read(pointer)
  const previousStatus = path.join(previous.folder, 'status.json')
  if (fs.existsSync(previousStatus)) {
    const s = read(previousStatus)
    if (s.running && Date.now() - Date.parse(s.at) < 15000)
      throw new Error('An observer is already running')
  }
}
const started = new Date().toISOString()
const folder = path.join(root, 'runs', started.replace(/[:.]/g, '-'))
fs.mkdirSync(path.join(folder, 'shots'), { recursive: true })
fs.writeFileSync(pointer, JSON.stringify({ folder, started, pid: process.pid }, null, 2))
const redact = (value) => {
  if (typeof value === 'string')
    return value
      .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[\w-]{16,}/g, '[REDACTED]')
      .replace(/([?&](?:token|key|code|signature|sig)=)[^&\s]+/gi, '$1[REDACTED]')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(authorization|cookie|set-cookie|access_token|refresh_token|api_?key|password|secret|sdp)$/i.test(
          k,
        )
          ? '[REDACTED]'
          : redact(v),
      ]),
    )
  return value
}
let seq = 0,
  running = true,
  lastAgent = null,
  lastEvent = null
const clients = new Map(),
  native = new Map(),
  knownConversations = new Set()
const atomic = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(redact(value), null, 2))
  fs.renameSync(file + '.tmp', file)
}
function record(type, data, source = 'observer') {
  const event = redact({
    seq: ++seq,
    at: new Date().toISOString(),
    elapsedMs: Date.now() - Date.parse(started),
    source,
    type,
    data,
  })
  fs.appendFileSync(path.join(folder, 'events.jsonl'), JSON.stringify(event) + '\n')
  lastEvent = { seq: event.seq, at: event.at, type, source }
  return event
}
const appData = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'),
  'Threadlight',
)
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    return null
  }
}
const settings = () => {
  const s = read(path.join(appData, 'settings.json'))
  return Object.fromEntries(
    Object.entries(s).filter(([k]) => /^(agent|talk|voice|enabledProviders)/.test(k)),
  )
}
const buildFiles = [
  'out/main/index.js',
  'out/preload/index.js',
  ...fs.readdirSync(path.join(repo, 'out/renderer/assets')).map((n) => 'out/renderer/assets/' + n),
]
atomic(path.join(folder, 'session.json'), {
  started,
  pid: process.pid,
  timezone: 'Europe/London',
  endpoint: 'http://127.0.0.1:9333',
  repo,
  revision: git('rev-parse', 'HEAD'),
  workingTree: git('status', '--short'),
  settings: settings(),
  artifacts: buildFiles
    .filter((p) => fs.existsSync(path.join(repo, p)))
    .map((p) => ({
      path: p,
      mtime: fs.statSync(path.join(repo, p)).mtime.toISOString(),
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, p)))
        .digest('hex'),
    })),
  limits: [
    'No raw audio recording or audible quality judgement',
    'RTC event/stats observation covers connections created after attachment',
    'No main-process RPC wire tap; selected persisted transcript events supplement renderer state',
    'Screenshots show the renderer surface, not desktop visibility or focus',
    'Capture stops after four hours unless stopped earlier',
  ],
})

// Additive event listeners only. Never sends, approves, starts audio, or changes settings.
function installObserver() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', installObserver, { once: true })
    return { scheduled: true }
  }
  if (window.__tlE2EObserver) return { existing: true }
  const emit = (type, data) => {
    try {
      window.__tlE2E(JSON.stringify({ type, data, pageAt: new Date().toISOString() }))
    } catch {
      /* The page may be detaching; observation must not affect it. */
    }
  }
  const cleanup = [],
    peers = new Map()
  const api = window.threadlight
  if (!api) throw new Error('Threadlight preload API missing')
  for (const [name, type] of [
    ['onAgent', 'agent'],
    ['onAgentLive', 'live'],
    ['onTalkState', 'talk'],
    ['onOpenMicLive', 'mic'],
    ['onStt', 'stt'],
    ['onSettings', 'settings'],
  ]) {
    if (api[name])
      cleanup.push(
        api[name]((data) =>
          emit(
            type,
            type === 'settings'
              ? Object.fromEntries(
                  Object.entries(data).filter(([k]) =>
                    /^(agent|talk|voice|enabledProviders)/.test(k),
                  ),
                )
              : data,
          ),
        ),
      )
  }
  let lastMotion = 0
  if (api.onMotion)
    cleanup.push(
      api.onMotion((data) => {
        if (Date.now() - lastMotion > 500) {
          lastMotion = Date.now()
          emit('motion', data)
        }
      }),
    )
  for (const [method, type] of [
    ['getAgent', 'agent'],
    ['getStt', 'stt'],
    ['getOpenMicIndicator', 'mic-initial'],
    ['getMotion', 'motion'],
  ])
    api[method]?.()
      .then((v) => emit(type, v))
      .catch((e) => emit('observe-error', { method, message: e.message }))
  const channelSeen = new WeakSet()
  const observeChannel = (channel, peerId) => {
    if (channelSeen.has(channel)) return
    channelSeen.add(channel)
    emit('rtc-channel', { peerId, label: channel.label, state: channel.readyState })
    const message = (e) => {
      try {
        const data = JSON.parse(e.data)
        emit('rtc-message', { peerId, label: channel.label, event: data })
      } catch {
        emit('rtc-message-unparsed', {
          peerId,
          bytes: typeof e.data === 'string' ? e.data.length : null,
        })
      }
    }
    const state = () =>
      emit('rtc-channel', { peerId, label: channel.label, state: channel.readyState })
    channel.addEventListener('message', message)
    for (const event of ['open', 'close', 'error']) channel.addEventListener(event, state)
    cleanup.push(() => {
      channel.removeEventListener('message', message)
      for (const event of ['open', 'close', 'error']) channel.removeEventListener(event, state)
    })
  }
  const prototype = RTCPeerConnection.prototype
  const original = prototype.createDataChannel
  function observedCreate(...args) {
    const result = Reflect.apply(original, this, args)
    if (!peers.has(this)) {
      const id = crypto.randomUUID()
      peers.set(this, id)
      const state = () =>
        emit('rtc-state', {
          peerId: id,
          connection: this.connectionState,
          ice: this.iceConnectionState,
          signaling: this.signalingState,
        })
      for (const event of [
        'connectionstatechange',
        'iceconnectionstatechange',
        'signalingstatechange',
      ])
        this.addEventListener(event, state)
      const incoming = (e) => observeChannel(e.channel, id)
      this.addEventListener('datachannel', incoming)
      cleanup.push(() => {
        for (const event of [
          'connectionstatechange',
          'iceconnectionstatechange',
          'signalingstatechange',
        ])
          this.removeEventListener(event, state)
        this.removeEventListener('datachannel', incoming)
      })
      state()
    }
    observeChannel(result, peers.get(this))
    return result
  }
  prototype.createDataChannel = observedCreate
  cleanup.push(() => {
    if (prototype.createDataChannel === observedCreate) prototype.createDataChannel = original
  })
  let previousUi = '',
    statsBusy = false
  const sampleUi = () => {
    const data = {
      root: { ...document.documentElement.dataset },
      body: { ...document.body.dataset },
      text: document.body.innerText.slice(0, 45000),
      inputs: [...document.querySelectorAll('textarea,input:not([type=password])')]
        .filter((e) => e.getClientRects().length)
        .map((e) => ({
          tag: e.tagName,
          placeholder: e.getAttribute('placeholder'),
          value: e.value.slice(0, 10000),
          disabled: e.disabled,
        })),
      hidden: document.hidden,
      focused: document.hasFocus(),
    }
    const key = JSON.stringify(data)
    if (key !== previousUi) {
      previousUi = key
      emit('ui', data)
    }
  }
  const uiTimer = setInterval(sampleUi, 500)
  const statTimer = setInterval(async () => {
    if (statsBusy) return
    statsBusy = true
    try {
      for (const [peer, id] of peers) {
        if (peer.connectionState === 'closed') {
          peers.delete(peer)
          continue
        }
        const stats = await peer.getStats(),
          rows = []
        for (const row of stats.values()) {
          if (
            ![
              'inbound-rtp',
              'outbound-rtp',
              'media-source',
              'remote-inbound-rtp',
              'transport',
              'data-channel',
            ].includes(row.type)
          )
            continue
          rows.push(
            Object.fromEntries(
              Object.entries(row).filter(([k]) =>
                [
                  'id',
                  'type',
                  'timestamp',
                  'kind',
                  'mediaType',
                  'audioLevel',
                  'totalAudioEnergy',
                  'totalSamplesDuration',
                  'packetsSent',
                  'packetsReceived',
                  'bytesSent',
                  'bytesReceived',
                  'packetsLost',
                  'jitter',
                  'roundTripTime',
                  'state',
                  'dtlsState',
                  'messagesSent',
                  'messagesReceived',
                  'concealedSamples',
                  'silentConcealedSamples',
                  'totalSamplesReceived',
                ].includes(k),
              ),
            ),
          )
        }
        emit('rtc-stats', { peerId: id, rows })
      }
    } catch (e) {
      emit('observe-error', { message: e.message })
    } finally {
      statsBusy = false
    }
  }, 2000)
  cleanup.push(() => {
    clearInterval(uiTimer)
    clearInterval(statTimer)
  })
  sampleUi()
  window.__tlE2EObserver = {
    stop: () => {
      for (const fn of cleanup.reverse())
        try {
          fn()
        } catch {
          /* Continue cleaning up the remaining listeners. */
        }
      delete window.__tlE2EObserver
    },
    installedAt: new Date().toISOString(),
  }
  emit('installed', {
    rtcCoverage: 'new connections only',
    view: new URL(location.href).searchParams.get('view'),
  })
  return { installed: true }
}

class Client {
  constructor(target) {
    this.target = target
    this.pending = new Map()
    this.id = 0
    this.uiDirty = true
    this.lastShot = 0
    this.alive = false
    this.agent = null
  }
  async connect() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.alive = true
    this.ws.addEventListener('close', () => {
      this.alive = false
      record('detached', { id: this.target.id })
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer)
        reject(new Error('CDP disconnected'))
      }
      this.pending.clear()
    })
    this.ws.addEventListener('message', (e) => this.receive(JSON.parse(e.data)))
    await this.call('Runtime.enable')
    await this.call('Page.enable')
    await this.call('Runtime.addBinding', { name: '__tlE2E' })
    await this.call('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installObserver.toString()})()`,
    })
    const result = await this.call('Runtime.evaluate', {
      expression: `(${installObserver.toString()})()`,
      returnByValue: true,
    })
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description,
      )
    record('attached', {
      id: this.target.id,
      url: this.target.url,
      installed: result.result?.value,
    })
  }
  call(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('CDP timeout: ' + method))
      }, 7000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  receive(message) {
    if (message.id) {
      const p = this.pending.get(message.id)
      if (p) {
        this.pending.delete(message.id)
        clearTimeout(p.timer)
        if (message.error) p.reject(new Error(message.error.message))
        else p.resolve(message.result)
      }
      return
    }
    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__tlE2E') {
      const { type, data, pageAt } = JSON.parse(message.params.payload)
      if (type === 'agent') {
        this.agent = data
        lastAgent = data
        if (data.conversationId) knownConversations.add(data.conversationId)
        if (data.sessionId) trackNative(data.provider, data.sessionId)
        atomic(path.join(folder, 'agent-latest.json'), data)
      }
      if (['ui', 'agent', 'live'].includes(type)) this.uiDirty = true
      if (type === 'ui') atomic(path.join(folder, 'ui-latest.json'), data)
      record(
        type,
        { pageAt, ...(data && typeof data === 'object' ? data : { value: data }) },
        this.target.id,
      )
    } else if (message.method === 'Runtime.consoleAPICalled')
      record(
        'console',
        {
          level: message.params.type,
          args: message.params.args.map((x) => x.value ?? x.description),
        },
        this.target.id,
      )
    else if (message.method === 'Runtime.exceptionThrown')
      record('exception', message.params.exceptionDetails, this.target.id)
  }
  async screenshot() {
    if (!this.alive || !this.uiDirty || Date.now() - this.lastShot < 10000) return
    this.uiDirty = false
    this.lastShot = Date.now()
    try {
      const shot = await this.call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const name = `shots/${String(seq + 1).padStart(7, '0')}.png`
      fs.writeFileSync(path.join(folder, name), Buffer.from(shot.data, 'base64'))
      record(
        'screenshot',
        { file: name, note: 'Renderer surface; may be an occluded/hidden window' },
        this.target.id,
      )
    } catch (e) {
      record('screenshot-error', { message: e.message })
    }
  }
  async close() {
    if (!this.alive) return
    try {
      await this.call('Runtime.evaluate', { expression: 'window.__tlE2EObserver?.stop()' })
    } catch {
      /* The disconnected target cannot run its cleanup hook. */
    }
    this.ws.close()
  }
}
const nativeRoot = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
function findFile(dir, id, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null
  let files
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  for (const f of files) {
    if (f.isFile() && f.name.endsWith(id + '.jsonl')) return path.join(dir, f.name)
    if (f.isDirectory()) {
      const found = findFile(path.join(dir, f.name), id, depth + 1)
      if (found) return found
    }
  }
  return null
}
function trackNative(provider, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || native.has(id)) return
  native.set(id, { provider, file: null, offset: 0, pending: '', lastSearch: 0 })
}
function persistedEvent(row) {
  const p = row.payload
  if (
    row.type === 'event_msg' &&
    [
      'user_message',
      'agent_message',
      'task_started',
      'task_complete',
      'turn_aborted',
      'error',
      'warning',
      'token_count',
    ].includes(p?.type)
  )
    return row
  if (
    row.type === 'response_item' &&
    p?.type === 'message' &&
    ['user', 'assistant'].includes(p.role) &&
    p.channel !== 'analysis'
  )
    return row
  if (
    row.type === 'response_item' &&
    [
      'function_call',
      'function_call_output',
      'custom_tool_call',
      'custom_tool_call_output',
    ].includes(p?.type)
  )
    return {
      ...row,
      payload: {
        ...p,
        arguments: p.arguments?.slice(0, 12000),
        input: p.input?.slice(0, 12000),
        output: typeof p.output === 'string' ? p.output.slice(0, 12000) : p.output,
      },
    }
  return null
}
function tailNative() {
  for (const [id, info] of native) {
    if (!info.file && Date.now() - info.lastSearch > 15000) {
      info.lastSearch = Date.now()
      const roots =
        info.provider === 'codex'
          ? [path.join(nativeRoot, 'sessions'), path.join(nativeRoot, 'archived_sessions')]
          : [path.join(os.homedir(), '.claude/projects')]
      info.file = roots.map((root) => findFile(root, id)).find(Boolean) ?? null
      if (info.file)
        record('persisted-source', {
          id,
          provider: info.provider,
          file: info.file,
          note: 'Initial contents are historical baseline; original row timestamps retained. Reasoning excluded.',
        })
    }
    if (!info.file) continue
    try {
      const size = fs.statSync(info.file).size
      if (size < info.offset) {
        info.offset = 0
        info.pending = ''
        record('persisted-truncated', { id })
      }
      if (size === info.offset) continue
      const length = Math.min(size - info.offset, 1024 * 1024),
        buffer = Buffer.alloc(length),
        fd = fs.openSync(info.file, 'r')
      try {
        fs.readSync(fd, buffer, 0, length, info.offset)
      } finally {
        fs.closeSync(fd)
      }
      info.offset += length
      const lines = (info.pending + buffer.toString('utf8')).split('\n')
      info.pending = lines.pop()
      for (const line of lines) {
        try {
          const row = JSON.parse(line)
          let selected = persistedEvent(row)
          if (info.provider === 'claude' && ['user', 'assistant'].includes(row.type)) {
            const content = Array.isArray(row.message?.content)
              ? row.message.content.filter(
                  (c) => c.type === 'text' || c.type === 'tool_use' || c.type === 'tool_result',
                )
              : row.message?.content
            selected = {
              type: row.type,
              timestamp: row.timestamp,
              uuid: row.uuid,
              message: { role: row.message?.role, content },
            }
          }
          if (selected) record('persisted', { id, row: selected })
        } catch (e) {
          record('persisted-parse-error', { id, message: e.message })
        }
      }
    } catch (e) {
      record('persisted-error', { id, message: e.message })
      if (e.code === 'ENOENT') {
        // Codex can move the same transcript into archived_sessions. Keep the byte
        // cursor so finding it there neither repeats history nor skips its ending.
        info.file = null
        info.lastSearch = 0
      }
    }
  }
}
let lastIndex = ''
function persistedIndex() {
  const selected = read(path.join(appData, 'agent-conversations.json')).conversations.filter((c) =>
    knownConversations.has(c.id),
  )
  const text = JSON.stringify(selected)
  if (text !== lastIndex) {
    lastIndex = text
    atomic(path.join(folder, 'conversations-latest.json'), selected)
    record('persisted-index', selected)
  }
}
const status = () =>
  atomic(path.join(folder, 'status.json'), {
    running,
    pid: process.pid,
    started,
    at: new Date().toISOString(),
    folder,
    attached: [...clients.values()]
      .filter((c) => c.alive)
      .map((c) => ({ id: c.target.id, url: c.target.url })),
    events: seq,
    lastEvent,
    agent: lastAgent && {
      provider: lastAgent.provider,
      model: lastAgent.model,
      reasoning: lastAgent.reasoning,
      conversationId: lastAgent.conversationId,
      sessionId: lastAgent.sessionId,
      status: lastAgent.status,
      live: lastAgent.live,
      items: lastAgent.items?.length,
      requests: lastAgent.requests?.length,
      error: lastAgent.error,
    },
    native: [...native.entries()].map(([id, n]) => ({
      id,
      provider: n.provider,
      found: !!n.file,
      bytesRead: n.offset,
    })),
  })
process.on('SIGINT', () => {
  running = false
})
process.on('SIGTERM', () => {
  running = false
})
record('started', { folder })
let endpointError = null
try {
  while (
    running &&
    Date.now() - Date.parse(started) < 4 * 60 * 60 * 1000 &&
    !fs.existsSync(path.join(folder, 'stop'))
  ) {
    try {
      const targets = await (
        await fetch('http://127.0.0.1:9333/json/list', { signal: AbortSignal.timeout(3000) })
      ).json()
      if (endpointError) {
        record('endpoint-restored', {})
        endpointError = null
      }
      for (const target of targets.filter(
        (t) =>
          t.type === 'page' &&
          t.url.startsWith(panelUrl + '?') &&
          new URL(t.url).searchParams.get('view') === 'panel',
      )) {
        if (!clients.get(target.id)?.alive) {
          const client = new Client(target)
          try {
            await client.connect()
            clients.set(target.id, client)
          } catch (e) {
            await client.close()
            throw e
          }
        }
      }
      for (const [id, client] of clients)
        if (!targets.some((t) => t.id === id)) {
          await client.close()
          clients.delete(id)
        }
    } catch (e) {
      if (e.message !== endpointError) record('endpoint-error', { message: e.message })
      endpointError = e.message
    }
    for (const client of clients.values()) await client.screenshot()
    try {
      tailNative()
      persistedIndex()
    } catch (e) {
      record('persisted-error', { message: e.message })
    }
    status()
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
} finally {
  running = false
  for (const client of clients.values()) await client.close()
  record('stopped', {
    reason: fs.existsSync(path.join(folder, 'stop')) ? 'requested' : 'signal-or-duration-limit',
  })
  status()
}
