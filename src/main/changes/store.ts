import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, open } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CoverageReason, TrackingAction, TrackingState } from '../../shared/changes'
import type { ChangedFile, FileDiff } from '../../shared/types'
import { captureText, digest, metrics, retainComparison, within, type LocalComparison } from './git'
import { compareText } from './text'
import { WorkQueue } from '../sessions/gitProcess'
import { ThreadDiffLedger, type RecordedChange } from '../sessions/threadDiff'

type Version = {
  hash?: string
  fingerprint?: string
  reason?: CoverageReason
  binary?: boolean
  text?: string
}
type Inventory = { files: Record<string, Version>; reasons: CoverageReason[]; bytes: number }
type Root = {
  id: string
  path: string
  identity: string
  enabled: number
  policy: number
  baseline: string | null
  epoch: string
}
const DEFAULT_LIMIT = 512 * 1024 * 1024
const captureQueue = new WorkQueue(2)
const EXCLUDE =
  /(^|\/)(\.git|\.hg|\.svn|node_modules|dist|build|out|coverage|\.cache|\.next|\.venv|venv|\.ssh|\.aws|\.azure|\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx)$/i

/** Local-only source history. Opening a registry never opts any folder into recording. */
export class LocalHistory {
  private db: DatabaseSync | undefined
  private queue = new WorkQueue(1)
  private pending = new Map<string, Promise<LocalComparison | null>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  constructor(
    private readonly directory: string,
    private readonly budget = DEFAULT_LIMIT,
  ) {}
  async start(): Promise<void> {
    if (await stat(join(this.directory, 'history.sqlite')).catch(() => null)) await this.database()
  }
  private async database(): Promise<DatabaseSync> {
    if (this.db) return this.db
    await mkdir(join(this.directory, 'blobs'), { recursive: true })
    if (this.db) return this.db
    const db = new DatabaseSync(join(this.directory, 'history.sqlite'))
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version > 1) {
      db.close()
      throw Error('Local history was created by a newer Threadlight version')
    }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY,path TEXT NOT NULL,identity TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,policy INTEGER NOT NULL DEFAULT 1,baseline TEXT,epoch TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY,root TEXT NOT NULL,created INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY,bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS boundaries(root TEXT PRIMARY KEY,epoch TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(logical TEXT PRIMARY KEY,root TEXT NOT NULL,revision TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,cursor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,epoch TEXT NOT NULL,cursor TEXT NOT NULL);
      PRAGMA user_version=1;`)
    this.db = db
    this.timer = setInterval(() => {
      if (this.closed || this.pending.size) return
      for (const root of db.prepare('SELECT path FROM roots WHERE enabled=1').all() as {
        path: string
      }[]) {
        void this.comparison(root.path).catch(() => {
          /* A disconnected root retains its baseline. */
        })
      }
    }, 5000)
    this.timer.unref()
    return db
  }
  async root(folder: string): Promise<Root> {
    const path = await realpath(folder),
      info = await stat(path)
    if (!info.isDirectory() || within(path, this.directory))
      throw Error('History store must be outside the recorded folder')
    const identity = `${path}\0${info.dev}\0${info.ino}`
    const id = digest(identity),
      db = await this.database()
    db.prepare('INSERT OR IGNORE INTO roots(id,path,identity,epoch) VALUES(?,?,?,?)').run(
      id,
      path,
      identity,
      randomUUID(),
    )
    return db.prepare('SELECT * FROM roots WHERE id=?').get(id) as Root
  }
  async state(folder: string): Promise<TrackingState> {
    const root = await this.root(folder),
      db = await this.database()
    const last = db
      .prepare('SELECT body FROM captures WHERE root=? ORDER BY created DESC LIMIT 1')
      .get(root.id) as { body: string } | undefined
    const reasons = last ? (JSON.parse(last.body) as Inventory).reasons : []
    return {
      rootId: root.id,
      root: root.path,
      recording: !!root.enabled,
      baseline: root.baseline,
      policyRevision: root.policy,
      bytes: Number(
        (db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM blobs').get() as { bytes: number })
          .bytes,
      ),
      limit: this.budget,
      reasons: [...reasons, ...(root.enabled ? [] : ['recording-disabled' as const])],
    }
  }
  async configure(
    folder: string,
    action: TrackingAction,
    expectedPolicy: number,
  ): Promise<TrackingState> {
    return this.queue.run(async () => {
      const root = await this.root(folder),
        db = await this.database()
      if (root.policy !== expectedPolicy)
        throw Error('Recording settings changed; refresh before trying again.')
      if (action === 'forget') {
        const epoch = randomUUID()
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('DELETE FROM captures WHERE root=?').run(root.id)
          db.prepare('DELETE FROM evidence WHERE root=?').run(root.id)
          db.prepare('INSERT OR REPLACE INTO boundaries VALUES(?,?,?)').run(
            root.id,
            epoch,
            Date.now(),
          )
          db.prepare(
            'UPDATE roots SET enabled=0,baseline=NULL,epoch=?,policy=policy+1 WHERE id=?',
          ).run(epoch, root.id)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        await this.collect()
      } else if (action === 'pause') {
        db.prepare('UPDATE roots SET enabled=0,policy=policy+1 WHERE id=?').run(root.id)
      } else {
        db.prepare('UPDATE roots SET enabled=1,policy=policy+1 WHERE id=?').run(root.id)
        const current = await this.root(folder)
        try {
          const inventory = await this.stableInventory(current)
          const id = this.save(current, inventory)
          if (action === 'baseline' || !current.baseline)
            db.prepare('UPDATE roots SET baseline=? WHERE id=?').run(id, root.id)
          if (inventory.reasons.includes('storage-limit'))
            db.prepare('UPDATE roots SET enabled=0,policy=policy+1 WHERE id=?').run(root.id)
        } catch (error) {
          db.prepare('UPDATE roots SET enabled=0,policy=policy+1 WHERE id=?').run(root.id)
          throw error
        }
      }
      return this.state(folder)
    })
  }
  private save(root: Root, inventory: Inventory): string {
    const id = digest(JSON.stringify([root.id, root.epoch, root.policy, inventory]))
    this.db!.prepare('INSERT OR IGNORE INTO captures VALUES(?,?,?,?)').run(
      id,
      root.id,
      Date.now(),
      JSON.stringify(inventory),
    )
    return id
  }
  private async blob(text: string): Promise<string> {
    const db = this.db!,
      bytes = Buffer.from(text),
      hash = digest(bytes)
    if (db.prepare('SELECT hash FROM blobs WHERE hash=?').get(hash)) return hash
    const used = Number(
      (db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM blobs').get() as { bytes: number })
        .bytes,
    )
    if (used + bytes.length > this.budget) throw Error('storage-limit')
    const target = join(this.directory, 'blobs', hash),
      temporary = `${target}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?)').run(hash, bytes.length)
    return hash
  }
  private async inventory(root: Root): Promise<Inventory> {
    const result: Inventory = {
      files: Object.create(null) as Record<string, Version>,
      reasons: [],
      bytes: 0,
    }
    let count = 0
    const walk = async (folder: string, prefix = ''): Promise<void> => {
      const canonical = await realpath(folder).catch(() => null)
      if (!canonical || !within(root.path, canonical)) {
        result.reasons.push('unreadable')
        return
      }
      let entries
      try {
        entries = await readdir(folder, { withFileTypes: true })
      } catch {
        result.reasons.push('unreadable')
        return
      }
      for (const entry of entries) {
        const path = prefix + entry.name
        if (++count > 20000) {
          result.reasons.push('inventory-limit')
          return
        }
        if (EXCLUDE.test(path)) {
          result.files[path] = { reason: 'excluded' }
          continue
        }
        if (entry.isSymbolicLink()) {
          result.files[path] = { reason: 'excluded' }
          continue
        }
        if (entry.isDirectory()) {
          // Nested repositories are independent roots, never an implicit recursive enrolment.
          if (await stat(join(folder, entry.name, '.git')).catch(() => null)) {
            result.files[path] = { reason: 'excluded' }
            continue
          }
          await walk(join(folder, entry.name), `${path}/`)
          continue
        }
        const content = await captureQueue.run(() => captureText(root.path, path))
        if (content.text === undefined) {
          result.files[path] = {
            fingerprint: content.hash,
            binary: content.binary,
            reason: content.reason ?? 'unsupported-encoding',
          }
          continue
        }
        result.bytes += Buffer.byteLength(content.text)
        if (result.bytes > 128 * 1024 * 1024) {
          result.files[path] = { reason: 'content-limit' }
          continue
        }
        try {
          result.files[path] = root.enabled
            ? { hash: await this.blob(content.text) }
            : { hash: digest(content.text), text: content.text }
        } catch {
          result.files[path] = { reason: 'storage-limit' }
          result.reasons.push('storage-limit')
        }
      }
    }
    await walk(root.path)
    const recheck = await this.root(root.path)
    if (recheck.id !== root.id || recheck.policy !== root.policy)
      throw Error('Recording root or policy changed during capture')
    result.reasons = [...new Set(result.reasons)]
    return result
  }
  private async stableInventory(root: Root): Promise<Inventory> {
    let previous = await this.inventory(root)
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = await this.inventory(root)
      if (JSON.stringify(previous.files) === JSON.stringify(next.files)) return next
      previous = next
    }
    previous.reasons.push('concurrent-write')
    return previous
  }
  async comparison(folder: string): Promise<LocalComparison | null> {
    if (!this.db && !this.closed) await this.start()
    if (!this.db || this.closed) return null
    const root = await this.root(folder)
    const running = this.pending.get(root.id)
    if (running) return running
    const promise = this.queue
      .run(() => this.compare(folder))
      .finally(() => this.pending.delete(root.id))
    this.pending.set(root.id, promise)
    return promise
  }
  /** Only explicit recording can persist source-bearing evidence. Native IDs deduplicate replay. */
  async recordEvidence(folder: string, actor: string, ledger: ThreadDiffLedger): Promise<void> {
    if (!this.db || this.closed) return
    await this.queue.run(async () => {
      const root = await this.root(folder),
        db = this.db!
      if (!root.enabled) return
      const source = digest(`${root.id}\0${root.epoch}\0${actor}`)
      const first = !db.prepare('SELECT id FROM sources WHERE id=?').get(source)
      const forgotten = !!db.prepare('SELECT root FROM boundaries WHERE root=?').get(root.id)
      const rows: { logical: string; revision: string; ordinal: number; body: string }[] = []
      for (const [ordinal, mutation] of ledger.mutations.entries()) {
        const path = relative(root.path, mutation.change.path).replace(/\\/g, '/')
        if (
          !within(root.path, mutation.change.path) ||
          EXCLUDE.test(path) ||
          (mutation.change.move &&
            (!within(root.path, mutation.change.move) ||
              EXCLUDE.test(relative(root.path, mutation.change.move).replace(/\\/g, '/')))) ||
          mutation.id.startsWith('unidentified:')
        )
          continue
        const logical = `${source}:${mutation.id}`,
          revision = digest(JSON.stringify(mutation.change))
        const prior = db.prepare('SELECT revision FROM evidence WHERE logical=?').get(logical) as
          { revision: string } | undefined
        if (prior) {
          // Current providers do not expose a reliable correction version. Conflicting
          // payloads cannot supersede an effective native operation based on arrival time.
          if (prior.revision !== revision) ledger.complete = false
          continue
        }
        let body = 'null'
        if (!(first && forgotten)) {
          try {
            body = JSON.stringify({ hash: await this.blob(JSON.stringify(mutation.change)), actor })
          } catch {
            ledger.complete = false
            continue
          }
        }
        rows.push({ logical, revision, ordinal, body })
      }
      const cursor = digest(JSON.stringify(ledger.mutations.map((item) => item.id)))
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const row of rows)
          db.prepare('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?)').run(
            row.logical,
            root.id,
            row.revision,
            row.ordinal,
            row.body,
            cursor,
          )
        db.prepare('INSERT OR REPLACE INTO sources VALUES(?,?,?)').run(source, root.epoch, cursor)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    })
  }
  async recordedEvidence(folder: string, actor: string): Promise<ThreadDiffLedger | null> {
    if (!this.db || this.closed) return null
    const root = await this.root(folder),
      source = digest(`${root.id}\0${root.epoch}\0${actor}`)
    const rows = this.db!.prepare(
      'SELECT logical,body FROM evidence WHERE root=? AND substr(logical,1,64)=? ORDER BY ordinal',
    ).all(root.id, source) as { logical: string; body: string }[]
    if (!rows.length) return null
    const ledger = new ThreadDiffLedger()
    ledger.complete = false // A retained source subset is not proof the provider is up to date.
    for (const row of rows) {
      const body = JSON.parse(row.body) as { hash: string } | null
      if (!body) continue
      try {
        ledger.record(
          JSON.parse(
            await readFile(join(this.directory, 'blobs', body.hash), 'utf8'),
          ) as RecordedChange,
          row.logical.slice(65),
        )
      } catch {
        /* Missing proof remains visibly partial. */
      }
    }
    return ledger
  }
  private async compare(folder: string): Promise<LocalComparison | null> {
    const root = await this.root(folder),
      db = this.db!
    if (!root.baseline) return null
    const baselineRow = db
      .prepare('SELECT body FROM captures WHERE id=? AND root=?')
      .get(root.baseline, root.id) as { body: string } | undefined
    if (!baselineRow) return null
    const baseline = JSON.parse(baselineRow.body) as Inventory
    const current = await this.stableInventory(root)
    if (root.enabled) this.save(root, current)
    if (current.reasons.includes('storage-limit'))
      db.prepare('UPDATE roots SET enabled=0,policy=policy+1 WHERE id=?').run(root.id)
    const files: ChangedFile[] = [],
      patches = new Map<string, FileDiff>(),
      evidence: LocalComparison['evidence'] = new Map()
    const fileReasons = [...baseline.reasons, ...current.reasons],
      textReasons: CoverageReason[] = []
    for (const path of [
      ...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)]),
    ].sort()) {
      const old = Object.hasOwn(baseline.files, path) ? baseline.files[path] : undefined,
        next = Object.hasOwn(current.files, path) ? current.files[path] : undefined
      if (old?.reason === 'excluded' || next?.reason === 'excluded') continue
      if (old?.hash && old.hash === next?.hash) continue
      if (old?.fingerprint && old.fingerprint === next?.fingerprint) continue
      if (
        old?.reason ||
        next?.reason ||
        (!old && baseline.reasons.length) ||
        (!next && current.reasons.length)
      ) {
        const reason = next?.reason ?? old?.reason ?? 'baseline-incomplete'
        textReasons.push(reason)
        if (!old?.fingerprint && !next?.fingerprint) fileReasons.push(reason)
        files.push({
          path,
          status: 'modified',
          added: 0,
          removed: 0,
          binary: !!(old?.binary || next?.binary),
          countsComplete: false,
          reason,
        })
        patches.set(path, { kind: 'unavailable', reason })
        continue
      }
      try {
        const before = old?.hash
          ? await readFile(join(this.directory, 'blobs', old.hash), 'utf8')
          : ''
        const after = next?.hash
          ? (next.text ?? (await readFile(join(this.directory, 'blobs', next.hash), 'utf8')))
          : ''
        const lines = await compareText(before, after)
        evidence.set(path, { lines, before, after })
        files.push({
          path,
          status: !old ? 'added' : !next ? 'deleted' : 'modified',
          added: lines.filter((l) => l.type === 'add').length,
          removed: lines.filter((l) => l.type === 'remove').length,
          binary: false,
          countsComplete: true,
        })
        patches.set(
          path,
          lines.length > 1500 ? { kind: 'too-big', lines: lines.length } : { kind: 'text', lines },
        )
      } catch {
        textReasons.push('content-evicted')
        files.push({
          path,
          status: 'modified',
          added: 0,
          removed: 0,
          binary: false,
          countsComplete: false,
          reason: 'content-evicted',
        })
        patches.set(path, { kind: 'unavailable', reason: 'content-evicted' })
      }
    }
    const metric = metrics(fileReasons, textReasons)
    const result: LocalComparison = {
      root: root.path,
      rootId: root.id,
      branch: null,
      lens: 'folder-baseline',
      revision: digest(
        JSON.stringify([root.id, root.epoch, root.policy, root.baseline, current, files]),
      ),
      files,
      patches,
      evidence,
      complete: !fileReasons.length && !textReasons.length,
      coverage: metric,
      hasOtherLensChanges: false,
    }
    await this.collect()
    return retainComparison(result)
  }
  /** Only unreferenced versions age out. Active baselines remain pinned. */
  private async collect(): Promise<void> {
    const db = this.db!
    db.prepare(
      'DELETE FROM captures WHERE created<? AND id NOT IN (SELECT baseline FROM roots WHERE baseline IS NOT NULL)',
    ).run(Date.now() - 14 * 86400_000)
    const keep = new Set<string>()
    for (const row of db.prepare('SELECT body FROM evidence').all() as { body: string }[]) {
      const body = JSON.parse(row.body) as { hash: string } | null
      if (body) keep.add(body.hash)
    }
    for (const row of db.prepare('SELECT body FROM captures').all() as { body: string }[]) {
      for (const version of Object.values((JSON.parse(row.body) as Inventory).files))
        if (version.hash) keep.add(version.hash)
    }
    for (const row of db.prepare('SELECT hash FROM blobs').all() as { hash: string }[]) {
      if (keep.has(row.hash)) continue
      await rm(join(this.directory, 'blobs', row.hash), { force: true })
      db.prepare('DELETE FROM blobs WHERE hash=?').run(row.hash)
    }
  }
  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    await this.queue.run(async () => {
      this.db?.close()
      this.db = undefined
    })
  }
}
