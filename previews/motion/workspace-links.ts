import { workspaceFolder } from '../../src/shared/providers'

type Thread = {
  id: string
  title: string
  provider: 'claude' | 'codex'
  cwd: string | null
  state: 'working' | 'waiting' | 'idle'
  stage: string
  context: number | null
  age: string
  thinking?: boolean
  depth?: number
  diff?: [number, number]
}
type Group = { key: string; name: string; colour: string; threads: Thread[]; lane: number }
const main = 'Z:/General/Threadlight'
const linkedin = 'Z:/Work/LinkedIn'
const quiz = 'Z:/General/QuizShorts'
const samples: Thread[] = [
  {
    id: 'review',
    title: 'Review and merge Threadlight',
    provider: 'codex',
    cwd: main,
    state: 'working',
    stage: 'Checking the local preflight',
    context: 0.46,
    age: 'now',
    thinking: true,
    diff: [124, 13],
  },
  {
    id: 'motion',
    title: 'Plan Threadlight generative motion',
    provider: 'claude',
    cwd: 'z:\\general\\THREADLIGHT\\',
    state: 'working',
    stage: 'Thinking',
    context: 0.68,
    age: 'now',
    thinking: true,
  },
  {
    id: 'other-worktree',
    title: 'Fix panel keyboard focus',
    provider: 'codex',
    cwd: 'Z:/General/Threadlight-ui',
    state: 'idle',
    stage: 'Separate worktree · ready for review',
    context: 0.32,
    age: '4m',
  },
  {
    id: 'post',
    title: 'Julius LinkedIn daily post',
    provider: 'claude',
    cwd: linkedin,
    state: 'idle',
    stage: 'Draft saved for tomorrow',
    context: 0.44,
    age: '9m',
  },
  {
    id: 'build-quiz',
    title: 'Build Quiz Shorts generator',
    provider: 'codex',
    cwd: quiz,
    state: 'working',
    stage: 'Rendering the next preview',
    context: 0.55,
    age: 'now',
    diff: [19, 2],
  },
  {
    id: 'agent',
    title: 'Refine Agent status',
    provider: 'claude',
    cwd: '\\\\?\\Z:\\General\\Threadlight',
    state: 'waiting',
    stage: 'Ready for your review',
    context: 0.81,
    age: '1m',
  },
  {
    id: 'cleanup',
    title: 'LinkedIn automation cleanup',
    provider: 'codex',
    cwd: linkedin,
    state: 'idle',
    stage: 'The queue has been checked',
    context: 0.23,
    age: '16m',
  },
  {
    id: 'quiz-audio',
    title: 'Fix quiz audio timing',
    provider: 'claude',
    cwd: quiz,
    state: 'idle',
    stage: 'Audio and captions are aligned',
    context: 0.12,
    age: '23m',
  },
  {
    id: 'hotfix',
    title: 'Hotfix workspace links',
    provider: 'claude',
    cwd: main,
    state: 'working',
    stage: 'Thinking',
    context: 0.37,
    age: 'now',
    depth: 1,
    thinking: true,
  },
  {
    id: 'queue',
    title: 'Queue tomorrow’s draft',
    provider: 'codex',
    cwd: linkedin,
    state: 'idle',
    stage: 'Waiting for the final edit',
    context: 0.31,
    age: '31m',
  },
  {
    id: 'render',
    title: 'Render quiz preview',
    provider: 'claude',
    cwd: quiz,
    state: 'waiting',
    stage: 'Which cut should we use?',
    context: 0.6,
    age: '6m',
  },
  {
    id: 'unknown',
    title: 'Untitled thread',
    provider: 'codex',
    cwd: null,
    state: 'idle',
    stage: 'Workspace unavailable',
    context: null,
    age: '1h',
  },
]
const colours = ['#80c5b5', '#b2a1e4', '#d1b480', '#7fb9d7']
const panel = document.querySelector<HTMLDivElement>('.panel')!
const stage = document.querySelector<HTMLDivElement>('.panel-stage')!
const viewport = document.querySelector<HTMLDivElement>('.wire-viewport')!
const sharedRail = document.querySelector<HTMLInputElement>('#shared-rail')!
const showLinks = document.querySelector<HTMLInputElement>('#show-links')!
const wireToggle = document.querySelector<HTMLButtonElement>('[data-wire-toggle]')!
const rows = document.querySelector<HTMLDivElement>('.rows')!
const content = document.querySelector<HTMLDivElement>('.content')!
const wires = document.querySelector<SVGSVGElement>('.wires')!
const scroll = document.querySelector<HTMLDivElement>('.scroll')!
const scenario = document.querySelector<HTMLSelectElement>('#scenario')!
const legend = document.querySelector<HTMLDivElement>('.legend')!
const summary = document.querySelector<HTMLDivElement>('.trace-summary')!
const expanded = new Set<string>()
let order = [...samples]
let shown: Thread[] = []
let groups: Group[] = []
let held: string | null = null
let hovered: string | null = null
let focused: string | null = null
let frame = 0,
  layoutVersion = 0
