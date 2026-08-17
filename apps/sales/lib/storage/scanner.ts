// The sales app's reference scanner.
//
// This is the app half of the storage contract: `platform-storage` owns the
// registry, the ledger and the delete gate; this file owns the only thing the
// platform cannot know — **which of THIS app's columns can hold a file url**.
//
// ---------------------------------------------------------------------------
// TWENTY-TWO COLUMNS, TEN TABLES, AND THE RULE THAT PRODUCED THEM
// ---------------------------------------------------------------------------
// A column belongs here if a legitimate write can put an uploaded-file URL in it
// — authored prose (scanned for embedded urls) or a column that IS a url
// (matched exactly). The asymmetry settles every borderline case:
//
//   a wrongly-INCLUDED column costs one no-op scan per row.
//   a wrongly-EXCLUDED column costs a file somebody is still using, with no undo.
//
// `documents.external_url` is the non-obvious one. The column is FOR external
// links, so most rows contribute nothing — but nothing stops a caller putting a
// blob url there instead of in `upload_url`, and the CHECK
// (`documents_one_location`) then forbids the correct column. A file referenced
// only from an unscanned column is invisible to the delete gate. Matching it
// exactly filters non-uploads out for free.
//
// ---------------------------------------------------------------------------
// TRASHED ROWS COUNT
// ---------------------------------------------------------------------------
// Both methods include soft-deleted rows on purpose: an item in the recycle bin
// can be restored, so its files are still in use. This is the property that
// makes trash-restore safe against cleanup, and it is the same rule migration
// 0002's triggers apply — a soft delete assigns `deleted_at`, which is not one
// of the columns the trigger watches, so index rows survive it.
//
// ---------------------------------------------------------------------------
// FAILING IS THE POINT
// ---------------------------------------------------------------------------
// Neither method may swallow an error and report "no references":
// `platform-storage` treats a rejection as "cannot delete", which is the safe
// answer, and a caught error would turn it into the unsafe one.

import { sql, type SQL } from 'drizzle-orm'
import {
  extractUploadedUrls,
  isUploadedAsset,
  type Executor,
  type ReferenceScanner,
  type ScannedReference,
} from '@blackcode/platform-storage'
import { APP_SLUG } from '@/lib/app'
import {
  communications,
  contacts,
  documents,
  matches,
  meetings,
  objections,
  products,
  prospectNotes,
  prospects,
  stageEntries,
  strategies,
  templates,
} from '@/lib/db/schema'

interface Row {
  [k: string]: unknown
}

/**
 * The single source of truth for what this app scans and what 0002 triggers.
 *
 * Every entry is (source_type, table, workspace column, mode, columns) — the
 * same five arguments `platform.blob_refs_sync` takes, in the same order, so the
 * migration and the scanner are visibly two renderings of ONE list rather than
 * two lists that can disagree. `scanner.test.ts` asserts the migration's
 * `CREATE TRIGGER` statements match it exactly.
 *
 * ADD A CONTENT COLUMN → ADD IT HERE AND IN A NEW MIGRATION, SAME COMMIT.
 */
