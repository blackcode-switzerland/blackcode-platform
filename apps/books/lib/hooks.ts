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
import { apiGet, apiList, ApiRequestError } from './client'
import { booksGlobalKey, booksKey, type Scope } from './query-keys'
import type {
  Account,
  BilanResult,
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
  Source,
  SourceDetail,
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

/** The compte de résultat. `GET …/compte-resultat`. Art. 959b, ten lines. */
export function useCompteResultat(ws: string | undefined, scope: ReadScope) {
  return useQuery({
    queryKey: booksKey('compte-resultat', scope, { ws }),
    queryFn: () =>
      apiGet<CrResult>(`/api/workspaces/${ws}/compte-resultat?${scopeQuery(scope)}`),
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
 * The grand livre. `GET …/entries`.
 *
 * `?account=` returns WHOLE entries that touch the account, not just the
 * matching line, which is why a filtered row still shows both sides.
 *
 * The filters go into the key as well as the URL. A key that carried the scope
 * but not `account` would serve the unfiltered ledger from cache the moment the
 * reader drilled in — the same class of bug as the wrong book, one level down.
 */
export function useEntries(ws: string | undefined, scope: ReadScope, filters: EntryFilters = {}) {
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
    enabled: !!ws && !!scope.entity && scopeReady(scope),
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
    queryFn: () => apiGet<Entry>(`/api/workspaces/${ws}/entries/${number}`),
    // NOT gated on the years. `/entries/{number}` is workspace-scoped and takes
    // no `?exercice=`, so there is no year for it to default to and nothing to
    // wait for. The scope is in its KEY, not in its URL — see above.
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
