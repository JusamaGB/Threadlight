/* global process, console, URL, window */
// Storybook: the real Threadlight renderer, driven by an invented working day, photographed
// scene by scene. Run `npm run build` first, then `npm run storybook`.
//   node storybook/run.mjs            every scene
//   node storybook/run.mjs dual wires only scenes whose id contains one of these words
// Frames go to storybook/frames/ with a contact sheet (index.html) and manifest.json.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSessions, projectName } from './world.mjs'
import { SCENES } from './scenes.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { DEFAULT_SETTINGS, validatePatch } = require(join(root, 'src/shared/settings.ts'))
const { combinedSnapshot, providerView } = require(join(root, 'src/shared/providers.ts'))
const { IDLE_AGENT } = require(join(root, 'src/shared/agent.ts'))
const { chromium } = require(process.env['THREADLIGHT_PLAYWRIGHT'] || 'playwright')

const only = process.argv.slice(2)
// STORYBOOK_FRAMES picks another output folder; STORYBOOK_INIT names a script run in every page
// before the app (for trying a layout idea without touching the app).
const frames = process.env['STORYBOOK_FRAMES'] ?? join(root, 'storybook/frames')
const SCALE = Number(process.env['STORYBOOK_SCALE'] ?? 2)

// ----- the invented world, as the main process would report it -----
let settings = {
  ...DEFAULT_SETTINGS,
  enabledProviders: ['claude', 'codex'],
  workspaceWires: true,
  listMode: 'recent',
  listWindowHours: 24,
  maxSessions: 10,
  openOn: 'click',
}
const state = { sessions: makeSessions(), views: {}, agent: IDLE_AGENT, now: Date.now() }
const sourceSnapshot = (provider) => {
  const mine = state.sessions.filter((s) => s.provider === provider)
  const recent = [...mine].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const view = state.views[provider] ?? { expanded: null, showAll: [] }
  const groups = new Map()
  for (const s of recent) groups.set(s.cwd, [...(groups.get(s.cwd) ?? []), s])
  const current = state.sessions.find((s) => s.id.startsWith('c1'))
  const currentWorkspace = provider === 'claude' ? current.cwd : recent[0].cwd
  const open = (cwd) =>
    view.everything || (view.expanded ?? [currentWorkspace]).some((id) => id === cwd)
  const workspaces = [...groups].map(([cwd, list]) => ({
    id: cwd,
    name: projectName(cwd),
    threadCount: list.length,
    activeCount: list.filter((s) => s.state !== 'idle').length,
    anyWorking: list.some((s) => s.state === 'working'),
    threads: open(cwd) ? list.map((session) => ({ session, children: [] })) : [],
    hiddenCount: 0,
    worktrees: 0,
  }))
  return {
    provider,
    codexUsage:
      provider === 'codex'
        ? {
            at: Date.now(),
            fiveHour: { used: 0.38, resetsAt: Date.now() + 2.2 * 3600_000 },
            week: { used: 0.27, resetsAt: Date.now() + 3 * 86400_000 },
          }
        : undefined,
    sessions: recent,
    workspaces,
    allWorkspaces: [...groups].map(([cwd]) => ({ id: cwd, name: projectName(cwd) })),
    currentWorkspace,
    currentThreadId: provider === 'claude' ? current.id : null,
  }
}
const snapshot = () =>
  combinedSnapshot(
    settings.enabledProviders,
    { claude: sourceSnapshot('claude'), codex: sourceSnapshot('codex') },
    settings.maxSessions,
  )
const world = () => ({ settings, snapshot: snapshot() })

// ----- serve the built renderer -----
const output = resolve(root, 'out/renderer')
const server = createServer((request, response) => {
  const target = resolve(output, '.' + new URL(request.url, 'http://localhost').pathname)
  if (target !== output && !target.startsWith(output + sep)) return response.writeHead(403).end()
  try {
    const file = statSync(target).isDirectory() ? join(target, 'index.html') : target
    response.setHeader(
      'content-type',
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] ||
        'application/octet-stream',
    )
    response.end(readFileSync(file))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))

