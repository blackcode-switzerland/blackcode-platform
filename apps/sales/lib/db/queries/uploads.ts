// This app's upload LEDGER — `sales.uploads`, since Phase 3.
//
// ---------------------------------------------------------------------------
// WHAT SPLIT, AND WHAT DID NOT
// ---------------------------------------------------------------------------
// The record split; the bytes did not. There is still ONE Vercel Blob store,
// one bill, one quota, and one cross-app delete gate — `platform.blob_references`,
// maintained by Postgres triggers from this app's own content tables (migration
// 0002) and untouched by this file. Nothing here can reach `del()`.
//
// What this owns is the two database sentences at the end of `/api/upload`:
// which workspace the file belongs to, and the row that says the file exists.
// Both used to be answered against `platform.*` by shared code; both are now
// answered here, behind `UploadLedger` (packages/platform-api/src/upload-ledger.ts).
//
// ---------------------------------------------------------------------------
// WHY ATTRIBUTION COULD NOT STAY SHARED — the bug this closes
// ---------------------------------------------------------------------------
// `attributeUpload` in platform-storage falls back to
// `platform.users.active_workspace_id`. That column is ONE column shared by
// every deployment, and this app deliberately never writes it (see
// `lib/api.ts`'s `setDefaultForUser`). So for a sales upload it held whichever
// workspace the caller last selected IN ISSUES, and the file would have been
// filed under that workspace's slug and attributed to its id — an issues
// workspace id written into a sales ledger row, which after Phase 2 means a
// different team.
//
// This implementation asks this app's own tenancy instead, through the same
// `WorkspaceSource` every sales route resolves against. A person has exactly one
// sales workspace today, so "the default" is "theirs".
//
// ---------------------------------------------------------------------------
// IT MUST NOT THROW, AND THAT IS NOT CAUTION
// ---------------------------------------------------------------------------
// An upload is never REJECTED for being unattributable: `sales.uploads
// .workspace_id` is nullable for exactly this reason, and the file lands under
// the `unattributed` prefix instead. An unattributed ledger row is recoverable;
// a missing one hides bytes nobody can find again. Every lookup below is wrapped
// for that reason and not out of superstition.

import { sql } from 'drizzle-orm'
import type { UploadAttribution, UploadLedger, WorkspaceSource } from '@blackcode/platform-api'
import type { User } from '@blackcode/platform-db'
import { getDb } from '../client'
import { salesUploads } from '../schema'

/**
 * Build this app's ledger from its workspace source.
 *
 * The source is passed in rather than imported so that `lib/api.ts` wires ONE
 * object and both fields of the AppContext agree about where this app's
 * workspaces live — the alternative is two files that each decide, and drift.
 */
export function salesUploadLedger(workspaces: WorkspaceSource): UploadLedger {
  return {
    async attribute(user: User, explicit?: string | null): Promise<UploadAttribution> {
      if (explicit) {
        try {
          const ws = await workspaces.getForUser(explicit, user.id)
          if (ws) return { id: ws.id, slug: ws.slug }
        } catch {
          /* fall through to the caller's own workspace */
        }
      }
      try {
        const ws = await workspaces.getDefaultForUser(user.id)
        if (ws) return { id: ws.id, slug: ws.slug }
      } catch {
        /* fall through to unattributed */
      }
      // NOT `user.active_workspace_id`. See the header: that column belongs to
      // whichever app owns `platform.workspaces`, and reading it here is how a
      // sales file ends up in an issues workspace's folder.
      return { id: null, slug: null }
    },

    async record(row) {
      // Raw SQL rather than the query builder for one reason: `ON CONFLICT (url)
      // DO NOTHING` is what makes this idempotent, and it has to be, because the
      // blob completion callback arrives server-to-server from Vercel and can
      // retry. A second row for one file would double-count the quota and give
      // the reference scanner two answers.
      await getDb().execute(sql`
        INSERT INTO ${salesUploads} (url, pathname, filename, size, mime_type, workspace_id, uploaded_by)
        VALUES (
          ${row.url},
          ${row.pathname ?? null},
          ${row.filename},
          ${row.size ?? null},
          ${row.mime_type ?? null},
          ${row.workspace_id ?? null},
          ${row.uploaded_by ?? null}
        )
        ON CONFLICT (url) DO NOTHING
      `)
    },
  }
}
