// POST   /api/workspaces/{ws}/logo — `bk billing workspace logo <file>`
// DELETE /api/workspaces/{ws}/logo — `bk billing workspace logo --remove`
//
// The shared `workspaceLogoRoute` (2026-09-28); read its header for why a logo
// has its own narrow route and what keeps the file alive (the column's
// `trg_blob_refs_logo` trigger, migration 0015).
//
// NOT recorded in an upload ledger: this app has none (`noUploadLedger` in
// lib/api.ts), and this route is not a general upload surface.
import { workspaceLogoRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { setWorkspaceLogo } from '@/lib/db/queries/workspaces'

const handlers = workspaceLogoRoute(appContext, {
  setLogo: (workspaceId, url) => setWorkspaceLogo(workspaceId, url),
  recordUpload: false,
})

export const POST = handlers.POST
export const DELETE = handlers.DELETE
