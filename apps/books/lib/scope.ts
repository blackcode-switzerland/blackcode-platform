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

import { createContext, useCallback, useContext, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEntities, useExercices, useMeta, type MetaPayload } from './hooks'
import type { Entity } from './types'
import type { Scope } from './query-keys'

/**
 * The workspace slug, for the hooks that need it.
 *
 * ── WHY A CONTEXT AND NOT THE URL ──────────────────────────────────────────
 * Phase 1 moved the books and the fiscal years out of `/api/meta` and into
 * `/api/workspaces/{ws}/…`, so `useScope` needs a slug it never used to need.
 * Reading it out of the pathname would be right for `/dashboard/{ws}/…` and
 * WRONG for `/dashboard/settings`, whose second segment is the literal word
 * "settings" — the settings page resolves a real workspace server-side and
 * mounts the same shell. Deriving it would send that page to
 * `/api/workspaces/settings/entities` and draw the 404 as an error.
 *
 * So it comes from the layout that already knows it, which is also the only
 * thing in the app that does.
 */
const WorkspaceSlug = createContext<string | undefined>(undefined)

export const WorkspaceSlugProvider = WorkspaceSlug.Provider

/** The slug of the workspace this subtree is rendering. */
export function useWorkspaceSlug(): string | undefined {
  return useContext(WorkspaceSlug)
}

/** The query parameters. Spelled once — two spellings is a switcher that half works. */
export const ENTITY_PARAM = 'entity'
export const EXERCICE_PARAM = 'exercice'

export interface ScopeState extends Scope {
  /** The book the slug resolves to, or null when the slug matches nothing. */
  record: Entity | null
  /** Every book this account has. Any number, including zero. */
  entities: Entity[]
  /** Every fiscal year this book has. One today; the control is built for more. */
  exercices: number[]
  /**
   * Have this book's fiscal years ARRIVED?
   *
   * ── WHY A SCREEN NEEDS THIS AND CANNOT DERIVE IT ──────────────────────────
   * `exercice` is null in two completely different situations: the years have
   * not loaded yet, and the book genuinely has none (`entity create` does not
   * open one). A screen reading only `exercice === null` cannot tell them apart.
   *
   * **It was found by the cache test, on 2026-08-18.** Switching book, this is
   * the sequence of frames the instrumented switch recorded:
   *
   *     blackcode SA · exercice 2026    ← before
   *     AIOS Companion SA · exercice —  ← the new book, its years still in flight
   *     AIOS Companion SA · exercice 2026
   *
   * In that middle frame every statutory hook was enabled with `exercice: null`,
   * so it requested `…/bilan?entity=aios` with no year — and `resolveScope` on
   * the server answers a missing year with **the book's newest exercice**. That
   * answer is a real balance sheet for a year the reader did not choose, cached
   * under `{entity:'aios', exercice:null}`, and it would render under a heading
   * reading "exercice —". It did not render here only because the request had
   * not come back before the year resolved.
   *
   * A default taken on the server is exactly the failure the phase-1 README
   * names ("a year defaulting to a closed exercice"), arriving one layer down.
   * So the statutory hooks wait for this flag; see `lib/hooks.ts`.
   */
  exercicesReady: boolean
  /** Where the books really come from, as `/api/meta` reports it. Surfaced. */
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
  const ws = useWorkspaceSlug()
  const { data: meta, isLoading: metaLoading, error: metaError } = useMeta()
  const { data: books, isLoading: booksLoading, error: booksError } = useEntities(ws)

  const entities = useMemo(() => books ?? [], [books])

  const requestedEntity = params?.get(ENTITY_PARAM) ?? null
  const entity = requestedEntity ?? entities[0]?.slug ?? null
  const record = entities.find((e) => e.slug === entity) ?? null

  // Scoped to the resolved book, because each one keeps its own years and they
  // are not the same set — a book opened this year has one where an older one
  // has several.
  const { data: years, isPending: yearsPending, isFetched: yearsFetched } = useExercices(
    ws,
    record?.slug ?? null
  )

  /**
   * The years, deduplicated and newest first.
   *
   * ── BOTH HALVES OF THAT ARE BUGS THAT HAPPENED ─────────────────────────────
   * DEDUPED, because an UNSCOPED request returns one row per book per year:
   * three books sharing 2026 gave `[2026, 2026, 2026, 2025]`. Rendered straight
   * into a `<select>` that is four options, two of them indistinguishable, on
   * duplicate React keys.
   *
   * NEWEST FIRST, because the default below used to take the LAST element on the
   * assumption the list was ascending. The route serves it descending, so the
   * app opened on **2025 — a closed exercice** — and would have shown every
   * screen a year of finished books by default. Sorting here rather than
   * trusting either order is what makes the default below mean what it says.
   */
  const exercices = useMemo(
    () => [...new Set((years ?? []).map((y) => y.year))].sort((a, b) => b - a),
    [years]
  )

  /** The newest year still open, which is the one a person is working in. */
  const currentYear = useMemo(() => {
    const open = (years ?? []).filter((y) => y.status === 'open').map((y) => y.year)
    return open.length ? Math.max(...open) : (exercices[0] ?? null)
  }, [years, exercices])

  // The requested year if it is one the data actually has, otherwise the current
  // one. Parsed with `Number` and rejected unless it is in the list —
  // `?exercice=NaN` and `?exercice=1066` are both a URL somebody can type.
  const requestedExercice = Number(params?.get(EXERCICE_PARAM))
  const exercice = exercices.includes(requestedExercice) ? requestedExercice : currentYear

  // Both reads gate the screen. The books matter more — a screen that renders
  // "you have no books" while the list is still in flight is the silent wrong
  // answer this whole change exists to remove.
  const isLoading = metaLoading || booksLoading
  const error = metaError ?? booksError

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
    // `isFetched` and not `!isPending`: a query that is DISABLED is "pending"
    // forever, and the years query is disabled until `ws` is known. Reading
    // `!isPending` would hold every statement read on a page that has a
    // workspace but is still resolving one, which is a permanent skeleton. What
    // this must mean is "this book's years have been answered for", and once
    // there is no book to ask about there is nothing to wait for either.
    exercicesReady: record === null ? true : yearsFetched && !yearsPending,
    source: meta?.entities.source ?? null,
    meta,
    isLoading,
    error,
    setEntity,
    setExercice,
  }
}
