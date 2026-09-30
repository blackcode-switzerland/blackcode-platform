// What workspace search can find, and the pure parts of asking for it.
//
// DB-free on purpose, like `lib/entity-address.ts`: `GET /api/meta` serves
// `SEARCH_TYPES`, the route validates against it, the CLI's copy is held to it by
// `lib/cli-vocabulary.test.ts`, and the query builder's term handling is worth
// unit-testing without a database. The query itself is
// `lib/db/queries/workspace-search.ts`.

/**
 * The record types `GET …/issues-search` reaches. In RESULT ORDER — the web
 * popup groups by this sequence, and the CLI prints in it.
 *
 * WIDER than `ENTITY_TYPES`: a label, a member and a comment are searchable and
 * have no URN, which is exactly what the platform entity index could not hold.
 */
export const SEARCH_TYPES = ['issue', 'task', 'project', 'label', 'member', 'comment'] as const
export type SearchType = (typeof SEARCH_TYPES)[number]

export interface SearchHit {
  type: SearchType
  /** The row id — what a label's URL and a comment's identity use. */
  id: number
  /** The workspace #number; null for the types that have none. */
  number: number | null
  /** What to show as the headline: a title, a name, or (for a comment) its parent's title. */
  title: string
  /** Secondary line — a member's email, a comment's author. */
  detail: string | null
  /** A window of the matched text, when the match was NOT in the title. */
  snippet: string | null
  /** Where the match was: `title`, or the field it was found in instead. */
  matched_in: 'title' | 'description' | 'comment' | 'email'
  /** Issue / project status, for the glyph. Null for everything else. */
  status: string | null
  color: string | null
  icon: string | null
  avatar_url: string | null
  /** A comment's parent — the record it lives on. */
  parent: { type: 'issue' | 'task' | 'project'; number: number } | null
  /** Where to open it, relative to this app's origin. */
  path: string
  urn: string | null
  /** In the recycle bin. Only ever true under `include_deleted`. */
  deleted: boolean
}

/** Hits per type when several types are searched — one noisy type must not push the rest off screen. */
export const SEARCH_PER_TYPE_DEFAULT = 5
/** Hits per type when exactly one type is asked for (the popup's type chips, `--type`). */
export const SEARCH_PER_TYPE_SINGLE_DEFAULT = 20
export const SEARCH_PER_TYPE_MAX = 25
/** More words than this are ignored: each is one more AND-ed predicate per column. */
export const SEARCH_TERMS_MAX = 6

/**
 * The words of a query, for AND-matching.
 *
 * A leading `#` is dropped so `#482` and `482` are the same term, mirroring the
 * listings' `?search=`. Duplicates collapse, order is kept (the first term also
 * decides where a snippet is cut).
 */
export function searchTerms(query: string): string[] {
  const out: string[] = []
  for (const raw of query.trim().split(/\s+/)) {
    const t = raw.replace(/^#/, '')
    if (t && !out.includes(t)) out.push(t)
    if (out.length === SEARCH_TERMS_MAX) break
  }
  return out
}

/** The workspace `#number` a query names outright (`#482`, `482`), or null. */
export function searchNumber(query: string): number | null {
  const q = query.trim()
  return /^#?\d{1,9}$/.test(q) ? Number(q.replace(/^#/, '')) : null
}

/** Escape `%`, `_` and `\` so a caller's text is matched literally by `ILIKE`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Decode the handful of entities the rich-text sanitizer emits, for display. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
