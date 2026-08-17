// `bk sales search` — the INSIDE-the-records half of D-9.
//
// ---------------------------------------------------------------------------
// TWO SEARCHES, AND THE DIFFERENCE IS THE POINT
// ---------------------------------------------------------------------------
//   bk search        reads `platform.entities`, which holds TITLES ONLY, across
//                    every app. "Where is the thing called X?" Returns URNs.
//   bk sales search   reads `sales.*` full text. "Find X INSIDE prospect
//                    summaries, meeting outcomes, comm bodies, template copy."
//
// If both return the same rows for the same term, D-9 is described and not
// built. The property that makes them different is that this one matches on
// columns the projection never sees — a phrase in a call summary is here and
// cannot be there — and the `snippet` returned below is drawn from exactly those
// columns, so a caller can SEE which is which.
//
// ---------------------------------------------------------------------------
// `simple`, NOT `english`, AND `to_tsquery` RATHER THAN `plainto_tsquery`
// ---------------------------------------------------------------------------
// The generated columns use `to_tsvector('simple', …)` — `docs/backend.md` §3.5
// records why, and the query configuration MUST match the column's or the
// lexemes do not line up and a stemmed query silently matches nothing.
//
// Prefix matching (`x:*`) covers shipped/shipping, which is what `simple` gives
// up by not stemming. The query string is built from the caller's words with
// `websearch_to_tsquery` first — it accepts quotes and OR the way a human types
// them and never raises on malformed input, which `to_tsquery` does — and falls
// back to a prefix query on the last word so an agent typing half a company name
// gets the hit it expects.

import { sql } from 'drizzle-orm'
import { getDb } from '../client'
import { SEARCH_QUERY_MIN, SEARCH_RESULTS_MAX } from '@/lib/limits'

/** The sales tables `bk sales search` reaches into. */
export const SEARCH_TYPES = [
  'prospect',
  'contact',
  'meeting',
  'communication',
  'objection',
  'product',
  'template',
  'document',
  'match',
  // Migration 0009 (#39). Searchable and #number-less, like `contact` and
  // `objection` — and it is the highest-value addition to this list since the
  // corpus was written, because a research log is where a proper noun somebody
  // half-remembers actually lives.
  'prospect_note',
  'strategy',
] as const
export type SearchType = (typeof SEARCH_TYPES)[number]

export interface SearchHit {
  type: SearchType
  /** The #number, or null for the four types that have none. */
  number: number | null
  /** The prospect this hit hangs off, when it hangs off one. */
  prospect_number: number | null
  title: string
  /** Text from the matched row — the columns `platform.entities` never holds. */
  snippet: string | null
  rank: number
  /** Present only for the projected types. Null is an answer, not a gap. */
  urn: string | null
}

/**
 * Full-text search across this app's records.
 *
 * One UNION rather than nine round trips: ranking is only meaningful when the
 * candidates are compared against each other, and nine separately-limited lists
 * merged in JavaScript is not a ranked result, it is nine truncated ones.
 */
