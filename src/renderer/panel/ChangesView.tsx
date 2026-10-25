import { useEffect, useState } from 'react'

import type { ChangedFile, Changes, DiffLine, FileDiff } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

interface ChangesViewProps {
  sessionId: string
  /** Changes when the thread's git numbers do, so the list is read again. */
  stamp: string
}

/**
 * A thread's changes since the last commit: one row per file, and one file's diff open at a
 * time, like threads. A diff is fetched only when its file is opened. Read-only.
 */
export function ChangesView({ sessionId, stamp }: ChangesViewProps) {
  const [changes, setChanges] = useState<Changes | null | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.threadlight.getChanges(sessionId).then((found) => live && setChanges(found))
    return () => {
      live = false
    }
  }, [sessionId, stamp])

  if (changes === undefined) return <p className={styles.changesNote}>{en.changes.loading}</p>
  if (!changes || changes.files.length === 0) {
    return <p className={styles.changesNote}>{en.changes.none}</p>
  }
  return (
    <div className={styles.changes}>
      {changes.files.map((file) => (
        <FileRow
          key={file.path}
          sessionId={sessionId}
          file={file}
          stamp={stamp}
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
  open: boolean
  onToggle: () => void
}) {
  const { sessionId, file, stamp, open, onToggle } = props
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
      {open && <FileDiffView sessionId={sessionId} path={file.path} stamp={stamp} />}
    </div>
  )
}

function FileDiffView({
  sessionId,
  path,
  stamp,
}: {
  sessionId: string
  path: string
  stamp: string
}) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  useEffect(() => {
    let live = true
    void window.threadlight.getFileDiff(sessionId, path).then((found) => live && setDiff(found))
    return () => {
      live = false
    }
  }, [sessionId, path, stamp])

  const openFile = (
    <button
      className={styles.fileOpen}
      onClick={() => window.threadlight.openChangedFile(sessionId, path)}
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
