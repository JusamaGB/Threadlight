// Opt-in, read-only observer of one explicitly selected local Codex chat.
// No messages, ownership claims, resume requests or provider database writes.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const id = process.env.THREADLIGHT_OBSERVE_THREAD
assert.match(id ?? '', /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i)
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { followCodexThread } = require(
  fileURLToPath(new URL('../../src/main/codex/threadStream.ts', import.meta.url)),
)
const result = {
  startedAt: new Date().toISOString(),
  livePublications: 0,
  recoveries: 0,
  visibleItems: 0,
  uniqueIds: true,
  observedTextUpdates: 0,
  roles: [],
  activityKinds: {},
  complete: false,
}
const previous = new Map(),
  roles = new Set()
const stop = followCodexThread(id, (update) => {
  if (update.connection !== 'live') {
    result.recoveries++
    return
  }
  result.livePublications++
  result.visibleItems = update.items.length
  result.uniqueIds &&= new Set(update.items.map((item) => item.id)).size === update.items.length
  for (const item of update.items) {
    assert.ok(['user', 'assistant', 'activity'].includes(item.role))
    roles.add(item.role)
    if (item.activity)
      result.activityKinds[item.activity] = (result.activityKinds[item.activity] ?? 0) + 1
    if (previous.has(item.id) && previous.get(item.id) !== item.text) result.observedTextUpdates++
    previous.set(item.id, item.text)
  }
})
await new Promise((resolve) => setTimeout(resolve, 25_000))
stop()
result.roles = [...roles]
result.complete = result.livePublications > 0 && result.uniqueIds && result.visibleItems > 0
result.endedAt = new Date().toISOString()
if (process.env.THREADLIGHT_TIMELINE_PROOF)
  writeFileSync(process.env.THREADLIGHT_TIMELINE_PROOF, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
assert.equal(result.complete, true)
