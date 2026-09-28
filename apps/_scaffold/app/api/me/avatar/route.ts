// POST   /api/me/avatar — `bk profile avatar <file>`
// DELETE /api/me/avatar — `bk profile avatar --remove`
//
// ── KEEP THIS ROUTE WHEN YOU COPY THIS APP ─────────────────────────────────
// Every app serves it (2026-09-28): `bk profile` is a bare verb and answers
// from whichever app you logged in to, so an app without it makes
// `bk profile avatar` a 404 for its users. The shared `meAvatarRoute` owns the
// rules; what keeps the file alive is `trg_blob_refs_avatar` on
// `platform.users` (apps/issues migration 0050) — nothing to add here.
//
// `recordUpload: false`: a profile photo belongs to no workspace, so it has no
// place in a per-workspace upload ledger. Set it to true only if your app wants
// the photo counted against a workspace's storage.

import { meAvatarRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = meAvatarRoute(appContext, { recordUpload: false })

export const POST = handlers.POST
export const DELETE = handlers.DELETE
