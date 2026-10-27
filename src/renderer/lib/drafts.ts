import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

// Chat ids include the provider namespace. These drafts never become a new chat's input
// when the list switches provider, and are kept in memory rather than written to Codex.
const drafts = new Map<string, unknown>()
export function useDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial))
  const update: Dispatch<SetStateAction<T>> = useCallback(
    (next) =>
      setValue((previous) => {
        const result = typeof next === 'function' ? (next as (v: T) => T)(previous) : next
        drafts.set(key, result)
        return result
      }),
    [key],
  )
  return [value, update]
}
