import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ideaSchema,
  spacesInput,
  type SpaceIdea,
  type SpacesInput,
  type SpaceWorkspace,
  type SpaceDocument,
} from '../../shared/spaces'

/** Local capture is independent of providers. Optimistic revisions prevent silent overwrites. */
export class SpacesStore {
  private db: DatabaseSync
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;')
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 2) {
      this.db.close()
      throw new Error('Shared Spaces requires a newer Threadlight.')
    }
    if (version.user_version === 1 && !existsSync(file + '.before-workspaces')) {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      copyFileSync(file, file + '.before-workspaces', 1)
    }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS space_owners (space TEXT PRIMARY KEY, workspace TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (workspace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,id));
      PRAGMA user_version=2; COMMIT;`)
  }
  close() {
    this.db.close()
  }
  workspaces(): SpaceWorkspace[] {
    return this.db
      .prepare('SELECT data FROM workspaces ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(String(row.data)) as SpaceWorkspace)
  }
  workspace(id: string) {
    const value = this.workspaces().find((w) => w.id === id)
    if (!value) throw new Error('Choose and set up a workspace first.')
    return value
  }
  putWorkspace(workspace: SpaceWorkspace) {
    this.db
      .prepare(
        'INSERT INTO workspaces(id,root,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(workspace.id, workspace.root, JSON.stringify(workspace))
  }
  owners(): Record<string, string> {
    return Object.fromEntries(
      this.db
        .prepare('SELECT space,workspace FROM space_owners')
        .all()
        .map((r) => [String(r.space), String(r.workspace)]),
    )
  }
  documents(): SpaceDocument[] {
    return this.db
      .prepare('SELECT data FROM documents')
      .all()
      .map((r) => JSON.parse(String(r.data)) as SpaceDocument)
  }
  recordDocument(doc: SpaceDocument) {
    this.db
      .prepare(
        'INSERT INTO documents(workspace,id,data) VALUES(?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET data=excluded.data',
      )
      .run(doc.workspaceId, doc.id, JSON.stringify(doc))
  }
  assign(workspaceId: string, ideas: string[], spaces: string[]) {
    this.workspace(workspaceId)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of ideas) {
        const idea = this.get(id)
        if (idea.workspaceId && idea.workspaceId !== workspaceId)
          throw new Error('This idea already belongs to another workspace.')
        this.put({ ...idea, workspaceId, revision: idea.revision + (idea.workspaceId ? 0 : 1) })
      }
      for (const spaceId of spaces) {
        if (this.owners()[spaceId] && this.owners()[spaceId] !== workspaceId)
          throw new Error('This shared space already belongs to another workspace.')
        this.db
          .prepare('INSERT OR IGNORE INTO space_owners(space,workspace) VALUES(?,?)')
          .run(spaceId, workspaceId)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  /** Validate document persistence before committing an editable idea revision. */
  beforeSave: (idea: SpaceIdea) => void = () => {}
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
          if (
            idea.title !== input.title ||
            idea.text !== input.text ||
            idea.workspaceId !== (input.workspaceId ?? null)
          )
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
            workspaceId: input.workspaceId ?? null,
          })
      } else if (input.action === 'save') {
        const old = this.get(input.id)
        if (old.revision !== input.revision)
          throw new Error('This idea changed. Reopen it before saving; your text is still here.')
        if (old.prepared && !old.workflowSpaceId)
          throw new Error(
            'This plan has prepared assignments. Follow them in Handoffs; capture a new idea for a revised plan.',
          )
        if (new Set(input.assignments.map((a) => a.id)).size !== input.assignments.length)
          throw new Error('Assignment IDs must be unique.')
        idea = this.put({ ...old, ...input, revision: old.revision + 1, at: Date.now() })
      } else throw new Error('Unsupported idea edit.')
      this.beforeSave(idea)
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