rmSync(frames, { recursive: true, force: true })
mkdirSync(frames, { recursive: true })
const browser = await chromium.launch({ headless: true })
const manifest = []
try {
  const context = await browser.newContext({
    viewport: { width: 640, height: 1000 },
    deviceScaleFactor: SCALE,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => console.error('page error:', error))
  await page.exposeFunction('mockWorld', world)
  await page.exposeFunction('mockUpdate', (patch) => {
    const result = validatePatch(patch)
    if (!result.ok) return { ok: false, reason: result.reason }
    settings = { ...settings, ...result.patch }
    return { ok: true, ...world() }
  })
  await page.exposeFunction('mockView', (view) => {
    for (const provider of settings.enabledProviders)
      state.views[provider] = providerView(settings.enabledProviders, provider, view)
    return snapshot()
  })
  await page.addInitScript(
    ({ agent }) => {
      const listeners = new Map()
      const emit = (name, value) => {
        for (const fn of listeners.get(name) || []) fn(value)
      }
      let agentState = agent
      window.story = {
        emit,
        agent(next) {
          agentState = { ...agentState, ...next, revision: agentState.revision + 1 }
          emit('onAgent', agentState)
        },
        async refresh() {
          emit('onSnapshot', (await window.mockWorld()).snapshot)
        },
      }
      const drafts = new Map()
      window.threadlight = new Proxy(
        {
          getSettings: async () => (await window.mockWorld()).settings,
          getSnapshot: async () => (await window.mockWorld()).snapshot,
          getSessions: async () => (await window.mockWorld()).snapshot.sessions,
          getAttentionMotion: async () => ({ active: false }),
          updateSettings: async (patch) => {
            const result = await window.mockUpdate(patch)
            if (result.ok) {
              emit('onSnapshot', result.snapshot)
              emit('onSettings', result.settings)
            }
            return result
          },
          setTreeView: (view) => {
            void window.mockView(view).then((snapshot) => emit('onSnapshot', snapshot))
          },
          getComposerDraft: async (id) => ({
            ok: true,
            draft: drafts.get(id) || { text: '', revision: 0, updatedAt: 0 },
          }),
          saveComposerDraft: async (id, text, revision) => {
            const draft = { text, revision: revision + 1, updatedAt: Date.now() }
            drafts.set(id, draft)
            return { ok: true, draft }
          },
          getRelays: async () => [],
          getStt: async () => ({ state: 'ready' }),
          getOpenMicIndicator: async () => ({ live: false, level: 0 }),
          getMotion: async () => ({
            mode: 'idle',
            input: { level: 0, low: 0, mid: 0, high: 0 },
            output: { level: 0, low: 0, mid: 0, high: 0 },
          }),
          setPanelLayout: async (layout) => ({ cardWidth: layout === 'dual' ? 475 : 238 }),
          getAgent: async () => agentState,
          getUsage: async () => ({
            at: Date.now(),
            fiveHour: { used: 0.42, resetsAt: Date.now() + 3 * 3600_000 },
            week: { used: 0.61, resetsAt: Date.now() + 4 * 86400_000 },
          }),
          getVersion: async () => '0.9.0',
          agentApps: async () => [],
          agentModels: async () => ({ error: null, models: [] }),
          agentHistory: async () => [],
          agentReadPage: async () => ({ items: [], cursor: null }),
          spacesRequest: async () => ({ ok: false, reason: 'Not in the storybook' }),
          memoryRequest: async () => ({ ok: false, reason: 'Not in the storybook' }),
        },
        {
          get(target, name) {
            if (name in target) return target[name]
            if (String(name).startsWith('on'))
              return (fn) => {
                const set = listeners.get(name) || new Set()
                listeners.set(name, set)
                set.add(fn)
                return () => set.delete(fn)
              }
            return () => {}
          },
        },
      )
    },
    { agent: IDLE_AGENT },
  )
  if (process.env['STORYBOOK_INIT'])
    await page.addInitScript({ path: process.env['STORYBOOK_INIT'] })
  const base = `http://127.0.0.1:${server.address().port}/`
  await page.goto(base + '?view=panel')
  await page.locator('[data-card]').waitFor()

  // ----- the tools a scene gets -----
  const wait = (ms) => page.waitForTimeout(ms)
  const set = async (patch) => {
    await page.evaluate((patch) => window.threadlight.updateSettings(patch), patch)
    await wait(250)
  }
  const chooseView = async (name) => {
    await page.locator('header [data-thread-view]').click({ button: 'right' })
    // The view already showing is not listed in its own menu.
    const item = page.getByRole('menuitem', { name, exact: true })
    if ((await item.count()) === 0) await page.keyboard.press('Escape')
    else await item.click()
    await wait(450)
  }
  const row = (title) => page.locator('[data-session-id]').filter({ hasText: title }).first()
  // The pointer is parked off the card unless a scene is about the hover (`keep`), so a stray
  // hint never lands on a frame.
  const frame = async (id, { clipTo, keep } = {}) => {
    if (!keep) await page.mouse.move(630, 990)
    await wait(350)
    const stage = await page
      .locator(clipTo ?? '#root > div')
      .first()
      .boundingBox()
    const floating = await page
      .getByRole('tooltip')
      .or(page.getByRole('menu'))
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))
    const boxes = [stage, ...floating]
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 4)
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 4)
    const width = Math.max(...boxes.map((b) => b.x + b.width)) + 4 - x
    const height = Math.max(...boxes.map((b) => b.y + b.height)) + 4 - y
    const file = `${id}.png`
    await page.screenshot({ path: join(frames, file), clip: { x, y, width, height } })
    return { file, width: Math.round(width * SCALE), height: Math.round(height * SCALE) }
  }
  const tools = {
    page,
    wait,
    set,
    chooseView,
    row,
    frame,
    base,
    story: (fn, arg) => page.evaluate(fn, arg),
  }

  for (const scene of SCENES) {
    if (only.length && !only.some((word) => scene.id.includes(word))) continue
    console.log('scene', scene.id)
    try {
      const shots = await scene.run(tools)
      manifest.push({
        id: scene.id,
        title: scene.title,
        beat: scene.beat,
        seconds: scene.seconds,
        frames: shots,
      })
    } catch (error) {
      console.error(`  failed: ${String(error.message).split('\n')[0]}`)
      await page.screenshot({ path: join(frames, `${scene.id}.FAILED.png`) })
      await page.keyboard.press('Escape')
    }
  }
} finally {
  await browser.close()
  server.close()
}

