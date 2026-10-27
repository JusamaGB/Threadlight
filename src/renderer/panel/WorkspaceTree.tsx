import type { CSSProperties, ReactNode } from 'react'

import type { Session, ThreadNode, Workspace } from '../../shared/types'
import { compareSessionOrder } from '../../shared/sessionOrder'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

interface WorkspaceTreeProps {
  workspaces: Workspace[]
  /** "all": every workspace, collapsible. "workspace": just this one, always open. */
  only: { id: string; name: string; ids?: string[] } | null
  isOpen: (workspaceId: string) => boolean
  onToggle: (workspaceId: string) => void
  onShowMore: (workspaceId: string) => void
  /** Shown when nothing falls inside the chosen time window. */
  emptyMessage: ReactNode
  /** Renders a thread exactly as the recent list does. */
  renderRow: (session: Session, index: number) => ReactNode
}

/** The recent list's rows, wrapped in workspace groups like the Claude sidebar. */
export function WorkspaceTree(props: WorkspaceTreeProps) {
  const { workspaces, only, isOpen, onToggle, onShowMore, renderRow } = props
  const wanted = only ? new Set((only.ids ?? [only.id]).map(folderKey)) : null
  const shown = wanted ? workspaces.filter((w) => wanted.has(folderKey(w.id))) : workspaces

  if (shown.length === 0) {
    return props.emptyMessage ? (
      <p className={`${styles.empty} ${styles.emptyWindow}`}>{props.emptyMessage}</p>
    ) : null
  }

  // Number visible rows in display order, including children, so stripes do not restart at
  // each parent or provider. Keep provider-owned arrays intact when merging one folder.
  const threads = only ? shown.flatMap((workspace) => workspace.threads) : []
  if (only && shown.length > 1) threads.sort((a, b) => compareSessionOrder(a.session, b.session))
  const indexes = new Map<string, number>()
  const numberRows = (nodes: ThreadNode[]) => {
    for (const node of nodes) {
      indexes.set(node.session.id, indexes.size)
      numberRows(node.children)
    }
  }
  numberRows(
    only
      ? threads
      : shown.filter((workspace) => isOpen(workspace.id)).flatMap((workspace) => workspace.threads),
  )
  const renderIndexedRow = (session: Session) => renderRow(session, indexes.get(session.id) ?? 0)

  if (only) {
    return (
      <section className={styles.workspace}>
        <div className={styles.workspaceThreads}>
          <Nodes nodes={threads} renderRow={renderIndexedRow} />
        </div>
      </section>
    )
  }

  return (
    <>
      {shown.map((workspace) => {
        const open = isOpen(workspace.id)
        return (
          <section key={workspace.id} className={styles.workspace}>
            <button
              className={styles.workspaceHeader}
              onClick={() => onToggle(workspace.id)}
              aria-expanded={open}
              title={workspace.id}
            >
              <span className={styles.workspaceName}>{workspace.name}</span>
              <span className={styles.caret}>{open ? '▾' : '▸'}</span>
              {/* Only a collapsed workspace needs the dot: an open one shows its threads' own. */}
              {!open && workspace.activeCount > 0 && (
                <span
                  className={styles.workspaceDot}
                  data-state={workspace.anyWorking ? 'working' : 'waiting'}
                />
              )}
              <Worktrees count={workspace.worktrees} />
            </button>
            {open && (
              <div className={styles.workspaceThreads}>
                <Nodes nodes={workspace.threads} renderRow={renderIndexedRow} />
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
  depth = 0,
}: {
  nodes: ThreadNode[]
  renderRow: (s: Session) => ReactNode
  depth?: number
}) {
  return (
    <>
      {nodes.map((node) => (
        <div
          key={node.session.id}
          // Each guide adds 14px of margin and a 1px border; the tint stays at the panel edge.
          style={{ '--thread-inset': `${depth * 15}px` } as CSSProperties}
        >
          {renderRow(node.session)}
          {node.children.length > 0 && (
            <div className={styles.children}>
              <Nodes nodes={node.children} renderRow={renderRow} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

const folderKey = (path: string) => path.replace(/[\\/]+$/, '').toLowerCase()

export function sameFolder(a: string, b: string): boolean {
  return folderKey(a) === folderKey(b)
}

/** A workspace's worktrees, once there is more than the main checkout. */
function Worktrees({ count }: { count: number }) {
  if (count < 2) return null
  return <span className={styles.workspaceWorktrees}>{en.git.worktrees(count)}</span>
}
