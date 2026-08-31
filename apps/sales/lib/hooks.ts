'use client'

// The query hooks every page reads through.
//
// ── THE WIRE TYPES ARE IMPORTED, NOT RETYPED ────────────────────────────────
// `import type` from the query layer and from `lib/views.ts`. The imports are
// erased at compile time, so no server module — and no drizzle client — reaches
// the browser bundle; what survives is that a change to `TodayResult` becomes a
// type error in the page that reads it, in the same `npm run typecheck`.
//
// Hand-writing a second copy of these interfaces here is the obvious
// alternative and it is the wrong one: two shapes that must agree, kept in
// agreement by nobody, is the drift `lib/views.ts` exists to prevent on the wire
// and the same argument applies one layer up.
//
// ── EVERY KEY CARRIES THE WORKSPACE ─────────────────────────────────────────
// `['today', ws]`, never `['today']`. This app shows one workspace and the
// picker is a branch almost nobody sees (D-3), which is exactly why a cache key
// that ignored the workspace would be wrong in a way nobody would reproduce.

import { useQuery } from '@tanstack/react-query'
import type { EventListItem } from '@blackcode/platform-db'
import type { MetricsResult, PipelineResult, TodayResult } from '@/lib/db/queries/aggregates'
import type { SearchHit, SearchType } from '@/lib/db/queries/search'
import type { PublicProspect } from '@/lib/views'
import { apiGet, query, wsPath, type ListPage } from '@/lib/client'

/**
 * The signed-in person's own account row — name, email, photo.
 *
 * ── WHY NOT `useSession()`, WHICH IS ALREADY THERE ──────────────────────────
 * The next-auth session is minted at SIGN-IN and this app's `jwt` callback only
 * refreshes it when `account` is present, i.e. on sign-in. So `session.user
 * .image` is the photo as it was when you last signed in — and the account is
 * shared with every other blackcode app, so it goes stale two ways: you change
 * your photo here (measured 2026-08-11: the sidebar kept the old initials until
 * a re-login, even after `update()`), or you change it in another app and this
 * one never hears.
 *
 * `GET /api/me` is the live row. The session stays the source for *identity* —
 * who you are, whether you are signed in — and this is the source for what to
 * DRAW. `apps/issues` settled it the same way in its own shell.
 *
 * NOT workspace-keyed, unlike everything else in this file: the account is one
 * row across every workspace and every app.
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () =>
      apiGet<{
        id: number
        email: string
        name: string | null
        avatar_url: string | null
      }>('/api/me'),
    staleTime: 60_000,
  })
}

/** What is owed today, and who we are meeting today. */
export function useToday(ws: string) {
  return useQuery({
    queryKey: ['today', ws],
    queryFn: () => apiGet<TodayResult>(wsPath(ws, '/today')),
  })
}

/** Where the money is, by stage. */
export function usePipeline(ws: string) {
  return useQuery({
    queryKey: ['pipeline', ws],
    queryFn: () => apiGet<PipelineResult>(wsPath(ws, '/pipeline')),
  })
}

/** A meeting, in the shape `publicMeeting` serves. */
export interface Meeting {
  number: number
  prospect_number: number
  prospect_name: string
  starts_at: string
  duration_min: number | null
  type: string
  status: string
  title: string
  attendees: string[]
  agenda: string | null
  outcome: string | null
  /** The join URL. Null on the calls and in-person meetings that are most of
   *  this ledger — renderers show nothing at all rather than an em dash. */
  meeting_url: string | null
  urn: string | null
  created_at: string
  deleted_at: string | null
}

