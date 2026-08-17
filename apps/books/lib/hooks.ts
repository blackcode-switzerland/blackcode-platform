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
import { apiGet } from './client'
import { booksGlobalKey, type Scope } from './query-keys'
import type { Entity, Term } from './types'
import type { BilanGroup, CrLine } from './statements'

/**
 * `GET /api/meta`, exactly as the route serves it.
 *
 * ── THIS IS NOT `BooksMeta` FROM lib/types.ts, AND THAT IS A REAL MISMATCH ──
 * `lib/types.ts` declares `entities: Entity[]`. The route
 * (`app/api/meta/route.ts`) serves `entities: { source, note, data }` — the
 * envelope that carries `source: "fixture" | "database"`, which is the field the
 * whole phase-0 contract turns on.
 *
 * The route is right and the type is stale. This interface describes what is
 * actually on the wire, because typing against the declaration would have made
 * every screen compile and then read `undefined` at runtime. Raised with the
 * backend dev — see the report; it is his file to correct.
 */
export interface MetaPayload {
  app: 'books'
  entities: {
    /** `"fixture"` until phase 1 serves these from `books.entity`. Rendered. */
    source: 'fixture' | 'database'
    note?: string
    data: Entity[]
  }
  exercices: number[]
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
 * Look one book up by slug, from the meta payload.
 *
 * Not a hook and not a fetch — a lookup over data the caller already has, so a
 * chip does not cause a request. Returns null for an unknown slug rather than
 * throwing: `?entity=deleted-book` is a URL somebody can type or bookmark, and
 * the recovery is a message, not a crash.
 */
export function findEntity(meta: MetaPayload | undefined, slug: string | null): Entity | null {
  if (!meta || !slug) return null
  return meta.entities.data.find((e) => e.slug === slug) ?? null
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