export const SURFACES = [
  // Migration 0008 added `address` here. It is prose, so it joins the scan
  // rather than getting an `exact` trigger of its own.
  // Migration 0008 added `address`; 0010 added `game_plan`.
  { type: 'prospect', columns: ['summary', 'next_action_note', 'closed_reason', 'address', 'game_plan'], mode: 'scan' },
  { type: 'contact', columns: ['notes'], mode: 'scan' },
  { type: 'stage_entry', columns: ['note'], mode: 'scan' },
  { type: 'meeting', columns: ['title', 'agenda', 'outcome'], mode: 'scan' },
  { type: 'communication', columns: ['subject', 'body'], mode: 'scan' },
  { type: 'objection', columns: ['spoken', 'real_fear', 'counter'], mode: 'scan' },
  // Migration 0011 added `internal_price_note` (sales #27).
  { type: 'product', columns: ['description', 'pitch', 'internal_price_note'], mode: 'scan' },
  { type: 'template', columns: ['subject', 'body'], mode: 'scan' },
  { type: 'document', columns: ['title', 'description'], mode: 'scan' },
  { type: 'document_url', columns: ['upload_url', 'external_url'], mode: 'exact' },
  // Migration 0007. A conferencing link is a url column, so it is matched
  // exactly rather than scanned — and it is covered for `external_url`'s reason
  // (see this file's header): nothing stops a caller pasting an uploaded
  // recording's blob url into the field the UI calls "link".
  { type: 'meeting_url', columns: ['meeting_url'], mode: 'exact' },
  { type: 'match', columns: ['why'], mode: 'scan' },
  // Migration 0008 (sales #34). Two more url columns, covered for the reason
  // stated at `external_url` and repeated at `meeting_url`: nothing stops
  // somebody pasting an uploaded file's blob url into a field the form calls
  // "Website" or "LinkedIn", and `exact` mode costs nothing when they do not —
  // `is_uploaded_asset` rejects a real linkedin.com/in/… outright.
  { type: 'prospect_url', columns: ['website'], mode: 'exact' },
  { type: 'contact_url', columns: ['linkedin'], mode: 'exact' },
  // Migration 0009 (sales #39). Agent-authored prose, and the likeliest place
  // in this schema for an uploaded screenshot's url to land — a site audit with
  // a screenshot attached is the issue's own example.
  { type: 'prospect_note', columns: ['body'], mode: 'scan' },
  // Migration 0010 (sales #37). `case_studies` is the likeliest place in this
  // schema for an uploaded deck's url — "the proof, by name or by URL".
  { type: 'strategy', columns: ['rationale', 'case_studies'], mode: 'scan' },
  // Migration 0011 (sales #29) — a product's own site, if it has one.
  { type: 'product_url', columns: ['external_url'], mode: 'exact' },
] as const satisfies ReadonlyArray<{
  type: string
  columns: readonly string[]
  mode: 'scan' | 'exact'
}>

/** Which app the index attributes each scanned type to. All of them are ours —
 *  sales writes into no platform-owned content table (D-13: no comments). */
export const INDEX_APP_BY_TYPE: Record<string, string> = Object.fromEntries(
  SURFACES.map((s) => [s.type, APP_SLUG])
)

/**
 * How to make the trigger recompute one row's references: assign the content
 * column(s) to themselves.
 *
 * An `UPDATE OF col` trigger fires on the column being ASSIGNED, not on the
 * value changing, so this rebuilds the index entry using the exact code that
 * maintains it — no second implementation to keep in step. It is what
 * `bk super-admin blob-drift --repair` and 0002's backfill both use.
 */
export const RETRIGGER_SQL: Record<string, (id: number) => SQL> = {
  prospect: (id) =>
    sql`UPDATE ${prospects} SET summary = summary, next_action_note = next_action_note, closed_reason = closed_reason, address = address, game_plan = game_plan WHERE id = ${id}`,
  contact: (id) => sql`UPDATE ${contacts} SET notes = notes WHERE id = ${id}`,
  stage_entry: (id) => sql`UPDATE ${stageEntries} SET note = note WHERE id = ${id}`,
  meeting: (id) =>
    sql`UPDATE ${meetings} SET title = title, agenda = agenda, outcome = outcome WHERE id = ${id}`,
  communication: (id) =>
    sql`UPDATE ${communications} SET subject = subject, body = body WHERE id = ${id}`,
  objection: (id) =>
    sql`UPDATE ${objections} SET spoken = spoken, real_fear = real_fear, counter = counter WHERE id = ${id}`,
  product: (id) =>
    sql`UPDATE ${products} SET description = description, pitch = pitch, internal_price_note = internal_price_note WHERE id = ${id}`,
  template: (id) => sql`UPDATE ${templates} SET subject = subject, body = body WHERE id = ${id}`,
  document: (id) =>
    sql`UPDATE ${documents} SET title = title, description = description WHERE id = ${id}`,
  document_url: (id) =>
    sql`UPDATE ${documents} SET upload_url = upload_url, external_url = external_url WHERE id = ${id}`,
  meeting_url: (id) => sql`UPDATE ${meetings} SET meeting_url = meeting_url WHERE id = ${id}`,
  match: (id) => sql`UPDATE ${matches} SET why = why WHERE id = ${id}`,
  prospect_url: (id) => sql`UPDATE ${prospects} SET website = website WHERE id = ${id}`,
  contact_url: (id) => sql`UPDATE ${contacts} SET linkedin = linkedin WHERE id = ${id}`,
  prospect_note: (id) => sql`UPDATE ${prospectNotes} SET body = body WHERE id = ${id}`,
  product_url: (id) => sql`UPDATE ${products} SET external_url = external_url WHERE id = ${id}`,
  strategy: (id) =>
    sql`UPDATE ${strategies} SET rationale = rationale, case_studies = case_studies WHERE id = ${id}`,
}

