// Explicit read-only live proof. Writes counts/capabilities, never provider text or tokens.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  )
const { ChatGPTReader, PerplexityChatReader } = require('../../src/main/accountChats/adapters.ts')
const report = { readOnly: true, checkedAt: new Date().toISOString(), sources: {} }
async function check(source, connect) {
  let reader
  try {
    reader = await connect()
    const list = await reader.list()
    const target =
      list.chats.find((c) => /threadlight kimi/i.test(c.title)) ??
      list.chats.find((c) => /threadlight/i.test(c.title)) ??
      list.chats[0]
    const result = {
      listCount: list.chats.length,
      listHasMore: !!list.cursor,
      recentOnly: list.recentOnly,
    }
    if (target) {
      const read = await reader.read(target.id)
      result.messages = read.messages.length
      result.roles = [...new Set(read.messages.map((m) => m.role))]
      result.hasText = read.messages.some((m) => m.text.length > 0)
      result.hasOlder = !!read.cursor
      if (read.cursor) {
        const older = await reader.read(target.id, read.cursor)
        result.olderMessages = older.messages.length
        result.cursorAdvanced = !older.cursor || older.cursor !== read.cursor
        result.olderIdsDiffer = older.messages.every(
          (m) => !read.messages.some((n) => n.id === m.id),
        )
      }
    }
    report.sources[source] = result
  } catch (e) {
    report.sources[source] = {
      failed: true,
      reason: e.name === 'ZodError' ? 'Provider response schema mismatch' : e.message,
    }
    process.exitCode = 1
  } finally {
    reader?.close()
  }
}
async function main() {
  if (!process.env.CODEX_THREAD_ID) throw Error('Run from a real Codex chat context.')
  await check('chatgpt', () => ChatGPTReader.connect(process.env.CODEX_THREAD_ID))
  await check('perplexity', () => PerplexityChatReader.connect())
  const destination = path.resolve(
    process.env.THREADLIGHT_CHAT_PROOF ?? 'docs/validation/ACCOUNT-CHATS-LIVE-2026-11-04.json',
  )
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