let layout: {
  key: string
  lane: number
  railX: number
  points: { x: number; y: number; id: string }[]
}[] = []
const keyOf = (thread: Thread) => (thread.cwd ? workspaceFolder(thread.cwd) : null)
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

function ring(thread: Thread) {
  const value = thread.context
  if (value === null) return ''
  const length = 2 * Math.PI * 6.25
  return `<svg class="ring" viewBox="0 0 14 14" data-level="${value >= 0.8 ? 'red' : value >= 0.6 ? 'amber' : 'normal'}" ${thread.thinking ? 'data-thinking' : ''} aria-hidden="true"><circle class="track" cx="7" cy="7" r="6.25"/><circle class="fill" cx="7" cy="7" r="6.25" stroke-dasharray="${length}" stroke-dashoffset="${length * (1 - value)}" transform="rotate(-90 7 7)"/></svg>`
}
function render() {
  shown = order.filter((thread) =>
    scenario.value === 'active'
      ? thread.state !== 'idle'
      : scenario.value === 'workspace'
        ? keyOf(thread) === workspaceFolder(main)
        : true,
  )
  const members = new Map<string, Thread[]>()
  for (const thread of shown) {
    const key = keyOf(thread)
    if (key) members.set(key, [...(members.get(key) ?? []), thread])
  }
  const allKeys = [...new Set(samples.map(keyOf).filter((key): key is string => !!key))]
  groups = [...members]
    .filter(([, threads]) => threads.length > 1)
    .map(([key, threads]) => ({
      key,
      threads,
      lane: 0,
      name: threads[0].cwd!.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1)!,
      colour: colours[allKeys.indexOf(key) % colours.length],
    }))
  // Disjoint vertical intervals reuse a lane; overlapping workspaces stay separate.
  const laneEnds: number[] = []
  for (const group of [...groups].sort(
    (a, b) => shown.indexOf(a.threads[0]) - shown.indexOf(b.threads[0]),
  )) {
    const first = shown.indexOf(group.threads[0]),
      last = shown.indexOf(group.threads.at(-1)!)
    let lane = laneEnds.findIndex((end) => end < first)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = last
    group.lane = lane
  }
  if (held && !groups.some((group) => group.key === held)) held = null
  rows.innerHTML = shown
    .map((thread) => {
      const group = groups.find((group) => group.key === keyOf(thread))
      return `<div class="thread-row" data-thread-id="${thread.id}" data-provider="${thread.provider}" data-link-group="${escape(group?.key ?? '')}" style="--depth:${thread.depth ?? 0};--group-colour:${group?.colour ?? '#aaa'}">
      ${thread.depth ? '<span class="guide" aria-hidden="true"></span>' : ''}
      <button class="thread" aria-expanded="${expanded.has(thread.id)}" aria-description="${thread.provider === 'claude' ? 'Claude' : 'Codex'} chat${thread.cwd ? ', ' + escape(thread.cwd) : ', workspace unavailable'}">
        <span class="top"><span class="dot-slot" title="${thread.context !== null ? 'Context ' + Math.round(thread.context * 100) + '%' : 'Context unavailable'}">${ring(thread)}<span class="dot" data-state="${thread.state}"></span></span><span class="title">${escape(thread.title)}</span>${thread.diff ? `<span class="diff"><span class="added">+${thread.diff[0]}</span><span class="removed">−${thread.diff[1]}</span></span>` : ''}</span>
        <span class="bottom"><span class="stage">${escape(thread.stage)}</span><span class="age">${thread.age}</span></span>
      </button>
      ${expanded.has(thread.id) ? '<div class="detail"><p>NOW</p><p>Checking the workspace and preparing the next change.</p><p>✓ Read the current plan</p><p>○ Finish local verification</p></div>' : ''}
    </div>`
    })
    .join('')
  for (const row of rows.querySelectorAll<HTMLDivElement>('.thread-row')) {
    const key = row.dataset.linkGroup || null
    row.onmouseenter = () => {
      hovered = key
      highlight()
    }
    row.onmouseleave = () => {
      hovered = null
      highlight()
    }
    row.addEventListener('focusin', () => {
      focused = key
      highlight()
    })
    row.addEventListener('focusout', () => {
      focused = null
      highlight()
    })
    row.querySelector<HTMLButtonElement>('button')!.onclick = () => {
      const id = row.dataset.threadId!
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      render()
      rows
        .querySelector<HTMLButtonElement>(`[data-thread-id="${id}"] button`)!
        .focus({ preventScroll: true })
    }
  }
  legend.innerHTML = groups
    .map(
      (group) =>
        `<button data-key="${escape(group.key)}" style="--group-colour:${group.colour}" aria-pressed="${held === group.key}" title="${escape(group.key)}"><span class="swatch" aria-hidden="true"></span>${escape(group.name)} · ${group.threads.length}</button>`,
    )
    .join('')
  for (const button of legend.querySelectorAll<HTMLButtonElement>('button'))
    button.onclick = () => {
      held = held === button.dataset.key ? null : button.dataset.key!
      hovered = null
      highlight()
    }
  document.querySelector('#view-label')!.textContent =
    `${scenario.value === 'active' ? 'Active' : scenario.value === 'workspace' ? 'Workspace' : 'Recent'} · ${shown.length}`
  schedule()
  highlight()
}

