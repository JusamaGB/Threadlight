import {
  IDLE_AGENT,
  type AgentState,
  type AgentResult,
  type AgentResponse,
} from '../../shared/agent'
import type { ThreadlightApi } from '../../shared/ipc'
import type { SpacesInput, SpacesReply, SpacesSnapshot } from '../../shared/spaces'
import type { AgentClient } from '../lib/agentClient'
import {
  recalledAttempt,
  recalledDiscussion,
  recalledDraft,
  rememberAttempt,
  rememberDiscussion,
  rememberDraft,
} from './brainstormStorage'

/** Only the project/discussion binding differs from the ordinary Agent client. */
export class BrainstormAgent implements AgentClient {
  selection: string | null
  compareSpaceIds: string[] = []
  private listeners = new Set<(state: AgentState) => void>()
  private selections = new Set<(id: string | null) => void>()
  private unsubscribe?: () => void
  private revision = 0
  private history: AgentState['items'] = []
  private sending = false
  private closing = false
  private error: { id: string | null; reason: string } | null = null
  private carets = new Map<string, { start: number; end: number }>()
  readDraftSelection = (id: string | null) => this.carets.get(id ?? 'new')
  writeDraftSelection = (id: string | null, value: { start: number; end: number }) => {
    this.carets.set(id ?? 'new', value)
  }
  constructor(
    readonly spaceId: string,
    private data: SpacesSnapshot,
    private api: Pick<
      ThreadlightApi,
      'onSpaces' | 'spacesRespond' | 'spacesLiveStart' | 'spacesLiveStop' | 'onAgentLive'
    >,
    private request: (input: SpacesInput) => Promise<SpacesReply>,
    private drafts: Map<string, string>,
  ) {
    const remembered = recalledDiscussion(spaceId)
    this.selection = remembered === undefined ? (this.discussions()[0]?.id ?? null) : remembered
  }
  private discussions() {
    return (this.data.discussions ?? []).filter((d) => d.sharedSpaceId === this.spaceId)
  }
  private state(): AgentState {
    const discussion = this.discussions().find((d) => d.id === this.selection)
    const ownsConversation =
      this.selection &&
      this.data.activeId === this.selection &&
      (discussion?.conversationId ?? null) === this.data.agent.conversationId
    const state: AgentState = ownsConversation
      ? this.data.agent
      : {
          ...IDLE_AGENT,
          provider: discussion?.conversationId?.startsWith('codex:')
            ? 'codex'
            : this.data.agent.provider,
          model: discussion?.conversationId ? null : this.data.agent.model,
          conversationId: discussion?.conversationId ?? null,
          status: discussion?.conversationId ? 'ready' : 'idle',
          items: this.history,
          revision: this.revision,
        }
    return {
      ...state,
      revision: this.revision,
      status: this.closing ? 'stopping' : this.sending ? 'starting' : state.status,
      error: this.error?.id === this.selection ? this.error.reason : state.error,
      items: state.items.map((i) => ({
        ...i,
        text: i.kind === 'you' ? (i.text.split('\n\nUser message:\n').at(-1) ?? i.text) : i.text,
      })),
    }
  }
  private publish() {
    this.revision++
    for (const listener of this.listeners) listener(this.state())
  }
  update = (data: SpacesSnapshot) => {
    this.data = data
    if (
      data.voice?.spaceId === this.spaceId &&
      data.voice.discussionId &&
      data.voice.discussionId !== this.selection
    )
      this.select(data.voice.discussionId)
    this.publish()
  }
  select = (id: string | null) => {
    if (id && !this.discussions().some((d) => d.id === id)) return
    if (this.selection === id) return
    this.selection = id
    this.compareSpaceIds = []
    this.history = []
    rememberDiscussion(this.spaceId, id)
    for (const listener of this.selections) listener(id)
    this.publish()
  }
  onSelection = (listener: (id: string | null) => void) => {
    this.selections.add(listener)
    return () => {
      this.selections.delete(listener)
    }
  }
  onAgent = (listener: (state: AgentState) => void) => {
    this.listeners.add(listener)
    this.unsubscribe ??= this.api.onSpaces(this.update)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        this.unsubscribe?.()
        this.unsubscribe = undefined
      }
    }
  }
  getAgent = async () => {
    const latest = await this.request({ action: 'list' })
    if (latest.ok) this.update(latest.snapshot)
    const id = this.selection
    if (id && this.data.activeId !== id) {
      const page = await this.agentReadPage(id)
      if (this.selection === id) {
        this.history = page.items
        this.publish()
      }
    }
    return this.state()
  }
  private key = () => this.selection ?? `${this.spaceId}:new`
  private saveDraft = (id: string | null, text: string) => {
    this.drafts.set(id ?? `${this.spaceId}:new`, text)
    rememberDraft(this.spaceId, id, text)
  }
  readDraft = () => this.drafts.get(this.key()) ?? recalledDraft(this.spaceId, this.selection)
  writeDraft = (text: string) => {
    this.saveDraft(this.selection, text)
  }
  historyCurrentId = () => this.selection
  agentSend = async (text: string): Promise<AgentResult> => {
    if (this.closing) return { ok: false, reason: 'The previous discussion is still closing.' }
    if (this.sending) return { ok: false, reason: 'A message is already being submitted.' }
    this.sending = true
    this.error = null
    this.publish()
    try {
      const draft = this.readDraft(),
        typed = draft.trim() === text.trim()
      let id = this.selection
      if (!id) {
        const attempt = recalledAttempt(this.spaceId) ?? {
          id: crypto.randomUUID(),
          title: text.trim().split('\n')[0]!.slice(0, 80),
        }
        rememberAttempt(this.spaceId, attempt)
        const created = await this.request({
          action: 'create_discussion',
          ...attempt,
          spaceId: this.spaceId,
          noteIds: [],
        })
        if (!created.ok) {
          this.error = { id: this.selection, reason: created.reason }
          return created
        }
        this.update(created.snapshot)
        id = created.discussionId!
        if (typed) {
          this.writeDraft('')
          this.drafts.set(id, draft)
          rememberDraft(this.spaceId, id, draft)
        }
        rememberAttempt(this.spaceId, null)
        this.select(id)
      }
      const result = await this.request({
        action: 'chat',
        id,
        text,
        compareSpaceIds: this.compareSpaceIds,
      })
      if (result.ok) {
        this.update(result.snapshot)
        if (typed) this.saveDraft(id, '')
      } else if (!typed) {
        const previous = this.drafts.get(id) ?? recalledDraft(this.spaceId, id)
        this.saveDraft(id, [previous, text].filter(Boolean).join('\n'))
      }
      if (!result.ok) this.error = { id, reason: result.reason }
      return result.ok ? { ok: true } : result
    } finally {
      this.sending = false
      this.publish()
    }
  }
  agentReadPage = async (id: string, cursor?: string | null) => {
    if (!this.discussions().some((d) => d.id === id))
      return { items: [], cursor: null, error: 'This discussion is outside this project.' }
    const result = await this.request({ action: 'read', id, ...(cursor ? { cursor } : {}) })
    return result.ok
      ? {
          items: (result.items ?? []).map((i) => ({
            ...i,
            text:
              i.kind === 'you' ? (i.text.split('\n\nUser message:\n').at(-1) ?? i.text) : i.text,
          })),
          cursor: result.historyCursor ?? null,
        }
      : { items: [], cursor: null, error: result.reason }
  }
  agentHistory = async () =>
    this.discussions().map((d) => ({
      id: d.id,
      title: d.title,
      at: d.at,
      provider: d.conversationId?.startsWith('codex:') ? ('codex' as const) : ('claude' as const),
    }))
  agentResume = async (id: string): Promise<AgentResult> => {
    const discussion = this.discussions().find((d) => d.id === id)
    if (!discussion) return { ok: false, reason: 'This discussion is outside this project.' }
    if (discussion.conversationId) {
      const result = await this.request({ action: 'resume', id })
      if (!result.ok) return result
      this.update(result.snapshot)
    }
    this.select(id)
    return { ok: true }
  }
  agentInterrupt = async (): Promise<AgentResult> =>
    this.selection
      ? this.request({ action: 'stop', id: this.selection }).then((r) => (r.ok ? { ok: true } : r))
      : { ok: false, reason: 'No discussion is running.' }
  finishCallChat = async (
    conversationId: string,
    choice: 'archive' | 'fresh',
  ): Promise<AgentResult> => {
    const id = this.selection
    if (!id || this.state().conversationId !== conversationId || this.sending || this.closing)
      return { ok: false, reason: 'The discussion changed or is busy.' }
    const result = await this.request({ action: 'finish_call_chat', id, conversationId, choice })
    if (!result.ok) return result
    this.update(result.snapshot)
    if (choice === 'fresh' && this.selection === id) this.select(null)
    return { ok: true }
  }
  agentClose = () => {
    if (this.closing) return
    const id = this.selection
    if (!id) return
    this.closing = true
    this.error = null
    this.publish()
    void this.request({ action: 'close', id })
      .then((result) => {
        if (!result.ok) throw new Error(result.reason)
        this.update(result.snapshot)
        if (this.selection === id) this.select(null)
      })
      .catch((error) => {
        this.error = {
          id,
          reason: error instanceof Error ? error.message : 'Could not end the discussion.',
        }
      })
      .finally(() => {
        this.closing = false
        this.publish()
      })
  }
  agentRespond = (id: string, response: AgentResponse): Promise<AgentResult> =>
    this.selection
      ? this.api.spacesRespond(this.selection, id, response)
      : Promise.resolve({ ok: false, reason: 'No discussion is running.' })
  agentDecide = (id: string, allow: boolean) => {
    void this.agentRespond(id, { action: allow ? 'allow' : 'deny' })
  }
  agentLiveStart = (id: string, sdp: string) =>
    this.api.spacesLiveStart(id, sdp, this.spaceId, this.selection)
  agentLiveOpen = async (): Promise<AgentResult> => ({
    ok: false,
    reason: 'Native audio is used from the first turn.',
  })
  agentLiveStop = (id: string) => this.api.spacesLiveStop(id)
  onAgentLive: ThreadlightApi['onAgentLive'] = (listener) => this.api.onAgentLive(listener)
}
