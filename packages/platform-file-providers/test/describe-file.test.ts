// `describeFile` — where a file lives and how to show it.
//
// ===========================================================================
// THE CASES THAT MUST **NOT** MATCH ARE THE POINT OF THIS FILE
// ===========================================================================
// A recogniser is easy to test in the direction that flatters it. Feed it the
// urls it was written for, watch them pass, ship. The failures that actually
// hurt are the other direction, and both are in here:
//
//   claims too much   a Gmail or Calendar link recognised as "a Drive file"
//                     renders Google's sign-in page inside a customer record.
//   claims our own    a url attributed to `blob` that the DATABASE does not
//                     consider an uploaded asset is a file the UI shows as
//                     protected while `platform.blob_references` protects
//                     nothing. That direction ends in lost bytes.
//
// The second is why `isOwnBlobHost` is tested against the exact branches of
// `platform.is_uploaded_asset`, and why a lookalike host is an explicit case.
//
// Watched fail 2026-08-17, and one prediction here was WRONG — recorded because
// the wrong version is the more useful lesson:
//
//   - widening the host test to `host.endsWith('google.com')` was expected to
//     turn the "other Google properties" case red. **It did not.** That branch
//     still requires a `/file/d/<id>/` shape, so Gmail and Calendar fall through
//     to null exactly as before; the only casualty is Docs/Sheets/Slides, which
//     the widened branch swallows before the `docs.google.com` branch runs. The
//     claim was bigger than the check.
//   - the mutation that DOES reach it is a loose one — scan any path segment for
//     something id-shaped, on any google host — and then
//     `calendar.google.com/…/eventedit/abcdef123456` is claimed as a Drive file,
//     along with the published-doc token. Four cases go red. That is the real
//     shape of this bug and it is what these assertions are for.
//   - note Gmail is a weaker case than Calendar either way: its message id lives
//     in the URL FRAGMENT, which is not in `pathname`, so no path-based matcher
//     can claim it. It stays in the list as a regression guard for a future
//     matcher that reads the fragment, not as evidence today.
//   - `endsWith(BLOB_HOST)` instead of `endsWith('.' + BLOB_HOST)` → the
//     `evilblob.vercel-storage.com` case goes red and nothing else does.
//   - dropping the try/catch in `describeFile` → "survives a provider that
//     throws" goes red by THROWING rather than by asserting, which is exactly
//     the shape a listing would take in a browser.

import { describe, expect, it } from 'vitest'
import { describeFile, providerManifest, registerProvider, PROVIDERS } from '../src/index'

const DRIVE_ID = '1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV'

describe('describeFile — our own storage', () => {
  it('recognises a Vercel Blob url as internal', () => {
    const d = describeFile(`https://abc123.public.blob.vercel-storage.com/sales/ws/deck.pdf`)
    expect(d.provider).toBe('blob')
    expect(d.internal).toBe(true)
    expect(d.media_kind).toBe('pdf')
    expect(d.embed.mode).toBe('iframe')
  })

  it('recognises the bare blob host too — both branches of is_uploaded_asset', () => {
    expect(describeFile('https://blob.vercel-storage.com/x/y.png').internal).toBe(true)
  })

  it('recognises a same-origin /uploads/ path, and keeps it RELATIVE', () => {
    const d = describeFile('/uploads/ws/photo.png')
    expect(d.provider).toBe('blob')
    expect(d.internal).toBe(true)
    expect(d.media_kind).toBe('image')
    // The placeholder base used to parse it must never escape — an `<img src>`
    // pointed at placeholder.invalid breaks every locally stored file.
    expect(d.open_url).toBe('/uploads/ws/photo.png')
    expect(d.embed.url).toBe('/uploads/ws/photo.png')
    expect(d.thumbnail_url).toBe('/uploads/ws/photo.png')
    expect(JSON.stringify(d)).not.toContain('placeholder.invalid')
  })

  it('does NOT claim a lookalike host', () => {
    // `endsWith('blob.vercel-storage.com')` would match this. The suffix has to
    // include the dot, exactly as the SQL does.
    const d = describeFile('https://evilblob.vercel-storage.com/x/y.png')
    expect(d.internal, 'a lookalike host was treated as our own storage').toBe(false)
    expect(d.provider).toBe('external')
  })

  it('renders an image as an image and a docx as nothing', () => {
    expect(describeFile('https://blob.vercel-storage.com/a/x.png').embed.mode).toBe('image')
    expect(describeFile('https://blob.vercel-storage.com/a/x.mp4').embed.mode).toBe('video')
    // An iframe pointed at a .docx downloads it in some browsers and shows
    // binary in others. Neither is a preview.
    expect(describeFile('https://blob.vercel-storage.com/a/x.docx').embed.mode).toBe('none')
  })

  it('uses the URL PATH when no filename hint is given — the live bug', () => {
    // A caller that passed a human TITLE as `filename` made it beat the url's
    // own path: a document called "Probe test image (ours)" typed as `other`,
    // so an image we host rendered as a download card. Found by uploading a
    // real png and looking at `doc show`, not by any test.
    //
    // The package was right; the CALLER was wrong. This pins the behaviour the
    // caller now relies on: with no hint, the path decides.
    const d = describeFile('/uploads/sales/ws/1786992476950-probe-test-3eb454dc.png')
    expect(d.media_kind).toBe('image')
    expect(d.embed.mode).toBe('image')
  })

  it('a filename hint OVERRIDES the path — which is why it must be a filename', () => {
    // The hint exists for a signed or opaque url whose path says nothing. It is
    // powerful for that reason, and that is exactly why passing a title through
    // it was harmful.
    const d = describeFile('https://blob.vercel-storage.com/a/opaque-token', {
      filename: 'quarterly.pdf',
    })
    expect(d.media_kind).toBe('pdf')
  })

  it('prefers a reported mime over the extension', () => {
    // `report.pdf.txt` is a text file and only the mime knows.
    const d = describeFile('https://blob.vercel-storage.com/a/report.pdf.txt', {
      mime: 'text/plain',
    })
    expect(d.media_kind).toBe('doc')
  })
})

