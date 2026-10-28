import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AppControlService, type ControlCaller } from '../src/main/appControl/service'
import { AppControlServer } from '../src/main/appControl/server'
import { AgentRun } from '../src/main/agent/agentRun'
import { CodexAgentRun } from '../src/main/agent/codexAgentRun'
import { CodexClient } from '../src/main/agent/codexClient'
import { AgentStore } from '../src/main/agent/agentStore'
import { DEFAULT_SETTINGS } from '../src/shared/settings'
import { findClaudeCli } from '../src/main/relay'
import { findCodexCli } from '../src/main/codex/relay'
import { defaultPaths, codexPaths } from '../src/main/sessions/paths'

// Opt-in authenticated inference against ONLY synthetic application state and temporary receipts.
for (const provider of ['claude', 'codex'] as const)
  it.skipIf(process.env.THREADLIGHT_LIVE_CONTROL !== provider)(
    `${provider} actually invokes the hosted control MCP and receives its knowledge`,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), `threadlight-control-${provider}-live-`))
      const calls: string[] = []
      let revision = 0
      const service: AppControlService = new AppControlService(
        {
          settings: () => DEFAULT_SETTINGS,
          updateSettings: async () => {
            throw Error('No real writes in live fixture')
          },
          workspaces: () => [],
          spaces: () => [],
          artifacts: async () => [],
          changes: async () => null,
          createSpace: async () => {
            throw Error('No real writes')
          },
          createChat: async () => {
            throw Error('No real writes')
          },
          busy: () => ({ agent: true, otherWork: false }),
          restart: () => {
            throw Error('No restart in live fixture')
          },
          send: (command) =>
            service.publish({
              ...service.hello(),
              commandId: command.commandId,
              outcome: 'ok',
              snapshot: {
                route: command.route!,
                revision: ++revision,
                observedAt: Date.now(),
                open: true,
                pinned: false,
              },
            }),
        },
        join(directory, 'operations.json'),
      )
      const original = service.call.bind(service)
      service.call = async (caller, name, args) => {
        calls.push(name)
        return original(caller, name, args)
      }
      const caller: ControlCaller = {
        active: true,
        owner: () => 'synthetic-live',
        resolve: () => null,
        cards: async () => null,
        approve: (_id, _title, _detail, decide) => decide(false),
      }
      const heartbeat = setInterval(
        () =>
          service.publish({
            ...service.hello(),
            snapshot: {
              route: { page: 'list', mode: 'active' },
              revision: ++revision,
              observedAt: Date.now(),
              open: true,
              pinned: false,
            },
          }),
        1000,
      )
      const server = new AppControlServer(service)
      await server.start()
      const cli =
        provider === 'claude'
          ? await findClaudeCli(defaultPaths())
          : await findCodexCli(codexPaths())
      if (!cli) {
        server.close()
        clearInterval(heartbeat)
        throw Error(`${provider} hosted CLI is unavailable`)
      }
      const common = {
        workspace: directory,
        onChange: () => {},
        appControl: () => server.connect(caller),
        lifetimeMinutes: () => 0,
      }
      const run =
        provider === 'claude'
          ? new AgentRun({ ...common, cli, model: 'claude-haiku-5-5' })
          : new CodexAgentRun({
              ...common,
              client: async () => {
                const client = new CodexClient(cli, directory)
                await client.initialize()
                return client
              },
              model: null,
              reasoning: null,
              appsOff: ['node_repl'],
              briefing: () => '',
              store: new AgentStore(join(directory, 'index.json')),
            })
      try {
        expect(
          await run.send(
            'This is an isolated synthetic Threadlight application-control test. Use the built-in threadlight_get_capabilities tool and threadlight_get_app_state, then use threadlight_navigate to open Shared Spaces library with a new UUID operationId. Use these tools yourself; do not use Task, workers, shell or other integrations. Report the API version and the authoritative navigation outcome in one sentence.',
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
            'threadlight_get_capabilities',
            'threadlight_get_app_state',
            'threadlight_navigate',
          ]),
        )
        console.log(
          `${provider}: actual MCP execution confirmed (${[...new Set(calls)].join(', ')}).`,
        )
      } finally {
        await run.close()
        server.close()
        clearInterval(heartbeat)
      }
    },
    150000,
  )
