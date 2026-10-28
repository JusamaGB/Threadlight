import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const { _electron } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    ssr: true,
    target: 'node22',
    outDir: join(root, 'out/main'),
    emptyOutDir: false,
    lib: {
      entry: join(root, 'test/ui/app-control.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'app-control.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/app-control.fixture.js')],
  env,
})
const call = (name, input = {}) =>
  app.evaluate(
    (_electron, { name, input }) =>
      globalThis.controlProof.service.call(globalThis.controlProof.caller, name, input),
    { name, input },
  )
const navigate = async (route) => {
  const result = await call('threadlight_navigate', { operationId: randomUUID(), route })
  if (!['ok', 'not_found'].includes(result.outcome))
    console.log('Navigation diagnostic:', JSON.stringify({ route, result }))
  return result
}
const wait = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw Error('Fixture readiness timeout')
}
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.log('Renderer error:', error.message)
  })
  await wait(async () => (await call('threadlight_get_app_state')).data.renderer === 'available')
  assert.equal((await navigate({ page: 'spaces', area: 'library' })).outcome, 'ok')
  assert.equal((await navigate({ page: 'spaces', area: 'create' })).outcome, 'ok')
  const input = page.getByPlaceholder('For example, Threadlight advert')
  {
    await input.fill('Unsent space draft')
    await navigate({ page: 'settings' })
    await navigate({ page: 'spaces', area: 'create' })
    assert.equal(await input.inputValue(), 'Unsent space draft')
  }
  assert.equal((await navigate({ page: 'list', mode: 'recent' })).outcome, 'ok')
  assert.equal((await navigate({ page: 'agent' })).outcome, 'ok')
  const agentDraft = page.getByPlaceholder('Ask your agent…')
  await agentDraft.fill('Unsent Agent draft')
  await agentDraft.evaluate((input) => input.setSelectionRange(3, 8))
  await navigate({ page: 'settings' })
  await navigate({ page: 'agent' })
  assert.equal(await agentDraft.inputValue(), 'Unsent Agent draft')
  assert.deepEqual(
    await agentDraft.evaluate((input) => [input.selectionStart, input.selectionEnd]),
    [3, 8],
  )
  assert.equal((await navigate({ page: 'list', mode: 'all' })).outcome, 'ok')
  const workspace = (await call('threadlight_list_workspaces')).data.items[0].id
  assert.equal((await navigate({ page: 'workspace', workspaceId: workspace })).outcome, 'ok')
  assert.equal((await navigate({ page: 'chat', threadRef: 'resolved' })).outcome, 'ok')
  const artifacts = (await call('threadlight_list_artifacts', { threadRef: 'resolved' })).data.items
  assert.ok(artifacts.length)
  assert.equal(
    (await navigate({ page: 'artifact', threadRef: 'resolved', artifactId: artifacts[0].id }))
      .outcome,
    'ok',
  )
  await page.getByText('Exact fixture artifact', { exact: true }).waitFor()
  assert.equal(
    (await navigate({ page: 'artifact', threadRef: 'resolved', artifactId: 'missing' })).outcome,
    'not_found',
  )
  for (const scope of ['thread', 'worktree', 'card'])
    assert.equal(
      (
        await navigate({
          page: 'changes',
          threadRef: 'resolved',
          scope,
          ...(scope === 'card' ? { cardId: 'first' } : {}),
        })
      ).outcome,
      'ok',
    )
  await page.getByRole('region', { name: 'Card changes' }).getByRole('button').first().click()
  assert.match(
    await page.getByRole('region', { name: 'Card changes' }).innerText(),
    /first-changed/,
  )
  assert.doesNotMatch(
    await page.getByRole('region', { name: 'Card changes' }).innerText(),
    /second-changed/,
  )
  assert.equal(
    (await call('threadlight_navigate', { operationId: randomUUID(), direction: 'back' })).outcome,
    'ok',
  )
  // A separate real WebContents with the same preload cannot impersonate the trusted panel.
  const guest = await app.evaluate(
    async ({ BrowserWindow }, preload) => {
      const panel = globalThis.controlProof.panel
      const other = new BrowserWindow({
        show: false,
        webPreferences: { preload, contextIsolation: true, sandbox: true },
      })
      await other.loadURL(panel.webContents.getURL())
      const result = await other.webContents.executeJavaScript('window.threadlight.controlHello()')
      other.destroy()
      return result
    },
    join(root, 'out/preload/index.js'),
  )
  assert.equal(guest, null)
  const operationId = randomUUID()
  assert.equal((await call('threadlight_restart_app', { operationId })).outcome, 'pending')
  await app.evaluate(() => globalThis.controlProof.decisions.at(-1)(true))
  await wait(
    async () =>
      (await call('threadlight_get_operation', { operationId })).reason === 'restart_scheduled',
  )
  const recovered = await app.evaluate(async () => {
    const p = globalThis.controlProof
    return { count: p.restartCount(), file: p.directory }
  })
  assert.equal(recovered.count, 0, 'A queued restart must not run before the receipt is flushed')
  await app.evaluate(() => globalThis.controlProof.service.revoke(globalThis.controlProof.caller))
  assert.equal((await call('threadlight_get_app_state')).outcome, 'denied')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: real preload/panel navigation, captured-card scope, drafts, sender rejection, revocation and pending restart receipt.',
  )
} finally {
  await app.close()
}
