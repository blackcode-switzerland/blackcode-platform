'use client'

// Which book, and which fiscal year — read from the URL, written to the URL.
//
// ===========================================================================
// THE ENTITY IS A FILTER, NOT NAVIGATION
// ===========================================================================
// `?entity=blackcode` changes the numbers on the screen you are already on. It
// does not change the screen. That is how the mockup does it and it is why the
// slug is a query parameter rather than a path segment: the balance sheet of one
// book and the balance sheet of another are the same page asked a different
// question, and a reader switching books expects to stay where they were.
//
// The URL is the source of truth rather than React state, and that buys three
// things a `useState` would not: the address bar is shareable, the browser back
// button undoes a switch, and a page reload lands on the same book.
//
// ── AN UNKNOWN SLUG IS KEPT, NOT SILENTLY REPLACED ─────────────────────────
// `?entity=typo` returns `entity: 'typo'` with `record: null`, and the caller
// renders "no such book". Falling back to the first book instead would show real
// numbers under a name the user did not ask for — which is the same failure as a
// cache-key bug, arrived at from the other direction. **A wrong book that says
// so beats a wrong book that looks right.**
//
// ── THE DEFAULT IS POSITIONAL, AND THAT IS SAFE HERE ───────────────────────
// With no `?entity=` at all, the first served book is used. That IS a guess, but
// it is a visible one: the switcher in the top bar names the book, so the reader
// can see which one they are in. Nothing may assume there are three books, or
// which one is first — see decision D-D.

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMeta, type MetaPayload } from './hooks'
import type { Entity } from './types'
import type { Scope } from './query-keys'

/** The query parameters. Spelled once — two spellings is a switcher that half works. */
export const ENTITY_PARAM = 'entity'
export const EXERCICE_PARAM = 'exercice'

export interface ScopeState extends Scope {
  /** The book the slug resolves to, or null when the slug matches nothing. */
  record: Entity | null
  /** Every book this account has. Any number, including zero. */
  entities: Entity[]
  /** Every fiscal year present. One today; the control is built for more. */
  exercices: number[]
  /** `"fixture"` until the backend's phase 1. Surfaced, never hidden. */
  source: 'fixture' | 'database' | null
  meta: MetaPayload | undefined
  isLoading: boolean
  error: unknown
  setEntity: (slug: string) => void
  setExercice: (year: number) => void
}

export function useScope(): ScopeState {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const params = useSearchParams()
  const { data: meta, isLoading, error } = useMeta()

  const entities = useMemo(() => meta?.entities.data ?? [], [meta])
  const exercices = useMemo(() => meta?.exercices ?? [], [meta])

  const requestedEntity = params?.get(ENTITY_PARAM) ?? null
  const entity = requestedEntity ?? entities[0]?.slug ?? null
  const record = entities.find((e) => e.slug === entity) ?? null

  // The requested year if it is one the data actually has; otherwise this book's
  // own exercice; otherwise the latest served. Parsed with `Number`, and
  // rejected unless it is in the list — `?exercice=NaN` and `?exercice=1066` are
  // both a URL somebody can type.
  const requestedExercice = Number(params?.get(EXERCICE_PARAM))
  const exercice = exercices.includes(requestedExercice)
    ? requestedExercice
    : (record?.exercice ?? exercices[exercices.length - 1] ?? null)

  // One writer for both controls. `replace`, not `push`: switching book five
  // times should not need five presses of Back to leave the page — the last
  // choice is what the reader wants undone, not each one.
  //
  // Every OTHER parameter is preserved. The ledger's `?account=1020` must
  // survive a book switch, or drilling in and then comparing books silently
  // resets the drill-down.
  const write = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params?.toString() ?? '')
      next.set(key, value)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router]
  )

  const setEntity = useCallback((slug: string) => write(ENTITY_PARAM, slug), [write])
  const setExercice = useCallback((year: number) => write(EXERCICE_PARAM, String(year)), [write])

  return {
    entity,
    exercice,
    record,
    entities,
    exercices,
    source: meta?.entities.source ?? null,
    meta,
    isLoading,
    error,
    setEntity,
    setExercice,
  }
}
