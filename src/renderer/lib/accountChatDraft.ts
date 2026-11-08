import { useCallback, useSyncExternalStore } from 'react'

interface Draft {
  text: string
  revision: number
  saveError: string
}
const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()
const keyFor = (source: string, id: string) => `account-chat-draft:${source}:${id}`
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function accountChatDraft(source: string, id: string): Draft {
  const key = keyFor(source, id)
  let value = drafts.get(key)
  if (!value) {
    let text = ''
    try {
      text = (localStorage.getItem(key) ?? '').slice(0, 20000)
    } catch {
      /* session cache still works */
    }
    value = { text, revision: 0, saveError: '' }
    drafts.set(key, value)
  }
  return value
}
function write(source: string, id: string, text: string) {
  const key = keyFor(source, id)
  const previous = accountChatDraft(source, id)
  let saveError = ''
  try {
    if (text) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  } catch {
    saveError = 'Draft kept for this session only; local storage is unavailable.'
  }
  drafts.set(key, { text, revision: previous.revision + 1, saveError })
  listeners.forEach((listener) => listener())
}
/** Completion owns cleanup even if its view closed; never clear a subsequently edited draft. */
export function clearSentAccountChatDraft(source: string, id: string, submitted: Draft) {
  if (accountChatDraft(source, id) === submitted) write(source, id, '')
}
export function useAccountChatDraft(source: string, id: string) {
  const snapshot = useSyncExternalStore(subscribe, () => accountChatDraft(source, id))
  const setDraft = useCallback((text: string) => write(source, id, text), [source, id])
  return { draft: snapshot.text, saveError: snapshot.saveError, setDraft }
}
