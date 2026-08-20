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
import type { Locale } from '@blackcode/platform-i18n'
import { apiGet, apiList, ApiRequestError } from './client'
import { booksGlobalKey, booksKey, type Scope } from './query-keys'
import type { TokenSummary } from './account'
import type { Journal } from './journal'
import type {
  Account,
  Analysis,
  AnalytiqueCategoryConfig,
  AnalytiqueResult,
  BilanResult,
  ComplianceRule,
  CrResult,
  Entity,
  Entry,
  InboxPiece,
  ManifestResult,
  OverviewBook,
  OverviewResult,
  PatrimoineSnapshot,
  PieceExtraction,
  PieceTransaction,
  RecognitionRule,
  RiEntry,
  Source,
  SourceDetail,
  TaxSnapshotResult,
  Term,
  WorklistResult,
  WorklistRow,
} from './types'
import type { BilanGroup, CrLine } from './statements'

/**
 * `GET /api/meta`, exactly as the route serves it.
 *
 * ── IT USED TO HAVE A RIVAL IN lib/types.ts, AND THE RIVAL IS GONE ─────────
 * `BooksMeta` there declared `entities: Entity[]` and an `exercices` array. The
 * route serves neither, and typing against it would make every screen compile
 * and then read `undefined` at runtime. It was DELETED on 2026-08-18 rather than
 * corrected: two declarations of one payload is how the next one goes stale, and
 * this is the one the hooks read.
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
   * The platform half — who you are, where you are, and WHERE EVERY APP LIVES.
   *
   * All null/empty for an anonymous caller, which is the state the vocabulary
   * half is served for. `apps` is the one the CLI depends on: `bk login` and
   * `bk meta` build their address book from `apps.<slug>.base_url`, and until
   * 2026-08-20 this route served none, so logging in against a books server
   * wrote an EMPTY registry and every `bk books …` failed with "no app registry
   * yet" (Bala's #57, blocking for deployment).
   *
   * Held loosely on purpose. The shapes belong to `@blackcode/platform-api`,
   * this app only forwards them, and a narrower type here would be a second
   * declaration of somebody else's payload that silently drops what it adds —
   * the mistake `MetaApp.Raw` on the CLI side exists to avoid.
   */
  user: { id: number; email: string; name: string | null } | null
  active_workspace: { id: number; slug: string; name: string } | null
  workspaces: { id: number; slug: string; name: string; role: string }[]
  current_app: Record<string, unknown> | null
  apps: Record<string, { name: string; base_url: string | null; is_current: boolean }> | null
  links: Record<string, unknown> | null
  cli: Record<string, unknown> | null
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
    /**
     * Phase 5's three, added 2026-08-19 — and they had been on the wire since
     * that morning without this type knowing, because `/api/meta` is the one
     * payload `wire-parity` does not pin (the cleanup review's F-4, still open).
     * A chip asking for `verdict_states` was a compile error rather than a
     * missing colour only because `VocabularyName` is derived from these keys.
     */
    verdict_states: Term[]
    rule_review_states: Term[]
    rule_confidence: Term[]
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
  /**
   * The chosen interface language — **or `null`, meaning never chosen**.
   *
   * Not the RESOLVED locale. The route serves the column, so this field can say
   * "no preference" and the settings page can render "Follow my browser" as the
   * state it is actually in. What is on screen right now is `useLocale()`, which
   * is the resolution of this plus the cookie plus `Accept-Language`.
   */
  locale: Locale | null
}

export function useMe() {
  return useQuery({
    queryKey: booksGlobalKey('me'),
    queryFn: () => apiGet<MeRow>('/api/me'),
    staleTime: 60_000,
  })
}

/**
 * Your API tokens. `GET /api/tokens`.
 *
 * ── THEY ARE NOT b/books TOKENS, AND THE KEY SAYS SO ──────────────────────
 * `platform.api_tokens` is ONE table for the whole suite: a token minted here
 * reaches b/issues and b/sales too, and one revoked in either of them stops
 * working here. So the key is `booksGlobalKey` — nothing about this list is
 * scoped to a workspace or to a book, and putting a scope on it would be a claim
 * that a second workspace has a second set of tokens. It does not.
 *
 * `staleTime: 0`. Every other read in this file caches for a minute, because a
 * ledger does not move while you look at it. This one does: the person reading
 * it is usually mid-way through `bk login` in another window, and a minute-old
 * list that is missing the token they just minted reads as the CLI having
 * failed.
 */
