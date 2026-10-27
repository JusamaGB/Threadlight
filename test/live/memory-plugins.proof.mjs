// Explicit opt-in. Synthetic material, fresh chats, invocation-only config and approval fixture.
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

if (process.env.THREADLIGHT_MEMORY_LIVE !== '1')
  throw new Error('This proof requires explicit disposable-chat opt-in.')
const require = createRequire(import.meta.url),
  ts = require('typescript')
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  )
const { MemoryStore } = require('../../src/main/memory/store.ts'),
  { MemoryServer } = require('../../src/main/memory/server.ts')
const { findClaudeCli } = require('../../src/main/relay.ts'),
  { findCodexCli } = require('../../src/main/codex/relay.ts'),
  { defaultPaths, codexPaths } = require('../../src/main/sessions/paths.ts')
const root = resolve('.'),
  directory = mkdtempSync(join(tmpdir(), 'threadlight-plugin-live-'))
const store = new MemoryStore(join(directory, 'memory.sqlite')),
  server = new MemoryServer(store)
const execute = (input) => store.execute({ ...input, operationId: randomUUID() })
const results = []
async function run(cli, args, prompt, endpoint) {
  const env = { ...process.env, THREADLIGHT_MEMORY_URL: endpoint }
  for (const key of [
    'CODEX_THREAD_ID',
    'CODEX_TURN_ID',
    'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
    'CLAUDECODE',
  ])
    delete env[key]
  return await new Promise((done) => {
    const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
      cwd: directory,
      env,
      windowsHide: true,
      shell: false,
      stdio: 'pipe',
    })
    let stdout = '',
      stderr = '',
      finished = false
    const finish = (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      done({ code, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill()
      finish('timeout')
    }, 180000)
    child.stdout.on('data', (b) => (stdout = (stdout + b).slice(-500000)))
    child.stderr.on('data', (b) => (stderr = (stderr + b).slice(-12000)))
    child.once('error', (e) => {
      stderr = e.message
      finish('error')
    })
    child.once('close', finish)
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
}
try {
  const endpoint = await server.start(0)
  for (const provider of (process.env.THREADLIGHT_MEMORY_PROVIDERS || 'claude,codex').split(',')) {
    const space = execute({ action: 'create_space', title: `Disposable ${provider} plugin` })
    const folder = execute({
      action: 'ensure_folder',
      spaceId: space.id,
      title: 'Evidence',
      description: 'Synthetic plugin evidence',
      reason: 'Authorized proof',
    }).folder
    const seed = execute({
      action: 'create_item',
      folderId: folder.id,
      title: 'Verification input',
      body: 'Verification phrase: PRISM-742. Save an attributed note with this exact phrase.',
    })
    // The test human preauthorizes ONLY this fresh provider's synthetic evidence folder.
    server.connections.onChange = () => {
      for (const r of server.connections.list())
        if (
          r.state === 'pending' &&
          r.provider === provider &&
          r.label === 'Disposable plugin proof'
        )
          server.connections.approve(r.id, {
            action: 'create_grant',
            spaceId: space.id,
            folderId: folder.id,
            title: `Disposable ${provider} plugin`,
            readOnly: false,
            createFolders: true,
          })
    }
    const cli = await (provider === 'claude'
      ? findClaudeCli(defaultPaths())
      : findCodexCli(codexPaths()))
    if (!cli) throw new Error(`${provider} CLI unavailable`)
    const bridge = join(root, 'codex-plugin/scripts/memory-bridge.mjs').replaceAll('\\', '/')
    const args =
      provider === 'claude'
        ? [
            '-p',
            '--output-format',
            'json',
            '--no-session-persistence',
            '--plugin-dir',
            root,
            '--settings',
            JSON.stringify({ disableAllHooks: true }),
            '--allowedTools',
            'mcp__plugin_threadlight_threadlight__*',
            '--tools',
            '',
          ]
        : [
            '-c',
            `mcp_servers.threadlight={command="node",args=[${JSON.stringify(bridge)},"--provider","codex"],env={THREADLIGHT_MEMORY_URL=${JSON.stringify(endpoint)}},default_tools_approval_mode="approve"}`,
            'exec',
            '--ephemeral',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            '--json',
            '-',
          ]
    const prompt = `This is an authorized disposable Threadlight plugin integration test. Use only Threadlight memory tools. Do not use shell, filesystem, other services, other chats or UI. The test human has preauthorized a fixture that approves ONLY your synthetic connection labelled "Disposable plugin proof". Call memory_connect with that label; observe its approved state (check the returned connectionId once if needed). Call memory_briefing with that connectionId, read item ${seed.id} revision 1, create or reuse a folder named "Plugin output" under the authorized Evidence folder, and publish one note titled "${provider} plugin result" there containing the exact verification phrase. Use UUID operation IDs. Do not approve yourself or request broader access. Finally report the saved item ID and phrase, then memory_disconnect. Do nothing else.`
    console.log(`Testing ${provider} with fresh disposable chat…`)
    const outcome = await run(cli, args, prompt, endpoint)
    const item = store.snapshot().items.find((i) => i.title === `${provider} plugin result`)
    const verified = !!item && store.read({}, item.id).revision.body.includes('PRISM-742')
    const summary = {
      provider,
      verified,
      code: outcome.code,
      mode:
        provider === 'claude'
          ? 'native plugin-dir'
          : 'packaged bridge via invocation-only MCP; native package discovery verified separately',
      itemId: item?.id,
    }
    results.push(summary)
    writeFileSync(join(directory, `${provider}.json`), JSON.stringify(outcome, null, 2))
    console.log(JSON.stringify(summary))
  }
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ directory, results }))
  if (results.some((r) => !r.verified)) process.exitCode = 1
} finally {
  server.connections.onChange = () => {}
  server.close()
  store.close()
}
