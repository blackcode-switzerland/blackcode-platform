// `probePreview` — can an anonymous viewer open this external file?
//
// ===========================================================================
// THE POSITIVE CASE IS THE WHOLE REASON THIS FILE EXISTS
// ===========================================================================
// CLAUDE.md finding #16: a check built only on "was this denied?" cannot tell a
// working boundary from a subject that refuses everything. This probe is exactly
// that shape — run against real data it answered `restricted` **ten times out of
// ten**, and every one of those was correct (the seed rows carry placeholder
// Drive ids). A probe that could ONLY ever say `restricted` would have produced
// the identical output, and nothing in that run would have told them apart.
//
// So `200 → public` is asserted here, with a stubbed `fetch`, because it is the
// branch a live database has no way to exercise.
//
// ===========================================================================
// THIS FILE PASSED AGAINST A BROKEN PROBE, AND THAT IS THE LESSON
// ===========================================================================
// The first version probed `drive.google.com/thumbnail?id=…` and treated any
// non-2xx as `restricted`. These tests passed — they STUB fetch, so they only
// ever proved "if the endpoint answers 200 we say public".
//
// The live endpoint answers **302 for every file, public or not**. So the real
// probe could only ever return `restricted`, and a run against ten real rows
// agreed with it ten times because all ten genuinely were. It was caught by
// `curl`-ing the endpoint, not by anything in here.
//
// A stub can only ever check the mapping from response to verdict. It cannot
// check that the endpoint produces the responses you assumed. **When a probe
// targets a third party, the assumption about that third party has to be
// measured against it at least once**, and the measurement recorded — which is
// what `preview-probe.ts`'s header now does.
//
// The `redirect: 'manual'` assertion stays, with the reason inverted: FOLLOWING
// the chain ends on a Google sign-in page served `200 text/html`, which would
// make every private file read as public.
//
// Watched fail 2026-08-17:
//   - deleting `redirect: 'manual'` → the option assertion goes red.
//   - `return 'public'` unconditionally → the restricted, unknown and
//     non-probeable cases all go red.
//   - treating a 302 as `restricted` (the original bug) → the "a redirect is
//     not evidence" case goes red.
//   - removing the try/catch → the network-failure case throws instead of
//     asserting, the shape a write path would take.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeMimeType, probePreview, previewStatusNote } from './preview-probe'

const DRIVE_ID = '1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub `fetch`, recording how it was called. */
function stubFetch(impl: (url: string, init: RequestInit) => unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const out = impl(String(url), init)
    if (out instanceof Error) throw out
    return out
  })
  return calls
}

