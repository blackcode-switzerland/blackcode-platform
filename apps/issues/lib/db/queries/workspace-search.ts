// Workspace search — one question ("where is X?") answered across every kind of
// record this app holds. Backs `GET /api/workspaces/{ws}/issues-search`, the web
// popup and `bk issues search`.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT `searchEntities`, AND WHY NOT tsvector
// ---------------------------------------------------------------------------
// `searchEntities` (platform-db) reads `platform.entities`: titles, three types,
// and nothing else — a label, a person, a phrase in a description or a comment is
// invisible to it, and none of them can be projected without a migration and a
// reconciler. This reads the source tables.
//
// It is `ILIKE`, not full text, for the reason the listings' `?search=` is: the
// rows are one workspace's, the predicate is the same one every list already
// runs, and a generated tsvector column is a migration on a live app that buys
// stemming nobody asked for. If a workspace ever makes this slow the route's
// contract does not change when the engine underneath does.
//
// ---------------------------------------------------------------------------
// THE PREDICATES THAT MUST NOT BE LEFT OUT
// ---------------------------------------------------------------------------
//   * every arm is scoped to `workspace_id` — there is no query without one;
//   * labels: `visibleToThisApp` — another app's labels are not this app's
//     business, and `labels.app-scope.test.ts` exists because that was once
//     forgotten on a read;
//   * comments: BOTH type forms (`ownTypeIn`, qualified and legacy bare) and the
//     parent must exist, be in this workspace and not be binned — a comment on a
//     binned issue is not a result, it is a dangling pointer;
//   * members: a soft-deleted user is not a person you can find.
//
// Rich-text columns hold HTML. They are stripped IN SQL before matching, so a
// search for `div` or `href` does not "find" markup, and the snippet is cut from
// the stripped text.

import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client'
import { issues, projects, tasks, users, workspaceMembers, comments, labels } from '../schema'
import { entityPath, entityUrnOrNull } from '@/lib/entity-address'
import { ownTypeIn } from './qualified-type'
import { visibleToThisApp } from './labels'
import {
  SEARCH_TYPES,
  decodeEntities,
  escapeLike,
  searchNumber,
  searchTerms,
  type SearchHit,
  type SearchType,
} from '@/lib/search-types'

export type { SearchHit }

export interface WorkspaceSearchOptions {
  workspaceId: number
  workspaceSlug: string
  query: string
  /** Empty means every type. */
  types?: readonly SearchType[]
  perType?: number
  /** Cap on the whole answer, after the per-type caps. */
  limit?: number
  includeDeleted?: boolean
}

interface Ctx {
  ws: number
  slug: string
  q: string
  terms: string[]
  num: number | null
  /** The query was an explicit `#N`: find the record numbered N, do not text-search for "N". */
  numberOnly: boolean
  perType: number
  includeDeleted: boolean
}

// ── fragments ───────────────────────────────────────────────────────────────

/** HTML → text: tags become spaces, the two entities that change a match are decoded. */
function plain(col: string): SQL {
  return sql`replace(replace(regexp_replace(coalesce(${sql.raw(col)}, ''), '<[^>]*>', ' ', 'g'), '&nbsp;', ' '), '&amp;', '&')`
}

/** Every term must appear (AND), each in any of `cols` (OR). */
function matchAll(terms: string[], cols: string[]): SQL {
  const perTerm = terms.map((t) => {
    const like = `%${escapeLike(t)}%`
    return sql`(${sql.join(
      cols.map((c) => sql`${sql.raw(c)} ILIKE ${like}`),
      sql` OR `
    )})`
  })
  return sql.join(perTerm, sql` AND `)
}

/**
 * Relevance of a row, from its headline column. Explicit and boring on purpose —
 * an exact `#number` beats an exact title beats a prefix beats a word start beats
 * a substring beats "the words are all in there, somewhere" beats "matched only
 * in the body". Ties fall to recency in the ORDER BY.
 */
