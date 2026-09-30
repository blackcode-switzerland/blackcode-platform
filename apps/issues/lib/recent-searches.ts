// The last few things a person searched for, remembered per workspace in the
// browser. A convenience and nothing more: it lives in localStorage, never
// reaches the server or `bk`, and every access is wrapped because storage can be
// absent, full or throw (private windows, blocked site data, SSR).

const MAX_RECENT = 6

/** The subset of `Storage` used, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const key = (workspaceSlug: string) => `bc-issues:recent-searches:${workspaceSlug}`

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readRecentSearches(workspaceSlug: string, store: KeyValueStore | null = defaultStore()): string[] {
  if (!store) return []
  try {
    const parsed: unknown = JSON.parse(store.getItem(key(workspaceSlug)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

/** Remember `query` most-recent-first, case-insensitively de-duplicated. Returns the new list. */
export function pushRecentSearch(
  workspaceSlug: string,
  query: string,
  store: KeyValueStore | null = defaultStore()
): string[] {
  const q = query.trim().replace(/\s+/g, ' ')
  const current = readRecentSearches(workspaceSlug, store)
  if (!q || !store) return current
  const next = [q, ...current.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT)
  try {
    store.setItem(key(workspaceSlug), JSON.stringify(next))
  } catch {
    /* quota or blocked storage: the popup works without it */
  }
  return next
}

export function clearRecentSearches(workspaceSlug: string, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(key(workspaceSlug), '[]')
  } catch {
    /* see above */
  }
}
