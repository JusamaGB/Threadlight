// Explicitly authorized live writes, with isolated Shared Space/journal and no app restart.
// Run once per source; an existing evidence file prevents an accidental repeat.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { randomUUID } = require('node:crypto')
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
const { AccountChats } = require('../../src/main/accountChats/service.ts')
const { ChatDelivery } = require('../../src/main/accountChats/delivery.ts')
const { ChatGPTReader, PerplexityChatReader } = require('../../src/main/accountChats/adapters.ts')
const { AccountChatTransport } = require('../../src/main/communication/accountChatTransport.ts')
const { CommunicationService } = require('../../src/main/communication/service.ts')
const { MemoryStore } = require('../../src/main/memory/store.ts')

async function main() {
  if (process.env.THREADLIGHT_MESSAGE_PROOF !== '1')
    throw Error('Explicit live-message authorization is required.')
  const source = process.argv[2],
    root = path.resolve(process.argv[3] || '')
  if (!['chatgpt', 'perplexity'].includes(source) || !process.argv[3])
    throw Error('Choose a source and an isolated evidence directory.')
  const caller = process.env.CODEX_THREAD_ID
  if (!caller) throw Error('A real current Codex context is required.')
  fs.mkdirSync(root, { recursive: true })
  const reportFile = path.join(root, `${source}.json`)
  fs.writeFileSync(reportFile, JSON.stringify({ state: 'started', at: new Date().toISOString() }), {
    flag: 'wx',
  })
  const chats = new AccountChats({
    contexts: async () => [{ id: caller, title: 'Authorized proof caller' }],
    enabled: (s) => s === source,
    delivery: new ChatDelivery(path.join(root, `${source}-delivery.json`)),
    connect: (s, context) =>
      s === 'chatgpt' ? ChatGPTReader.connect(context) : PerplexityChatReader.connect(),
  })
  const transport = new AccountChatTransport(chats, { pollMs: 1000, timeoutMs: 180000 })
  const memory = new MemoryStore(path.join(root, `${source}-memory.sqlite`))
  let service
  try {
    const listed = await chats.request({ action: 'list', source })
    if (!listed.ok) throw Error(listed.reason)
    const rows = await transport.find()
    const expected = source === 'chatgpt' ? 'Test Thread' : 'Just testing'
    const targets = rows.filter((d) => d.title.toLowerCase() === expected.toLowerCase())
    if (targets.length !== 1)
      throw Error(`Expected exactly one ${expected} conversation; no message sent.`)
    const target = targets[0].id
    const space = memory.execute({
      action: 'create_space',
      operationId: randomUUID(),
      title: 'Isolated authorized communication proof',
    })
    memory.execute({
      action: 'update_space',
      id: space.id,
      operationId: randomUUID(),
      paused: false,
      mode: 'manual',
      maxDispatches: 1,
      durationMinutes: 4,
    })
    service = new CommunicationService(memory.communications, {
      destinations: (id, query) => transport.find(id, query),
      deliver: (message, destination, accepted) =>
        transport.deliver(message, destination, accepted),
      authorize: (actor, id) => memory.authorizeCommunication(actor, id),
      input: (actor, id, revision) => memory.communicationInput(actor, id, revision),
      project: (id) => memory.space(id),
    })
    memory.communicationService = service
    const work = `codex:${caller}`,
      actor = { id: 'human', kind: 'human', target: work, spaceId: space.id }
    service.configure(
      {
        id: randomUUID(),
        spaceId: space.id,
        revision: 1,
        mode: 'manual',
        paused: false,
        participants: [
          {
            id: randomUUID(),
            target: work,
            role: 'Proof sender',
            model: 'unchanged',
            communicate: true,
            requestWork: true,
          },
          {
            id: randomUUID(),
            target,
            role: 'Text recipient',
            model: 'Current native model',
            modelPolicy: 'current',
            communicate: true,
            requestWork: false,
          },
        ],
        maxConcurrent: 1,
        maxDispatches: 1,
        expiresAt: Date.now() + 240000,
        recover: false,
        acceptBy: 'human',
      },
      0,
      actor,
    )
    const marker = `THREADLIGHT-ROUNDTRIP-${randomUUID().slice(0, 8)}`
    const message = await service.execute(
      'send_message',
      {
        operationId: randomUUID(),
        targets: [target],
        spaceId: space.id,
        body: `Kris authorized this bounded Threadlight messaging test. Please reply with exactly: ${marker}. Do not use tools or send other messages.`,
        intent: 'send',
      },
      actor,
    )
    await service.tick()
    const deadline = Date.now() + 210000
    let record
    while (Date.now() < deadline) {
      record = await service.execute('get_message', { id: message.id }, actor)
      if (
        ['completed', 'unknown', 'rejected', 'held', 'inbox'].includes(
          record.message.deliveries[0].phase,
        )
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const report = {
      source,
      destinationTitle: expected,
      checkedAt: new Date().toISOString(),
      phase: record.message.deliveries[0].phase,
      correlatedReplies: record.replies.length,
      markerReturned: record.replies.some((r) => r.body.includes(marker)),
      returnedToOriginalSender: record.replies.some((r) => r.deliveries[0]?.target === work),
      reason: record.message.deliveries[0].reason,
      isolatedSharedSpace: true,
      restartedRegularApp: false,
    }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
    if (report.phase !== 'completed' || !report.markerReturned || !report.returnedToOriginalSender)
      process.exitCode = 1
  } catch (error) {
    const report = {
      source,
      failed: true,
      reason: error.name === 'ZodError' ? 'Provider response schema mismatch' : error.message,
    }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
    process.exitCode = 1
  } finally {
    service?.close()
    transport.close()
    chats.close()
    memory.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
