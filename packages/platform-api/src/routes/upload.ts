// /api/upload and /api/upload/blob — the two ways bytes reach the shared store.
//
// ---------------------------------------------------------------------------
// WHY THIS ROUTE IS TIER 1, AND WHY IT IS THE ONE THAT ACTUALLY MATTERS
// ---------------------------------------------------------------------------
// `platform.uploads.app` is set by the app that SERVED the request, and a new
// upload lands under `<app>/<workspace>/<file>`. So a sales document uploaded
// through the issues host is recorded, permanently, as an issues file, in the
// issues path prefix — and that attribution is what the cross-app delete gate
// reads. Nothing about the file says otherwise afterwards.
//
// That is why /api/upload could not be left behind for sales to 404 on, and why
// both halves of the identity — the `app` column and the path prefix — come from
// `AppContext.appSlug` here rather than from a constant.
//
// ---------------------------------------------------------------------------
// WHAT THIS FACTORY DOES NOT TOUCH
// ---------------------------------------------------------------------------
// This is the WRITE path. It does not import the reference scanner registry, the
// GC, or anything that can reach `del()`. Deciding whether a file may be deleted
// is a live reference scan across every app (`platform-storage/references.ts`)
// and is deliberately somewhere else.
//
// And it does not move a single existing byte. Files uploaded before the prefix
// existed sit unprefixed at the store root; `platform.uploads.pathname` records
// where each one actually is. **`pathname` is where a file IS, `app` is who owns
// it** — never compute one from the other.

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  assertPathnameWritable,
  blobPathname,
  listAppSlugs,
  BLOCKED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
} from '@blackcode/platform-storage'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'

const LOCAL_UPLOAD_DIR = 'public/uploads'

// Store under public/uploads, mirroring the Blob layout (`<app>/<ws>/<file>`) so
// local dev exercises the same paths production uses.
async function saveLocally(file: File, relativePath: string): Promise<{ url: string }> {
  const uploadsDir = resolve(process.cwd(), LOCAL_UPLOAD_DIR)

  // Insert the random suffix BEFORE the extension so the URL keeps a real file
  // extension (…-ab12cd34.pdf, not …pdf-ab12cd34) — the rich-text layer detects
  // media type from that extension. Mirrors Vercel Blob's addRandomSuffix.
  const suffix = randomBytes(4).toString('hex')
  const dot = relativePath.lastIndexOf('.')
  const finalName =
    dot >= 0
      ? `${relativePath.slice(0, dot)}-${suffix}${relativePath.slice(dot)}`
      : `${relativePath}-${suffix}`
  const destPath = resolve(uploadsDir, finalName)
  // Defense-in-depth against path traversal even though every segment is
  // sanitized upstream (blobPathname + the filename sanitizer below).
  if (!destPath.startsWith(uploadsDir + sep)) {
    throw new Error('Resolved upload path escapes uploads directory')
  }

  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, Buffer.from(await file.arrayBuffer()))
  return { url: `/uploads/${finalName}` }
}

/**
 * `POST /api/upload` — multipart, through the function.
 * `GET  /api/upload` — what a client needs to know before uploading.
 */
export function uploadRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  const POST = apiHandler(async (request: NextRequest) => {
    const user = await app.resolveUser(request)
    if (!user) throw Errors.unauthorized()

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file)
      throw Errors.badRequest('no_file', 'Include a file in the form data under the "file" field')
    if (file.size > MAX_UPLOAD_BYTES)
      throw Errors.badRequest('file_too_large', `Maximum file size is ${MAX_UPLOAD_LABEL}`)
    // Block SVG due to XSS risk; allow everything else. The list is exported so
    // GET /api/meta can serve it live (media.blocked_mime_types) — the CLI guide
    // must never hardcode "any file type", which is what drifted before.
    if ((BLOCKED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw Errors.badRequest(
        'file_type_not_allowed',
        `${file.type} files are not allowed for security reasons`
      )
    }

    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filename = `${timestamp}-${sanitizedName}`

    // Attribution happens BEFORE the bytes are stored, because the workspace
    // slug is part of the path (Phase 7). It still never throws: an upload that
    // cannot be attributed lands under the `unattributed` prefix rather than
    // failing.
    const workspaceField = formData.get('workspace')
    const workspace = await app.uploads.attribute(
      user,
      typeof workspaceField === 'string' ? workspaceField : null
    )
    const targetPath = blobPathname(app.appSlug, workspace.slug, filename)

    const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)

    let url: string
    let pathname: string
    if (hasBlobToken) {
      const blob = await put(targetPath, file, { access: 'public', addRandomSuffix: true })
      url = blob.url
      pathname = blob.pathname
    } else if (process.env.NODE_ENV !== 'production') {
      // Local-dev fallback: store under public/uploads and serve via Next.js static.
      const local = await saveLocally(file, targetPath)
      url = local.url
      pathname = local.url
    } else {
      throw Errors.internal('Blob storage is not configured (set BLOB_READ_WRITE_TOKEN)')
    }

    // Record the upload in the ledger (best-effort: a ledger failure must never
    // fail the upload itself). `app` is stamped here rather than at a call site
    // so forgetting it is not representable.
    try {
      await app.uploads.record({
        url,
        pathname,
        filename: file.name,
        size: file.size,
        mime_type: file.type || null,
        workspace_id: workspace.id,
        uploaded_by: user.id,
      })
    } catch (err) {
      console.error('[upload] ledger record failed (non-fatal):', err)
    }

    return NextResponse.json({
      url,
      filename: file.name,
      size: file.size,
      contentType: file.type,
    })
  })

  const GET = apiHandler(async (request: NextRequest) => {
    const user = await app.resolveUser(request)
    if (!user) throw Errors.unauthorized()

    return NextResponse.json({
      message: 'Upload API endpoint',
      usage: 'POST with multipart/form-data containing a "file" field',
      maxSize: MAX_UPLOAD_LABEL,
      // The numeric cap. The old platform reference claimed this route returned a
      // `maxBytes` field — it never did, so nothing could act on the limit
      // programmatically. It does now, and GET /api/meta serves the same value
      // under `limits.upload_max_bytes`.
      maxBytes: MAX_UPLOAD_BYTES,
      // When true, large files should be uploaded client-direct via /api/upload/blob
      // (bypasses the serverless body limit). When false (local dev), use this route.
      blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      // Where this caller's files belong in the shared store (Phase 7):
      // `<app>/<workspace>/<file>`. The client-direct Blob flow chooses the
      // pathname itself — the Blob SDK gives the server no way to rewrite it — so
      // the client needs both halves to build the same path the server would.
      // POST /api/upload/blob rejects anything outside `app`'s prefix.
      app: app.appSlug,
      // `?workspace=` is resolved exactly as the upload itself resolves it, so the
      // folder a file lands in and the workspace the ledger attributes it to are
      // decided by the same input. The CLI passes its --ws target here; the web
      // client passes nothing and gets the active workspace.
      workspace: (
        await app.uploads.attribute(user, request.nextUrl.searchParams.get('workspace'))
      ).slug,
      blockedMimeTypes: BLOCKED_UPLOAD_MIME_TYPES,
      note: `All content types accepted except ${BLOCKED_UPLOAD_MIME_TYPES.join(', ')} (blocked for XSS safety)`,
    })
  })

  return { GET, POST }
}