export const salesReferenceScanner: ReferenceScanner = {
  app: APP_SLUG,

  async scanWorkspace(db: Executor, workspaceId: number): Promise<Map<string, ScannedReference[]>> {
    const map = new Map<string, ScannedReference[]>()
    const add = (url: string, ref: ScannedReference) => {
      const list = map.get(url)
      if (list) list.push(ref)
      else map.set(url, [ref])
    }
    const scan = (text: unknown, ref: ScannedReference) => {
      for (const url of extractUploadedUrls(text as string)) add(url, ref)
    }

    const [prospectRows, contactRows, stageRows, meetingRows, commRows, objectionRows, productRows, templateRows, documentRows, matchRows, noteRows, strategyRows] =
      await Promise.all([
        db.execute(sql`SELECT id, seq, name, summary, next_action_note, closed_reason, address, game_plan, website, deleted_at FROM ${prospects} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, name, notes, linkedin, deleted_at FROM ${contacts} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, note FROM ${stageEntries} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, title, agenda, outcome, meeting_url, deleted_at FROM ${meetings} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, subject, body, deleted_at FROM ${communications} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, type, spoken, real_fear, counter FROM ${objections} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, name, description, pitch, internal_price_note, external_url, deleted_at FROM ${products} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, name, subject, body, deleted_at FROM ${templates} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, title, description, upload_url, external_url, deleted_at FROM ${documents} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, why FROM ${matches} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, kind, body FROM ${prospectNotes} WHERE workspace_id = ${workspaceId}`),
        db.execute(sql`SELECT id, seq, name, rationale, case_studies, deleted_at FROM ${strategies} WHERE workspace_id = ${workspaceId}`),
      ])

    for (const r of prospectRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'prospect', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.summary, ref)
      scan(r.next_action_note, ref)
      scan(r.closed_reason, ref)
      scan(r.address, ref)
      scan(r.game_plan, ref)
      // `website` IS a url rather than prose containing one — matched exactly,
      // the same treatment as `meeting_url` and the two document url columns.
      if (typeof r.website === 'string' && r.website && isUploadedAsset(r.website)) {
        add(r.website, { ...ref, type: 'prospect_url' })
      }
    }
    for (const r of contactRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'contact', id: Number(r.id), seq: null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.notes, ref)
      if (typeof r.linkedin === 'string' && r.linkedin && isUploadedAsset(r.linkedin)) {
        add(r.linkedin, { ...ref, type: 'contact_url' })
      }
    }
    for (const r of stageRows.rows as Row[]) {
      scan(r.note, { type: 'stage_entry', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of meetingRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'meeting', id: Number(r.id), seq: r.seq as number | null, label: (r.title as string) ?? null, trashed: r.deleted_at != null }
      scan(r.title, ref)
      scan(r.agenda, ref)
      scan(r.outcome, ref)
      // `meeting_url` IS a url rather than prose containing one, so it is
      // matched exactly — same treatment as the two document url columns below.
      if (typeof r.meeting_url === 'string' && r.meeting_url && isUploadedAsset(r.meeting_url)) {
        add(r.meeting_url, { ...ref, type: 'meeting_url' })
      }
    }
    for (const r of commRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'communication', id: Number(r.id), seq: r.seq as number | null, label: (r.subject as string) ?? null, trashed: r.deleted_at != null }
      scan(r.subject, ref)
      scan(r.body, ref)
    }
    for (const r of objectionRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'objection', id: Number(r.id), seq: null, label: (r.type as string) ?? null, trashed: false }
      scan(r.spoken, ref)
      scan(r.real_fear, ref)
      scan(r.counter, ref)
    }
    for (const r of productRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'product', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.description, ref)
      scan(r.pitch, ref)
      scan(r.internal_price_note, ref)
      if (typeof r.external_url === 'string' && r.external_url && isUploadedAsset(r.external_url)) {
        add(r.external_url, { ...ref, type: 'product_url' })
      }
    }
    for (const r of templateRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'template', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.subject, ref)
      scan(r.body, ref)
    }
    for (const r of documentRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'document', id: Number(r.id), seq: r.seq as number | null, label: (r.title as string) ?? null, trashed: r.deleted_at != null }
      scan(r.title, ref)
      scan(r.description, ref)
      // The two url columns reference a file by EXACT url rather than by
      // embedding it. `external_url` is included deliberately — see the header.
      for (const url of [r.upload_url, r.external_url]) {
        if (typeof url === 'string' && url && isUploadedAsset(url)) {
          add(url, { ...ref, type: 'document_url' })
        }
      }
    }
    for (const r of matchRows.rows as Row[]) {
      scan(r.why, { type: 'match', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of noteRows.rows as Row[]) {
      // `trashed: false` is a FACT here, not a default: this table has no
      // `deleted_at` (see schema.ts) — a note is either there or destroyed.
      scan(r.body, {
        type: 'prospect_note',
        id: Number(r.id),
        seq: null,
        label: (r.kind as string) ?? null,
        trashed: false,
      })
    }
    for (const r of strategyRows.rows as Row[]) {
      const ref: ScannedReference = {
        type: 'strategy',
        id: Number(r.id),
        seq: r.seq as number | null,
        label: (r.name as string) ?? null,
        trashed: r.deleted_at != null,
      }
      scan(r.rationale, ref)
      scan(r.case_studies, ref)
    }

    return map
  },

  // Across ALL workspaces, deliberately: the same uploaded url can be
  // copy-pasted between workspaces, and we must never delete a blob anything
  // still points at.
  //
  // strpos() (not LIKE) so the url is matched as a literal substring — filenames
  // may contain `_` or `%`, which LIKE would treat as wildcards.
  async isUrlReferenced(db: Executor, url: string): Promise<boolean> {
    const res = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${prospects}    WHERE strpos(coalesce(summary, ''), ${url}) > 0
                                         OR strpos(coalesce(next_action_note, ''), ${url}) > 0
                                         OR strpos(coalesce(closed_reason, ''), ${url}) > 0
                                         OR strpos(coalesce(address, ''), ${url}) > 0
                                         OR strpos(coalesce(game_plan, ''), ${url}) > 0
                                         OR website = ${url}
        UNION ALL
        SELECT 1 FROM ${contacts}     WHERE strpos(coalesce(notes, ''), ${url}) > 0
                                         OR linkedin = ${url}
        UNION ALL
        SELECT 1 FROM ${stageEntries} WHERE strpos(coalesce(note, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${meetings}     WHERE strpos(coalesce(title, ''), ${url}) > 0
                                         OR strpos(coalesce(agenda, ''), ${url}) > 0
                                         OR strpos(coalesce(outcome, ''), ${url}) > 0
                                         OR meeting_url = ${url}
        UNION ALL
        SELECT 1 FROM ${communications} WHERE strpos(coalesce(subject, ''), ${url}) > 0
                                           OR strpos(coalesce(body, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${objections}   WHERE strpos(coalesce(spoken, ''), ${url}) > 0
                                         OR strpos(coalesce(real_fear, ''), ${url}) > 0
                                         OR strpos(coalesce(counter, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${products}     WHERE strpos(coalesce(description, ''), ${url}) > 0
                                         OR strpos(coalesce(pitch, ''), ${url}) > 0
                                         OR strpos(coalesce(internal_price_note, ''), ${url}) > 0
                                         OR external_url = ${url}
        UNION ALL
        SELECT 1 FROM ${templates}    WHERE strpos(coalesce(subject, ''), ${url}) > 0
                                         OR strpos(coalesce(body, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${documents}    WHERE strpos(coalesce(title, ''), ${url}) > 0
                                         OR strpos(coalesce(description, ''), ${url}) > 0
                                         OR upload_url = ${url}
                                         OR external_url = ${url}
        UNION ALL
        SELECT 1 FROM ${matches}      WHERE strpos(coalesce(why, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${prospectNotes} WHERE strpos(coalesce(body, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${strategies}   WHERE strpos(coalesce(rationale, ''), ${url}) > 0
                                         OR strpos(coalesce(case_studies, ''), ${url}) > 0
      ) AS referenced
    `)
    return Boolean((res.rows[0] as Row | undefined)?.referenced)
  },
}
