import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readBackup } from './backup'
import { attachmentMime } from './attachments'
import { MemoryError } from './errors'
export { MemoryError } from './errors'
import {
  memoryInput,
  MEMORY_ATTACHMENT_LIMIT,
  type MemoryInput,
  type MemorySpace,
  type MemoryFolder,
  type MemoryItem,
  type MemoryRevision,
  type MemoryGrant,
  type MemoryTask,
  type MemoryMessage,
  type MemoryEvent,
  type MemorySnapshot,
  type MemoryRead,
  type MemorySubscription,
} from '../../shared/memory'

type Kind = 'space' | 'folder' | 'item' | 'revision' | 'grant' | 'task' | 'message' | 'subscription'
type RecordValue =
  | MemorySubscription
  | MemorySpace
  | MemoryFolder
  | MemoryItem
  | MemoryRevision
  | MemoryGrant
  | MemoryTask
  | MemoryMessage
export interface MemoryActor {
  grantId?: string
  taskId?: string
}
const fail = (code: string, message: string): never => {
  throw new MemoryError(code, message)
}
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')
const required = <T>(value: T | undefined, label: string): T =>
  value === undefined ? fail('invalid_input', `Missing ${label}.`) : value
const normalName = (s: string) =>
  s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')

/** One local transactional authority. Provider data is never written by this store. */
export class MemoryStore {
  private db: DatabaseSync
  private active = false
  onChange: () => void = () => {}
  beforeCommit: () => void = () => {}
  executionContext: (
    spaceId: string,
    assignee?: string,
  ) => { workspaceId: string; root: string; documentsRoot: string } | undefined = () => undefined
  constructor(
    readonly file: string,
    readonly now = Date.now,
  ) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;',
    )
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version.user_version > 1) {
      this.db.close()
      throw new Error('Shared memory was created by a newer Threadlight.')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, space TEXT NOT NULL, parent TEXT NOT NULL DEFAULT '', name TEXT, archived INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_space ON records(space,kind);
      CREATE UNIQUE INDEX IF NOT EXISTS revision_lookup ON records(json_extract(data,'$.itemId'),json_extract(data,'$.revision')) WHERE kind='revision';
      CREATE UNIQUE INDEX IF NOT EXISTS folder_names ON records(space,parent,name) WHERE kind='folder' AND archived=0;
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, space TEXT NOT NULL, entity TEXT NOT NULL, action TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (principal TEXT NOT NULL, operation TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(principal,operation));
      CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;
    `)
    // An interrupted dispatch may have reached its provider; never replay it automatically.
    for (const task of this.all<MemoryTask>('task')) {
      if (task.deliveryState === 'dispatching' || ['dispatching', 'accepted'].includes(task.state))
        this.put('task', {
          ...task,
          deliveryState: 'unknown',
          state: ['submitted', 'resolved', 'cancelled'].includes(task.state)
            ? task.state
            : 'unknown',
          reason: 'Restart interrupted delivery. Check the destination before retrying.',
        })
      else if (task.state === 'queued')
        this.put('task', { ...task, state: 'paused', reason: 'Resume explicitly after restart.' })
    }
  }
  close() {
    this.db.close()
  }
  databaseForBackup() {
    return this.db
  }
  /** Prepare a whole reviewed split atomically; no task is authorised by this operation. */
  prepareHandoff(plan: MemoryInput, assignments: MemoryInput[]): string[] {
    return this.transaction(() => {
      const item = this.execute(plan) as MemoryItem
      return assignments.map(
        (input) =>
          (
            this.execute({
              ...input,
              inputs: [{ itemId: item.id, revision: item.revision }],
            }) as MemoryTask
          ).id,
      )
    })
  }
  restoreFrom(file: string) {
    if (
      this.tasks().some(
        (t) =>
          ['dispatching', 'unknown'].includes(t.deliveryState ?? '') ||
          ['dispatching', 'accepted', 'unknown'].includes(t.state),
      )
    )
      fail('busy', 'Resolve running or uncertain assignments before restoring memory.')
    const data = readBackup(file)
    return this.transaction(() => {
      this.db.exec(
        'DELETE FROM records; DELETE FROM blobs; DELETE FROM events; DELETE FROM operations; DELETE FROM preferences;',
      )
      for (const row of data.records) {
        const value = row.value as RecordValue
        if (row.kind === 'space') Object.assign(value, { paused: true, expiresAt: 0 })
        if (row.kind === 'grant') Object.assign(value, { revoked: true })
        if (row.kind === 'task') {
          const task = value as MemoryTask
          if (task.deliveryState === 'dispatching')
            Object.assign(task, { deliveryState: 'unknown' })
          if (['queued', 'dispatching', 'accepted', 'unknown'].includes(task.state))
            Object.assign(task, {
              state: task.state === 'queued' ? 'paused' : 'unknown',
              reason: 'Restored backup. Review the native chat before continuing.',
            })
        }
        this.put(row.kind, value)
      }
      for (const blob of data.blobs) {
        const revision = this.all<MemoryRevision>('revision').find((r) => r.blobId === blob.id)
        if (
          !revision ||
          attachmentMime(blob.data, revision.filename ?? '') !== blob.mime ||
          hash(blob.data) !== revision.hash
        )
          fail('invalid_backup', 'An attachment is damaged or has an unsupported format.')
        this.db
          .prepare('INSERT INTO blobs(id,mime,data) VALUES(?,?,?)')
          .run(blob.id, blob.mime, blob.data)
      }
      for (const folder of this.all<MemoryFolder>('folder')) {
        const seen = new Set<string>()
        let current: MemoryFolder | null = folder
        while (current) {
          if (seen.has(current.id) || seen.size >= 6 || current.spaceId !== folder.spaceId)
            fail('invalid_backup', 'Invalid folder hierarchy.')
          seen.add(current.id)
          current = current.parentId ? this.get<MemoryFolder>('folder', current.parentId) : null
        }
        this.get('space', folder.spaceId)
      }
      for (const item of this.all<MemoryItem>('item')) {
        if (this.get<MemoryFolder>('folder', item.folderId).spaceId !== item.spaceId)
          fail('invalid_backup', 'Invalid item destination.')
        this.read({}, item.id, item.revision)
        if (item.acceptedRevision) this.read({}, item.id, item.acceptedRevision)
      }
      for (const rev of this.all<MemoryRevision>('revision')) {
        if (
          this.get<MemoryItem>('item', rev.itemId).spaceId !== rev.spaceId ||
          (!rev.blobId && hash(rev.body) !== rev.hash)
        )
          fail('invalid_backup', 'A revision is damaged.')
        if (rev.blobId && !data.blobs.some((b) => b.id === rev.blobId))
          fail('invalid_backup', 'An attachment is missing.')
      }
      for (const event of data.events)
        this.db
          .prepare('INSERT INTO events(seq,space,entity,action,author,at) VALUES(?,?,?,?,?,?)')
          .run(event.seq, event.space, event.entity, event.action, event.author, event.at)
      return { restored: true, capabilitiesRevoked: true, coordinationPaused: true }
    })
  }
  private all<T extends RecordValue>(kind: Kind): T[] {
    return this.db
      .prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid')
      .all(kind)
      .map((r) => JSON.parse(String(r.data)) as T)
  }
  private get<T extends RecordValue>(kind: Kind, id: string): T {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id)
    if (!row) return fail('destination_unavailable', 'That memory record is unavailable.')
    return JSON.parse(String(row.data)) as T
  }
  private put(kind: Kind, record: RecordValue) {
    const folder = kind === 'folder' ? (record as MemoryFolder) : null
    this.db
      .prepare(
        'INSERT INTO records(id,kind,space,parent,name,archived,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent=excluded.parent,name=excluded.name,archived=excluded.archived,data=excluded.data',
      )
      .run(
        record.id,
        kind,
        record.spaceId,
        folder?.parentId ?? '',
        folder ? normalName(folder.title) : null,
        folder?.archived ? 1 : 0,
        JSON.stringify(record),
      )
  }
  private transaction<T>(fn: () => T): T {
    if (this.active) return fn()
    const changedBefore = this.db.prepare('SELECT total_changes() AS n').get()!.n
    this.db.exec('BEGIN IMMEDIATE')
    this.active = true
    let result: T
    try {
      result = fn()
      if (this.db.prepare('SELECT total_changes() AS n').get()!.n !== changedBefore)
        this.beforeCommit()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.active = false
    }
    // A detached renderer cannot undo a committed write or make a successful operation fail.
    try {
      if (this.db.prepare('SELECT total_changes() AS n').get()!.n !== changedBefore) this.onChange()
    } catch {
      /* The next snapshot recovers missed notifications. */
    }
    return result
  }
  private grant(actor: MemoryActor): MemoryGrant | null {
    if (!actor.grantId) return null
    const grant = this.get<MemoryGrant>('grant', actor.grantId)
    if (grant.revoked || (grant.expiresAt && this.now() >= grant.expiresAt))
      return fail('permission_denied', 'Memory access expired or was revoked.')
    if (grant.parentGrantId) this.grant({ grantId: grant.parentGrantId })
    return grant
  }
  author(actor: MemoryActor) {
    const grant = this.grant(actor)
    return grant ? `Capability: ${grant.label}` : 'Human'
  }
  private within(folderId: string | null, root: string | null): boolean {
    if (!root) return true
    const seen = new Set<string>()
    while (folderId && !seen.has(folderId)) {
      if (folderId === root) return true
      seen.add(folderId)
      folderId = this.get<MemoryFolder>('folder', folderId).parentId
    }
    return false
  }
  private activeFolder(id: string): boolean {
    let current: MemoryFolder | null = this.get<MemoryFolder>('folder', id)
    while (current) {
      if (current.archived) return false
      current = current.parentId ? this.get<MemoryFolder>('folder', current.parentId) : null
    }
    return true
  }
  private access(
    actor: MemoryActor,
    spaceId: string,
    folderId: string | null = null,
    write = false,
  ) {
    this.get<MemorySpace>('space', spaceId)
    const grant = this.grant(actor)
    if (
      grant &&
      (grant.spaceId !== spaceId ||
        !this.within(folderId, grant.folderId) ||
        (write && grant.readOnly))
    )
      fail('permission_denied', 'This capability does not allow that memory operation.')
    if (
      grant?.taskId &&
      write &&
      !this.within(folderId, this.get<MemoryTask>('task', grant.taskId).folderId)
    )
      fail('permission_denied', 'This assignment may only publish inside its output folder.')
  }
  private human(actor: MemoryActor) {
    if (actor.grantId) fail('permission_denied', 'This action requires the human.')
  }
  private folder(actor: MemoryActor, id: string, write = false): MemoryFolder {
    const folder = this.get<MemoryFolder>('folder', id)
    this.access(actor, folder.spaceId, id, write)
    let parent: MemoryFolder | null = folder
    while (parent) {
      if (write && parent.archived)
        fail(
          'destination_unavailable',
          'This folder or a parent is archived. Choose an active destination.',
        )
      parent = parent.parentId ? this.get<MemoryFolder>('folder', parent.parentId) : null
    }
    return folder
  }
  private event(spaceId: string, entityId: string, action: string, actor: MemoryActor) {
    this.db
      .prepare('INSERT INTO events(space,entity,action,author,at) VALUES(?,?,?,?,?)')
      .run(spaceId, entityId, action, this.author(actor), this.now())
  }
  authenticate(token: string): MemoryActor {
    const digest = hash(token)
    const grant = this.all<MemoryGrant>('grant').find((g) => !g.revoked && g.tokenHash === digest)
    if (!grant) return fail('permission_denied', 'Invalid shared-memory capability.')
    this.grant({ grantId: grant.id })
    return { grantId: grant.id, taskId: grant.taskId }
  }
  snapshot(actor: MemoryActor = {}): MemorySnapshot {
    const grant = this.grant(actor)
    const spaces = this.all<MemorySpace>('space').filter((s) => !grant || grant.spaceId === s.id)
    const folders = this.all<MemoryFolder>('folder').filter(
      (f) =>
        spaces.some((s) => s.id === f.spaceId) && (!grant || this.within(f.id, grant.folderId)),
    )
    const ids = new Set(folders.map((f) => f.id))
    const items = this.all<MemoryItem>('item').filter((i) => ids.has(i.folderId))
    const itemIds = new Set(items.map((i) => i.id))
    const tasks = this.all<MemoryTask>('task').filter(
      (t) => ids.has(t.folderId) && (!grant || t.inputs.every((i) => itemIds.has(i.itemId))),
    )
    const taskIds = new Set(tasks.map((t) => t.id))
    const messages = this.all<MemoryMessage>('message').filter(
      (m) =>
        spaces.some((s) => s.id === m.spaceId) &&
        (!m.taskId || taskIds.has(m.taskId)) &&
        (!m.itemId || itemIds.has(m.itemId)) &&
        (!grant?.folderId || m.taskId || m.itemId),
    )
    const entities = new Set([...ids, ...itemIds, ...taskIds, ...messages.map((m) => m.id)])
    const events = this.db
      .prepare(
        'SELECT seq,space AS spaceId,entity AS entityId,action,author,at FROM events ORDER BY seq DESC LIMIT 500',
      )
      .all() as unknown as MemoryEvent[]
    const cursor = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM events').get()!.n)
    return {
      subscriptions: this.all<MemorySubscription>('subscription').filter((s) =>
        ids.has(s.folderId),
      ),
      participants: this.all<MemoryGrant>('grant')
        .filter(
          (g) =>
            !g.revoked &&
            !g.taskId &&
            g.assignee &&
            spaces.some((s) => s.id === g.spaceId) &&
            (!g.folderId || ids.has(g.folderId)),
        )
        .map((g) => ({
          label: g.label,
          assignee: g.assignee!,
          folderId: g.folderId,
          spaceId: g.spaceId,
        })),
      spaces,
      folders,
      items,
      tasks,
      messages,
      grants: grant
        ? []
        : this.all<MemoryGrant>('grant')
            .filter((g) => !g.taskId)
            .map(({ tokenHash: _hash, ...g }) => g),
      events: events.filter(
        (e) => (!grant && spaces.some((s) => s.id === e.spaceId)) || entities.has(e.entityId),
      ),
      cursor,
      seen: grant ? 0 : Number(this.preference('seen') ?? 0),
      drafts: grant
        ? {}
        : (JSON.parse(this.preference('drafts') ?? '{}') as Record<string, string>),
      endpoint: null,
    }
  }
  briefing(actor: MemoryActor = {}) {
    const s = this.snapshot(actor),
      g = this.grant(actor)
    const relevant = s.tasks.filter((t) =>
      g?.taskId ? t.id === g.taskId : g?.assignee ? t.assignee === g.assignee : false,
    )
    return {
      enrollment: g
        ? {
            label: g.label,
            spaceId: g.spaceId,
            folderId: g.folderId,
            assignee: g.assignee,
            taskId: g.taskId,
            readOnly: g.readOnly,
            createFolders: g.createFolders,
            delegate: g.delegate,
          }
        : null,
      cursor: s.cursor,
      spaces: s.spaces.map(({ id, title, description }) => ({ id, title, description })),
      sectors: s.folders
        .filter((f) => !f.archived)
        .slice(0, 40)
        .map(({ id, parentId, title, description }) => ({ id, parentId, title, description })),
      assignments: relevant.slice(0, 10),
      omittedSectors: Math.max(0, s.folders.filter((f) => !f.archived).length - 40),
      omittedAssignments: Math.max(0, relevant.length - 10),
      next: 'Search to locate relevant material; read each pinned input by item ID and revision. Snapshot lists remaining metadata. Check changes after this cursor at the next task boundary. Only submit saved outputs; the human accepts results.',
    }
  }
  private preference(key: string) {
    return this.db.prepare('SELECT value FROM preferences WHERE key=?').get(key)?.value as
      string | undefined
  }
  private setPreference(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value)
  }
  read(actor: MemoryActor, id: string, revision?: number): MemoryRead {
    const item = this.get<MemoryItem>('item', id)
    this.folder(actor, item.folderId)
    const row = this.db
      .prepare(
        "SELECT data FROM records WHERE kind='revision' AND json_extract(data,'$.itemId')=? AND json_extract(data,'$.revision')=?",
      )
      .get(id, revision ?? item.revision)
    const rev = row ? (JSON.parse(String(row.data)) as MemoryRevision) : undefined
    if (!rev) return fail('destination_unavailable', 'That item version is unavailable.')
    const blob = rev.blobId
      ? this.db.prepare('SELECT data,mime FROM blobs WHERE id=?').get(rev.blobId)
      : null
    return {
      item,
      revision: rev,
      ...(blob
        ? {
            dataUrl: `data:${String(blob.mime)};base64,${Buffer.from(blob.data as Uint8Array).toString('base64')}`,
          }
        : {}),
    }
  }
  execute(raw: unknown, actor: MemoryActor = {}): unknown {
    const input = memoryInput.parse(raw)
    if (input.action === 'briefing') return this.briefing(actor)
    if (input.action === 'snapshot') return this.snapshot(actor)
    if (input.action === 'read') return this.read(actor, required(input.id, 'item'), input.revision)
    if (input.action === 'search') {
      const snapshot = this.snapshot(actor),
        query = (input.query ?? '').toLowerCase()
      const matchesScope = (spaceId: string, folderId: string) =>
        (!input.spaceId || spaceId === input.spaceId) &&
        (!input.folderId || this.within(folderId, input.folderId))
      return {
        folders: snapshot.folders.filter(
          (f) =>
            this.activeFolder(f.id) &&
            matchesScope(f.spaceId, f.id) &&
            `${f.title} ${f.description}`.toLowerCase().includes(query),
        ),
        items: snapshot.items
          .filter(
            (i) =>
              !i.archived &&
              this.activeFolder(i.folderId) &&
              matchesScope(i.spaceId, i.folderId) &&
              `${i.title} ${this.read(actor, i.id).revision.body}`.toLowerCase().includes(query),
          )
          .slice(0, 100),
        tasks: snapshot.tasks
          .filter(
            (t) =>
              matchesScope(t.spaceId, t.folderId) &&
              (`${t.title} ${t.body} ${t.reply}`.toLowerCase().includes(query) ||
                snapshot.messages.some(
                  (m) => m.taskId === t.id && m.body.toLowerCase().includes(query),
                )),
          )
          .slice(0, 100),
      }
    }
    if (input.action === 'changes') {
      const s = this.snapshot(actor)
      const oldest = Number(
        this.db.prepare('SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET 499').get()?.seq ??
          0,
      )
      return {
        events: s.events.filter((e) => e.seq > (input.cursor ?? 0)).reverse(),
        cursor: s.cursor,
        snapshotRequired: oldest > 0 && (input.cursor ?? 0) < oldest - 1,
      }
    }
    const operation = required(input.operationId, 'operation ID')
    return this.transaction(() => {
      const principal = actor.grantId ?? 'human'
      this.grant(actor)
      const digest = hash(JSON.stringify(input))
      const previous = this.db
        .prepare('SELECT digest,result FROM operations WHERE principal=? AND operation=?')
        .get(principal, operation)
      if (previous) {
        if (previous.digest !== digest)
          fail('operation_conflict', 'This operation ID belongs to different input.')
        const result = JSON.parse(String(previous.result)) as { folder?: MemoryFolder }
        if (input.action === 'ensure_folder' && result.folder)
          return { outcome: 'existing', folder: this.folder(actor, result.folder.id) }
        return result
      }
      const result = this.mutate(input, actor)
      const persisted =
        input.action === 'create_grant'
          ? { id: (result as { id: string }).id, secretUnavailable: true }
          : result
      this.db
        .prepare('INSERT INTO operations(principal,operation,digest,result) VALUES(?,?,?,?)')
        .run(principal, operation, digest, JSON.stringify(persisted))
      return result
    })
  }
  private base(spaceId: string, actor: MemoryActor) {
    return { id: randomUUID(), spaceId, author: this.author(actor), createdAt: this.now() }
  }
  private mutate(i: MemoryInput, actor: MemoryActor): unknown {
    const space = () => required(i.spaceId, 'space')
    const identity = () => required(i.id, 'record ID')
    switch (i.action) {
      case 'create_space': {
        this.human(actor)
        const id = randomUUID()
        const record: MemorySpace = {
          ...this.base(id, actor),
          id,
          title: required(i.title, 'title'),
          description: i.description ?? '',
          mode: 'manual',
          paused: true,
          maxDispatches: 10,
          dispatches: 0,
          expiresAt: 0,
        }
        this.put('space', record)
        this.event(id, id, 'Space created', actor)
        return record
      }
      case 'update_space': {
        this.human(actor)
        const record = this.get<MemorySpace>('space', identity())
        if (
          i.resetBudget &&
          this.tasks().some(
            (t) =>
              t.spaceId === record.id &&
              (['dispatching', 'unknown'].includes(t.deliveryState ?? '') ||
                ['dispatching', 'accepted', 'unknown'].includes(t.state)),
          )
        )
          fail('busy', 'Resolve running or uncertain turns before resetting this budget.')
        const next = {
          ...record,
          title: i.title ?? record.title,
          mode: i.mode ?? record.mode,
          paused: i.paused ?? record.paused,
          maxDispatches: i.maxDispatches ?? record.maxDispatches,
          dispatches: i.resetBudget ? 0 : record.dispatches,
          expiresAt: i.durationMinutes ? this.now() + i.durationMinutes * 60_000 : record.expiresAt,
        }
        this.put('space', next)
        this.event(record.id, record.id, 'Coordination policy updated', actor)
        return next
      }
      case 'ensure_folder':
        return this.ensureFolder(i, actor)
      case 'update_folder':
        return this.updateFolder(i, actor)
      case 'merge_folder':
        return this.mergeFolder(i, actor)
      case 'create_item': {
        const folder = this.folder(actor, required(i.folderId, 'folder'), true)
        const item: MemoryItem = {
          ...this.base(folder.spaceId, actor),
          folderId: folder.id,
          title: required(i.title, 'title'),
          kind: i.kind ?? 'note',
          revision: 1,
          acceptedRevision: null,
          archived: false,
        }
        if (['image', 'document'].includes(item.kind))
          fail('invalid_input', 'Import attachments through the attachment action.')
        this.put('item', item)
        this.addRevision(item, i.body ?? '', actor)
        this.event(folder.spaceId, item.id, 'Item published', actor)
        this.notifyItem(item, actor)
        return item
      }
      case 'import_attachment': {
        const encoded = required(i.data, 'base64 attachment')
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
          fail('invalid_input', 'Invalid base64 attachment.')
        const bytes = Buffer.from(encoded, 'base64'),
          filename = required(i.filename, 'filename')
        return this.importAttachment(
          required(i.folderId, 'folder'),
          filename,
          attachmentMime(bytes, filename),
          bytes,
          actor,
        )
      }
      case 'revise_item': {
        const item = this.get<MemoryItem>('item', identity())
        this.folder(actor, item.folderId, true)
        if (item.archived) fail('destination_unavailable', 'This item is archived.')
        if (item.revision !== i.expectedRevision)
          fail(
            'revision_conflict',
            'This item changed. Read the current version before proposing another revision.',
          )
        if (['image', 'document'].includes(item.kind))
          fail('invalid_input', 'Publish a new attachment instead of replacing its binary data.')
        const next = { ...item, title: i.title ?? item.title, revision: item.revision + 1 }
        this.addRevision(next, required(i.body, 'body'), actor)
        this.put('item', next)
        this.event(item.spaceId, item.id, 'Revision proposed', actor)
        this.notifyItem(next, actor)
        return next
      }
      case 'accept_item':
      case 'archive_item':
      case 'purge_item': {
        this.human(actor)
        const item = this.get<MemoryItem>('item', identity())
        if (i.action === 'purge_item') {
          for (const revision of this.all<MemoryRevision>('revision').filter(
            (r) => r.itemId === item.id,
          )) {
            if (revision.blobId)
              this.db.prepare('DELETE FROM blobs WHERE id=?').run(revision.blobId)
            this.db.prepare('DELETE FROM records WHERE id=?').run(revision.id)
          }
          this.db.prepare('DELETE FROM records WHERE id=?').run(item.id)
          this.db
            .prepare("DELETE FROM records WHERE kind='message' AND json_extract(data,'$.itemId')=?")
            .run(item.id)
          const drafts = JSON.parse(this.preference('drafts') ?? '{}') as Record<string, string>
          for (const key of Object.keys(drafts)) if (key.endsWith(item.id)) delete drafts[key]
          this.setPreference('drafts', JSON.stringify(drafts))
          // Idempotency responses can contain a former body; remove them on explicit purge.
          this.db
            .prepare('UPDATE operations SET result=? WHERE result LIKE ?')
            .run(JSON.stringify({ purged: true }), `%${item.id}%`)
          for (const task of this.tasks().filter(
            (t) =>
              t.inputs.some((ref) => ref.itemId === item.id) &&
              ['queued', 'draft', 'paused', 'blocked'].includes(t.state),
          ))
            this.put('task', {
              ...task,
              state: 'blocked',
              reason: 'An input was purged. Create a new assignment with available inputs.',
            })
          this.event(
            item.spaceId,
            item.id,
            'Item purged; provider copies remain outside Threadlight',
            actor,
          )
          return { id: item.id }
        }
        const next =
          i.action === 'accept_item'
            ? {
                ...item,
                acceptedRevision: this.read(actor, item.id, required(i.revision, 'revision'))
                  .revision.revision,
              }
            : { ...item, archived: i.archived ?? true }
        this.put('item', next)
        this.event(
          item.spaceId,
          item.id,
          i.action === 'accept_item' ? 'Revision accepted' : 'Item archive changed',
          actor,
        )
        return next
      }
      case 'create_grant': {
        this.human(actor)
        if ((i.readOnly ?? true) && (i.createFolders || i.delegate))
          fail(
            'invalid_input',
            'Enable publishing drafts before granting folder creation or delegation.',
          )
        this.access(actor, space(), i.folderId ?? null)
        if (i.folderId && this.folder(actor, i.folderId).spaceId !== space())
          fail('invalid_input', 'Folder belongs to another space.')
        const token = randomBytes(32).toString('hex')
        const grant: MemoryGrant = {
          ...this.base(space(), actor),
          label: required(i.title, 'capability label'),
          pluginConnectionId: i.connectionId,
          folderId: i.folderId ?? null,
          readOnly: i.readOnly ?? true,
          createFolders: i.createFolders ?? false,
          delegate: i.delegate ?? false,
          revoked: false,
          tokenHash: hash(token),
          assignee: i.assignee,
        }
        this.put('grant', grant)
        this.event(space(), grant.id, 'Capability enrolled', actor)
        // Return secret once. execute() excludes this action from persisted responses below.
        return { id: grant.id, token, label: grant.label }
      }
      case 'revoke_grant': {
        this.human(actor)
        const grant = this.get<MemoryGrant>('grant', identity())
        this.put('grant', { ...grant, revoked: true })
        this.event(grant.spaceId, grant.id, 'Capability revoked', actor)
        return { id: grant.id }
      }
      case 'create_task':
        return this.createTask(i, actor)
      case 'authorize_task':
      case 'pause_task':
      case 'cancel_task':
      case 'resolve_task':
      case 'submit_result':
      case 'reconcile_task':
        return this.changeTask(i, actor)
      case 'subscribe': {
        this.human(actor)
        const folder = this.folder(actor, required(i.folderId, 'folder'), true)
        const assignee = required(i.assignee, 'recipient')
        const existing = this.all<MemorySubscription>('subscription').find(
          (s) => s.folderId === folder.id && s.assignee === assignee && s.active,
        )
        if (existing) return existing
        const sub: MemorySubscription = {
          ...this.base(folder.spaceId, actor),
          folderId: folder.id,
          assignee,
          title: required(i.title, 'subscription title'),
          body: required(i.body, 'review instructions'),
          active: true,
        }
        this.put('subscription', sub)
        this.event(folder.spaceId, sub.id, 'Subscription created', actor)
        return sub
      }
      case 'unsubscribe': {
        this.human(actor)
        const sub = this.get<MemorySubscription>('subscription', identity())
        this.put('subscription', { ...sub, active: false })
        this.event(sub.spaceId, sub.id, 'Subscription stopped', actor)
        return { id: sub.id }
      }
      case 'post_message': {
        const task = i.targetId ? this.get<MemoryTask>('task', i.targetId) : null
        const item = i.id ? this.get<MemoryItem>('item', i.id) : null
        if (task && item) fail('invalid_input', 'Choose either an item or a task discussion.')
        this.access(actor, space(), task?.folderId ?? item?.folderId ?? null, true)
        if (item && item.spaceId !== space()) fail('invalid_input', 'Wrong message space.')
        if (task) {
          this.folder(actor, task.folderId)
          if (task.spaceId !== space()) fail('invalid_input', 'Wrong message space.')
        }
        const message: MemoryMessage = {
          ...this.base(space(), actor),
          taskId: task?.id ?? null,
          itemId: item?.id ?? null,
          body: required(i.body, 'message'),
        }
        this.put('message', message)
        this.event(space(), message.id, 'Message recorded', actor)
        return message
      }
      case 'save_draft': {
        this.human(actor)
        const drafts = JSON.parse(this.preference('drafts') ?? '{}') as Record<string, string>
        drafts[required(i.draftKey, 'draft key')] = i.body ?? ''
        this.setPreference('drafts', JSON.stringify(drafts))
        return { saved: true }
      }
      case 'mark_seen':
        this.human(actor)
        this.setPreference('seen', String(i.cursor ?? 0))
        return { saved: true }
      default:
        return fail('invalid_input', 'Unsupported memory action.')
    }
  }
  private ensureFolder(i: MemoryInput, actor: MemoryActor) {
    const spaceId = required(i.spaceId, 'space'),
      parentId = i.parentId ?? null
    this.access(actor, spaceId, parentId, true)
    if (parentId && this.folder(actor, parentId, true).spaceId !== spaceId)
      fail('invalid_input', 'Parent belongs to another space.')
    const grant = this.grant(actor)
    if (grant && !grant.createFolders) fail('permission_denied', 'Folder creation was not granted.')
    const title = required(i.title, 'title').trim().replace(/\s+/gu, ' ')
    if (
      [...title].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\',
      )
    )
      fail('invalid_input', 'Use a folder title, not a path.')
    const existing = this.all<MemoryFolder>('folder').find(
      (f) =>
        f.spaceId === spaceId &&
        f.parentId === parentId &&
        !f.archived &&
        normalName(f.title) === normalName(title),
    )
    if (existing) return { outcome: 'existing', folder: existing }
    let depth = 1,
      parent = parentId
    while (parent) {
      depth++
      parent = this.get<MemoryFolder>('folder', parent).parentId
    }
    if (depth > 6) fail('limit_reached', 'Folders may be nested up to six levels.')
    if (this.all<MemoryFolder>('folder').filter((f) => f.spaceId === spaceId).length >= 2000)
      fail('limit_reached', 'This space has reached its 2000-folder limit.')
    if (grant) {
      const count = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM events WHERE action='Folder created' AND author=? AND at>?",
        )
        .get(this.author(actor), this.now() - 60_000)
      if (Number(count?.n) >= 20)
        fail('limit_reached', 'Wait before creating more folders (20 per minute).')
    }
    const folder: MemoryFolder = {
      ...this.base(spaceId, actor),
      title,
      description: required(i.description, 'description'),
      reason: required(i.reason, 'reason'),
      parentId,
      revision: 1,
      archived: false,
    }
    this.put('folder', folder)
    this.event(spaceId, folder.id, 'Folder created', actor)
    return { outcome: 'created', folder }
  }
  private updateFolder(i: MemoryInput, actor: MemoryActor) {
    this.human(actor)
    const folder = this.get<MemoryFolder>('folder', required(i.id, 'folder'))
    if (folder.revision !== i.expectedRevision)
      fail('revision_conflict', 'This folder changed. Refresh before editing.')
    const parentId = i.parentId === undefined ? folder.parentId : i.parentId
    if (parentId === folder.id || (parentId && this.within(parentId, folder.id)))
      fail('invalid_input', 'A folder cannot be moved inside itself.')
    if (parentId && this.folder(actor, parentId, true).spaceId !== folder.spaceId)
      fail('invalid_input', 'Cross-space moves require an explicit copy.')
    this.checkMoveDepth(folder.id, parentId)
    if (
      parentId !== folder.parentId &&
      this.all<MemoryGrant>('grant').some(
        (g) => !g.revoked && !g.taskId && g.spaceId === folder.spaceId && g.folderId,
      )
    )
      fail(
        'permission_denied',
        'Revoke scoped capabilities before moving folders; their access could change.',
      )
    const title = i.title ?? folder.title
    if (
      [...title].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\',
      )
    )
      fail('invalid_input', 'Invalid folder title.')
    const collision = this.all<MemoryFolder>('folder').some(
      (f) =>
        f.id !== folder.id &&
        f.spaceId === folder.spaceId &&
        f.parentId === parentId &&
        !f.archived &&
        normalName(f.title) === normalName(title),
    )
    if (collision && !(i.archived ?? folder.archived))
      fail('name_conflict', 'That parent already has a folder with this name.')
    const next = {
      ...folder,
      title,
      description: i.description ?? folder.description,
      parentId,
      archived: i.archived ?? folder.archived,
      revision: folder.revision + 1,
    }
    this.put('folder', next)
    if (parentId !== folder.parentId || next.archived) this.invalidateDestinations(folder.id)
    this.event(folder.spaceId, folder.id, 'Folder updated', actor)
    return next
  }
  private mergeFolder(i: MemoryInput, actor: MemoryActor) {
    this.human(actor)
    const source = this.folder(actor, required(i.id, 'source'), true),
      target = this.folder(actor, required(i.targetId, 'destination'), true)
    if (source.spaceId !== target.spaceId || this.within(target.id, source.id))
      fail('invalid_input', 'Choose a separate folder in the same space.')
    if (
      this.all<MemoryGrant>('grant').some(
        (g) => !g.revoked && !g.taskId && g.spaceId === source.spaceId && g.folderId,
      )
    )
      fail('permission_denied', 'Revoke scoped capabilities before merging folders.')
    const children = this.all<MemoryFolder>('folder').filter((f) => f.parentId === source.id)
    const targetNames = new Set(
      this.all<MemoryFolder>('folder')
        .filter((f) => f.parentId === target.id && !f.archived)
        .map((f) => normalName(f.title)),
    )
    if (children.some((f) => !f.archived && targetNames.has(normalName(f.title))))
      fail('name_conflict', 'Resolve child-folder name collisions before merging.')
    for (const child of children) this.checkMoveDepth(child.id, target.id)
    this.invalidateDestinations(source.id)
    for (const child of children)
      this.put('folder', { ...child, parentId: target.id, revision: child.revision + 1 })
    for (const item of this.all<MemoryItem>('item').filter((item) => item.folderId === source.id))
      this.put('item', { ...item, folderId: target.id })
    this.put('folder', {
      ...source,
      archived: true,
      redirectId: target.id,
      revision: source.revision + 1,
    })
    this.event(source.spaceId, source.id, 'Folder merged', actor)
    return target
  }
  private checkMoveDepth(id: string, parentId: string | null) {
    let depth = 1,
      parent = parentId
    while (parent) {
      depth++
      parent = this.get<MemoryFolder>('folder', parent).parentId
    }
    const visit = (root: string, level: number) => {
      if (level > 6) fail('limit_reached', 'This move would exceed the six-level folder limit.')
      for (const child of this.all<MemoryFolder>('folder').filter((f) => f.parentId === root))
        visit(child.id, level + 1)
    }
    visit(id, depth)
  }
  private invalidateDestinations(folderId: string) {
    for (const task of this.all<MemoryTask>('task').filter(
      (t) =>
        this.within(t.folderId, folderId) &&
        (!['resolved', 'cancelled'].includes(t.state) ||
          ['dispatching', 'unknown'].includes(t.deliveryState ?? '')),
    ))
      this.put('task', {
        ...task,
        state: ['dispatching', 'accepted', 'unknown'].includes(task.state)
          ? 'unknown'
          : ['draft', 'queued', 'paused', 'blocked'].includes(task.state)
            ? 'blocked'
            : task.state,
        deliveryState: task.deliveryState === 'dispatching' ? 'unknown' : task.deliveryState,
        reason: 'Output folder changed. Review this task before continuing.',
      })
  }
  private addRevision(
    item: MemoryItem,
    body: string,
    actor: MemoryActor,
    attachment?: { data: Buffer; mime: string; filename: string },
  ) {
    const revision: MemoryRevision = {
      ...this.base(item.spaceId, actor),
      itemId: item.id,
      revision: item.revision,
      body,
      hash: hash(attachment?.data ?? body),
      source: actor.grantId ? `capability:${actor.grantId}` : 'human',
    }
    if (attachment) {
      revision.blobId = randomUUID()
      revision.mime = attachment.mime
      revision.filename = attachment.filename
      this.db
        .prepare('INSERT INTO blobs(id,mime,data) VALUES(?,?,?)')
        .run(revision.blobId, attachment.mime, attachment.data)
    }
    this.put('revision', revision)
  }
  importAttachment(
    folderId: string,
    filename: string,
    mime: string,
    data: Buffer,
    actor: MemoryActor = {},
  ) {
    if (data.length > MEMORY_ATTACHMENT_LIMIT)
      fail('limit_reached', 'Attachments are limited to 10 MiB.')
    if (
      filename.length > 255 ||
      /[\\/]/.test(filename) ||
      [...filename].some((c) => c.charCodeAt(0) < 32)
    )
      fail('invalid_input', 'Use a plain filename.')
    if (attachmentMime(data, filename) !== mime)
      fail('invalid_input', 'The attachment bytes do not match their declared type.')
    if (
      ![
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown',
      ].includes(mime)
    )
      fail('invalid_input', 'Unsupported attachment type.')
    return this.transaction(() => {
      const folder = this.folder(actor, folderId, true)
      const item: MemoryItem = {
        ...this.base(folder.spaceId, actor),
        folderId,
        title: filename.slice(0, 80),
        kind: mime.startsWith('image/') ? 'image' : 'document',
        revision: 1,
        acceptedRevision: null,
        archived: false,
      }
      this.put('item', item)
      this.addRevision(item, mime.startsWith('text/') ? data.toString('utf8') : '', actor, {
        data,
        mime,
        filename,
      })
      this.event(folder.spaceId, item.id, 'Attachment published', actor)
      this.notifyItem(item, actor)
      return item
    })
  }
  private createTask(i: MemoryInput, actor: MemoryActor) {
    if ((i.body?.length ?? 0) > 12000)
      fail(
        'limit_reached',
        'Assignment instructions are limited to 12,000 characters; attach large context as pinned items.',
      )
    const folder = this.folder(actor, required(i.folderId, 'output folder'), true)
    const workspace = this.executionContext(folder.spaceId, i.assignee)
    const inputs = i.inputs ?? []
    for (const ref of inputs)
      if (this.read(actor, ref.itemId, ref.revision).item.spaceId !== folder.spaceId)
        fail('permission_denied', 'Task inputs must belong to this space.')
    const grant = this.grant(actor),
      space = this.get<MemorySpace>('space', folder.spaceId)
    const originTaskId = actor.taskId ?? i.originTaskId
    const visited = new Set<string>()
    let ancestor = originTaskId
    while (ancestor) {
      if (visited.has(ancestor) || visited.size >= 4)
        fail('limit_reached', 'Coordination reached its four-hop limit.')
      visited.add(ancestor)
      const previous = this.get<MemoryTask>('task', ancestor)
      if (['resolved', 'cancelled'].includes(previous.state))
        fail(
          'invalid_input',
          'The originating task is closed. Ask the human to start a new assignment.',
        )
      if (previous.spaceId !== space.id)
        fail('permission_denied', 'The originating task belongs to another space.')
      if (grant && !actor.taskId && previous.assignee !== grant.assignee)
        fail('permission_denied', 'Only the enrolled recipient may continue that task chain.')
      if (previous.assignee === i.assignee)
        fail(
          'coordination_cycle',
          'This chain already includes that recipient. Ask the human to review it.',
        )
      ancestor = previous.originTaskId
    }
    const automatic =
      !!grant?.delegate &&
      !!originTaskId &&
      space.mode === 'automatic' &&
      !space.paused &&
      this.now() < space.expiresAt
    if (
      this.tasks().some(
        (t) =>
          t.spaceId === space.id &&
          t.assignee === i.assignee &&
          t.body === i.body &&
          !['resolved', 'cancelled'].includes(t.state),
      )
    )
      fail('duplicate_task', 'An equivalent assignment already exists for this recipient.')
    const task: MemoryTask = {
      ...(workspace
        ? {
            workspaceId: workspace.workspaceId,
            workspaceRoot: workspace.root,
            documentsRoot: workspace.documentsRoot,
          }
        : {}),
      ...this.base(folder.spaceId, actor),
      title: required(i.title, 'task title'),
      body: required(i.body, 'objective and acceptance criteria'),
      assignee: required(i.assignee, 'recipient chat'),
      folderId: folder.id,
      inputs,
      inputHeads: inputs.map((ref) => ({
        itemId: ref.itemId,
        revision: this.read(actor, ref.itemId, ref.revision).item.revision,
      })),
      outputIds: [],
      outputs: [],
      state: automatic ? 'queued' : 'draft',
      deliveryState: 'none',
      reason: automatic ? '' : 'Awaiting human authorisation.',
      updatedAt: this.now(),
      reply: '',
      originTaskId,
    }
    this.put('task', task)
    this.event(folder.spaceId, task.id, 'Task created', actor)
    return task
  }
  private changeTask(i: MemoryInput, actor: MemoryActor) {
    const task = this.get<MemoryTask>('task', required(i.id, 'task'))
    this.folder(actor, task.folderId, i.action === 'submit_result')
    if (i.action !== 'submit_result') this.human(actor)
    const next = { ...task, updatedAt: this.now() }
    if (i.action === 'submit_result') {
      const grant = this.grant(actor)
      if (grant && (grant.assignee !== task.assignee || (grant.taskId && grant.taskId !== task.id)))
        fail('permission_denied', 'This capability is not assigned to that task.')
      for (const id of i.outputIds ?? []) {
        const result = this.read(actor, id)
        if (result.item.folderId !== task.folderId)
          fail('invalid_input', 'Save results in the assigned output folder.')
      }
      if (!i.outputIds?.length) fail('invalid_input', 'A result needs at least one saved item.')
      if (['cancelled', 'resolved', 'draft', 'queued', 'paused', 'blocked'].includes(task.state))
        fail(
          'invalid_input',
          'This task is not accepting results. Post a late-result message instead.',
        )
      next.outputIds = i.outputIds!
      next.outputs = i.outputIds!.map((id) => ({
        itemId: id,
        revision: this.read(actor, id).item.revision,
      }))
      next.reply = i.body ?? ''
      next.state = 'submitted'
    } else if (i.action === 'reconcile_task') {
      if (task.state !== 'unknown' && task.deliveryState !== 'unknown')
        fail('invalid_input', 'Only uncertain delivery needs reconciliation.')
      if (!i.reason?.trim()) fail('invalid_input', 'Record the evidence from the native chat.')
      next.state =
        task.state === 'resolved'
          ? 'resolved'
          : required(i.delivered, 'native outcome')
            ? task.state === 'submitted'
              ? 'submitted'
              : 'completed'
            : 'cancelled'
      next.deliveryState = 'completed'
      next.reason = `Human checked native chat: ${i.reason}`
    } else if (i.action === 'authorize_task') {
      const context = this.executionContext(task.spaceId, task.assignee)
      if (context) {
        if (task.workspaceId && task.workspaceId !== context.workspaceId)
          fail('workspace_conflict', 'This assignment has a different workspace binding.')
        Object.assign(next, {
          workspaceId: context.workspaceId,
          workspaceRoot: context.root,
          documentsRoot: context.documentsRoot,
        })
      }
      if (!['draft', 'paused', 'blocked'].includes(task.state))
        fail('invalid_input', 'Only an unsent task can be authorised.')
      this.folder(actor, task.folderId, true)
      next.inputHeads = task.inputs.map((ref) => ({
        itemId: ref.itemId,
        revision: this.read(actor, ref.itemId, ref.revision).item.revision,
      }))
      next.state = 'queued'
      next.reason = ''
    } else if (i.action === 'pause_task' || i.action === 'cancel_task') {
      if (task.deliveryState === 'dispatching' || task.deliveryState === 'unknown')
        fail('invalid_input', 'This turn may still be running. Check its native chat first.')
      if (
        i.action === 'pause_task' &&
        !['draft', 'queued', 'paused', 'blocked'].includes(task.state)
      )
        fail(
          'invalid_input',
          'A dispatched task cannot be paused and resent. Check its native chat.',
        )
      if (['dispatching', 'accepted', 'unknown', 'resolved', 'cancelled'].includes(task.state))
        fail(
          'invalid_input',
          'This task cannot be resumed or cancelled safely here. Check its native application.',
        )
      next.state = i.action === 'pause_task' ? 'paused' : 'cancelled'
    } else {
      if (task.state !== 'submitted')
        fail('invalid_input', 'Review a submitted result before accepting.')
      for (const output of task.outputs) {
        const result = this.read(actor, output.itemId, output.revision)
        if (result.item.archived)
          fail('destination_unavailable', 'An output is archived. Restore it before accepting.')
      }
      next.state = 'resolved'
    }
    this.put('task', next)
    this.event(task.spaceId, task.id, `Task ${next.state}`, actor)
    return next
  }
  tasks() {
    return this.all<MemoryTask>('task')
  }
  private notifyItem(item: MemoryItem, actor: MemoryActor) {
    const author = this.grant(actor),
      space = this.space(item.spaceId)
    for (const sub of this.all<MemorySubscription>('subscription').filter(
      (s) =>
        s.active &&
        s.spaceId === item.spaceId &&
        this.within(item.folderId, s.folderId) &&
        s.assignee !== author?.assignee,
    )) {
      try {
        const pending = this.tasks().find(
          (t) =>
            t.subscriptionId === sub.id &&
            t.inputs.some((ref) => ref.itemId === item.id) &&
            ['draft', 'queued'].includes(t.state) &&
            t.originTaskId === actor.taskId,
        )
        if (pending) {
          this.put('task', {
            ...pending,
            inputs: [{ itemId: item.id, revision: item.revision }],
            inputHeads: [{ itemId: item.id, revision: item.revision }],
            body: `${sub.body}\n\nReview ${item.title}, version ${item.revision}.`,
            updatedAt: this.now(),
          })
          this.event(item.spaceId, pending.id, 'Subscription updates coalesced', {})
          continue
        }
        const task = this.createTask(
          {
            action: 'create_task',
            folderId: sub.folderId,
            assignee: sub.assignee,
            title: sub.title,
            body: `${sub.body}\n\nReview ${item.title}, version ${item.revision}. Subscription ${sub.id}.`,
            inputs: [{ itemId: item.id, revision: item.revision }],
            originTaskId: actor.taskId,
          },
          {},
        )
        if (space.mode === 'automatic' && !space.paused && this.now() < space.expiresAt)
          this.put('task', {
            ...task,
            subscriptionId: sub.id,
            state: 'queued',
            reason: 'Authorised subscription update.',
          })
        else
          this.put('task', {
            ...task,
            subscriptionId: sub.id,
            reason: 'Subscription update awaiting human authorisation.',
          })
      } catch (error) {
        this.event(
          item.spaceId,
          item.id,
          `Subscription held: ${error instanceof Error ? error.message : 'Review required'}`,
          {},
        )
      }
    }
  }
  prepareDelivery(id: string) {
    return this.transaction(() => {
      const task = this.get<MemoryTask>('task', id)
      const grant = this.all<MemoryGrant>('grant').find(
        (g) =>
          !g.revoked &&
          !g.taskId &&
          !g.readOnly &&
          g.assignee === task.assignee &&
          g.spaceId === task.spaceId &&
          this.within(task.folderId, g.folderId) &&
          task.inputs.every((ref) =>
            this.within(this.get<MemoryItem>('item', ref.itemId).folderId, g.folderId),
          ),
      )
      if (!grant)
        return fail(
          'permission_denied',
          'Enroll this recipient with access to the inputs and output folder before dispatch.',
        )
      const token = randomBytes(32).toString('hex')
      this.put('grant', {
        ...grant,
        id: randomUUID(),
        label: `Assignment: ${task.title}`.slice(0, 80),
        taskId: id,
        parentGrantId: grant.id,
        expiresAt: this.now() + 35 * 60_000,
        tokenHash: hash(token),
      })
      return token
    })
  }
  space(id: string) {
    return this.get<MemorySpace>('space', id)
  }
  updateDelivery(id: string, patch: Partial<Pick<MemoryTask, 'state' | 'reason' | 'reply'>>) {
    return this.transaction(() => {
      const task = this.get<MemoryTask>('task', id)
      const submitted = ['submitted', 'resolved', 'cancelled'].includes(task.state)
      const deliveryState =
        patch.state === 'dispatching' || patch.state === 'accepted'
          ? 'dispatching'
          : patch.state === 'completed'
            ? 'completed'
            : patch.state === 'unknown'
              ? 'unknown'
              : patch.state === 'blocked' || patch.state === 'paused'
                ? 'none'
                : task.deliveryState
      const next: MemoryTask = {
        ...task,
        ...patch,
        deliveryState,
        updatedAt: this.now(),
        nativeReply: patch.reply?.slice(0, 100000) ?? task.nativeReply,
        reply: submitted ? task.reply : (patch.reply?.slice(0, 100000) ?? task.reply),
        state:
          submitted && ['completed', 'unknown'].includes(patch.state ?? '')
            ? task.state
            : (patch.state ?? task.state),
      }
      this.put('task', next)
      this.event(task.spaceId, id, `Delivery ${next.deliveryState ?? next.state}`, {})
      return next
    })
  }
  reserveDispatch(id: string) {
    return this.transaction(() => {
      const task = this.get<MemoryTask>('task', id),
        space = this.space(task.spaceId)
      const context = this.executionContext(task.spaceId, task.assignee)
      if (context && task.workspaceId && task.workspaceId !== context.workspaceId)
        fail('workspace_conflict', 'This assignment has a different workspace binding.')
      if (task.state !== 'queued' || space.paused) return false
      if (space.dispatches >= space.maxDispatches || this.now() > space.expiresAt) {
        this.updateDelivery(id, {
          state: 'paused',
          reason: 'Coordination budget ended. Review the space limits.',
        })
        return false
      }
      for (const ref of task.inputs)
        if (
          this.read({}, ref.itemId, ref.revision).item.revision !==
          (task.inputHeads?.find((head) => head.itemId === ref.itemId)?.revision ?? ref.revision)
        ) {
          this.updateDelivery(id, {
            state: 'blocked',
            reason: 'An input changed. Review the pinned versions.',
          })
          return false
        }
      this.folder({}, task.folderId, true)
      this.put('space', { ...space, dispatches: space.dispatches + 1 })
      this.updateDelivery(id, { state: 'dispatching', reason: '' })
      return true
    })
  }
}
