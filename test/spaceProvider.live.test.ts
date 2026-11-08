import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { startSpaceChat, openSpaceProvider } from '../src/main/appControl/startSpaceChat'
import { PerplexityChatReader } from '../src/main/accountChats/adapters'
import { AccountChats } from '../src/main/accountChats/service'
import { AccountChatTransport } from '../src/main/communication/accountChatTransport'
import { CommunicationService } from '../src/main/communication/service'
import { CommunicationStore } from '../src/main/communication/store'
import { findClaudeCli } from '../src/main/relay'
import { defaultPaths } from '../src/main/sessions/paths'
import type { CommunicationActor, CommunicationMessage } from '../src/shared/communication'

for (const provider of ['claude', 'perplexity'] as const)
  it.skipIf(process.env.THREADLIGHT_LIVE_SPACE_CHAT !== provider)(
    `creates an actual ${provider} conversation for a temporary Shared Space`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'threadlight-space-live-')),
        id = randomUUID(),
        spaceId = randomUUID()
      const db = new DatabaseSync(join(root, 'space.sqlite')),
        store = new CommunicationStore(db)
      const project = { root, paused: false, maxDispatches: 3, expiresAt: Date.now() + 600000 }
      const chats = new AccountChats({
        contexts: async () => [],
        enabled: (s) => s === 'perplexity',
        connect: () => PerplexityChatReader.connect(),
      })
      const transport = new AccountChatTransport(chats),
        service = new CommunicationService(store, {
          project: () => project,
          authorize: () => {},
          input: () => {
            throw Error('No test input')
          },
          destinations: (target, query) => transport.find(target, query),
          deliver: (message, destination, accepted) =>
            transport.deliver(message, destination, accepted),
        })
      let dispatches = 0
      const paths = defaultPaths(),
        marker = 'TL-OPEN-' + id.slice(0, 8)
      try {
        const result = await startSpaceChat(
          {
            provider,
            spaceId,
            role: 'Acceptance test',
            openingMessage: 'Threadlight acceptance check. Reply with exactly ' + marker,
          },
          id,
          {
            project: () => project,
            enabled: () => true,
            workflow: (key) => service.workflow(key),
            reserve: () => {
              dispatches++
            },
            start: (input, cwd, operation, beforeSend) =>
              openSpaceProvider(input, cwd, operation, beforeSend, {
                paths,
                chats,
                claude: () => findClaudeCli(paths),
              }),
            save: (workflow, revision) => {
              service.configure(workflow, revision, { id: 'human', kind: 'human' })
            },
          },
        )
        console.info('Shared Space acceptance', {
          provider,
          spaceId,
          operation: id,
          outcome: result.outcome,
          reason: result.reason,
          dispatches,
          target: result.target,
          linked: result.linked,
          workspace: root,
        })
        expect(result, result.reason).toMatchObject({ outcome: 'ok', linked: true })
        expect(dispatches).toBe(1)
        expect(service.workflow(spaceId)?.participants.map((p) => p.target)).toEqual([
          result.target,
        ])
        if (provider === 'claude') {
          let matched = false
          for (const dir of await readdir(paths.projectsDir, { withFileTypes: true })) {
            if (!dir.isDirectory()) continue
            const body = await readFile(
              join(paths.projectsDir, dir.name, id + '.jsonl'),
              'utf8',
            ).catch(() => null)
            if (!body) continue
            matched = body
              .trim()
              .split(/\r?\n/)
              .some((line) => {
                const row = JSON.parse(line)
                return (
                  row.sessionId === id &&
                  row.type === 'assistant' &&
                  Array.isArray(row.message?.content) &&
                  row.message.content.some(
                    (v: { type?: string; text?: string }) =>
                      v.type === 'text' && v.text?.trim() === marker,
                  )
                )
              })
            if (matched) break
          }
          expect(matched, 'Claude must persist the exact provider reply').toBe(true)
          return
        }
        const actor: CommunicationActor = {
          id: 'test-agent',
          kind: 'agent',
          spaceId,
          target: 'codex:' + randomUUID(),
        }
        const reachable = async () =>
          (await service.execute('get_destination', { spaceId, target: result.target }, actor)) as {
            id: string
            send: boolean
          }[]
        await expect
          .poll(async () => (await reachable())[0]?.send, { timeout: 90000, interval: 1000 })
          .toBe(true)
        const followup = 'TL-REPLY-' + id.slice(0, 8)
        const sent = (await service.execute(
          'send_message',
          {
            operationId: randomUUID(),
            targets: [result.target],
            spaceId,
            intent: 'send',
            body: 'Reply with exactly ' + followup,
          },
          actor,
        )) as CommunicationMessage
        await service.tick()
        const deadline = Date.now() + 100000
        while (Date.now() < deadline) {
          const record = (await service.execute('get_message', { id: sent.id }, actor)) as {
            message: CommunicationMessage
            replies: CommunicationMessage[]
          }
          if (
            record.replies.some(
              (r) =>
                r.replyTo === sent.id &&
                r.senderTarget === result.target &&
                r.body.trim() === followup &&
                r.deliveries.some((d) => d.target === actor.target && d.phase === 'inbox'),
            )
          ) {
            const inbox = await service.execute('read_inbox', { spaceId }, actor)
            expect(inbox).toMatchObject({
              messages: expect.arrayContaining([
                expect.objectContaining({
                  replyTo: sent.id,
                  senderTarget: result.target,
                  body: expect.stringContaining(followup),
                }),
              ]),
            })
            return
          }
          const failure = record.message.deliveries.find((d) =>
            ['rejected', 'unknown', 'cancelled'].includes(d.phase),
          )
          if (failure) throw Error('Follow-up delivery: ' + failure.reason)
          await delay(1000)
        }
        throw Error('No matching Perplexity reply in the sender inbox.')
      } finally {
        service.close()
        transport.close()
        chats.close()
        db.close()
      }
    },
    400000,
  )
