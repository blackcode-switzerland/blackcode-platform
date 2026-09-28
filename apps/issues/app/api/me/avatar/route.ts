// POST   /api/me/avatar — `bk profile avatar <file>`
// DELETE /api/me/avatar — `bk profile avatar --remove`
//
// The shared `meAvatarRoute` (2026-09-28); read its header for why a photo has
// its own narrow route and what keeps the file alive (`trg_blob_refs_avatar`
// on platform.users, apps/issues migration 0050).
import { meAvatarRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = meAvatarRoute(appContext, { recordUpload: true })

export const POST = handlers.POST
export const DELETE = handlers.DELETE
