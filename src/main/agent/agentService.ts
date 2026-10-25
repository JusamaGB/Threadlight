import { mkdir } from 'node:fs/promises'
import { z } from 'zod'
import {
  IDLE_AGENT,
  agentBusy,
  type AgentApp,
  type AgentConversation,
  type AgentHistoryPage,
  type AgentItem,
  type AgentProvider,
  type AgentResponse,
  type AgentResult,
  type AgentState,
} from '../../shared/agent'
import type { Settings } from '../../shared/settings'
import type { Snapshot } from '../../shared/types'
import type { CliCommand } from '../relay'
import { AgentRun } from './agentRun'
import { AgentStore, type AgentRecord } from './agentStore'
import { listConversations, readConversation, transcriptsFolder } from './agentHistory'
import { CodexAgentRun, readCodexHistory } from './codexAgentRun'
import { CodexClient, type CodexTransport } from './codexClient'
import { discoverModels } from './agentModels'
import { codexPolicy } from './codexPolicy'
import { connectedApps } from './agentApps'
import { briefing, readableFolders } from './briefing'
import { archiveAgentConversation } from './agentArchive'
import {
  validVoiceOffer,
  validVoiceSession,
  type LiveVoiceEvent,
  type LiveVoiceResult,
} from '../../shared/liveVoice'

type Run = AgentRun | CodexAgentRun
const responseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['allow', 'deny']) }),
  z.object({
    action: z.literal('answer'),
    answers: z
      .record(z.string().max(200), z.string().max(8000))
      .refine((a) => Object.keys(a).length <= 20),
  }),
])
interface Options {
  workspace: string
  index: string
  claudeProjects: string
  settings: () => Settings
  snapshot: () => Snapshot
  cli: (provider: AgentProvider) => Promise<CliCommand | null>
  onChange: (state: AgentState) => void
  onRateLimit: (value: unknown) => void
  codexClient?: () => Promise<CodexTransport>
  onLive?: (event: LiveVoiceEvent) => void
}

/** The sole owner of the active Agent, independent of the monitored applications. */
export class AgentService {
  readonly store: AgentStore
  private run: Run | null = null
  private state: AgentState = { ...IDLE_AGENT }
  private locked = false
  private retirement: Promise<void> = Promise.resolve()
  private operation = 0
  private past: string
  private claudeWrites: Promise<void> = Promise.resolve()
  private voiceSession: string | null = null
  constructor(private options: Options) {
    this.store = new AgentStore(options.index)
    this.past = transcriptsFolder(options.claudeProjects, options.workspace)
  }
  get current(): AgentState {
    if (this.run && !this.state.ended && this.state.provider) return this.state
    const settings = this.options.settings()
    return {
      ...this.state,
      provider: settings.agentProvider,
      costUsd: settings.agentProvider === 'codex' ? null : this.state.costUsd,
      model:
        settings.agentProvider === 'codex'
          ? settings.agentCodexModel
          : `Haiku / ${settings.agentWorker}`,
      reasoning: settings.agentProvider === 'codex' ? settings.agentCodexReasoning : null,
    }
  }
  refreshDefaults(): void {
    // Ended transcripts remain readable, but the next send uses the saved selection.
    if (!this.run || this.state.ended) this.publish({ ...this.state })
  }

  async startLive(id: unknown, sdp: unknown): Promise<LiveVoiceResult> {
    if (!validVoiceSession(id) || !validVoiceOffer(sdp))
      return { ok: false, reason: 'Invalid Live connection.' }
    if (this.options.settings().agentProvider !== 'codex')
      return { ok: false, reason: 'Select Codex in Agent settings to use Live voice.' }
    if (this.locked || agentBusy(this.state) || this.voiceSession)
      return { ok: false, reason: 'Finish or stop the current Agent turn before starting Live.' }
    this.locked = true
    const retired = this.close()
    this.voiceSession = id
    const operation = this.operation
    try {
      await retired
      if (operation !== this.operation || this.voiceSession !== id)
        throw new Error('Live was cancelled.')
      await this.store.load()
      const next = await this.create()
      if (operation !== this.operation || this.voiceSession !== id) {
        await next.close()
        throw new Error('Live was cancelled.')
      }
      if (!(next instanceof CodexAgentRun)) throw new Error('Live requires the Codex Agent.')
      this.run = next
      const answer = await next.startLive(id, sdp)
      if (operation !== this.operation || this.voiceSession !== id)
        throw new Error('Live was cancelled.')
      return { ok: true, sdp: answer }
    } catch (error) {
      if (this.voiceSession === id) await this.close()
      return { ok: false, reason: (error as Error).message }
    } finally {
      this.locked = false
    }
  }

  async openLive(id: unknown, text: unknown): Promise<AgentResult> {
    if (!validVoiceSession(id) || id !== this.voiceSession || !(this.run instanceof CodexAgentRun))
      return { ok: false, reason: 'This Live session is closed.' }
    if (typeof text !== 'string' || !text.trim() || text.length > 32_000)
      return { ok: false, reason: 'The opening message must contain up to 32,000 characters.' }
    return this.run.openLive(text.trim())
  }