writeFileSync(join(frames, 'manifest.json'), JSON.stringify(manifest, null, 2))
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
writeFileSync(
  join(frames, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Threadlight storybook</title>
<style>body{margin:0;padding:24px;background:#0f1115;color:#e6e8ec;font:14px/1.5 system-ui,sans-serif}
h1{font-size:20px}section{margin:28px 0;padding-top:16px;border-top:1px solid #262a33}
h2{font-size:15px;margin:0 0 2px}p{margin:0 0 10px;color:#9aa2b1;max-width:70ch}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}img{display:block;max-width:100%;border-radius:8px;outline:1px solid #262a33}
figcaption{font:11px ui-monospace,monospace;color:#9aa2b1;margin-top:4px}</style>
<h1>Threadlight storybook</h1>
${manifest
  .map(
    (s) =>
      `<section><h2>${esc(s.id)} · ${esc(s.title)} · ${s.seconds}s</h2><p>${esc(s.beat)}</p><div class="row">${s.frames
        .map(
          (f) =>
            `<figure><img src="${f.file}" width="${Math.round(f.width / SCALE)}"><figcaption>${f.file}</figcaption></figure>`,
        )
        .join('')}</div></section>`,
  )
  .join('\n')}`,
)
console.log(
  `${manifest.length} scenes, ${manifest.reduce((n, s) => n + s.frames.length, 0)} frames in storybook/frames/`,
)
