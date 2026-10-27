// Explicit opt-in. Only fresh disposable CLI conversations; never resumes a real chat.
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

if (process.env.THREADLIGHT_MEMORY_LIVE !== '1')
  throw new Error('Set THREADLIGHT_MEMORY_LIVE=1 only for an authorised disposable-chat proof.')
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
const directory = mkdtempSync(join(tmpdir(), 'threadlight-memory-proof-')),
  store = new MemoryStore(join(directory, 'memory.sqlite')),
  server = new MemoryServer(store)
const run = (cli, args, prompt, token) =>
  new Promise((resolveResult) => {
    const env = { ...process.env, THREADLIGHT_MEMORY_TOKEN: token }
    for (const key of [
      'CODEX_THREAD_ID',
      'CODEX_TURN_ID',
      'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
      'CLAUDECODE',
    ])
      delete env[key]
    const child = spawn(cli.command, [...cli.prefixArgs, ...args], {
      cwd: directory,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = '',
      finished = false
    const done = (code) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolveResult({ code, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill()
      done('timeout')
    }, 180000)
    child.stdout.on('data', (data) => (stdout = (stdout + data).slice(-1000000)))
    child.stderr.on('data', (data) => (stderr = (stderr + data).slice(-32000)))
    child.once('error', (error) => {
      stderr = error.message
      done('error')
    })
    child.once('close', done)
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
const execute = (input) => store.execute({ ...input, operationId: randomUUID() })
try {
  const url = await server.start(0),
    space = execute({ action: 'create_space', title: 'Disposable integration proof' }),
    folder = execute({
      action: 'ensure_folder',
      spaceId: space.id,
      title: 'Evidence',
      description: 'Synthetic test material only.',
      reason: 'Integration acceptance test.',
    }).folder
  const item = execute({
    action: 'create_item',
    folderId: folder.id,
    title: 'Shared recall marker',
    body: 'The synthetic verification phrase is LIGHTHOUSE-286.',
  })
  const results = []
  for (const provider of process.env.THREADLIGHT_MEMORY_PROVIDER
    ? [process.env.THREADLIGHT_MEMORY_PROVIDER]
    : ['claude', 'codex']) {
    const cli = await (provider === 'claude'
      ? findClaudeCli(defaultPaths())
      : findCodexCli(codexPaths()))
    if (!cli) {
      results.push({ provider, status: 'CLI unavailable' })
      continue
    }
    const credentials = execute({
      action: 'create_grant',
      spaceId: space.id,
      folderId: folder.id,
      title: `Disposable ${provider}`,
      readOnly: false,
      createFolders: true,
    })
    const configuration = JSON.stringify({
      mcpServers: {
        threadlight: {
          type: 'http',
          url,
          headers: { Authorization: 'Bearer ${THREADLIGHT_MEMORY_TOKEN}' },
        },
      },
    })
    const args =
      provider === 'claude'
        ? [
            '-p',
            '--output-format',
            'json',
            '--no-session-persistence',
            '--strict-mcp-config',
            '--mcp-config',
            configuration,
            '--allowedTools',
            'mcp__threadlight__*',
            '--tools',
            '',
          ]
        : [
            '-c',
            `mcp_servers.threadlight.url=${JSON.stringify(url)}`,
            '-c',
            'mcp_servers.threadlight.bearer_token_env_var="THREADLIGHT_MEMORY_TOKEN"',
            '-c',
            'mcp_servers.threadlight.default_tools_approval_mode="approve"',
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--sandbox',
            'read-only',
            '--json',
            '-',
          ]
    const prompt = `This is an authorised disposable Threadlight integration test. Use only the Threadlight memory tools; do not use shell, filesystem, other tools or other chats. Read item ${item.id} at revision 1. Create or reuse a subfolder titled "${provider} proof" under ${folder.id} in space ${space.id}, with a short description and reason. Publish one note there titled "${provider} recalled evidence" containing the exact synthetic verification phrase from the item. Use fresh operationId UUIDs for writes. Finally reply with that verification phrase and the published item ID. Do nothing else.`
    console.log(`Testing ${provider} with a fresh disposable conversation…`)
    const result = await run(cli, args, prompt, credentials.token)
    const saved = store.snapshot().items.find((i) => i.title === `${provider} recalled evidence`)
    const verified = !!saved && store.read({}, saved.id).revision.body.includes('LIGHTHOUSE-286')
    results.push({
      provider,
      code: result.code,
      verified,
      detail: verified
        ? 'Exact revision read, folder created and attributed note saved.'
        : (result.stderr || result.stdout).slice(-1400),
    })
    writeFileSync(
      join(directory, `${provider}-result.json`),
      JSON.stringify(
        {
          ...result,
          stdout: result.stdout.replaceAll(credentials.token, '[redacted]'),
          stderr: result.stderr.replaceAll(credentials.token, '[redacted]'),
        },
        null,
        2,
      ),
    )
    if (verified) {
      const fresh = await run(
        cli,
        args,
        `Authorised disposable recall test. Use only Threadlight memory_read to read ${saved.id} revision 1 and return its exact synthetic verification phrase. Do not modify anything or use other tools.`,
        credentials.token,
      )
      results.push({
        provider,
        freshRecall: fresh.stdout.includes('LIGHTHOUSE-286'),
        code: fresh.code,
      })
    }
    execute({ action: 'revoke_grant', id: credentials.id })
  }
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ directory: resolve(directory), results }, null, 2))
} finally {
  server.close()
  store.close()
}