  async stopLive(id?: unknown): Promise<void> {
    if (this.voiceSession && (id === undefined || id === this.voiceSession)) await this.close()
    else if (id === undefined) await this.retirement
  }

  async send(value: unknown): Promise<AgentResult> {
    if (typeof value !== 'string' || !value.trim() || value.length > 32_000)
      return { ok: false, reason: 'Enter a message up to 32,000 characters.' }
    if (this.locked || agentBusy(this.state))
      return { ok: false, reason: 'It is still working on the last message.' }
    this.locked = true
    const operation = this.operation
    try {
      await this.store.load()
      await this.retirement
      if (!this.run || this.state.ended) {
        await this.run?.close()
        this.run = null
        this.publish({ ...IDLE_AGENT, status: 'starting' })
        const next = await this.create()
        if (operation !== this.operation) {
          next.close()
          throw new Error('The conversation was ended.')
        }
        this.run = next
      }
      if (operation !== this.operation) throw new Error('The conversation was ended.')
      return await this.run.send(value)
    } catch (error) {
      if (operation === this.operation)
        this.publish({ ...this.state, status: 'error', error: (error as Error).message })
      return { ok: false, reason: (error as Error).message }
    } finally {
      this.locked = false
    }
  }

  respond(id: unknown, response: unknown): AgentResult {
    const parsed = responseSchema.safeParse(response)
    if (typeof id !== 'string' || !parsed.success || !this.run)
      return { ok: false, reason: 'Invalid agent response.' }
    return this.run.respond(id, parsed.data as AgentResponse)
  }
  decide(id: string, allow: boolean): void {
    // Legacy IPC can only answer the current Claude wire request.
    if (this.run instanceof AgentRun && this.run.current.approval?.id === id)
      this.run.decide(id, allow)
  }
  async interrupt(): Promise<AgentResult> {
    return this.run ? await this.run.interrupt() : { ok: true }
  }
  close(): Promise<void> {
    this.voiceSession = null
    this.operation++
    const operation = this.operation
    const previous = this.state
    const run = this.run
    this.run = null
    if (run)
      this.retirement = Promise.resolve(run.close()).then(() => {
        if (operation === this.operation && run.current.error)
          this.publish({ ...this.state, error: run.current.error })
      })
    this.publish({
      ...previous,
      status: 'idle',
      ended: true,
      requests: [],
      approval: null,
      progress: null,
    })
    return this.retirement
  }

  /** Only previously requested retirements are retried; unrelated chats are never archived. */
  async retryArchives(): Promise<void> {
    await this.store.load()
    for (const record of this.store.all()) {
      if (record.provider !== 'codex' || record.archiveState !== 'pending') continue
      try {
        await archiveAgentConversation(this.store, record.id, () => this.connect())
      } catch {
        this.publish({
          ...this.state,
          error:
            'Some agent conversations could not be archived. Their history is still saved in Earlier.',
        })
      }
    }
  }

  async models() {
    const client = await this.connect()
    try {
      return { models: await discoverModels(client), error: null }
    } catch (error) {
      return { models: [], error: (error as Error).message }
    } finally {
      client.close()
    }
  }
  async apps(provider: AgentProvider): Promise<AgentApp[]> {
    if (provider === 'claude') {
      const cli = await this.options.cli('claude')
      return cli
        ? connectedApps(cli)
        : [{ name: 'Claude', status: 'Claude Code was not found.', unavailable: true }]
    }
    const client = await this.connect()
    try {
      return (
        await codexPolicy(client, this.options.workspace, this.options.settings().agentCodexAppsOff)
      ).apps
    } finally {
      client.close()
    }
  }

  async history(): Promise<AgentConversation[]> {
    await this.store.load()
    await this.claudeWrites
    const old = await listConversations(this.past)
    const merged = new Map<string, AgentConversation>(
      old.map((r) => [
        `claude:${r.id}`,
        { ...r, id: `claude:${r.id}`, provider: 'claude', model: null },
      ]),
    )
    for (const r of this.store.all())
      merged.set(r.id, {
        id: r.id,
        provider: r.provider,
        model: r.model,
        title: r.title || 'Agent conversation',
        at: r.at,
      })
    return [...merged.values()].sort((a, b) => b.at - a.at).slice(0, 30)
  }

  async read(id: unknown, cursor: unknown = null): Promise<AgentHistoryPage> {
    try {
      if (
        typeof id !== 'string' ||
        (cursor !== null && (typeof cursor !== 'string' || cursor.length > 8000))
      )
        throw new Error('Invalid conversation.')
      await this.store.load()
      const record = this.store.get(id)
      if (record?.provider === 'codex') {
        const client = await this.connect()
        try {
          const page = await readCodexHistory(client, record.providerId, cursor as string | null)
          if (!cursor && record.liveItems?.length) page.items = [...record.liveItems, ...page.items]
          if (!cursor && record.pending)
            page.items.push({
              kind: 'step',
              text: `Unconfirmed send (not automatically retried):\n${record.pending.text}`,
            })
          return page
        } finally {
          client.close()
        }
      }
      const raw = id.startsWith('claude:') ? id.slice(7) : ''
      if (!raw) throw new Error('That conversation is not registered with Threadlight.')
      return { items: await readConversation(this.past, raw), cursor: null }
    } catch (error) {
      return { items: [], cursor: null, error: (error as Error).message }
    }
  }