export function useTokens() {
  return useQuery({
    queryKey: booksGlobalKey('tokens'),
    queryFn: () => apiGet<TokenSummary[]>('/api/tokens'),
    staleTime: 0,
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

// ===========================================================================
// THE STATUTORY READS — phase 1's seven screens
// ===========================================================================
// Every one of these is `booksKey`, never `booksGlobalKey`, and every one takes
// the whole `Scope`. Two books' balance sheets are two different documents that
// happen to have the same line names, and the cache slot is the only thing
// standing between them.
//
// ── `enabled` IS PART OF THE CORRECTNESS, NOT AN OPTIMISATION ──────────────
// A statement read fires only when the workspace AND the book are both known.
// Without the `entity` guard the first render of every scoped screen would ask
// `…/bilan` with no `?entity=`, and `resolveScope` answers that with **the first
// book in the workspace** — real numbers, under whichever name the header had
// finished rendering. The result would then sit in the cache under
// `{entity: null}` and be indistinguishable from a deliberate answer.
//
// ── THE PARAMETERS ARE ALWAYS SENT EXPLICITLY ─────────────────────────────
// `?entity=&exercice=` on every request, never relying on the route's defaults,
// for the same reason: a default is a book somebody else chose.

/**
 * The scope a statutory read takes.
 *
 * ── WHY IT IS NOT JUST `Scope` ────────────────────────────────────────────
 * Because `exercice: null` is ambiguous — the years are still loading, or the
 * book has none. Firing on the first is how a screen gets a balance sheet for a
 * year nobody chose: with no `?exercice=`, `resolveScope` on the server picks
 * the book's newest, which is a real answer to a question the reader did not
 * ask. **Watched happen on 2026-08-18 while running the cache test**; the frame
 * sequence is recorded in `ScopeState.exercicesReady` in `lib/scope.ts`.
 *
 * The field is optional so a caller that builds a bare `Scope` — a test, a
 * future screen with a fixed year — is not forced to say `true`. Undefined means
 * "nothing to wait for". `useScope()` always supplies it, so every screen in the
 * app gets the guard by passing the object it already has.
 */
export type ReadScope = Scope & { exercicesReady?: boolean }

/** Are this scope's years settled? Undefined means the caller is not waiting. */
function scopeReady(scope: ReadScope): boolean {
  return scope.exercicesReady !== false
}

/** `?entity=…&exercice=…`, built once so no hook can forget half of it. */
function scopeQuery(scope: Scope, extra?: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  if (scope.entity) q.set('entity', scope.entity)
  if (scope.exercice != null) q.set('exercice', String(scope.exercice))
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v)
  return q.toString()
}

/** Both statement routes refuse a simplified book by CODE. This is that test. */
export const SIMPLIFIED_REFUSALS = ['no_bilan_for_simplified', 'no_cr_for_simplified'] as const

/**
 * Is this error the statutory refusal rather than a failure?
 *
 * ── IT MATCHES THE `code`, NEVER THE MESSAGE ──────────────────────────────
 * The message names the book and is French-inflected prose; the code is the
 * contract (`lib/client.ts`, `ApiError`). Matching prose would be a screen state
 * that breaks when somebody rewords an error.
 *
 * **This is not a red box.** A sole proprietorship legally has no bilan and no
 * compte de résultat (art. 957 al. 2 CO); the request succeeded in telling us so.
 * `<SimplifiedBookNotice>` renders it, with the route's own `suggestion`.
 */
export function isSimplifiedRefusal(error: unknown): error is ApiRequestError {
  return (
    error instanceof ApiRequestError &&
    (SIMPLIFIED_REFUSALS as readonly string[]).includes(error.code)
  )
}

/**
 * The balance sheet. `GET …/bilan?entity=&exercice=`.
 *
 * Art. 959a, every legal line including the zeroes, plus `balanced` and `ecart`
 * — which the screen is required to render. A `no_bilan_for_simplified` 400
 * arrives as an error here and is a SCREEN STATE, not a failure; see
 * `isSimplifiedRefusal`.
 */
export function useBilan(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('bilan', scope, { ws }),
    queryFn: () => apiGet<BilanResult>(`/api/workspaces/${ws}/bilan?${scopeQuery(scope)}`),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * The compte de résultat. `GET …/compte-resultat`. Art. 959b, ten lines.
 *
 * ── IT ALWAYS ASKS FOR `by=month`, AND THAT IS ONE REQUEST, NOT TWO ────────
 * Ticket #64 added a monthly grid to this one screen. The obvious shape — an
 * annual query and a monthly query, keyed apart, swapped by a toggle — is the
 * thing the route's own header refuses: *"making it ask twice for two views of
 * one statement would invite them to be read from different moments."*
 *
 * So there is ONE query and ONE cache entry. The response carries the annual
 * body unchanged plus `months`, the toggle chooses which of the two it draws,
 * and the total under a twelve-column grid is byte-for-byte the number the
 * annual view showed a second earlier because it is the same object.
 *
 * The cost is that the annual view pays for a breakdown it is not drawing:
 * twelve `crFor` passes over rows the server has already loaded, bounded by the
 * exercice. That is the cheap side of the trade — the expensive side is two
 * statements of one year, fetched at two moments, that a reader cannot tell
 * apart.
 *
 * A simplified book is refused before any of this: `no_cr_for_simplified` is
 * raised on the regime, above the breakdown, so the extra parameter changes
 * nothing about that path. See `isSimplifiedRefusal`.
 */
export function useCompteResultat(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('compte-resultat', scope, { ws, by: 'month' }),
    queryFn: () =>
      apiGet<CrResult>(`/api/workspaces/${ws}/compte-resultat?${scopeQuery(scope)}&by=month`),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * Every book, with whichever statement its legal form has. `GET …/overview`.
 *
 * ── WORKSPACE-SCOPED AND NOT BOOK-SCOPED, DELIBERATELY ────────────────────
 * This is the one statutory read that is about ALL the books at once, so it
 * carries an empty scope — the same spelling `useEntities` uses. It is still
 * `booksKey` and not `booksGlobalKey`: two workspaces hold different books and
 * their ids overlap, so "every book" is not a global fact.
 */
export function useOverview(ws: string | undefined) {
  return useQuery({
    queryKey: booksKey('overview', { entity: null, exercice: null }, { ws }),
    queryFn: () =>
      apiGet<OverviewResult>(`/api/workspaces/${ws}/overview`).then((r) => r.books ?? []),
    enabled: !!ws,
  })
}

/** The chart of accounts for one book. `GET …/accounts`. 26 rows per book. */
export function useAccounts(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('accounts', scope, { ws }),
    queryFn: () =>
      apiList<Account>(`/api/workspaces/${ws}/accounts?${scopeQuery(scope)}`).then((r) => r.data),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/** The filters `GET …/entries` accepts. Each one is part of the cache key. */
export interface EntryFilters {
  status?: string
  recognition?: string
  /** `?account=1020` — where the income statement's drill-down lands. */
  account?: string
}

/**
 * The grand livre. `GET …/entries`, for a DOUBLE-ENTRY book only.
 *
 * ===========================================================================
 * ONE ROUTE, TWO SHAPES, TWO HOOKS — AND TWO CACHE SLOTS
 * ===========================================================================
 * Since phase 4A `GET …/entries` serves the grand livre for a double-entry book
 * and the recettes-dépenses journal for a simplified one, with **no marker field
 * on the wire**: the caller named the book, so the caller knows which shape it
 * gets. `lib/journal.ts` is where that is decided, and this hook takes the
 * decision rather than making it.
 *
 * It is TWO hooks and not one returning a union, for two reasons that are not
 * the same reason:
 *
 *   1. **A union would be typed loosely at every call site.** A screen would
 *      narrow it with a check the compiler cannot tie back to the request, and
 *      the phase-1 lesson is that a wire shape which changes does not fail to
 *      compile.
 *   2. **The CACHE SLOT would be shared.** `booksKey('entries', …)` carries the
 *      entity, so two books never collide today — but one resource name holding
 *      two incompatible shapes is one refactor away from the failure at the top
 *      of `lib/query-keys.ts`. `ri-entries` is its own resource because it is
 *      its own document.
 *
 * `journal` is REQUIRED, and passing anything but `grand_livre` disables the
 * query rather than sending it. `null` means the book is not in hand yet, and a
 * request sent then is a request with no `?entity=` — which `resolveScope`
 * answers with **the first book in the workspace**, real numbers under a name
 * nobody chose. Same rule, and the same reason, as `enabled`'s note above.
 *
 * `?account=` returns WHOLE entries that touch the account, not just the
 * matching line, which is why a filtered row still shows both sides.
 *
 * The filters go into the key as well as the URL. A key that carried the scope
 * but not `account` would serve the unfiltered ledger from cache the moment the
 * reader drilled in — the same class of bug as the wrong book, one level down.
 */
export function useEntries(
  ws: string | undefined,
  scope: ReadScope,
  journal: Journal | null,
  filters: EntryFilters = {}
) {
  return useQuery({
    queryKey: booksKey('entries', scope, { ...filters, ws }),
    queryFn: () =>
      apiList<Entry>(
        `/api/workspaces/${ws}/entries?${scopeQuery(scope, {
          status: filters.status,
          recognition: filters.recognition,
          account: filters.account,
        })}`
      ).then((r) => r.data),
    // POSITIVE. `journal === 'grand_livre'`, never `!== 'recettes_depenses'` —
    // a third journal added server-side then fires nothing rather than firing
    // this. See `lib/journal.ts`.
    enabled: !!ws && !!scope.entity && scopeReady(scope) && journal === 'grand_livre',
  })
}

/** The filters an RI journal accepts. `status` and `account` are REFUSED there. */
export interface RiEntryFilters {
  recognition?: string
}

/**
 * The recettes-dépenses journal. `GET …/entries`, for a SIMPLIFIED book only.
 *
 * Same route, same query parameters minus two, different shape — see
 * `useEntries` above for why it is a second hook and `lib/types.ts`'s `RiEntry`
 * for what changes.
 *
 * ── `?status=` AND `?account=` ARE REFUSED HERE, NOT IGNORED ──────────────
 * `ri_no_such_filter`, 400: *"an RI journal has no posting status and no
 * accounts to filter by"*. They used to be silently dropped. This hook does not
 * take them — the type is the guard, so a caller cannot pass one and a screen
 * that wants to must decide out loud what to do with a filter that does not
 * apply. `filtersFor()` in `lib/journal.ts` is what a screen asks.
 */
export function useRiEntries(
  ws: string | undefined,
  scope: ReadScope,
  journal: Journal | null,
  filters: RiEntryFilters = {}
) {
  return useQuery({
    queryKey: booksKey('ri-entries', scope, { ...filters, ws }),
    queryFn: () =>
      apiList<RiEntry>(
        `/api/workspaces/${ws}/entries?${scopeQuery(scope, { recognition: filters.recognition })}`
      ).then((r) => r.data),
    enabled: !!ws && !!scope.entity && scopeReady(scope) && journal === 'recettes_depenses',
  })
}

/**
 * One écriture. `GET …/entries/{number}` — the workspace #number, never the id.
 *
 * ── THE ROUTE IS WORKSPACE-SCOPED, AND THE KEY IS BOOK-SCOPED ANYWAY ───────
 * `getEntryByNumber` looks the row up by `(workspace_id, seq)` and does not
 * filter by book, so #10 is #10 whichever book is selected. The key still
 * carries the scope, because the URL the reader is on does: arriving at
 * `/ledger/10?entity=aios` and at `?entity=blackcode` are two different claims,
 * and the screen renders the book name from the scope. One cache slot for both
 * would put one book's name over another's écriture — which is this app's worst
 * failure mode arriving through the back door.
 */
export function useEntry(ws: string | undefined, scope: ReadScope, number: number | null) {
  return useQuery({
    queryKey: booksKey('entry', scope, { number, ws }),
    // ── THE BOOK GOES IN THE URL, NOT ONLY IN THE KEY ─────────────────────
    // It used to be in the key alone, on the reasoning above: the route looks a
    // row up by `(workspace_id, seq)` and does not filter by book, so #10 is #10
    // whichever book is selected, and the scope was carried only to stop two
    // books sharing a cache slot.
    //
    // **That reasoning was right about the cache and wrong about the record.**
    // `seq` is workspace-wide across BOTH journals, so one number names two
    // rows: verified 2026-08-19, `entry show 3` is blackcode's rent payment and
    // `entry show 3 --entity ri` is the RI's AVS instalment. Following a link
    // from the simplified book's own screens fetched the first and drew it under
    // the second's heading — this app's worst failure mode, arriving through the
    // door the comment above says it was guarding.
    //
    // The route accepts `?entity=` and answers within that book. So the screen
    // asks for the record it means, and a number that does not exist in this
    // book is a refusal rather than another company's écriture.
    queryFn: () =>
      apiGet<Entry>(
        `/api/workspaces/${ws}/entries/${number}${
          scope.entity ? `?entity=${encodeURIComponent(scope.entity)}` : ''
        }`
      ),
    // NOT gated on the years: the route takes no `?exercice=`, so there is no
    // year for it to default to and nothing to wait for.
    enabled: !!ws && number !== null && Number.isInteger(number),
  })
}

/**
 * The net-worth statements. `GET …/patrimoine`, newest first.
 *
 * ── THE ONE PLACE THIS APP CONVERTS A NUMBER INTO AN AMOUNT ────────────────
 * `books.patrimoine.items` is `jsonb`, so its amounts cross the wire as JSON
 * numbers (`8200`) rather than as `numeric` strings (`"8200.00"`) — see
 * `PatrimoineItem` in `lib/types.ts`. Every component below takes a string,
 * because `<Money>`'s prop type is the guard that keeps floats out of the
 * display path, and widening it for this one route would remove that guard
 * everywhere.
 *
 * So the conversion happens HERE, once, at the boundary, and is visible:
 * `toFixed(2)` on a value that was already a float by the time `JSON.parse`
 * returned. Nothing is recovered by doing it later — the precision was lost on
 * the wire, not here — and doing it here means exactly one line in the app
 * knows about it.
 *
 * **This is a wire defect, not a design.** Serving these as strings is a
 * backend request; the report carries it.
 */
export interface PatrimoineView extends Omit<PatrimoineSnapshot, 'items'> {
  items: { label: PatrimoineSnapshot['items'][number]['label']; amount: string }[]
}

export function usePatrimoine(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('patrimoine', scope, { ws }),
    queryFn: () =>
      apiList<PatrimoineSnapshot>(
        `/api/workspaces/${ws}/patrimoine?${scopeQuery(scope)}`
      ).then((r) =>
        r.data.map(
          (snapshot): PatrimoineView => ({
            ...snapshot,
            // Served as `numeric` strings since 2026-08-19; the conversion
            // that lived here is deleted, as the wire-parity pin instructed.
            items: snapshot.items ?? [],
          })
        )
      ),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

// ===========================================================================
// RECOGNITION — phase 2's two reads
// ===========================================================================
// The only screen in the product with judgment in it reads exactly two things,
// and both are entity-scoped for the reason at the top of `lib/query-keys.ts`:
// one book's unexplained money under another book's name is this app's worst
// failure, and the worklist is the list a human ACTS on.

/**
 * Everything needing a human. `GET …/worklist?entity=&exercice=`.
 *
 * ── IT DOES NOT SERVE `{data, next_cursor}`, SO `apiList` IS WRONG HERE ────
 * The envelope is `{entity, exercice, count, rows}`. `apiList` would find no
 * `data` key, substitute `[]`, and the screen would render "everything is
 * explained" over a book with unexplained money in it — the phase-1 failure
 * shape exactly, and `lib/wire-parity.test.ts` cannot see it because it reads
 * shaping functions and not envelopes. So the whole envelope is kept.
 *
 * **`entity` and `exercice` come back for a reason.** They are what the server
 * actually chose, and the screen shows them: a request whose `?entity=` was
 * dropped is answered with the FIRST book, and the only way to notice is to
 * compare what came back with what was asked.
 *
 * ── `count` IS THE ONE THE OVERVIEW SHOWS, AND THEY MUST AGREE ────────────
 * `GET …/overview` computes its `worklist` figure with a different predicate —
 * it counts ONE table, chosen by the book's regime, where this route counts
 * both unconditionally. They agree on every seeded book because each one has
 * rows in one table only. A `double_entry` book that ever acquired `ri_entry`
 * rows would make them disagree, and it would be the overview that is wrong.
 * Recorded here rather than papered over; it is a backend request.
 */
export function useWorklist(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('worklist', scope, { ws }),
    queryFn: () => apiGet<WorklistResult>(`/api/workspaces/${ws}/worklist?${scopeQuery(scope)}`),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * The recognition rules of one book. `GET …/rules?entity=`.
 *
 * `{data, next_cursor}` — this one IS a list route, so `apiList`.
 *
 * Rules are entity-scoped and **not** exercice-scoped: a lease signed in 2025
 * explains a payment made in 2026, and the route ignores `?exercice=` beyond
 * validating the scope. The year still goes in the KEY, because `scopeQuery`
 * puts it in the URL and a key that omitted it would serve one year's request
 * from another year's slot — same bytes today, and a silent lie the moment the
 * route starts reading it.
 */
export function useRules(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('rules', scope, { ws }),
    queryFn: () =>
      apiList<RecognitionRule>(`/api/workspaces/${ws}/rules?${scopeQuery(scope)}`).then((r) => r.data),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * The rules a row's `suggested_rules` points at, in the order the server gave.
 *
 * Not a hook and not a fetch — the screen already has both lists. A #number with
 * no rule in hand is DROPPED rather than rendered as a bare "#4": a suggestion
 * whose rule cannot be shown is not something a human can judge, and printing
 * the number alone invites acting on it. The count the row shows is the length
 * of what this returns, so nothing claims a suggestion it cannot display.
 */
export function suggestionsFor(
  row: WorklistRow,
  rules: RecognitionRule[] | undefined
): RecognitionRule[] {
  if (!rules) return []
  return row.suggested_rules
    .map((n) => rules.find((r) => r.number === n))
    .filter((r): r is RecognitionRule => r !== undefined)
}

/** Re-exported so a page reading the overview needs one import, not two. */
export type { OverviewBook }

// ===========================================================================
// SOURCES AND PIÈCES — phase 3's four reads
// ===========================================================================
// ── THESE ARE THE FIRST READS IN THE APP THAT ARE NOT PER-BOOK ────────────
// A source belongs to the WORKSPACE, not to a book: one card can attribute
// spend across several books, and `books.source.entity_id` is nullable because
// an unattributed source is legitimate (seeded #9, PostFinance, has no book).
// The inbox is the same — a scanned receipt does not always say whose it is.
//
// So `entity` here is a FILTER, not a scope: passing it narrows the register,
// and omitting it is the honest default for a register that answers "do I have
// everything" across every book at once. It still goes in the key — two filters
// are two results — and the exercice is null in all four keys because none of
// these routes reads `?exercice=` and a year in the key would be a claim the
// URL does not make.
//
// **`booksKey` and not `booksGlobalKey`**, for the reason at the top of
// `lib/query-keys.ts`: two workspaces hold different sources and their #numbers
// overlap. "Every source" is not a global fact.

/**
 * The sources register. `GET …/sources`, optionally narrowed to one book.
 *
 * Every row carries a `status` the SERVER computed from cadence against
 * `last_import`, and the thresholds it used. Nothing here is settable and the
 * screen must not draw it as if it were — see `lib/derive/sources.ts`.
 */
export function useSources(ws: string | undefined, entity: string | null = null) {
  return useQuery({
    queryKey: booksKey('sources', { entity, exercice: null }, { ws }),
    queryFn: () =>
      apiList<Source>(
        `/api/workspaces/${ws}/sources${entity ? `?entity=${encodeURIComponent(entity)}` : ''}`
      ).then((r) => r.data),
    enabled: !!ws,
  })
}

/**
 * One source in full. `GET …/sources/{number}` — the register row, its pulls
 * and its runbook.
 *
 * The runbook carries `credential_ref`, a vault reference. It is rendered as a
 * reference and nothing in this app masks it: see `SourceRunbook` in
 * `lib/types.ts` for why a masking component would be worse than none.
 */
export function useSource(ws: string | undefined, number: number | null) {
  return useQuery({
    queryKey: booksKey('source', { entity: null, exercice: null }, { number, ws }),
    queryFn: () => apiGet<SourceDetail>(`/api/workspaces/${ws}/sources/${number}`),
    enabled: !!ws && number !== null && Number.isInteger(number),
  })
}

/**
 * The worker's ledger of one source's Drive folder. `GET …/sources/{n}/manifest`.
 *
 * ── IT DOES NOT SERVE `{data, next_cursor}`, SO `apiList` IS WRONG HERE ────
 * The envelope is `{source, files}`. `apiList` would find no `data` key,
 * substitute `[]`, and the screen would say "no files on record" over a folder
 * holding six — the same confident wrong answer as the worklist, and
 * `lib/wire-parity.test.ts` cannot see it because it reads shaping functions and
 * not envelopes. So the whole envelope is kept, and `source` is shown: it is the
 * #number the server answered for, which is the only way to notice a request
 * that resolved to a different source than the URL asked for.
 *
 * **An empty `files` array is a real answer.** Most seeded sources have one.
 */
export function useManifest(ws: string | undefined, number: number | null) {
  return useQuery({
    queryKey: booksKey('manifest', { entity: null, exercice: null }, { number, ws }),
    queryFn: () => apiGet<ManifestResult>(`/api/workspaces/${ws}/sources/${number}/manifest`),
    enabled: !!ws && number !== null && Number.isInteger(number),
  })
}

/**
 * The receipts inbox. `GET …/pieces`, optionally narrowed by book and status.
 *
 * `{data, next_cursor}` — this one IS a list route, so `apiList`.
 *
 * `status` is a filter on the pièce's own lifecycle (`staged`, `matched`), not
 * on the validation verdict. A flagged pièce is `staged` like any other: the
 * flag is `needs_review`, and it is normal traffic rather than an error state.
 */
export function usePieces(
  ws: string | undefined,
  entity: string | null = null,
  status?: string
) {
  return useQuery({
    queryKey: booksKey('pieces', { entity, exercice: null }, { status, ws }),
    queryFn: () => {
      const q = new URLSearchParams()
      if (entity) q.set('entity', entity)
      if (status) q.set('status', status)
      const qs = q.toString()
      return apiList<InboxPiece>(
        `/api/workspaces/${ws}/pieces${qs ? `?${qs}` : ''}`
      ).then((r) => r.data)
    },
    enabled: !!ws,
  })
}

/**
 * The transaction block of an extraction, whichever way the worker spelled it.
 *
 * ── BOTH SPELLINGS ARE REAL, IN THE SAME TABLE ────────────────────────────
 * `lib/validate/extraction.ts` records that the ExtractionResult schema says
 * `transaction` and the mockup's seeded pièces say `tx`, and that `ingestPiece`
 * accepts either — **and does not normalise the stored payload.** So the column
 * carries whichever the writer used: seeded pièce #1 has only `tx`, #5 has both.
 * `publicPiece` already reads both for the fields it lifts out (`total`,
 * `date`); a detail panel reading `extraction.transaction` alone would render an
 * empty card over a document with every field on it.
 *
 * Not a hook and not a fetch — the caller already has the pièce.
 */
export function transactionOf(x: PieceExtraction | null | undefined): PieceTransaction | null {
  if (!x) return null
  return x.transaction ?? x.tx ?? null
}

// ===========================================================================
// THE MANAGEMENT READS — phase 4B
// ===========================================================================
// `analytique` is RING 3: derived at request time from posted lines, stored
// nowhere, and it accepts no writes ever. Nothing here may cache a FIGURE — the
// query cache holds a RESPONSE for as long as any other read does, which is a
// cache of a request rather than a stored derivation. The distinction is worth
// stating because the route recomputes on every call: a screen must never
// present a number it kept while the books moved underneath it, so a write
// anywhere in this app invalidates the whole root (`booksCacheFilter`) and this
// comes back with it.

/**
 * The cost breakdown and the monthly flows for one (book, exercice).
 * `GET …/analytique?entity=&exercice=`.
 *
 * Both regimes answer this route: a double-entry book’s breakdown groups POSTED
 * lines by the configured account->category mapping, and a simplified book’s
 * groups its dépenses by the category each movement carries. Same route, the
 * book’s own shape — so this is ONE hook and not two, unlike
 * `useEntries` / `useRiEntries`, where the row shapes differ and a screen has to
 * branch before it reads a field. Here they do not: `AnalytiqueCategory`
 * describes both, and `accounts: null` marks the simplified case.
 *
 * `enabled` waits for the years like every scoped read — a request with no
 * `?exercice=` gets `resolveScope`’s newest, which is a real answer to a
 * question the reader did not ask.
 */
export function useAnalytique(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('analytique', scope, { ws }),
    queryFn: () =>
      apiGet<AnalytiqueResult>(`/api/workspaces/${ws}/analytique?${scopeQuery(scope)}`),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * The configured buckets for one book. `GET …/analytique/categories?entity=`.
 *
 * ── IT IS NOT THE BREAKDOWN, AND THE SCREEN NEEDS BOTH ────
 * `useAnalytique` above serves the buckets that were COUNTED — `getAnalytique`
 * filters `retired` out. This serves the CONFIGURATION, retired rows included
 * and flagged. A reader asking “why does this breakdown not add up to the
 * income statement’s charges?” cannot answer it from the breakdown alone: a
 * retired bucket’s accounts are counted nowhere, and no other surface in this
 * app says so.
 *
 * ── IT TAKES NO EXERCICE, BECAUSE THE CONFIGURATION HAS NONE ────
 * `books.analytique_category` is per BOOK. The key still carries a null
 * exercice rather than using `booksGlobalKey`: two books configure different
 * buckets, so this is emphatically not a global fact — `lib/query-keys.ts`
 * spells out why the two builders are different words.
 *
 * **A simplified book answers `[]`** — its categories live on its movements,
 * not in this table — and that is not an empty configuration to be fixed. The
 * screen renders the panel only where the mapping exists.
 */
export function useAnalytiqueCategories(ws: string | undefined, entity: string | null) {
  return useQuery({
    queryKey: booksKey('analytique-categories', { entity, exercice: null }, { ws }),
    queryFn: () =>
      apiList<AnalytiqueCategoryConfig>(
        `/api/workspaces/${ws}/analytique/categories?entity=${encodeURIComponent(entity ?? '')}`
      ).then((r) => r.data),
    enabled: !!ws && !!entity,
  })
}

// ===========================================================================
// PHASE 5 — THE ANALYSES JOURNAL, THE TAX SNAPSHOT, THE COMPLIANCE RULES
// ===========================================================================
// Three reads, and they are scoped three DIFFERENT ways. That is not an
// accident of the routes and it is worth reading before adding a fourth:
//
//   analyses         `booksKey`, entity as a FILTER, no exercice. An analysis
//                    belongs to a book but not to a fiscal year — there is no
//                    `exercice_id` on `books.analysis`, so a year in the key
//                    would be a claim the URL does not make.
//   tax-snapshot     `booksKey` with the WHOLE scope. It is (book, exercice)
//                    exactly like the bilan, and it takes `scopeReady` for the
//                    same reason: a request with no `?exercice=` gets
//                    `resolveScope`'s newest, which is a real answer to a
//                    question the reader did not ask.
//   compliance-rules `booksGlobalKey`. **The third one in this app, and the
//                    first that is not about the signed-in person or the
//                    contract.** The same law binds every book, the route is
//                    not under `/workspaces` at all, and two workspaces would
//                    answer identically — which is `lib/query-keys.ts`'s own
//                    test for the global spelling.

/**
 * The analyses journal for one book. `GET …/analyses?entity=`.
 *
 * ── `{data, next_cursor}` — SO `apiList`, AND THE CURSOR IS ALWAYS NULL ───
 * `jsonList(rows.map(publicAnalysis), null)`. The route serves every row and
 * paginates nothing; it is a journal of questions a person asked, so the count
 * is small by construction.
 *
 * ── THE ENTITY IS A FILTER AND OMITTING IT IS A DIFFERENT QUESTION ────────
 * With no `?entity=` the route serves the WHOLE workspace's journal, across
 * books. That is a legitimate read and it is not what the Analyses screen wants:
 * the screen is book-scoped (`lib/nav.ts`), so it always sends one. The null
 * still goes in the key — "every book" and "book `aios`" are different results
 * and must not share a cache slot.
 *
 * ── NO EXERCICE, ANYWHERE ────────────────────────────────────────────────
 * `books.analysis` has no `exercice_id` and the route reads no `?exercice=`. A
 * year in this key would say the result changes with the year selector, and it
 * does not; the screen says so in words rather than leaving a control that
 * appears to do nothing.
 */
export function useAnalyses(ws: string | undefined, entity: string | null) {
  return useQuery({
    queryKey: booksKey('analyses', { entity, exercice: null }, { ws }),
    queryFn: () =>
      apiList<Analysis>(
        `/api/workspaces/${ws}/analyses${entity ? `?entity=${encodeURIComponent(entity)}` : ''}`
      ).then((r) => r.data),
    enabled: !!ws,
  })
}

/**
 * One filed analysis. `GET …/analyses/{number}` — a bare entity, not a list.
 *
 * ── THE ROUTE IS WORKSPACE-SCOPED, AND THE KEY IS BOOK-SCOPED ANYWAY ──────
 * `getAnalysis` resolves on `(workspace_id, seq)` and does not filter by book,
 * exactly like `getEntryByNumber`. Unlike the entry route there is no ambiguity
 * to fix here — `books.analysis.seq` names one row, there is no second journal —
 * but the record CARRIES its own `entity`, so the screen states the book from
 * the payload and never from the scope. That is the fix `/ledger/{n}` had to
 * make after relabelling one company's écriture with another's name.
 *
 * The scope is still in the key: arriving at `?entity=blackcode` and at
 * `?entity=aios` are two different claims about the page, and the screen
 * compares the two out loud.
 */
export function useAnalysis(ws: string | undefined, scope: Scope, number: number | null) {
  return useQuery({
    queryKey: booksKey('analysis', scope, { number, ws }),
    queryFn: () => apiGet<Analysis>(`/api/workspaces/${ws}/analyses/${number}`),
    enabled: !!ws && number !== null && Number.isInteger(number),
  })
}

/** The tax route refuses a simplified book by CODE, like the two statements. */
export const NO_TAX_SNAPSHOT_REFUSAL = 'no_tax_snapshot_for_simplified'

/**
 * Is this error the statutory refusal rather than a failure?
 *
 * Same shape and same reasoning as `isSimplifiedRefusal` above, and a separate
 * function rather than a third member of that list, because the two say
 * different things to the reader: a sole proprietorship has no bilan *at all*,
 * and its result is taxed as its owner's personal income *somewhere else*. One
 * notice for both would have to be vague about which.
 *
 * **Matched on the `code`, never on the message.** The message names the book
 * and is French-inflected prose.
 */
export function isNoTaxSnapshotRefusal(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.code === NO_TAX_SNAPSHOT_REFUSAL
}

/**
 * The statutory tax position of one (book, exercice). `GET …/tax-snapshot`.
 *
 * ── RING 3: DERIVED AT REQUEST TIME, STORED NOWHERE ───────────────────────
 * Nothing on this payload is a column. VAT comes from the entries' own TVA
 * fields, profit and equity from the two statements, and the two tax figures
 * from the book's parameter record. **No figure from it may be cached AS A
 * FIGURE** — what the query cache holds is a response, invalidated at the app
 * root by any write. Same rule as `useAnalytique`.
 *
 * ── AND IT IS NOT TAX TRACKING ───────────────────────────────────────────
 * A position over time is a different product (b/tax). This is one snapshot,
 * which is why the screen is off-nav and reached from the overview's cross-link.
 */
export function useTaxSnapshot(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('tax-snapshot', scope, { ws }),
    queryFn: () =>
      apiGet<TaxSnapshotResult>(`/api/workspaces/${ws}/tax-snapshot?${scopeQuery(scope)}`),
    enabled: !!ws && !!scope.entity && scopeReady(scope),
  })
}

/**
 * The nineteen statutory compliance rules. `GET /api/compliance-rules`.
 *
 * ===========================================================================
 * THE ONLY READ IN THIS APP THAT IS NEITHER WORKSPACE- NOR BOOK-SCOPED
 * ===========================================================================
 * The route is not under `/api/workspaces/{ws}/` and it is unauthenticated, for
 * the reason its own header gives: the payload is law text with citations,
 * holding no amounts and no names. The same law binds every book, so two
 * workspaces answer identically — `lib/query-keys.ts`'s test for
 * `booksGlobalKey`, met properly for the first time by something that is not the
 * contract or the account.
 *
 * ── AND IT TAKES NO `ws` ARGUMENT AT ALL ─────────────────────────────────
 * Deliberately, rather than accepting one and ignoring it. A parameter a hook
 * does not use is a parameter a reader believes scopes the result.
 *
 * ── `staleTime` IS SHORT, BECAUSE THIS ONE IS WRITTEN FROM THE SCREEN ─────
 * Unlike `/api/meta`, which changes on a deploy. A review is the fifth write and
 * it lands here; the write invalidates the whole app root, so this refetches
 * with everything else — the stale time only governs a reader who left the tab
 * open while somebody else signed a rule off.
 */
export function useComplianceRules() {
  return useQuery({
    queryKey: booksGlobalKey('compliance-rules'),
    queryFn: () => apiList<ComplianceRule>('/api/compliance-rules').then((r) => r.data),
    staleTime: 30_000,
  })
}
