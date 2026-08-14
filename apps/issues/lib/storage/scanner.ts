// The issues app's reference scanner.
//
// This is the app half of the storage contract: `platform-storage` owns the
// registry, the ledger and the delete gate; this file owns the only thing the
// platform cannot know — which of *this* app's tables can hold a file url.
//
// The queries are the ones that lived in `lib/blob-refs.ts` before Phase 7, kept
// deliberately intact: they are the code that has been protecting production
// files, and a rewrite alongside a registry change would have made any
// regression impossible to attribute.
//
// Seven surfaces carry urls: issue / task / project descriptions, project
// summaries, comments, project-update bodies, attachment rows, and a project's
// logo/banner (`icon_url`/`banner_url`, added 2026-08-13). The last two hold an
// EXACT url rather than embedding one in text, so they are matched by equality
// rather than by extraction — see migration 0047.
//
// TRASHED ROWS COUNT. Both queries include soft-deleted rows on purpose — an
// item in the recycle bin can be restored, so its files are still in use. This
// is the property that makes trash-restore and undo safe against cleanup.
//
// FAILING IS THE POINT. Neither method may swallow an error and report "no
// references": `platform-storage` treats a rejection as "cannot delete", which
// is the safe answer, and a caught error would turn it into the unsafe one.

import { sql, type SQL } from 'drizzle-orm'
import {
  extractUploadedUrls,
  isUploadedAsset,
  type Executor,
  type ReferenceScanner,
  type ScannedReference,
} from '@blackcode/platform-storage'
import { APP_SLUG } from '@/lib/app'
import { attachments, comments, issues, projectUpdates, projects, tasks } from '@/lib/db/schema'

interface Row {
  [k: string]: unknown
}

// ---------------------------------------------------------------------------
// THE INDEX SIDE OF THE SAME SEVEN SURFACES (Phase 8)
// ---------------------------------------------------------------------------
// Migration 0037 puts a trigger on every table scanned below, so that a
// deployment which cannot read `issues.*` can still learn what this app
// references. These two maps are the seam between the two mechanisms, and they
// live HERE — beside the queries — so that adding a seventh surface means
// editing one file rather than remembering three.
//
// If you add a surface: add it to `scanWorkspace` and `isUrlReferenced` above, a
// trigger in a new migration, and a line to each map below.
// `lib/storage/drift.integration.test.ts` fails if the maps and the scanner
// disagree about which types exist.

/**
 * Which app the index attributes each scanned reference type to.
 *
 * `comment` is `'platform'` and the rest are `'issues'`, because
 * `platform.comments` is a platform-owned table every app writes into: its
 * references belong to no single app, so the delete gate always consults
 * `'platform'` regardless of which scanners are registered.
 */
export const INDEX_APP_BY_TYPE: Record<string, string> = {
  issue: APP_SLUG,
  task: APP_SLUG,
  project: APP_SLUG,
  // The project's logo/banner columns, indexed separately from its rich text
  // because they are `exact`-mode urls rather than text to extract from.
  // Migration 0047 explains why the source_type has to differ.
  project_image: APP_SLUG,
  project_update: APP_SLUG,
  attachment: APP_SLUG,
  comment: 'platform',
}

/**
 * How to make the trigger recompute one row's references: assign the content
 * column(s) to themselves.
 *
 * An `UPDATE OF col` trigger fires on the column being ASSIGNED, not on the
 * value changing, so this rebuilds the index entry for that row using the exact
 * code that maintains it — no second implementation to keep in step. It is what
 * `bk super-admin blob-drift --repair` and migration 0037's backfill both use.
 */
