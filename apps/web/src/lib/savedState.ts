import { useEffect, useState } from 'react'

import { useAuth } from '../auth/context'

/**
 * A value that survives leaving the page and coming back: the dates a person
 * picked stay picked. Kept in this browser, per person, so the Owner's and a
 * seller's choices on the same machine never mix. Storage can be blocked
 * (private windows), in which case it simply starts fresh each time.
 */
export function useSavedState<T>(key: string, initial: T | (() => T)) {
  const { user } = useAuth()
  const storageKey = `antetech.saved.${user?.id ?? 'anon'}.${key}`

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {
      // Unreadable or blocked: fall back to the default.
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // Blocked storage: the choice lasts until the page is left.
    }
  }, [storageKey, value])

  return [value, setValue] as const
}
