import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationHandle } from '../../shared/navigationHistory'

import type { ChangedFile, Changes, FileDiff, Provider } from '../../shared/types'
import type { TimelineItem, TimelineFileChange } from '../../shared/threadTimeline'
import { cardDiffLines } from '../../shared/cardChanges'
import { sessionProvider } from '../../shared/providers'
import { en } from '../i18n/en'
import { StackedDiff } from './StackedDiff'
import styles from './Panel.module.css'

interface ChangesViewProps {
  navigationRef?: Ref<NavigationHandle>
  sessionId: string
  scope?: 'thread' | 'worktree' | 'card'
  /** An immutable copy of the clicked card's provider-recorded patch. */
  card?: TimelineItem
  /** The selected scope's revision/counts, refreshed by the session scan. */
  stamp: string
  /** Ownership can change without changing the worktree's aggregate Git totals. */
  threadStamp?: string
}

const fileKey = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()

/**
 * One diff viewer for recorded card edits, thread changes and worktree changes.
 */
export function ChangesView(props: ChangesViewProps) {
  if (props.scope === 'card')
    return (
      <CardChangesView
        sessionId={props.sessionId}
        card={props.card}
        navigationRef={props.navigationRef}
      />
    )
  return <RepositoryChangesView {...props} scope={props.scope ?? 'thread'} />
}

function CardChangesView({
  sessionId,
  card,
  navigationRef,
}: {
  sessionId: string
  card?: TimelineItem
  navigationRef?: Ref<NavigationHandle>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const location = useNavigationHistory(
    { open },
    (page) => setOpen(page.open),
    true,
    `changes:card:${sessionId}:${card?.id ?? ''}`,
  )
  useImperativeHandle(navigationRef, () => location, [location])
  const files = card?.fileChanges ?? []
  const count = card?.fileCount ?? files.length
  return (
    <div className={styles.changes} role="region" aria-label="Card changes">
      {!files.length && (
        <p className={styles.changesNote}>No file details were recorded for this card.</p>
      )}
      {count > files.length && (
        <p className={styles.changesNote}>
          Showing {files.length} of {count} recorded files.
        </p>
      )}
      {files.map((file, index) => {
        const path = file.path.replace(/\\/g, '/')
        const slash = path.lastIndexOf('/')
        const key = `${index}:${file.path}`
        return (
          <div
            key={key}
            className={open === key ? `${styles.fileRow} ${styles.expanded}` : styles.fileRow}
          >
            <button
              className={styles.fileHead}
              title={path}
              aria-expanded={open === key}
              onClick={() => setOpen(open === key ? null : key)}
            >
              <span className={styles.fileName}>{path.slice(slash + 1)}</span>
              <span className={styles.fileFolder}>{slash > 0 ? path.slice(0, slash) : ''}</span>
              <span className={styles.diff}>
                {file.added !== null && <span className={styles.added}>+{file.added}</span>}
                {file.removed !== null && <span className={styles.removed}>−{file.removed}</span>}
              </span>
            </button>
            {open === key && <RecordedFileDiff file={file} />}
          </div>
        )
      })}
    </div>
  )
}

function RecordedFileDiff({ file }: { file: TimelineFileChange }) {
  const lines = cardDiffLines(file)
  return (
    <>
      {lines === null ? (
        <p className={styles.changesNote}>Diff unavailable for this edit.</p>
      ) : !lines.length ? (
        <p className={styles.changesNote}>No text changes in this edit.</p>
      ) : (
        <StackedDiff lines={lines} />
      )}
      {file.previewTruncated && (
        <p className={styles.changesNote}>Recorded patch shortened; some lines are unavailable.</p>
      )}
    </>
  )
}

function RepositoryChangesView({
  sessionId,
  stamp,
  threadStamp,
  scope = 'thread',
  navigationRef,
}: Omit<ChangesViewProps, 'scope' | 'card'> & { scope: 'thread' | 'worktree' }) {
  const [changes, setChanges] = useState<Changes | null | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const location = useNavigationHistory(
    { open },
    (page) => setOpen(page.open),
    true,
    `changes:${scope}:${sessionId}`,
  )
  useImperativeHandle(navigationRef, () => location, [location])
  const [ownership, setOwnership] = useState<{ key: string; files: Set<string> } | null>(null)
  const ownershipKey = JSON.stringify([sessionId, stamp, threadStamp])

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

  useEffect(() => {
    if (scope !== 'worktree') return
    let live = true
    // An unavailable or slow ownership read must not hide or delay the worktree diff.
    void window.threadlight.getChanges(sessionId).then(
      (found) => {
        if (live)
          setOwnership({
            key: ownershipKey,
            files: new Set(found?.files.map((file) => fileKey(file.path)) ?? []),
          })
      },
      () => {
        if (live) setOwnership({ key: ownershipKey, files: new Set() })
      },
    )
    return () => {
      live = false
    }
  }, [sessionId, scope, ownershipKey])

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
          provider={
            scope === 'worktree' &&
            ownership?.key === ownershipKey &&
            ownership.files.has(fileKey(file.path))
              ? sessionProvider(sessionId)
              : undefined
          }
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
  provider?: Provider
  open: boolean
  onToggle: () => void
}) {
  const { sessionId, file, stamp, scope, open, onToggle, provider } = props
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const folder = slash > 0 ? file.path.slice(0, slash) : ''
  return (
    <div
      className={open ? `${styles.fileRow} ${styles.expanded}` : styles.fileRow}
      data-provider={provider}
    >
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
    <StackedDiff lines={diff.lines} footer={<div className={styles.diffFoot}>{openFile}</div>} />
  )
}
