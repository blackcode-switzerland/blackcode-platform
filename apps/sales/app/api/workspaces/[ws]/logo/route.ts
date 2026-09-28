// POST   /api/workspaces/{ws}/logo — `bk sales workspace logo <file>`
// DELETE /api/workspaces/{ws}/logo — `bk sales workspace logo --remove`
//
// The shared `workspaceLogoRoute` (2026-09-28); read its header for why a logo
// has its own narrow route and what keeps the file alive (the column's
// `trg_blob_refs_logo` trigger, migration 0013).
//
// Recorded in `sales.uploads`, like any other file uploaded here.
import { workspaceLogoRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { setWorkspaceLogo } from '@/lib/db/queries/workspaces'

const handlers = workspaceLogoRoute(appContext, {
  setLogo: (workspaceId, url) => setWorkspaceLogo(workspaceId, url),
  recordUpload: true,
})

export const POST = handlers.POST
export const DELETE = handlers.DELETE
