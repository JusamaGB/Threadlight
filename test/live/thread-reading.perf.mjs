// Synthetic service benchmark; no provider account or model calls.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText,
    file,
  )
const { ThreadReadService } = require('../../src/main/threadRead/service.ts')
const { CodexReadAdapter } = require('../../src/main/threadRead/codex.ts')
const { codexPaths } = require('../../src/main/sessions/paths.ts')
const root = await mkdtemp(join(tmpdir(), 'thread-reading-perf-')),
  paths = codexPaths({ CODEX_HOME: root })
await mkdir(paths.sessions, { recursive: true })
const transcript = join(paths.sessions, 'synthetic.jsonl'),
  record =
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'x'.repeat(2048) },
    }) + '\n'
await writeFile(
  transcript,
  record.repeat(10_000) +
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'Synthetic final answer' }],
      },
    }) +
    '\n',
)
const db = new DatabaseSync(paths.state)
db.exec(
  'CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,archived INTEGER,updated_at INTEGER,rollout_path TEXT); BEGIN',
)
const insert = db.prepare('INSERT INTO threads VALUES(?,?,?,0,1,?)')
for (let i = 0; i < 5001; i++)
  insert.run(String(i).padStart(6, '0'), `Synthetic benchmark ${i}`, 'C:/synthetic', transcript)
db.exec('COMMIT')
db.close()
const service = new ThreadReadService([new CodexReadAdapter(paths)], () => ['codex']),
  scope = service.open()
const find = async () => {
  let result = await service.find(scope, { query: 'Synthetic benchmark 5000' })
  while (result.resolution === 'incomplete' && result.nextCursor)
    result = await service.find(scope, {
      query: 'Synthetic benchmark 5000',
      cursor: result.nextCursor,
    })
  if (result.resolution !== 'unique') throw new Error('Benchmark discovery incomplete')
  return result.resolvedRef
}
const started = performance.now(),
  ref = await find(),
  cold = performance.now() - started,
  lookups = [],
  reads = []
for (let i = 0; i < 10; i++) {
  let at = performance.now()
  await find()
  lookups.push(performance.now() - at)
  at = performance.now()
  await service.read(scope, { threadRef: ref, view: 'status' })
  reads.push(performance.now() - at)
}
const p95 = (values) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
const report = {
  catalogueSize: 5001,
  transcriptBytes: Buffer.byteLength(record) * 10000,
  iterations: 10,
  coldLookupMs: cold,
  warmLookupP95Ms: p95(lookups),
  statusReadP95Ms: p95(reads),
  targetsMet: cold < 2000 && p95(lookups) < 500 && p95(reads) < 500,
}
console.log(JSON.stringify(report, null, 2))
if (process.env.THREADLIGHT_PERF_REPORT)
  await writeFile(process.env.THREADLIGHT_PERF_REPORT, JSON.stringify(report, null, 2))
if (!report.targetsMet) process.exitCode = 1