export const RETRIGGER_SQL: Record<string, (id: number) => SQL> = {
  issue: (id) => sql`UPDATE ${issues} SET description = description WHERE id = ${id}`,
  task: (id) => sql`UPDATE ${tasks} SET description = description WHERE id = ${id}`,
  project: (id) =>
    sql`UPDATE ${projects} SET summary = summary, description = description WHERE id = ${id}`,
  project_image: (id) =>
    sql`UPDATE ${projects} SET icon_url = icon_url, banner_url = banner_url WHERE id = ${id}`,
  project_update: (id) => sql`UPDATE ${projectUpdates} SET body = body WHERE id = ${id}`,
  attachment: (id) => sql`UPDATE ${attachments} SET file_url = file_url WHERE id = ${id}`,
  comment: (id) => sql`UPDATE ${comments} SET content = content WHERE id = ${id}`,
}

export const issuesReferenceScanner: ReferenceScanner = {
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

    const [issueRows, taskRows, projectRows, commentRows, updates, atts] = await Promise.all([
      db.execute(sql`SELECT id, seq, title, description, deleted_at FROM ${issues} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, seq, name, description, deleted_at FROM ${tasks} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, seq, name, summary, description, icon_url, banner_url, deleted_at FROM ${projects} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, content, parent_type FROM ${comments} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, body FROM ${projectUpdates} WHERE workspace_id = ${workspaceId}`),
      db.execute(sql`SELECT id, issue_id, file_url, filename FROM ${attachments} WHERE workspace_id = ${workspaceId}`),
    ])

    for (const r of issueRows.rows as Row[]) {
      scan(r.description, { type: 'issue', id: Number(r.id), seq: r.seq as number | null, label: (r.title as string) ?? null, trashed: r.deleted_at != null })
    }
    for (const r of taskRows.rows as Row[]) {
      scan(r.description, { type: 'task', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null })
    }
    for (const r of projectRows.rows as Row[]) {
      const ref: ScannedReference = { type: 'project', id: Number(r.id), seq: r.seq as number | null, label: (r.name as string) ?? null, trashed: r.deleted_at != null }
      scan(r.summary, ref)
      scan(r.description, ref)
      // The logo/banner hold an exact url rather than text to extract from, and
      // are reported under their own type so this matches what the index holds.
      const imageRef: ScannedReference = { ...ref, type: 'project_image' }
      for (const col of [r.icon_url, r.banner_url]) {
        if (typeof col === 'string' && isUploadedAsset(col)) add(col, imageRef)
      }
    }
    for (const r of commentRows.rows as Row[]) {
      scan(r.content, { type: 'comment', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of updates.rows as Row[]) {
      scan(r.body, { type: 'project_update', id: Number(r.id), seq: null, label: null, trashed: false })
    }
    for (const r of atts.rows as Row[]) {
      // An attachment row references its file by exact URL.
      const url = r.file_url as string
      if (url && isUploadedAsset(url)) {
        add(url, { type: 'attachment', id: Number(r.id), seq: r.issue_id as number | null, label: (r.filename as string) ?? null, trashed: false })
      }
    }

    return map
  },

  // Across ALL workspaces, deliberately: the same uploaded url can be
  // copy-pasted between workspaces, and we must never delete a blob anything
  // still points at.
  //
  // strpos() (not LIKE) so the url is matched as a literal substring — filenames
  // may contain `_`/`%`, which LIKE would treat as wildcards.
  async isUrlReferenced(db: Executor, url: string): Promise<boolean> {
    const res = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${issues}          WHERE strpos(coalesce(description, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${tasks}           WHERE strpos(coalesce(description, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${projects}        WHERE strpos(coalesce(description, ''), ${url}) > 0
                                         OR strpos(coalesce(summary, ''), ${url}) > 0
                                         OR icon_url = ${url}
                                         OR banner_url = ${url}
        UNION ALL
        SELECT 1 FROM ${comments}        WHERE strpos(coalesce(content, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${projectUpdates} WHERE strpos(coalesce(body, ''), ${url}) > 0
        UNION ALL
        SELECT 1 FROM ${attachments}     WHERE file_url = ${url}
      ) AS referenced
    `)
    return Boolean((res.rows[0] as Row | undefined)?.referenced)
  },
}
