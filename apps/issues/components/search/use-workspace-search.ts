'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { SearchHit, SearchType } from '@/lib/search-types'

/** A value that follows `value` after it has been still for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The popup's data: `GET /api/workspaces/{ws}/issues-search`, debounced.
 *
 * `keepPreviousData` is what stops the list flashing empty between keystrokes —
 * the last answer stays on screen, dimmed, until the next one lands. `signal`
 * aborts a superseded request, so a slow answer to "ro" can never overwrite the
 * answer to "rollout".
 *
 * `type` narrows to one kind (the popup's chips); the server then lifts the
 * per-type cap, which is what makes a chip a "show me all of these".
 */
export function useWorkspaceSearch(slug: string | undefined, query: string, type: SearchType | null) {
  const trimmed = query.trim()
  const debounced = useDebounced(trimmed, 180)
  const result = useQuery({
    queryKey: ['ws-search', slug, debounced, type],
    enabled: !!slug && debounced.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ q: debounced })
      if (type) qs.set('type', type)
      const res = await fetch(`/api/workspaces/${slug}/issues-search?${qs}`, { signal })
      if (!res.ok) throw new Error(`search failed (${res.status})`)
      const body = (await res.json()) as { data: SearchHit[] }
      return body.data
    },
  })
  return {
    hits: debounced.length > 0 ? (result.data ?? []) : [],
    /** The query the visible `hits` answer — for highlighting, since it trails the input. */
    answeredQuery: debounced,
    /** True from the first keystroke until its answer lands (debounce + fetch). */
    pending: trimmed.length > 0 && (trimmed !== debounced || result.isFetching),
    /** True only when there is nothing to show yet — the skeleton case. */
    firstLoad: trimmed.length > 0 && result.data === undefined && !result.isError,
    error: result.isError,
    refetch: result.refetch,
  }
}
