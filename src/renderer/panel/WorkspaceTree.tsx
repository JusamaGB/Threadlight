import type { ReactNode } from 'react'

import type { Session, ThreadNode, Workspace } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Panel.module.css'

interface WorkspaceTreeProps {
  workspaces: Workspace[]
  /** "all": every workspace, collapsible. "workspace": just this one, always open. */
  only: { id: string; name: string } | null
  isOpen: (workspaceId: string) => boolean
  onToggle: (workspaceId: string) => void
  onShowMore: (workspaceId: string) => void
  /** The Workspace list's header picks another workspace. */
  onPickWorkspace: () => void
  /** Shown when nothing falls inside the chosen time window. */
  emptyMessage: string
  /** Renders a thread exactly as the recent list does. */
  renderRow: (session: Session) => ReactNode
}

/** The recent list's rows, wrapped in workspace groups like the Claude sidebar. */
export function WorkspaceTree(props: WorkspaceTreeProps) {
  const { workspaces, only, isOpen, onToggle, onShowMore, onPickWorkspace, renderRow } = props
  const shown = only ? workspaces.filter((w) => sameFolder(w.id, only.id)) : workspaces

  if (shown.length === 0) {
    return (
      <>
        {/* The chosen workspace still heads the list, so it can be changed from here. */}
        {only && <FixedHeader name={only.name} title={only.id} onPick={onPickWorkspace} />}
        <p className={styles.empty}>{props.emptyMessage}</p>
      </>
    )
  }

  return (
    <>
      {shown.map((workspace) => {
        const open = only !== null || isOpen(workspace.id)
        if (only) {
          return (
            <section key={workspace.id} className={styles.workspace}>
              <FixedHeader name={workspace.name} title={workspace.id} onPick={onPickWorkspace}>
                <span className={styles.workspaceCount}>{workspace.threadCount}</span>
              </FixedHeader>
              <div className={styles.workspaceThreads}>
                <Nodes nodes={workspace.threads} renderRow={renderRow} />
              </div>
            </section>
          )
        }
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

/** The Workspace list's heading: the chosen workspace, tapped to choose another. */
function FixedHeader(props: {
  name: string
  title: string
  onPick: () => void
  children?: ReactNode
}) {
  return (
    <button
      className={styles.workspaceHeader}
      onClick={props.onPick}
      title={`${props.title} · ${en.workspaces.change}`}
    >
      <span className={styles.workspaceName}>{props.name}</span>
      <span className={styles.caret}>▾</span>
      {props.children}
    </button>
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
