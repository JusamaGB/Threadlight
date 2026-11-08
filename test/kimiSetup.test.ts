import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inspectLocalRuntime } from '../src/main/kimi/runtime'
import { translateKimiConfiguration } from '../src/main/kimi/config'
import { SettingsStore } from '../src/main/settings'
import {
  DEFAULT_KIMI_SETUP,
  kimiSetupKey,
  kimiSetupSchema,
  type KimiSetup,
} from '../src/shared/kimi'
import { IPC, type ThreadlightApi } from '../src/shared/ipc'
import { PROVIDERS } from '../src/shared/providers'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
beforeEach(async () => {
  box = await sandbox()
})
afterEach(async () => {
  await box.cleanup()
})
const local = (path = ''): KimiSetup => ({
  connection: {
    kind: 'local',
    endpoint: 'http://localhost:8000/v1',
    model: 'vendor/Exact-model:Q4',
    protocol: 'openai-chat',
    authentication: 'none',
  },
  agent: { kind: 'local', installationPath: path },
})

describe('Kimi configuration', () => {
  it('bounds explicit output and preserves declared always-thinking requirements', () => {
    const setup = {
      ...local(box.root),
      connection: {
        kind: 'moonshot',
        protocol: 'kimi',
        authentication: 'external-api-key',
        model: 'kimi-k3.1-pro',
      },
    }
    const metadata = {
      model: 'kimi-k3.1-pro',
      maxContextSize: 1048576,
      capabilities: ['always_thinking' as const, 'thinking' as const],
      source: 'operator-declared' as const,
    }
    const credential = {
      endpoint: 'https://api.moonshot.ai/v1',
      variable: 'THREADLIGHT_KIMI_TEST_KEY',
      material: 'synthetic-test-only',
    }
    const result = translateKimiConfiguration(setup, metadata, credential, 4096)
    expect(result.status).toBe('translated')
    if (result.status !== 'translated') throw Error('Mapping failed')
    expect(result.toml).toContain('max_output_size = 4096')
    expect(result.toml).toContain('[thinking]\nenabled = true')
    for (const invalid of [0, 4097, NaN, 1.5])
      expect(translateKimiConfiguration(setup, metadata, credential, invalid).status).toBe(
        'invalid-configuration',
      )
  })
  it('requires exact-model metadata and explicit endpoint-bound credentials without guessing', () => {
    const setup = local(box.root)
    expect(translateKimiConfiguration(setup).status).toBe('incomplete-configuration')
    const metadata = {
      model: setup.connection.model,
      maxContextSize: 12345,
      capabilities: [],
      source: 'operator-declared' as const,
    }
    const credential = {
      endpoint: 'http://localhost:8000/v1',
      variable: 'THREADLIGHT_KIMI_TEST_KEY',
      material: 'synthetic-key',
    }
    // auth:none stays none; credentials are not silently substituted.
    expect(translateKimiConfiguration(setup, metadata, credential).status).toBe(
      'incomplete-configuration',
    )
    const authed = {
      ...setup,
      connection: { ...setup.connection, authentication: 'external-api-key' },
    }
    expect(
      translateKimiConfiguration(authed, metadata, {
        ...credential,
        endpoint: 'https://other.example',
      }).status,
    ).toBe('incomplete-configuration')
    expect(
      translateKimiConfiguration(authed, { ...metadata, model: 'different' }, credential).status,
    ).toBe('incomplete-configuration')
  })
  it.each(['local', 'server', 'moonshot'] as const)(
    'maps %s structurally without resolving accounts or contacting endpoints',
    (kind) => {
      const endpoint =
        kind === 'moonshot'
          ? 'https://api.moonshot.ai/v1'
          : kind === 'local'
            ? 'http://127.0.0.1:8000/v1'
            : 'https://model.example/v1'
      const connection =
        kind === 'moonshot'
          ? { kind, model: 'Opaque.Model/ID', protocol: 'kimi', authentication: 'external-api-key' }
          : {
              kind,
              endpoint,
              model: 'Opaque.Model/ID',
              protocol: 'openai-chat',
              authentication: 'external-api-key',
            }
      const setup = { connection, agent: { kind: 'local', installationPath: box.root } }
      const result = translateKimiConfiguration(
        setup,
        {
          model: connection.model,
          maxContextSize: 12345,
          capabilities: ['tool_use'],
          source: 'operator-declared',
        },
        {
          endpoint,
          variable: 'THREADLIGHT_KIMI_TEST_KEY',
          material: 'synthetic-key-not-for-config',
        },
      )
      expect(result.status).toBe('translated')
      if (result.status !== 'translated') throw Error('Mapping failed')
      expect(result.toml).toContain(`model = "Opaque.Model/ID"`)
      expect(result.toml).toContain(`default_model = "${result.alias}"`)
      expect(result.toml).toContain(`[models."${result.alias}"]`)
      expect(result.toml).toContain(`provider = "${result.provider}"`)
      expect(result.toml).toContain(`[providers."${result.provider}"]`)
      expect(result.toml).toContain(`type = "${kind === 'moonshot' ? 'kimi' : 'openai'}"`)
      expect(result.toml).toContain(`base_url = "${endpoint}"`)
      expect(result.toml).toContain(`api_key_env = "THREADLIGHT_KIMI_TEST_KEY"`)
      expect(result.toml).toContain('max_context_size = 12345')
      expect(result.toml).toContain('max_attempts_per_step = 1')
      expect(result.toml).not.toContain('max_retries_per_step')
      expect(JSON.stringify(result)).not.toContain('synthetic-key-not-for-config')
    },
  )
  it('does not launch remote-agent drafts or apply fixture metadata to real models', () => {
    expect(
      translateKimiConfiguration({ ...local(), agent: { kind: 'server', host: 'agent.example' } })
        .status,
    ).toBe('unsupported-runtime-location')
    expect(
      translateKimiConfiguration(local(box.root), {
        model: local().connection.model,
        maxContextSize: 32768,
        capabilities: ['tool_use'],
        source: 'scripted-fixture',
      }).status,
    ).toBe('incomplete-configuration')
  })
  it.each(['local', 'server', 'moonshot'] as const)(
    'persists %s without changing provider defaults',
    async (kind) => {
      const base = local()
      const setup: KimiSetup = {
        ...base,
        connection:
          kind === 'moonshot'
            ? {
                kind,
                model: 'opaque-Model-ID',
                protocol: 'kimi',
                authentication: 'external-api-key',
              }
            : {
                kind,
                model: 'opaque-Model-ID',
                endpoint:
                  kind === 'local' ? 'http://localhost:8000/v1' : 'https://model.example/v1',
                protocol: 'openai-chat',
                authentication: 'none',
              },
      }
      const store = new SettingsStore(box.root)
      const before = await store.load()
      expect((await store.update({ kimiSetup: setup })).ok).toBe(true)
      expect(await new SettingsStore(box.root).load()).toEqual({ ...before, kimiSetup: setup })
      expect(JSON.parse(await readFile(join(box.root, 'settings.json'), 'utf8')).kimiSetup).toEqual(
        setup,
      )
    },
  )
  it('preserves incomplete and server-agent drafts, without rewriting loopback', () => {
    expect(kimiSetupSchema.parse(DEFAULT_KIMI_SETUP)).toEqual(DEFAULT_KIMI_SETUP)
    const setup = { ...local(), agent: { kind: 'server', host: 'agent.example' } }
    expect(kimiSetupSchema.parse(setup)).toEqual(setup)
  })
  it.each([
    'https://user:password@model.example/v1',
    'https://model.example/v1?key=secret',
    'https://model.example/#secret',
    'file:///tmp/model',
    'https://model.example/ ?a',
    'powershell -Command run',
    'https://model.example\\@other/v1',
  ])('refuses unsafe endpoint %s', (endpoint) => {
    const base = local()
    expect(
      kimiSetupSchema.safeParse({
        ...base,
        connection: { ...base.connection, kind: 'server', endpoint },
      }).success,
    ).toBe(false)
  })
  it('rejects secrets, observed claims and unused route fields rather than serializing them', async () => {
    const store = new SettingsStore(box.root)
    for (const setup of [
      { ...local(), connected: true },
      { ...local(), agent: { kind: 'local', installationPath: '', expectedHash: 'forged' } },
      { ...local(), connection: { ...local().connection, apiKey: 'secret' } },
      {
        ...local(),
        connection: { kind: 'moonshot', model: '', protocol: 'kimi', authentication: 'oauth' },
      },
      {
        ...local(),
        connection: {
          kind: 'moonshot',
          model: '',
          protocol: 'kimi',
          authentication: 'external-api-key',
          endpoint: 'https://elsewhere.example',
        },
      },
    ])
      expect((await store.update({ kimiSetup: setup })).ok).toBe(false)
    expect(store.settings.kimiSetup).toEqual(DEFAULT_KIMI_SETUP)
  })
  it.each([
    'cmd.exe /c run',
    'C:\\node.exe --eval run',
    '\\\\server\\package',
    '/tmp/a;run',
    'https://host/package',
  ])('refuses nonlocal or command-like package path %s', (installationPath) => {
    expect(kimiSetupSchema.safeParse(local(installationPath)).success).toBe(false)
  })
})

