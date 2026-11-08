import { useEffect, useReducer, useRef, useState } from 'react'
import { kimiSetupIncomplete, type KimiSetup } from '../../shared/kimi'
import { StackedDiff } from '../panel/StackedDiff'
import { Tip } from '../panel/Tip'
import {
  exampleDiff,
  exampleFiles,
  phaseLabels,
  previewExample,
  previewPhases,
  previewTransition,
  type PreviewPhase,
} from './preview'
import styles from './KimiWorkspace.module.css'

export function KimiWorkspace({
  setup,
  visible,
  onSettings,
}: {
  setup: KimiSetup
  visible: boolean
  onSettings: () => void
}) {
  const [state, dispatch] = useReducer(previewTransition, 'empty', previewExample)
  const [file, setFile] = useState(0)
  const [tab, setTab] = useState<'file' | 'changes'>('changes')
  const [instruction, setInstruction] = useState(
    'Update the greeting to welcome Ada. Keep the change small.',
  )
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (visible) heading.current?.focus()
  }, [visible])
  useEffect(() => {
    if (!visible || state.phase !== 'working') return
    const timer = setTimeout(() => dispatch({ type: 'tick' }), 650)
    return () => clearTimeout(timer)
  }, [visible, state.phase, state.frame])
  const selected = exampleFiles[file] ?? exampleFiles[0]
  const hasTask = state.phase !== 'empty'
  const changed = state.approved && (state.phase === 'completed' || state.phase === 'restored')
  const canContinue = state.phase === 'stopped' || state.phase === 'restored'
  const text = state.approved
    ? [
        'Applying the approved example change.',
        ' The greeting now welcomes Ada.',
        ' The example is ready to review.',
      ]
    : [
        'I’ll inspect the greeting.',
        ' One line needs to change.',
        ' I need permission to update the example file.',
      ]
  return (
    <section className={styles.root} aria-label="Kimi workspace" hidden={!visible}>
      <header className={styles.header}>
        <div>
          <h2 ref={heading} tabIndex={-1}>
            Kimi workspace
          </h2>
          <span className={styles.badge}>Simulated activity</span>
        </div>
        <button onClick={onSettings}>Settings</button>
      </header>
      <p className={styles.notice}>
        Explore an example. No agent runs and no project files change.
      </p>
      <div className={styles.context}>
        <span>
          Project <strong>Greeting demo</strong>
        </span>
        <span>
          Owner <strong>Kimi · example</strong>
        </span>
        <span>
          Task <strong>{hasTask ? 'Welcome Ada' : 'No task selected'}</strong>
        </span>
        <span>
          Session <strong>{hasTask ? 'Demo 01' : 'Not started'}</strong>
        </span>
      </div>
      <details className={styles.connection}>
        <summary>
          {kimiSetupIncomplete(setup) ? 'Connection setup incomplete' : 'Configuration saved'} ·
          execution unavailable
        </summary>
        <p>
          Model source:{' '}
          {setup.connection.kind === 'moonshot'
            ? 'Moonshot API'
            : setup.connection.kind === 'local'
              ? 'Local model'
              : 'Server model'}{' '}
          · model: {setup.connection.model || 'Not selected'}
        </p>
        <p>
          Agent location: {setup.agent.kind === 'local' ? 'This computer' : 'Server — unavailable'}.
          A saved configuration is not a verified model connection.
        </p>
        <p>
          Production execution, task-wide Stop and real model compatibility have not been admitted.
        </p>
      </details>
      <div className={styles.toolbar}>
        <label>
          Example state{' '}
          <select
            aria-label="Example state"
            value={state.phase}
            onChange={(event) =>
              dispatch({ type: 'example', phase: event.target.value as PreviewPhase })
            }
          >
            {previewPhases.map((phase) => (
              <option key={phase} value={phase}>
                {phaseLabels[phase]}
              </option>
            ))}
          </select>
        </label>
        <span role="status">{phaseLabels[state.phase]}</span>
      </div>
      <div className={styles.layout}>
        <section className={styles.activity} aria-label="Conversation and activity">
          <h3>Conversation</h3>
          <label className={styles.instruction}>
            Example instruction
            <textarea
              aria-label="Example instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={2}
            />
          </label>
          {state.phase === 'empty' ? (
            <p className={styles.muted}>
              Start an example to explore the workspace. Your instruction is kept here only.
            </p>
          ) : (
            <>
              <p className={styles.speaker}>You · example</p>
              <p>{instruction || 'No instruction entered.'}</p>
              {state.phase !== 'blocked' && (
                <>
                  <p className={styles.speaker}>Kimi · scripted response</p>
                  <p className={styles.response}>
                    {text.slice(0, Math.max(1, state.frame)).join('')}
                  </p>
                </>
              )}
            </>
          )}
          {state.phase === 'blocked' && (
            <p role="alert">
              Execution is unavailable. You can still explore the example states or open Settings.
            </p>
          )}
          {hasTask && !['blocked', 'failed'].includes(state.phase) && (
            <p className={styles.tool}>
              Read · src/greeting.ts <span>example only</span>
            </p>
          )}
          {state.phase === 'permission' && (
            <div className={styles.permission}>
              <strong>Example permission request</strong>
              <p>Write one line in src/greeting.ts to welcome Ada.</p>
              <div className={styles.actions}>
                <button onClick={() => dispatch({ type: 'approve' })}>Approve example</button>
                <button onClick={() => dispatch({ type: 'deny' })}>Deny example</button>
              </div>
            </div>
          )}
          {state.decision && (
            <p className={styles.tool}>
              Write · {state.decision} <span>simulated decision</span>
            </p>
          )}
          {state.phase === 'stop-requested' && (
            <div className={styles.permission}>
              <p>Stop requested. Settlement has not been confirmed.</p>
              <div className={styles.actions}>
                <button onClick={() => dispatch({ type: 'settle' })}>Show settled outcome</button>
                <button onClick={() => dispatch({ type: 'uncertain' })}>
                  Show uncertain outcome
                </button>
              </div>
            </div>
          )}
          {state.phase === 'stopped' && (
            <p>The example is settled. Continue is a separate action.</p>
          )}
          {state.phase === 'uncertain' && (
            <p role="alert">The outcome is unknown. Continue is blocked; no retry is assumed.</p>
          )}
          {state.phase === 'restored' && (
            <p>Saved example history is visible. Nothing has resumed.</p>
          )}
          {state.phase === 'failed' && (
            <p role="alert">Example connection failed before a write. No automatic retry.</p>
          )}
          {state.continued && (
            <p className={styles.muted}>Continuation explicitly requested for this example.</p>
          )}
          <div className={styles.actions}>
            <button
              disabled={
                !instruction.trim() ||
                ['working', 'permission', 'stop-requested'].includes(state.phase)
              }
              onClick={() => dispatch({ type: 'example', phase: 'working' })}
            >
              Run example
            </button>
            <button
              disabled={!['working', 'permission'].includes(state.phase)}
              onClick={() => dispatch({ type: 'stop' })}
            >
              Stop example
            </button>
            <button disabled={!canContinue} onClick={() => dispatch({ type: 'continue' })}>
              Continue example
            </button>
            <Tip text="Real Kimi execution is not available yet.">
              <button disabled>Run Kimi</button>
            </Tip>
          </div>
        </section>
        <section className={styles.files} aria-label="Example files and changes">
          <h3>
            Files <span className={styles.muted}>read-only examples</span>
          </h3>
          <div className={styles.fileList} aria-label="Example files">
            {exampleFiles.map((item, index) => (
              <button key={item.path} aria-pressed={file === index} onClick={() => setFile(index)}>
                {item.path}
                {index === 0 && changed ? ' · changed' : ''}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <button aria-pressed={tab === 'file'} onClick={() => setTab('file')}>
              Content
            </button>
            <button aria-pressed={tab === 'changes'} onClick={() => setTab('changes')}>
              Changes
            </button>
          </div>
          {tab === 'file' ? (
            <pre aria-label="Example file content">
              {changed ? selected.after : selected.before}
            </pre>
          ) : file === 0 && changed ? (
            <StackedDiff lines={exampleDiff} />
          ) : (
            <p className={styles.muted}>
              {state.decision === 'denied'
                ? 'Write denied. No example file changed.'
                : 'No example changes to show.'}
            </p>
          )}
          <h3>Result</h3>
          <p>
            {state.phase === 'completed'
              ? state.decision === 'denied'
                ? 'Example finished without the requested write.'
                : 'Example completed: one greeting updated.'
              : state.phase === 'restored'
                ? 'Previous example result · history only.'
                : 'No completed result for this example state.'}
          </p>
          <p className={styles.muted}>
            Checks run here: none. A completed example does not verify a real task.
          </p>
          <details>
            <summary>Example evidence and limits</summary>
            <p>Example revision: greeting-demo-v1. The displayed change is fixed sample data.</p>
            <p>Illustrative check: greeting matches “Hello, Ada!” — not executed.</p>
            <p>
              Real task results will require the existing versioned change and verification records.
              This preview creates no task or verification record.
            </p>
          </details>
        </section>
      </div>
    </section>
  )
}
