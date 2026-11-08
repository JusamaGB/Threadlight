import { SaverAttribution } from './SaverAttribution'
import { savedBy } from '../../shared/memory'
import { noteTitle } from '../../shared/noteTitle'
import { NoteRow } from './NoteRow'
import type { AppliedRoute } from '../../shared/appControl'
import { BrainstormContext, SourceLinks } from './BrainstormContext'
import { BrainstormChat, type BrainstormNavigation } from './BrainstormChat'
import { BrainstormAgent } from './brainstormAgent'
import { ComposerInput } from '../composer/ComposerInput'
import { AnswerComposer } from '../composer/AnswerComposer'
import { recalledDraft, rememberDraft, recalledProject, rememberProject } from './brainstormStorage'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import type { NavigationDirection } from '../../shared/navigationHistory'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from 'react'
import { IDLE_AGENT, agentBusy, type AgentItem } from '../../shared/agent'
import type { SpaceIdea, SpacesInput, SpacesSnapshot, MigrationPreview } from '../../shared/spaces'
import type { MemorySnapshot } from '../../shared/memory'
import { scopeMemory } from '../../shared/memory'
import { workspaceFolder } from '../../shared/providers'
import type { Session } from '../../shared/types'
import { MemoryView } from '../memory/MemoryView'
import { CommunicationView } from '../communication/CommunicationView'
import { ConnectionSetup } from './ConnectionSetup'
import { ProjectParticipants } from './ProjectParticipants'
import { projectParticipants, suggestParticipants } from '../../shared/projectParticipants'
import { AgentRequestCard } from '../panel/AgentRequestCard'
import { useSettings } from '../hooks/useSettings'
import { WorkspacePicker } from '../panel/WorkspacePicker'
import { workspacePath } from '../lib/workspaceExplorer'
import styles from './SharedSpacesView.module.css'

import type { AgentClient } from '../lib/agentClient'