function rank(title: string, seq: string | null, c: Ctx): SQL {
  const t = sql.raw(title)
  const esc = escapeLike(c.q)
  const numberArm = seq && c.num !== null ? sql`WHEN ${sql.raw(seq)} = ${c.num} THEN 100` : sql``
  return sql`(CASE
    ${numberArm}
    WHEN lower(${t}) = lower(${c.q}) THEN 95
    WHEN ${t} ILIKE ${esc + '%'} THEN 80
    WHEN ${t} ILIKE ${'% ' + esc + '%'} THEN 60
    WHEN ${t} ILIKE ${'%' + esc + '%'} THEN 40
    WHEN ${matchAll(c.terms, [title])} THEN 30
    ELSE 10 END)`
}

/** The columns a snippet is made of: a 160-char window cut near the first term found. */
function snippet(plainCol: string, c: Ctx): SQL {
  const p = sql.raw(plainCol)
  const positions = sql.join(
    c.terms.map((t) => sql`nullif(position(${t.toLowerCase()}::text in lower(${p})), 0)`),
    sql`, `
  )
  const start = sql`greatest(coalesce(${positions}, 1) - 40, 1)`
  return sql`btrim(regexp_replace(substr(${p}, ${start}, 160), '[[:space:]]+', ' ', 'g')) AS snip,
    ${start} AS snip_from,
    length(${p}) AS plain_len`
}

/**
 * The match predicate for a numbered record. A bare `482` is a text search that
 * ALSO matches the number; an explicit `#482` is a jump — it means "the record
 * numbered 482" and nothing that merely contains those digits.
 */
function wherePart(seq: string, cols: string[], c: Ctx): SQL {
  const bySeq = c.num !== null ? sql`${sql.raw(seq)} = ${c.num}` : null
  if (c.numberOnly && bySeq) return bySeq
  return bySeq ? sql`(${bySeq} OR ${matchAll(c.terms, cols)})` : matchAll(c.terms, cols)
}

function binFilter(alias: string, c: Ctx): SQL {
  return c.includeDeleted ? sql`` : sql`AND ${sql.raw(alias)}.deleted_at IS NULL`
}

/** The ` … ` framing of a cut snippet. Null when there is nothing worth showing. */
function frame(row: Record<string, unknown>): string | null {
  const raw = typeof row.snip === 'string' ? row.snip : ''
  if (!raw) return null
  const from = Number(row.snip_from) || 1
  const total = Number(row.plain_len) || 0
  const text = decodeEntities(raw)
  return `${from > 1 ? '… ' : ''}${text}${from - 1 + 160 < total ? ' …' : ''}`
}

const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// ── one arm per type ────────────────────────────────────────────────────────

type Arm = (c: Ctx) => Promise<SearchHit[]>

function workItemHit(type: 'issue' | 'task' | 'project', row: Record<string, unknown>, c: Ctx): SearchHit {
  const number = n(row.number) as number
  const titleHit = row.title_hit === true
  return {
    type,
    id: Number(row.id),
    number,
    title: String(row.title),
    detail: null,
    snippet: titleHit ? null : frame(row),
    matched_in: titleHit ? 'title' : 'description',
    status: s(row.status),
    color: s(row.color),
    icon: s(row.icon),
    avatar_url: null,
    parent: null,
    path: entityPath(c.slug, type, number),
    urn: entityUrnOrNull(c.slug, type, number),
    deleted: row.deleted_at != null,
  }
}

const issueArm: Arm = async (c) => {
  const res = await db.execute(sql`
    SELECT i.id, i.seq AS number, i.title, i.status, i.deleted_at,
      ${matchAll(c.terms, ['i.title'])} AS title_hit,
      ${rank('i.title', 'i.seq', c)} AS rank,
      ${snippet('p.plain', c)}
    FROM ${issues} i
    CROSS JOIN LATERAL (SELECT ${plain('i.description')} AS plain) p
    WHERE i.workspace_id = ${c.ws} AND i.seq IS NOT NULL ${binFilter('i', c)}
      AND ${wherePart('i.seq', ['i.title', 'p.plain'], c)}
    ORDER BY rank DESC, i.updated_at DESC
    LIMIT ${c.perType}`)
  return res.rows.map((r) => workItemHit('issue', r, c))
}