describe('describeFile — Google Drive', () => {
  it('recognises a stored file and offers Drive’s own player', () => {
    const d = describeFile(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`)
    expect(d.provider).toBe('google_drive')
    expect(d.internal, 'a Drive file must never be internal').toBe(false)
    expect(d.external_id).toBe(DRIVE_ID)
    // An `<video src>` pointed at Drive does not play; Drive's own viewer does.
    expect(d.embed).toEqual({
      mode: 'iframe',
      url: `https://drive.google.com/file/d/${DRIVE_ID}/preview`,
    })
    expect(d.thumbnail_url).toContain(DRIVE_ID)
  })

  it('recognises the older /open?id= and /uc?id= shapes', () => {
    for (const u of [
      `https://drive.google.com/open?id=${DRIVE_ID}`,
      `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
    ]) {
      expect(describeFile(u).external_id, u).toBe(DRIVE_ID)
    }
  })

  it('recognises Docs, Sheets and Slides with the right embed each', () => {
    const doc = describeFile(`https://docs.google.com/document/d/${DRIVE_ID}/edit`)
    expect(doc.media_kind).toBe('doc')
    expect(doc.embed.url).toBe(`https://docs.google.com/document/d/${DRIVE_ID}/preview`)

    const sheet = describeFile(`https://docs.google.com/spreadsheets/d/${DRIVE_ID}/edit#gid=0`)
    expect(sheet.media_kind).toBe('sheet')

    // Slides is /embed, not /preview — a different endpoint, easy to get wrong.
    const slides = describeFile(`https://docs.google.com/presentation/d/${DRIVE_ID}/edit`)
    expect(slides.media_kind).toBe('slides')
    expect(slides.embed.url).toBe(`https://docs.google.com/presentation/d/${DRIVE_ID}/embed`)
  })

  it('emits a thumbnail for every previewable Drive shape', () => {
    // It was briefly NULLED, on the strength of a browser test run against
    // `http://localhost`. Measured again on both origins, same file, same url:
    //
    //     http://localhost:3100       BLOCKED (ERR_BLOCKED_BY_ORB)
    //     https://sales.blackcode.ch  RENDERS
    //
    // Opaque Response Blocking refuses it from an INSECURE origin only. So the
    // url is correct and the localhost failure is a dev artifact — the renderer
    // carries an `onError` fallback for it. See `google-drive.ts`.
    for (const u of [
      `https://drive.google.com/file/d/${DRIVE_ID}/view`,
      `https://docs.google.com/document/d/${DRIVE_ID}/edit`,
      `https://docs.google.com/presentation/d/${DRIVE_ID}/edit`,
    ]) {
      expect(describeFile(u).thumbnail_url, u).toContain(DRIVE_ID)
    }
    // A folder has no thumbnail — nothing to picture.
    expect(describeFile(`https://drive.google.com/drive/folders/${DRIVE_ID}`).thumbnail_url).toBeNull()
  })

  it('recognises a folder and refuses to embed it', () => {
    const d = describeFile(`https://drive.google.com/drive/folders/${DRIVE_ID}`)
    expect(d.media_kind).toBe('folder')
    expect(d.embed).toEqual({ mode: 'none', url: null })
    expect(d.thumbnail_url).toBeNull()
  })

  it('does NOT claim other Google properties', () => {
    // Widening the matcher to "any google.com host" is the tempting shortcut and
    // this is what it costs: each of these would render a Google login inside a
    // customer record.
    for (const u of [
      'https://mail.google.com/mail/u/0/#inbox/abc123def456',
      'https://calendar.google.com/calendar/u/0/r/eventedit/abcdef123456',
      'https://www.google.com/search?q=drive.google.com',
      'https://google.com/',
    ]) {
      const d = describeFile(u)
      expect(d.provider, `${u} was claimed by the Drive provider`).not.toBe('google_drive')
    }
  })

  it('does NOT treat a PUBLISHED doc token as a file id', () => {
    // /d/e/<token>/pubhtml — the token is not a Drive file id, and storing it as
    // `external_id` would produce a thumbnail url that 404s for ever.
    const d = describeFile('https://docs.google.com/document/d/e/2PACX-1vABCDEFGHIJKLMN/pubhtml')
    expect(d.external_id).not.toBe('e')
    expect(d.provider).not.toBe('google_drive')
  })

  it('does NOT match a too-short id', () => {
    expect(describeFile('https://drive.google.com/file/d/x/view').provider).not.toBe('google_drive')
  })
})

describe('describeFile — the fallback', () => {
  it('describes an unknown host as an openable external link, never embedded', () => {
    const d = describeFile('https://example.com/a/report.pdf')
    expect(d.provider).toBe('external')
    expect(d.internal).toBe(false)
    expect(d.media_kind).toBe('pdf')
    // Framing an arbitrary third-party page is how a record ends up showing
    // somebody's login form — and most hosts refuse to be framed anyway.
    expect(d.embed.mode).toBe('none')
    expect(d.open_url).toBe('https://example.com/a/report.pdf')
  })

  it('does not throw on a malformed url — a listing must still render', () => {
    for (const bad of ['', '   ', 'not a url', 'http://', '://x']) {
      const d = describeFile(bad)
      expect(d.provider).toBe('external')
      expect(d.embed.mode).toBe('none')
    }
  })

  it('survives a provider that throws', () => {
    const boom = {
      id: 'boom',
      label: 'Boom',
      internal: false,
      match() {
        throw new Error('provider bug')
      },
    }
    registerProvider(boom)
    try {
      // A bug in one provider must not blank a whole listing.
      expect(describeFile('https://example.com/x.png').provider).toBe('external')
      expect(describeFile('https://blob.vercel-storage.com/a/x.png').provider).toBe('blob')
    } finally {
      const at = PROVIDERS.findIndex((p) => p.id === 'boom')
      if (at >= 0) PROVIDERS.splice(at, 1)
    }
  })
})

describe('extensibility', () => {
  it('registerProvider is idempotent by id', () => {
    const before = PROVIDERS.length
    const p = { id: 'dropbox', label: 'Dropbox', internal: false, match: () => null }
    registerProvider(p)
    registerProvider({ ...p })
    try {
      expect(PROVIDERS.length, 'registering twice grew the list').toBe(before + 1)
    } finally {
      const at = PROVIDERS.findIndex((x) => x.id === 'dropbox')
      if (at >= 0) PROVIDERS.splice(at, 1)
    }
  })

  it('a registered provider cannot intercept our own storage', () => {
    // Appended, never prepended. A plugin that claimed everything must still not
    // take a file the delete gate is responsible for.
    const greedy = {
      id: 'greedy',
      label: 'Greedy',
      internal: false,
      match: (u: URL) => ({
        external_id: 'x',
        media_kind: 'other' as const,
        embed: { mode: 'none' as const, url: null },
        thumbnail_url: null,
        open_url: u.toString(),
      }),
    }
    registerProvider(greedy)
    try {
      expect(describeFile('https://blob.vercel-storage.com/a/x.png').provider).toBe('blob')
      expect(describeFile('https://example.com/x').provider).toBe('greedy')
    } finally {
      const at = PROVIDERS.findIndex((p) => p.id === 'greedy')
      if (at >= 0) PROVIDERS.splice(at, 1)
    }
  })

  it('the manifest names every provider plus the fallback', () => {
    const m = providerManifest()
    const ids = m.map((x) => x.id)
    expect(ids).toContain('blob')
    expect(ids).toContain('google_drive')
    expect(ids, 'agents need to be told the fallback exists too').toContain('external')
    expect(m.find((x) => x.id === 'blob')!.internal).toBe(true)
    expect(m.find((x) => x.id === 'google_drive')!.internal).toBe(false)
  })
})
