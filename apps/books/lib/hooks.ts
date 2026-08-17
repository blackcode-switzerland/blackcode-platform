'use client'

// The query hooks every page reads through.
//
// ── EVERY READ IN THIS APP ENTERS HERE ──────────────────────────────────────
// Components call these. They do not call `apiGet`, they do not call `fetch`,
// and they never import `fixtures/mockup.json` — see lib/client.ts's header and
// `apps/books/docs/frontend.md` §3. The fixture rule is the one this repo has no
// guard for: a JSON import is not a `fetch`, so nothing goes red. It is held by
// review and by every read being here instead.
//
// ── EVERY KEY COMES FROM lib/query-keys.ts ──────────────────────────────────
// Not from an array literal. `lib/query-keys.test.ts` scans this file and fails
// if a `queryKey:` is written any other way, because the danger in this app is a
// key that quietly omits which BOOK it is about.

import { useQuery } from '@tanstack/react-query'
import { apiGet, apiList } from './client'
import { booksGlobalKey, booksKey, type Scope } from './query-keys'
import type { Entity, Term } from './types'
import type { BilanGroup, CrLine } from './statements'

/**
 * `GET /api/meta`, exactly as the route serves it.
 *
 * ── THIS IS NOT `BooksMeta` FROM lib/types.ts, AND THAT IS A REAL MISMATCH ──
 * `lib/types.ts` still declares `entities: Entity[]` and an `exercices` array.
 * The route serves neither. This interface describes what is actually on the
 * wire, because typing against the declaration would make every screen compile
 * and then read `undefined` at runtime. It is the backend dev's file to correct.
 *
 * ── AND THE BOOKS LEFT THIS PAYLOAD IN PHASE 1 ─────────────────────────────
 * `entities` used to carry `data: Entity[]` from the mockup fixture, and
 * `exercices` a flat `number[]`. Phase 1 made both workspace-scoped rows, so
 * `/api/meta` — which is not workspace-scoped and is served unauthenticated —
 * cannot answer for them and no longer tries. What is left is a POINTER at the
 * routes that can.
 *
 * **This broke the book and year switchers silently**, which is the part worth
 * remembering. Nothing threw: `meta.entities.data` became `undefined`, the
 * switchers found nothing, and the overview rendered "You have no books yet"
 * over a workspace holding three books and seventeen entries. A confident wrong
 * answer, not an error. Use `useEntities` and `useExercices` below; they are
 * workspace-scoped because the data is.
 */
export interface MetaPayload {
  app: 'books'
  /**
   * A pointer, not a list. `source` says where the books really live and is the
   * field to watch — a screen that ships against fixture data believing it is
   * real is what it exists to prevent.
   */
  entities: {
    source: 'fixture' | 'database'
    table?: string
    note?: string
  }
  vocabularies: {
    recognition: Term[]
    evidence_tiers: Term[]
    entry_status: Term[]
    source_types: Term[]
    source_layers: Term[]
    source_status: Term[]
    manifest_states: Term[]
  }
  tva_rates: number[]
  statements: {
    bilan: readonly BilanGroup[]
    cr: readonly CrLine[]
  }
}

/** A vocabulary name, so a chip can ask for one by key rather than by import. */
export type VocabularyName = keyof MetaPayload['vocabularies']

/**
 * The books, the fiscal years, the vocabularies and the statutory line
 * structures — the entire dynamic contract, in one request.
 *
 * `booksGlobalKey`, deliberately: this payload describes EVERY book at once, so
 * it is one of the two reads in the app that is not entity-scoped. Scoping it
 * would refetch the same bytes once per book.
 *
 * Ten minutes. The vocabularies and the law change on a deploy, not on a write —
 * `bk meta` is the live source for an agent, and a browser tab that is ten
 * minutes behind on the legal structure of the balance sheet is not a problem
 * this product has.
 */
export function useMeta() {
  return useQuery({
    queryKey: booksGlobalKey('meta'),
    queryFn: () => apiGet<MetaPayload>('/api/meta'),
    staleTime: 1000 * 600,
  })
}