const taskArm: Arm = async (c) => {
  const res = await db.execute(sql`
    SELECT t.id, t.seq AS number, t.name AS title, t.deleted_at,
      ${matchAll(c.terms, ['t.name'])} AS title_hit,
      ${rank('t.name', 't.seq', c)} AS rank,
      ${snippet('p.plain', c)}
    FROM ${tasks} t
    CROSS JOIN LATERAL (SELECT ${plain('t.description')} AS plain) p
    WHERE t.workspace_id = ${c.ws} AND t.seq IS NOT NULL ${binFilter('t', c)}
      AND ${wherePart('t.seq', ['t.name', 'p.plain'], c)}
    ORDER BY rank DESC, t.updated_at DESC
    LIMIT ${c.perType}`)
  return res.rows.map((r) => workItemHit('task', r, c))
}

const projectArm: Arm = async (c) => {
  // `summary` is the one-line blurb and `description` the rich-text body; a hit
  // in either is "in the description" to the person reading the popup.
  const res = await db.execute(sql`
    SELECT pr.id, pr.seq AS number, pr.name AS title, pr.status, pr.color, pr.icon, pr.deleted_at,
      ${matchAll(c.terms, ['pr.name'])} AS title_hit,
      ${rank('pr.name', 'pr.seq', c)} AS rank,
      ${snippet('p.plain', c)}
    FROM ${projects} pr
    CROSS JOIN LATERAL (
      SELECT ${plain('pr.summary')} || ' ' || ${plain('pr.description')} AS plain
    ) p
    WHERE pr.workspace_id = ${c.ws} AND pr.seq IS NOT NULL ${binFilter('pr', c)}
      AND ${wherePart('pr.seq', ['pr.name', 'p.plain'], c)}
    ORDER BY rank DESC, pr.updated_at DESC
    LIMIT ${c.perType}`)
  return res.rows.map((r) => workItemHit('project', r, c))
}

const labelArm: Arm = async (c) => {
  const res = await db.execute(sql`
    SELECT l.id, l.name AS title, l.color,
      ${matchAll(c.terms, ['l.name'])} AS title_hit,
      ${rank('l.name', null, c)} AS rank,
      ${snippet('p.plain', c)}
    FROM ${labels} l
    CROSS JOIN LATERAL (SELECT ${plain('l.description')} AS plain) p
    WHERE l.workspace_id = ${c.ws} AND ${visibleToThisApp('l')}
      AND ${matchAll(c.terms, ['l.name', 'p.plain'])}
    ORDER BY rank DESC, l.name ASC
    LIMIT ${c.perType}`)
  return res.rows.map((r): SearchHit => {
    const titleHit = r.title_hit === true
    return {
      type: 'label',
      id: Number(r.id),
      number: null,
      title: String(r.title),
      detail: null,
      snippet: titleHit ? null : frame(r),
      matched_in: titleHit ? 'title' : 'description',
      status: null,
      color: s(r.color),
      icon: null,
      avatar_url: null,
      parent: null,
      path: `/dashboard/${c.slug}/labels/${Number(r.id)}`,
      urn: null,
      deleted: false,
    }
  })
}

const memberArm: Arm = async (c) => {
  const res = await db.execute(sql`
    SELECT u.id, coalesce(nullif(u.name, ''), u.email) AS title, u.name, u.email, u.avatar_url,
      ${matchAll(c.terms, ["coalesce(nullif(u.name, ''), u.email)"])} AS title_hit,
      ${rank("coalesce(nullif(u.name, ''), u.email)", null, c)} AS rank
    FROM ${workspaceMembers} wm
    JOIN ${users} u ON u.id = wm.user_id
    WHERE wm.workspace_id = ${c.ws} AND u.deleted_at IS NULL
      AND ${matchAll(c.terms, ['u.name', 'u.email'])}
    ORDER BY rank DESC, u.name ASC NULLS LAST
    LIMIT ${c.perType}`)
  return res.rows.map((r): SearchHit => ({
    type: 'member',
    id: Number(r.id),
    number: null,
    title: String(r.title),
    // The email is the second line only when the headline is a name; when the
    // headline IS the email, repeating it would be noise.
    detail: s(r.name) ? s(r.email) : null,
    snippet: null,
    matched_in: r.title_hit === true ? 'title' : 'email',
    status: null,
    color: null,
    icon: null,
    avatar_url: s(r.avatar_url),
    parent: null,
    // Members are managed on the workspace settings page; there is no
    // per-person page in this app to open.
    path: `/dashboard/${c.slug}/settings`,
    urn: null,
    deleted: false,
  }))
}

