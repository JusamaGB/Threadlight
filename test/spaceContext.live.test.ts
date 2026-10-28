import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { MemoryStore } from '../src/main/memory/store'
import { SpacesStore } from '../src/main/spaces/store'
import { SpaceContextService } from '../src/main/spaces/context'
import { SpaceContextServer } from '../src/main/spaces/contextServer'
import { AgentRun } from '../src/main/agent/agentRun'
import { CodexAgentRun } from '../src/main/agent/codexAgentRun'
import { CodexClient } from '../src/main/agent/codexClient'
import { AgentStore } from '../src/main/agent/agentStore'
import { findClaudeCli } from '../src/main/relay'
import { findCodexCli } from '../src/main/codex/relay'
import { defaultPaths, codexPaths } from '../src/main/sessions/paths'
import type { MemorySpace } from '../src/shared/memory'

for (const provider of ['claude', 'codex'] as const)
  it.skipIf(process.env.THREADLIGHT_LIVE_SPACE !== provider)(
    `${provider} executes scoped Brainstorm reads with the installed runtime`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'threadlight-brainstorm-live-'))
      const store = new SpacesStore(join(root, 'spaces.sqlite')),
        memory = new MemoryStore(join(root, 'memory.sqlite'))
      const space = memory.execute({
        action: 'create_space',
        operationId: randomUUID(),
        title: 'Synthetic space',
      }) as MemorySpace
      const workspaceId = randomUUID()
      store.putWorkspace({ id: workspaceId, root, name: 'Synthetic', ready: true, issue: null })
      store.assign(workspaceId, [], [space.id])
      store.edit({
        action: 'create',
        id: randomUUID(),
        sharedSpaceId: space.id,
        workspaceId,
        title: 'Restart decision',
        text: 'The synthetic verification word is marmalade. Preserve drafts before restart.',
      })
      const discussion = store.discussion(
        {
          action: 'create_discussion',
          id: randomUUID(),
          spaceId: space.id,
          title: 'Verification',
          noteIds: [],
        },
        workspaceId,
      )
      const context = new SpaceContextService(
        store,
        () => memory,
        () => [],
      )
      const calls: string[] = []
      const call = context.call.bind(context)
      context.call = async (scope, tool, args) => {
        calls.push(tool)
        return call(scope, tool, args)
      }
      const server = new SpaceContextServer(context)
      await server.start()
      const cli =
        provider === 'claude'
          ? await findClaudeCli(defaultPaths())
          : await findCodexCli(codexPaths())
      if (!cli) throw Error('Installed provider CLI unavailable.')
      const common = {
        workspace: root,
        spaceContext: () => server.connect(discussion.id),
        onChange: () => {},
        lifetimeMinutes: () => 0,
      }
      const run =
        provider === 'claude'
          ? new AgentRun({ ...common, cli, model: 'claude-haiku-5-5' })
          : new CodexAgentRun({
              ...common,
              client: async () => {
                const client = new CodexClient(cli, root)
                await client.initialize()
                return client
              },
              model: null,
              reasoning: null,
              appsOff: [],
              briefing: () => '',
              store: new AgentStore(join(root, 'agent.json')),
            })
      try {
        expect(
          await run.send(
            'Verify this isolated synthetic space: call threadlight_get_space_context, then threadlight_search_space for restart, then threadlight_read_space_source for the exact note. Report its verification word and source reference. Also list the names of any shell, file editing, web, other MCP, or subagent tools in your actual available tool inventory; do not invoke those tools.',
          ),
        ).toEqual({ ok: true })
        await expect
          .poll(() => ['ready', 'error', 'waiting'].includes(run.current.status), {
            timeout: 120000,
          })
          .toBe(true)
        expect(run.current.error).toBeNull()
        expect(run.current.status).toBe('ready')
        expect(calls).toEqual(
          expect.arrayContaining([
            'threadlight_get_space_context',
            'threadlight_search_space',
            'threadlight_read_space_source',
          ]),
        )
        expect(
          run.current.items
            .filter((i) => i.kind === 'agent')
            .map((i) => i.text)
            .join('\n'),
        ).toContain('marmalade')
        console.log(
          `${provider}: scoped MCP reads confirmed. ${run.current.items.filter((i) => i.kind === 'agent').at(-1)?.text}`,
        )
      } finally {
        await run.close()
        server.close()
        store.close()
        memory.close()
      }
    },
    150000,
  )
