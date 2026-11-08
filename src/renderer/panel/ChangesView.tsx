import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationHandle } from '../../shared/navigationHistory'

import type { ChangedFile, Changes, FileDiff, Provider } from '../../shared/types'
import {
  lensLabel,
  type ChangeLens,
  type TrackingAction,
  type TrackingState,
} from '../../shared/changes'
import type { TimelineItem, TimelineFileChange } from '../../shared/threadTimeline'
import { cardDiffLines } from '../../shared/cardChanges'
import { sessionProvider } from '../../shared/providers'
import { en } from '../i18n/en'
import {
  comparisonHeading,
  comparisonEmpty,
  comparisonReasons,
} from '../../shared/changePresentation'
import { StackedDiff } from './StackedDiff'
import { ChangeWorkflow } from './ChangeWorkflow'
import styles from './Panel.module.css'

interface ChangesViewProps {
  navigationRef?: Ref<NavigationHandle>
  onHeading?: (heading: string) => void
  onScope?: (scope: 'thread' | 'worktree') => void
  initialLens?: ChangeLens
  onLens?: (lens: ChangeLens) => void
  initialRootId?: string
  onRoot?: (rootId: string | undefined) => void
  onReadiness?: (state: 'ready' | 'loading' | 'unavailable') => void
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
  scope: initialScope = 'thread',
  navigationRef,
  onHeading,
  onScope,
  initialLens = 'git-current',
  onLens,
  initialRootId,
  onRoot,
  onReadiness,
}: Omit<ChangesViewProps, 'scope' | 'card'> & { scope: 'thread' | 'worktree' }) {
  const [preparing, setPreparing] = useState(false)
  const [response, setResponse] = useState<{
    key: string
    comparison: string
    changes: Changes | null
  } | null>(null)
  const [scope, setScope] = useState(initialScope)
  const [lens, setLens] = useState<ChangeLens>(initialLens)
  const [rootId, setRootId] = useState<string | undefined>(initialRootId)
  const [rootChoices, setRootChoices] = useState<NonNullable<Changes['groups']>>([])
  const [refresh, setRefresh] = useState(0)
  const [tracking, setTracking] = useState<TrackingState | null>(null)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [trackingError, setTrackingError] = useState('')
  const [forgetPending, setForgetPending] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const location = useNavigationHistory(
    { open },
    (page) => setOpen(page.open),
    true,
    `changes:${scope}:${sessionId}`,
  )
  useImperativeHandle(navigationRef, () => location, [location])
  const [ownership, setOwnership] = useState<{ key: string; files: Set<string> } | null>(null)
  const ownershipKey = JSON.stringify([sessionId, stamp, threadStamp, refresh, rootId])
  const requestKey = JSON.stringify([sessionId, stamp, threadStamp, scope, lens, refresh, rootId])
  // Revisions refresh this comparison; changing its identity must hide the old data.
  const comparison = JSON.stringify([sessionId, scope, lens, rootId])
  const refreshing = response?.key !== requestKey
  const changes = !refreshing
    ? response?.changes
    : response?.comparison === comparison
      ? (response.changes ?? undefined)
      : undefined
  const displayedLens = changes?.lens ?? lens
  const heading = comparisonHeading(scope, displayedLens, changes)
  useEffect(() => {
    onLens?.(displayedLens)
  }, [onLens, displayedLens])
  useEffect(() => {
    onRoot?.(rootId)
  }, [onRoot, rootId])
  const readiness = refreshing ? 'loading' : changes === null ? 'unavailable' : 'ready'
  useEffect(() => {
    onReadiness?.(readiness)
  }, [onReadiness, readiness])
  useEffect(() => {
    onScope?.(scope)
  }, [onScope, scope])
  useEffect(() => {
    onHeading?.(heading)
  }, [onHeading, heading])

  useEffect(() => {
    let live = true
    void (
      scope === 'worktree'
        ? window.threadlight.getWorktreeChanges(sessionId, lens, rootId)
        : window.threadlight.getChanges(sessionId)
    )
      .then((found) => {
        if (live) {
          setResponse({ key: requestKey, comparison, changes: found })
          if (scope === 'thread' && found) setRootChoices(found.groups ?? [])
        }
      })
      .catch(() => live && setResponse({ key: requestKey, comparison, changes: null }))
    return () => {
      live = false
    }
  }, [sessionId, stamp, threadStamp, scope, lens, refresh, requestKey, rootId, comparison])

  useEffect(() => {
    let live = true
    if (typeof window.threadlight.getLocalTracking === 'function')
      void window.threadlight.getLocalTracking(sessionId, rootId).then(
        (state) => {
          if (live) setTracking(state)
        },
        () => {},
      )
    return () => {
      live = false
    }
  }, [sessionId, refresh, rootId])

  useEffect(() => {
    if (scope === 'thread' && !tracking?.recording) return
    const timer = setInterval(() => setRefresh((value) => value + 1), 5000)
    return () => clearInterval(timer)
  }, [tracking?.recording, scope])

  const configure = async (action: TrackingAction) => {
    if (!tracking || trackingBusy) return
    setTrackingBusy(true)
    setTrackingError('')
    try {
      const next = await window.threadlight.configureLocalTracking(
        sessionId,
        action,
        tracking.policyRevision,
        rootId,
      )
      setTracking(next)
      if (action === 'enable' || action === 'baseline') {
        setScope('worktree')
        setLens('folder-baseline')
      }
      setForgetPending(false)
      setRefresh((value) => value + 1)
    } catch (error) {
      setTrackingError(
        error instanceof Error ? error.message : 'Local history settings could not be changed.',
      )
    } finally {
      setTrackingBusy(false)
    }
  }

  useEffect(() => {
    if (scope !== 'worktree') return
    let live = true
    // An unavailable or slow ownership read must not hide or delay the worktree diff.
    void window.threadlight.getChanges(sessionId).then(
      (found) => {
        if (live && found) setRootChoices(found.groups ?? [])
        if (live)
          setOwnership({
            key: ownershipKey,
            files: new Set(
              found?.files
                .filter(
                  (file) =>
                    !file.rootId ||
                    found.groups?.some(
                      (group) => group.rootId === file.rootId && group.root === tracking?.root,
                    ),
                )
                .map((file) => fileKey(file.displayPath ?? file.path)) ?? [],
            ),
          })
      },
      () => {
        if (live) setOwnership({ key: ownershipKey, files: new Set() })
      },
    )
    return () => {
      live = false
    }
  }, [sessionId, scope, ownershipKey, tracking?.root])

  if (preparing)
    return (
      <ChangeWorkflow key={sessionId} sessionId={sessionId} onClose={() => setPreparing(false)} />
    )
  return (
    <div className={styles.changes} aria-busy={refreshing}>
      {typeof window.threadlight.changeWorkflow === 'function' && (
        <button className={styles.changesNote} onClick={() => setPreparing(true)}>
          Prepare changes
        </button>
      )}
      <div className={styles.changesNote}>
        <select
          aria-label="Change comparison"
          style={{ width: '100%', maxWidth: '100%' }}
          value={scope === 'thread' ? 'thread' : lens}
          onChange={(event) => {
            setOpen(null)
            if (event.target.value === 'thread') setScope('thread')
            else {
              setScope('worktree')
              setLens(event.target.value as ChangeLens)
            }
          }}
        >
          <option value="thread">Thread · matched edits</option>
          {Object.entries({
            'git-current': 'Git · Current files',
            'git-staged': 'Git · Staged',
            'git-unstaged': 'Git · Unstaged',
            'folder-baseline': 'Folder · Saved baseline',
          }).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>{' '}
        <button
          aria-label="Refresh"
          onClick={() => {
            setRefresh((value) => value + 1)
          }}
        >
          {refreshing && changes ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {(rootChoices.length > 1 || rootId !== undefined) && (
        <div className={styles.changesNote}>
          <label>
            Folder for Git and local history
            <select
              aria-label="Source folder"
              style={{ width: '100%', maxWidth: '100%' }}
              value={rootId ?? ''}
              onChange={(event) => {
                setRootId(event.target.value || undefined)
                setTracking(null)
                setOpen(null)
                setForgetPending(false)
                setTrackingError('')
              }}
            >
              <option value="">Primary folder</option>
              {rootId && !rootChoices.some((group) => group.rootId === rootId) && (
                <option value={rootId}>Selected folder unavailable</option>
              )}
              {rootChoices.map((group) => (
                <option key={group.rootId} value={group.rootId}>
                  {group.root}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className={styles.changesNote}>
        {scope === 'thread'
          ? 'Matches this chat’s recorded edits.'
          : `${lensLabel[displayedLens]}. All writers in this folder.`}
      </p>
      {tracking && (
        <details className={styles.changesNote}>
          <summary>Local file history · {tracking.recording ? 'recording' : 'off'}</summary>
          <p>{tracking.root}</p>
          <p>
            Retain file versions on this device to compare a folder with a saved baseline. Git
            viewing works without recording. Secret files and generated folders are excluded.
          </p>
          <button
            disabled={trackingBusy}
            onClick={() => void configure(tracking.recording ? 'pause' : 'enable')}
          >
            {tracking.recording ? 'Pause recording' : 'Record local file history'}
          </button>{' '}
          {tracking.baseline && (
            <button disabled={trackingBusy} onClick={() => void configure('baseline')}>
              Use current files as new baseline
            </button>
          )}{' '}
          {tracking.baseline && (
            <button
              disabled={trackingBusy}
              onClick={() => (forgetPending ? void configure('forget') : setForgetPending(true))}
            >
              {forgetPending ? 'Confirm forget local history' : 'Forget local history'}
            </button>
          )}
          {trackingBusy && <p>Capturing files…</p>}
          {trackingError && <p role="alert">{trackingError}</p>}
        </details>
      )}
      {changes === undefined && <p className={styles.changesNote}>{en.changes.loading}</p>}
      {changes === null && (
        <p className={styles.changesNote}>
          {scope === 'worktree' && lens === 'folder-baseline'
            ? 'Enable local file history to capture a starting baseline. Earlier file versions are unavailable.'
            : scope === 'worktree'
              ? en.changes.worktreeUnavailable
              : en.changes.historyUnavailable}
        </p>
      )}
      {changes?.stale && (
        <p className={styles.changesNote}>Stale comparison · refresh to read current files.</p>
      )}
      {scope === 'thread' && changes?.lens === 'folder-baseline' && (
        <p className={styles.changesNote}>Compared with the saved folder baseline.</p>
      )}
      {changes?.hasOtherLensChanges && displayedLens !== 'git-staged' && (
        <p className={styles.changesNote}>
          Staged changes are also present. Select Staged or Unstaged to inspect them.
        </p>
      )}
      {changes?.complete === false && (
        <p className={styles.changesNote}>
          {scope === 'thread'
            ? en.changes.partial
            : 'Partial comparison · some files or line counts are unavailable.'}
        </p>
      )}
      {changes &&
        comparisonReasons(changes).map((reason) => (
          <p className={styles.changesNote} key={reason}>
            {reason}
          </p>
        ))}
      {changes && !changes.files.length && (
        <p className={styles.changesNote}>
          {scope === 'thread' && changes.groups?.some((group) => group.recorded?.length)
            ? 'No pending changes were matched. Recorded work and remaining coverage are listed by source below.'
            : comparisonEmpty(scope, displayedLens, changes.complete === false)}
        </p>
      )}
      {changes?.groups?.map((group) => (
        <section key={group.rootId} aria-label={`Changes in ${group.root}`}>
          <p className={styles.changesNote} style={{ overflowWrap: 'anywhere' }}>
            <strong>{group.root}</strong>
            <br />
            {lensLabel[group.lens]}
            {group.recoveredFrom && (
              <span>
                {' '}
                · Unavailable checkout; history recovered through verified repository binding:{' '}
                {group.recoveredFrom}
              </span>
            )}
            <br />
            {group.available
              ? `${group.files} files · +${group.added} −${group.removed}${group.complete ? '' : ' · Partial'}`
              : 'Comparison unavailable'}
          </p>
          {group.recorded?.map((edit, index) => (
            <p
              key={`${edit.path}:${index}`}
              className={styles.changesNote}
              style={{ overflowWrap: 'anywhere' }}
            >
              <strong>{edit.path || 'Remaining records'}</strong> · {edit.state}
              {edit.commit && <span> · {edit.commit.slice(0, 8)}</span>}
              {!!edit.branches?.length && <span> · {edit.branches.join(', ')}</span>}
              <br />
              {edit.explanation}
            </p>
          ))}
          {changes.files
            .filter((file) => file.rootId === group.rootId)
            .map((file) => (
              <FileRow
                key={file.path}
                sessionId={sessionId}
                file={file}
                stamp={changes.revision ?? stamp}
                revision={changes.revision}
                scope={scope}
                open={open === file.path}
                onToggle={() => setOpen(open === file.path ? null : file.path)}
              />
            ))}
        </section>
      ))}
      {!changes?.groups?.length &&
        changes?.files.map((file) => (
          <FileRow
            key={file.path}
            sessionId={sessionId}
            file={file}
            stamp={changes.revision ?? stamp}
            revision={changes.revision}
            scope={scope}
            provider={
              scope === 'worktree' &&
              lens === 'git-current' &&
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
  revision?: string
  scope: 'thread' | 'worktree'
  provider?: Provider
  open: boolean
  onToggle: () => void
}) {
  const { sessionId, file, stamp, revision, scope, open, onToggle, provider } = props
  const displayPath = file.displayPath ?? file.path
  const slash = displayPath.lastIndexOf('/')
  const name = displayPath.slice(slash + 1)
  const folder = slash > 0 ? displayPath.slice(0, slash) : ''
  return (
    <div
      className={open ? `${styles.fileRow} ${styles.expanded}` : styles.fileRow}
      data-provider={provider}
    >
      <button
        className={styles.fileHead}
        onClick={onToggle}
        aria-expanded={open}
        title={displayPath}
      >
        <span className={styles.fileMark} data-status={file.status}>
          {en.changes.mark[file.status]}
        </span>
        <span className={styles.fileName}>{name}</span>
        <span className={styles.fileFolder}>{folder}</span>
        <span className={styles.diff}>
          {file.added > 0 && <span className={styles.added}>+{file.added}</span>}
          {file.removed > 0 && <span className={styles.removed}>−{file.removed}</span>}
          {file.countsComplete === false && <span>Partial</span>}
        </span>
      </button>
      {open && (
        <FileDiffView
          sessionId={sessionId}
          path={file.path}
          stamp={stamp}
          revision={revision}
          scope={scope}
        />
      )}
    </div>
  )
}

export function FileDiffView({
  sessionId,
  path,
  stamp,
  revision,
  resolvePath = false,
  scope = 'thread',
}: {
  sessionId: string
  path: string | null
  stamp: string
  revision?: string
  scope?: 'thread' | 'worktree'
  /** Match transcript paths to the provider's recorded filename casing/separators. */
  resolvePath?: boolean
}) {
  const [result, setResult] = useState<{
    identity: string
    request: string
    path: string | null
    diff: FileDiff
    revision?: string
  } | null>(null)
  const identity = JSON.stringify([sessionId, path, scope, resolvePath])
  const request = JSON.stringify([identity, stamp, revision])
  useEffect(() => {
    let live = true
    const read = async () => {
      let file = path
      let selectedRevision = revision
      if (resolvePath && file) {
        const changes =
          scope === 'worktree'
            ? await window.threadlight.getWorktreeChanges(sessionId)
            : await window.threadlight.getChanges(sessionId)
        const matches =
          changes?.files.filter(
            (candidate) =>
              (candidate.displayPath ?? candidate.path).replace(/\\/g, '/').toLowerCase() ===
              file?.replace(/\\/g, '/').toLowerCase(),
          ) ?? []
        file = matches.length === 1 ? matches[0]!.path : null
        selectedRevision = changes?.revision
      }
      const diff: FileDiff = file
        ? scope === 'worktree'
          ? await window.threadlight.getWorktreeFileDiff(sessionId, file, selectedRevision)
          : await window.threadlight.getFileDiff(sessionId, file, selectedRevision)
        : { kind: 'unavailable' }
      if (live) setResult({ identity, request, path: file, diff, revision: selectedRevision })
    }
    void read().catch(
      () => live && setResult({ identity, request, path: null, diff: { kind: 'unavailable' } }),
    )
    return () => {
      live = false
    }
  }, [sessionId, path, stamp, revision, resolvePath, scope, identity, request])

  const diff = result?.identity === identity ? result.diff : undefined
  const file = result?.identity === identity ? result.path : null
  const refreshing = result?.request !== request
  const openFile = file && (
    <button
      className={styles.fileOpen}
      disabled={refreshing}
      onClick={() =>
        scope === 'worktree'
          ? window.threadlight.openWorktreeChangedFile(sessionId, file, result?.revision)
          : window.threadlight.openChangedFile(sessionId, file, result?.revision)
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
          : (diff.reason ?? en.changes.unavailable)
    return (
      <p className={styles.changesNote}>
        {why} {openFile}
      </p>
    )
  }
  return (
    <StackedDiff
      lines={diff.lines}
      footer={
        <div className={styles.diffFoot}>
          {refreshing && <span role="status">Refreshing… </span>}
          {openFile}
        </div>
      }
    />
  )
}
