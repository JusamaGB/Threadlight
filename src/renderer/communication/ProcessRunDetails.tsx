import { useState } from 'react'
import type { ProcessRun } from '../../shared/workflowGraph'
import styles from './WorkflowGraphEditor.module.css'

export function ProcessRunDetails({
  run,
  runs,
  back,
  openRun,
  openItem,
  act,
  busy,
}: {
  run: ProcessRun
  runs: ProcessRun[]
  back: () => void
  openRun: (id: string) => void
  openItem: (id: string, revision: number) => void
  act: (action: string, args: unknown) => Promise<void>
  busy: boolean
}) {
  const root = runs.find((r) => r.id === run.rootId) ?? run
  return (
    <div className={styles.root} aria-label="Workflow run details">
      <div className={styles.bar}>
        <button onClick={back}>← Canvas</button>
        <strong>{run.objective}</strong>
      </div>
      <span>
        {run.definition.name} · v{run.definition.revision} · {run.status.replace('_', ' ')}
      </span>
      <p>
        {run.reason ||
          `${Object.values(run.nodes).filter((n) => n.status === 'completed').length}/${run.definition.nodes.length} steps completed`}
      </p>
      <div className={styles.bar}>
        {!['completed', 'cancelled'].includes(root.status) && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void act('control_process', {
                  operationId: crypto.randomUUID(),
                  spaceId: run.spaceId,
                  runId: root.id,
                  action: root.status === 'running' ? 'pause' : 'resume',
                })
              }
            >
              {root.status === 'running' ? 'Pause' : 'Resume'}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act('control_process', {
                  operationId: crypto.randomUUID(),
                  spaceId: run.spaceId,
                  runId: root.id,
                  action: 'cancel',
                })
              }
            >
              Cancel run
            </button>
          </>
        )}
      </div>
      {run.definition.nodes.map((node) => {
        const state = run.nodes[node.id]!
        return (
          <details
            key={node.id}
            className={styles.config}
            open={state.status === 'uncertain' || state.status === 'failed'}
          >
            <summary>
              {node.title} · {state.status}
            </summary>
            {state.error && <p role="alert">{state.error}</p>}
            {state.output && <pre>{JSON.stringify(state.output, null, 2)}</pre>}
            {typeof state.output?.itemId === 'string' &&
              typeof state.output.revision === 'number' && (
                <button
                  onClick={() =>
                    openItem(state.output!.itemId as string, state.output!.revision as number)
                  }
                >
                  Open evidence
                </button>
              )}
            {state.assignmentId && <small>Assignment: {state.assignmentId}</small>}
            {state.childId && (
              <button onClick={() => openRun(state.childId!)}>
                Routine · attempt {state.attempts}
              </button>
            )}
            {['uncertain', 'failed'].includes(state.status) && (
              <Reconcile run={run} nodeId={node.id} busy={busy} act={act} />
            )}
            <small>Operation: {state.operationId}</small>
          </details>
        )
      })}
      {runs
        .filter((r) => r.parentId === run.id)
        .map((r) => (
          <button key={r.id} onClick={() => openRun(r.id)}>
            {r.definition.name} · {r.status} · {new Date(r.startedAt).toLocaleTimeString()}
          </button>
        ))}
    </div>
  )
}
function Reconcile({
  run,
  nodeId,
  busy,
  act,
}: {
  run: ProcessRun
  nodeId: string
  busy: boolean
  act: (action: string, args: unknown) => Promise<void>
}) {
  const [evidence, setEvidence] = useState(''),
    [output, setOutput] = useState('{}'),
    [error, setError] = useState('')
  return (
    <div className={styles.config}>
      <label>
        Observed evidence
        <input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <label>
        Recovered outputs
        <textarea value={output} onChange={(e) => setOutput(e.target.value)} />
      </label>
      {error && <span role="alert">{error}</span>}
      <button
        disabled={busy || !evidence.trim()}
        onClick={() => {
          try {
            const parsed = JSON.parse(output)
            void act('reconcile_process', {
              operationId: crypto.randomUUID(),
              spaceId: run.spaceId,
              runId: run.id,
              nodeId,
              evidence,
              outcome: 'completed',
              output: parsed,
            })
          } catch {
            setError('Enter outputs as a JSON object.')
          }
        }}
      >
        Record confirmed completion
      </button>
    </div>
  )
}
