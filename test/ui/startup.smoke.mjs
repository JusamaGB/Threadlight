// Real WindowManager/preload/renderer; isolated profile and synthetic service replies.
/* global window, document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const { _electron } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
const proofDir = mkdtempSync(join(tmpdir(), 'threadlight-startup-proof-'))
cpSync(join(root, 'out/preload'), join(proofDir, 'preload'), { recursive: true })
cpSync(join(root, 'out/renderer'), join(proofDir, 'renderer'), { recursive: true })
try {
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: true,
      target: 'node22',
      outDir: join(proofDir, 'main'),
      emptyOutDir: false,
      lib: {
        entry: join(root, 'test/ui/window-hover.fixture.ts'),
        formats: ['cjs'],
        fileName: () => 'window-hover.fixture.js',
      },
      rollupOptions: {
        external: ['electron'],
        output: {
          banner: `module.paths.unshift(${JSON.stringify(join(root, 'node_modules'))}); require('electron').dialog.showErrorBox = (title, message) => { console.error(title, message); require('electron').app.exit(1); };`,
        },
      },
    },
  })
  const entry = join(proofDir, 'main/window-hover.fixture.js')
  assert(existsSync(entry), 'compiled fixture entry must exist before Electron launch')
  for (const dependency of ['zod', 'koffi']) assert(existsSync(require.resolve(dependency)))
  execFileSync(process.execPath, ['--check', entry], { windowsHide: true })
  for (const wires of ['0', '1']) {
    const env = {
      ...process.env,
      NODE_PATH: join(root, 'node_modules'),
      THREADLIGHT_STARTUP_PROOF: '1',
      THREADLIGHT_STARTUP_WIRES: wires,
    }
    delete env.ELECTRON_RUN_AS_NODE
    const app = await _electron.launch({
      timeout: 15000,
      executablePath: require('electron'),
      args: [entry],
      env,
    })
    let stderr = ''
    app.process().stderr.on('data', (chunk) => {
      stderr += chunk
    })
    try {
      await app.firstWindow()
      await app.evaluate(async () => {
        const until = Date.now() + 10000
        while (!globalThis.hoverProof && Date.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 20))
        if (!globalThis.hoverProof) throw Error('Startup fixture failed to initialize')
        await globalThis.hoverProof.windows.loadRenderers()
      })
      const panel = app.windows().find((page) => page.url().includes('view=panel'))
      assert(panel)
      const bar = panel.getByLabel(/^Codex · Weekly usage unavailable/)
      await bar.waitFor({ state: 'visible' })
      // Native resizing is asynchronous; wait for the actual geometry acknowledgement.
      await panel.waitForFunction(
        () => {
          const el = document.querySelector('[class*="codexUsage"]')
          if (!el) return false
          const bar = el.getBoundingClientRect(),
            card = document.querySelector('[data-card]').getBoundingClientRect()
          return bar.height > 0 && bar.bottom <= card.bottom && bar.bottom <= window.innerHeight
        },
        undefined,
        { timeout: 8000 },
      )
      const settings = await panel.evaluate(() => window.threadlight.getSettings())
      assert.deepEqual(settings.enabledProviders, ['codex'])
      assert.equal(settings.workspaceWires, wires === '1')
      await panel
        .getByRole('button', { name: 'Settings', exact: true })
        .evaluate((el) => el.click())
      await panel.getByRole('switch', { name: 'Codex', exact: true }).waitFor({ state: 'visible' })
      assert(!stderr.includes('No handler registered'), stderr)
    } finally {
      await app.close()
    }
  }
  console.log(
    'PASS: delayed backend initialization, first-load Codex usage visible with wires off/on; no missing IPC handlers.',
  )
} finally {
  rmSync(proofDir, { recursive: true, force: true })
}
