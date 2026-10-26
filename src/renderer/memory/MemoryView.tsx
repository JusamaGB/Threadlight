import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from 'react'
import type {
  MemoryFolder,
  MemoryInput,
  MemoryItem,
  MemoryRead,
  MemoryReply,
  MemorySnapshot,
  MemoryTask,
} from '../../shared/memory'
import type { Session } from '../../shared/types'
import styles from './MemoryView.module.css'

type Route = {
  kind: 'space' | 'folder' | 'item' | 'task' | 'access' | 'activity'
  id: string
  scroll?: number
}
type FormKind =
  | 'space'
  | 'folder'
  | 'note'
  | 'revise'
  | 'rename'
  | 'move'
  | 'merge'
  | 'grant'
  | 'task'
  | 'policy'
  | 'subscribe'
  | 'reconcile'
const empty: MemorySnapshot = {
  subscriptions: [],
  participants: [],
  spaces: [],
  folders: [],
  items: [],
  tasks: [],
  messages: [],
  grants: [],
  events: [],
  cursor: 0,
  seen: 0,
  drafts: {},
  endpoint: null,
}
const stamp = (time: number) => new Date(time).toLocaleString()

export function MemoryView({
  visible,
  sessions,
  onClose,
  navigationRef,
}: {
  visible: boolean
  sessions: Session[]
  onClose: () => void
  navigationRef?: Ref<{ back: () => void; openTask: (id: string) => void }>
}) {
  const [data, setData] = useState(empty)
  const [routes, setRoutes] = useState<Route[]>([])
  const [mode, setMode] = useState<'map' | 'list'>('map')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormKind | null>(null)
  const [read, setRead] = useState<MemoryRead | null>(null)
  const [version, setVersion] = useState<number | undefined>()
  const [connection, setConnection] = useState<{ token: string; label: string } | null>(null)
  const [pairingId, setPairingId] = useState<string | null>(null)
  const pairing = data.connections?.find((c) => c.id === pairingId)
  const [confirm, setConfirm] = useState<MemoryInput | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const route = routes.at(-1)
  const draftKey = `form:${form ?? 'none'}:${route?.id ?? 'root'}${pairingId && form === 'grant' ? ':' + pairingId : ''}`
  const folder = route?.kind === 'folder' ? data.folders.find((f) => f.id === route.id) : undefined
  const item = route?.kind === 'item' ? data.items.find((i) => i.id === route.id) : undefined
  const task = route?.kind === 'task' ? data.tasks.find((t) => t.id === route.id) : undefined
  const spaceId =
    folder?.spaceId ??
    item?.spaceId ??
    task?.spaceId ??
    (route?.kind === 'space' ? route.id : routes.find((r) => r.kind === 'space')?.id)
  const space = data.spaces.find((s) => s.id === spaceId)
  const request = useCallback(async (input: MemoryInput) => {
    setError('')
    setBusy(true)
    try {
      const result = await window.threadlight.memoryRequest({
        ...input,
        operationId: input.operationId ?? crypto.randomUUID(),
      })
      if (!result.ok) {
        setError(result.reason)
        return result
      }
      if (result.snapshot) setData(result.snapshot)
      return result
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Memory unavailable'
      setError(reason)
      return { ok: false, reason, code: 'unavailable' } as MemoryReply
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!window.threadlight.memoryRequest) return
    let active = true
    void window.threadlight.memoryRequest({ action: 'snapshot' }).then((r) => {
      if (active) {
        if (r.ok && r.snapshot) setData(r.snapshot)
        else if (!r.ok) setError(r.reason)
      }
    })
    const stop = window.threadlight.onMemory(setData)
    return () => {
      active = false
      stop()
    }
  }, [])
  useEffect(() => {
    if (!item) return
    let active = true
    void window.threadlight
      .memoryRequest({ action: 'read', id: item.id, revision: version })
      .then((r) => {
        if (active && r.ok) setRead(r.value as MemoryRead)
      })
    return () => {
      active = false
    }
  }, [item?.id, item?.revision, version, item])
  const navigate = (next: Route) => {
    setRoutes((old) => [
      ...old.map((r, n) =>
        n === old.length - 1 ? { ...r, scroll: body.current?.scrollTop ?? 0 } : r,
      ),
      next,
    ])
    setForm(null)
    setError('')
    setRead(null)
    setVersion(undefined)
    if (body.current) body.current.scrollTop = 0
  }
  const back = useCallback(() => {
    if (form) {
      setForm(null)
      return
    }
    if (connection) {
      setConnection(null)
      return
    }
    if (confirm) {
      setConfirm(null)
      return
    }
    if (routes.length) {
      setRoutes((old) => old.slice(0, -1))
      setRead(null)
      setVersion(undefined)
      requestAnimationFrame(() => {
        if (body.current) body.current.scrollTop = routes.at(-2)?.scroll ?? 0
      })
    } else onClose()
  }, [form, connection, confirm, routes, onClose])
  useImperativeHandle(
    navigationRef,
    () => ({
      back,
      openTask: (id: string) => {
        setRoutes([{ kind: 'task', id }])
        setForm(null)
        setConfirm(null)
        setConnection(null)
        setError('')
      },
    }),
    [back],
  )
  useEffect(() => {
    if (!visible) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        back()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [visible, back])
  const acceptReply = (reply: MemoryReply) => {
    if (reply.ok && reply.snapshot) setData(reply.snapshot)
    else if (!reply.ok) setError(reply.reason)
  }
  const childFolders = data.folders.filter(
    (f) => f.spaceId === spaceId && f.parentId === (folder?.id ?? null) && !f.archived,
  )
  const childItems = data.items.filter((i) => i.folderId === folder?.id && !i.archived)
  const heading =
    folder?.title ??
    item?.title ??
    task?.title ??
    (route?.kind === 'access'
      ? 'Agent access'
      : route?.kind === 'activity'
        ? 'Activity'
        : (space?.title ?? 'Handoffs'))
  const newFolder = (f: MemoryFolder) =>
    data.events.some(
      (e) => e.entityId === f.id && e.seq > data.seen && e.action === 'Folder created',
    )
  const folderRow = (f: MemoryFolder) => (
    <button
      key={f.id}
      className={styles.row}
      onClick={() => navigate({ kind: 'folder', id: f.id })}
    >
      <strong>{f.title}</strong>
      <span>
        {data.items.filter((i) => i.folderId === f.id && !i.archived).length} items ·{' '}
        {data.folders.filter((c) => c.parentId === f.id && !c.archived).length} folders{' '}
        {newFolder(f) && '· New'}
      </span>
    </button>
  )
  const itemRow = (i: MemoryItem) => (
    <button key={i.id} className={styles.row} onClick={() => navigate({ kind: 'item', id: i.id })}>
      <strong>{i.title}</strong>
      <span>
        {i.kind} · v{i.revision} · {i.acceptedRevision === i.revision ? 'Accepted' : 'Draft'}
      </span>
    </button>
  )
  const taskRow = (t: MemoryTask) => (
    <button key={t.id} className={styles.row} onClick={() => navigate({ kind: 'task', id: t.id })}>
      <strong>{t.title}</strong>
      <span>
        {t.state} · {sessions.find((s) => s.id === t.assignee)?.title ?? t.assignee}
      </span>
    </button>
  )
  const mutate = async (input: MemoryInput) => {
    const result = await request(input)
    if (result.ok) setConfirm(null)
    return result
  }

  return (
    <section className={styles.view} hidden={!visible} aria-label="Handoffs">
      {route && <p className={styles.hint}>Handoffs / {heading}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div ref={body} className={styles.body}>
        {confirm ? (
          <div className={styles.details}>
            <h3>Confirm {confirm.action.replaceAll('_', ' ')}</h3>
            <p>
              {confirm.action === 'purge_item'
                ? 'Permanently remove this item and its versions. Copies already sent to native chats and exported backups remain outside this deletion.'
                : 'This changes shared material for every enrolled participant. Folder moves and merges can block pending output destinations.'}
            </p>
            <button disabled={busy} className={styles.action} onClick={() => void mutate(confirm)}>
              Confirm
            </button>
            <button className={styles.action} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        ) : connection ? (
          <div className={styles.details}>
            <h3>Connect {connection.label}</h3>
            <p>
              This capability grants access to the selected scope. It identifies this enrollment,
              not a verified native chat. Keep the configuration private. The token is shown once.
            </p>
            <p>Claude Code HTTP MCP configuration:</p>
            <pre>
              {JSON.stringify(
                {
                  mcpServers: {
                    threadlight: {
                      type: 'http',
                      url: data.endpoint,
                      headers: { Authorization: `Bearer ${connection.token}` },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <button
              className={styles.action}
              onClick={() =>
                window.threadlight.copyText(
                  JSON.stringify(
                    {
                      mcpServers: {
                        threadlight: {
                          type: 'http',
                          url: data.endpoint,
                          headers: { Authorization: `Bearer ${connection.token}` },
                        },
                      },
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              Copy Claude configuration
            </button>
            <p>Codex config.toml:</p>
            <pre>{`[mcp_servers.threadlight]\nurl = "${data.endpoint}"\nhttp_headers = { Authorization = "Bearer ${connection.token}" }`}</pre>
            <button
              className={styles.action}
              onClick={() =>
                window.threadlight.copyText(
                  `[mcp_servers.threadlight]\nurl = "${data.endpoint}"\nhttp_headers = { Authorization = "Bearer ${connection.token}" }`,
                )
              }
            >
              Copy Codex configuration
            </button>
            <p>
              Use the provider’s MCP configuration controls for the intended chats. Existing chats
              may require reconnecting tools. Creating this capability does not change either
              provider’s settings.
            </p>
          </div>
        ) : form ? (
          <MemoryForm
            draftKey={draftKey}
            key={draftKey}
            kind={form}
            folder={folder}
            item={item}
            read={read}
            spaceId={spaceId}
            data={data}
            sessions={
              pairing
                ? sessions.filter((s) => (s.provider ?? 'claude') === pairing.provider)
                : sessions
            }
            connectionRequest={form === 'grant' ? pairing : undefined}
            busy={busy}
            submit={async (values) => {
              let input: MemoryInput
              const common = {
                title: values.title,
                body: values.body,
                description: values.description,
              }
              switch (form) {
                case 'space':
                  input = { action: 'create_space', ...common }
                  break
                case 'folder':
                  input = {
                    action: 'ensure_folder',
                    spaceId,
                    parentId: folder?.id ?? null,
                    title: values.title,
                    description: values.description,
                    reason: values.reason || 'Created by the human.',
                  }
                  break
                case 'note':
                  input = {
                    action: 'create_item',
                    folderId: folder?.id,
                    title: values.title,
                    body: values.body,
                    kind: values.kind as MemoryInput['kind'],
                  }
                  break
                case 'revise':
                  input = {
                    action: 'revise_item',
                    id: item?.id,
                    expectedRevision: Number(values.__expectedRevision),
                    title: values.title,
                    body: values.body,
                  }
                  break
                case 'rename':
                  input = {
                    action: 'update_folder',
                    id: folder?.id,
                    expectedRevision: Number(values.__expectedRevision),
                    title: values.title,
                    description: values.description,
                  }
                  break
                case 'move':
                  input = {
                    action: 'update_folder',
                    id: folder?.id,
                    expectedRevision: Number(values.__expectedRevision),
                    parentId: values.destination || null,
                  }
                  break
                case 'merge':
                  input = { action: 'merge_folder', id: folder?.id, targetId: values.destination }
                  break
                case 'grant':
                  input = {
                    action: 'create_grant',
                    connectionId: pairingId ?? undefined,
                    assignee: values.assignee || undefined,
                    spaceId,
                    folderId: values.destination || undefined,
                    title: values.title,
                    readOnly: values.write !== 'on',
                    createFolders: values.folders === 'on',
                    delegate: values.delegate === 'on',
                  }
                  break
                case 'task':
                  input = {
                    action: 'create_task',
                    folderId: values.destination,
                    title: values.title,
                    body: values.body,
                    assignee: values.assignee,
                    inputs: values.inputs
                      ? (JSON.parse(values.inputs) as MemoryInput['inputs'])
                      : [],
                  }
                  break
                case 'policy':
                  input = {
                    action: 'update_space',
                    id: spaceId,
                    mode: values.mode as MemoryInput['mode'],
                    paused: values.running !== 'on',
                    maxDispatches: Number(values.limit),
                    durationMinutes: Number(values.minutes),
                    resetBudget: values.reset === 'on',
                  }
                  break
                case 'subscribe':
                  input = {
                    action: 'subscribe',
                    folderId: folder?.id,
                    assignee: values.assignee,
                    title: values.title,
                    body: values.body,
                  }
                  break
                case 'reconcile':
                  input = { action: 'reconcile_task', id: task?.id, reason: values.body }
                  break
              }
              const result = await request(input)
              if (result.ok) {
                void window.threadlight.memoryRequest({
                  action: 'save_draft',
                  operationId: crypto.randomUUID(),
                  draftKey,
                  body: '',
                })
                setForm(null)
                if (form === 'grant') {
                  setPairingId(null)
                  const grant = result.value as { token?: string; label: string }
                  if (grant.token) setConnection({ token: grant.token, label: grant.label })
                }
              }
            }}
          />
        ) : !route ? (
          <>
            <p className={styles.hint}>
              Context, decisions and handoffs between your Claude and Codex chats. Share only what
              collaborators need; each provider keeps its own memory.
            </p>
            {(data.connections ?? []).some((c) => c.state === 'pending') && (
              <p role="status" className={styles.hint}>
                Plugin connection requests are waiting. Choose a space, then Agent access to review
                them.
              </p>
            )}
            {data.spaces.map((s) => (
              <button
                key={s.id}
                className={styles.row}
                onClick={() => navigate({ kind: 'space', id: s.id })}
              >
                <strong>{s.title}</strong>
                <span>{s.description || 'Collaboration space'}</span>
              </button>
            ))}
            <button className={styles.action} onClick={() => setForm('space')}>
              Create shared space
            </button>
            <button
              className={styles.action}
              onClick={() => void window.threadlight.memoryExport().then(acceptReply)}
            >
              Export backup
            </button>
            <button
              className={styles.action}
              onClick={() => void window.threadlight.memoryRestore().then(acceptReply)}
            >
              Restore backup
            </button>
          </>
        ) : route.kind === 'space' || route.kind === 'folder' ? (
          <>
            <div className={styles.toolbar}>
              <input
                aria-label="Search shared context"
                placeholder="Search notes and folders…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setMode(mode === 'map' ? 'list' : 'map')}>
                {mode === 'map' ? 'List' : 'Map'}
              </button>
            </div>
            {folder && (
              <p className={styles.hint}>
                {folder.description}
                {folder.archived && ' · Archived'}
                {folder.redirectId && (
                  <button onClick={() => navigate({ kind: 'folder', id: folder.redirectId! })}>
                    Open merged destination
                  </button>
                )}
              </p>
            )}
            {query ? (
              <MemorySearch query={query} spaceId={spaceId} navigate={navigate} />
            ) : (
              <>
                {mode === 'map' && childFolders.length > 0 ? (
                  <div className={styles.map}>
                    <div className={styles.hub}>{folder?.title ?? space?.title}</div>
                    <div className={styles.nodes}>
                      {childFolders.slice(0, 6).map((f) => (
                        <button
                          className={styles.node}
                          key={f.id}
                          onClick={() => navigate({ kind: 'folder', id: f.id })}
                        >
                          <strong>{f.title}</strong>
                          <span>
                            {data.items.filter((i) => i.folderId === f.id && !i.archived).length}{' '}
                            items {newFolder(f) && '· New'}
                          </span>
                        </button>
                      ))}
                    </div>
                    {childFolders.length > 6 && (
                      <button className={styles.action} onClick={() => setMode('list')}>
                        More folders · {childFolders.length - 6}
                      </button>
                    )}
                  </div>
                ) : (
                  childFolders.map(folderRow)
                )}
                {childItems.map(itemRow)}
                {!childFolders.length && !childItems.length && (
                  <p className={styles.hint}>
                    No material here yet. Add a folder, note or attachment.
                  </p>
                )}
              </>
            )}
            <div className={styles.actions}>
              <button onClick={() => setForm('folder')}>New folder</button>
              {folder && (
                <>
                  <button onClick={() => setForm('note')}>New note</button>
                  <button
                    onClick={() =>
                      void window.threadlight.memoryImport(folder.id).then(acceptReply)
                    }
                  >
                    Add file
                  </button>
                  <button onClick={() => setForm('rename')}>Rename</button>
                  <button onClick={() => setForm('move')}>Move</button>
                  <button onClick={() => setForm('merge')}>Merge</button>
                  <button onClick={() => setForm('subscribe')}>Watch for changes</button>
                  <button
                    onClick={() =>
                      setConfirm({
                        action: 'update_folder',
                        id: folder.id,
                        expectedRevision: folder.revision,
                        archived: !folder.archived,
                      })
                    }
                  >
                    {folder.archived ? 'Restore folder' : 'Archive folder'}
                  </button>
                </>
              )}
              <button onClick={() => navigate({ kind: 'activity', id: spaceId! })}>Activity</button>
              <button onClick={() => navigate({ kind: 'access', id: spaceId! })}>
                Agent access
              </button>
              <button onClick={() => setForm('task')}>Delegate</button>
              <button onClick={() => setForm('policy')}>Coordination</button>
              <button onClick={() => void request({ action: 'mark_seen', cursor: data.cursor })}>
                Mark changes seen
              </button>
            </div>
            <h3 className={styles.label}>Tasks</h3>
            {data.subscriptions
              .filter(
                (s) => s.active && s.spaceId === spaceId && (!folder || s.folderId === folder.id),
              )
              .map((s) => (
                <div className={styles.message} key={s.id}>
                  <strong>{s.title}</strong>
                  <p>
                    Change reviews for{' '}
                    {sessions.find((c) => c.id === s.assignee)?.title ?? s.assignee}
                  </p>
                  <button
                    className={styles.action}
                    onClick={() => void request({ action: 'unsubscribe', id: s.id })}
                  >
                    Stop watching
                  </button>
                </div>
              ))}
            {data.tasks
              .filter((t) => t.spaceId === spaceId && (!folder || t.folderId === folder.id))
              .map(taskRow)}

            <details>
              <summary>Archived folders</summary>
              {data.folders.filter((f) => f.spaceId === spaceId && f.archived).map(folderRow)}
            </details>
            <details>
              <summary>Archived items</summary>
              {data.items.filter((i) => i.spaceId === spaceId && i.archived).map(itemRow)}
            </details>
          </>
        ) : route.kind === 'item' && item ? (
          <div className={styles.details}>
            <div className={styles.metadata}>
              {item.kind} ·{' '}
              {item.acceptedRevision === read?.revision.revision ? 'Accepted' : 'Draft'}
              <select
                aria-label="Item version"
                value={version ?? item.revision}
                onChange={(e) => setVersion(Number(e.target.value))}
              >
                {Array.from({ length: item.revision }, (_, n) => (
                  <option key={n} value={n + 1}>
                    v{n + 1}
                  </option>
                ))}
              </select>
            </div>
            {read?.item.id === item.id ? (
              <>
                <p className={styles.hint}>
                  {read.revision.author} · {stamp(read.revision.createdAt)}
                </p>
                {read.dataUrl?.startsWith('data:image/') && (
                  <img className={styles.image} src={read.dataUrl} alt={item.title} />
                )}
                <div className={styles.text}>{read.revision.body}</div>
                {read.dataUrl && !read.dataUrl.startsWith('data:image/') && (
                  <a href={read.dataUrl} download={read.revision.filename}>
                    Save document
                  </a>
                )}
                <p className={styles.hint}>
                  Source: {read.revision.source}
                  <br />
                  Reference: {item.id} / v{read.revision.revision}
                </p>
              </>
            ) : (
              <p>Loading version…</p>
            )}
            <div className={styles.actions}>
              {!['image', 'document'].includes(item.kind) && (
                <button onClick={() => setForm('revise')}>Propose revision</button>
              )}
              <button
                onClick={() =>
                  void request({
                    action: 'accept_item',
                    id: item.id,
                    revision: version ?? item.revision,
                  })
                }
              >
                Accept this version
              </button>
              <button
                onClick={() =>
                  setConfirm({ action: 'archive_item', id: item.id, archived: !item.archived })
                }
              >
                {item.archived ? 'Restore item' : 'Archive'}
              </button>
              <button onClick={() => setConfirm({ action: 'purge_item', id: item.id })}>
                Purge
              </button>
              <button onClick={() => setForm('task')}>Request review</button>
            </div>
            {data.tasks
              .filter(
                (t) => t.inputs.some((r) => r.itemId === item.id) || t.outputIds.includes(item.id),
              )
              .map(taskRow)}
            <h3>Discussion</h3>
            {data.messages
              .filter((m) => m.itemId === item.id)
              .map((m) => (
                <div className={styles.message} key={m.id}>
                  <small>{m.author}</small>
                  <p>{m.body}</p>
                </div>
              ))}
            <MemoryComment
              key={item.id}
              task={item}
              item
              initial={data.drafts[`item:${item.id}`] ?? ''}
              request={request}
            />
          </div>
        ) : route.kind === 'task' && task ? (
          <div className={styles.details}>
            <p className={styles.status}>
              {task.state} · {task.reason}
            </p>
            {task.deliveryState === 'dispatching' && (
              <p className={styles.hint}>
                The native turn is still running. Saving a result does not stop it.
              </p>
            )}
            {(task.state === 'unknown' || task.deliveryState === 'unknown') && (
              <button className={styles.action} onClick={() => setForm('reconcile')}>
                Record native-chat outcome
              </button>
            )}
            <p>{task.body}</p>
            <h3>Pinned inputs</h3>
            {task.inputs.map((ref) => (
              <button
                className={styles.row}
                key={ref.itemId}
                onClick={() => {
                  navigate({ kind: 'item', id: ref.itemId })
                  setVersion(ref.revision)
                }}
              >
                {data.items.find((i) => i.id === ref.itemId)?.title ?? 'Unavailable item'} · v
                {ref.revision}
              </button>
            ))}
            <h3>Save results in</h3>
            <button
              className={styles.row}
              onClick={() => navigate({ kind: 'folder', id: task.folderId })}
            >
              {data.folders.find((f) => f.id === task.folderId)?.title ?? 'Unavailable folder'}
            </button>
            <h3>Results</h3>
            {task.outputs.map((ref) => (
              <button
                className={styles.row}
                key={ref.itemId}
                onClick={() => {
                  navigate({ kind: 'item', id: ref.itemId })
                  setVersion(ref.revision)
                }}
              >
                {data.items.find((i) => i.id === ref.itemId)?.title ?? 'Unavailable output'} · v
                {ref.revision}
              </button>
            ))}
            {task.inputs.some(
              (ref) =>
                data.items.find((i) => i.id === ref.itemId)?.revision !==
                (task.inputHeads?.find((head) => head.itemId === ref.itemId)?.revision ??
                  ref.revision),
            ) && (
              <p role="status" className={styles.hint}>
                An input has changed or is unavailable. This assignment retains its original pinned
                versions.
              </p>
            )}
            <div className={styles.text}>{task.reply}</div>
            {task.nativeReply && task.nativeReply !== task.reply && (
              <details>
                <summary>Native reply</summary>
                <div className={styles.text}>{task.nativeReply}</div>
              </details>
            )}
            <div className={styles.actions}>
              <button
                disabled={busy || !['draft', 'paused', 'blocked'].includes(task.state)}
                onClick={() => void request({ action: 'authorize_task', id: task.id })}
              >
                Authorise / resume
              </button>
              <button onClick={() => void request({ action: 'pause_task', id: task.id })}>
                Pause
              </button>
              <button onClick={() => setConfirm({ action: 'cancel_task', id: task.id })}>
                Cancel task
              </button>
              <button
                disabled={task.state !== 'submitted'}
                onClick={() => void request({ action: 'resolve_task', id: task.id })}
              >
                Accept result
              </button>
              <button
                onClick={() => {
                  const chat = sessions.find((s) => s.id === task.assignee)
                  if (chat) window.threadlight.openInClaude(chat.appId ?? chat.id)
                }}
              >
                Open chat
              </button>
            </div>
            <p className={styles.hint}>
              Authorised tasks wait while the destination is live. Resume the space’s coordination
              policy to permit dispatch.
            </p>
            <h3>Discussion</h3>
            {data.messages
              .filter((m) => m.taskId === task.id)
              .map((m) => (
                <div key={m.id} className={styles.message}>
                  <small>{m.author}</small>
                  <p>{m.body}</p>
                </div>
              ))}
            <MemoryComment
              key={task.id}
              task={task}
              initial={data.drafts[`task:${task.id}`] ?? ''}
              request={request}
            />
          </div>
        ) : route.kind === 'access' ? (
          <div className={styles.details}>
            <p>
              Each capability is scoped to this space or one folder. Names identify the enrollment,
              not a verified native chat.
            </p>
            <p className={styles.hint}>
              {data.endpoint
                ? `Local tools ready: ${data.endpoint}`
                : 'Collaboration tools are offline. Check whether another application owns port 47618.'}
            </p>
            {(data.connections ?? [])
              .filter((c) => c.state === 'pending')
              .map((c) => (
                <div className={styles.message} key={c.id}>
                  <strong>
                    {c.provider === 'codex' ? 'Codex' : 'Claude'} · {c.label}
                  </strong>
                  <p>
                    Match code <b>{c.code}</b> with the requesting chat.
                  </p>
                  <p className={styles.hint}>
                    Expires {stamp(c.expiresAt)}. Provider and label are claimed by the plugin; you
                    choose the scope and linked chat.
                  </p>
                  <div className={styles.actions}>
                    <button
                      onClick={() => {
                        setPairingId(c.id)
                        setForm('grant')
                      }}
                    >
                      Review connection
                    </button>
                    <button onClick={() => void request({ action: 'reject_connection', id: c.id })}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            {data.grants
              .filter((g) => g.spaceId === spaceId)
              .map((g) => (
                <div className={styles.message} key={g.id}>
                  <strong>{g.label}</strong>
                  <p>
                    {g.readOnly ? 'Read only' : 'Contribute drafts'} ·{' '}
                    {g.folderId
                      ? data.folders.find((f) => f.id === g.folderId)?.title
                      : 'Entire space'}{' '}
                    ·{' '}
                    {g.revoked
                      ? 'Revoked'
                      : g.pluginConnectionId
                        ? data.connections?.find((c) => c.id === g.pluginConnectionId)?.state ===
                          'connected'
                          ? 'Connected'
                          : 'Approved · awaiting tool use'
                        : 'Active'}
                  </p>
                  {!g.revoked && (
                    <button
                      className={styles.action}
                      onClick={() => setConfirm({ action: 'revoke_grant', id: g.id })}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            <button
              disabled={!data.endpoint}
              className={styles.action}
              onClick={() => {
                setPairingId(null)
                setForm('grant')
              }}
            >
              Enroll agent capability
            </button>
          </div>
        ) : route.kind === 'activity' ? (
          <>
            {data.events
              .filter((e) => e.spaceId === spaceId)
              .map((e) => (
                <div className={styles.message} key={e.seq}>
                  <strong>{e.action}</strong>
                  <span>
                    {e.author} · {stamp(e.at)}
                  </span>
                </div>
              ))}
          </>
        ) : (
          <p className={styles.hint}>This record is no longer available. Use Back to return.</p>
        )}
      </div>
    </section>
  )
}

function MemorySearch({
  query,
  spaceId,
  navigate,
}: {
  query: string
  spaceId?: string
  navigate: (route: Route) => void
}) {
  const [results, setResults] = useState<{
    folders: MemoryFolder[]
    items: MemoryItem[]
    tasks: MemoryTask[]
  }>({
    folders: [],
    tasks: [],
    items: [],
  })
  useEffect(() => {
    let active = true
    const timer = setTimeout(
      () =>
        void window.threadlight.memoryRequest({ action: 'search', query }).then((r) => {
          if (active && r.ok) setResults(r.value as typeof results)
        }),
      180,
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])
  return (
    <>
      {results.folders
        .filter((f) => f.spaceId === spaceId)
        .map((f) => (
          <button
            className={styles.row}
            key={f.id}
            onClick={() => navigate({ kind: 'folder', id: f.id })}
          >
            Folder · {f.title}
          </button>
        ))}
      {results.tasks
        .filter((t) => t.spaceId === spaceId)
        .map((t) => (
          <button
            className={styles.row}
            key={t.id}
            onClick={() => navigate({ kind: 'task', id: t.id })}
          >
            {t.title} · {t.state}
          </button>
        ))}
      {results.items
        .filter((i) => i.spaceId === spaceId)
        .map((i) => (
          <button
            className={styles.row}
            key={i.id}
            onClick={() => navigate({ kind: 'item', id: i.id })}
          >
            {i.title} · {i.kind}
          </button>
        ))}
    </>
  )
}

function MemoryComment({
  task,
  item = false,
  initial,
  request,
}: {
  task: Pick<MemoryTask, 'id' | 'spaceId'>
  item?: boolean
  initial: string
  request: (input: MemoryInput) => Promise<MemoryReply>
}) {
  const [text, setText] = useState(initial)
  const draftKey = `${item ? 'item' : 'task'}:${task.id}`
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void request({
          action: 'post_message',
          spaceId: task.spaceId,
          ...(item ? { id: task.id } : { targetId: task.id }),
          body: text,
        }).then((r) => {
          if (r.ok) {
            setText('')
            void request({ action: 'save_draft', draftKey, body: '' })
          }
        })
      }}
    >
      <label>
        {item ? 'Discuss this item' : 'Discuss this task'}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            void window.threadlight.memoryRequest({
              action: 'save_draft',
              operationId: crypto.randomUUID(),
              draftKey,
              body: e.target.value,
            })
          }}
          onBlur={() => void request({ action: 'save_draft', draftKey, body: text })}
        />
      </label>
      <button className={styles.action} disabled={!text.trim()}>
        Record message
      </button>
      <small>Records discussion; does not send a native chat turn.</small>
    </form>
  )
}

function formValues(form: HTMLFormElement): Record<string, string> {
  const fields = new FormData(form)
  return {
    ...Object.fromEntries(fields),
    inputs: JSON.stringify(
      fields.getAll('inputs').flatMap((value) => JSON.parse(String(value)) as unknown),
    ),
  } as Record<string, string>
}

function MemoryForm({
  draftKey,
  kind,
  folder,
  item,
  read,
  spaceId,
  data,
  sessions,
  busy,
  submit,
  connectionRequest,
}: {
  connectionRequest?: import('../../shared/memoryPlugins').MemoryPluginConnection
  draftKey: string
  kind: FormKind
  folder?: MemoryFolder
  item?: MemoryItem
  read: MemoryRead | null
  spaceId?: string
  data: MemorySnapshot
  sessions: Session[]
  busy: boolean
  submit: (values: Record<string, string>) => Promise<void>
}) {
  const [problem, setProblem] = useState('')
  const baseRevision = useRef(
    kind === 'revise' ? (read?.revision.revision ?? item?.revision) : folder?.revision,
  )
  const formRef = useRef<HTMLFormElement>(null)
  const initialDraft = useRef(data.drafts[draftKey])
  const [inputChoices] = useState(() => {
    let saved: { itemId: string; revision: number }[] = []
    try {
      saved = JSON.parse(
        (JSON.parse(data.drafts[draftKey] ?? '{}') as Record<string, string>).inputs ?? '[]',
      ) as typeof saved
    } catch {
      /* Ignore an invalid draft. */
    }
    return data.items
      .filter((i) => i.spaceId === spaceId && !i.archived)
      .map((i) => ({
        ...i,
        revision:
          saved.find((ref) => ref.itemId === i.id)?.revision ??
          (i.id === item?.id ? (read?.revision.revision ?? i.revision) : i.revision),
      }))
  })
  useEffect(() => {
    if (!initialDraft.current || !formRef.current) return
    try {
      const values = JSON.parse(initialDraft.current) as Record<string, string>
      if (
        Number.isInteger(Number(values.__expectedRevision)) &&
        Number(values.__expectedRevision) > 0
      )
        baseRevision.current = Number(values.__expectedRevision)
      if (values.inputs) {
        const selected = JSON.parse(values.inputs) as { itemId: string; revision: number }[]
        for (const input of formRef.current.querySelectorAll<HTMLInputElement>(
          'input[name="inputs"]',
        )) {
          const ref = JSON.parse(input.value) as { itemId: string; revision: number }
          const saved = selected.find((s) => s.itemId === ref.itemId)
          input.checked = !!saved
          if (saved) input.value = JSON.stringify(saved)
        }
      }
      for (const [name, value] of Object.entries(values)) {
        const element = formRef.current.elements.namedItem(name)
        if (element instanceof HTMLInputElement && element.type === 'checkbox')
          element.checked = value === 'on'
        else if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
          element.value = value
      }
    } catch {
      /* An invalid saved form never changes the canonical material. */
    }
  }, [])
  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const values = formValues(e.currentTarget)
    try {
      await submit({ ...values, __expectedRevision: String(baseRevision.current) })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Invalid input')
    }
  }
  const folders = data.folders.filter(
    (f) => f.spaceId === spaceId && !f.archived && f.id !== folder?.id,
  )
  const space = data.spaces.find((s) => s.id === spaceId)
  return (
    <form
      ref={formRef}
      className={styles.details}
      onChange={(e) =>
        void window.threadlight.memoryRequest({
          action: 'save_draft',
          operationId: crypto.randomUUID(),
          draftKey,
          body: JSON.stringify({
            ...formValues(e.currentTarget),
            __expectedRevision: String(baseRevision.current),
          }),
        })
      }
      onSubmit={(e) => void handle(e)}
    >
      {connectionRequest && (
        <p role="status">
          Approve {connectionRequest.provider} connection <b>{connectionRequest.code}</b> for this
          space. Read-only is the default.
        </p>
      )}
      <h3>
        {
          {
            space: 'Create shared space',
            folder: 'Create folder',
            note: 'Publish note',
            revise: 'Propose revision',
            rename: 'Rename folder',
            move: 'Move folder',
            merge: 'Merge folder',
            grant: 'Enroll agent',
            task: 'Delegate work',
            policy: 'Coordination policy',
            subscribe: 'Review future changes',
            reconcile: 'Record native-chat outcome',
          }[kind]
        }
      </h3>
      {problem && <p role="alert">{problem}</p>}
      {!['move', 'merge', 'policy', 'reconcile'].includes(kind) && (
        <label>
          Title
          <input
            name="title"
            required
            maxLength={80}
            defaultValue={
              kind === 'rename'
                ? folder?.title
                : kind === 'revise'
                  ? item?.title
                  : (connectionRequest?.label ?? '')
            }
          />
        </label>
      )}
      {['space', 'folder', 'rename'].includes(kind) && (
        <label>
          Description
          <textarea
            name="description"
            required={kind !== 'space'}
            maxLength={300}
            defaultValue={kind === 'rename' ? folder?.description : ''}
          />
        </label>
      )}
      {kind === 'folder' && (
        <label>
          Why this location?
          <input name="reason" maxLength={300} />
        </label>
      )}
      {kind === 'note' && (
        <label>
          Type
          <select name="kind">
            <option value="note">Note</option>
            <option value="decision">Decision draft</option>
            <option value="scratchpad">Scratchpad</option>
            <option value="reference">Reference</option>
          </select>
        </label>
      )}
      {['note', 'revise', 'task', 'subscribe', 'reconcile'].includes(kind) && (
        <label>
          {kind === 'task' ? 'Objective and acceptance criteria' : 'Text'}
          <textarea
            name="body"
            aria-label={kind === 'task' ? 'Objective and acceptance criteria' : 'Text'}
            required
            maxLength={kind === 'reconcile' ? 300 : kind === 'task' ? 12000 : 100000}
            rows={8}
            defaultValue={kind === 'revise' ? read?.revision.body : ''}
          />
        </label>
      )}
      {['move', 'merge', 'grant', 'task'].includes(kind) && (
        <label>
          {kind === 'grant' ? 'Access scope' : kind === 'task' ? 'Save results in' : 'Destination'}
          <select
            name="destination"
            aria-label={
              kind === 'grant'
                ? 'Access scope'
                : kind === 'task'
                  ? 'Save results in'
                  : 'Destination'
            }
            required={['merge', 'task'].includes(kind)}
          >
            {!['merge', 'task'].includes(kind) && (
              <option value="">{kind === 'grant' ? 'Entire space' : 'Space root'}</option>
            )}
            {(kind === 'task'
              ? data.folders.filter((f) => f.spaceId === spaceId && !f.archived)
              : folders
            ).map((f) => (
              <option value={f.id} key={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'grant' && (
        <>
          <label>
            Enrolled chat
            <select name="assignee">
              <option value="">Shared-context access only</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.provider ?? 'claude'}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="write" /> Allow publishing drafts
          </label>
          <label>
            <input type="checkbox" name="folders" /> Allow creating folders
          </label>
          <label>
            <input type="checkbox" name="delegate" /> Allow scoped automatic delegation when enabled
          </label>
          <p className={styles.hint}>
            Background assignments receive temporary scoped tools automatically. To share context
            with an existing open chat, use the Threadlight plugin and review its connection request
            here. Manual configuration is also available.
          </p>
        </>
      )}
      {(kind === 'task' || kind === 'subscribe') && (
        <>
          <label>
            Assigned chat
            <select name="assignee" required>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.provider ?? 'claude'}
                </option>
              ))}
            </select>
          </label>
          {kind === 'task' && (
            <fieldset className={styles.inputs}>
              <legend>Exact input versions</legend>
              {inputChoices.map((i) => (
                <label key={i.id}>
                  <input
                    type="checkbox"
                    name="inputs"
                    value={JSON.stringify({ itemId: i.id, revision: i.revision })}
                    defaultChecked={i.id === item?.id}
                  />
                  {i.title} · v{i.revision}
                </label>
              ))}
            </fieldset>
          )}
          <p className={styles.hint}>
            Creates a draft assignment. Authorise it after reviewing its recipient and inputs.
          </p>
        </>
      )}
      {kind === 'reconcile' && (
        <label>
          Outcome
          <select name="outcome">
            <option value="completed">The native turn finished</option>
            <option value="cancelled">Discard this assignment</option>
          </select>
        </label>
      )}
      {kind === 'policy' && (
        <>
          <label>
            Mode
            <select name="mode" defaultValue={space?.mode}>
              <option value="manual">Manual</option>
              <option value="assisted">Assisted</option>
              <option value="automatic">Automatic</option>
            </select>
          </label>
          <label>
            <input type="checkbox" name="running" defaultChecked={!space?.paused} /> Permit
            authorised dispatch
          </label>
          <label>
            Total dispatch limit
            <input
              type="number"
              name="limit"
              min="1"
              max="100"
              defaultValue={space?.maxDispatches ?? 10}
            />
          </label>
          <label>
            <input type="checkbox" name="reset" /> Start a fresh dispatch budget
          </label>
          <label>
            Continue for minutes
            <input type="number" name="minutes" min="1" max="240" defaultValue="30" />
          </label>
          <p className={styles.hint}>
            {space?.dispatches ?? 0} dispatches already used. Running turns continue when this is
            paused.
          </p>
        </>
      )}
      <button
        type="button"
        className={styles.action}
        onClick={() => {
          formRef.current?.reset()
          baseRevision.current =
            kind === 'revise' ? (read?.revision.revision ?? item?.revision) : folder?.revision
          void window.threadlight.memoryRequest({
            action: 'save_draft',
            operationId: crypto.randomUUID(),
            draftKey,
            body: '',
          })
        }}
      >
        Discard draft and reload
      </button>
      <button className={styles.action} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
