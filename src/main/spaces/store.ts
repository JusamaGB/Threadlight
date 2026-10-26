import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ideaSchema, spacesInput, type SpaceIdea, type SpacesInput } from '../../shared/spaces'

/** Local capture is independent of providers. Optimistic revisions prevent silent overwrites. */
export class SpacesStore {
  private db: DatabaseSync
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;')
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 1) {
      this.db.close()
      throw new Error('Shared Spaces requires a newer Threadlight.')
    }
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version=1;',
    )
  }
  close() {
    this.db.close()
  }
  all(): SpaceIdea[] {
    return this.db
      .prepare('SELECT data FROM ideas ORDER BY rowid DESC')
      .all()
      .map((r) => ideaSchema.parse(JSON.parse(String(r.data))))
  }
  get(id: string): SpaceIdea {
    const row = this.db.prepare('SELECT data FROM ideas WHERE id=?').get(id)
    if (!row) throw new Error('This idea is unavailable.')
    return ideaSchema.parse(JSON.parse(String(row.data)))
  }
  private put(idea: SpaceIdea) {
    idea = ideaSchema.parse(idea)
    this.db
      .prepare(
        'INSERT INTO ideas(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(idea.id, JSON.stringify(idea))
    return idea
  }
  edit(value: SpacesInput): SpaceIdea {
    const input = spacesInput.parse(value)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      let idea: SpaceIdea
      if (input.action === 'create') {
        const existing = this.db.prepare('SELECT data FROM ideas WHERE id=?').get(input.id)
        if (existing) {
          idea = ideaSchema.parse(JSON.parse(String(existing.data)))
          if (idea.title !== input.title || idea.text !== input.text)
            throw new Error('This capture was already saved with different text.')
        } else
          idea = this.put({
            id: input.id,
            title: input.title,
            text: input.text,
            revision: 1,
            stage: 'idea',
            plan: '',
            assignments: [],
            conversationId: null,
            prepared: null,
            at: Date.now(),
          })
      } else if (input.action === 'save') {
        const old = this.get(input.id)
        if (old.revision !== input.revision)
          throw new Error('This idea changed. Reopen it before saving; your text is still here.')
        if (old.prepared)
          throw new Error(
            'This plan has prepared assignments. Follow them in Handoffs; capture a new idea for a revised plan.',
          )
        if (new Set(input.assignments.map((a) => a.id)).size !== input.assignments.length)
          throw new Error('Assignment IDs must be unique.')
        idea = this.put({ ...old, ...input, revision: old.revision + 1, at: Date.now() })
      } else throw new Error('Unsupported idea edit.')
      this.db.exec('COMMIT')
      return idea
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  bind(id: string, conversationId: string) {
    const idea = this.get(id)
    return idea.conversationId === conversationId ? idea : this.put({ ...idea, conversationId })
  }
  prepared(id: string, prepared: SpaceIdea['prepared']) {
    return this.put({ ...this.get(id), prepared })
  }
}
