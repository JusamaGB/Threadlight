import type { ReactNode } from 'react'

import type { Session, ThreadNode, Workspace } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

interface WorkspaceTreeProps {
  workspaces: Workspace[]
  /** "all": every workspace, collapsible. "workspace": just this one, always open. */
  only: string | null
  isOpen: (workspaceId: string) => boolean
  onToggle: (workspaceId: string) => void
  onShowMore: (workspaceId: string) => void
  /** Renders a thread exactly as the recent list does. */
  renderRow: (session: Session) => ReactNode
}

/** The recent list's rows, wrapped in workspace groups like the Claude sidebar. */
export function WorkspaceTree(props: WorkspaceTreeProps) {
  const { workspaces, only, isOpen, onToggle, onShowMore, renderRow } = props
  const shown = only ? workspaces.filter((w) => sameFolder(w.id, only)) : workspaces

  if (shown.length === 0) return <p className={styles.empty}>{en.workspaces.none}</p>

  return (
    <>
      {shown.map((workspace) => {
        const open = only !== null || isOpen(workspace.id)
        return (
          <section key={workspace.id} className={styles.workspace}>
            <button
              className={styles.workspaceHeader}
              onClick={() => only === null && onToggle(workspace.id)}
              aria-expanded={open}
              title={workspace.id}
              data-fixed={only !== null || undefined}
            >
              <span className={styles.workspaceName}>{workspace.name}</span>
              {only === null && <span className={styles.caret}>{open ? '▾' : '▸'}</span>}
              {/* Only a collapsed workspace needs the dot: an open one shows its threads' own. */}
              {!open && workspace.activeCount > 0 && (
                <span
                  className={styles.workspaceDot}
                  data-state={workspace.anyWorking ? 'working' : 'waiting'}
                />
              )}
              <span className={styles.workspaceCount}>{workspace.threadCount}</span>
            </button>
            {open && (
              <div className={styles.workspaceThreads}>
                <Nodes nodes={workspace.threads} renderRow={renderRow} />
                {workspace.hiddenCount > 0 && (
                  <button className={styles.showMore} onClick={() => onShowMore(workspace.id)}>
                    {en.workspaces.showMore(workspace.hiddenCount)}
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

/** Threads, with the side threads each one started nested beneath it. */
function Nodes({
  nodes,
  renderRow,
}: {
  nodes: ThreadNode[]
  renderRow: (s: Session) => ReactNode
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.session.id}>
          {renderRow(node.session)}
          {node.children.length > 0 && (
            <div className={styles.children}>
              <Nodes nodes={node.children} renderRow={renderRow} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

export function sameFolder(a: string, b: string): boolean {
  const key = (path: string) => path.replace(/[\\/]+$/, '').toLowerCase()
  return key(a) === key(b)
}
