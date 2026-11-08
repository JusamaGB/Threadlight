import { chatSourceName, type ChatSource } from '../../shared/accountChats'
import { useState } from 'react'
import type { SettingsPatch } from '../../shared/settings'
import { ProviderChoices } from './ProviderChoices'
import { refreshAccountChats, useAccountChatState } from '../hooks/useAccountChats'
import styles from './Settings.module.css'

export function AccountChatSettings({
  sources,
  save,
}: {
  sources: ChatSource[]
  save: (patch: SettingsPatch) => Promise<boolean>
}) {
  const state = useAccountChatState()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <ProviderChoices
        label="Chat providers shown"
        options={[
          { value: 'chatgpt', label: 'ChatGPT' },
          { value: 'perplexity', label: 'Perplexity' },
        ]}
        selected={sources}
        disabled={saving}
        onChange={(chatSources: ChatSource[]) =>
          void (async () => {
            setSaving(true)
            setError('')
            try {
              if (!(await save({ chatSources }))) setError('Could not save chat providers.')
            } catch {
              setError('Could not save chat providers.')
            } finally {
              setSaving(false)
            }
          })()
        }
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {sources
        .filter((source) => state[source].error)
        .map((source) => (
          <div key={source} data-chat-connection-error={source}>
            <p className={styles.error} role="status">
              {chatSourceName(source)}: {state[source].error}
            </p>
            <button
              disabled={state[source].busy}
              aria-label={`Retry ${chatSourceName(source)} connection`}
              onClick={() => void refreshAccountChats(source)}
            >
              Retry
            </button>
          </div>
        ))}
    </>
  )
}