describe('probePreview', () => {
  it('THE POSITIVE CASE: a 200 means public', async () => {
    // The branch a live database cannot reach. Without it this whole probe
    // could be `() => "restricted"` and every real-data run would agree.
    stubFetch(() => ({ status: 200 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('public')
  })

  it('a 404 means restricted — Drive’s answer for "not accessible to you"', async () => {
    stubFetch(() => ({ status: 404 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('restricted')
  })

  it('a 403/401 means restricted too', async () => {
    stubFetch(() => ({ status: 403 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('restricted')
    stubFetch(() => ({ status: 401 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('restricted')
  })

  it('A REDIRECT IS NOT EVIDENCE — it is `unknown`, not `restricted`', async () => {
    // The original bug, pinned. Treating 302 as a denial made this probe answer
    // `restricted` for every file in existence, because the endpoint it used
    // redirects unconditionally. `unknown` is the honest reading of "the server
    // sent us somewhere else".
    stubFetch(() => ({ status: 302 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('unknown')
  })

  it('a 5xx is `unknown` — the provider having a bad day is not a verdict', async () => {
    stubFetch(() => ({ status: 503 }))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('unknown')
  })

  it('probes the URL the iframe will actually load, when given one', async () => {
    // Probing a DIFFERENT url than the one embedded is how the first version
    // went wrong. A `public` verdict has to mean "the thing the page is about
    // to do works", not "something adjacent to it works".
    const embed = `https://docs.google.com/presentation/d/${DRIVE_ID}/embed`
    const calls = stubFetch(() => ({ status: 200 }))
    await probePreview('google_drive', DRIVE_ID, embed)
    expect(calls[0]!.url).toBe(embed)
  })

  it('asks for the file id, and asks ANONYMOUSLY without following redirects', async () => {
    const calls = stubFetch(() => ({ status: 200 }))
    await probePreview('google_drive', DRIVE_ID)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain(DRIVE_ID)
    expect(calls[0]!.url, 'the probe must ask for the embeddable url').toContain('/preview')
    // THE ONE THAT MATTERS. Following the redirect lands on a 200 login page and
    // makes every private file look public. See the header.
    expect(
      calls[0]!.init.redirect,
      'without redirect:"manual" a restricted file answers 200 and reads as public'
    ).toBe('manual')
    // The question is what an ANONYMOUS viewer sees. Sending credentials would
    // answer a different question — one about us, not about the customer.
    expect(calls[0]!.init.credentials).toBe('omit')
  })

  it('a network failure is `unknown`, never a throw — the write must survive', async () => {
    stubFetch(() => new Error('ECONNREFUSED'))
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('unknown')
  })

  it('an aborted (timed-out) request is `unknown`', async () => {
    stubFetch(() => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      return e
    })
    expect(await probePreview('google_drive', DRIVE_ID)).toBe('unknown')
  })

  it('does not call the network at all for a provider it cannot probe', async () => {
    const calls = stubFetch(() => ({ status: 200 }))
    expect(await probePreview('external', null)).toBe('unknown')
    expect(await probePreview('blob', null)).toBe('unknown')
    // Drive with no id is not probeable either — asking would be a request for
    // `?id=null`, which answers something meaningless.
    expect(await probePreview('google_drive', null)).toBe('unknown')
    expect(calls, 'an unprobeable provider still hit the network').toHaveLength(0)
  })
})

describe('previewStatusNote', () => {
  it('says nothing about our own files — there is nothing to fix', () => {
    expect(previewStatusNote(null, 'blob')).toBeNull()
    expect(previewStatusNote('public', 'blob')).toBeNull()
  })

  it('names the REMEDY for a restricted file, not just the problem', () => {
    // CLAUDE.md: a dead end must name its own exit. The exit here is at the
    // provider, and the confirmation is a command.
    const note = previewStatusNote('restricted', 'google_drive')!
    expect(note).toContain('anyone with the link')
    expect(note).toContain('bk sales doc recheck')
  })

  it('distinguishes "we could not check" from "it is restricted"', () => {
    // Collapsing the two would tell somebody to go and re-share a file that was
    // never the problem.
    expect(previewStatusNote('unknown', 'google_drive')).not.toEqual(
      previewStatusNote('restricted', 'google_drive')
    )
  })
})

describe('probeMimeType — what kind of file is behind a Drive link', () => {
  it('reads the real type from the download endpoint', async () => {
    // Measured live 2026-08-17: a link-shared mp4 answers `206 video/mp4` and a
    // jpeg answers `206 image/jpeg`. This is what turns a Drive link into a
    // *video* rather than the generic `other` the url alone can produce.
    stubFetch(() => ({ status: 206, headers: new Headers({ 'content-type': 'video/mp4' }) }))
    expect(await probeMimeType('google_drive', DRIVE_ID)).toBe('video/mp4')
  })

  it('REFUSES the virus-scan interstitial — the branch that would be confidently wrong', async () => {
    // Drive answers a LARGE file with an HTML confirmation page instead of the
    // bytes. `mediaKindOf` maps `text/*` to `doc`, so an unguarded version would
    // type every big video as a document — worse than not detecting at all,
    // because it is wrong with conviction and nothing looks broken.
    stubFetch(() => ({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    }))
    expect(await probeMimeType('google_drive', DRIVE_ID)).toBeNull()
  })

  it('refuses the generic types that are not answers', async () => {
    // `application/binary` is what the 303 hop reports before the real type.
    for (const ct of ['application/binary', 'application/octet-stream', '']) {
      stubFetch(() => ({ status: 206, headers: new Headers(ct ? { 'content-type': ct } : {}) }))
      expect(await probeMimeType('google_drive', DRIVE_ID), ct || '(none)').toBeNull()
    }
  })

  it('asks for ONE BYTE, so a 4 GB video costs the same as a thumbnail', async () => {
    const calls = stubFetch(() => ({
      status: 206,
      headers: new Headers({ 'content-type': 'video/mp4' }),
    }))
    await probeMimeType('google_drive', DRIVE_ID)
    expect((calls[0]!.init.headers as Record<string, string>).Range).toBe('bytes=0-0')
    // FOLLOW here, unlike probePreview: the type is only revealed after the 303
    // to drive.usercontent.google.com.
    expect(calls[0]!.init.redirect).toBe('follow')
    expect(calls[0]!.init.credentials).toBe('omit')
  })

  it('is null for anything it cannot ask, and never hits the network', async () => {
    const calls = stubFetch(() => ({ status: 206, headers: new Headers() }))
    expect(await probeMimeType('blob', null)).toBeNull()
    expect(await probeMimeType('external', null)).toBeNull()
    expect(await probeMimeType('google_drive', null)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('a network failure is null, never a throw — it runs inside a write path', async () => {
    stubFetch(() => new Error('ECONNREFUSED'))
    expect(await probeMimeType('google_drive', DRIVE_ID)).toBeNull()
  })
})
