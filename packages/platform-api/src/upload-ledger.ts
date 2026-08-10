// WHERE AN APP RECORDS THE FILES IT HAS BEEN GIVEN.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (multiAppFinalRefactor Phase 3, 2026-08-10)
// ---------------------------------------------------------------------------
// The LEDGER splits; the STORE does not. There is still one Vercel Blob store,
// one bill, one quota, and one cross-app delete gate (`platform.blob_references`
// — untouched by this file and by this phase). What splits is the record of
// which of an app's files exist: `apps/issues` keeps `platform.uploads`,
// `apps/sales` gets `sales.uploads`.
//
// `/api/upload` and `/api/upload/blob` are shared factories, and they must be:
// the client-direct handshake carries `assertPathnameWritable`, the block list,
// the size cap and the token minting, and none of that is app-shaped. What IS
// app-shaped is the two database sentences at the end of it — "which workspace
// is this for?" and "write it down" — so those arrive here, as a port.
//
// ---------------------------------------------------------------------------
// WHY BOTH METHODS, AND WHY ATTRIBUTION IS NOT LEFT SHARED
// ---------------------------------------------------------------------------
// Attribution reads an app's TENANCY. Before Phase 2 that was one table, so
// `attributeUpload(db, …)` could name it. It is now two, and the fallback it
// used — `platform.users.active_workspace_id` — is one column shared by every
// deployment: an app that owns its workspaces must neither write it nor read
// its own ids back out of it (`workspace-source.ts` says why at length). Leaving
// attribution shared would mean a sales upload landing in the folder of, and
// attributed to, whichever workspace the caller last selected IN ISSUES.
//
// So the ledger owns both halves. `platformUploadLedger` below is literally the
// two functions `routes/upload.ts` already called, with the same arguments in
// the same order — `apps/issues` is unchanged by construction, not by review.
//
// ---------------------------------------------------------------------------
// REQUIRED ON `AppContext`, FOR `workspaces`' REASON
// ---------------------------------------------------------------------------
// An optional field defaulting to `platform.uploads` means an app that forgot it
// writes its ledger rows into another app's table, silently, and the
// cross-app delete gate then asks the wrong app whether a file is still in use.
// Required means an app that has not answered "where does my ledger live?" does
// not compile.

import { recordUpload, attributeUpload } from '@blackcode/platform-storage'
import type { PlatformDb, User } from '@blackcode/platform-db'

/** Which workspace an upload belongs to: the id for the ledger, the slug for the path. */
export interface UploadAttribution {
  id: number | null
  slug: string | null
}

/** What the upload routes need to write down about a stored file. */
export interface UploadRecord {
  url: string
  pathname?: string | null
  filename: string
  size?: number | null
  mime_type?: string | null
  workspace_id?: number | null
  uploaded_by?: number | null
}

export interface UploadLedger {
  /**
   * Resolve the target workspace — an explicit slug/id the caller passed
   * (checked against their membership), else the caller's default.
   *
   * **Never throws, and never rejects an upload.** An upload that cannot be
   * attributed lands under the `unattributed` prefix with a null
   * `workspace_id`, because an unattributed ledger row is recoverable and a
   * missing one hides bytes nobody can find again. An implementation that
   * throws here costs a file its bytes, not its folder.
   */
  attribute(user: User, explicit?: string | null): Promise<UploadAttribution>

  /**
   * Write the ledger row. Idempotent on `url` — the blob completion callback
   * arrives server-to-server and can retry.
   *
   * There is no `app` parameter, deliberately: the platform ledger stamps its
   * own column from the slug it was constructed with, and an app-owned ledger
   * has no such column because the schema name is the answer. Forgetting it is
   * therefore not representable at a call site.
   */
  record(row: UploadRecord): Promise<void>
}

/**
 * The `platform.uploads`-backed ledger — what `apps/issues` supplies.
 *
 * Both methods are the platform-storage function that route already called,
 * with the same arguments in the same order. If you find yourself adding logic
 * here, it belongs in platform-storage beside the table.
 */
export function platformUploadLedger(db: PlatformDb, appSlug: string): UploadLedger {
  return {
    attribute: (user, explicit) => attributeUpload(db, user, explicit),
    record: (row) => recordUpload(db, { ...row, app: appSlug }),
  }
}