  async resume(id: unknown): Promise<AgentResult> {
    if (typeof id !== 'string' || this.locked || agentBusy(this.state) || this.voiceSession)
      return { ok: false, reason: 'Finish or stop the current conversation first.' }
    this.locked = true
    const operation = this.operation
    try {
      await this.store.load()
      await this.claudeWrites
      await this.retirement
      const page = await this.read(id)
      if (page.error || !page.items.length)
        throw new Error(page.error ?? 'That conversation is gone.')
      let record = this.store.get(id)
      if (record?.archiveState === 'pending') {
        await archiveAgentConversation(this.store, record.id, () => this.connect())
        record = this.store.get(id)
      }
      if (!record && !id.startsWith('claude:')) throw new Error('Unknown conversation.')
      const next = await this.create(
        record ?? {
          id,
          provider: 'claude',
          providerId: id.slice(7),
          model: null,
          reasoning: null,
          appsOff: [...this.options.settings().agentAppsOff],
          title:
            page.items.find((i) => i.kind === 'you')?.text.slice(0, 160) ?? 'Earlier conversation',
          at: Date.now(),
          pending: null,
        },
        page.items,
      )
      if (operation !== this.operation) {
        next.close()
        throw new Error('The conversation was ended.')
      }
      const previous = this.run
      this.run = null
      await previous?.close()
      if (operation !== this.operation) {
        await next.close()
        throw new Error('The conversation was ended.')
      }
      this.run = next
      if (next instanceof CodexAgentRun) await next.prepareResume()
      else next.resume(id.slice(7), page.items)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: (error as Error).message }
    } finally {
      this.locked = false
    }
  }

  private async connect(): Promise<CodexTransport> {
    if (this.options.codexClient) return this.options.codexClient()
    const cli = await this.options.cli('codex')
    if (!cli) throw new Error('Codex CLI was not found. Install and sign in to Codex first.')
    await mkdir(this.options.workspace, { recursive: true })
    const client = new CodexClient(cli, this.options.workspace)
    try {
      await client.initialize()
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }

  private async create(record?: AgentRecord, items?: AgentItem[]): Promise<Run> {
    const settings = structuredClone(this.options.settings())
    const provider = record?.provider ?? settings.agentProvider
    let run: Run
    const onChange = (state: AgentState) => {
      if (this.run !== run) return
      if (provider === 'claude' && state.sessionId) {
        const id = `claude:${state.sessionId}`
        const previous = this.store.get(id)
        const entry: AgentRecord = {
          id,
          provider,
          providerId: state.sessionId,
          model: state.model,
          reasoning: null,
          worker: record?.worker ?? settings.agentWorker,
          appsOff: record?.appsOff ?? settings.agentAppsOff,
          title:
            previous?.title ??
            state.items.find((i) => i.kind === 'you')?.text.slice(0, 160) ??
            'Agent conversation',
          createdAt: previous?.createdAt ?? previous?.at ?? Date.now(),
          at: Date.now(),
          pending: null,
        }
        this.claudeWrites = this.claudeWrites
          .then(() => this.store.put(entry))
          .catch(() => {
            this.publish({
              ...this.state,
              error: 'Could not save agent metadata. The Claude transcript remains available.',
            })
          })
        state = { ...state, conversationId: id, provider: 'claude' }
      }
      this.publish(state)
    }
    await mkdir(this.options.workspace, { recursive: true })
    if (provider === 'codex')
      run = new CodexAgentRun({
        client: () => this.connect(),
        workspace: this.options.workspace,
        model: settings.agentCodexModel,
        reasoning: settings.agentCodexReasoning,
        appsOff: settings.agentCodexAppsOff,
        store: this.store,
        record,
        items,
        briefing: () => briefing(this.options.snapshot()),
        lifetimeMinutes: () => this.options.settings().agentLifetimeMinutes,
        onChange,
        onLive: this.options.onLive,
      })
    else {
      const cli = await this.options.cli('claude')
      if (!cli) throw new Error('Claude Code was not found on this PC.')
      run = new AgentRun({
        cli,
        workspace: this.options.workspace,
        model: 'claude-haiku-5-5',
        workerModel: () => record?.worker ?? settings.agentWorker,
        blockedApps: () => record?.appsOff ?? settings.agentAppsOff,
        onChange,
        briefing: () => briefing(this.options.snapshot()),
        readable: () => readableFolders(this.options.snapshot()),
        lifetimeMinutes: () => this.options.settings().agentLifetimeMinutes,
        onRateLimit: this.options.onRateLimit,
      })
    }
    return run
  }

  private publish(state: AgentState): void {
    this.state = { ...state, revision: this.state.revision + 1 }
    this.options.onChange(this.current)
  }
}
