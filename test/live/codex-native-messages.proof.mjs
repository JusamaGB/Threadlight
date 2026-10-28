// Only the explicitly authorized disposable test chat is addressed.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import ts from 'typescript'
const load = createRequire(import.meta.url)
load.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { NativeCodexMessages } = load('../../src/main/codex/nativeMessages.ts')
assert.equal(process.env.THREADLIGHT_NATIVE_MESSAGES_PROOF, '1', 'Explicit live opt-in required')
const id = '01a182bd-bc7e-77f2-a94e-2ee42f2709eb',
  key = `codex:${id}`
const history = path.join(process.env.USERPROFILE, '.codex/thread_history_1.sqlite')
const output = path.resolve(
  import.meta.dirname,
  '../../notes-local/native-cards-investigation/direct-messages',
)
const db = new DatabaseSync(history, { readOnly: true })
const latest = () =>
  db
    .prepare(
      'SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
    )
    .get(id)
const service = new NativeCodexMessages(history, output, () => {})
async function until(check) {
  for (let i = 0; i < 180; i++) {
    const value = check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 250))
  }
  throw Error('Timed out waiting for native evidence')
}
try {
  assert.notEqual(latest()?.status, 'inProgress', 'Do not interrupt another test')
  const first =
    'Threadlight direct message production test. Please wait in this same turn for a follow-up message using clock.sleep in chunks of 10 seconds, for up to 2 minutes. Do not create a card. When a follow-up arrives, reply exactly: Native start and follow-up received.'
  const at = Date.now()
  assert.deepEqual(await service.send(key, first), { ok: true })
  const startMs = Date.now() - at
  const receipt = JSON.parse(fs.readFileSync(path.join(output, `${id}.json`), 'utf8'))
  await until(() => latest()?.turn_id === receipt.turnId && latest()?.status === 'inProgress')
  // Allow the initial user message to begin before steering the follow-up.
  await new Promise((r) => setTimeout(r, 2000))
  const at2 = Date.now()
  assert.deepEqual(
    await service.send(key, 'Threadlight follow-up: please acknowledge both native messages now.'),
    { ok: true },
  )
  const steerMs = Date.now() - at2
  const second = JSON.parse(fs.readFileSync(path.join(output, `${id}.json`), 'utf8'))
  assert.equal(second.turnId, receipt.turnId)
  const messages = await until(() => {
    const rows = db
      .prepare(
        "SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type='userMessage'",
      )
      .all(id, receipt.turnId)
      .map((r) => JSON.parse(r.item_json))
    return [receipt.clientId, second.clientId].every((client) =>
      rows.some((r) => r.clientId === client),
    )
      ? rows
      : null
  })
  await until(() => latest()?.status === 'completed')
  service.refresh()
  assert.equal(service.list()[0]?.state, 'replied')
  const report = {
    threadId: id,
    turnId: receipt.turnId,
    startMs,
    steerMs,
    acceptedMessageIds: messages.map((r) => r.clientId),
    reply: service.list()[0]?.detail,
  }
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  db.close()
}
