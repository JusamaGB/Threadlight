// Native ownership admission probe. Only disposable tool-free chats are used.
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
if (process.env.THREADLIGHT_COMMUNICATION_PROOF !== '1')
  throw new Error('Opt in to disposable-chat proofs.')
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText,
    file,
  )
const { findClaudeCli } = require('../../src/main/relay.ts')
const { findCodexCli } = require('../../src/main/codex/relay.ts')
const { defaultPaths, codexPaths } = require('../../src/main/sessions/paths.ts')
const root = mkdtempSync(join(tmpdir(), 'threadlight-ownership-'))
const env = { ...process.env }
for (const key of [
  'CODEX_THREAD_ID',
  'CODEX_TURN_ID',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CLAUDECODE',
])
  delete env[key]
function run(cli, args, prompt) {
  const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
    cwd: root,
    env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = '',
    err = ''
  child.stdout.on('data', (c) => {
    out += c
  })
  child.stderr.on('data', (c) => {
    err += c
  })
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
  const timer = setTimeout(() => child.kill(), 90000)
  const result = new Promise((resolve) => {
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, out, err: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
  return { child, result }
}
const report = []
for (const provider of (process.env.THREADLIGHT_PROVIDERS ?? 'claude,codex').split(',')) {
  const cli = await (provider === 'claude'
    ? findClaudeCli(defaultPaths())
    : findCodexCli(codexPaths()))
  if (!cli) {
    report.push({ provider, admitted: false, reason: 'CLI unavailable' })
    continue
  }
  const uuid = randomUUID()
  const seed = await run(
    cli,
    provider === 'claude'
      ? ['-p', '--session-id', uuid, '--output-format', 'json', '--tools', '']
      : ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-'],
    'Disposable ownership probe. Reply READY. No tools.',
  ).result
  const codexId = seed.out
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
    .find((e) => e.type === 'thread.started')?.thread_id
  const id = provider === 'claude' ? uuid : codexId
  if (seed.code !== 0 || !id) {
    report.push({ provider, admitted: false, reason: 'Seed failed', detail: seed.err })
    continue
  }
  console.log(`${provider}: probing simultaneous native resumes of disposable ${id}`)
  const args =
    provider === 'claude'
      ? [
          '--resume',
          id,
          ...(process.env.THREADLIGHT_EXPLICIT_SESSION === '1' ? ['--session-id', id] : []),
          '-p',
          '--output-format',
          'json',
          '--tools',
          '',
        ]
      : ['exec', 'resume', '--skip-git-repo-check', '--json', id, '-']
  const one = run(
    cli,
    args,
    'Ownership probe A. No tools. Write twenty short lines about the numbers 1 through 20.',
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  const two = run(cli, args, 'Ownership probe B. No tools. Reply PROBE-B.')
  const [first, second] = await Promise.all([one.result, two.result])
  const rejected = [first, second].find(
    (r) =>
      r.code !== 0 &&
      /already.*(?:use|writer|running)|lock|conflict|active.*session/i.test(r.err + r.out),
  )
  report.push({
    provider,
    id,
    binaryHash: createHash('sha256').update(readFileSync(cli.command)).digest('hex'),
    admitted: !!rejected && [first, second].some((r) => r.code === 0),
    first,
    second,
  })
}
writeFileSync(join(root, 'ownership.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      root,
      results: report.map(({ first, second, ...r }) => ({
        ...r,
        firstExit: first?.code,
        secondExit: second?.code,
      })),
    },
    null,
    2,
  ),
)
