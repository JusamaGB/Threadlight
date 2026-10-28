import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
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
      entry: join(root, 'test/ui/app-control-restart.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'app-control-restart.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/app-control-restart.fixture.js')],
  env,
})
try {
  const proof = await app.evaluate(() => ({
    directory: globalThis.restartProof.directory,
    instanceId: globalThis.restartProof.instanceId,
  }))
  const operationId = randomUUID()
  const receipt = await app.evaluate(
    (_electron, operationId) =>
      globalThis.restartProof.call('threadlight_restart_app', { operationId }),
    operationId,
  )
  assert.equal(receipt.outcome, 'pending')
  // Lose the get_operation response: restart must still occur only once after HTTP finish.
  await app.evaluate((_electron, operationId) => {
    void globalThis.restartProof.call('threadlight_get_operation', { operationId })
  }, operationId)
  for (let i = 0; i < 200 && !existsSync(join(proof.directory, 'ready.json')); i++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(
    existsSync(join(proof.directory, 'ready.json')),
    'Relaunched fixture did not reach readiness',
  )
  const ready = JSON.parse(readFileSync(join(proof.directory, 'ready.json'), 'utf8'))
  assert.notEqual(ready.instanceId, proof.instanceId)
  assert.ok(existsSync(join(proof.directory, 'cleanup.txt')))
  const records = JSON.parse(readFileSync(join(proof.directory, 'operations.json'), 'utf8'))
  assert.equal(records.length, 1)
  assert.equal(records[0][1].result.operationId, operationId)
  assert.equal(records[0][1].result.outcome, 'ok')
  assert.equal(records[0][1].result.instanceId, ready.instanceId)
  console.log(
    'PASS: isolated Electron graceful relaunch, flushed durable receipt, lost response and new-instance readiness recovery.',
  )
} finally {
  await app.close().catch(() => {})
}
