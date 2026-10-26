import { useMemo, useRef, useState } from 'react'
import { workspaceFolder } from '../../shared/providers'
import {
  searchWorkspaces,
  workspaceExplorer,
  type KnownWorkspace,
  type WorkspaceFolder,
} from '../lib/workspaceExplorer'
import styles from './Panel.module.css'
import { ThreadScrollbar } from './ThreadScrollbar'

interface WorkspacePickerProps {
  provider: 'claude' | 'codex' | 'both' | 'none'
  /** Every known workspace, including threads outside the recent time window. */
  workspaces: KnownWorkspace[]
  chosen: string | null
  onProviderChange: (provider: 'claude' | 'codex' | 'both') => void
  onPick: (workspaceId: string) => void
}

/** A folder browser over known thread locations, rather than unrelated files on disk. */
export function WorkspacePicker({
  workspaces,
  chosen,
  onPick,
  provider,
  onProviderChange,
}: WorkspacePickerProps) {
  const explorer = useMemo(() => workspaceExplorer(workspaces), [workspaces])
  const [location, setLocation] = useState('')
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
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
      <div className={styles.pickerControls}>
        <label>
          Applications
          <select
            aria-label="Workspace applications"
            value={provider === 'none' ? '' : provider}
            onChange={(event) =>
              onProviderChange(event.target.value as 'claude' | 'codex' | 'both')
            }
          >
            {provider === 'none' && (
              <option value="" disabled>
                Choose apps…
              </option>
            )}
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            aria-label="Search workspaces"
            placeholder="Search workspaces…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <nav className={styles.pickerLocation} aria-label="Workspace folder navigation">
        <button
          aria-label="Parent folder"
          title="Parent folder"
          disabled={!folder}
          onClick={() => setLocation(folder?.parent ?? '')}
        >
          ↑
        </button>
        <span title={folder?.path}>{folder?.path ?? 'All drives'}</span>
      </nav>
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
        ref={list}
        id="workspace-folders"
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
      <ThreadScrollbar list={list} label="Scroll workspaces" controls="workspace-folders" />
    </div>
  )
}
