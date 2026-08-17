// THE address map for this app: which types are addressable, and where each one
// is displayed. One copy, read by both halves of the link story.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE, WITH NO IMPORTS AT ALL
// ---------------------------------------------------------------------------
// Two modules need it and they cannot import each other:
//
//   lib/entity-address.ts  server-side. Imports `formatUrn` from
//                          `@blackcode/platform-db`, whose index re-exports
//                          `createDb` and therefore the postgres driver.
//   lib/record-href.ts     client-side. Imported by ⌘K, the search page and the
//                          activity feed — three "use client" trees.
//
// Putting the map in either one would either pull a database package into the
// browser bundle or give the address scheme a dependency it has no business
// having. **Keep this file import-free.** Anything it imports lands in both.
//
// ---------------------------------------------------------------------------
// WHY IT IS ONE MAP AND NOT TWO
// ---------------------------------------------------------------------------
// It was two until 2026-08-07, and they disagreed for five of six types. The
// server map pointed meetings, communications, products, templates and
// documents at `/dashboard/{ws}/{segment}/{n}` — detail pages that were never
// built — and that value is STORED in `platform.entities.url` at write time. A
// D-18 cross-app link from issues into a sales meeting 404'd, for every type but
// the one somebody happened to click.

/**
 * The entity types this app projects — one per source table with a #number.
 *
 * **Contacts, stage entries, objections and matches are deliberately absent.**
 * None of them has an independent identity or a #number: a contact is always
 * reached through its prospect, a stage entry is a step in one prospect's
 * journey, and a match is a verdict about a (prospect, product) pair. Projecting
 * one would advertise an address `bk` cannot resolve, which is worse than not
 * being findable — `bk search` would return a URN that goes nowhere.
 */
export const ENTITY_TYPES = [
  'prospect',
  'meeting',
  'communication',
  'product',
  'template',
  'document',
  // Migration 0010 (#37). Independently addressable — you browse the list and
  // cite one — which is the test this comment states. `prospect_note` arrived
  // in the same week and is deliberately NOT here for the same reason contacts
  // are not: it is only ever reached through its prospect.
  'strategy',
] as const
export type SalesEntityType = (typeof ENTITY_TYPES)[number]

/**
 * The listing each numbered NON-PROSPECT type is shown in.
 *
 * A prospect is the one type with a page of its own — it has four tabs' worth of
 * children — so it is the one type this map must NOT have an entry for. For
 * everything else the row IS the record (`docs/frontend.md` §7), so it resolves
 * to its listing with the row highlighted and scrolled to.
 *
 * Spelling the key type as `Exclude<…, 'prospect'>` makes both halves of the
 * divergence that caused this file a COMPILE error rather than a dead link:
 *
 *   - add a type to `ENTITY_TYPES` and forget this map → missing key, TS2741
 *   - give a prospect a listing entry            → excess property, TS2353
 *
 * What that still does NOT catch — the D-26 step-2 answer, written here rather
 * than in a decision list because this is where the next person will be
 * standing: **a segment naming a route that was never built** (`meeting:
 * 'meeting'`) is perfectly well-typed and 404s. `lib/dashboard-paths.test.ts`
 * checks every segment against `app/dashboard/[ws]/` on disk for exactly that,
 * and step 3 of D-26 — injecting the regression — is recorded in its header.
 */
export const LISTING_SEGMENT: Record<Exclude<SalesEntityType, 'prospect'>, string> = {
  meeting: 'meetings',
  communication: 'communications',
  product: 'products',
  template: 'templates',
  document: 'documents',
  strategy: 'strategies',
}

/**
 * Where this app puts a given entity, relative to the app's own origin.
 *
 * **The server stores this value**, in `platform.entities.url`, at write time —
 * nothing recomputes it on read. Changing what this returns therefore leaves
 * every already-projected row pointing at the old address, and the repair is
 * `bk super-admin entity-drift --repair` **run against this app's server**,
 * which reports the difference as `stale`.
 */
export function entityPath(
  workspaceSlug: string,
  entityType: SalesEntityType,
  number: number
): string {
  const base = `/dashboard/${workspaceSlug}`
  if (entityType === 'prospect') return `${base}/prospects/${number}`
  return `${base}/${LISTING_SEGMENT[entityType]}?focus=${number}`
}
