import { useEffect, useRef, useState } from 'react'
import type { SpaceIdea } from '../../shared/spaces'
import { ContextMenu } from '../panel/ContextMenu'
import styles from './NoteRow.module.css'

export function NoteRow({
  note,
  attribution,
  busy,
  onOpen,
  onDiscuss,
  onRename,
}: {
  note: SpaceIdea
  attribution: string
  busy: boolean
  onOpen: () => void
  onDiscuss: () => void
  onRename: (original: SpaceIdea, title: string) => Promise<boolean>
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [rename, setRename] = useState<{ original: SpaceIdea; title: string } | null>(null)
  const saving = useRef(false)
  const renaming = rename !== null
  useEffect(() => {
    if (renaming) {
      input.current?.focus()
      input.current?.select()
    }
    // Focus only when opening the editor, not on each keystroke.
  }, [renaming])
  const closeMenu = () => {
    setMenu(null)
    trigger.current?.focus()
  }
  return (
    <article
      className={styles.row}
      draggable={!rename}
      onDragStart={(e) => e.dataTransfer.setData('application/x-threadlight-note', note.id)}
      onContextMenu={(e) => {
        if (rename) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {rename ? (
        <form
          data-note-rename=""
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || saving.current || !rename.title.trim()) return
            saving.current = true
            try {
              if (await onRename(rename.original, rename.title.trim())) {
                setRename(null)
                requestAnimationFrame(() => trigger.current?.focus())
              }
            } finally {
              saving.current = false
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            if (busy) return
            setRename(null)
            requestAnimationFrame(() => trigger.current?.focus())
          }}
        >
          <input
            ref={input}
            aria-label="Note title"
            value={rename.title}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setRename({ ...rename, title: e.target.value })}
          />
          <div className={styles.actions}>
            <button disabled={busy || !rename.title.trim()}>Save title</button>
            <button type="button" disabled={busy} onClick={() => setRename(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={trigger}
          className={styles.open}
          aria-haspopup="menu"
          onClick={onOpen}
          onKeyDown={(e) => {
            if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.left, y: rect.bottom })
          }}
        >
          <strong className={styles.title}>{note.title}</strong>
          <span>{attribution}</span>
        </button>
      )}
      {menu && (
        <ContextMenu
          {...menu}
          label="Note actions"
          onClose={closeMenu}
          items={[
            {
              label: 'Rename',
              disabled: busy || !!note.prepared,
              onSelect: () => setRename({ original: note, title: note.title }),
            },
            { label: 'Discuss', disabled: busy, onSelect: onDiscuss },
          ]}
        />
      )}
    </article>
  )
}
