import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { NavigationHistory, type NavigationDirection } from '../../shared/navigationHistory'

export type NavigationCache = Map<string, NavigationHistory<unknown>>
export const NavigationHistoryContext = createContext<NavigationCache | null>(null)

export function useNavigationHistory<T>(
  value: T,
  restore: (value: T) => void,
  enabled = true,
  cacheKey?: string,
) {
  const cache = useContext(NavigationHistoryContext)
  const [history] = useState(() => {
    if (!cache || !cacheKey) return new NavigationHistory<T>()
    if (!cache.has(cacheKey)) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!)
      cache.set(cacheKey, new NavigationHistory<unknown>())
    }
    return cache.get(cacheKey)! as NavigationHistory<T>
  })
  const hydrate = useRef(!!cacheKey)
  const pending = useRef<string | null>(null)
  const current = useRef({ value, restore, enabled })
  useLayoutEffect(() => {
    current.current = { value, restore, enabled }
    if (!enabled) return
    const key = JSON.stringify(value)
    if (hydrate.current) {
      hydrate.current = false
      const saved = history.current
      if (saved !== undefined && JSON.stringify(saved) !== key) {
        pending.current = JSON.stringify(saved)
        restore(saved)
        return
      }
    }
    if (pending.current !== null && pending.current !== key) return
    pending.current = null
    history.record(value)
  }, [value, enabled, restore, history])
  const navigate = useCallback(
    (direction: NavigationDirection): boolean => {
      if (!current.current.enabled) return false
      if (pending.current) return true
      history.record(current.current.value)
      const next = history.travel(direction)
      if (next === undefined) return false
      current.current.restore(next)
      return true
    },
    [history],
  )
  return useMemo(() => ({ navigate }), [navigate])
}
