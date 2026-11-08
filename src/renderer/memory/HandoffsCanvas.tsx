import { Tip } from '../panel/Tip'
import { ProcessRunDetails } from '../communication/ProcessRunDetails'
import { useEffect, useRef, useState } from 'react'
import type { MemorySnapshot } from '../../shared/memory'
import type { CommunicationSnapshot } from '../../shared/communication'
import type { SpaceIdea } from '../../shared/spaces'
import type { Session } from '../../shared/types'
import { handoffGraph, type WorkNode } from '../../shared/handoffs'
import { fitCanvas, initialViewport, zoomAt, type Viewport } from '../../shared/canvas'
import styles from './HandoffsCanvas.module.css'

type Saved = {
  viewport: Viewport
  collapsed: string[]
  selected: string
  order: string[]
  groups: string[]
}
const saved = new Map<string, Saved>()
export function HandoffsCanvas({
  spaceId,
  memory,
  discussions,
  sessions,
  openTask,
  openItem,
  openSource,
}: {
  spaceId: string
  memory: MemorySnapshot
  discussions: SpaceIdea[]
  sessions: Session[]
  openTask: (id: string) => void
  openItem: (id: string, revision: number) => void
  openSource?: (id: string) => void
}) {
  const [communication, setCommunication] = useState<CommunicationSnapshot | null>(null)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<Saved>(
    () =>
      saved.get(spaceId) ?? {
        viewport: initialViewport,
        collapsed: [],
        selected: '',
        order: [],
        groups: [],
      },
  )
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; viewport: Viewport } | null>(null)
  const graph = handoffGraph(spaceId, memory, communication, discussions, sessions)
  const order = [
    ...state.order,
    ...graph.nodes.map((n) => n.id).filter((id) => !state.order.includes(id)),
  ]
  const groups = [
    ...state.groups,
    ...new Set(graph.nodes.map((n) => n.group).filter((id) => !state.groups.includes(id))),
  ]
  const nodes = [...graph.nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  if (order.length !== state.order.length || groups.length !== state.groups.length)
    setState({ ...state, order, groups })
  let height = 0
  const groupY = new Map<string, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const g of groups) {
    groupY.set(g, height)
    const work = nodes.filter((n) => n.group === g)
    work.forEach((n, index) =>
      positions.set(n.id, {
        x: (index % 3) * 230 + 4,
        y: height + Math.floor(index / 3) * 94 + 42,
      }),
    )
    height += state.collapsed.includes(g) ? 42 : Math.max(1, Math.ceil(work.length / 3)) * 94 + 50
  }
  height = Math.max(140, height)
  const width = Math.max(
    220,
    Math.min(3, Math.max(0, ...groups.map((g) => nodes.filter((n) => n.group === g).length))) * 230,
  )
  useEffect(() => {
    saved.set(spaceId, { ...state, order, groups })
  })
  useEffect(() => {
    let active = true,
      generation = 0
    const refresh = async () => {
      const current = ++generation
      try {
        if (!window.threadlight.communicationRequest) return
        const r = await window.threadlight.communicationRequest({
          action: 'get_workflow',
          arguments: { spaceId },
        })
        if (!active || current !== generation) return
        if (r.ok) {
          setCommunication(r.value as CommunicationSnapshot)
          setError('')
        } else setError(r.reason)
      } catch {
        if (active) setError('Work status unavailable')
      }
    }
    void refresh()
    const stop = window.threadlight.onCommunication?.(() => void refresh())
    return () => {
      active = false
      stop?.()
    }
  }, [spaceId])
  const viewport = (v: Viewport) => setState((s) => ({ ...s, viewport: v, order, groups }))
  const fit = () => {
    const r = root.current
    if (r) viewport(fitCanvas(r.clientWidth, r.clientHeight, width, height))
  }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = element.getBoundingClientRect(),
        unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height : 1
      setState((s) => ({
        ...s,
        viewport: e.ctrlKey
          ? zoomAt(
              s.viewport,
              Math.exp(-e.deltaY * unit * 0.002),
              e.clientX - box.left,
              e.clientY - box.top,
            )
          : {
              ...s.viewport,
              x: s.viewport.x - (e.shiftKey ? e.deltaY : e.deltaX) * unit,
              y: s.viewport.y - (e.shiftKey ? 0 : e.deltaY) * unit,
            },
      }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [detail])
  const jump = (attention = false) => {
    const matches = nodes.filter((n) =>
      attention
        ? n.attention
        : `${n.title} ${n.assignee} ${n.status} ${n.groupTitle}`
            .toLowerCase()
            .includes(query.toLowerCase()),
    )
    const node = matches[(matches.findIndex((n) => n.id === state.selected) + 1) % matches.length]
    if (!node) return
    const p = positions.get(node.id)!
    setState((s) => ({
      ...s,
      order,
      groups,
      selected: node.id,
      collapsed: s.collapsed.filter((g) => g !== node.group),
      viewport: { ...s.viewport, x: 12 - p.x * s.viewport.zoom, y: 46 - p.y * s.viewport.zoom },
    }))
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-work-id="${node.id}"]`)
        ?.focus({ preventScroll: true }),
    )
  }
  const open = (n: WorkNode) => {
    // Memory detail navigation unmounts this view in the same React batch.
    saved.set(spaceId, { ...state, selected: n.id, order, groups })
    setState((s) => ({ ...s, selected: n.id, order, groups }))
    if (n.kind === 'task') openTask(n.id)
    else setDetail(n.id)
  }
  const assignment = communication?.assignments.find(
    (a) => a.id === detail && a.spaceId === spaceId,
  )
  const processRun = communication?.processRuns?.find(
    (r) => r.id === detail && r.spaceId === spaceId,
  )
  async function act(action: string, args: unknown) {
    setBusy(true)
    try {
      const r = await window.threadlight.communicationRequest({ action, arguments: args })
      if (!r.ok) setError(r.reason)
    } catch {
      setError('Action failed. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={styles.root} aria-label="Work by objective">
      {error && <p role="alert">{error}</p>}
      {processRun ? (
        <ProcessRunDetails
          run={processRun}
          runs={communication?.processRuns?.filter((r) => r.spaceId === spaceId) ?? []}
          back={() => setDetail(null)}
          openRun={setDetail}
          openItem={openItem}
          act={act}
          busy={busy}
        />
      ) : assignment ? (
        <div className={styles.detail}>
          <button onClick={() => setDetail(null)}>← Canvas</button>
          <h3>{assignment.title}</h3>
          <p>
            {nodes.find((n) => n.id === assignment.id)?.status} · {assignment.reason}
          </p>
          <p>{assignment.brief}</p>
          <h4>Acceptance</h4>
          <p>{assignment.acceptance}</p>
          {assignment.dependsOn.length > 0 && (
            <>
              <h4>Depends on</h4>
              {assignment.dependsOn.map((id) => (
                <button key={id} onClick={() => setDetail(id)}>
                  {nodes.find((n) => n.id === id)?.title ?? 'Unavailable dependency'}
                </button>
              ))}
            </>
          )}
          <h4>Inputs</h4>
          {assignment.inputs.map((r) => (
            <button key={r.itemId} onClick={() => openItem(r.itemId, r.revision)}>
              {memory.items.find((i) => i.id === r.itemId)?.title ?? 'Input'} · v{r.revision}
            </button>
          ))}
          {assignment.result && (
            <>
              <h4>Submitted result</h4>
              <p>{assignment.result}</p>
            </>
          )}
          {(assignment.outputs ?? []).map((r) => (
            <button key={r.itemId} onClick={() => openItem(r.itemId, r.revision)}>
              {memory.items.find((i) => i.id === r.itemId)?.title ?? 'Output'} · v{r.revision}
            </button>
          ))}
          {assignment.resources.map((r) => (
            <p key={r}>{r}</p>
          ))}
          {['planned', 'blocked'].includes(assignment.state) && !assignment.messageId && (
            <button disabled={busy} onClick={() => void act('authorize_assignment', assignment.id)}>
              Authorize assignment
            </button>
          )}
          {assignment.state === 'submitted' && (
            <button
              disabled={busy}
              onClick={() =>
                void act('accept_assignment', {
                  id: assignment.id,
                  operationId: crypto.randomUUID(),
                  reason: 'Accepted by the user after reviewing the result.',
                })
              }
            >
              Accept result
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <input
              aria-label="Find work"
              placeholder="Find work…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jump()
              }}
            />
            {query && (
              <Tip as="button" aria-label="Find" onClick={() => jump()} text="Jump to next match">
                Find
              </Tip>
            )}
            <Tip
              as="button"
              aria-label="Needs attention"
              onClick={() => jump(true)}
              disabled={!nodes.some((n) => n.attention)}
              text="Jump to work needing attention"
            >
              ! {nodes.filter((n) => n.attention).length}
            </Tip>
            <Tip as="button" onClick={fit} aria-label="Fit" text="Fit all work (Home)">
              Fit
            </Tip>
            <Tip
              as="button"
              aria-label="Reset zoom"
              onClick={() => viewport(initialViewport)}
              text="Reset zoom and position"
            >
              {Math.round(state.viewport.zoom * 100)}%
            </Tip>
          </div>
          {query &&
            !nodes.some((n) =>
              `${n.title} ${n.assignee} ${n.status} ${n.groupTitle}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && <span role="status">No matching work</span>}
          <div
            ref={root}
            className={styles.canvas}
            tabIndex={0}
            aria-label="Work canvas"
            aria-description="Drag empty space to pan. Arrow keys pan; plus and minus zoom; Home fits. Tab reaches work and groups. Shift wheel moves horizontally; Control wheel zooms."
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Home') {
                e.preventDefault()
                fit()
              } else if (['+', '=', '-'].includes(e.key)) {
                e.preventDefault()
                viewport(
                  zoomAt(
                    state.viewport,
                    e.key === '-' ? 0.8 : 1.25,
                    e.currentTarget.clientWidth / 2,
                    e.currentTarget.clientHeight / 2,
                  ),
                )
              } else if (e.key.startsWith('Arrow')) {
                e.preventDefault()
                viewport({
                  ...state.viewport,
                  x:
                    state.viewport.x +
                    (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0),
                  y:
                    state.viewport.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0),
                })
              }
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
              e.currentTarget.focus()
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY, viewport: state.viewport }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (d)
                viewport({
                  ...d.viewport,
                  x: d.viewport.x + e.clientX - d.x,
                  y: d.viewport.y + e.clientY - d.y,
                })
            }}
            onPointerUp={() => {
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
            onLostPointerCapture={() => {
              drag.current = null
            }}
          >
            {!nodes.length && <p className={styles.empty}>No work yet</p>}
            <div
              className={styles.world}
              style={{
                width,
                height,
                transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`,
              }}
            >
              <svg
                width={width}
                height={height}
                className={styles.edges}
                aria-label="Explicit work relationships"
              >
                <defs>
                  <marker
                    id={`arrow-${spaceId}`}
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6" fill="currentColor" />
                  </marker>
                </defs>
                {graph.edges.map((e) => {
                  const from = nodes.find((n) => n.id === e.from)!,
                    to = nodes.find((n) => n.id === e.to)!
                  if (state.collapsed.includes(from.group) || state.collapsed.includes(to.group))
                    return null
                  const a = positions.get(e.from)!,
                    b = positions.get(e.to)!
                  return (
                    <path
                      key={`${e.from}:${e.to}`}
                      d={`M${a.x + 105},${a.y + 80} C${a.x + 220},${a.y + 90} ${b.x + 220},${b.y - 10} ${b.x + 105},${b.y}`}
                      fill="none"
                      stroke="currentColor"
                      strokeDasharray={e.kind === 'delegation' ? '4 3' : undefined}
                      markerEnd={`url(#arrow-${spaceId})`}
                    >
                      <title>
                        {from.title} → {to.title}: {e.kind}
                      </title>
                    </path>
                  )
                })}
              </svg>
              {groups.map((g) => {
                const groupNodes = nodes.filter((n) => n.group === g)
                if (!groupNodes.length) return null
                const source = groupNodes.find((n) => n.sourceId)?.sourceId
                return (
                  <div
                    key={g}
                    className={styles.group}
                    style={{ left: 4, top: groupY.get(g) }}
                    onFocus={(e) => {
                      if (!(e.target as HTMLElement).matches(':focus-visible')) return
                      const box = e.currentTarget.getBoundingClientRect(),
                        outer = root.current?.getBoundingClientRect()
                      if (
                        outer &&
                        (box.top < outer.top ||
                          box.bottom > outer.bottom ||
                          box.left < outer.left ||
                          box.right > outer.right)
                      )
                        viewport({
                          ...state.viewport,
                          x: 12,
                          y: 12 - groupY.get(g)! * state.viewport.zoom,
                        })
                    }}
                  >
                    <button
                      aria-expanded={!state.collapsed.includes(g)}
                      title={groupNodes[0]!.groupTitle}
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          order,
                          groups,
                          collapsed: s.collapsed.includes(g)
                            ? s.collapsed.filter((id) => id !== g)
                            : [...s.collapsed, g],
                        }))
                      }
                    >
                      {state.collapsed.includes(g) ? '▸' : '▾'} {groupNodes[0]!.groupTitle} ·{' '}
                      {groupNodes.length}
                    </button>
                    {source && openSource && (
                      <button
                        aria-label={`Open ${groupNodes[0]!.groupTitle} source`}
                        onClick={() => openSource(source)}
                      >
                        ↗
                      </button>
                    )}
                  </div>
                )
              })}
              {nodes
                .filter((n) => !state.collapsed.includes(n.group))
                .map((n) => (
                  <Tip
                    as="button"
                    key={n.id}
                    data-work-id={n.id}
                    data-selected={state.selected === n.id || undefined}
                    className={styles.node}
                    style={{ left: positions.get(n.id)!.x, top: positions.get(n.id)!.y }}
                    text={`${n.title}\n${n.assignee}\n${n.status}${n.reason ? ` · ${n.reason}` : ''}\n${n.outputs} outputs → ${n.destination}`}
                    onClick={() => open(n)}
                    onFocus={(e) => {
                      if (!e.currentTarget.matches(':focus-visible')) return
                      const box = e.currentTarget.getBoundingClientRect(),
                        outer = root.current?.getBoundingClientRect()
                      if (
                        outer &&
                        (box.left < outer.left ||
                          box.right > outer.right ||
                          box.top < outer.top ||
                          box.bottom > outer.bottom)
                      ) {
                        const p = positions.get(n.id)!
                        viewport({
                          ...state.viewport,
                          x: 12 - p.x * state.viewport.zoom,
                          y: 46 - p.y * state.viewport.zoom,
                        })
                      }
                    }}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.assignee}</span>
                    <span>
                      {n.attention ? '! ' : ''}
                      {n.status}
                    </span>
                    <span>
                      {n.outputs ? `${n.outputs} outputs → ` : '→ '}
                      {n.destination}
                    </span>
                  </Tip>
                ))}
            </div>
          </div>
          {graph.edges.length > 0 && (
            <small className={styles.legend}>→ Depends on · ⇢ Delegated from</small>
          )}
        </>
      )}
    </section>
  )
}
