import { agentBusy, type AgentResponse } from '../../shared/agent'
import {
  brainstormPrompt,
  spacesInput,
  type SpacesReply,
  type SpacesSnapshot,
} from '../../shared/spaces'
import type { Session } from '../../shared/types'
import { AgentService } from '../agent/agentService'
import type { MemoryStore } from '../memory/store'
import { SpacesStore } from './store'

export class SpacesService {
  readonly agent: AgentService
  private activeId: string | null = null
  private switching = false
  private issue = ''
  constructor(
    readonly store: SpacesStore,
    private memory: () => MemoryStore | null,
    private sessions: () => Session[],
    options: ConstructorParameters<typeof AgentService>[0],
    private changed: (snapshot: SpacesSnapshot) => void,
  ) {
    this.agent = new AgentService({
      ...options,
      onChange: (state) => {
        if (this.activeId && state.conversationId) {
          try {
            store.bind(this.activeId, state.conversationId)
          } catch {
            this.issue =
              'Could not link the brainstorm history. Keep this conversation open and copy important text.'
          }
        }
        options.onChange(state)
        this.publish()
      },
    })
  }
  snapshot(): SpacesSnapshot {
    const agent = this.agent.current
    return {
      ideas: this.store.all(),
      activeId: this.activeId,
      agent: this.issue ? { ...agent, error: this.issue } : agent,
    }
  }
  private publish() {
    this.changed(this.snapshot())
  }
  async request(value: unknown): Promise<SpacesReply> {
    try {
      const input = spacesInput.parse(value)
      if (input.action === 'create' || input.action === 'save') this.store.edit(input)
      else if (input.action === 'prepare') {
        const idea = this.store.get(input.id),
          memory = this.memory()
        if (!memory) throw new Error('Handoffs are unavailable. Your plan is still saved.')
        if (idea.revision !== input.revision)
          throw new Error('The plan changed. Reopen it before preparing assignments.')
        if (!idea.plan.trim() || !idea.assignments.length)
          throw new Error('Save a plan and at least one assignment first.')
        if (idea.prepared && idea.prepared.folderId !== input.folderId)
          throw new Error('These assignments already have a shared destination.')
        if (idea.prepared?.taskIds.length === idea.assignments.length)
          return { ok: true, snapshot: this.snapshot() }
        const folder = memory
          .snapshot()
          .folders.find((f) => f.id === input.folderId && !f.archived && !f.redirectId)
        if (!folder) throw new Error('Choose an available shared folder in Handoffs.')
        for (const assignment of idea.assignments) {
          if (
            !this.sessions().some(
              (s) =>
                s.id === assignment.assignee && (s.provider ?? 'claude') === assignment.provider,
            )
          )
            throw new Error(
              `Choose an available ${assignment.provider === 'codex' ? 'Codex' : 'Claude'} chat for ${assignment.title}.`,
            )
        }
        // Freeze the reviewed payload before the first write. Retrying uses identical operation IDs.
        this.store.prepared(idea.id, { folderId: input.folderId, taskIds: [] })
        let taskIds: string[]
        try {
          taskIds = memory.prepareHandoff(
            {
              action: 'create_item',
              operationId: idea.id,
              folderId: folder.id,
              title: idea.title,
              kind: 'note',
              body: `Idea\n${idea.text}\n\nReviewed plan (revision ${idea.revision})\n${idea.plan}`,
            },
            idea.assignments.map((a) => ({
              action: 'create_task',
              operationId: a.id,
              folderId: folder.id,
              title: a.title,
              body: a.brief,
              assignee: a.assignee,
            })),
          )
        } catch (error) {
          if (!idea.prepared) this.store.prepared(idea.id, null)
          throw error
        }
        this.store.prepared(idea.id, { folderId: folder.id, taskIds })
      } else if (input.action === 'chat' || input.action === 'resume') {
        if (this.switching || agentBusy(this.agent.current))
          throw new Error('Finish or stop the current brainstorm turn first.')
        this.switching = true
        try {
          const idea = this.store.get(input.id)
          if (idea.stage !== 'brainstorm') throw new Error('Move this idea to Brainstorm first.')
          if (input.action === 'resume' && !idea.conversationId)
            throw new Error('This idea has no saved discussion yet.')
          if (this.activeId !== idea.id || this.agent.current.ended || input.action === 'resume') {
            this.activeId = null
            await this.agent.close()
            this.activeId = idea.id
            if (idea.conversationId) {
              const resumed = await this.agent.resume(idea.conversationId)
              if (!resumed.ok) {
                this.activeId = null
                throw new Error(resumed.reason)
              }
            }
          }
          if (input.action === 'resume') return { ok: true, snapshot: this.snapshot() }
          const prompt = brainstormPrompt(idea, input.text)
          if (prompt.length > 32000)
            throw new Error(
              'This brainstorm context is too long. Shorten the plan or assignment briefs before sending.',
            )
          const sent = await this.agent.send(prompt)
          if (!sent.ok) throw new Error(sent.reason)
        } finally {
          this.switching = false
        }
      } else if (input.action === 'read') {
        const idea = this.store.get(input.id)
        if (this.activeId === idea.id)
          return { ok: true, snapshot: this.snapshot(), items: this.agent.current.items }
        if (!idea.conversationId) return { ok: true, snapshot: this.snapshot(), items: [] }
        const history = await this.agent.read(idea.conversationId)
        if (history.error) throw new Error(history.error)
        return { ok: true, snapshot: this.snapshot(), items: history.items }
      } else if (input.action === 'stop') {
        if (input.id !== this.activeId) throw new Error('This brainstorm is not running.')
        const result = await this.agent.interrupt()
        if (!result.ok) throw new Error(result.reason)
      }
      this.publish()
      return { ok: true, snapshot: this.snapshot() }
    } catch (error) {
      try {
        this.publish()
      } catch {
        /* Keep a readable error if storage itself is unavailable. */
      }
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Shared Spaces is unavailable.',
      }
    }
  }
  respond(ideaId: string, requestId: string, response: AgentResponse) {
    if (ideaId !== this.activeId)
      return { ok: false as const, reason: 'This request belongs to another brainstorm.' }
    return this.agent.respond(requestId, response)
  }
  async close() {
    await this.agent.close()
    await this.agent.store.flush()
    this.store.close()
  }
}
