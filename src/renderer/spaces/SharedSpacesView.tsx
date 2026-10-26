import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { IDLE_AGENT, agentBusy, type AgentItem } from '../../shared/agent'
import type { SpaceIdea, SpacesInput, SpacesSnapshot, MigrationPreview } from '../../shared/spaces'
import type { MemorySnapshot } from '../../shared/memory'
import { scopeMemory } from '../../shared/memory'
import type { Session } from '../../shared/types'
import { MemoryView } from '../memory/MemoryView'
import { AgentRequestCard } from '../panel/AgentRequestCard'
import { useSettings } from '../hooks/useSettings'
import styles from './SharedSpacesView.module.css'

export interface SpacesNavigation {
  back: () => void
}
type Area = 'handoffs' | 'ideas' | 'brainstorm'
const empty: SpacesSnapshot = {
  ideas: [],
  activeId: null,
  agent: IDLE_AGENT,
  workspaces: [],
  spaceOwners: {},
  documents: [],
}
const rootKey = (root: string) => root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
/** Workspace locations can be drive letters, network shares, or Unix roots in fixtures. */
const workspaceDrive = (root: string) => {
  const path = root.replaceAll('\\', '/')
  const drive = /^[a-z]:/i.exec(path)?.[0]
  if (drive) return drive.toUpperCase()
  const share = /^\/\/[^/]+\/[^/]+/.exec(path)?.[0]
  return share ?? (path.startsWith('/') ? '/' : '')
}
export function SharedSpacesView({
  visible,
  sessions,
  onClose,
  navigationRef,
  workspaces,
  focusedRoot,
  currentRoot = null,
}: {
  visible: boolean
  sessions: Session[]
  onClose: () => void
  navigationRef: Ref<SpacesNavigation>
  workspaces: { id: string; name: string }[]
  focusedRoot: string | null
  currentRoot?: string | null
}) {
  const workspaceId = useId()
  const [driveFilter, setDriveFilter] = useState<string | null>(null)
  const [area, setArea] = useState<Area>('handoffs')
  const [allData, setData] = useState(empty)
  const [allMemory, setMemory] = useState<MemorySnapshot | null>(null)
  const [chosenRoot, setChosenRoot] = useState('')
  const [unassignedFor, setUnassignedFor] = useState<string | null>(null)
  const unassigned = focusedRoot ? unassignedFor === focusedRoot : chosenRoot === '@unassigned'
  const root = unassigned ? '' : (focusedRoot ?? chosenRoot)
  const workspace = useMemo(
    () =>
      allData.workspaces.find((w) =>
        [w.root, ...(w.aliases ?? [])].some((path) => rootKey(path) === rootKey(root || '.')),
      ),
    [allData.workspaces, root],
  )
  const workspaceReady = workspace?.ready ?? false
  const workspaceSessions = sessions.filter(
    (s) =>
      workspace &&
      [workspace.root, ...(workspace.aliases ?? [])].some(
        (path) => rootKey(path) === rootKey(s.cwd),
      ),
  )
  const spaceIds =
    allMemory?.spaces
      .filter((s) =>
        unassigned
          ? !allData.spaceOwners[s.id]
          : workspace && allData.spaceOwners[s.id] === workspace.id,
      )
      .map((s) => s.id) ?? []
  const data = {
    ...allData,
    ideas: allData.ideas.filter((i) =>
      unassigned ? !i.workspaceId : workspace && i.workspaceId === workspace.id,
    ),
  }
  const memory = allMemory ? scopeMemory(allMemory, spaceIds) : null
  const viewKey = unassigned ? '@unassigned' : (workspace?.id ?? root)
  const choices = [
    ...new Map(
      [
        ...workspaces.filter(
          (candidate) =>
            !allData.workspaces.some((w) =>
              [w.root, ...(w.aliases ?? [])].some(
                (path) => rootKey(path) === rootKey(candidate.id),
              ),
            ),
        ),
        ...allData.workspaces.map((w) => ({ id: w.root, name: w.name })),
      ].map((w) => [rootKey(w.id), w]),
    ).values(),
  ]
  const drives = [
    ...new Set(choices.map((choice) => workspaceDrive(choice.id)).filter(Boolean)),
  ].sort()
  const preferredDrive = workspaceDrive(root || currentRoot || choices[0]?.id || '')
  const chosenDrive = driveFilter ?? preferredDrive
  const drive =
    chosenDrive === '*' || drives.includes(chosenDrive) ? chosenDrive : (drives[0] ?? '*')
  const listedChoices = choices.filter(
    (choice) => drive === '*' || workspaceDrive(choice.id) === drive,
  )
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [migrationWorkspace, setMigrationWorkspace] = useState('')
  const [ideaIds, setIdeaIds] = useState<string[]>([])
  const [legacySpaceIds, setLegacySpaceIds] = useState<string[]>([])
  const [migration, setMigration] = useState<MigrationPreview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [captureDrafts, setCaptureDrafts] = useState<Record<string, string>>({})
  const text = captureDrafts[viewKey] ?? ''
  const setText = (value: string) => setCaptureDrafts((old) => ({ ...old, [viewKey]: value }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const captureIds = useRef<Record<string, string>>({})
  const editorDrafts = useRef(new Map<string, SpaceIdea>())
  const messageDrafts = useRef(new Map<string, string>())
  const handoffs = useRef<SpacesNavigation & { openTask: (id: string) => void }>(null)
  const idea = data.ideas.find((i) => i.id === selected)
  const request = useCallback(async (input: SpacesInput) => {
    setError('')
    setBusy(true)
    try {
      const result = await window.threadlight.spacesRequest(input)
      if (result.ok) setData(result.snapshot)
      else setError(result.reason)
      return result
    } catch {
      const result = {
        ok: false as const,
        reason: 'Could not reach Shared Spaces. Your input is still here.',
      }
      setError(result.reason)
      return result
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!window.threadlight.spacesRequest) return
    let live = true
    void window.threadlight
      .spacesRequest({ action: 'list' })
      .then((r) => {
        if (live) {
          if (r.ok) setData(r.snapshot)
          else setError(r.reason)
        }
      })
      .catch(() => {
        if (live) setError('Shared Spaces could not load.')
      })
    void window.threadlight.memoryRequest({ action: 'snapshot' }).then((r) => {
      if (live && r.ok && r.snapshot) setMemory(r.snapshot)
    })
    const stop = window.threadlight.onSpaces(setData),
      stopMemory = window.threadlight.onMemory(setMemory)
    return () => {
      live = false
      stop()
      stopMemory()
    }
  }, [])
  const back = useCallback(() => {
    if (migrationOpen) {
      setMigrationOpen(false)
      return
    }
    if (!unassigned && !workspaceReady) {
      onClose()
      return
    }
    if (area === 'handoffs') handoffs.current?.back()
    else if (selected) setSelected(null)
    else onClose()
  }, [area, selected, onClose, migrationOpen, unassigned, workspaceReady])
  useImperativeHandle(navigationRef, () => ({ back }), [back])
  useEffect(() => {
    if (!visible || (area === 'handoffs' && !migrationOpen && (unassigned || workspaceReady)))
      return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        back()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [visible, area, back, migrationOpen, unassigned, workspaceReady])
  const move = async (item: SpaceIdea) => {
    const result = await request({
      action: 'save',
      id: item.id,
      revision: item.revision,
      title: item.title,
      text: item.text,
      stage: 'brainstorm',
      plan: item.plan,
      assignments: item.assignments,
    })
    if (result.ok) {
      setSelected(item.id)
      setArea('brainstorm')
    }
  }
  return (
    <section
      className={styles.view}
      hidden={!visible}
      aria-label="Shared Spaces"
      data-setup={!migrationOpen && !unassigned && !workspaceReady ? '' : undefined}
    >
      <div className={styles.workspace}>
        <div className={styles.workspaceHeading}>
          <label htmlFor={focusedRoot ? undefined : workspaceId}>Workspace</label>
          <span aria-hidden="true">·</span>
          {focusedRoot ? (
            <span>{workspaceDrive(focusedRoot)}</span>
          ) : (
            <select
              className={styles.drive}
              aria-label="Shared Spaces drive"
              title="Filter workspaces already known to Threadlight by drive"
              value={drive}
              onChange={(event) => {
                const next = event.target.value
                setDriveFilter(next)
                if (next !== '*' && workspaceDrive(root) !== next) {
                  setChosenRoot('')
                  setUnassignedFor(null)
                  setSelected(null)
                  setError('')
                  setMigrationOpen(false)
                }
              }}
            >
              {drives.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
              <option value="*">All drives</option>
            </select>
          )}
        </div>
        {focusedRoot ? (
          <strong>
            {unassigned
              ? 'Unassigned'
              : (workspace?.name ??
                choices.find((w) => rootKey(w.id) === rootKey(focusedRoot))?.name ??
                focusedRoot)}
          </strong>
        ) : (
          <>
            <select
              id={workspaceId}
              aria-label="Shared Spaces workspace"
              value={unassigned ? '@unassigned' : (workspace?.root ?? root)}
              onChange={(e) => {
                setChosenRoot(e.target.value)
                setUnassignedFor(e.target.value === '@unassigned' ? focusedRoot : null)
                setSelected(null)
                setError('')
                setMigrationOpen(false)
              }}
            >
              <option value="">Choose a workspace…</option>
              {listedChoices.map((w) => (
                <option value={w.id} key={rootKey(w.id)} title={w.id}>
                  {w.name}
                </option>
              ))}
              <option value="@unassigned">Unassigned</option>
            </select>
          </>
        )}
        {focusedRoot && (
          <button
            onClick={() => {
              setUnassignedFor(unassigned ? null : focusedRoot)
              setSelected(null)
              setMigrationOpen(false)
            }}
          >
            {unassigned ? 'Return to workspace' : 'Unassigned material'}
          </button>
        )}
        {root && (
          <p className={styles.path}>
            {(workspace?.root ?? root).replaceAll('\\', '/')}/shared-spaces/
          </p>
        )}
        {(allData.ideas.some((i) => !i.workspaceId) ||
          allMemory?.spaces.some((s) => !allData.spaceOwners[s.id])) && (
          <button
            onClick={() => {
              setMigrationOpen(true)
              setMigrationWorkspace(workspace?.id ?? '')
              setMigration(null)
              setIdeaIds([])
              setLegacySpaceIds([])
            }}
          >
            Assign existing material
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {migrationOpen ? (
        <div className={styles.body}>
          <div className={styles.editor}>
            <h3>Assign existing material</h3>
            <p className={styles.hint}>
              Original records and conversation links are retained. Review the destination files
              before migration. Nothing is overwritten.
            </p>
            <label>
              Destination workspace
              <select
                aria-label="Migration workspace"
                value={migrationWorkspace}
                onChange={(e) => {
                  setMigrationWorkspace(e.target.value)
                  setMigration(null)
                }}
              >
                <option value="">Choose a configured workspace…</option>
                {allData.workspaces
                  .filter((w) => w.ready)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            {migrationWorkspace && (
              <p className={styles.path}>
                {allData.workspaces
                  .find((w) => w.id === migrationWorkspace)
                  ?.root.replaceAll('\\', '/')}
                /shared-spaces/
              </p>
            )}
            {allData.ideas
              .filter((i) => !i.workspaceId)
              .map((i) => (
                <label key={i.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={ideaIds.includes(i.id)}
                    onChange={(e) => {
                      setIdeaIds((old) =>
                        e.target.checked ? [...old, i.id] : old.filter((id) => id !== i.id),
                      )
                      setMigration(null)
                    }}
                  />
                  Idea: {i.title}
                </label>
              ))}
            {allMemory?.spaces
              .filter((s) => !allData.spaceOwners[s.id])
              .map((s) => (
                <label key={s.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={legacySpaceIds.includes(s.id)}
                    onChange={(e) => {
                      setLegacySpaceIds((old) =>
                        e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id),
                      )
                      setMigration(null)
                    }}
                  />
                  Shared material: {s.title}
                </label>
              ))}
            <button
              disabled={busy || !migrationWorkspace || (!ideaIds.length && !legacySpaceIds.length)}
              onClick={async () => {
                const result = await request({
                  action: 'migration_preview',
                  workspaceId: migrationWorkspace,
                  ideaIds,
                  spaceIds: legacySpaceIds,
                })
                if (result.ok) setMigration(result.migration ?? null)
              }}
            >
              Preview migration
            </button>
            {migration && (
              <>
                <p>
                  {migration.files.length} document{' '}
                  {migration.files.length === 1 ? 'snapshot' : 'snapshots'}
                </p>
                <details>
                  <summary>Destination files</summary>
                  {migration.files.map((file) => (
                    <p className={styles.path} key={file}>
                      {file}
                    </p>
                  ))}
                </details>
                {migration.conflicts.map((conflict) => (
                  <p role="alert" className={styles.error} key={conflict}>
                    {conflict}
                  </p>
                ))}
                <button
                  disabled={busy || !!migration.conflicts.length}
                  onClick={async () => {
                    const result = await request({
                      action: 'migrate',
                      workspaceId: migrationWorkspace,
                      ideaIds,
                      spaceIds: legacySpaceIds,
                      token: migration.token,
                    })
                    if (result.ok) {
                      setMigrationOpen(false)
                      setMigration(null)
                    }
                  }}
                >
                  Confirm migration
                </button>
              </>
            )}
          </div>
        </div>
      ) : !unassigned && !workspace?.ready ? (
        <div className={styles.body}>
          <div className={styles.editor}>
            <h3>
              {root ? 'Set up Shared Spaces for this project' : 'Keep shared work with its project'}
            </h3>
            <p className={styles.hint}>
              {root
                ? 'Create folders for this project’s ideas, plans, handoffs and results. Your agents use them to share context and hand work to one another. Existing files are kept.'
                : 'Choose the project whose ideas, plans, handoffs and results you want to use. Shared Spaces keeps its shared files together in that project’s shared-spaces folder.'}
            </p>
            {!root && (
              <p className={styles.hint}>
                The list shows workspaces already known to Threadlight. Choose a drive above to
                filter it. Older material stays available under Unassigned.
              </p>
            )}
            {workspace?.issue && (
              <p className={styles.error} role="alert">
                {workspace.issue}
              </p>
            )}
            {root && (
              <>
                <p className={styles.path}>
                  ideas/
                  <br />
                  plans/
                  <br />
                  handoffs/
                  <br />
                  results/
                </p>
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void request({ action: 'setup', root })}
                >
                  {busy ? 'Setting up…' : 'Create Shared Spaces'}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.tabs} role="tablist" aria-label="Shared Spaces areas">
            {(['handoffs', 'ideas', 'brainstorm'] as const).map((tab) => (
              <button
                key={tab}
                id={`spaces-${tab}`}
                type="button"
                role="tab"
                aria-selected={area === tab}
                aria-controls={`spaces-${tab}-panel`}
                onClick={() => {
                  setArea(tab)
                  setSelected(null)
                  setError('')
                }}
                onDragOver={(e) => {
                  if (tab === 'brainstorm') e.preventDefault()
                }}
                onDrop={(e) => {
                  if (tab !== 'brainstorm' || busy) return
                  e.preventDefault()
                  const item = data.ideas.find(
                    (i) => i.id === e.dataTransfer.getData('application/x-threadlight-idea'),
                  )
                  if (item) void move(item)
                }}
              >
                {tab === 'handoffs' ? 'Handoffs' : tab === 'ideas' ? 'Ideas' : 'Brainstorm'}
              </button>
            ))}
          </div>
          {unassigned && (
            <p className={styles.hint}>
              Unassigned material is preserved. Assign it to a configured workspace before starting
              Agent work.
            </p>
          )}
          <div
            id="spaces-handoffs-panel"
            role="tabpanel"
            aria-labelledby="spaces-handoffs"
            hidden={area !== 'handoffs'}
            className={styles.handoffs}
          >
            <MemoryView
              key={viewKey}
              spaceIds={spaceIds}
              visible={visible && area === 'handoffs'}
              sessions={workspaceSessions}
              onClose={onClose}
              navigationRef={handoffs}
            />
          </div>
          <div
            className={styles.body}
            id={`spaces-${area === 'handoffs' ? 'inactive' : area}-panel`}
            role="tabpanel"
            aria-labelledby={`spaces-${area}`}
            hidden={area === 'handoffs'}
          >
            {idea ? (
              <IdeaEditor
                key={idea.id}
                idea={idea}
                data={data}
                memory={memory}
                sessions={workspaceSessions}
                busy={busy}
                request={request}
                draftCache={editorDrafts}
                messageCache={messageDrafts}
                onMove={() => void move(idea)}
                onTask={(id) => {
                  handoffs.current?.openTask(id)
                  setArea('handoffs')
                  setSelected(null)
                }}
              />
            ) : (
              <>
                {area === 'ideas' ? (
                  <form
                    className={styles.compose}
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!text.trim() || busy) return
                      const result = await request({
                        action: 'create',
                        id: (captureIds.current[viewKey] ??= crypto.randomUUID()),
                        workspaceId: workspace?.id ?? null,
                        title: (text.trim().split('\n')[0] ?? text.trim()).slice(0, 80),
                        text: text.trim(),
                      })
                      if (result.ok) {
                        setText('')
                        captureIds.current[viewKey] = crypto.randomUUID()
                      }
                    }}
                  >
                    <p>Capture a thought. Move it to Brainstorm when you’re ready to develop it.</p>
                    <textarea
                      aria-label="New idea"
                      placeholder="Leave a thought for later…"
                      value={text}
                      maxLength={8000}
                      onChange={(e) => setText(e.target.value)}
                    />
                    <button className={styles.primary} disabled={busy || !text.trim()}>
                      Save idea
                    </button>
                  </form>
                ) : (
                  <p className={styles.hint}>
                    Develop an idea with your Agent, then review the plan and choose who does what.
                  </p>
                )}
                {data.ideas
                  .filter((i) => i.stage === (area === 'ideas' ? 'idea' : 'brainstorm'))
                  .map((item) => (
                    <article
                      className={styles.row}
                      key={item.id}
                      draggable={item.stage === 'idea'}
                      onDragStart={(e) =>
                        e.dataTransfer.setData('application/x-threadlight-idea', item.id)
                      }
                    >
                      <button className={styles.open} onClick={() => setSelected(item.id)}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.prepared
                            ? 'Assignments prepared · follow in Handoffs'
                            : item.stage === 'idea'
                              ? 'Saved idea'
                              : 'Plan and discussion'}
                        </span>
                      </button>
                      {item.stage === 'idea' && (
                        <button disabled={busy} onClick={() => void move(item)}>
                          Move to Brainstorm
                        </button>
                      )}
                    </article>
                  ))}
                {!data.ideas.some(
                  (i) => i.stage === (area === 'ideas' ? 'idea' : 'brainstorm'),
                ) && (
                  <p className={styles.hint}>
                    {area === 'ideas'
                      ? 'Your saved ideas will appear here. Capturing an idea does not call an Agent.'
                      : 'Move an idea here from Ideas to start a discussion.'}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function IdeaEditor({
  idea,
  data,
  memory,
  sessions,
  busy,
  request,
  onMove,
  onTask,
  draftCache,
  messageCache,
}: {
  idea: SpaceIdea
  data: SpacesSnapshot
  memory: MemorySnapshot | null
  sessions: Session[]
  busy: boolean
  request: (input: SpacesInput) => Promise<import('../../shared/spaces').SpacesReply>
  onMove: () => void
  onTask: (id: string) => void
  draftCache: React.RefObject<Map<string, SpaceIdea>>
  messageCache: React.RefObject<Map<string, string>>
}) {
  const [localDraft, updateDraft] = useState(() => draftCache.current.get(idea.id) ?? idea)
  const setDraft = (value: SpaceIdea) => {
    draftCache.current.set(idea.id, value)
    updateDraft(value)
  }
  const [message, updateMessage] = useState(() => messageCache.current.get(idea.id) ?? '')
  const setMessage = (value: string) => {
    messageCache.current.set(idea.id, value)
    updateMessage(value)
  }
  const [history, setHistory] = useState<AgentItem[]>([])
  const [historyError, setHistoryError] = useState('')
  const [folderId, setFolderId] = useState(idea.prepared?.folderId ?? '')
  const settings = useSettings()
  const active = data.activeId === idea.id
  const agent = data.agent
  const items = active ? agent.items : history
  const frozen = !!idea.prepared
  const dirty =
    localDraft.title !== idea.title ||
    localDraft.text !== idea.text ||
    localDraft.plan !== idea.plan ||
    JSON.stringify(localDraft.assignments) !== JSON.stringify(idea.assignments)
  // Stage changes and migration advance the revision without editing these fields.
  const draft = dirty ? localDraft : idea
  useEffect(() => {
    let live = true
    void window.threadlight
      .spacesRequest({ action: 'read', id: idea.id })
      .then((r) => {
        if (live) {
          if (r.ok) setHistory(r.items ?? [])
          else setHistoryError(r.reason)
        }
      })
      .catch(() => {
        if (live) setHistoryError('Could not load this discussion.')
      })
    return () => {
      live = false
    }
  }, [idea.id, idea.conversationId, active])
  const save = async () => {
    const result = await request({
      action: 'save',
      id: idea.id,
      revision: draft.revision,
      title: draft.title,
      text: draft.text,
      stage: idea.stage,
      plan: draft.plan,
      assignments: draft.assignments,
    })
    if (result.ok) setDraft(result.snapshot.ideas.find((i) => i.id === idea.id)!)
  }
  const latest = [...items].reverse().find((i) => i.kind === 'agent')
  const provider = active
    ? agent.provider
    : idea.conversationId
      ? idea.conversationId.startsWith('codex:')
        ? 'codex'
        : 'claude'
      : settings?.agentProvider
  return (
    <div className={styles.editor}>
      <h3>{idea.title}</h3>
      <label>
        Title
        <input
          value={draft.title}
          maxLength={80}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        Original idea
        <textarea
          value={draft.text}
          maxLength={8000}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
      </label>
      {idea.stage === 'idea' ? (
        <div className={styles.actions}>
          <button disabled={busy || !dirty} onClick={() => void save()}>
            Save changes
          </button>
          <button disabled={busy || dirty} onClick={onMove}>
            Move to Brainstorm
          </button>
        </div>
      ) : (
        <>
          <p className={styles.hint}>
            Agent · {provider === 'codex' ? 'Codex' : 'Claude'} ·{' '}
            {active
              ? (agent.model ?? 'Runtime default')
              : idea.conversationId
                ? 'Resumes its original model'
                : 'Configured in Agent settings'}
          </p>
          <div className={styles.messages} aria-label="Brainstorm conversation">
            {items.map((item, n) => (
              <div className={styles.message} key={item.id ?? n} data-kind={item.kind}>
                <strong>
                  {item.kind === 'you' ? 'You' : item.kind === 'agent' ? 'Agent' : 'Activity'}
                </strong>
                <p>
                  {item.kind === 'you' ? item.text.split('\n\nUser message:\n').at(-1) : item.text}
                </p>
              </div>
            ))}
            {!items.length && (
              <p className={styles.hint}>
                Ask your Agent to explore the smallest useful version of this idea.
              </p>
            )}
            {active && agentBusy(agent) && (
              <p role="status">{agent.progress ?? 'Agent is working…'}</p>
            )}
            {active && (agent.error || historyError) && (
              <p role="alert" className={styles.error}>
                {agent.error || historyError}
              </p>
            )}
            {!active && historyError && (
              <p role="alert" className={styles.error}>
                {historyError}
              </p>
            )}
            {idea.conversationId &&
              !agentBusy(agent) &&
              (historyError || (active && agent.error)) && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    const result = await request({ action: 'resume', id: idea.id })
                    if (result.ok) setHistoryError('')
                  }}
                >
                  Reconnect discussion
                </button>
              )}
            {active &&
              agent.requests.map((r) => (
                <AgentRequestCard
                  key={r.id}
                  request={r}
                  count={agent.requests.length}
                  onRespond={(id, response) =>
                    window.threadlight.spacesRespond(idea.id, id, response)
                  }
                />
              ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (busy || dirty || agentBusy(agent) || !message.trim()) return
              const r = await request({ action: 'chat', id: idea.id, text: message })
              if (r.ok) setMessage('')
            }}
          >
            <textarea
              aria-label="Message to Agent"
              value={message}
              maxLength={8000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Think it through with your Agent…"
            />
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={busy || dirty || agentBusy(agent) || !message.trim() || !idea.workspaceId}
              >
                Discuss with Agent
              </button>
              {active && agentBusy(agent) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void request({ action: 'stop', id: idea.id })}
                >
                  Stop brainstorm
                </button>
              )}
            </div>
            {!active && agentBusy(agent) && (
              <p className={styles.hint}>
                Another brainstorm is running. Finish or stop it before starting this one.
              </p>
            )}
          </form>
          <label>
            Mini plan
            <textarea
              value={draft.plan}
              maxLength={16000}
              disabled={frozen}
              placeholder="Outcome, scope, constraints and acceptance criteria…"
              onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
            />
          </label>
          {latest && (
            <button
              disabled={frozen}
              onClick={() => setDraft({ ...draft, plan: latest.text.slice(0, 16000) })}
            >
              Use latest reply as draft plan
            </button>
          )}
          <h3>Who does what</h3>
          <p className={styles.hint}>
            Choose each task and its destination chat. Assignments use that chat’s model. Preparing
            saves drafts; review and send each one in Handoffs. Dependent tasks should be sent after
            their inputs are ready.
          </p>
          <p className={styles.hint}>
            Missing chats? Enable their provider in Applications and open the workspace in the
            thread view.
          </p>
          {draft.assignments.map((a, index) => (
            <fieldset key={a.id} disabled={frozen || busy}>
              <legend>Assignment {index + 1}</legend>
              <label>
                Task
                <input
                  maxLength={80}
                  value={a.title}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      assignments: draft.assignments.map((v) =>
                        v.id === a.id ? { ...v, title: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Provider
                <select
                  aria-label="Provider"
                  value={a.provider}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      assignments: draft.assignments.map((v) =>
                        v.id === a.id
                          ? { ...v, provider: e.target.value as 'claude' | 'codex', assignee: '' }
                          : v,
                      ),
                    })
                  }
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
              </label>
              <label>
                Destination chat
                <select
                  aria-label="Destination chat"
                  value={a.assignee}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      assignments: draft.assignments.map((v) =>
                        v.id === a.id ? { ...v, assignee: e.target.value } : v,
                      ),
                    })
                  }
                >
                  <option value="">Choose a chat…</option>
                  {a.assignee && !sessions.some((s) => s.id === a.assignee) && (
                    <option value={a.assignee}>Unavailable chat</option>
                  )}
                  {sessions
                    .filter((s) => (s.provider ?? 'claude') === a.provider)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                        {s.model ? ` · ${s.model}` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Brief and acceptance criteria
                <textarea
                  maxLength={8000}
                  value={a.brief}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      assignments: draft.assignments.map((v) =>
                        v.id === a.id ? { ...v, brief: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    assignments: draft.assignments.filter((v) => v.id !== a.id),
                  })
                }
              >
                Remove assignment
              </button>
            </fieldset>
          ))}
          <div className={styles.actions}>
            <button
              disabled={frozen || busy || draft.assignments.length >= 12}
              onClick={() =>
                setDraft({
                  ...draft,
                  assignments: [
                    ...draft.assignments,
                    {
                      id: crypto.randomUUID(),
                      provider: 'claude',
                      assignee: '',
                      title: 'Implementation',
                      brief: 'Implement the agreed scope and record validation results.',
                    },
                  ],
                })
              }
            >
              Add assignment
            </button>
            <button disabled={frozen || busy || !dirty} onClick={() => void save()}>
              Save plan and choices
            </button>
          </div>
          {dirty && (
            <p className={styles.hint}>
              Save your changes before discussing or preparing assignments.
            </p>
          )}
          <label>
            Shared destination
            <select
              value={folderId}
              disabled={frozen}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">Choose an output folder…</option>
              {memory?.folders
                .filter((f) => !f.archived && !f.redirectId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {memory.spaces.find((s) => s.id === f.spaceId)?.title} / {f.title}
                  </option>
                ))}
            </select>
          </label>
          {!memory?.folders.some((f) => !f.archived) && (
            <p className={styles.hint}>Create a shared space and folder in Handoffs first.</p>
          )}
          {idea.prepared?.taskIds.length ? (
            <>
              <p className={styles.hint}>
                This plan is frozen with its prepared assignments. Review delivery and results in
                Handoffs.
              </p>
              {idea.prepared.taskIds.map((id, n) => (
                <button className={styles.task} key={id} onClick={() => onTask(id)}>
                  {idea.assignments[n]?.title} ·{' '}
                  {memory?.tasks.find((t) => t.id === id)?.state ?? 'Saved assignment'}
                </button>
              ))}
            </>
          ) : (
            <button
              className={styles.primary}
              disabled={
                busy ||
                dirty ||
                !folderId ||
                !idea.plan.trim() ||
                !idea.assignments.length ||
                idea.assignments.some((a) => !a.assignee)
              }
              onClick={() =>
                void request({ action: 'prepare', id: idea.id, revision: idea.revision, folderId })
              }
            >
              {idea.prepared ? 'Finish preparing assignments' : 'Prepare assignments for review'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
