// Run with Electron, opt in explicitly. Uses existing local speech weights; never downloads.
/* global window */
import { app, utilityProcess } from 'electron'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const require = createRequire(import.meta.url),
  ts = require('typescript')
const root = process.env.THREADLIGHT_EVIDENCE_DIR
if (process.env.THREADLIGHT_RECORDED_READ_PROOF !== '1' || !root) {
  app.quit()
} else {
  mkdirSync(root, { recursive: true })
  app.setPath('userData', join(root, 'electron'))
  require.extensions['.ts'] = (module, file) =>
    module._compile(
      ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
      }).outputText,
      file,
    )
  const { AgentService } = require('../../src/main/agent/agentService.ts')
  const { CodexClient } = require('../../src/main/agent/codexClient.ts')
  const { ThreadReadService } = require('../../src/main/threadRead/service.ts')
  const { ThreadReadServer } = require('../../src/main/threadRead/server.ts')
  const { CodexReadAdapter } = require('../../src/main/threadRead/codex.ts')
  const { codexPaths, defaultPaths } = require('../../src/main/sessions/paths.ts')
  const { DEFAULT_SETTINGS } = require('../../src/shared/settings.ts')
  const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
  let worker, reader, target, server, browser
  const report = { startedAt: new Date().toISOString() }
  const waitReady = async (agent) => {
    const until = Date.now() + 240000
    while (Date.now() < until && !['ready', 'error', 'waiting'].includes(agent.current.status))
      await new Promise((r) => setTimeout(r, 200))
    assert.equal(agent.current.status, 'ready', agent.current.error ?? 'Agent did not finish')
  }
  void app.whenReady().then(async () => {
    try {
      const wav = readFileSync(process.env.THREADLIGHT_RECORDED_WAV)
      let format, pcm
      for (let offset = 12; offset + 8 <= wav.length;) {
        const name = wav.toString('ascii', offset, offset + 4),
          size = wav.readUInt32LE(offset + 4),
          chunk = wav.subarray(offset + 8, offset + 8 + size)
        if (name === 'fmt ') format = chunk
        if (name === 'data') pcm = chunk
        offset += 8 + size + (size % 2)
      }
      assert.equal(format?.readUInt16LE(0), 1)
      assert.equal(format.readUInt16LE(2), 1)
      assert.equal(format.readUInt32LE(4), 16000)
      assert.equal(format.readUInt16LE(14), 16)
      assert.ok(pcm)
      const samples = Float32Array.from(
        { length: pcm.length / 2 },
        (_, i) => pcm.readInt16LE(i * 2) / 32768,
      )
      worker = utilityProcess.fork(resolve('out/main/stt-worker.js'), [], {
        serviceName: 'Threadlight synthetic recorded read proof',
      })
      const transcript = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Local transcription deadline')), 120000)
        worker.on('message', (msg) => {
          if (msg.type === 'ready')
            worker.postMessage({ type: 'transcribe', id: 1, audio: samples })
          if (msg.type === 'result') {
            clearTimeout(timer)
            resolve(msg.text)
          }
          if (['missing', 'load-error', 'failed'].includes(msg.type)) {
            clearTimeout(timer)
            reject(new Error(`Speech worker ${msg.type}`))
          }
        })
        worker.postMessage({
          type: 'load',
          cacheDir: process.env.THREADLIGHT_STT_CACHE,
          allowDownload: false,
        })
      })
      report.transcript = transcript
      assert.match(transcript, /violet garden/i)
      console.log('PASS: generated recording transcribed by the production local speech worker.')
      const options = {
        workspace: join(root, 'reader'),
        index: join(root, 'reader.json'),
        claudeProjects: defaultPaths().projectsDir,
        settings: () => ({
          ...DEFAULT_SETTINGS,
          agentProvider: 'claude',
          agentLifetimeMinutes: 0,
          agentCodexModel: 'gpt-6-luna',
        }),
        snapshot: () => ({
          sessions: [],
          workspaces: [],
          allWorkspaces: [],
          currentWorkspace: null,
          currentThreadId: null,
        }),
        cli: async (provider) => ({
          command:
            provider === 'codex'
              ? process.env.THREADLIGHT_CODEX_CLI
              : process.env.THREADLIGHT_CLAUDE_CLI,
          prefixArgs: [],
        }),
        onChange: () => {},
        onRateLimit: () => {},
      }
      target = new AgentService({
        ...options,
        workspace: join(root, 'target'),
        index: join(root, 'target.json'),
        settings: () => ({ ...options.settings(), agentProvider: 'codex' }),
      })
      assert.equal(
        (
          await target.send(
            'Reply exactly: the synthetic garden colour is sapphire. Do not use tools.',
          )
        ).ok,
        true,
      )
      await waitReady(target)
      const native = new CodexClient(await options.cli('codex'), root)
      try {
        await native.initialize()
        await native.request('thread/name/set', {
          threadId: target.current.sessionId,
          name: 'Synthetic Violet Garden',
        })
      } finally {
        native.close()
      }
      server = new ThreadReadServer(
        new ThreadReadService([new CodexReadAdapter(codexPaths())], () => ['codex']),
      )
      await server.start()
      reader = new AgentService({ ...options, threadReads: server })
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage()
      await page.route('http://localhost:17897/', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }),
      )
      await page.goto('http://localhost:17897/')
      await page.exposeFunction('agentSend', (text) => reader.send(text))
      await page.evaluate(() => {
        window.threadlight = { agentSend: window.agentSend }
      })
      const { build } = await import('vite')
      const built = await build({
        configFile: false,
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          write: false,
          lib: {
            entry: resolve('test/live/recorded-reader.entry.mjs'),
            name: 'RecordedReadProof',
            formats: ['iife'],
          },
        },
      })
      await page.addScriptTag({
        content: (Array.isArray(built) ? built[0].output : built.output).find(
          (c) => c.type === 'chunk',
        ).code,
      })
      await page.waitForFunction(() => !!window.recordedSend)
      await page.evaluate((text) => window.recordedSend(text), transcript)
      await waitReady(reader)
      assert.ok(reader.current.items.some((i) => i.source?.tool === 'threadlight_read_thread'))
      assert.ok(reader.current.items.some((i) => i.kind === 'agent' && /sapphire/i.test(i.text)))
      report.pass = true
      report.items = reader.current.items
      console.log(
        'PASS: production recorded-voice hook delivered the transcript to hosted Claude, which read the named Codex chat.',
      )
    } catch (error) {
      report.error = error.message
      console.error(error.message)
      process.exitCode = 1
    } finally {
      worker?.kill()
      await reader?.close()
      await target?.close()
      server?.close()
      await browser?.close()
      writeFileSync(join(root, 'recorded-read.json'), JSON.stringify(report, null, 2))
      app.exit(process.exitCode ?? 0)
    }
  })
}
