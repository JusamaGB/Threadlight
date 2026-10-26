import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Assignment,
  CommunicationEvent,
  CommunicationMessage,
  CommunicationQuestion,
  Workflow,
} from '../../shared/communication'
import { communicationRecordSchemas } from '../../shared/communication'

export interface Records {
  message: CommunicationMessage
  workflow: Workflow
  assignment: Assignment
  question: CommunicationQuestion
}
export class CommunicationStore {
  onChange = () => {}
  constructor(
    readonly db: DatabaseSync,
    private now = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS communication_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS communication_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,kind TEXT NOT NULL,space TEXT,action TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS communication_operations(actor TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(actor,id));`)
    this.transaction(() => {
      for (const m of this.list('message')) {
        let changed = false
        for (const d of m.deliveries) {
          if (['submitting', 'accepted'].includes(d.phase)) {
            d.phase = 'unknown'
            d.reason = 'Connection ended before a correlated result. Check the native chat.'
            changed = true
          } else if (d.phase === 'queued') {
            d.phase = 'held'
            d.reason = 'Restarted. Revalidate before resuming.'
            changed = true
          }
        }
        if (changed) this.put('message', m, 'Recovery')
      }
    })
  }
  list<K extends keyof Records>(kind: K): Records[K][] {
    return this.db
      .prepare('SELECT data FROM communication_records WHERE kind=? ORDER BY rowid')
      .all(kind)
      .map((r) => JSON.parse(String(r.data)) as Records[K])
  }
  get<K extends keyof Records>(kind: K, id: string): Records[K] {
    const row = this.db
      .prepare('SELECT data FROM communication_records WHERE kind=? AND id=?')
      .get(kind, id)
    if (!row) throw new Error('Communication record unavailable.')
    return JSON.parse(String(row.data)) as Records[K]
  }
  put<K extends keyof Records>(kind: K, value: Records[K], action: string) {
    communicationRecordSchemas[kind].parse(value)
    const oldKind = this.db
      .prepare('SELECT kind FROM communication_records WHERE id=?')
      .get(value.id)?.kind
    if (oldKind && oldKind !== kind) throw new Error('Record ID already belongs to another entity.')
    this.db
      .prepare(
        'INSERT INTO communication_records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE kind=excluded.kind',
      )
      .run(value.id, kind, JSON.stringify(value))
    this.db
      .prepare('INSERT INTO communication_events(id,kind,space,action,at) VALUES(?,?,?,?,?)')
      .run(value.id, kind, value.spaceId ?? null, action, this.now())
    return value
  }
  transaction<T>(fn: () => T): T {
    const changes = this.db.prepare('SELECT total_changes() AS n').get()!.n
    this.db.exec('SAVEPOINT communication_write')
    let value: T
    try {
      value = fn()
      this.db.exec('RELEASE communication_write')
    } catch (error) {
      this.db.exec('ROLLBACK TO communication_write; RELEASE communication_write')
      throw error
    }
    try {
      if (this.db.prepare('SELECT total_changes() AS n').get()!.n !== changes) this.onChange()
    } catch {
      /* Durable events recover a detached UI. */
    }
    return value
  }
  operation<T>(actor: string, id: string, input: unknown, fn: () => T): T {
    return this.transaction(() => {
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      const old = this.db
        .prepare('SELECT digest,result FROM communication_operations WHERE actor=? AND id=?')
        .get(actor, id)
      if (old) {
        if (old.digest !== digest) throw new Error('Operation ID belongs to different input.')
        return JSON.parse(String(old.result)) as T
      }
      const result = fn()
      this.db
        .prepare('INSERT INTO communication_operations(actor,id,digest,result) VALUES(?,?,?,?)')
        .run(actor, id, digest, JSON.stringify(result))
      return result
    })
  }
  replay<T>(actor: string, id: string, input: unknown): T | undefined {
    const old = this.db
      .prepare('SELECT digest,result FROM communication_operations WHERE actor=? AND id=?')
      .get(actor, id)
    if (!old) return undefined
    if (old.digest !== createHash('sha256').update(JSON.stringify(input)).digest('hex'))
      throw new Error('Operation ID belongs to different input.')
    return JSON.parse(String(old.result)) as T
  }
  messageRows() {
    return this.db
      .prepare(
        "SELECT rowid AS position,data FROM communication_records WHERE kind='message' ORDER BY rowid DESC",
      )
      .all()
      .map((r) => ({
        position: Number(r.position),
        message: JSON.parse(String(r.data)) as CommunicationMessage,
      }))
  }
  events(): CommunicationEvent[] {
    return this.db
      .prepare('SELECT * FROM communication_events ORDER BY seq DESC LIMIT 1000')
      .all()
      .reverse()
      .map((r) => ({
        seq: Number(r.seq),
        id: String(r.id),
        kind: r.kind as CommunicationEvent['kind'],
        spaceId: r.space ? String(r.space) : undefined,
        action: String(r.action),
        at: Number(r.at),
      }))
  }
  cursor() {
    return Number(this.db.prepare('SELECT MAX(seq) AS n FROM communication_events').get()?.n ?? 0)
  }
  id() {
    return randomUUID()
  }
}
