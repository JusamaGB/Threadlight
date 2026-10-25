import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  compareVersions,
  interpretOutput,
  MAX_MESSAGE_LENGTH,
  relayArgs,
  relayMessage,
  type RelayDeps,
  type RelayTarget,
} from '../src/main/relay'
import { sandbox, type Sandbox } from './helpers'

const FAKE_CLI = {
  command: process.execPath,
  prefixArgs: [resolve('test/fixtures/fake-claude.mjs')],
}
const SESSION = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'

let box: Sandbox
let argsFile: string
let held: boolean

beforeEach(async () => {
  box = await sandbox()
  argsFile = join(box.root, 'args.json')
  held = false
  process.env['FAKE_CLAUDE_ARGS_FILE'] = argsFile
  delete process.env['FAKE_CLAUDE_MODE']
})
afterEach(async () => {
  delete process.env['FAKE_CLAUDE_ARGS_FILE']
  delete process.env['FAKE_CLAUDE_MODE']
  await box.cleanup()
})

const deps = (): RelayDeps => ({ cli: FAKE_CLI, isHeld: async () => held })
const target = (overrides: Partial<RelayTarget> = {}): RelayTarget => ({
  id: SESSION,
  cwd: box.root,
  permissionMode: 'default',
  model: 'demo-model',
  ...overrides,
})

describe('relayMessage', () => {
  it('delivers the message, reports ✓ then returns the reply', async () => {
    let sent = false
    const result = await relayMessage(target(), 'check the build', deps(), () => (sent = true))
    expect(sent).toBe(true)
    expect(result).toEqual({ ok: true, reply: 'Got it: check the build' })

    const recorded = JSON.parse(await readFile(argsFile, 'utf8'))
    expect(recorded.args).toEqual([
      '--resume',
      SESSION,
      '-p',
      'check the build',
      '--output-format',
      'json',
      '--permission-mode',
      'default',
      '--model',
      'demo-model',
    ])
    expect(resolve(recorded.cwd)).toBe(resolve(box.root))
  })

  it('passes shell-looking text through untouched, as one argument', async () => {
    const tricky = 'say "hi" & del *.* | echo %PATH% $(whoami) `id`'
    const result = await relayMessage(target(), tricky, deps())
    expect(result).toEqual({ ok: true, reply: `Got it: ${tricky}` })
  })

  it('refuses a thread the Claude app holds, without starting the CLI', async () => {
    held = true
    const result = await relayMessage(target(), 'hello', deps())
    expect(result.ok).toBe(false)
    await expect(readFile(argsFile)).rejects.toThrow()
  })

  it('refuses bad ids, empty or oversized messages, and a missing CLI', async () => {
    expect((await relayMessage(target({ id: 'not-a-uuid' }), 'hi', deps())).ok).toBe(false)
    expect((await relayMessage(target(), '   ', deps())).ok).toBe(false)
    expect((await relayMessage(target(), 'x'.repeat(MAX_MESSAGE_LENGTH + 1), deps())).ok).toBe(
      false,
    )
    expect((await relayMessage(target(), 'hi', { ...deps(), cli: null })).ok).toBe(false)
  })

  it('explains a signed-out CLI and other failures', async () => {
    process.env['FAKE_CLAUDE_MODE'] = 'logged-out'
    expect(await relayMessage(target(), 'hi', deps())).toEqual({
      ok: false,
      reason: "Claude Code isn't signed in. Run 'claude auth login' once.",
    })
    process.env['FAKE_CLAUDE_MODE'] = 'garbage'
    expect(await relayMessage(target(), 'hi', deps())).toEqual({
      ok: false,
      reason: 'fatal: not json',
    })
  })
})

describe('relayArgs', () => {
  it('drops a permission mode or model it does not recognise', () => {
    const args = relayArgs(
      target({ permissionMode: 'everything --evil', model: 'x; rm -rf /' }),
      'hi',
    )
    expect(args).toEqual(['--resume', SESSION, '-p', 'hi', '--output-format', 'json'])
  })
})

describe('interpretOutput', () => {
  it('reads replies and errors from the JSON result', () => {
    expect(interpretOutput('{"is_error":false,"result":"PONG"}', '')).toEqual({
      ok: true,
      reply: 'PONG',
    })
    expect(interpretOutput('{"is_error":true,"result":"Rate limited"}', '')).toEqual({
      ok: false,
      reason: 'Rate limited',
    })
  })
})

describe('compareVersions', () => {
  it('orders numerically, not alphabetically', () => {
    expect(['2.1.9', '2.1.308', '2.1.30'].sort(compareVersions)).toEqual([
      '2.1.9',
      '2.1.30',
      '2.1.308',
    ])
  })
})
