// POST   /api/workspaces/{ws}/logo — upload an image and make it the logo.
// DELETE /api/workspaces/{ws}/logo — remove the logo (the workspace keeps its
//        coloured initial).
// `bk <app> workspace logo <file>` / `--remove`. Every app, since 2026-09-28.
//
// ---------------------------------------------------------------------------
// WHY A LOGO ROUTE AND NOT `/api/upload` + `PATCH { logo_url }`
// ---------------------------------------------------------------------------
// That pair is how apps/issues did it, and it needs a general upload route.
// apps/billing and apps/books have none, deliberately — books' supporting
// documents are Drive references and "records no uploads" is a recorded rule.
// Giving every app a general upload surface to get a 40-pixel picture would be
// the wrong trade. This is the NARROW version: one image, for one column,
// owner-only, and the only thing it can write is that column.
//
// ---------------------------------------------------------------------------
// WHAT KEEPS THE FILE ALIVE — READ BEFORE CHANGING THE COLUMN'S NAME
// ---------------------------------------------------------------------------
// This route stores bytes and writes a URL; it does not, and must not, touch
// `platform.blob_references`. The column is protected by a TRIGGER each app
// installs in the same migration that created it (`blob_refs_sync(<app>,
// 'workspace_logo', 'id', 'exact', 'logo_url')`), which is what tells every
// deployment's GC the file is in use. A logo whose column had no trigger would
// read as an orphan and be DELETED — `del()` has no undo. When a logo is
// replaced or removed the trigger drops the old reference, and the GC may then
// collect the old file, which is the intended outcome.
//
// The ledger (`AppContext.uploads`) is written only when the app asks: an app
// that records no uploads (billing, books) passes `recordUpload: false`, and its
// `noUploadLedger` is never called.

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { blobPathname } from '@blackcode/platform-storage'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace, requireOwner } from '../handler'
import { WORKSPACE_LOGO_MAX_BYTES, WORKSPACE_LOGO_MIME_TYPES } from '../limits'
import { saveLocally } from './upload'

export interface WorkspaceWithLogo {
  id: number
  name: string
  slug: string
  logo_url: string | null
}

export interface WorkspaceLogoOptions {
  /** Write the app's own `workspaces.logo_url` and answer with the row. `userId` is the owner acting, for an app that records who changed what. */
  setLogo: (workspaceId: number, url: string | null, userId: number) => Promise<WorkspaceWithLogo | null>
  /** Record the file in the app's upload ledger. False for an app with none. */
  recordUpload: boolean
}

const EXTENSION: Record<(typeof WORKSPACE_LOGO_MIME_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const MB = WORKSPACE_LOGO_MAX_BYTES / (1024 * 1024)

export function workspaceLogoRoute(app: AppContext, opts: WorkspaceLogoOptions) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)
  type Params = { params: Promise<{ ws: string }> }

  const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      throw Errors.badRequest(
        'no_file',
        'Include the image in the form data under the "file" field',
        `bk ${app.appSlug} workspace logo <path-to-image>`
      )
    }
    if (!(WORKSPACE_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw Errors.badRequest(
        'logo_type_not_allowed',
        `a logo must be a PNG, JPEG, WebP or GIF image (got ${file.type || 'an unknown type'})`,
        'convert it to PNG and try again'
      )
    }
    if (file.size > WORKSPACE_LOGO_MAX_BYTES) {
      throw Errors.badRequest('logo_too_large', `a logo can be at most ${MB} MB`, 'use a smaller image; it is drawn at 40px')
    }

    const ext = EXTENSION[file.type as keyof typeof EXTENSION]
    const target = blobPathname(app.appSlug, ctx.workspace.slug, `logo-${Date.now()}.${ext}`)

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
        await app.uploads.record({
          url,
          pathname,
          filename: file.name,
          size: file.size,
          mime_type: file.type,
          workspace_id: ctx.workspace.id,
          uploaded_by: ctx.user.id,
        })
      } catch (err) {
        // Non-fatal, as in `/api/upload`: the ledger is for the storage page and
        // the quota. What keeps the file alive is the trigger on the column.
        console.error('[workspace-logo] ledger record failed (non-fatal):', err)
      }
    }

    const updated = await opts.setLogo(ctx.workspace.id, url, ctx.user.id)
    if (!updated) throw Errors.notFound('workspace')
    return NextResponse.json(updated)
  })

  const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)
    const updated = await opts.setLogo(ctx.workspace.id, null, ctx.user.id)
    if (!updated) throw Errors.notFound('workspace')
    return NextResponse.json(updated)
  })

  return { POST, DELETE }
}
