import { useEffect, useState } from 'react'

import type { ChangedFile, Changes, DiffLine, FileDiff } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

interface ChangesViewProps {
  sessionId: string
  scope?: 'thread' | 'worktree'
  /** The selected scope's revision/counts, refreshed by the session scan. */
  stamp: string
}

/**
 * The shared file list for recorded thread changes and the worktree's uncommitted diff.
 */
export function ChangesView({ sessionId, stamp, scope = 'thread' }: ChangesViewProps) {
  const [changes, setChanges] = useState<Changes | null | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const read =
      scope === 'worktree' ? window.threadlight.getWorktreeChanges : window.threadlight.getChanges
    void read(sessionId)
      .then((found) => live && setChanges(found))
      .catch(() => live && setChanges(null))
    return () => {
      live = false
    }
  }, [sessionId, stamp, scope])

  if (changes === undefined) return <p className={styles.changesNote}>{en.changes.loading}</p>
  if (!changes)
    return (
      <p className={styles.changesNote}>
        {scope === 'worktree' ? en.changes.worktreeUnavailable : en.changes.historyUnavailable}
      </p>
    )
  return (
    <div className={styles.changes}>
      {changes.complete === false && <p className={styles.changesNote}>{en.changes.partial}</p>}
      {!changes.files.length && changes.complete !== false && (
        <p className={styles.changesNote}>
          {scope === 'worktree' ? en.changes.worktreeNone : en.changes.none}
        </p>
      )}
      {changes.files.map((file) => (
        <FileRow
          key={file.path}
          sessionId={sessionId}
          file={file}
          stamp={stamp}
          scope={scope}
          open={open === file.path}
          onToggle={() => setOpen(open === file.path ? null : file.path)}
        />
      ))}
    </div>
  )
}

function FileRow(props: {
  sessionId: string
  file: ChangedFile
  stamp: string
  scope: 'thread' | 'worktree'
  open: boolean
  onToggle: () => void
}) {
  const { sessionId, file, stamp, scope, open, onToggle } = props
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const folder = slash > 0 ? file.path.slice(0, slash) : ''
  return (
    <div className={open ? `${styles.fileRow} ${styles.expanded}` : styles.fileRow}>
      <button className={styles.fileHead} onClick={onToggle} aria-expanded={open} title={file.path}>
        <span className={styles.fileMark} data-status={file.status}>
          {en.changes.mark[file.status]}
        </span>
        <span className={styles.fileName}>{name}</span>
        <span className={styles.fileFolder}>{folder}</span>
        <span className={styles.diff}>
          {file.added > 0 && <span className={styles.added}>+{file.added}</span>}
          {file.removed > 0 && <span className={styles.removed}>−{file.removed}</span>}
        </span>
      </button>
      {open && <FileDiffView sessionId={sessionId} path={file.path} stamp={stamp} scope={scope} />}
    </div>
  )
}

export function FileDiffView({
  sessionId,
  path,
  stamp,
  resolvePath = false,
  scope = 'thread',
}: {
  sessionId: string
  path: string | null
  stamp: string
  scope?: 'thread' | 'worktree'
  /** Match transcript paths to the provider's recorded filename casing/separators. */
  resolvePath?: boolean
}) {
  const [result, setResult] = useState<{ path: string | null; diff: FileDiff } | null>(null)
  useEffect(() => {
    let live = true
    const read = async () => {
      let file = path
      if (resolvePath && file) {
        const changes =
          scope === 'worktree'
            ? await window.threadlight.getWorktreeChanges(sessionId)
            : await window.threadlight.getChanges(sessionId)
        file =
          changes?.files.find(
            (candidate) =>
              candidate.path.replace(/\\/g, '/').toLowerCase() ===
              file?.replace(/\\/g, '/').toLowerCase(),
          )?.path ?? null
      }
      const diff: FileDiff = file
        ? scope === 'worktree'
          ? await window.threadlight.getWorktreeFileDiff(sessionId, file)
          : await window.threadlight.getFileDiff(sessionId, file)
        : { kind: 'unavailable' }
      if (live) setResult({ path: file, diff })
    }
    void read().catch(() => live && setResult({ path: null, diff: { kind: 'unavailable' } }))
    return () => {
      live = false
    }
  }, [sessionId, path, stamp, resolvePath, scope])

  const diff = result?.diff
  const file = result?.path
  const openFile = file && (
    <button
      className={styles.fileOpen}
      onClick={() =>
        scope === 'worktree'
          ? window.threadlight.openWorktreeChangedFile(sessionId, file)
          : window.threadlight.openChangedFile(sessionId, file)
      }
    >
      {en.changes.open}
    </button>
  )
  if (!diff) return <p className={styles.changesNote}>{en.changes.loading}</p>
  if (diff.kind !== 'text') {
    const why =
      diff.kind === 'binary'
        ? en.changes.binary
        : diff.kind === 'too-big'
          ? en.changes.tooBig(diff.lines)
          : en.changes.unavailable
    return (
      <p className={styles.changesNote}>
        {why} {openFile}
      </p>
    )
  }
  return (
    <div className={styles.diffBlock}>
      {diff.lines.map((line, index) => (
        <DiffRow key={index} line={line} />
      ))}
      <div className={styles.diffFoot}>{openFile}</div>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk') {
    return <div className={styles.diffHunk}>{line.text ? `… ${line.text}` : '…'}</div>
  }
  return (
    <div className={styles.diffLine} data-type={line.type}>
      <span className={styles.diffNo}>{line.oldLine ?? ''}</span>
      <span className={styles.diffNo}>{line.newLine ?? ''}</span>
      <span className={styles.diffSign}>
        {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ''}
      </span>
      <span className={styles.diffText}>{line.text}</span>
    </div>
  )
}
