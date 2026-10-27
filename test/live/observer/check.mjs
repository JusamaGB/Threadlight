import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import os from 'node:os'
import path from 'node:path'
const source = fs.readFileSync(new URL('./observe.mjs', import.meta.url), 'utf8')
const injected = source.slice(
  source.indexOf('function installObserver()'),
  source.indexOf('\nclass Client'),
)
const events = [],
  subscribers = new Map(),
  timers = new Set()
let removed = 0,
  unexpected = 0
class Peer extends EventTarget {
  connectionState = 'new'
  iceConnectionState = 'new'
  signalingState = 'stable'
  createDataChannel() {
    const c = new EventTarget()
    c.label = 'test'
    c.readyState = 'open'
    return c
  }
}
const original = Peer.prototype.createDataChannel
const api = new Proxy(
  {},
  {
    get: (_, name) => {
      if (String(name).startsWith('on'))
        return (fn) => {
          subscribers.set(name, fn)
          return () => {
            subscribers.delete(name)
            removed++
          }
        }
      if (String(name).startsWith('get')) return async () => ({ status: 'idle' })
      return () => {
        unexpected++
        throw new Error('Mutation called: ' + name)
      }
    },
  },
)
const window = { threadlight: api, __tlE2E: (text) => events.push(JSON.parse(text)) }
const context = vm.createContext({
  window,
  document: {
    body: { dataset: {}, innerText: 'synthetic panel' },
    documentElement: { dataset: {} },
    querySelectorAll: () => [],
    hidden: false,
    hasFocus: () => false,
  },
  RTCPeerConnection: Peer,
  crypto: { randomUUID: () => 'test-peer' },
  URL,
  location: { href: 'file:///test?view=panel' },
  setInterval: (fn) => {
    timers.add(fn)
    return fn
  },
  clearInterval: (fn) => timers.delete(fn),
  Date,
  JSON,
  Map,
  WeakSet,
  Object,
  Reflect,
})
vm.runInContext(injected + '\ninstallObserver()', context)
assert.equal(events.filter((e) => e.type === 'installed').length, 1)
const peer = new Peer(),
  channel = peer.createDataChannel('test')
let productEvents = 0
channel.addEventListener('message', () => productEvents++)
const message = new Event('message')
message.data = JSON.stringify({ type: 'session.started' })
channel.dispatchEvent(message)
assert.equal(productEvents, 1)
assert.ok(events.some((e) => e.type === 'rtc-message' && e.data.event.type === 'session.started'))
subscribers.get('onAgent')({
  status: 'working',
  items: [{ kind: 'you', text: 'synthetic request' }],
})
assert.ok(events.some((e) => e.type === 'agent' && e.data.status === 'working'))
window.__tlE2EObserver.stop()
assert.equal(Peer.prototype.createDataChannel, original)
assert.equal(timers.size, 0)
assert.equal(subscribers.size, 0)
assert.equal(removed, 7)
assert.equal(unexpected, 0)
console.log(
  'PASS: additive channel observation, original listener preserved, Agent subscription, no mutation APIs, full cleanup',
)

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'threadlight-observer-check-'))
try {
  const id = '11111111-1111-4111-8111-111111111111'
  const sessions = path.join(temporary, 'sessions')
  const archive = path.join(temporary, 'archived_sessions')
  fs.mkdirSync(sessions)
  fs.mkdirSync(archive)
  const transcript = path.join(sessions, `rollout-${id}.jsonl`)
  const moved = path.join(archive, `rollout-${id}.jsonl`)
  const row = (message) =>
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message } }) + '\n'
  fs.writeFileSync(transcript, row('first'))
  const captured = []
  const native = new Map()
  const tailContext = vm.createContext({
    fs,
    path,
    os,
    Buffer,
    native,
    nativeRoot: temporary,
    record: (type, data) => captured.push({ type, data }),
  })
  vm.runInContext(
    source.slice(source.indexOf('function findFile('), source.indexOf('\nlet lastIndex')),
    tailContext,
  )
  vm.runInContext(`trackNative('codex', '${id}'); tailNative()`, tailContext)
  assert.equal(captured.filter((event) => event.type === 'persisted').length, 1)
  fs.renameSync(transcript, moved)
  vm.runInContext('tailNative(); tailNative()', tailContext)
  assert.equal(native.get(id).file, moved)
  assert.equal(
    captured.filter((event) => event.type === 'persisted').length,
    1,
    'moving to the archive must not repeat existing history',
  )
  fs.appendFileSync(moved, row('second'))
  vm.runInContext('tailNative()', tailContext)
  assert.deepEqual(
    captured
      .filter((event) => event.type === 'persisted')
      .map((event) => event.data.row.payload.message),
    ['first', 'second'],
  )
  assert.equal(
    captured.filter((event) => event.type === 'persisted-error').length,
    1,
    'a missing cached path is reported once, then recovered',
  )
  console.log(
    'PASS: archived Codex transcript recovery preserves its cursor and captures subsequent messages once.',
  )
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  fs.rmSync(temporary, { recursive: true, force: true })
}
