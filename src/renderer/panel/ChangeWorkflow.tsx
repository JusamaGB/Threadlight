import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChangeWorkflowCommand,
  WorkflowInspection,
  WorkflowPlan,
} from '../../shared/changeWorkflow'
import { useHelpMode } from './helpMode'
import { Tip } from './Tip'
import styles from './ChangeWorkflow.module.css'

/** Guided local checkpoint. All repository mutations are validated by the main-side service. */
export function ChangeWorkflow({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const mode = useHelpMode()
  const [inspection, setInspection] = useState<WorkflowInspection | null>(null)
  const [roots, setRoots] = useState<{ id: string; root: string }[]>([])
  const [rootId, setRootId] = useState<string>()
  const [plan, setPlan] = useState<WorkflowPlan | null>(null)
  const [selection, setSelection] = useState<Record<string, number[] | 'all'>>({})
  const [scripts, setScripts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [branch, setBranch] = useState(() => 'threadlight/change-' + Date.now().toString(36))
  const [message, setMessage] = useState('')
  const [acknowledge, setAcknowledge] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => {
    let live = true
    void window.threadlight
      .changeWorkflow(sessionId, { action: 'roots' })
      .then(async (result) => {
        if (!live) return
        if (result.kind === 'roots') {
          setRoots(result.roots)
          if (!result.roots.length) setError('No Git checkout is available for this thread.')
          if (result.roots.length === 1) {
            const id = result.roots[0]!.id
            setRootId(id)
            const inspection = await window.threadlight.changeWorkflow(
              sessionId,
              { action: 'inspect' },
              id,
            )
            if (live && inspection.kind === 'inspection') setInspection(inspection)
            else if (live && inspection.kind === 'error') setError(inspection.reason)
          }
        } else if (result.kind === 'error') setError(result.reason)
      })
      .catch((error) => {
        if (live) setError(String(error))
      })
    return () => {
      live = false
    }
  }, [sessionId])
  const request = async (command: ChangeWorkflowCommand, selectedRoot = rootId) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await window.threadlight.changeWorkflow(sessionId, command, selectedRoot)
      if (result.kind === 'error') setError(result.reason)
      else if (result.kind === 'inspection') {
        setInspection(result)
        setPlan(null)
        setSelection({})
        setReviewing(false)
        setAcknowledge(false)
        setScripts([])
      } else if (result.kind === 'plan') {
        setPlan(result)
        if (command.action === 'prepare') {
          setReviewing(false)
          setScripts([])
          setAcknowledge(false)
        }
      }
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  const picked = Object.entries(selection).filter(([, hunks]) => hunks === 'all' || hunks.length)
  const hasHunk = (value: number[] | 'all' | undefined, index: number) =>
    value === 'all' || (Array.isArray(value) && value.includes(index))
  const teaching = plan?.receipt
    ? [
        'Why is my checkout still dirty?',
        'Dirty means a checkout contains uncommitted edits. This checkpoint was saved on a separate branch. Your original files, branch and staging remain untouched, so the edits still appear here. Nothing was uploaded.',
      ]
    : reviewing
      ? [
          'What is a commit?',
          'A commit records an exact version in local Git history. This action creates a new branch pointing to that version. It does not switch branches, push to a server, open a pull request, merge or deploy.',
        ]
      : plan
        ? [
            'Why check this version?',
            'The patch below is the complete proposed commit. Selected project scripts run against an exported copy of that version, using installed dependencies. Whitespace validation alone is not a test of the application.',
          ]
        : [
            'What am I selecting?',
            'A hunk is a section of a text patch. Select sections to keep unrelated edits out of your checkpoint. Selecting a whole file includes every current edit in it, even edits by another chat. The real Git staging area is not changed.',
          ]
  const teachHost = document.querySelector('[data-card] [data-teach-footer]')
  const teachFooter =
    mode === 'teach' ? (
      <details className={styles.teach} open>
        <summary>{teaching[0]}</summary>
        <p>{teaching[1]}</p>
      </details>
    ) : null
  return (
    <section className={styles.workflow} aria-label="Prepare changes" aria-busy={busy}>
      <div className={styles.actions}>
        <button className={styles.action} disabled={busy} onClick={onClose}>
          Back to diff
        </button>
        {!plan?.receipt && (
          <button
            className={styles.action}
            disabled={busy}
            onClick={() => void request({ action: 'inspect' })}
          >
            Refresh
          </button>
        )}
      </div>
      <div className={styles.heading}>
        {plan?.receipt
          ? 'Local checkpoint saved'
          : reviewing
            ? 'Review local commit'
            : plan
              ? 'Check the selected change'
              : 'Choose changes to save'}
      </div>
      <div className={styles.muted}>
        {plan?.root ?? inspection?.root}
        <br />
        {plan?.sourceBranch ?? inspection?.branch}
      </div>
      {!plan && roots.length > 1 && (
        <label className={styles.field}>
          Checkout
          <select
            aria-label="Checkout"
            value={rootId ?? ''}
            disabled={busy}
            onChange={(event) => {
              setRootId(event.target.value)
              void request({ action: 'inspect' }, event.target.value)
            }}
          >
            <option value="" disabled>
              Choose a checkout
            </option>
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.root}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">{plan ? 'Working on this candidate…' : 'Preparing changes…'}</p>}
      {!inspection && !error && roots.length < 2 && <p role="status">Reading checkout…</p>}
      {!plan && inspection && (
        <>
          <p className={styles.muted}>
            Current checkout edits from all writers. Nothing is selected automatically. Include
            dependencies needed by your change.
          </p>
          {!inspection.files.length && <p>No current file changes to save.</p>}
          {inspection.files.map((file) => (
            <div className={styles.file} key={file.path}>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selection[file.path] === 'all'}
                  onChange={(event) =>
                    setSelection((current) => ({
                      ...current,
                      [file.path]: event.target.checked ? 'all' : [],
                    }))
                  }
                />
                <span>
                  {file.path}
                  <br />
                  <span className={styles.muted}>{file.status} · include whole file</span>
                </span>
              </label>
              <details>
                <summary>Review {file.partial ? 'and choose sections' : 'patch'}</summary>
                {file.partial ? (
                  file.hunks.map((hunk, index) => (
                    <div key={index}>
                      <label className={styles.choice}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={hasHunk(selection[file.path], index)}
                          onChange={(event) =>
                            setSelection((current) => {
                              const selected = current[file.path]
                              const previous =
                                selected === 'all' ? file.hunks.map((_, i) => i) : (selected ?? [])
                              return {
                                ...current,
                                [file.path]: event.target.checked
                                  ? [...previous, index]
                                  : previous.filter((i) => i !== index),
                              }
                            })
                          }
                        />
                        Section {index + 1}
                      </label>
                      <pre className={styles.patch}>{hunk}</pre>
                    </div>
                  ))
                ) : (
                  <pre className={styles.patch}>{file.patch}</pre>
                )}
              </details>
            </div>
          ))}
          <Tip
            as="button"
            className={`${styles.action} ${styles.primary}`}
            text="Prepare an exact candidate without changing your staging area."
            teachHelp={teaching[1]}
            disabled={busy || !picked.length}
            onClick={() =>
              void request({
                action: 'prepare',
                revision: inspection.revision,
                selection: picked.map(([path, hunks]) => ({
                  path,
                  ...(hunks === 'all' ? {} : { hunks }),
                })),
              })
            }
          >
            Prepare {picked.length} selected {picked.length === 1 ? 'file' : 'files'}
          </Tip>
        </>
      )}
      {plan && !plan.receipt && (
        <>
          <details open>
            <summary>
              Exact candidate · {plan.paths.length} {plan.paths.length === 1 ? 'file' : 'files'}
            </summary>
            <pre className={styles.patch}>{plan.patch}</pre>
          </details>
          {!reviewing ? (
            <>
              <p className={styles.muted}>
                Whitespace validation always runs. Choose any project checks below. Project scripts
                execute code locally; this is not a sandbox.
              </p>
              {plan.scripts.map((script) => (
                <label key={script} className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={scripts.includes(script)}
                    disabled={busy}
                    onChange={(event) => {
                      setScripts((current) =>
                        event.target.checked
                          ? [...current, script]
                          : current.filter((s) => s !== script),
                      )
                      setPlan({ ...plan, validated: false })
                    }}
                  />
                  npm run {script}
                </label>
              ))}
              <button
                className={styles.action}
                disabled={busy}
                onClick={() => void request({ action: 'validate', planId: plan.id, scripts })}
              >
                Run selected checks
              </button>
              {plan.checks.map((check) => (
                <details key={check.name}>
                  <summary>
                    {check.ok ? 'Passed' : 'Failed'} · {check.name}
                  </summary>
                  <pre className={styles.patch}>{check.output}</pre>
                </details>
              ))}
              {plan.validated && (
                <button
                  className={`${styles.action} ${styles.primary}`}
                  onClick={() => setReviewing(true)}
                >
                  Review local commit
                </button>
              )}
            </>
          ) : (
            <>
              <label className={styles.field}>
                New local branch
                <input
                  value={branch}
                  disabled={busy}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                Commit message
                <textarea
                  rows={3}
                  value={message}
                  disabled={busy}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <p>
                This saves the reviewed version on a new branch. Your current branch, files and
                staging stay as they are. Nothing is uploaded.
              </p>
              {plan.checks.length === 1 && (
                <label className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={acknowledge}
                    disabled={busy}
                    onChange={(event) => setAcknowledge(event.target.checked)}
                  />
                  I understand that no project checks were run.
                </label>
              )}
              <div className={styles.actions}>
                <button
                  className={styles.action}
                  disabled={busy}
                  onClick={() => setReviewing(false)}
                >
                  Back to checks
                </button>
                <button
                  className={`${styles.action} ${styles.primary}`}
                  disabled={
                    busy ||
                    !message.trim() ||
                    !branch.trim() ||
                    (plan.checks.length === 1 && !acknowledge)
                  }
                  onClick={() =>
                    void request({
                      action: 'save',
                      planId: plan.id,
                      branch: branch.trim(),
                      message: message.trim(),
                      acknowledgeNoTests: acknowledge,
                    })
                  }
                >
                  Save local commit
                </button>
              </div>
            </>
          )}
        </>
      )}
      {plan?.receipt && (
        <div className={styles.receipt}>
          <p>
            Branch: <strong>{plan.receipt.branch}</strong>
          </p>
          <p>
            Commit: <code>{plan.receipt.commit}</code>
          </p>
          <p>
            Your original checkout and staging were preserved. The selected edits remain there. This
            branch has not been published.
          </p>
        </div>
      )}
      {teachHost ? createPortal(teachFooter, teachHost) : teachFooter}
    </section>
  )
}
