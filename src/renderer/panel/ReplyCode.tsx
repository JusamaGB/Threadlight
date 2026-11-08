import {
  Fragment,
  memo,
  useMemo,
  useState,
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { ContextMenu } from './ContextMenu'
import { HoverInfo, type HoverPoint } from './HoverInfo'
import { HoverFooter } from './HoverFooter'
import { HelpModeContext, useHelpMode } from './helpMode'
import { useSettings } from '../hooks/useSettings'
import {
  pinLabel,
  pinInfo,
  replyFile,
  type CodeFile,
  type CodeReference,
} from '../../shared/codeReference'
import type { ReferenceAnchor } from '../../shared/ipc'
import { common, createLowlight } from 'lowlight'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { RootContent } from 'hast'
import type { Nodes } from 'mdast'
import type { Components } from 'react-markdown'
import styles from './ReplyCode.module.css'
import { installReplyCodePan } from '../lib/replyCodePan'
import pinStyle from './PinnedReference.module.css'
import { pinVersion, versionNumbers, type PinCommand, type PinState } from '../../shared/pinnedCode'
import { PinResize } from './PinResize'

const syntax = createLowlight(common)
const storageKey = 'threadlight.pinned-code.v1'
const heightKey = 'threadlight.pinned-reference-height'
function readHeight() {
  try {
    return Math.max(160, Math.min(540, Number(localStorage.getItem(heightKey)) || 300))
  } catch {
    return 300
  }
}
const Pins = createContext<{
  files: CodeReference[]
  changePin: (file: CodeReference, remove: boolean) => void
  error: string
  height: number
  resize: (height: number) => void
  fold: (id: string, collapsed: boolean) => void
  selectedId: string | null
  select: (id: string) => void
  browse: (id: string, revision: number) => void
} | null>(null)
export function CodePinsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PinState>()
  const [error, setError] = useState('')
  const [height, setHeight] = useState(readHeight)
  const accept = useCallback(
    (next: PinState) =>
      setState((previous) =>
        !previous || next.generation >= previous.generation ? next : previous,
      ),
    [],
  )
  const request = useCallback(
    async (command: PinCommand) => {
      try {
        accept(await window.threadlight.pinnedCode(command))
        setError('')
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save pinned references.')
      }
    },
    [accept],
  )
  useEffect(() => {
    const off = window.threadlight.onPinsChanged(accept)
    void Promise.resolve()
      .then(async () => {
        const legacy = localStorage.getItem(storageKey)
        const saved = await request({ action: 'open', legacy })
        if (saved && legacy && localStorage.getItem(storageKey) === legacy)
          localStorage.removeItem(storageKey)
      })
      .catch(() => setError('Could not migrate local pinned references.'))
    function sync(event: StorageEvent) {
      if (event.key === heightKey || event.key === null) setHeight(readHeight())
    }
    window.addEventListener('storage', sync)
    return () => {
      off()
      window.removeEventListener('storage', sync)
    }
  }, [accept, request])
  const count = state?.files.length
  useEffect(() => {
    if (count !== undefined) window.threadlight.pinnedCodeSize(count > 0, height)
  }, [height, count])
  function resize(value: number) {
    const next = Math.max(160, Math.min(540, Math.round(value)))
    try {
      localStorage.setItem(heightKey, String(next))
      setHeight(next)
    } catch {
      setError('Could not save reference height.')
    }
  }
  function changePin(file: CodeReference, remove: boolean) {
    if (!state) return
    if (remove) {
      void request({ action: 'remove', id: file.id })
      try {
        localStorage.removeItem(storageKey + '.view.' + file.id)
      } catch {
        /* Optional scroll position. */
      }
    } else void request({ action: 'add', file })
  }
  const selectedId = state?.selectedId ?? null
  return (
    <Pins.Provider
      value={{
        files: state?.files ?? [],
        changePin,
        error,
        height,
        resize,
        selectedId,
        fold: (id, collapsed) => void request({ action: 'fold', id, collapsed }),
        browse: (id, revision) => void request({ action: 'browse', id, revision }),
        select: (id) => {
          if (id !== selectedId) void request({ action: 'select', id })
        },
      }}
    >
      {children}
    </Pins.Provider>
  )
}
export function PinnedCodeDock({
  detached = false,
  anchor,
}: { detached?: boolean; anchor?: ReferenceAnchor } = {}) {
  const pins = useContext(Pins)
  if (!pins || (!pins.files.length && !pins.error)) return null
  return (
    <section
      className={pinStyle.surface}
      data-detached={detached || undefined}
      data-anchor-bottom={anchor?.bottom || undefined}
      data-anchor-right={anchor?.right || undefined}
      data-card={detached ? '' : undefined}
      aria-label="Pinned code"
      style={
        {
          '--reference-height': pins.height + 'px',
          '--indicator-width': anchor && anchor.width + 'px',
          '--indicator-height': anchor && anchor.height + 'px',
        } as CSSProperties
      }
    >
      <header className={pinStyle.bar}>
        <span>Pinned code</span>
      </header>
      <div className={styles.dock}>
        {pins.error && <p role="alert">{pins.error}</p>}
        {pins.files.map((file) => (
          <ReplyCode
            key={file.id}
            language={file.language}
            code={pinVersion(file)?.code ?? file.code}
            pinned={file}
          />
        ))}
      </div>
      <PinResize
        height={pins.height}
        resize={pins.resize}
        upward={!!(detached && anchor?.bottom)}
      />
      {detached && <HoverFooter />}
    </section>
  )
}
export function ReferenceWindow() {
  const [anchor, setAnchor] = useState<ReferenceAnchor>()
  const settings = useSettings()
  useLayoutEffect(() => window.threadlight.onReferenceAnchor(setAnchor), [])
  useEffect(installReplyCodePan, [])
  return (
    <HelpModeContext.Provider value={settings?.hoverHelp ?? 'info'}>
      <CodePinsProvider>
        <PinnedCodeDock detached anchor={anchor} />
      </CodePinsProvider>
    </HelpModeContext.Provider>
  )
}
const labels: Record<string, string> = {
  python: 'Python',
  py: 'Python',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  bash: 'Bash',
  powershell: 'PowerShell',
  cpp: 'C++',
  csharp: 'C#',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
}

