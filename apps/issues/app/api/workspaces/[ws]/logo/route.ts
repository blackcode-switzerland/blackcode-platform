// POST   /api/workspaces/{ws}/logo — `bk issues workspace logo <file>`
// DELETE /api/workspaces/{ws}/logo — `bk issues workspace logo --remove`
//
// The shared `workspaceLogoRoute` (2026-09-28); read its header for why a logo
// has its own narrow route and what keeps the file alive (the column's
// `trg_blob_refs_logo` trigger, migration 0049).
//
// Recorded in this app's upload ledger, like any other file uploaded here.
import { workspaceLogoRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { updateWorkspace } from '@/lib/db/queries/workspaces'

const handlers = workspaceLogoRoute(appContext, {
  setLogo: async (workspaceId, url, userId) => {
    const row = await updateWorkspace(workspaceId, { logo_url: url }, userId)
    return row ? { id: row.id, name: row.name, slug: row.slug, logo_url: row.logo_url ?? null } : null
  },
  recordUpload: true,
})

export const POST = handlers.POST
export const DELETE = handlers.DELETE