function draw() {
  const outside = stage.getBoundingClientRect()
  const list = scroll.getBoundingClientRect()
  viewport.style.top = `${list.top - outside.top}px`
  viewport.style.height = `${scroll.clientHeight}px`
  wires.setAttribute('viewBox', `0 0 ${outside.width} ${scroll.clientHeight}`)
  layout = groups.map((group) => ({
    key: group.key,
    lane: group.lane,
    railX: sharedRail.checked ? 12 : 12 - (group.lane % 3) * 4,
    points: group.threads.map((thread) => {
      const ring = rows
        .querySelector<HTMLElement>(`[data-thread-id="${thread.id}"] .dot-slot`)!
        .getBoundingClientRect()
      return {
        id: thread.id,
        x: ring.left - outside.left + ring.width / 2 - 7,
        y: ring.top - list.top + ring.height / 2,
      }
    }),
  }))
  wires.innerHTML = layout
    .map((group) => {
      const lane = group.railX
      const [first, last] = [group.points[0], group.points.at(-1)!]
      const radius = Math.min(4, first.x - lane, last.x - lane)
      let path = `M ${first.x} ${first.y} H ${lane + radius} Q ${lane} ${first.y} ${lane} ${first.y + radius} V ${last.y - radius} Q ${lane} ${last.y} ${lane + radius} ${last.y} H ${last.x}`
      for (const point of group.points.slice(1, -1)) path += ` M ${lane} ${point.y} H ${point.x}`
      return `<g class="wire-group" data-key="${escape(group.key)}" style="--wire-colour:${groups.find((item) => item.key === group.key)!.colour}"><path class="wire-back" d="${path}"/><path class="wire" d="${path}"/></g>`
    })
    .join('')
  layoutVersion++
  highlight()
}
function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(draw)
}
function highlight() {
  const active = held ?? hovered ?? focused
  stage.toggleAttribute('data-tracing', !!active)
  for (const wire of wires.querySelectorAll<SVGGElement>('.wire-group'))
    wire.toggleAttribute('data-highlight', wire.dataset.key === active)
  for (const row of rows.querySelectorAll<HTMLDivElement>('.thread-row'))
    row.toggleAttribute('data-match', !!active && row.dataset.linkGroup === active)
  for (const button of legend.querySelectorAll<HTMLButtonElement>('button'))
    button.setAttribute('aria-pressed', String(button.dataset.key === held))
  const group = groups.find((group) => group.key === active)
  summary.textContent = group
    ? `${group.name} · ${group.threads.length} listed threads · ${[...new Set(group.threads.map((thread) => (thread.provider === 'claude' ? 'Claude' : 'Codex')))].join(' + ')}. ${group.key}`
    : 'Hover or focus a thread to trace its workspace. Separate worktrees and unknown folders stay unlinked.'
  // Paint the highlighted route last so its crossings stay readable.
  const wire = [...wires.querySelectorAll<SVGGElement>('.wire-group')].find(
    (item) => item.dataset.key === active,
  )
  if (wire && wire !== wires.lastElementChild) wires.append(wire)
}
scenario.onchange = () => {
  hovered = null
  focused = null
  render()
  scroll.scrollTop = 0
}
function toggleLinks() {
  const enabled = showLinks.checked
  stage.dataset.links = enabled ? 'on' : 'off'
  wireToggle.dataset.connected = String(enabled)
  wireToggle.setAttribute('aria-pressed', String(enabled))
  wireToggle.setAttribute('aria-label', enabled ? 'Hide workspace wires' : 'Show workspace wires')
  wireToggle.title = enabled ? 'Hide workspace wires' : 'Show workspace wires'
  wireToggle
    .querySelector('.clip')!
    .setAttribute(
      'd',
      enabled ? 'M16 5H12Q9 5 9 8V16Q9 19 12 19H16' : 'M16 5H12Q9 5 9 8V10M9 14V16Q9 19 12 19H16',
    )
  schedule()
}
showLinks.onchange = toggleLinks
wireToggle.onclick = () => {
  showLinks.checked = !showLinks.checked
  toggleLinks()
}
sharedRail.onchange = schedule
document.querySelector<HTMLButtonElement>('#reorder')!.onclick = () => {
  order = [...order.slice(3), ...order.slice(0, 3)]
  hovered = null
  render()
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    held = null
    hovered = null
    focused = null
    highlight()
  }
})
scroll.addEventListener('scroll', () => {
  hovered = null
  highlight()
  schedule()
})
const resize = new ResizeObserver(schedule)
resize.observe(content)
resize.observe(stage)
render()
Object.assign(window, {
  workspaceWiresPreview: {
    inspect: () => ({
      layoutVersion,
      layout,
      panelInset: panel.getBoundingClientRect().left - stage.getBoundingClientRect().left,
      panelWidth: panel.getBoundingClientRect().width,
      groups: groups.map(({ key, threads, lane }) => ({
        key,
        lane,
        ids: threads.map((thread) => thread.id),
        providers: [...new Set(threads.map((thread) => thread.provider))],
      })),
    }),
  },
})