function token(node: RootContent, index: number): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type !== 'element') return null
  return (
    <span key={index} className={(node.properties.className as string[] | undefined)?.join(' ')}>
      {node.children.map(token)}
    </span>
  )
}

function CopyCode({ code }: { code: string }) {
  const [feedback, setFeedback] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    const copied = await window.threadlight.copyText(code)
    clearTimeout(timer.current)
    setFeedback(copied ? 'Copied' : 'Copy failed')
    timer.current = setTimeout(() => setFeedback(''), 2000)
  }
  return (
    <>
      <button
        type="button"
        className={styles.copy}
        aria-label="Copy code"
        title={feedback || 'Copy code'}
        onClick={() => void copy()}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {feedback === 'Copied' ? (
            <path d="m3 8 3.2 3.3L13 4.5" />
          ) : feedback ? (
            <path d="M8 3v6m0 3v.4" />
          ) : (
            <>
              <path d="M5 10H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" />
            </>
          )}
        </svg>
      </button>
      <span role="status" className={styles.copyStatus}>
        {feedback}
      </span>
    </>
  )
}

export const ReplyCode = memo(function ReplyCode({
  language,
  code,
  pinned,
  file: sourceFile,
  sourceId,
  blockOffset,
}: {
  language: string
  code: string
  pinned?: CodeReference
  file?: CodeFile
  sourceId?: string
  blockOffset?: number
}) {
  const pinnedId = pinned?.id
  const versions = pinned ? versionNumbers(pinned) : []
  const shownRevision = pinned?.viewedRevision ?? pinned?.revision ?? 1
  const position = versions.indexOf(shownRevision)
  const versionLabel =
    versions.length > 1
      ? `Version ${shownRevision} · ${position + 1} of ${versions.length} saved`
      : ''
  const [point, setPoint] = useState<HoverPoint | null>(null)
  const dismiss = useCallback(() => setPoint(null), [])
  const mode = useHelpMode()
  const pins = useContext(Pins)
  const header = useRef<HTMLElement>(null)
  const scroll = useRef<HTMLPreElement>(null)
  useLayoutEffect(() => {
    if (!pinnedId || !scroll.current) return
    const el = scroll.current,
      key = storageKey + '.view.' + pinnedId
    const restore = () => {
      try {
        const [x, y] = JSON.parse(localStorage.getItem(key) || '[0,0]')
        el.scrollTo(x, y)
      } catch {
        /* No saved position. */
      }
    }
    const sync = (e: StorageEvent) => {
      if (e.key === key) restore()
    }
    const save = () => {
      try {
        if (!document.hidden)
          localStorage.setItem(key, JSON.stringify([el.scrollLeft, el.scrollTop]))
      } catch {
        /* Panning still works when storage is full. */
      }
    }
    restore()
    el.addEventListener('scroll', save)
    window.addEventListener('storage', sync)
    return () => {
      el.removeEventListener('scroll', save)
      window.removeEventListener('storage', sync)
    }
  }, [pinnedId])
  const [menu, setMenu] = useState<{ x: number; y: number; file: CodeReference } | null>(null)
  function openMenu(x: number, y: number) {
    if (!pins) return
    const session = header.current?.closest<HTMLElement>('[data-session-id]')?.dataset
    const message = header.current?.closest<HTMLElement>(
      '[data-message-id],[data-card-id]',
    )?.dataset
    const chat = header.current?.closest<HTMLElement>('[data-code-thread]')?.dataset
    const origin =
      sourceId ??
      [session?.sessionId ?? chat?.codeThread, message?.messageId ?? message?.cardId]
        .filter(Boolean)
        .join('/')
    const identity = !origin || blockOffset === undefined ? origin : origin + '#' + blockOffset
    const file = pinned ??
      pins.files.find(
        (f) =>
          f.language === language &&
          ((!!origin && f.origin === identity) ||
            (f.code === code && (f.origin === identity || (!f.file && f.origin === origin)))) &&
          f.file?.name === sourceFile?.name &&
          f.file?.path === sourceFile?.path,
      ) ?? {
        id: crypto.randomUUID(),
        code,
        language,
        origin: identity,
        title: session?.sessionTitle ?? chat?.codeTitle,
        file: sourceFile,
      }
    setMenu({ x, y, file })
  }
  function closeMenu() {
    setMenu(null)
    header.current?.focus({ preventScroll: true })
  }
  const name = language.toLowerCase()
  const languageLabel = Object.hasOwn(labels, name) ? labels[name] : language
  const body = useMemo(() => {
    if (!syntax.registered(name) || code.length > 32_000) return code
    return syntax.highlight(name, code).children.map(token)
  }, [name, code])
  return (
    <div
      className={styles.card}
      data-pinned-code={pinnedId}
      data-selected={(pinnedId && pins?.selectedId === pinnedId) || undefined}
      onContextMenu={
        pinnedId
          ? (event) => {
              const selection = window.getSelection()
              if (
                event.defaultPrevented ||
                (selection?.toString() && event.currentTarget.contains(selection.anchorNode))
              )
                return
              event.preventDefault()
              event.stopPropagation()
              openMenu(event.clientX, event.clientY)
            }
          : undefined
      }
      onFocusCapture={pinnedId ? () => pins?.select(pinnedId) : undefined}
      onPointerDown={pinnedId ? () => pins?.select(pinnedId) : undefined}
    >
      <details open={!pinned?.collapsed}>
        <summary
          ref={header}
          aria-haspopup="menu"
          aria-description={pinned && [pinInfo(pinned), versionLabel].filter(Boolean).join('\n')}
          data-tip-anchor={pinned ? '' : undefined}
          onMouseEnter={
            pinned
              ? (event) => setPoint({ x: 0, y: 0, screenX: event.screenX, screenY: event.screenY })
              : undefined
          }
          onFocus={pinned ? () => setPoint({ x: 0, y: 0 }) : undefined}
          onBlur={pinned ? dismiss : undefined}
          onClick={
            pinned
              ? (e) => {
                  e.preventDefault()
                  pins?.fold(pinned.id, !pinned.collapsed)
                }
              : undefined
          }
          data-tour-help="Right-click to pin or unpin this code. Shift+F10 opens the same menu."
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu(event.clientX, event.clientY)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault()
              event.stopPropagation()
              const b = event.currentTarget.getBoundingClientRect()
              openMenu(b.left + 6, b.bottom)
            }
          }}
        >
          <span className={styles.headerText}>
            <span>
              {pinned ? pinLabel({ ...pinned, code }) : sourceFile?.name || languageLabel || 'Code'}
            </span>
            {(pinned || sourceFile) && languageLabel && (
              <small className={styles.origin}>
                {languageLabel}
                {versions.length > 1 && ` · v${shownRevision}`}
              </small>
            )}
          </span>
        </summary>
        {versionLabel && (
          <small className={styles.version}>
            {versionLabel}
            {position === versions.length - 1 ? ' · Latest' : ''}
          </small>
        )}
        <pre
          ref={scroll}
          tabIndex={0}
          data-reply-code=""
          aria-description="Shift+wheel scrolls sideways. Hold Ctrl and left-drag to pan."
          data-tour-help="Shift+wheel scrolls sideways. Hold Ctrl and left-drag to pan."
        >
          <code>{body}</code>
        </pre>
      </details>
      {pinned && point && mode !== 'off' && !menu && (
        <HoverInfo forceFooter anchor={header} point={point} onDismiss={dismiss}>
          <span className={styles.sourceInfo}>
            {[pinInfo(pinned), versionLabel].filter(Boolean).join('\n')}
          </span>
        </HoverInfo>
      )}
      <CopyCode code={code} />
      {pinnedId && (
        <button
          type="button"
          className={styles.unpin}
          aria-label="Unpin code"
          title="Unpin this copy and its saved versions"
          onClick={() => pinned && pins?.changePin(pinned, true)}
        >
          Unpin
        </button>
      )}
      {menu && pins && (
        <ContextMenu
          label="Code reference"
          x={menu.x}
          y={menu.y}
          items={[
            ...(pinned
              ? [
                  {
                    label: `Previous version (${position + 1}/${versions.length})`,
                    disabled: position <= 0,
                    onSelect: () => pins.browse(pinned.id, versions[position - 1]!),
                  },
                  {
                    label: `Next version (${position + 1}/${versions.length})`,
                    disabled: position >= versions.length - 1,
                    onSelect: () => pins.browse(pinned.id, versions[position + 1]!),
                  },
                ]
              : []),
            {
              label: pins.files.some((f) => f.id === menu.file.id) ? 'Unpin' : 'Pin',
              onSelect: () =>
                pins.changePin(
                  menu.file,
                  pins.files.some((f) => f.id === menu.file.id),
                ),
            },
          ]}
          onClose={closeMenu}
        />
      )}
    </div>
  )
})

