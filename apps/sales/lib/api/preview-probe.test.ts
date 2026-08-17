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
import { probePreview, previewStatusNote } from './preview-probe'

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
