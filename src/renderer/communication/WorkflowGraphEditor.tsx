import { useEffect, useRef, useState } from 'react'
import type { CommunicationSnapshot } from '../../shared/communication'
import {
  validateGraph,
  workflowError,
  processSchemas,
  stepContracts,
  inputBindings,
  graphSchema,
  stepSchema,
  type ProcessDefinition,
  type ProcessStep,
} from '../../shared/workflowGraph'
import type { z } from 'zod'
import { newProcess, newProcessStep } from '../../shared/workflowDefaults'
import { initialViewport, fitCanvas, zoomAt, type Viewport } from '../../shared/canvas'
import { ContextMenu } from '../panel/ContextMenu'
import { Tip } from '../panel/Tip'
import styles from './WorkflowGraphEditor.module.css'

type Draft = { graph: ProcessDefinition; selected: string; viewport: Viewport; base: number }
const drafts = new Map<string, Draft>()
export function WorkflowGraphEditor({
  spaceId,
  data,
  refresh,
}: {
  spaceId: string
  data: CommunicationSnapshot
  refresh: () => Promise<void>
}) {
  const definitions = data.processDefinitions ?? []
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(spaceId) ?? {
        graph: definitions[0] ?? newProcess(spaceId),
        selected: '',
        viewport: initialViewport,
        base: definitions[0]?.revision ?? 0,
      },
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [runInput, setRunInput] = useState<Record<string, unknown>>({})
  const [objective, setObjective] = useState('')
  const [type, setType] = useState<ProcessStep['type']>('context')
  const [to, setTo] = useState(''),
    [route, setRoute] = useState<'always' | 'success' | 'failure'>('always')
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  const operations = useRef(new Map<string, string>())
  const drag = useRef<{ x: number; y: number; v: Viewport } | null>(null)
  const graph = draft.graph,
    node = graph.nodes.find((n) => n.id === draft.selected)
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const dimensions = (id: string) => sizes[id] ?? { width: 100, height: 46 }
  const width = Math.max(100, ...graph.nodes.map((n) => n.x + dimensions(n.id).width)),
    height = Math.max(100, ...graph.nodes.map((n) => n.y + dimensions(n.id).height))
  useEffect(() => {
    const measure = () => {
      const found: Record<string, { width: number; height: number }> = {}
      root.current?.querySelectorAll<HTMLButtonElement>('[data-step-id]').forEach((el) => {
        found[el.dataset.stepId!] = { width: el.offsetWidth, height: el.offsetHeight }
      })
      setSizes((old) => (JSON.stringify(old) === JSON.stringify(found) ? old : found))
    }
    const observer = new ResizeObserver(measure)
    root.current?.querySelectorAll('[data-step-id]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [graph.nodes])
  useEffect(() => {
    drafts.set(spaceId, draft)
  }, [spaceId, draft])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = element.getBoundingClientRect(),
        unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
      setDraft((d) => ({
        ...d,
        viewport: e.ctrlKey
          ? zoomAt(
              d.viewport,
              Math.exp(-e.deltaY * unit * 0.002),
              e.clientX - r.left,
              e.clientY - r.top,
            )
          : {
              ...d.viewport,
              x: d.viewport.x - (e.shiftKey ? e.deltaY : e.deltaX) * unit,
              y: d.viewport.y - (e.shiftKey ? 0 : e.deltaY) * unit,
            },
      }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const update = (g: ProcessDefinition) => {
    setDraft((d) => ({ ...d, graph: g }))
    setError('')
  }
  const edit = (patch: Partial<ProcessStep>) =>
    update({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === node?.id ? ({ ...n, ...patch } as ProcessStep) : n)),
    })
  const remove = (id: string) =>
    update({
      ...graph,
      nodes: graph.nodes
        .filter((n) => n.id !== id)
        .map((n) => ({
          ...n,
          inputs: Object.fromEntries(Object.entries(n.inputs).filter(([, b]) => b.node !== id)),
        })),
      edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    })
  async function call(action: string, args: unknown) {
    if (busy) return false
    if (editorRoot.current?.querySelector('[data-invalid-json="true"]')) {
      setError('Correct the invalid field before saving or running.')
      return false
    }
    setBusy(true)
    setError('')
    try {
      const { operationId: _id, ...body } = args as Record<string, unknown>
      const identity = JSON.stringify({ action, body })
      const operationId = operations.current.get(identity) ?? crypto.randomUUID()
      operations.current.set(identity, operationId)
      const r = await window.threadlight.communicationRequest({
        action,
        arguments: { ...body, operationId },
      })
      if (!r.ok) {
        setError(r.reason)
        return false
      }
      await refresh()
      operations.current.delete(identity)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workflow unavailable.')
      return false
    } finally {
      setBusy(false)
    }
  }
  const current = definitions.find((d) => d.id === graph.id)
  const changed =
    !current || JSON.stringify({ ...graph, revision: current.revision }) !== JSON.stringify(current)
  const field = (label: string, value: string | number, onChange: (v: string) => void) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
  return (
    <div ref={editorRoot} className={styles.root} aria-label="Workflow graph editor">
      <div className={styles.bar}>
        <select
          aria-label="Workflow definition"
          value={current?.id ?? ''}
          onChange={(e) => {
            const d = definitions.find((d) => d.id === e.target.value)
            if (d) setDraft({ graph: d, base: d.revision, selected: '', viewport: initialViewport })
          }}
        >
          <option value="">Draft</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · v{d.revision}
            </option>
          ))}
        </select>
        <Tip
          as="button"
          aria-label="New"
          text="Start a custom draft"
          onClick={() =>
            setDraft({
              graph: newProcess(spaceId),
              base: 0,
              selected: '',
              viewport: initialViewport,
            })
          }
        >
          New
        </Tip>
        <Tip
          as="button"
          aria-label="Parallel"
          text="Editable parallel paths and join"
          onClick={() =>
            setDraft({
              graph: newProcess(spaceId, 'parallel'),
              base: 0,
              selected: '',
              viewport: initialViewport,
            })
          }
        >
          Parallel
        </Tip>
        <Tip
          as="button"
          aria-label="Checks"
          text="Configure a local check, save evidence and await review"
          onClick={() =>
            setDraft({
              graph: newProcess(spaceId, 'checks'),
              base: 0,
              selected: 'check',
              viewport: initialViewport,
            })
          }
        >
          Checks
        </Tip>
        <button
          disabled={busy || !changed}
          onClick={async () => {
            try {
              const d = validateGraph({ ...graph, revision: draft.base + 1 })
              if (
                await call('save_process', {
                  operationId: crypto.randomUUID(),
                  expectedRevision: draft.base,
                  definition: d,
                })
              )
                setDraft((s) => ({ ...s, graph: d, base: d.revision }))
            } catch (e) {
              setError(workflowError(e))
            }
          }}
        >
          Save
        </button>
        <button
          title="Check structure without running"
          onClick={() => {
            try {
              validateGraph(graph)
              setError('Graph valid')
            } catch (e) {
              setError(workflowError(e))
            }
          }}
        >
          Validate
        </button>
      </div>
      {field('Workflow name', graph.name, (v) => update({ ...graph, name: v }))}
      {current && current.revision !== draft.base && (
        <div className={styles.bar} role="status">
          <span>
            Draft v{draft.base} · saved v{current.revision}
          </span>
          <Tip
            as="button"
            aria-label={`Load v${current.revision}`}
            text="Replace this draft with the saved version"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                graph: current,
                base: current.revision,
                selected: current.nodes.some((n) => n.id === d.selected) ? d.selected : '',
              }))
            }
          >
            Load v{current.revision}
          </Tip>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.bar}>
        <select
          aria-label="Step type"
          value={type}
          onChange={(e) => setType(e.target.value as ProcessStep['type'])}
        >
          {Object.keys(stepContracts).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const n = newProcessStep(
              type,
              `step${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`,
              graph.nodes.length,
            )
            update({ ...graph, nodes: [...graph.nodes, n] })
            setDraft((d) => ({ ...d, selected: n.id }))
          }}
        >
          + Step
        </button>
        <button
          title="Fit all steps"
          onClick={() => {
            const r = root.current
            if (r)
              setDraft((d) => ({
                ...d,
                viewport: fitCanvas(r.clientWidth, r.clientHeight, width, height),
              }))
          }}
        >
          Fit
        </button>
        <button
          title="Reset pan and zoom"
          onClick={() => setDraft((d) => ({ ...d, viewport: initialViewport }))}
        >
          Reset
        </button>
      </div>
      <div
        className={styles.canvas}
        ref={root}
        aria-label="Connected workflow steps"
        tabIndex={0}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          drag.current = { x: e.clientX, y: e.clientY, v: draft.viewport }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const p = drag.current
          if (p)
            setDraft((d) => ({
              ...d,
              viewport: { ...p.v, x: p.v.x + e.clientX - p.x, y: p.v.y + e.clientY - p.y },
            }))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          const dirs: Record<string, [number, number]> = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          }
          const delta = dirs[e.key]
          if (delta) {
            e.preventDefault()
            setDraft((d) => ({
              ...d,
              viewport: { ...d.viewport, x: d.viewport.x + delta[0], y: d.viewport.y + delta[1] },
            }))
          }
        }}
      >
        <div
          className={styles.world}
          style={{
            width,
            height,
            transform: `translate(${draft.viewport.x}px,${draft.viewport.y}px) scale(${draft.viewport.zoom})`,
          }}
        >
          <svg width={width} height={height} aria-label="Saved control and data connections">
            {graph.edges.map((e, i) => {
              const a = graph.nodes.find((n) => n.id === e.from),
                b = graph.nodes.find((n) => n.id === e.to)
              return a && b ? (
                <g key={`e${i}`}>
                  <path
                    d={`M${a.x + dimensions(a.id).width / 2},${a.y + dimensions(a.id).height} L${b.x + dimensions(b.id).width / 2},${b.y}`}
                    stroke={e.route === 'failure' ? '#df9e8a' : '#89a9bf'}
                    fill="none"
                  />
                  <text
                    x={
                      (a.x + dimensions(a.id).width / 2 + b.x + dimensions(b.id).width / 2) / 2 + 4
                    }
                    y={(a.y + dimensions(a.id).height + b.y) / 2}
                    fill="currentColor"
                    fontSize="10"
                  >
                    {e.route === 'always' ? '↓' : e.route}
                  </text>
                </g>
              ) : null
            })}
            {graph.nodes.flatMap((n) =>
              Object.entries(n.inputs).map(([name, b]) => {
                const a = graph.nodes.find((s) => s.id === b.node)
                return a ? (
                  <path
                    key={`${n.id}:${name}`}
                    d={`M${a.x + dimensions(a.id).width / 2 + 4},${a.y + dimensions(a.id).height} L${n.x + dimensions(n.id).width / 2 + 4},${n.y}`}
                    stroke="#bca2d4"
                    strokeDasharray="3 3"
                    fill="none"
                  >
                    <title>
                      {b.node}.{b.field} → {n.id}.{name}
                    </title>
                  </path>
                ) : null
              }),
            )}
          </svg>
          {graph.nodes.map((n) => (
            <button
              key={n.id}
              data-step-id={n.id}
              className={styles.node}
              style={{ left: n.x, top: n.y }}
              aria-pressed={draft.selected === n.id}
              title={`${n.title} · ${n.type}`}
              onClick={() => setDraft((d) => ({ ...d, selected: n.id }))}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: n.id })
              }}
              onKeyDown={(e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ x: r.left, y: r.bottom, id: n.id })
                }
              }}
            >
              <strong>{n.title}</strong>
              <small>{n.type}</small>
            </button>
          ))}
        </div>
      </div>
      {menu && (
        <ContextMenu
          {...menu}
          label="Step actions"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Edit', onSelect: () => setDraft((d) => ({ ...d, selected: menu.id })) },
            { label: 'Remove', onSelect: () => remove(menu.id) },
          ]}
        />
      )}
      {node && (
        <div className={styles.config} aria-label="Selected step configuration">
          {field('Step title', node.title, (v) => edit({ title: v }))}
          <StepConfiguration key={node.id} node={node} edit={edit} />
          <details>
            <summary>Inputs · position</summary>
            <JsonField
              key={`${node.id}:bindings`}
              label="Input bindings"
              value={node.inputs}
              validate={(v) => inputBindings.parse(v)}
              change={(v) => edit({ inputs: v as ProcessStep['inputs'] })}
            />
            <div className={styles.bar}>
              {field('X', node.x, (v) => edit({ x: Number(v) }))}
              {field('Y', node.y, (v) => edit({ y: Number(v) }))}
            </div>
          </details>
          <div className={styles.connection}>
            <select aria-label="Connect to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Connect to…</option>
              {graph.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
            {node.type === 'condition' && (
              <select
                aria-label="Connection route"
                value={route}
                onChange={(e) => setRoute(e.target.value as typeof route)}
              >
                <option>always</option>
                <option>success</option>
                <option>failure</option>
              </select>
            )}
            <button
              disabled={!to}
              onClick={() =>
                update({
                  ...graph,
                  edges: [
                    ...graph.edges,
                    { from: node.id, to, route: node.type === 'condition' ? route : 'always' },
                  ],
                })
              }
            >
              Connect
            </button>
          </div>
          {graph.edges
            .filter((e) => e.from === node.id)
            .map((e, i) => (
              <div className={styles.bar} key={i}>
                <span>
                  → {graph.nodes.find((n) => n.id === e.to)?.title} · {e.route}
                </span>
                <button
                  aria-label={`Disconnect ${e.to} ${e.route}`}
                  onClick={() => update({ ...graph, edges: graph.edges.filter((x) => x !== e) })}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      )}
      <details className={styles.config}>
        <summary>Trigger · limits</summary>
        <JsonField
          key={`${graph.id}:trigger`}
          label="Trigger"
          value={graph.trigger}
          validate={(v) => graphSchema.shape.trigger.parse(v)}
          change={(v) => update({ ...graph, trigger: v as ProcessDefinition['trigger'] })}
        />
        {field('Concurrent steps', graph.maxConcurrent, (v) =>
          update({ ...graph, maxConcurrent: Number(v) }),
        )}
        {field('Operation limit', graph.maxOperations, (v) =>
          update({ ...graph, maxOperations: Number(v) }),
        )}
      </details>
      {current && !changed && (
        <details className={styles.config}>
          <summary>Run authorization</summary>
          {field('Run objective', objective, (v) => setObjective(v))}
          <JsonField
            label="Run inputs"
            value={runInput}
            validate={(v) => processSchemas.invoke_process.shape.input.parse(v)}
            change={(v) => setRunInput(v as Record<string, unknown>)}
          />
          <p>
            Authorize this exact version’s local scripts, assignments and outputs until project
            authority expires.
          </p>
          <div className={styles.bar}>
            <button
              disabled={busy}
              onClick={() =>
                void call('authorize_process', {
                  operationId: crypto.randomUUID(),
                  spaceId,
                  definitionId: current.id,
                  revision: current.revision,
                  triggers: false,
                })
              }
            >
              Authorize manual
            </button>
            {graph.trigger.type !== 'manual' && (
              <button
                disabled={busy}
                onClick={() =>
                  void call('authorize_process', {
                    operationId: crypto.randomUUID(),
                    spaceId,
                    definitionId: current.id,
                    revision: current.revision,
                    triggers: true,
                  })
                }
              >
                Enable trigger
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void call('invoke_process', {
                  operationId: crypto.randomUUID(),
                  spaceId,
                  definitionId: current.id,
                  revision: current.revision,
                  objective: objective.trim() || current.name,
                  input: runInput,
                })
              }
            >
              Run
            </button>
          </div>
        </details>
      )}
    </div>
  )
}

function JsonField({
  label,
  value,
  change,
  validate,
}: {
  label: string
  value: unknown
  change: (v: unknown) => void
  validate?: (v: unknown) => unknown
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState('')
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        data-invalid-json={error ? 'true' : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          try {
            const parsed = JSON.parse(e.target.value)
            change(validate ? validate(parsed) : parsed)
            setError('')
          } catch {
            setError('Invalid value; last valid configuration retained.')
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  )
}
function StepConfiguration({
  node,
  edit,
}: {
  node: ProcessStep
  edit: (patch: Partial<ProcessStep>) => void
}) {
  const input = (key: string, label: string, value: string | number) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(e) =>
          edit({ [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })
        }
      />
    </label>
  )
  const json = (key: string, label: string, value: unknown) => (
    <JsonField
      label={label}
      value={value}
      validate={(v) => {
        const schema = stepSchema.options.find((s) => s.shape.type.value === node.type)!
        return (schema.shape as unknown as Record<string, z.ZodType>)[key]!.parse(v)
      }}
      change={(v) => edit({ [key]: v })}
    />
  )
  switch (node.type) {
    case 'context':
      return json('items', 'Pinned items', node.items)
    case 'script':
      return (
        <>
          {input('executable', 'Executable', node.executable)}
          {json('args', 'Arguments', node.args)}
          {input('cwd', 'Working directory', node.cwd)}
          {json('environment', 'Environment', node.environment)}
          {input('timeoutMs', 'Timeout (ms)', node.timeoutMs)}
          <small>Local user access · no shell · JSON input on stdin</small>
        </>
      )
    case 'ai':
      return (
        <>
          {input('roleId', 'Role ID', node.roleId)}
          {input('folderId', 'Output folder ID', node.folderId)}
          {input('brief', 'Brief', node.brief)}
          {input('acceptance', 'Acceptance', node.acceptance)}
          {json('items', 'Pinned items', node.items)}
          <label>
            Wait for
            <select
              value={node.milestone}
              onChange={(e) => edit({ milestone: e.target.value as 'submitted' | 'accepted' })}
            >
              <option>submitted</option>
              <option>accepted</option>
            </select>
          </label>
        </>
      )
    case 'save':
      return (
        <>
          {input('folderId', 'Output folder ID', node.folderId)}
          {input('body', 'Evidence text', node.body)}
        </>
      )
    case 'condition':
      return (
        <>
          {input('input', 'Input name', node.input)}
          {json('equals', 'Equals', node.equals)}
        </>
      )
    case 'wait':
      return input('durationMs', 'Wait (ms)', node.durationMs)
    case 'routine':
      return (
        <>
          {input('definitionId', 'Routine ID', node.definitionId)}
          {input('revision', 'Routine revision', node.revision)}
          {input('maxAttempts', 'Maximum attempts', node.maxAttempts)}
        </>
      )
    case 'finish':
      return (
        <label>
          <input
            type="checkbox"
            checked={node.success}
            onChange={(e) => edit({ success: e.target.checked })}
          />
          Success
        </label>
      )
    case 'join':
      return <small>Wait for every incoming path to finish or be skipped.</small>
    case 'review':
      return (
        <small>
          Wait for acceptance of the bound itemId and revision. Opening evidence does not accept it.
        </small>
      )
  }
}