/** CommonMark emits one code element with literal text inside each pre. */
export const markdownCode: Components['pre'] = ({ node, children }) => {
  const code = node?.children[0]
  if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>
  const classes = code.properties.className
  const language = Array.isArray(classes)
    ? classes.find((c) => typeof c === 'string' && c.startsWith('language-'))
    : undefined
  return (
    <ReplyCode
      language={String(language ?? '').slice(9)}
      file={replyFile(code.data?.meta)}
      blockOffset={node?.position?.start.offset}
      code={code.children.map((n) => (n.type === 'text' ? n.value : '')).join('')}
    />
  )
}

export function replyCodeBlocks(text: string) {
  const blocks: {
    start: number
    end: number
    language: string
    value: string
    file?: CodeFile
  }[] = []
  function visit(node: Nodes) {
    if (node.type === 'code' && node.position) {
      blocks.push({
        start: node.position.start.offset!,
        end: node.position.end.offset!,
        language: node.lang ?? '',
        value: node.value,
        file: replyFile(node.meta),
      })
    } else if ('children' in node) node.children.forEach(visit)
  }
  // Most live progress messages contain only prose.
  if (/(?:`{3}|~{3}|^(?: {4}|\t))/m.test(text)) visit(fromMarkdown(text))
  return blocks
}

/** Some views supply their own prose and source links. Keep that renderer outside code blocks. */
export function ReplyWithCode({
  text,
  prose,
}: {
  text: string
  prose: (text: string) => ReactNode
}) {
  const parts = useMemo(() => replyCodeBlocks(text), [text])
  if (!parts.length) return <>{prose(text)}</>
  const trailing = text.slice(parts[parts.length - 1]!.end)
  return (
    <>
      {parts.map((block, index) => {
        const preceding = text.slice(parts[index - 1]?.end ?? 0, block.start)
        return (
          <Fragment key={block.start}>
            {preceding.trim() && prose(preceding)}
            <ReplyCode
              language={block.language}
              file={block.file}
              blockOffset={block.start}
              code={block.value + (block.value ? '\n' : '')}
            />
          </Fragment>
        )
      })}
      {trailing.trim() && prose(trailing)}
    </>
  )
}
