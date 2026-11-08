/** Deterministic ACP peer. No Kimi, account, network, model or project edits. */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const turns = new Map()
const responses = []
const echoes = []
const fragments = []
const descendants = []
let sessionCount = 0
let prompts = 0
let cancels = 0
let holdOpen = false
const stateFile =
  process.env.KIMI_CODE_HOME && existsSync(process.env.KIMI_CODE_HOME)
    ? join(process.env.KIMI_CODE_HOME, 'fake-sessions.json')
    : null
const saved =
  stateFile && existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf8'))
    : { sessions: [], prompts: 0 }
let currentModel = 'fixture-model'
const configOptions = () => [
  {
    id: 'model',
    type: 'select',
    currentValue: currentModel,
    options: [{ value: 'fixture-model', name: 'Fixture model' }],
  },
  {
    id: 'mode',
    type: 'select',
    currentValue: 'default',
    options: [{ value: 'default', name: 'Manual' }],
  },
]
const persist = () => {
  if (stateFile) writeFileSync(stateFile, JSON.stringify(saved))
}
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`)
const reply = (id, result) => send({ id, result })
const event = (sessionId, text = 'synthetic 🦉 delta') => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  },
})

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  const msg = JSON.parse(line)
  if (!msg.method) {
    responses.push(msg)
    return
  }
  const p = msg.params ?? {}
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, {
        protocolVersion: 1,
        agentInfo: { name: 'fake-kimi', version: 'fixture' },
        agentCapabilities: {},
      })
      break
    case 'session/new': {
      const sessionId = `opaque/session:${saved.sessions.length + ++sessionCount}`
      saved.sessions.push(sessionId)
      persist()
      reply(msg.id, { sessionId, cwd: p.cwd, configOptions: configOptions() })
      break
    }
    case 'session/load':
      if (!saved.sessions.includes(p.sessionId)) send({ id: msg.id, error: { code: -32602 } })
      else reply(msg.id, { configOptions: configOptions() })
      break
    case 'session/set_config_option':
      if (p.configId === 'model') currentModel = p.value
      reply(msg.id, { configOptions: configOptions() })
      break
    case 'session/prompt': {
      prompts++
      saved.prompts++
      persist()
      turns.set(p.sessionId, msg.id)
      // Fragment *inside* a UTF-8 code point, then combine an event and response.
      const bytes = Buffer.from(`${JSON.stringify(event(p.sessionId))}\n`)
      const split = bytes.indexOf(Buffer.from('🦉')) + 1
      process.stdout.write(bytes.subarray(0, split))
      if (p.prompt[0].text === 'complete') {
        const result = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { stopReason: 'end_turn' },
        })
        // The test waits until the first fragment has been consumed before flush.
        fragments.push(bytes.subarray(split))
        fragments.push(`${result}\n${result}\n${JSON.stringify(event('foreign/session'))}\n`)
        turns.delete(p.sessionId)
      } else {
        process.stdout.write(bytes.subarray(split))
      }
      if (p.prompt[0].text === 'live-complete') {
        reply(msg.id, { stopReason: 'end_turn', usage: { inputTokens: 2, outputTokens: 1 } })
        turns.delete(p.sessionId)
      }
      if (p.prompt[0].text === 'disconnect-after-submit') {
        input.close()
        process.stdin.destroy()
      }
      if (p.prompt[0].text === 'permission') {
        const request = {
          id: `permission:${p.sessionId}`,
          method: 'session/request_permission',
          params: {
            sessionId: p.sessionId,
            toolCall: { toolCallId: 'synthetic-tool', title: 'WriteFile', content: [] },
            options: [
              { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
              { optionId: 'no', name: 'Deny', kind: 'reject_once' },
            ],
          },
        }
        send(request)
        send(request)
      }
      break
    }
    case 'session/cancel':
      cancels++
      // No terminal result until the test explicitly releases settlement.
      break
    case 'test/settle': {
      const id = turns.get(p.sessionId)
      if (id !== undefined) {
        reply(id, { stopReason: p.reason ?? 'cancelled' })
        reply(id, { stopReason: p.reason ?? 'cancelled' })
        turns.delete(p.sessionId)
      }
      reply(msg.id, {})
      break
    }
    case 'test/stats':
      reply(msg.id, {
        pid: process.pid,
        prompts,
        aggregatePrompts: saved.prompts,
        cancels,
        responses,
        descendants,
      })
      break
    case 'test/echo':
      echoes.push(msg)
      break
    case 'test/flush':
      for (const fragment of fragments.splice(0)) process.stdout.write(fragment)
      for (const pending of echoes.splice(0).reverse()) reply(pending.id, pending.params)
      reply(msg.id, {})
      break
    case 'test/disconnect':
      reply(msg.id, {})
      input.close()
      process.stdin.destroy()
      break
    case 'test/malformed':
      process.stdout.write('{broken json}\n')
      break
    case 'test/hang':
      holdOpen = true
      setInterval(() => {}, 1000)
      break
    case 'test/descendant': {
      const child = spawn(
        process.execPath,
        ['-e', 'process.send({pid:process.pid});setInterval(()=>{},1000)'],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      child.once('message', (value) => {
        descendants.push(value.pid)
        reply(msg.id, { pid: value.pid })
      })
      break
    }
    default:
      send({ id: msg.id, error: { code: -32601, message: 'Unsupported fixture method' } })
  }
})
input.once('close', () => {
  if (!holdOpen) process.stdout.end(() => process.exit(0))
})
