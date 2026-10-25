import { en } from '../i18n/en'
import styles from './Panel.module.css'
import { sameFolder } from './WorkspaceTree'

interface WorkspacePickerProps {
  provider?: 'claude' | 'codex' | 'both' | 'none'
  /** Every workspace, whether or not it has threads inside the time window. */
  workspaces: { id: string; name: string }[]
  /** The workspace now in focus, or null when following the Claude app. */
  chosen: string | null
  /** The workspace of the thread last open in Claude, named on the "Follow Claude" row. */
  current: string | null
  onPick: (workspaceId: string | null) => void
}

/** Choosing which workspace the Workspace list shows: one row per workspace, all collapsed. */
export function WorkspacePicker({
  workspaces,
  chosen,
  current,
  onPick,
  provider,
}: WorkspacePickerProps) {
  const currentName = workspaces.find((w) => current && sameFolder(w.id, current))?.name
  return (
    <>
      <p className={styles.pickerPrompt}>{en.workspaces.choose}</p>
      <button
        className={styles.workspaceHeader}
        aria-pressed={chosen === null}
        onClick={() => onPick(null)}
      >
        <span className={styles.workspaceName}>
          {provider === 'both'
            ? 'Follow recent activity'
            : provider === 'codex'
              ? 'Follow Codex activity'
              : en.workspaces.followClaude}
        </span>
        {currentName && <span className={styles.workspaceCount}>{currentName}</span>}
      </button>
      {workspaces.map((workspace) => (
        <button
          key={workspace.id}
          className={styles.workspaceHeader}
          aria-pressed={chosen !== null && sameFolder(chosen, workspace.id)}
          title={workspace.id}
          onClick={() => onPick(workspace.id)}
        >
          <span className={styles.workspaceName}>{workspace.name}</span>
          <span className={styles.caret}>▸</span>
        </button>
      ))}
    </>
  )
}