/**
 * The next meetings across every prospect — Today's own block (§8.2), not
 * something buried in one deal's card.
 *
 * ── THE SORT IS DONE HERE, AND THAT IS NOT LAZINESS ────────────────────────
 * `GET …/meetings` orders `starts_at DESC` deliberately: the ledger's reader
 * asks "what is next / what just happened", and both live at that end of a list
 * that is mostly past. But DESC + a small `limit` returns the FURTHEST-out
 * meetings, not the nearest — `limit=5` on an upcoming filter would show next
 * quarter and hide tomorrow.
 *
 * So this asks for a page big enough to hold every upcoming meeting a real
 * workspace has and sorts ascending here. `has_more` is returned rather than
 * swallowed: a workspace that genuinely has more upcoming meetings than one page
 * would silently lose the nearest ones, and a block that is quietly wrong is
 * worse than one that says so. If that ever fires, the fix is an `order` or
 * `soonest` parameter on the route, which is agent5's surface and not something
 * to paper over from here.
 */
export function useUpcomingMeetings(ws: string, take = 5) {
  return useQuery({
    queryKey: ['meetings', ws, 'upcoming', take],
    queryFn: async () => {
      const page = await apiGet<ListPage<Meeting>>(
        wsPath(ws, '/meetings') + query({ status: 'upcoming', limit: 100 })
      )
      const sorted = [...page.data].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      return {
        meetings: sorted.slice(0, take),
        total: sorted.length,
        has_more: page.next_cursor != null,
      }
    },
  })
}

/** The filters every list page shares. Absent/empty means "no filter". */
export interface ProspectFilters {
  stage?: string
  /** A strategy's #number (`sales.strategies.seq`), resolved server-side. */
  strategy?: string
  label?: string
  q?: string
}

/** The prospects list, filtered. */
export function useProspects(ws: string, filters: ProspectFilters = {}) {
  return useQuery({
    queryKey: ['prospects', ws, filters],
    queryFn: async () => {
      const page = await apiGet<ListPage<PublicProspect>>(
        wsPath(ws, '/prospects') + query({ ...filters, limit: 100 })
      )
      return page
    },
  })
}

/** A prospect's journey step, as the detail route serves it. */
export interface JourneyStep {
  stage: string
  status: string
  occurred_at: string | null
  actor: string | null
  note: string | null
}

/** One prospect, plus its journey. */
export type ProspectDetail = PublicProspect & {
  journey: JourneyStep[]
  /** Served by the single-prospect route since 2026-08-17 (#34, #33). See that
   *  route's header: the people at a prospect were reachable only through a
   *  sub-route nobody had reason to guess at, and both issues were filed
   *  because of it. `useContacts` is still the paged read this page uses; this
   *  field exists so the record is not silent about them. */
  contacts: Contact[]
}

export function useProspect(ws: string, n: number) {
  return useQuery({
    queryKey: ['prospect', ws, n],
    queryFn: () => apiGet<ProspectDetail>(wsPath(ws, `/prospects/${n}`)),
  })
}

export interface Contact {
  id: number
  name: string
  role: string | null
  email: string | null
  phone: string | null
  /** Migration 0008 — sales #34 and #33. `notes` is the freeform intel and
   *  predates both; `decision_power` is the structured half. */
  linkedin: string | null
  decision_power: string | null
  is_primary: boolean
  notes: string | null
}

export interface Objection {
  id: number
  type: string
  raised_by: string | null
  raised_at: string | null
  status: string
  spoken: string | null
  real_fear: string | null
  counter: string | null
}

export interface Match {
  product_number: number
  product_name: string
  template_number: number | null
  template_name: string | null
  fit: number | null
  why: string | null
  computed_at: string | null
  computed_by: string | null
}

export function useContacts(ws: string, n: number) {
  return useQuery({
    queryKey: ['contacts', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Contact>>(wsPath(ws, `/prospects/${n}/contacts`))).data,
  })
}

/** One entry of a prospect's research log (#39). No `updated_at` — the log is
 *  append-only and there is no route that could produce one. */
export interface ProspectNote {
  id: number
  body: string
  kind: string | null
  /** Who observed it — an agent, usually. Verbatim, from the token's name. */
  author: string | null
  created_at: string
}

