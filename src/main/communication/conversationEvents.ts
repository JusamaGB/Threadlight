import { randomUUID } from 'node:crypto'
import type {
  ConversationCard,
  ConversationFeed,
  ConversationRecord,
  Announcement,
} from '../../shared/conversationEvents'
import type { CommunicationSnapshot } from '../../shared/communication'
import { CommunicationStore } from './store'

/** Projection of the existing durable communication journal. It never starts work. */
export class ConversationEventService {
  constructor(
    private store: CommunicationStore,
    private now = Date.now,
  ) {
    this.store.transaction(() => {
      for (const record of store.list('conversation')) {
        for (const card of record.cards) {
          if (card.speech === 'submitted' || card.speech === 'reserved') card.speech = 'uncertain'
          if (card.kind === 'native' && card.state === 'pending') card.state = 'unavailable'
        }
        store.put('conversation', record, 'Conversation recovered')
      }
    })
  }
  register(owner: string, target?: string, spaceId?: string, anchor?: string) {
    const existing = this.find(owner)
    spaceId ??= existing?.spaceId
    anchor ??= existing?.anchor
    if (
      existing &&
      existing.target === target &&
      existing.spaceId === spaceId &&
      existing.anchor === anchor
    )
      return
    this.store.transaction(() =>
      this.store.put(
        'conversation',
        {
          ...existing,
          id: existing?.id ?? randomUUID(),
          owner,
          target,
          spaceId,
          anchor,
          cards: existing?.cards ?? [],
        },
        'Conversation bound',
      ),
    )
  }
  private find(owner: string) {
    return this.store.list('conversation').find((r) => r.owner === owner)
  }
  project(
    owner: string,
    snapshot: CommunicationSnapshot,
    title: (target: string) => string,
  ): ConversationFeed {
    const record = this.find(owner)
    if (!record) return { owner, cards: [], cursor: this.store.cursor() }
    const before = JSON.stringify(record)
    const messages = this.store.list('message')
    const roots = new Set(
      messages
        .filter((m) => m.sender === owner || (!!record.target && m.senderTarget === record.target))
        .map((m) => m.rootId),
    )
    const scoped = messages.filter(
      (m) => roots.has(m.rootId) || (record.spaceId && m.spaceId === record.spaceId),
    )
    const candidates = new Map<string, ConversationCard>()
    const add = (card: Omit<ConversationCard, 'revision' | 'speech' | 'updatedAt'>) => {
      const old = record.cards.find((c) => c.id === card.id) as ConversationCard | undefined
      const changed =
        !old ||
        ['state', 'body', 'generation'].some(
          (key) => old[key as keyof ConversationCard] !== card[key as keyof typeof card],
        ) ||
        JSON.stringify(old.request) !== JSON.stringify(card.request)
      const speakable =
        card.state === 'pending' ||
        card.kind === 'result' ||
        ['unknown', 'rejected'].includes(card.state)
      candidates.set(card.id, {
        ...old,
        ...card,
        order:
          old?.order ?? Math.max(0, ...record.cards.map((c) => c.order ?? 0)) + candidates.size + 1,
        anchor: old?.anchor ?? record.anchor,
        at: old?.at ?? card.at,
        revision: (old?.revision ?? 0) + (changed ? 1 : 0),
        updatedAt: changed ? this.now() : old!.updatedAt,
        speech: changed ? (speakable ? 'pending' : 'suppressed') : old!.speech,
        announcementId: changed ? undefined : old?.announcementId,
      })
    }
    const questions = snapshot.questions.filter(
      (q) =>
        q.audience === 'human' &&
        (q.spaceId === record.spaceId ||
          scoped.some((m) => q.originMessageId === m.id || (q.taskId && m.taskId === q.taskId))),
    )
    for (const q of questions)
      add({
        id: `question:${q.id}`,
        at: q.at,
        kind: 'question',
        state: q.state,
        source: q.senderTarget ?? q.sender,
        title: title(q.senderTarget ?? q.sender),
        body: q.body,
        requestId: q.id,
        generation: q.generation,
        question: q,
      })
    for (const request of snapshot.nativeRequests ?? []) {
      // Own runtime or exactly one originating conversation with active work for this target.
      const origins = new Set(
        messages
          .filter(
            (m) =>
              m.at <= request.startedAt &&
              m.deliveries.some(
                (d) => d.target === request.target && ['submitting', 'accepted'].includes(d.phase),
              ),
          )
          .map((m) => m.sender),
      )
      const inProject =
        record.spaceId &&
        snapshot.workflows.some(
          (w) =>
            w.spaceId === record.spaceId && w.participants.some((p) => p.target === request.target),
        )
      if (
        request.target !== record.target &&
        !inProject &&
        !(origins.size === 1 && origins.has(owner))
      )
        continue
      const responses = messages.filter((m) => m.kind === 'answer' && m.rootId === request.id)
      const receipt = responses
        .flatMap((m) => m.deliveries)
        .find(
          (d) =>
            d.generation === request.generation &&
            ['completed', 'submitting', 'unknown'].includes(d.phase),
        )
      const state = receipt
        ? receipt.phase === 'completed'
          ? 'answered-here'
          : receipt.phase === 'submitting'
            ? 'submitting'
            : 'response-uncertain'
        : request.expiresAt <= this.now()
          ? 'expired'
          : 'pending'
      add({
        id: `native:${request.id}`,
        at: request.startedAt,
        kind: 'native',
        state,
        source: request.target,
        title: title(request.target),
        body: request.detail ?? request.title,
        requestId: request.id,
        generation: request.generation,
        request,
      })
    }
    const resultMessages = [
      ...scoped,
      ...messages.filter(
        (m) => questions.some((q) => q.messageId === m.id) && !scoped.some((s) => s.id === m.id),
      ),
    ]
    for (const m of resultMessages) {
      if (m.kind === 'answer' && !questions.some((q) => q.messageId === m.id)) continue
      // Replies are already represented by their originating delivery's correlated result.
      if (m.replyTo) {
        const origin = messages.find((source) => source.id === m.replyTo)
        const represented = origin?.deliveries.some(
          (d) => d.target === m.senderTarget && d.phase === 'completed',
        )
        if (m.kind === 'result' && !represented)
          add({
            id: `reply:${m.id}`,
            at: m.at,
            kind: 'result',
            state: 'completed',
            source: m.senderTarget ?? m.sender,
            title: title(m.senderTarget ?? m.sender),
            body: m.body,
            messageId: m.id,
          })
        continue
      }
      for (const d of m.deliveries) {
        if (!['completed', 'unknown', 'rejected', 'cancelled'].includes(d.phase)) continue
        const waiting = questions.find((q) => q.id === d.questionId || q.originMessageId === m.id)
        add({
          id: `delivery:${d.attemptId}`,
          at: d.observedAt,
          kind: d.phase === 'completed' && !waiting ? 'result' : 'status',
          state: waiting
            ? waiting.state === 'pending'
              ? 'needs-input'
              : 'question-answered'
            : d.phase,
          source: d.target,
          title: title(d.target),
          body: d.reply ?? d.reason,
          messageId: m.id,
          generation: d.generation,
        })
      }
    }
    for (const old of record.cards as ConversationCard[]) {
      if (candidates.has(old.id)) continue
      if (old.kind === 'native' && ['pending', 'submitting'].includes(old.state)) {
        const response = messages
          .filter((m) => m.rootId === old.requestId && m.kind === 'answer')
          .flatMap((m) => m.deliveries)
          .find((d) => d.generation === old.generation)
        const state =
          response?.phase === 'completed'
            ? 'answered-here'
            : response?.phase === 'unknown'
              ? 'response-uncertain'
              : old.request && old.request.expiresAt <= this.now()
                ? 'expired'
                : 'unavailable'
        candidates.set(old.id, {
          ...old,
          state,
          revision: old.revision + 1,
          updatedAt: this.now(),
          speech: 'suppressed',
        })
      } else candidates.set(old.id, old)
    }
    const all = [...candidates.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const active = all.filter((c) => ['pending', 'submitting'].includes(c.state))
    const remaining = Math.max(0, 2000 - active.length)
    const retained = new Set(
      [
        ...active,
        ...(remaining ? all.filter((c) => !active.includes(c)).slice(-remaining) : []),
      ].map((c) => c.id),
    )
    record.cards = all.filter((c) => retained.has(c.id))
    if (JSON.stringify(record) !== before) this.save(record, 'Conversation cards updated')
    return { owner, cards: record.cards as ConversationCard[], cursor: this.store.cursor() }
  }
  get(owner: string): ConversationFeed {
    return {
      owner,
      cards: (this.find(owner)?.cards ?? []) as ConversationCard[],
      cursor: this.store.cursor(),
    }
  }
  card(owner: string, id: string, revision: number) {
    const card = this.get(owner).cards.find((c) => c.id === id && c.revision === revision)
    if (!card || card.state !== 'pending')
      throw new Error('This card changed. Read its current state before answering.')
    return card
  }
  reserve(owner: string, since: number): Announcement | undefined {
    const record = this.find(owner)
    if (!record || record.cards.some((c) => c.speech === 'submitted' || c.speech === 'reserved'))
      return
    const cards = record.cards
      .filter((c) => c.speech === 'pending' && c.updatedAt >= since)
      .sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending'))
      .slice(0, 3)
    if (!cards.length) return
    const id = randomUUID()
    for (const c of cards) {
      c.speech = 'reserved'
      c.announcementId = id
    }
    this.save(record, 'Announcement reserved')
    // No raw worker output becomes a speech instruction. Details remain in the card.
    return {
      id,
      owner,
      cards: cards.map((c) => ({ id: c.id, revision: c.revision })),
      text: cards
        .map(
          (c) =>
            `${c.title.slice(0, 100)} ${c.state === 'pending' ? 'needs your input' : c.kind === 'result' ? 'has returned a result' : c.state === 'unknown' ? 'has an uncertain delivery' : 'has a delivery update'}.`,
        )
        .join(' '),
    }
  }
  catchUp(owner: string) {
    const record = this.find(owner)
    if (!record) return
    for (const card of record.cards) if (card.speech === 'pending') card.updatedAt = this.now()
    this.save(record, 'Catch-up requested')
  }
  commit(announcement: Announcement) {
    const record = this.find(announcement.owner)
    if (
      !record ||
      !announcement.cards.every((ref) =>
        record.cards.some(
          (c) =>
            c.id === ref.id &&
            c.revision === ref.revision &&
            c.speech === 'reserved' &&
            c.announcementId === announcement.id,
        ),
      )
    )
      return false
    for (const c of record.cards) if (c.announcementId === announcement.id) c.speech = 'submitted'
    this.save(record, 'Announcement submitted')
    return true
  }
  settle(owner: string, id: string, state: 'announced' | 'uncertain' | 'suppressed' | 'deferred') {
    const record = this.find(owner)
    if (!record) return
    let changed = false
    for (const c of record.cards)
      if (c.announcementId === id && ['reserved', 'submitted'].includes(c.speech)) {
        c.speech =
          state === 'deferred' ? (c.speech === 'reserved' ? 'pending' : 'uncertain') : state
        changed = true
      }
    if (changed) this.save(record, `Announcement ${state}`)
  }
  private save(record: ConversationRecord, action: string) {
    this.store.transaction(() => this.store.put('conversation', record, action))
  }
}