const commentArm: Arm = async (c) => {
  // One arm per parent kind, joined to its own table: the parent is what makes a
  // comment a result (it supplies the title, the #number and the URL) and what
  // makes a stale one a non-result (binned or foreign-workspace parents drop out).
  const one = (kind: 'issue' | 'task' | 'project', table: typeof issues | typeof tasks | typeof projects, titleCol: string) => sql`
    SELECT c.id, ${kind}::text AS kind, par.seq AS number, par.${sql.raw(titleCol)} AS title,
      coalesce(nullif(u.name, ''), u.email) AS author, c.created_at,
      ${snippet('p.plain', c)}
    FROM ${comments} c
    JOIN ${table} par ON par.id = c.parent_id AND par.workspace_id = ${c.ws}
      AND par.seq IS NOT NULL ${binFilter('par', c)}
    LEFT JOIN ${users} u ON u.id = c.user_id
    CROSS JOIN LATERAL (SELECT ${plain('c.content')} AS plain) p
    WHERE c.workspace_id = ${c.ws} AND c.parent_type IN ${ownTypeIn(kind)}
      AND ${matchAll(c.terms, ['p.plain'])}`
  const res = await db.execute(sql`
    SELECT * FROM (
      ${one('issue', issues, 'title')} UNION ALL
      ${one('task', tasks, 'name')} UNION ALL
      ${one('project', projects, 'name')}
    ) hits
    ORDER BY created_at DESC
    LIMIT ${c.perType}`)
  return res.rows.map((r): SearchHit => {
    const kind = r.kind as 'issue' | 'task' | 'project'
    const number = Number(r.number)
    return {
      type: 'comment',
      id: Number(r.id),
      number,
      title: String(r.title),
      detail: s(r.author),
      snippet: frame(r),
      matched_in: 'comment',
      status: null,
      color: null,
      icon: null,
      avatar_url: null,
      parent: { type: kind, number },
      path: entityPath(c.slug, kind, number),
      urn: entityUrnOrNull(c.slug, kind, number),
      deleted: false,
    }
  })
}

const ARMS: Record<SearchType, Arm> = {
  issue: issueArm,
  task: taskArm,
  project: projectArm,
  label: labelArm,
  member: memberArm,
  comment: commentArm,
}

/**
 * Search the workspace. Types run in parallel and come back in `SEARCH_TYPES`
 * order, each already capped and ranked; `limit` then trims the tail.
 */
export async function searchWorkspace(opts: WorkspaceSearchOptions): Promise<SearchHit[]> {
  const q = opts.query.trim().replace(/\s+/g, ' ')
  const terms = searchTerms(q)
  if (terms.length === 0) return []
  const numberOnly = /^#\d{1,9}$/.test(q)
  // `#482` only has an answer among the numbered types — a label, a person and a
  // comment have no number, and matching their text for "482" is noise.
  const numbered: readonly SearchType[] = ['issue', 'task', 'project']
  const wanted = SEARCH_TYPES.filter(
    (t) => (!opts.types?.length || opts.types.includes(t)) && (!numberOnly || numbered.includes(t))
  )
  const ctx: Ctx = {
    ws: opts.workspaceId,
    slug: opts.workspaceSlug,
    q: terms.join(' '),
    terms,
    num: searchNumber(q),
    numberOnly,
    perType: opts.perType ?? 5,
    includeDeleted: opts.includeDeleted ?? false,
  }
  const groups = await Promise.all(wanted.map((t) => ARMS[t](ctx)))
  const all = groups.flat()
  return opts.limit ? all.slice(0, opts.limit) : all
}
