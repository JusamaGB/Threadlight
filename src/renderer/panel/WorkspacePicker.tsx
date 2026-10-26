import { useEffect, useMemo, useRef, useState } from 'react'
import { workspaceFolder } from '../../shared/providers'
import {
  searchWorkspaces,
  workspaceExplorer,
  type KnownWorkspace,
  type WorkspaceFolder,
} from '../lib/workspaceExplorer'
import styles from './Panel.module.css'
import { ContextMenu } from './ContextMenu'

interface WorkspacePickerProps {
  provider: 'claude' | 'codex' | 'both' | 'none'
  /** Every known workspace, including threads outside the recent time window. */
  workspaces: KnownWorkspace[]
  chosen: string | null
  allDrives: boolean
  onPickAll: () => void
  onProviderChange: (provider: 'claude' | 'codex' | 'both') => void
  onPick: (workspaceId: string) => void
}

/** A folder browser over known thread locations, rather than unrelated files on disk. */
export function WorkspacePicker({
  workspaces,
  chosen,
  allDrives,
  onPickAll,
  onPick,
  provider,
  onProviderChange,
}: WorkspacePickerProps) {
  const explorer = useMemo(() => workspaceExplorer(workspaces), [workspaces])
  const [location, setLocation] = useState('')
  const [query, setQuery] = useState('')
  const [searchHovered, setSearchHovered] = useState(false)
  const [searchPinned, setSearchPinned] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchLink = useRef<HTMLButtonElement>(null)
  const [appsAnchor, setAppsAnchor] = useState<HTMLButtonElement | null>(null)
  const [appsMode, setAppsMode] = useState<'hover' | 'click' | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelAppsClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const closeAppsSoon = () => {
    if (appsMode !== 'hover') return
    cancelAppsClose()
    closeTimer.current = setTimeout(
      () => setAppsMode((mode) => (mode === 'hover' ? null : mode)),
      150,
    )
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (searchPinned) searchInput.current?.focus({ preventScroll: true })
  }, [searchPinned])
  const searchOpen = searchHovered || searchPinned || searchFocused || query.length > 0
  const sourceLabel =
    provider === 'both'
      ? 'Both'
      : provider === 'codex'
        ? 'Codex'
        : provider === 'claude'
          ? 'Claude'
          : 'None'
  const appsAt = appsAnchor?.getBoundingClientRect()
  const folder = explorer.folders.get(location)
  const searching = query.trim().length > 0
  const rows = searching
    ? searchWorkspaces([...explorer.folders.values()], query)
    : (folder?.children ?? explorer.roots)
  const nameOf = (entry: WorkspaceFolder) =>
    entry.workspace?.name.replace(/^(Claude|Codex) · /, '') ?? entry.name
  const browse = (entry: WorkspaceFolder) => {
    setLocation(entry.key)
    setQuery('')
  }

  return (
    <div className={styles.workspacePicker}>
      <div className={styles.pickerToolbar} onMouseLeave={() => setSearchHovered(false)}>
        <div className={styles.pickerControls}>
          <button className={styles.pickerUseAll} aria-pressed={allDrives} onClick={onPickAll}>
            Use All Drives
          </button>
          <div className={styles.pickerTools}>
            <span onMouseLeave={closeAppsSoon}>
              <button
                className={styles.pickerLink}
                aria-label={`Workspace applications: ${sourceLabel}`}
                aria-haspopup="menu"
                aria-expanded={!!appsMode}
                onMouseEnter={(event) => {
                  setAppsAnchor(event.currentTarget)
                  cancelAppsClose()
                  setSearchHovered(false)
                  setAppsMode((mode) => (mode === 'click' ? mode : 'hover'))
                }}
                onClick={(event) => {
                  setAppsAnchor(event.currentTarget)
                  cancelAppsClose()
                  setAppsMode((mode) => (mode === 'click' ? null : 'click'))
                }}
              >
                Apps
              </button>
              {appsMode && appsAt && (
                <ContextMenu
                  label="Workspace applications"
                  anchor={appsAnchor ?? undefined}
                  x={appsAt.left}
                  y={appsAt.bottom}
                  modal={appsMode === 'click'}
                  onClose={() => {
                    cancelAppsClose()
                    setAppsMode(null)
                  }}
                  onMouseEnter={cancelAppsClose}
                  onMouseLeave={closeAppsSoon}
                  items={(['claude', 'codex', 'both'] as const).map((value) => ({
                    label: value === 'both' ? 'Both' : value === 'claude' ? 'Claude' : 'Codex',
                    disabled: provider === value,
                    onSelect: () => onProviderChange(value),
                  }))}
                />
              )}
            </span>
            <span className={styles.pickerToolDivider} aria-hidden="true">
              |
            </span>
            <button
              ref={searchLink}
              className={styles.pickerLink}
              aria-expanded={searchOpen}
              aria-pressed={searchPinned}
              onMouseEnter={() => {
                setSearchHovered(true)
                cancelAppsClose()
                setAppsMode((mode) => (mode === 'hover' ? null : mode))
              }}
              onClick={() => setSearchPinned((pinned) => !pinned)}
            >
              Search
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className={styles.pickerSearch} onMouseEnter={() => setSearchHovered(true)}>
            <input
              ref={searchInput}
              type="search"
              aria-label="Search workspaces"
              placeholder="Search workspaces…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setSearchPinned(false)
                setSearchHovered(false)
                setSearchFocused(false)
                setQuery('')
                event.currentTarget.blur()
                searchLink.current?.focus()
              }}
            />
          </div>
        )}
      </div>
      {folder && (
        <nav className={styles.pickerLocation} aria-label="Workspace folder navigation">
          <button
            aria-label="Parent folder"
            title="Back to parent folder"
            onClick={() => setLocation(folder?.parent ?? '')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M13 8H3m5-5L3 8l5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span title={folder.path}>{folder.path}</span>
        </nav>
      )}
      {folder?.workspace && !searching && (
        <button
          className={styles.workspaceHeader}
          title={folder.path}
          aria-pressed={
            chosen !== null && workspaceFolder(chosen) === workspaceFolder(folder.workspace.id)
          }
          onClick={() => onPick(folder.workspace!.id)}
        >
          Use {nameOf(folder)}
        </button>
      )}
      <div
        id="workspace-folders"
        role="region"
        tabIndex={0}
        className={styles.pickerResults}
        aria-label={searching ? 'Workspace search results' : 'Workspace folders'}
      >
        {rows.map((entry) => {
          // A drive/share remains a navigation row even when threads ran at its root.
          // Its root workspace can be selected with "Use …" after opening it.
          const browseRow = !entry.workspace || (!searching && entry.parent === '')
          return (
            <div key={entry.key} className={styles.pickerFolder}>
              <button
                className={styles.workspaceHeader}
                aria-pressed={
                  !browseRow && entry.workspace
                    ? chosen !== null &&
                      workspaceFolder(chosen) === workspaceFolder(entry.workspace.id)
                    : undefined
                }
                title={entry.path}
                onClick={() => (browseRow ? browse(entry) : onPick(entry.workspace!.id))}
              >
                <span className={styles.pickerFolderName}>
                  <span className={styles.workspaceName}>
                    {browseRow ? entry.name : nameOf(entry)}
                  </span>
                  {searching && <span className={styles.pickerPath}>{entry.path}</span>}
                </span>
                {browseRow && (
                  <>
                    <span className={styles.workspaceCount}>
                      {entry.count} {entry.count === 1 ? 'workspace' : 'workspaces'}
                    </span>
                    <span className={styles.caret}>▸</span>
                  </>
                )}
              </button>
              {!browseRow && entry.workspace && entry.children.length > 0 && (
                <button
                  className={styles.pickerBrowse}
                  aria-label={`Browse ${nameOf(entry)}`}
                  title={`Browse folders inside ${entry.path}`}
                  onClick={() => browse(entry)}
                >
                  ▸
                </button>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className={styles.pickerEmpty} role="status">
            {searching
              ? 'No workspaces match your search.'
              : 'No other known workspaces in this folder.'}
          </p>
        )}
      </div>
    </div>
  )
}