describe('explicit local metadata inspection', () => {
  it('bounds a stalled filesystem response and retains ownership until the read settles', async () => {
    const selected = join(box.root, 'slow')
    let release: ((path: string) => void) | undefined
    const pending = new Promise<string>((done) => {
      release = done
    })
    vi.resetModules()
    vi.doMock('node:fs/promises', async (original) => {
      const actual = await original<typeof import('node:fs/promises')>()
      return {
        ...actual,
        realpath: (path: string) => (path === selected ? pending : actual.realpath(path)),
      }
    })
    try {
      const isolated = await import('../src/main/kimi/runtime')
      vi.useFakeTimers()
      const result = isolated.inspectLocalRuntime(local(selected))
      await vi.advanceTimersByTimeAsync(3001)
      expect(await result).toMatchObject({
        status: 'unverified',
        detail: 'Runtime inspection timed out. Nothing was executed.',
      })
      expect(await isolated.inspectLocalRuntime(local(selected))).toMatchObject({
        status: 'unavailable',
      })
      vi.useRealTimers()
      release!(box.root)
      await vi.waitFor(async () =>
        expect(await isolated.inspectLocalRuntime(local(box.root))).toMatchObject({
          status: 'missing',
        }),
      )
    } finally {
      release?.(box.root)
      vi.useRealTimers()
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })
  it('reports missing paths and binds the observation to the complete configuration', async () => {
    const setup = local(join(box.root, 'missing'))
    expect(await inspectLocalRuntime(setup)).toMatchObject({
      status: 'missing',
      configurationKey: kimiSetupKey(setup),
    })
    expect(
      kimiSetupKey({ ...setup, connection: { ...setup.connection, model: 'changed' } }),
    ).not.toBe(kimiSetupKey(setup))
  })
  it('never transfers a local observation to a server agent', async () => {
    expect(
      await inspectLocalRuntime({ ...local(), agent: { kind: 'server', host: 'agent.example' } }),
    ).toMatchObject({ status: 'unavailable' })
  })
  it('reads an unknown package without executing its entry, and closes file handles', async () => {
    await mkdir(join(box.root, 'dist'))
    await writeFile(
      join(box.root, 'package.json'),
      JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.4.1' }),
    )
    const marker = join(box.root, 'executed')
    await writeFile(
      join(box.root, 'dist/main.mjs'),
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad')`,
    )
    const result = await inspectLocalRuntime(local(box.root))
    expect(result).toMatchObject({ status: 'unverified', version: '2.4.1' })
    expect(result.entrySha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(readFile(marker)).rejects.toThrow()
    await unlink(join(box.root, 'dist/main.mjs'))
    expect(await inspectLocalRuntime(local(box.root))).toMatchObject({ status: 'missing' })
  })
  it('rejects oversized or malformed metadata without echoing its contents', async () => {
    await writeFile(join(box.root, 'package.json'), 'private-sentinel'.repeat(6000))
    const result = await inspectLocalRuntime(local(box.root))
    expect(result.status).toBe('unverified')
    expect(JSON.stringify(result)).not.toContain('private-sentinel')
  })
  it('rejects renderer trust anchors and claims at the main boundary', async () => {
    await expect(inspectLocalRuntime({ ...local(), expectedHash: 'forged' })).rejects.toThrow()
  })
})

describe('actual inspection wiring boundaries', () => {
  it('runs the registered main callback with trusted and untrusted senders', async () => {
    const source = ts.createSourceFile(
      'index.ts',
      await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    let callback = ''
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === 'ipcMain.handle' &&
        node.arguments[0]?.getText(source) === 'IPC.inspectKimiLocalRuntime'
      )
        callback = node.arguments[1]!.getText(source)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(callback).not.toBe('')
    const factory = ts.transpileModule(`return (${callback})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    const mainFrame = {}
    const sender = { mainFrame }
    const inspect = vi.fn(inspectLocalRuntime)
    const handler = new Function('windows', 'inspectLocalRuntime', factory)(
      { panel: { webContents: sender } },
      inspect,
    )
    expect(() => handler({ sender: {}, senderFrame: mainFrame }, local())).toThrow()
    expect(() => handler({ sender, senderFrame: {} }, local())).toThrow()
    expect(inspect).not.toHaveBeenCalled()
    expect(await handler({ sender, senderFrame: mainFrame }, local())).toMatchObject({
      status: 'missing',
    })
    expect(inspect).toHaveBeenCalledTimes(1)
  })
  it('keeps the inspection module free of execution/network imports and provider selection unchanged', async () => {
    const source = ts.createSourceFile(
      'runtime.ts',
      await readFile(new URL('../src/main/kimi/runtime.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((node) => (node.moduleSpecifier as ts.StringLiteral).text)
    expect(imports.sort()).toEqual([
      '../../shared/kimi',
      'node:crypto',
      'node:fs/promises',
      'node:path',
    ])
    expect(PROVIDERS).toEqual(['claude', 'codex'])
  })
  it('exposes only the typed inspection channel through the real preload', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'missing' })
    let exposed: ThreadlightApi | undefined
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (_name: string, api: ThreadlightApi) => {
          exposed = api
        },
      },
      ipcRenderer: { invoke },
      webUtils: {},
    }))
    await import('../src/preload/index')
    expect(invoke).not.toHaveBeenCalled()
    await exposed!.inspectKimiLocalRuntime(local())
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC.inspectKimiLocalRuntime, local())
    vi.doUnmock('electron')
  })
})