/**
 * `POST /api/upload/blob` — the client-direct upload handshake for Vercel Blob.
 *
 * Large files (up to MAX_UPLOAD_BYTES) can't go through a serverless function —
 * Vercel caps the request body at ~4.5MB. Instead the browser uploads straight
 * to Blob storage and only the *token request* hits this route. This is the
 * official `@vercel/blob/client` flow. Used in production (where a Blob store is
 * configured); local dev falls back to the multipart route above.
 *
 * NOT wrapped in `apiHandler`, deliberately. `handleUpload` owns this response
 * shape: Vercel Blob's client library and the server-to-server completion
 * callback both expect its body, and a failure here must be the plain
 * `{ error }` + 400 the SDK understands rather than the platform envelope. That
 * also means this route does not write to `platform.error_events` — the trade
 * was made when the route was written and is unchanged by sharing it.
 */
export function uploadBlobRoute(app: AppContext) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const body = (await request.json()) as HandleUploadBody

    try {
      const result = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          // Only authenticated members may mint an upload token.
          const user = await app.resolveUser(request)
          if (!user) throw new Error('Authentication required')

          // The CLIENT chooses the pathname in this flow and the Blob SDK gives us
          // no way to rewrite it — the token is minted for the path it asked for.
          // So this is the one place a caller can be stopped from writing into
          // ANOTHER app's prefix. It deliberately accepts an unprefixed path: the
          // `bk` CLI uses this same flow and every installed binary sends a bare
          // filename. Demanding the prefix here broke every one of them in
          // production on 2026-08-05 — see assertPathnameWritable's header.
          // (Prefixes are for attribution, not authorisation: the store has one
          // token per deployment. What this prevents is a confused client, not a
          // determined attacker with our token.)
          assertPathnameWritable(app.appSlug, pathname, await listAppSlugs(app.db))

          // The client forwards file metadata in clientPayload (contentType,
          // filename, size) and may name a target workspace (slug/id).
          let payload: {
            contentType?: string
            filename?: string
            size?: number
            workspace?: string
          } = {}
          try {
            payload = clientPayload ? JSON.parse(clientPayload) : {}
          } catch {
            payload = {}
          }

          // Block SVG (XSS) — content type is forwarded by the client.
          if (
            payload.contentType &&
            (BLOCKED_UPLOAD_MIME_TYPES as readonly string[]).includes(payload.contentType)
          ) {
            throw new Error(`${payload.contentType} files are not allowed for security reasons`)
          }

          const workspace = await app.uploads.attribute(user, payload.workspace ?? null)

          return {
            addRandomSuffix: true,
            // Blob enforces this server-side during the direct upload.
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            // Forwarded verbatim to onUploadCompleted to write the ledger row.
            tokenPayload: JSON.stringify({
              workspace_id: workspace.id,
              uploaded_by: user.id,
              filename: payload.filename ?? null,
              size: payload.size ?? null,
              contentType: payload.contentType ?? null,
            }),
          }
        },
        // Fires server-to-server after the upload completes (production only — not
        // on localhost, which uses the multipart route). Record the ledger row;
        // never throw, a ledger failure must not fail the upload.
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          try {
            const meta = tokenPayload ? JSON.parse(tokenPayload) : {}
            // The SERVING app's own ledger, exactly as in the multipart path.
            // This callback arrives from Vercel rather than from the browser, so
            // there is no caller-supplied value to be tempted by — and the ledger
            // stamps its own `app`, so there is none to pass either.
            await app.uploads.record({
              url: blob.url,
              pathname: blob.pathname,
              filename: meta.filename || blob.pathname,
              size: meta.size ?? null,
              mime_type: meta.contentType ?? blob.contentType ?? null,
              workspace_id: meta.workspace_id ?? null,
              uploaded_by: meta.uploaded_by ?? null,
            })
          } catch (err) {
            console.error('[upload/blob] ledger record failed (non-fatal):', err)
          }
        },
      })

      return NextResponse.json(result)
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 })
    }
  }
}
