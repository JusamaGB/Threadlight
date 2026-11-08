import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { z } from 'zod'
import type { AgentItem, AgentState, RecentAgentConversation } from '../../shared/agent'
import { RECENT_AGENT_MS } from '../../shared/agent'
import type { AgentRecord } from './agentStore'

const schema = z.object({
  id: z.string().max(200),
  provider: z.enum(['claude', 'codex']),
  at: z.number(),
  waiting: z.boolean(),
  summary: z.string().max(300),
})
function replySummary(items: AgentItem[]) {
  const last = items.findLast((i) => i.kind !== 'step' && i.text.trim())
  if (!last || last.kind === 'you') return ''
  const pending = last.id?.startsWith('live:') && last.liveComplete === false
  const text = last.text.trim()
  return pending ? '' : text.replace(/\s+/g, ' ').slice(-300)
}

/** Keep a return address after a crop/Live run expires or Threadlight restarts. */
export class RecentAgent {
  private last?: RecentAgentConversation
  constructor(private file: string) {
    try {
      // A saved shortcut survives restart. Only the current Agent can attest to a pending request.
      this.last = { ...schema.parse(JSON.parse(readFileSync(file, 'utf8'))), waiting: false }
    } catch {
      /* first run or obsolete record */
    }
  }
  get current() {
    return this.last && (this.last.waiting || Date.now() - this.last.at < RECENT_AGENT_MS)
      ? this.last
      : undefined
  }
  observe(state: AgentState) {
    const id = state.conversationId
    if (this.last?.waiting && id !== this.last.id) this.save({ ...this.last, waiting: false })
    if (!id || !state.provider) return
    const prior = this.last?.id === id ? this.last : undefined
    if (
      !prior &&
      !state.live &&
      !state.items.some((i) => i.screenPreview || i.id?.startsWith('live:'))
    )
      return
    const reply =
      state.status === 'working' || state.status === 'starting' ? '' : replySummary(state.items)
    const request = state.requests[0]
    const summary =
      request?.title.slice(0, 300) ||
      reply ||
      (state.status === 'working'
        ? 'Agent is working'
        : state.live
          ? 'Live conversation'
          : 'Agent conversation')
    const waiting = !state.ended && (!!request || !!state.approval)
    if (prior?.waiting === waiting && prior.summary === summary) return
    this.save({ id, provider: state.provider, at: Date.now(), summary, waiting })
  }
  async restore(
    records: AgentRecord[],
    read: (id: string) => Promise<{ items: AgentItem[]; error?: string }>,
  ) {
    const record = records
      .filter(
        (r) =>
          r.liveItems?.length ||
          /^(?:Shared screen region|Screen region|Help me with this screen region)/i.test(r.title),
      )
      .sort((a, b) => b.at - a.at)[0]
    if (
      !record ||
      this.last?.waiting ||
      (this.last && this.last.at >= record.at) ||
      Date.now() - record.at >= RECENT_AGENT_MS
    )
      return
    const before = this.last
    const page = await read(record.id)
    if (this.last !== before || (page.error && this.last?.id === record.id)) return
    const summary = replySummary(page.items.length ? page.items : (record.liveItems ?? []))
    this.save({
      id: record.id,
      provider: record.provider,
      at: record.at,
      summary: summary || record.title.slice(0, 300),
      waiting: false,
    })
  }
  private save(recent: RecentAgentConversation) {
    this.last = recent
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(recent), { mode: 0o600 })
      renameSync(this.file + '.tmp', this.file)
    } catch {
      /* The in-memory return address remains usable. */
    }
  }
}