/**
 * The signed-in person's own account row — name, email, photo.
 *
 * ── WHY NOT `useSession()`, WHICH IS ALREADY THERE ──────────────────────────
 * The next-auth session is minted at SIGN-IN and this app's `jwt` callback only
 * refreshes it when `account` is present, i.e. on sign-in. So `session.user
 * .image` is the photo as it was when you last signed in — and the account is
 * shared with every other blackcode app, so it goes stale two ways: you change
 * your photo here, or you change it in another app and this one never hears.
 *
 * `GET /api/me` is the live row. The session stays the source for *identity* —
 * who you are, whether you are signed in — and this is the source for what to
 * DRAW. `apps/issues` and `apps/sales` both settled it the same way.
 */
export interface MeRow {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  connected_google: boolean
  avatar_editable: boolean
  is_super_admin: boolean
}

export function useMe() {
  return useQuery({
    queryKey: booksGlobalKey('me'),
    queryFn: () => apiGet<MeRow>('/api/me'),
    staleTime: 60_000,
  })
}

/**
 * The books in this workspace. `GET /api/workspaces/{ws}/entities`.
 *
 * Workspace-scoped, and NOT entity-scoped: this is the list you choose a book
 * from, so scoping it to a book would be circular. `booksKey` with an empty
 * scope rather than `booksGlobalKey`, because two workspaces hold different
 * books and their ids overlap.
 *
 * A person with no books gets `[]`, which is a real and expected state — a new
 * employee has none until they create one. It is not an error and must not be
 * drawn as one.
 */
export function useEntities(ws: string | undefined) {
  return useQuery({
    queryKey: booksKey('entities', { entity: null, exercice: null }, { ws }),
    queryFn: () => apiList<Entity>(`/api/workspaces/${ws}/entities`).then((r) => r.data),
    enabled: !!ws,
    staleTime: 60_000,
  })
}

/** One fiscal year of one book, as `GET …/exercices` serves it. */
export interface ExerciceRow {
  year: number
  starts_on: string
  ends_on: string
  status: 'open' | 'closed'
}

/**
 * The fiscal years. `GET /api/workspaces/{ws}/exercices`, filtered by book.
 *
 * Scoped by entity because each book keeps its own, and they are not
 * necessarily the same set — a book created this year has one where an older one
 * has several. Passing no entity asks for the whole workspace's, which is what
 * an unscoped screen wants.
 */
export function useExercices(ws: string | undefined, entity: string | null) {
  return useQuery({
    queryKey: booksKey('exercices', { entity, exercice: null }, { ws }),
    queryFn: () =>
      apiList<ExerciceRow>(
        `/api/workspaces/${ws}/exercices${entity ? `?entity=${encodeURIComponent(entity)}` : ''}`
      ).then((r) => r.data),
    enabled: !!ws,
    staleTime: 60_000,
  })
}

/**
 * Look one book up by slug, in a list the caller already has.
 *
 * Not a hook and not a fetch, so a chip does not cause a request. Returns null
 * for an unknown slug rather than throwing: `?entity=deleted-book` is a URL
 * somebody can type or bookmark, and the recovery is a message, not a crash.
 *
 * It takes the LIST now, not the meta payload — the books left that payload in
 * phase 1. See the note on `MetaPayload`.
 */
export function findEntity(entities: Entity[] | undefined, slug: string | null): Entity | null {
  if (!entities || !slug) return null
  return entities.find((e) => e.slug === slug) ?? null
}

/**
 * Look one vocabulary term up by value.
 *
 * **This is how a chip gets its colour** — from the served vocabulary, never
 * from CSS and never from a switch statement. An unknown value returns null and
 * the chip renders the raw value uncoloured, which is the correct behaviour for
 * a term added on the server before this bundle shipped: legible, honest, and
 * fixed by a reload rather than by a release.
 */
export function findTerm(
  meta: MetaPayload | undefined,
  vocabulary: VocabularyName,
  value: string | null
): Term | null {
  if (!meta || !value) return null
  return meta.vocabularies[vocabulary]?.find((t) => t.value === value) ?? null
}

/**
 * Re-exported so a page importing a scope type does not need two imports. The
 * TYPE only — `booksKey` itself stays in `lib/query-keys.ts`, which is what the
 * scanner in its test reads.
 */
export type { Scope }
