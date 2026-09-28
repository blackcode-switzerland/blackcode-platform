// POST   /api/me/avatar — upload an image and make it your profile photo.
// DELETE /api/me/avatar — remove it (you get your initials again).
// `bk profile avatar <file>` / `--remove`. Every app, since 2026-09-28.
//
// The narrow sibling of `workspaceLogoRoute` (read its header): one image, for
// one column (`platform.users.avatar_url`), so apps with no general upload
// route — billing, books — can offer a photo without growing one. apps/issues
// and apps/sales used `/api/upload` + `PATCH /api/me` for this, which still
// works.
//
// WHAT KEEPS THE FILE ALIVE: `trg_blob_refs_avatar` on `platform.users`
// (apps/issues migration 0050), attributed to 'platform'. Until that migration
// nothing indexed an uploaded avatar, so clean-up could delete one in use.
//
// A Google-connected account's photo is synced from Google on every sign-in and
// cannot be set here — the same rule `PATCH /api/me` applies.

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { blobPathname } from '@blackcode/platform-storage'
import { updateUserProfile } from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_LOGO_MIME_TYPES } from '../limits'
import { saveLocally } from './upload'

const EXTENSION: Record<(typeof WORKSPACE_LOGO_MIME_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const MB = WORKSPACE_LOGO_MAX_BYTES / (1024 * 1024)

export function meAvatarRoute(app: AppContext, opts: { recordUpload: boolean }) {
  const apiHandler = createApiHandler(app)

  async function me(req: NextRequest) {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()
    if (user.google_id) {
      throw Errors.forbidden(
        'Your photo is synced from Google and cannot be changed here',
        'change it in your Google account; it updates here on your next sign-in'
      )
    }
    return user
  }

  const answer = (u: { id: number; email: string; name: string | null; avatar_url: string | null }) =>
    NextResponse.json({ id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url })

  const POST = apiHandler(async (req: NextRequest) => {
    const user = await me(req)
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      throw Errors.badRequest('no_file', 'Include the image in the form data under the "file" field', 'bk profile avatar <path-to-image>')
    }
    if (!(WORKSPACE_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw Errors.badRequest(
        'avatar_type_not_allowed',
        `a photo must be a PNG, JPEG, WebP or GIF image (got ${file.type || 'an unknown type'})`,
        'convert it to PNG and try again'
      )
    }
    if (file.size > WORKSPACE_LOGO_MAX_BYTES) {
      throw Errors.badRequest('avatar_too_large', `a photo can be at most ${MB} MB`, 'use a smaller image')
    }

    const ext = EXTENSION[file.type as keyof typeof EXTENSION]
    // No workspace owns a person, so the path's workspace segment is `account`.
    const target = blobPathname(app.appSlug, 'account', `avatar-${user.id}-${Date.now()}.${ext}`)
    let url: string
    let pathname: string
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(target, file, { access: 'public', addRandomSuffix: true })
      url = blob.url
      pathname = blob.pathname
    } else if (process.env.NODE_ENV !== 'production') {
      url = (await saveLocally(file, target)).url
      pathname = url
    } else {
      throw Errors.internal('Blob storage is not configured (set BLOB_READ_WRITE_TOKEN)')
    }

    if (opts.recordUpload) {
      try {
        const workspace = await app.uploads.attribute(user, null)
        await app.uploads.record({
          url,
          pathname,
          filename: file.name,
          size: file.size,
          mime_type: file.type,
          workspace_id: workspace.id,
          uploaded_by: user.id,
        })
      } catch (err) {
        // Non-fatal: the ledger is for the storage page and the quota. What keeps
        // the file alive is the trigger on `platform.users.avatar_url`.
        console.error('[me-avatar] ledger record failed (non-fatal):', err)
      }
    }

    const updated = await updateUserProfile(app.db, user.id, { avatar_url: url })
    if (!updated) throw Errors.notFound('user')
    return answer(updated)
  })

  const DELETE = apiHandler(async (req: NextRequest) => {
    const user = await me(req)
    const updated = await updateUserProfile(app.db, user.id, { avatar_url: null })
    if (!updated) throw Errors.notFound('user')
    return answer(updated)
  })

  return { POST, DELETE }
}