export function useProspectNotes(ws: string, n: number) {
  return useQuery({
    queryKey: ['prospect-notes', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<ProspectNote>>(wsPath(ws, `/prospects/${n}/notes`))).data,
  })
}

export function useObjections(ws: string, n: number) {
  return useQuery({
    queryKey: ['objections', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Objection>>(wsPath(ws, `/prospects/${n}/objections`))).data,
  })
}

/**
 * Triangulation — the stored result of client × product × message (D-9 / §1.2
 * rule 2).
 *
 * **The matching is not done here and must never be.** These rows were written
 * by the agent through `bk sales match set`; this hook reads them. A component
 * that started ranking products by "fit" in the browser would be the one thing
 * the doctrine forbids.
 */
export function useMatches(ws: string, n: number) {
  return useQuery({
    queryKey: ['matches', ws, n],
    queryFn: async () =>
      (await apiGet<ListPage<Match>>(wsPath(ws, `/prospects/${n}/matches`))).data,
  })
}

/**
 * Every prospect, indexed by #number.
 *
 * Today's queue needs a deal value beside each name and `today.due_actions` does
 * not carry one — it answers "what is owed", and a value is not part of that
 * answer. Rather than ask agent5 to widen the aggregate's shape, the page joins
 * against the list route it would have to load for the Prospects page anyway,
 * and TanStack shares the cache entry between the two.
 */
export function useProspectsByNumber(ws: string) {
  return useQuery({
    queryKey: ['prospects', ws, 'all'],
    queryFn: async () => {
      const page = await apiGet<ListPage<PublicProspect>>(
        wsPath(ws, '/prospects') + query({ limit: 100 })
      )
      return new Map(page.data.map((p) => [p.number, p]))
    },
  })
}

// ---------------------------------------------------------------------------
// The ledgers and the catalog
// ---------------------------------------------------------------------------

/** A communication, in the shape `publicComm` serves. */
export interface Communication {
  number: number
  prospect_number: number
  prospect_name: string
  channel: string
  direction: string
  occurred_at: string
  subject: string | null
  body: string | null
  contact: string | null
  logged_by: string | null
  urn: string | null
  created_at: string
  deleted_at: string | null
}

export interface Product {
  number: number
  category: string
  name: string
  price_label: string | null
  price_from: string | null
  price_to: string | null
  currency: string
  description: string | null
  fit: string[]
  pitch: string | null
  status_label: string | null
  refs: string[]
  /**
   * INTERNAL ONLY (#27). What to quote if somebody asks — never a customer-
   * facing number. Served to authenticated workspace members; if a public
   * product page is ever built (#26) it must not reuse this type or its route.
   */
  internal_price_min: string | null
  internal_price_max: string | null
  internal_price_note: string | null
  /** `internal | external` — how far our own site carries it (#29). */
  reach: string
  external_url: string | null
  urn: string | null
  deleted_at: string | null
}

export interface Template {
  number: number
  channel: string
  category: string
  stage: string | null
  name: string
  subject: string | null
  body: string | null
  variables: string[]
  urn: string | null
  deleted_at: string | null
}

export interface SalesDocument {
  number: number
  title: string
  kind: string
  upload_url: string | null
  external_url: string | null
  size_bytes: number | null
  mime_type: string | null
  description: string | null
  tags: string[]
  added_by: string | null
  prospects: number[]
  products: number[]
  /** Migration 0012 — the fourth attachment point (#40). */
  strategies: number[]
  /**
   * Where the bytes live and how to show it. DERIVED by the server on every
   * read, so a document added before this existed reports correctly with no
   * backfill. See `@blackcode/platform-file-providers`.
   */
  file: {
    provider: string
    /** True when WE hold the bytes. Decides the badge, and decides whether the
     *  file can be shown to anyone who can see the record. */
    internal: boolean
    label: string
    external_id: string | null
    media_kind: string
    embed_mode: 'image' | 'video' | 'audio' | 'iframe' | 'none'
    embed_url: string | null
    thumbnail_url: string | null
    open_url: string
    /** `public | restricted | unknown | null`. Anything but `public` on an
     *  EXTERNAL file means: do not embed. */
    preview_status: string | null
    preview_checked_at: string | null
  }
  urn: string | null
  deleted_at: string | null
}

