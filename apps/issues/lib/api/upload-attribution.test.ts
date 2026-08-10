// A file is attributed to the app that SERVED the upload — both halves of it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS THE ONE THAT MATTERS
// ---------------------------------------------------------------------------
// An upload writes its owner in two places at once, and both are permanent:
//
//   1. `platform.uploads.app` — the column the cross-app delete gate reads to
//      decide whose reference scanner must answer for a file.
//   2. the blob pathname prefix, `<app>/<workspace>/<file>` — where the bytes
//      physically are. Nothing moves them afterwards; `pathname` is a historical
//      fact, not a derivation.
//
// So a sales document uploaded through the issues host is an issues file
// forever, in the issues folder, and nothing about it says otherwise. That is
// the whole reason /api/upload is Tier 1 rather than "sales can use the issues
// one for now".
//
// ---------------------------------------------------------------------------
// THE PREMISE, WHICH IS THE POINT OF THE FILE
// ---------------------------------------------------------------------------
// "The route wrote `issues`" is satisfied just as well by a hardcoded `issues`
// as by `ctx.appSlug` — which is exactly what the code said before it was
// shared. So every assertion is made TWICE, against two contexts differing only
// in `appSlug`, and the two answers must differ. **An attribution test that
// passes for both apps is not a test.**

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { AppContext } from '@blackcode/platform-api'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
  // Take the production branch of the route. Without it the handler falls back
  // to writing into public/uploads, and this test would be asserting against a
  // path the deployed app never takes.
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
})

/** Every pathname `put()` was asked to write, in order. */
const putPaths = vi.hoisted(() => [] as string[])
vi.mock('@vercel/blob', () => ({
  put: async (pathname: string) => {
    putPaths.push(pathname)
    return { url: `https://blob.test/${pathname}`, pathname }
  },
}))

/**
 * Capture the ledger row instead of writing it.
 *
 * Only `recordUpload` is stubbed — `blobPathname`, `attributeUpload` and the
 * limits stay real, because they are half of what is under test. Stubbing the
 * whole module would leave this asserting against its own mock.
 */
const ledger = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@blackcode/platform-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@blackcode/platform-storage')>()),
  recordUpload: async (_db: unknown, data: Record<string, unknown>) => {
    ledger.push(data)
  },
}))

import { uploadRoute } from '@blackcode/platform-api/routes'
import { platformUploadLedger } from '@blackcode/platform-api'
import { APP_SLUG } from '@/lib/app'

const USER = {
  id: 7,
  email: 'uploader@example.test',
  name: 'Uploader',
  active_workspace_id: 3,
}

/** The workspace lookup `attributeUpload` makes, and nothing else. */
const WORKSPACE = { id: 3, slug: 'kali-sa', name: 'Kali SA' }

function contextFor(appSlug: string): AppContext {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'limit', 'innerJoin', 'leftJoin']) chain[m] = () => chain
  chain.then = (ok: (v: unknown[]) => unknown) => Promise.resolve([WORKSPACE]).then(ok)

  const db = { select: () => chain }

  return {
    appSlug,
    db,
    // The app's own LEDGER (Phase 3): `/api/upload` no longer stamps the column
    // itself, it asks this. Built here from the SAME `appSlug` the route is
    // mounted with, because that is precisely what is under test — if the two
    // could differ, the file's path and the file's owner could disagree.
    //
    // `platformUploadLedger`, not a stub: `attributeUpload` and `recordUpload`
    // are half of what this file checks (`recordUpload` is intercepted at the
    // module boundary above, so the row is captured rather than written).
    uploads: platformUploadLedger(db as never, appSlug),
    async resolveUser() {
      return USER
    },
  } as unknown as AppContext
}

async function uploadThrough(appSlug: string): Promise<void> {
  const form = new FormData()
  form.append('file', new File(['hello'], 'quarterly report.pdf', { type: 'application/pdf' }))

  const { POST } = uploadRoute(contextFor(appSlug))
  const res = await POST(
    new NextRequest(`https://${appSlug}.blackcode.test/api/upload`, {
      method: 'POST',
      body: form,
    }),
    undefined as never
  )
  expect(res.status, `the upload itself failed for ${appSlug}`).toBe(200)
}

describe('an upload is attributed to the app that served it', () => {
  beforeEach(() => {
    putPaths.length = 0
    ledger.length = 0
  })

  it('stamps platform.uploads.app and the path prefix with the SERVING app', async () => {
    await uploadThrough('sales')

    expect(ledger[0].app, 'the ledger row must name the serving app').toBe('sales')
    expect(
      putPaths[0],
      'the bytes must land under the serving app\'s prefix — `pathname` is where a ' +
        'file IS, and nothing moves it later'
    ).toMatch(/^sales\/kali-sa\//)
    // The two must agree with each other, not merely each be right in isolation:
    // the delete gate reads the column, a human reads the path.
    expect(String(ledger[0].pathname)).toMatch(/^sales\/kali-sa\//)
  })

  it('THE PREMISE: a different app produces a different attribution', async () => {
    await uploadThrough('sales')
    await uploadThrough('issues')

    expect(
      ledger[0].app,
      'both apps recorded the same `platform.uploads.app`, so this file cannot ' +
        'tell ctx.appSlug from a hardcoded constant — which is what the route ' +
        'contained before it was shared. Every assertion above is vacuous.'
    ).not.toBe(ledger[1].app)
    expect(
      putPaths[0].split('/')[0],
      'both apps wrote into the same prefix — see above'
    ).not.toBe(putPaths[1].split('/')[0])

    expect(ledger[1].app).toBe('issues')
    expect(putPaths[1]).toMatch(/^issues\/kali-sa\//)
  })

  it('THE WIRING: this app mounts the factory with its own slug', async () => {
    // The two cases above compare two synthetic contexts. Neither would notice
    // apps/issues mounting the route with someone else's slug.
    const { appContext } = await import('@/lib/api')
    expect(appContext.appSlug).toBe(APP_SLUG)
  })
})