export async function searchSales(opts: {
  workspaceId: number
  workspaceSlug: string
  query: string
  types?: SearchType[]
  limit?: number
}): Promise<SearchHit[]> {
  const q = opts.query.trim()
  if (q.length < SEARCH_QUERY_MIN) return []
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), SEARCH_RESULTS_MAX)
  const wanted = opts.types?.length ? opts.types : SEARCH_TYPES
  const db = getDb()

  // `websearch_to_tsquery` for the words as typed, OR'd with a prefix match on
  // the last word. The prefix half is what makes "roch" find "Roches" — the
  // thing `simple` gives up by not stemming, bought back where it matters.
  const lastWord = q.split(/\s+/).filter(Boolean).pop() ?? q
  const prefix = lastWord.replace(/[^\p{L}\p{N}_]/gu, '')
  const tsquery = prefix
    ? sql`(websearch_to_tsquery('simple', ${q}) || to_tsquery('simple', ${prefix + ':*'}))`
    : sql`websearch_to_tsquery('simple', ${q})`

  const include = (t: SearchType) => wanted.includes(t)
  const parts = []

  if (include('prospect')) {
    parts.push(sql`
      SELECT 'prospect' AS type, p.seq AS number, p.seq AS prospect_number, p.name AS title,
             left(coalesce(p.summary, p.next_action_note, p.sector, ''), 240) AS snippet,
             ts_rank(p.search, ${tsquery}) AS rank
      FROM sales.prospects p
      WHERE p.workspace_id = ${opts.workspaceId} AND p.deleted_at IS NULL
        AND p.search @@ ${tsquery}`)
  }
  if (include('contact')) {
    parts.push(sql`
      SELECT 'contact', NULL::int, p.seq, c.name,
             left(concat_ws(' · ', c.role, c.email, c.notes), 240),
             ts_rank(c.search, ${tsquery})
      FROM sales.contacts c JOIN sales.prospects p ON p.id = c.prospect_id
      WHERE c.workspace_id = ${opts.workspaceId} AND c.deleted_at IS NULL
        AND c.search @@ ${tsquery}`)
  }
  if (include('meeting')) {
    parts.push(sql`
      SELECT 'meeting', m.seq, p.seq, m.title,
             left(coalesce(m.outcome, m.agenda, ''), 240),
             ts_rank(m.search, ${tsquery})
      FROM sales.meetings m JOIN sales.prospects p ON p.id = m.prospect_id
      WHERE m.workspace_id = ${opts.workspaceId} AND m.deleted_at IS NULL
        AND m.search @@ ${tsquery}`)
  }
  if (include('communication')) {
    parts.push(sql`
      SELECT 'communication', x.seq, p.seq,
             coalesce(x.subject, concat(x.channel, ' · ', x.direction)),
             left(coalesce(x.body, ''), 240),
             ts_rank(x.search, ${tsquery})
      FROM sales.communications x JOIN sales.prospects p ON p.id = x.prospect_id
      WHERE x.workspace_id = ${opts.workspaceId} AND x.deleted_at IS NULL
        AND x.search @@ ${tsquery}`)
  }
  if (include('objection')) {
    parts.push(sql`
      SELECT 'objection', NULL::int, p.seq, concat(o.type, ' · ', coalesce(o.raised_by, '—')),
             left(concat_ws(' / ', o.spoken, o.real_fear, o.counter), 240),
             ts_rank(o.search, ${tsquery})
      FROM sales.objections o JOIN sales.prospects p ON p.id = o.prospect_id
      WHERE o.workspace_id = ${opts.workspaceId} AND o.search @@ ${tsquery}`)
  }
  if (include('prospect_note')) {
    parts.push(sql`
      SELECT 'prospect_note', NULL::int, p.seq,
             concat(coalesce(nullif(n.kind, ''), 'note'), ' · ', p.name),
             left(n.body, 240),
             ts_rank(n.search, ${tsquery})
      FROM sales.prospect_notes n JOIN sales.prospects p ON p.id = n.prospect_id
      WHERE n.workspace_id = ${opts.workspaceId} AND n.search @@ ${tsquery}`)
  }
  if (include('strategy')) {
    parts.push(sql`
      SELECT 'strategy', g.seq, NULL::int, g.name,
             left(concat_ws(' · ', g.vertical, g.area, g.rationale), 240),
             ts_rank(g.search, ${tsquery})
      FROM sales.strategies g
      WHERE g.workspace_id = ${opts.workspaceId} AND g.deleted_at IS NULL
        AND g.search @@ ${tsquery}`)
  }
  if (include('product')) {
    parts.push(sql`
      SELECT 'product', pr.seq, NULL::int, pr.name,
             left(coalesce(pr.pitch, pr.description, ''), 240),
             ts_rank(pr.search, ${tsquery})
      FROM sales.products pr
      WHERE pr.workspace_id = ${opts.workspaceId} AND pr.deleted_at IS NULL
        AND pr.search @@ ${tsquery}`)
  }
  if (include('template')) {
    parts.push(sql`
      SELECT 'template', t.seq, NULL::int, t.name,
             left(coalesce(t.subject, t.body, ''), 240),
             ts_rank(t.search, ${tsquery})
      FROM sales.templates t
      WHERE t.workspace_id = ${opts.workspaceId} AND t.deleted_at IS NULL
        AND t.search @@ ${tsquery}`)
  }
  if (include('document')) {
    parts.push(sql`
      SELECT 'document', d.seq, NULL::int, d.title,
             left(coalesce(d.description, ''), 240),
             ts_rank(d.search, ${tsquery})
      FROM sales.documents d
      WHERE d.workspace_id = ${opts.workspaceId} AND d.deleted_at IS NULL
        AND d.search @@ ${tsquery}`)
  }
  if (include('match')) {
    parts.push(sql`
      SELECT 'match', NULL::int, p.seq, concat('match · ', pr.name),
             left(coalesce(mm.why, ''), 240),
             ts_rank(mm.search, ${tsquery})
      FROM sales.matches mm
        JOIN sales.prospects p ON p.id = mm.prospect_id
        JOIN sales.products pr ON pr.id = mm.product_id
      WHERE mm.workspace_id = ${opts.workspaceId} AND mm.search @@ ${tsquery}`)
  }

  if (parts.length === 0) return []
  const res = await db.execute(sql`
    SELECT * FROM (${sql.join(parts, sql` UNION ALL `)}) hits
    ORDER BY rank DESC, type, number NULLS LAST
    LIMIT ${limit}`)

  return res.rows.map((r) => {
    const type = String(r.type) as SearchType
    const number = r.number == null ? null : Number(r.number)
    return {
      type,
      number,
      prospect_number: r.prospect_number == null ? null : Number(r.prospect_number),
      title: String(r.title ?? ''),
      snippet: r.snippet == null || String(r.snippet).trim() === '' ? null : String(r.snippet),
      rank: Number(r.rank ?? 0),
      // Only the projected types have one. Building a URN for a contact would
      // advertise an address nothing resolves — `lib/entity-address.ts`.
      urn: number != null && isProjected(type) ? `bc:sales:${opts.workspaceSlug}/${type}/${number}` : null,
    }
  })
}

const PROJECTED: ReadonlySet<string> = new Set([
  'prospect',
  'meeting',
  'communication',
  'product',
  'template',
  'document',
])
const isProjected = (t: string) => PROJECTED.has(t)
