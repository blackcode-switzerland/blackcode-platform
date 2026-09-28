// POST   /api/workspaces/{ws}/logo — `bk books workspace logo <file>`
// DELETE /api/workspaces/{ws}/logo — `bk books workspace logo --remove`
//
// The shared `workspaceLogoRoute` (2026-09-28); read its header for why a logo
// has its own narrow route and what keeps the file alive (the column's
// `trg_blob_refs_logo` trigger, migration 0021).
//
// NOT recorded in an upload ledger, and not a general upload surface: this app
// "records no uploads" (supporting documents are Drive references) and that
// stays true of everything but this one picture.
import { workspaceLogoRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { setWorkspaceLogo } from '@/lib/db/queries/workspaces'

const handlers = workspaceLogoRoute(appContext, {
  setLogo: (workspaceId, url) => setWorkspaceLogo(workspaceId, url),
  recordUpload: false,
})

export const POST = handlers.POST
export const DELETE = handlers.DELETE
