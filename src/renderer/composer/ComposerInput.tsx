import type { ReactNode, RefObject, TextareaHTMLAttributes } from 'react'
import styles from './Composer.module.css'

interface ComposerInputProps {
  input: TextareaHTMLAttributes<HTMLTextAreaElement> & { 'data-draft-field'?: string }
  inputRef?: RefObject<HTMLTextAreaElement | null>
  embedded?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  entryContent?: ReactNode
  sendVisible?: boolean
  sendDisabled?: boolean
  sendLabel?: string
  sendTitle?: string
  onSend: () => void
}

/** Shared input surface for messages, discussions and question answers. */
export function ComposerInput({
  input,
  inputRef,
  embedded = false,
  leading,
  trailing,
  entryContent,
  sendVisible = !!String(input.value ?? '').trim(),
  sendDisabled = false,
  sendLabel = 'Send',
  sendTitle = sendLabel,
  onSend,
}: ComposerInputProps) {
  return (
    <div className={styles.pill} data-embedded={embedded || undefined} data-composer-input="">
      {leading}
      <div className={styles.entry}>
        <textarea
          {...input}
          ref={inputRef}
          rows={1}
          className={styles.input}
          onKeyDown={(event) => {
            input.onKeyDown?.(event)
            if (event.defaultPrevented || event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              if (!sendDisabled && !input.disabled && sendVisible) onSend()
            }
          }}
        />
        {entryContent}
      </div>
      {sendVisible && (
        <button
          type="button"
          className={styles.send}
          disabled={sendDisabled || input.disabled}
          aria-label={sendLabel}
          title={sendTitle}
          onClick={onSend}
        >
          ↵
        </button>
      )}
      {trailing}
    </div>
  )
}