/**
 * The meetings ledger. `prospect` filters it to one deal, which is what the
 * prospect detail page's Meetings tab passes — the same route, not a second one,
 * so the tab cannot drift from the cross-prospect view.
 */
export function useMeetings(ws: string, opts: { prospect?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['meetings', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<Meeting>>(
          wsPath(ws, '/meetings') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

export function useCommunications(
  ws: string,
  opts: { prospect?: number; channel?: string; dir?: string } = {}
) {
  return useQuery({
    queryKey: ['communications', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<Communication>>(
          wsPath(ws, '/communications') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

export function useProducts(ws: string) {
  return useQuery({
    queryKey: ['products', ws],
    queryFn: async () =>
      (await apiGet<ListPage<Product>>(wsPath(ws, '/products') + query({ limit: 100 }))).data,
  })
}

/** One segment strategy (#37). `number`, never a row id. */
export interface Strategy {
  number: number
  name: string
  vertical: string | null
  area: string | null
  rationale: string | null
  case_studies: string | null
  products: Array<{ number: number; name: string }>
  /** Live deals pointing at this segment — the number you want before retiring
   *  one. Served rather than derived; see the route. */
  prospect_count: number
  urn: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function useStrategies(ws: string) {
  return useQuery({
    queryKey: ['strategies', ws],
    queryFn: async () => (await apiGet<ListPage<Strategy>>(wsPath(ws, '/strategies'))).data,
  })
}

export function useTemplates(ws: string, opts: { channel?: string; category?: string } = {}) {
  return useQuery({
    queryKey: ['templates', ws, opts],
    queryFn: async () =>
      (await apiGet<ListPage<Template>>(wsPath(ws, '/templates') + query({ ...opts, limit: 100 })))
        .data,
  })
}

/**
 * The document library. `prospect` filters it — and that filter is what makes
 * the prospect detail page's Documents tab **a view into the one library rather
 * than a parallel store** (D-8, the fix UPDATE-6 was written to make). Same
 * route, same rows, one `where`.
 */
export function useDocuments(
  ws: string,
  opts: {
    prospect?: number
    product?: number
    kind?: string
    q?: string
    /** Documents carrying ANY of these — OR, matching the route and the CLI.
     *  Sent as one comma-separated `tag` parameter, which is the encoding all
     *  three sides agree on. */
    tag?: string
  } = {}
) {
  return useQuery({
    queryKey: ['documents', ws, opts],
    queryFn: async () =>
      (
        await apiGet<ListPage<SalesDocument>>(
          wsPath(ws, '/documents') + query({ ...opts, limit: 100 })
        )
      ).data,
  })
}

/**
 * How the last N days went. Computed in SQL, never stored (D-33).
 *
 * `period` is a SHAPE (`30d`, `12w`, `6m`), not a vocabulary — the route parses
 * it rather than matching a list, so the page is free to offer whichever spans
 * are useful without a server change.
 */
export function useMetrics(ws: string, period: string) {
  return useQuery({
    queryKey: ['metrics', ws, period],
    queryFn: () => apiGet<MetricsResult>(wsPath(ws, '/metrics') + query({ period })),
  })
}

/** A binned record, in the shape `bk sales trash list` parses. */
export interface TrashItem {
  type: string
  number: number | null
  title: string
  deleted_at: string | null
  deleted_by: string | null
}

export function useTrash(ws: string) {
  return useQuery({
    queryKey: ['trash', ws],
    queryFn: async () => (await apiGet<ListPage<TrashItem>>(wsPath(ws, '/trash'))).data,
  })
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * One row of the workspace feed.
 *
 * `EventListItem` is the DATABASE row and this is the WIRE shape, and they differ
 * in exactly one field: `publicEventIds` in the shared route replaces
 * `entity_id` with the workspace #number for this app's projected types, and
 * serves **null** when the source row has been purged. The database column is
 * `notNull`, so the widening is stated here rather than left for a reader to
 * discover from a runtime null.
 *
 * Everything else is imported. Retyping the row would put a second copy of ten
 * fields in a client module with nobody holding the two together.
 */
export type ActivityEvent = Omit<EventListItem, 'entity_id'> & { entity_id: number | null }

export interface ActivityFilters {
  entity_type?: string
  action?: string
  actor?: number
}

/**
 * The workspace feed, filtered to this app.
 *
 * **`app=sales` is not decoration.** `platform.events` holds every app's rows
 * for a workspace, so an unfiltered feed on this deployment would render issues'
 * events with sales' vocabulary — an `issue` entity type this app has no label
 * or colour for, linking nowhere. Reading across apps is `bk activity`'s job and
 * it tags every row with its app; a page that cannot show the tag must not show
 * the rows. D-9's two layers, one level down.
 */
export function useActivity(ws: string, filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: ['activity', ws, filters],
    queryFn: () =>
      apiGet<ListPage<ActivityEvent>>(
        wsPath(ws, '/activity') + query({ ...filters, app: 'sales', limit: 100 })
      ),
  })
}

// ---------------------------------------------------------------------------
// Search — D-9's app-owned half, and the ONLY call site for it
// ---------------------------------------------------------------------------

export type { SearchHit, SearchType }

/**
 * Search INSIDE this app's records: `GET …/sales-search`.
 *
 * **⌘K and `/dashboard/{ws}/search` both go through here, and that is a
 * property rather than tidiness.** They are two presentations of one answer —
 * the palette shows the top few, the page groups and facets them — and the
 * moment either builds its own request they can rank differently, paginate
 * differently, or hit different endpoints for the same term, with nothing to
 * say which one is right. `lib/search-parity.test.ts` asserts that no component
 * names the `sales-search` path.
 *
 * The platform half (`…/search`, over `platform.entities`, every app, URNs out)
 * is a different path and this app does not mount it. If a facet needs data this
 * route does not return, the answer is to say so — not to add a second search
 * API beside it (D-9).
 *
 * ── THE RACE IS THE QUERY KEY ───────────────────────────────────────────────
 * A slow "ro" landing after a fast "roches" must not repaint the older answer
 * over the newer one. The term is part of the key, so a resolved request can
 * only ever write into its own cache entry; nothing hand-rolled is needed and
 * there is no sequence counter to get wrong. Debouncing is the CALLER's, because
 * a palette wants it per keystroke and a page whose term comes from the URL does
 * not.
 */
export function useSalesSearch(
  ws: string,
  term: string,
  opts: { types?: SearchType[]; limit?: number } = {}
) {
  const q = term.trim()
  const types = opts.types?.length ? [...opts.types].sort().join(',') : ''
  return useQuery({
    queryKey: ['sales-search', ws, q, types, opts.limit ?? null],
    // Only "is there a term at all" is decided here. The MINIMUM LENGTH is the
    // server's (`SEARCH_QUERY_MIN`, served by `bk meta`), and it stays there:
    // copying the number into a client module would be a second declaration of a
    // limit, and importing it would pull `@blackcode/platform-api`'s barrel —
    // handler, drizzle, storage — into the browser bundle for one integer. A
    // too-short term gets the route's own 400, which carries the number and a
    // suggestion, and `ErrorState` renders both.
    enabled: q.length > 0,
    queryFn: async () =>
      (
        await apiGet<ListPage<SearchHit>>(
          wsPath(ws, '/sales-search') + query({ q, type: types, limit: opts.limit })
        )
      ).data,
  })
}