export interface SpacesNavigation {
  openControl?: (area: 'library' | 'create' | 'space', id?: string) => boolean
  revealVoice?: (client: AgentClient) => void
  brainstormVoice?: () => BrainstormAgent | null
  back: () => void
  navigate?: (direction: NavigationDirection) => boolean
}
export interface SpacesHeader {
  title: string
  canvas?: boolean
  voiceClient?: AgentClient
}
type Area = 'handoffs' | 'notes' | 'brainstorm' | 'workflow' | 'participants'
const empty: SpacesSnapshot = {
  ideas: [],
  activeId: null,
  agent: IDLE_AGENT,
  workspaces: [],
  spaceOwners: {},
  documents: [],
}
type DraftView = {
  scroll: number
  fields: { name: string; start: number | null; end: number | null }[]
}
const rootKey = workspaceFolder
export function SharedSpacesView({
  visible,
  sessions,
  onClose,
  navigationRef,
  workspaces,
  focusedRoot,
  currentRoot = null,
  onControlRoute,
  onHeaderChange,
  onVoiceToggle,
  voiceActive,
}: {
  visible: boolean
  sessions: Session[]
  onClose: () => void
  navigationRef: Ref<SpacesNavigation>
  workspaces: { id: string; name: string }[]
  focusedRoot: string | null
  currentRoot?: string | null
  onControlRoute?: (route: Extract<AppliedRoute, { page: 'spaces' }>) => void
  onHeaderChange?: (header: SpacesHeader | null) => void
  onVoiceToggle: (client: BrainstormAgent) => void
  voiceActive: boolean
}) {
  const [area, setArea] = useState<Area>('brainstorm')
  const [setupOpen, setSetupOpen] = useState(false)
  const [reviewRequest, setReviewRequest] = useState('')
  const [openedSpace, setOpenedSpace] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const settings = useSettings()
  const ignoreChoiceEnabled = settings?.sharedSpacesGitignore ?? false
  const [addToGitignore, setAddToGitignore] = useState(false)
  const creationAttempt = useRef<Extract<SpacesInput, { action: 'create_space' }> | null>(null)
  useEffect(() => {
    creationAttempt.current = null
  }, [ignoreChoiceEnabled])
  const setupNavigation = useRef<{ back: () => void }>(null)
  const [allData, setSnapshotData] = useState(empty)
  const [loadError, setLoadError] = useState('')
  const snapshotGeneration = useRef(0)
  const setData = useCallback((snapshot: SpacesSnapshot) => {
    snapshotGeneration.current++
    setSnapshotData(snapshot)
    setLoadError('')
  }, [])
  const [allMemory, setMemory] = useState<MemorySnapshot | null>(null)
  const [chosenRoot, setChosenRoot] = useState('')
  const [pickingRoot, setPickingRoot] = useState(false)
  const workspaceChoice = useRef<HTMLButtonElement>(null)
  const wasPickingRoot = useRef(false)
  useEffect(() => {
    if (wasPickingRoot.current && !pickingRoot) workspaceChoice.current?.focus()
    wasPickingRoot.current = pickingRoot
  }, [pickingRoot])
  const ownerId = openedSpace ? allData.spaceOwners[openedSpace] : null
  const unassigned = !!openedSpace && !ownerId
  const root = creating
    ? chosenRoot
    : (allData.workspaces.find((w) => w.id === ownerId)?.root ?? '')
  const openedLocation = allData.locations?.find((l) => l.spaceId === openedSpace)
  const openedTitle = allMemory?.spaces.find((s) => s.id === openedSpace)?.title
  const workspace = useMemo(
    () =>
      allData.workspaces.find((w) =>
        [w.root, ...(w.aliases ?? [])].some((path) => rootKey(path) === rootKey(root || '.')),
      ),
    [allData.workspaces, root],
  )
  const workspaceReady = openedLocation
    ? openedLocation.ready === true
    : (workspace?.ready ?? false)
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
        openedSpace
          ? s.id === openedSpace
          : unassigned
            ? !allData.spaceOwners[s.id]
            : workspace && allData.spaceOwners[s.id] === workspace.id,
      )
      .map((s) => s.id) ?? []
  const data = {
    ...allData,
    ideas: allData.ideas.filter((i) =>
      openedLocation
        ? i.sharedSpaceId === openedSpace
        : unassigned
          ? !i.workspaceId
          : workspace &&
            i.workspaceId === workspace.id &&
            (!i.sharedSpaceId || i.sharedSpaceId === openedSpace),
    ),
  }
  const memory = allMemory ? scopeMemory(allMemory, spaceIds) : null
  const viewKey = openedSpace ?? workspace?.id ?? root
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
  const noteSaving = useRef(false)
  const [noteVoiceActive, setNoteVoiceActive] = useState(false)
  const draftViews = useRef(new Map<string, DraftView>())
  const editorDrafts = useRef(new Map<string, SpaceIdea>())
  const messageDrafts = useRef(new Map<string, string>())
  const handoffs = useRef<SpacesNavigation & { openTask: (id: string) => void }>(null)
  const brainstormNavigation = useRef<BrainstormNavigation>(null)
  const clients = useRef(new Map<string, BrainstormAgent>())
  const [brainstormClient, setBrainstormClient] = useState<BrainstormAgent | null>(null)
  const lastOpenedSpace = useRef<string | null>(recalledProject())
  useLayoutEffect(() => {
    if (openedSpace) {
      lastOpenedSpace.current = openedSpace
      rememberProject(openedSpace)
    }
  }, [openedSpace])
  const location = useNavigationHistory(
    { area, selected, chosenRoot, pickingRoot, migrationOpen, setupOpen, openedSpace, creating },
    (route) => {
      setArea(route.area)
      setSelected(route.selected)
      setChosenRoot(route.chosenRoot)
      setPickingRoot(route.pickingRoot)
      setMigrationOpen(route.migrationOpen)
      setSetupOpen(route.setupOpen)
      setOpenedSpace(route.openedSpace)
      setCreating(route.creating)
    },
    visible,
  )
  const navigateHistory = useCallback(
    (direction: NavigationDirection) => {
      if (
        !creating &&
        !setupOpen &&
        area === 'handoffs' &&
        !migrationOpen &&
        handoffs.current?.navigate?.(direction)
      )
        return true
      return location.navigate(direction)
    },
    [area, creating, migrationOpen, setupOpen, location],
  )
  const discussions = (allData.discussions ?? []).filter(
    (d) =>
      d.sharedSpaceId === openedSpace ||
      (!openedLocation && !d.sharedSpaceId && d.workspaceId === workspace?.id),
  )
  const records = area === 'brainstorm' ? discussions : data.ideas
  const idea = records.find((i) => i.id === selected)
  const request = useCallback(
    async (input: SpacesInput) => {
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
    },
    [setData],
  )
  async function saveNote() {
    if (!text.trim() || busy || noteVoiceActive || noteSaving.current) return
    noteSaving.current = true
    try {
      const result = await request({
        action: 'create',
        id: (captureIds.current[viewKey] ??= crypto.randomUUID()),
        workspaceId: workspace?.id ?? null,
        sharedSpaceId: openedSpace,
        title: noteTitle(text),
        text: text.trim(),
      })
      if (result.ok) {
        setCaptureDrafts((old) => ({
          ...old,
          [viewKey]: old[viewKey] === text ? '' : (old[viewKey] ?? ''),
        }))
        captureIds.current[viewKey] = crypto.randomUUID()
      }
    } finally {
      noteSaving.current = false
    }
  }
  async function renameNote(original: SpaceIdea, title: string) {
    const result = await request({
      action: 'save',
      id: original.id,
      revision: original.revision,
      title,
      text: original.text,
      stage: original.stage,
      plan: original.plan,
      assignments: original.assignments,
      workflowSpaceId: original.workflowSpaceId,
    })
    if (result.ok) {
      const saved = result.snapshot.ideas.find((item) => item.id === original.id)
      const draft = editorDrafts.current.get(original.id)
      // Preserve unsaved body/plan edits; only advance a draft based on this revision.
      if (saved && draft?.revision === original.revision)
        editorDrafts.current.set(original.id, { ...draft, title, revision: saved.revision })
    }
    return result.ok
  }
  const getClient = useCallback(
    (spaceId: string) => {
      let client = clients.current.get(spaceId)
      if (!client) {
        client = new BrainstormAgent(
          spaceId,
          allData,
          window.threadlight,
          request,
          messageDrafts.current,
        )
        clients.current.set(spaceId, client)
      }
      return client
    },
    [allData, request],
  )
  useLayoutEffect(() => {
    // Bind a project to a persistent backend adapter before it is shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrainstormClient(openedSpace ? getClient(openedSpace) : null)
  }, [openedSpace, getClient])
  useEffect(() => {
    for (const client of clients.current.values()) client.update(allData)
  }, [allData])
  useEffect(() => {
    if (!window.threadlight.spacesRequest) return
    let live = true
    const stop = window.threadlight.onSpaces(setData)
    const generation = snapshotGeneration.current
    void window.threadlight
      .spacesRequest({ action: 'list' })
      .then((r) => {
        if (live && generation === snapshotGeneration.current) {
          if (r.ok) setData(r.snapshot)
          else setLoadError(r.reason)
        }
      })
      .catch(() => {
        if (live && generation === snapshotGeneration.current)
          setLoadError('Shared Spaces could not load.')
      })
    void window.threadlight.memoryRequest({ action: 'snapshot' }).then((r) => {
      if (live && r.ok && r.snapshot) setMemory(r.snapshot)
    })
    const stopMemory = window.threadlight.onMemory(setMemory)
    return () => {
      live = false
      stop()
      stopMemory()
    }
  }, [setData])
  const back = useCallback(() => {
    if (pickingRoot) {
      setPickingRoot(false)
      return
    }
    if (creating) {
      setCreating(false)
      setError('')
      return
    }
    if (!openedSpace) {
      onClose()
      return
    }
    if (setupOpen && setupNavigation.current) {
      setupNavigation.current.back()
      return
    }
    if (migrationOpen) {
      setMigrationOpen(false)
      return
    }
    if (!unassigned && !workspaceReady) {
      setOpenedSpace(null)
      return
    }
    if (area === 'brainstorm') {
      if (!brainstormNavigation.current?.back()) setOpenedSpace(null)
      return
    }
    if (area === 'handoffs') handoffs.current?.back()
    else if (selected) setSelected(null)
    else setOpenedSpace(null)
  }, [
    area,
    selected,
    onClose,
    migrationOpen,
    unassigned,
    workspaceReady,
    setupOpen,
    openedSpace,
    creating,
    pickingRoot,
  ])
  useImperativeHandle(
    navigationRef,
    () => ({
      back,
      navigate: navigateHistory,
      revealVoice: (target) => {
        const owner = [...clients.current.entries()].find(([, client]) => client === target)
        if (!owner) return
        const [spaceId, client] = owner
        if (openedSpace === spaceId) brainstormNavigation.current?.showCurrent()
        setOpenedSpace(spaceId)
        const discussion =
          allData.voice?.spaceId === spaceId ? allData.voice.discussionId : client.selection
        client.select(discussion ?? null)
        setSelected(discussion ?? null)
        setCreating(false)
        setSetupOpen(false)
        setMigrationOpen(false)
        setPickingRoot(false)
        setArea('brainstorm')
      },
      brainstormVoice: () => {
        const available = (allMemory?.spaces ?? []).filter((s) => allData.spaceOwners[s.id])
        const previous = openedSpace ?? lastOpenedSpace.current
        const matching = available.filter((s) => {
          const workspace = allData.workspaces.find((w) => w.id === allData.spaceOwners[s.id])
          return (
            workspace &&
            [currentRoot, focusedRoot].some(
              (root) => root && rootKey(root) === rootKey(workspace.root),
            )
          )
        })
        const target =
          available.find((s) => s.id === previous)?.id ??
          (matching.length === 1 ? matching[0]!.id : null)
        if (!target) return null
        const location = allData.locations?.find((l) => l.spaceId === target)
        const owner = allData.workspaces.find((w) => w.id === allData.spaceOwners[target])
        if (!(location ? location.ready : owner?.ready)) return null
        setOpenedSpace(target)
        setCreating(false)
        setSetupOpen(false)
        setMigrationOpen(false)
        setPickingRoot(false)
        if (area !== 'brainstorm' || target !== openedSpace) setSelected(null)
        setArea('brainstorm')
        return getClient(target)
      },
      openControl: (target, id) => {
        if (target === 'space' && !allMemory?.spaces.some((s) => s.id === id)) return false
        setCreating(target === 'create')
        if (target === 'create') setAddToGitignore(false)
        setOpenedSpace(target === 'space' ? id! : null)
        setSetupOpen(false)
        setMigrationOpen(false)
        setPickingRoot(false)
        if (target === 'space') {
          setArea('brainstorm')
          setSelected(null)
        }
        return true
      },
    }),
    [
      back,
      navigateHistory,
      allMemory,
      allData,
      getClient,
      area,
      currentRoot,
      focusedRoot,
      openedSpace,
    ],
  )
  useLayoutEffect(() => {
    onControlRoute?.({
      page: 'spaces',
      area: creating ? 'create' : openedSpace ? 'space' : 'library',
      ...(openedSpace ? { spaceId: openedSpace } : {}),
    })
  }, [creating, openedSpace, onControlRoute])
  useLayoutEffect(() => {
    onHeaderChange?.(
      openedSpace && !creating
        ? {
            title: openedTitle ?? 'Project',
            canvas: area === 'handoffs' || area === 'workflow',
            voiceClient:
              area === 'brainstorm' &&
              !setupOpen &&
              !migrationOpen &&
              !pickingRoot &&
              brainstormClient?.spaceId === openedSpace
                ? brainstormClient
                : undefined,
          }
        : null,
    )
  }, [
    creating,
    openedSpace,
    openedTitle,
    onHeaderChange,
    area,
    brainstormClient,
    setupOpen,
    migrationOpen,
    pickingRoot,
  ])
  useEffect(() => {
    if (
      !visible ||
      (openedSpace &&
        !creating &&
        !setupOpen &&
        area === 'handoffs' &&
        !migrationOpen &&
        (unassigned || workspaceReady))
    )
      return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.target instanceof Element && e.target.closest('[data-note-rename], [role="menu"]'))
          return
        if (
          pickingRoot &&
          e.target instanceof HTMLInputElement &&
          e.target.type === 'search' &&
          e.target.value
        )
          return
        e.preventDefault()
        e.stopImmediatePropagation()
        back()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [
    visible,
    area,
    back,
    migrationOpen,
    unassigned,
    workspaceReady,
    setupOpen,
    openedSpace,
    creating,
    pickingRoot,
  ])
  const startDiscussion = async (note?: SpaceIdea) => {
    if (!openedSpace || !workspaceReady) return
    if (note && !note.sharedSpaceId) {
      const attached = await request({
        action: 'attach_material',
        id: note.id,
        spaceId: openedSpace,
        revision: note.revision,
      })
      if (!attached.ok) return
    }
    const result = await request({
      action: 'create_discussion',
      id: crypto.randomUUID(),
      spaceId: openedSpace,
      title: note?.title ?? 'Space discussion',
      noteIds: note ? [note.id] : [],
    })
    if (result.ok) {
      setSelected(result.discussionId ?? null)
      setArea('brainstorm')
    }
  }
  const move = (item: SpaceIdea) => startDiscussion(item)

  if (creating && pickingRoot)
    return (
      <section
        className={styles.view}
        hidden={!visible}
        aria-label="Shared Spaces"
        data-setup=""
        data-workspace-picker=""
      >
        <WorkspacePicker
          selectionOnly
          workspaces={choices}
          chosen={chosenRoot || null}
          onPick={(id) => {
            setChosenRoot(id)
            creationAttempt.current = null
            setPickingRoot(false)
          }}
        />
      </section>
    )
  if (!openedSpace || creating)
    return (
      <section className={styles.view} hidden={!visible} aria-label="Shared Spaces" data-setup="">
        <div className={styles.body}>
          <div className={styles.editor}>
            {creating ? (
              <>
                <h3>Create a shared space</h3>
                <p className={styles.hint}>
                  Give it a name and choose the workspace where its folders will live.
                </p>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    creationAttempt.current ??= {
                      action: 'create_space',
                      id: crypto.randomUUID(),
                      root: chosenRoot,
                      title: spaceName.trim(),
                      addToGitignore: ignoreChoiceEnabled && addToGitignore,
                    }
                    const result = await request(creationAttempt.current)
                    if (result.ok && result.spaceId) {
                      setOpenedSpace(result.spaceId)
                      setCreating(false)
                      setSetupOpen(false)
                      setArea('brainstorm')
                      setSelected(null)
                      creationAttempt.current = null
                      setSpaceName('')
                      setAddToGitignore(false)
                    }
                  }}
                >
                  <label>
                    Space name
                    <input
                      required
                      maxLength={80}
                      value={spaceName}
                      onChange={(e) => {
                        setSpaceName(e.target.value)
                        creationAttempt.current = null
                      }}
                      placeholder="For example, Threadlight advert"
                    />
                  </label>
                  <label>
                    Workspace
                    <button
                      ref={workspaceChoice}
                      type="button"
                      className={styles.workspaceChoice}
                      aria-label="Shared Spaces workspace"
                      title={chosenRoot ? workspacePath(chosenRoot) : undefined}
                      onClick={() => setPickingRoot(true)}
                    >
                      <span>
                        {choices
                          .find((w) => rootKey(w.id) === rootKey(chosenRoot))
                          ?.name.replace(/^(Claude|Codex) · /, '') ?? 'Choose a workspace…'}
                      </span>
                      <span aria-hidden="true">▸</span>
                    </button>
                  </label>
                  {ignoreChoiceEnabled && (
                    <label className={styles.ignoreChoice}>
                      <input
                        type="checkbox"
                        checked={addToGitignore}
                        disabled={busy}
                        onChange={(event) => {
                          setAddToGitignore(event.target.checked)
                          creationAttempt.current = null
                        }}
                      />
                      Add to .gitignore
                    </label>
                  )}
                  <details>
                    <summary>Folder structure</summary>
                    <pre className={styles.path}>
                      {
                        'space-name/\n  space.json\n  README.md\n  notes/\n  plans/\n  handoffs/\n  results/'
                      }
                    </pre>
                    <p className={styles.hint}>
                      Each space has its own folder and stable identity. Original files are kept in
                      place.
                    </p>
                  </details>
                  {(error || loadError) && (
                    <p role="alert" className={styles.error}>
                      {error || loadError}
                    </p>
                  )}
                  <button
                    className={styles.primary}
                    disabled={busy || !chosenRoot || !spaceName.trim()}
                  >
                    {busy ? 'Creating…' : 'Create space'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setCreating(false)
                      setError('')
                    }}
                  >
                    Cancel
                  </button>
                </form>
              </>
            ) : (
              <>
                <h3>Your shared spaces</h3>
                {!allMemory?.spaces.length && (
                  <p className={styles.hint}>
                    Notes, files and decisions shared between the chats you connect.
                  </p>
                )}
                {!allMemory ? (
                  <p role="status">Loading spaces…</p>
                ) : !allMemory.spaces.length ? (
                  <p role="status">
                    No shared spaces yet. Create one to choose its name and workspace.
                  </p>
                ) : (
                  allMemory.spaces.map((space) => {
                    const owner = allData.workspaces.find(
                      (w) => w.id === allData.spaceOwners[space.id],
                    )
                    const location = allData.locations?.find((l) => l.spaceId === space.id)
                    return (
                      <button
                        className={styles.spaceEntry}
                        key={space.id}
                        title={
                          owner
                            ? `${workspacePath(owner.root)}/shared-spaces/${location ? location.directory + '/' : ''}`
                            : 'Not assigned to a workspace'
                        }
                        onClick={() => {
                          setOpenedSpace(space.id)
                          setArea('brainstorm')
                          setSelected(null)
                          setError('')
                          setSetupOpen(false)
                        }}
                      >
                        <strong>{space.title}</strong>
                        {(location?.issue || owner?.issue) && (
                          <span>{location?.issue ?? owner?.issue}</span>
                        )}
                      </button>
                    )
                  })
                )}
                <button
                  className={styles.primary}
                  onClick={() => {
                    setCreating(true)
                    setAddToGitignore(false)
                    const preferred = focusedRoot ?? currentRoot
                    setChosenRoot(
                      choices.find((w) => preferred && rootKey(w.id) === rootKey(preferred))?.id ??
                        '',
                    )
                    setError('')
                  }}
                >
                  Create a space
                </button>
                {allMemory?.connections?.some((c) => c.state === 'pending') && (
                  <p className={styles.hint}>
                    A chat is waiting to connect. Open a space, then review its request in Chats.
                  </p>
                )}
                {(error || loadError) && (
                  <p role="alert" className={styles.error}>
                    {error || loadError}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    )
  return (
    <section
      className={styles.view}
      hidden={!visible}
      aria-label="Shared Spaces"
      data-setup={!migrationOpen && !unassigned && !workspaceReady ? '' : undefined}
    >
      <div className={styles.workspace}>
        {!openedLocation &&
          (allData.ideas.some((i) => !i.workspaceId) ||
            allMemory?.spaces.some((s) => !allData.spaceOwners[s.id])) && (
            <details>
              <summary>Advanced</summary>
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
            </details>
          )}
        {unassigned && (
          <button
            onClick={() => {
              setMigrationOpen(true)
              setMigrationWorkspace('')
              setMigration(null)
              setIdeaIds([])
              setLegacySpaceIds([openedSpace])
            }}
          >
            Assign to a workspace
          </button>
        )}
        {!migrationOpen && !setupOpen && (workspaceReady || unassigned) && (
          <div className={styles.tabs} role="tablist" aria-label="Shared Spaces areas">
            {(['handoffs', 'notes', 'brainstorm', 'workflow', 'participants'] as const).map(
              (tab) => (
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
                      (i) => i.id === e.dataTransfer.getData('application/x-threadlight-note'),
                    )
                    if (item) void move(item)
                  }}
                >
                  <span className={styles.tabLabel}>
                    {tab === 'handoffs'
                      ? 'Handoffs'
                      : tab === 'notes'
                        ? 'Notes'
                        : tab === 'participants'
                          ? 'Chats'
                          : tab === 'workflow'
                            ? 'Workflow'
                            : 'Brainstorm'}
                  </span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
      {(error || loadError) && (
        <p className={styles.error} role="alert">
          {error || loadError}
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
                  .filter((w) => w.ready && w.layout !== 'named')
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
      ) : !unassigned && !workspaceReady ? (
        <div className={styles.body}>
          <div className={styles.editor}>
            <h3>Space unavailable</h3>
            <p role="alert" className={styles.error}>
              {openedLocation?.issue ?? workspace?.issue ?? 'The workspace cannot be reached.'}
            </p>
            <p className={styles.hint}>
              Restore the original folder or reconnect its drive, then check again. Your saved
              records remain available.
            </p>
            <button onClick={() => void request({ action: 'list' })}>Check again</button>
          </div>
        </div>
      ) : setupOpen && memory && !unassigned ? (
        <ConnectionSetup
          key={`${viewKey}-${reviewRequest}`}
          data={memory}
          spaceId={openedSpace!}
          connectionId={reviewRequest}
          sessions={sessions}
          onClose={() => setSetupOpen(false)}
          navigationRef={setupNavigation}
        />
      ) : (
        <>
          {area !== 'participants' &&
            !!memory?.grants.some((g) => !g.revoked && g.pluginConnectionId) && (
              <details className={styles.connections}>
                <summary>
                  Connected chats ·{' '}
                  {memory.grants.filter((g) => !g.revoked && g.pluginConnectionId).length}
                </summary>
                {memory.grants
                  .filter((g) => !g.revoked && g.pluginConnectionId)
                  .map((g) => {
                    const connection = memory.connections?.find(
                      (c) => c.id === g.pluginConnectionId,
                    )
                    return (
                      <p key={g.id}>
                        <strong>
                          {sessions.find((s) => s.id === g.assignee)?.title ?? g.label}
                        </strong>
                        <br />
                        {connection?.state === 'connected'
                          ? 'Connected'
                          : connection?.state === 'approved'
                            ? 'Approved · waiting for chat'
                            : 'Reconnect from chat'}{' '}
                        · {g.readOnly ? 'Read only' : 'Can publish'}
                      </p>
                    )
                  })}
                <p>Review or revoke access inside the space under Agent access.</p>
              </details>
            )}
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
              onClose={() => setOpenedSpace(null)}
              initialSpaceId={openedLocation ? openedSpace : undefined}
              navigationRef={handoffs}
              discussions={[...data.ideas, ...discussions]}
              explainFile={
                openedSpace && workspaceReady
                  ? async (itemId, revision, filename) => {
                      const result = await request({
                        action: 'create_discussion',
                        id: crypto.randomUUID(),
                        spaceId: openedSpace,
                        title: `Explain ${filename}`.slice(0, 80),
                        file: { itemId, revision },
                      })
                      if (!result.ok || !result.discussionId) return
                      const client = getClient(openedSpace)
                      client.update(result.snapshot)
                      client.select(result.discussionId)
                      setSelected(result.discussionId)
                      setArea('brainstorm')
                      await client.agentSend('Explain this file and what each function does.')
                    }
                  : undefined
              }
              openSource={(id) => {
                setArea('brainstorm')
                setSelected(id)
              }}
            />
          </div>
          {openedSpace && (
            <div
              className={styles.body}
              id="spaces-workflow-panel"
              role="tabpanel"
              aria-labelledby="spaces-workflow"
              hidden={area !== 'workflow'}
            >
              <CommunicationView
                key={viewKey}
                spaceId={openedSpace}
                sessions={workspaceSessions}
                mode="workflow"
              />
            </div>
          )}
          {memory && (
            <div
              className={styles.body}
              id="spaces-participants-panel"
              role="tabpanel"
              aria-labelledby="spaces-participants"
              hidden={area !== 'participants'}
            >
              <ProjectParticipants
                key={viewKey}
                data={memory}
                sessions={sessions}
                spaceId={openedSpace}
                onUpdated={setMemory}
                onReviewRequest={(id) => {
                  setReviewRequest(id)
                  setSetupOpen(true)
                }}
              />
            </div>
          )}
          <div
            className={`${styles.body}${area === 'notes' && !idea ? ` ${styles.notes}` : ''}`}
            id={`spaces-${area === 'handoffs' || area === 'participants' || area === 'workflow' ? 'inactive' : area}-panel`}
            role="tabpanel"
            aria-labelledby={`spaces-${area}`}
            hidden={area === 'handoffs' || area === 'participants' || area === 'workflow'}
          >
            {area === 'brainstorm' && openedSpace && brainstormClient?.spaceId === openedSpace ? (
              <BrainstormChat
                key={viewKey}
                client={brainstormClient}
                discussions={discussions}
                requestedId={selected}
                navigationRef={brainstormNavigation}
                visible={visible}
                onVoiceToggle={onVoiceToggle}
                voiceActive={voiceActive}
                renderDiscussion={(discussion) => (
                  <IdeaEditor
                    key={discussion.id}
                    chatFirst
                    detailsOnly
                    onComparisonChange={(ids) => {
                      brainstormClient.compareSpaceIds = ids
                    }}
                    voiceActive={voiceActive}
                    idea={discussion}
                    data={data}
                    comparisonSpaces={(allMemory?.spaces ?? []).filter(
                      (s) => s.id !== openedSpace && !!allData.spaceOwners[s.id],
                    )}
                    memory={memory}
                    sessions={workspaceSessions}
                    busy={busy}
                    request={request}
                    draftCache={editorDrafts}
                    draftViews={draftViews}
                    messageCache={messageDrafts}
                    onMove={() => void move(discussion)}
                    onTask={(id) => {
                      handoffs.current?.openTask(id)
                      setArea('handoffs')
                      setSelected(null)
                    }}
                  />
                )}
              />
            ) : idea ? (
              <IdeaEditor
                key={idea.id}
                idea={idea}
                data={data}
                comparisonSpaces={(allMemory?.spaces ?? []).filter(
                  (s) => s.id !== openedSpace && !!allData.spaceOwners[s.id],
                )}
                memory={memory}
                sessions={workspaceSessions}
                busy={busy}
                request={request}
                draftCache={editorDrafts}
                draftViews={draftViews}
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
                {area !== 'notes' && (
                  <p className={styles.hint}>
                    Explore this space with your Brainstorm Agent. It reads, tracks and proposes
                    work for your review.
                  </p>
                )}
                <div className={area === 'notes' ? styles.notesList : undefined}>
                  {openedSpace &&
                    workspace &&
                    [...allData.ideas, ...(allData.discussions ?? [])].some(
                      (record) => !record.sharedSpaceId && record.workspaceId === workspace.id,
                    ) && (
                      <details>
                        <summary>Assign preserved legacy material to this space</summary>
                        {[...allData.ideas, ...(allData.discussions ?? [])]
                          .filter(
                            (record) =>
                              !record.sharedSpaceId && record.workspaceId === workspace.id,
                          )
                          .map((record) => (
                            <div key={record.id}>
                              <span>
                                {record.title} ·{' '}
                                {record.recordKind === 'discussion' ? 'Discussion' : 'Note'}
                              </span>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void request({
                                    action: 'attach_material',
                                    id: record.id,
                                    spaceId: openedSpace,
                                    revision: record.revision,
                                  })
                                }
                              >
                                Assign to {openedTitle}
                              </button>
                            </div>
                          ))}
                      </details>
                    )}
                  {records.map((item) =>
                    item.recordKind !== 'discussion' ? (
                      <NoteRow
                        key={item.id}
                        note={item}
                        attribution={
                          item.prepared
                            ? 'Assignments prepared · follow in Handoffs'
                            : `Saved note · ${item.memoryItem ? savedBy(item.saver) : 'Saved by you'}`
                        }
                        busy={busy}
                        onOpen={() => setSelected(item.id)}
                        onDiscuss={() => void move(item)}
                        onRename={renameNote}
                      />
                    ) : (
                      <article className={styles.row} key={item.id}>
                        <button className={styles.open} onClick={() => setSelected(item.id)}>
                          <strong>{item.title}</strong>
                          <span>
                            {item.prepared
                              ? 'Assignments prepared · follow in Handoffs'
                              : 'Plan and discussion'}
                          </span>
                        </button>
                        {item.saver && (
                          <span>
                            {new Date(item.saver.at).toLocaleString()}
                            {item.saver.chatId && <> · Source chat: {item.saver.chatId}</>}
                          </span>
                        )}
                      </article>
                    ),
                  )}
                  {!records.length && (
                    <p className={area === 'notes' ? styles.notesEmpty : styles.hint}>
                      {area === 'notes'
                        ? 'No notes yet.'
                        : 'Start a space discussion, or discuss a note from Notes.'}
                    </p>
                  )}
                </div>
                {area === 'notes' && (
                  <AnswerComposer
                    key={viewKey}
                    id={`space-note:${viewKey}`}
                    className={styles.noteComposer}
                    label="New note"
                    placeholder="Write a note…"
                    value={text}
                    maxLength={8000}
                    disabled={busy || !visible}
                    sendDisabled={busy || !text.trim()}
                    sendLabel="Save note"
                    onChange={setText}
                    onSend={() => void saveNote()}
                    onActivityChange={setNoteVoiceActive}
                  />
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
  chatFirst = false,
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
  comparisonSpaces,
  draftViews,
  messageRevision = 0,
  voiceActive = false,
  composerTrailing,
  detailsOnly = false,
  onComparisonChange,
}: {
  chatFirst?: boolean
  messageRevision?: number
  voiceActive?: boolean
  composerTrailing?: ReactNode
  detailsOnly?: boolean
  onComparisonChange?: (ids: string[]) => void
  draftViews: React.RefObject<Map<string, DraftView>>
  comparisonSpaces: { id: string; title: string }[]
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
  const [message, updateMessage] = useState(
    () =>
      messageCache.current.get(idea.id) ??
      (idea.sharedSpaceId ? recalledDraft(idea.sharedSpaceId, idea.id) : ''),
  )
  useEffect(() => {
    // Apply a recovered voice transcript from the shared draft cache to the mounted editor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateMessage(
      messageCache.current.get(idea.id) ?? recalledDraft(idea.sharedSpaceId ?? '', idea.id),
    )
  }, [messageRevision, messageCache, idea.id, idea.sharedSpaceId])
  const setMessage = (value: string) => {
    messageCache.current.set(idea.id, value)
    if (idea.sharedSpaceId) rememberDraft(idea.sharedSpaceId, idea.id, value)
    updateMessage(value)
  }
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  useEffect(() => onComparisonChange?.(comparisonIds), [comparisonIds, onComparisonChange])
  const [history, setHistory] = useState<AgentItem[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const views = draftViews.current
    const prior = views.get(idea.id)
    if (prior) {
      if (editor.parentElement) editor.parentElement.scrollTop = prior.scroll
      for (const field of prior.fields) {
        const input = editor.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[data-draft-field="${field.name}"]`,
        )
        if (input && field.start !== null && field.end !== null)
          input.setSelectionRange(field.start, field.end)
      }
    }
    return () => {
      views.set(idea.id, {
        scroll: editor.parentElement?.scrollTop ?? 0,
        fields: [
          ...editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-draft-field]'),
        ].map((input) => ({
          name: input.dataset.draftField!,
          start: input.selectionStart,
          end: input.selectionEnd,
        })),
      })
    }
  }, [idea.id, draftViews])
  const [historyError, setHistoryError] = useState('')
  const [folderId, setFolderId] = useState(idea.prepared?.folderId ?? '')
  const settings = useSettings()
  const active = data.activeId === idea.id
  const agent = data.agent
  const items = active ? agent.items : history
  const frozen = !!idea.prepared && !idea.workflowSpaceId
  const dirty =
    JSON.stringify(localDraft.noteIds ?? []) !== JSON.stringify(idea.noteIds ?? []) ||
    localDraft.workflowSpaceId !== idea.workflowSpaceId ||
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
          if (r.ok) {
            setHistory(r.items ?? [])
            setHistoryCursor(r.historyCursor ?? null)
          } else setHistoryError(r.reason)
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
      workflowSpaceId: draft.workflowSpaceId,
      ...(idea.recordKind === 'discussion' ? { noteIds: draft.noteIds ?? [] } : {}),
    })
    if (result.ok) {
      const saved = [...result.snapshot.ideas, ...(result.snapshot.discussions ?? [])].find(
        (i) => i.id === idea.id,
      )
      if (saved) setDraft(saved)
    }
  }
  const latest = [...items].reverse().find((i) => i.kind === 'agent')
  const participants =
    memory && (idea.sharedSpaceId ?? idea.workflowSpaceId)
      ? projectParticipants(memory, sessions, (idea.sharedSpaceId ?? idea.workflowSpaceId)!)
      : []
  const provider = active
    ? agent.provider
    : idea.conversationId
      ? idea.conversationId.startsWith('codex:')
        ? 'codex'
        : 'claude'
      : settings?.agentProvider
  const sendMessage = async () => {
    if (voiceActive || busy || dirty || agentBusy(agent) || !message.trim()) return
    const result = await request({
      action: 'chat',
      id: idea.id,
      text: message,
      compareSpaceIds: comparisonIds,
    })
    if (result.ok) {
      setMessage('')
      setComparisonIds([])
    }
  }
  const comparisonPicker = !!comparisonSpaces.length && (
    <details>
      <summary>Compare with another space for this request</summary>
      {comparisonSpaces.map((space) => (
        <label key={space.id}>
          <input
            type="checkbox"
            checked={comparisonIds.includes(space.id)}
            disabled={!comparisonIds.includes(space.id) && comparisonIds.length >= 3}
            onChange={(e) =>
              setComparisonIds((ids) =>
                e.target.checked ? [...ids, space.id] : ids.filter((id) => id !== space.id),
              )
            }
          />
          {space.title}
        </label>
      ))}
    </details>
  )
  return (
    <div className={styles.editor} ref={editorRef}>
      {!chatFirst && <h3>{idea.title}</h3>}
      {idea.saver && <SaverAttribution saver={idea.saver} sessions={sessions} />}
      <OptionalDetails collapsed={chatFirst} title="Discussion details">
        {idea.recordKind === 'discussion' && <BrainstormContext discussionId={idea.id} />}

        <label>
          Title
          <input
            data-draft-field="title"
            value={draft.title}
            maxLength={80}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          {idea.recordKind === 'discussion' ? 'Discussion brief' : 'Note'}
          <textarea
            data-draft-field="body"
            value={draft.text}
            maxLength={8000}
            disabled={frozen}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </label>
        {idea.recordKind === 'discussion' && (
          <details>
            <summary>Linked notes ({draft.noteIds?.length ?? 0})</summary>
            {data.ideas.map((note) => (
              <label key={note.id}>
                <input
                  type="checkbox"
                  checked={draft.noteIds?.includes(note.id) ?? false}
                  disabled={frozen || busy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      noteIds: e.target.checked
                        ? [...(draft.noteIds ?? []), note.id]
                        : (draft.noteIds ?? []).filter((id) => id !== note.id),
                    })
                  }
                />
                {note.title}
              </label>
            ))}
          </details>
        )}
        {chatFirst && (
          <button disabled={busy || frozen || !dirty} onClick={() => void save()}>
            Save changes
          </button>
        )}
      </OptionalDetails>
      {idea.recordKind !== 'discussion' ? (
        <div className={styles.actions}>
          <button disabled={busy || !dirty} onClick={() => void save()}>
            Save changes
          </button>
          <button disabled={busy || dirty} onClick={onMove}>
            Discuss in Brainstorm
          </button>
        </div>
      ) : (
        <>
          {!detailsOnly && (
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
                {historyCursor && !active && (
                  <button
                    onClick={async () => {
                      const r = await request({
                        action: 'read',
                        id: idea.id,
                        cursor: historyCursor,
                      })
                      if (r.ok) {
                        setHistory((old) => [...(r.items ?? []), ...old])
                        setHistoryCursor(r.historyCursor ?? null)
                      }
                    }}
                  >
                    Earlier messages
                  </button>
                )}
                {items.map((item, n) => (
                  <div className={styles.message} key={item.id ?? n} data-kind={item.kind}>
                    <strong>
                      {item.kind === 'you' ? 'You' : item.kind === 'agent' ? 'Agent' : 'Activity'}
                    </strong>
                    <p>
                      {item.kind === 'you' ? (
                        item.text.split('\n\nUser message:\n').at(-1)
                      ) : (
                        <SourceLinks discussionId={idea.id} text={item.text} />
                      )}
                    </p>
                  </div>
                ))}
                {!items.length && (
                  <p className={styles.hint}>
                    Ask your Agent to explore the notes, conversations and work in this space.
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
                  await sendMessage()
                }}
              >
                {chatFirst && dirty && (
                  <p className={styles.hint}>
                    Save your changes in Discussion details or Plan and assignments before sending.
                  </p>
                )}
                {comparisonPicker}
                <ComposerInput
                  embedded
                  trailing={composerTrailing}
                  input={{
                    'aria-label': 'Message to Agent',
                    'data-draft-field': 'message',
                    value: message,
                    maxLength: 8000,
                    onChange: (e) => setMessage(e.target.value),
                    placeholder: 'Think it through with your Agent…',
                  }}
                  sendDisabled={
                    voiceActive || busy || dirty || agentBusy(agent) || !idea.workspaceId
                  }
                  onSend={() => void sendMessage()}
                />
                <div className={styles.actions}>
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
            </>
          )}
          {detailsOnly && comparisonPicker}
          <OptionalDetails collapsed={chatFirst} title="Plan and assignments">
            <label>
              Mini plan
              <textarea
                data-draft-field="plan"
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
              Choose each task and its destination chat. Assignments use that chat’s model.
              Preparing saves drafts; review and send each one in Handoffs. Dependent tasks should
              be sent after their inputs are ready.
            </p>
            <p className={styles.hint}>
              Missing chats? Enable their provider in Applications and open the workspace in the
              thread view.
            </p>
            {draft.assignments.map((a, index) => (
              <fieldset key={a.id} disabled={frozen || busy}>
                <legend>Assignment {index + 1}</legend>
                <details>
                  <summary>Suggested chats</summary>
                  {suggestParticipants(`${a.title}\n${a.brief}`, participants).map((suggestion) => (
                    <div key={suggestion.assignee}>
                      <strong>{suggestion.title}</strong>
                      <p className={styles.hint}>{suggestion.rationale}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            assignments: draft.assignments.map((v) =>
                              v.id === a.id
                                ? {
                                    ...v,
                                    provider: suggestion.provider,
                                    assignee: suggestion.assignee,
                                    rationale: suggestion.rationale,
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        Use {suggestion.title}
                      </button>
                    </div>
                  ))}
                  {!suggestParticipants(`${a.title}\n${a.brief}`, participants).length && (
                    <p className={styles.hint}>
                      No connected chat with project publishing access has a matching capability
                      report. Add or update reports in Chats, or review a destination manually.
                    </p>
                  )}
                  <p className={styles.hint}>
                    Suggestions use capability text matches. Review the fit, save your choices and
                    authorise prepared work in Handoffs.
                  </p>
                </details>
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
                            ? {
                                ...v,
                                provider: e.target.value as 'claude' | 'codex',
                                assignee: '',
                                rationale: undefined,
                              }
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
                          v.id === a.id
                            ? { ...v, assignee: e.target.value, rationale: undefined }
                            : v,
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
                    aria-label="Brief and acceptance criteria"
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
                <label>
                  Assignment rationale
                  <textarea
                    aria-label="Assignment rationale"
                    maxLength={2000}
                    value={a.rationale ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        assignments: draft.assignments.map((v) =>
                          v.id === a.id ? { ...v, rationale: e.target.value } : v,
                        ),
                      })
                    }
                    placeholder="Why is this chat suitable for this task?"
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
                  void request({
                    action: 'prepare',
                    id: idea.id,
                    revision: idea.revision,
                    folderId,
                  })
                }
              >
                {idea.prepared ? 'Finish preparing assignments' : 'Prepare assignments for review'}
              </button>
            )}
          </OptionalDetails>
        </>
      )}
    </div>
  )
}

function OptionalDetails({
  collapsed,
  title,
  children,
}: {
  collapsed: boolean
  title: string
  children: ReactNode
}) {
  return collapsed ? (
    <details className={styles.discussionDetails}>
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  )
}
