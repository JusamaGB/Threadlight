import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
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
