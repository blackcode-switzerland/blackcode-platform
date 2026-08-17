// "Can a viewer actually open this external file?" — the one question about an
// external attachment that a url cannot answer (sales #40).
//
// ===========================================================================
// WHY THIS EXISTS AT ALL
// ===========================================================================
// We hold no Google credentials, by design. So we cannot ask Drive whether a
// file is shared — we can only observe whether Drive answers an unauthenticated
// request for it. Without that observation the failure is invisible until a
// human opens the page and sees Google's request-access screen inside a customer
// record, and **the agent that attached the link never finds out at all**.
//
// That is the gap this closes: the probe runs on attach, and `bk sales doc add`
// prints the verdict in the same command that created the row. A broken link is
// caught in the second it is made rather than in a meeting.
//
// ===========================================================================
// IT MUST NEVER FAIL THE WRITE. THIS IS THE WHOLE OPERATIONAL CONTRACT.
// ===========================================================================
// A network call inside a write path is a new way for that write to fail, and
// this one depends on a third party we do not control. If Drive is slow, or DNS
// is down, or a proxy blocks the request, **the document must still be created**.
//
// So: a short timeout, every error swallowed, and `unknown` returned. `unknown`
// is a real answer meaning "we could not tell", NOT an error and NOT a claim
// that the file is restricted — the UI treats it as "do not embed" (the safe
// reading) while the CLI says plainly that the check did not complete.
//
// The alternative — letting a probe failure 500 the create — would mean Google
// having a bad afternoon stops people recording their own documents.
//
// ===========================================================================
// WE PROBE THE URL WE EMBED — AND THE FIRST VERSION OF THIS WAS BROKEN
// ===========================================================================
// It probed `https://drive.google.com/thumbnail?id=<id>` with `redirect:
// 'manual'`, on the belief that Drive answers 200 for a shared file and 302 for
// a private one. **Measured against the live endpoint, it answers 302 for
// BOTH** — it always redirects to `lh3.googleusercontent.com`. So the check
// returned `restricted` for every file that has ever existed, including public
// ones, and it looked like it was working because every row in a real database
// genuinely was restricted. A check that can only ever deny (CLAUDE.md finding
// #16), caught by curling the endpoint rather than by trusting the unit test
// that stubbed it.
//
// Following the redirect instead is worse, not better: the chain ends at a
// **Google sign-in page served with `200 text/html`**, so `res.ok` would have
// reported every private file as public — the exact inversion, and the one that
// puts a login form inside a customer record.
//
// So the probe asks for the EMBED URL itself — `/preview` for a file,
// `/preview` or `/embed` for a Doc/Sheet/Slides. Measured: it answers **404**
// for a file that is not accessible anonymously, with no redirect at all. That
// is a clean signal, and because it is the same url the iframe will load, a
// `public` verdict means the thing the page is about to do actually works
// rather than standing in for it.

export type PreviewStatus = 'public' | 'restricted' | 'unknown'

/** Long enough for a healthy round trip, short enough not to hold up a write. */
const TIMEOUT_MS = 4000

/**
 * Ask whether an external file is viewable without credentials.
 *
 * Returns `unknown` for anything it cannot check — an unrecognised provider, a
 * file with no id, a network failure. Never throws.
 */
export async function probePreview(
  provider: string,
  externalId: string | null,
  embedUrl?: string | null
): Promise<PreviewStatus> {
  // Only Drive is probeable today. A future provider adds a branch here; until
  // then `unknown` is honest — we genuinely do not know, and claiming `public`
  // for an unprobeable link would put a broken embed on the page.
  if (provider !== 'google_drive' || !externalId) return 'unknown'

  // The url the iframe will actually load. Falls back to the file shape when the
  // caller has no descriptor to hand — the same url `googleDrive.match` builds.
  const url = embedUrl ?? `https://drive.google.com/file/d/${encodeURIComponent(externalId)}/preview`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      // `manual`, and the reason is now the opposite of what the first version
      // claimed: FOLLOWING a redirect lands on a Google sign-in page served
      // `200 text/html`, which would read as public. A redirect is not a
      // verdict either way, so it is treated as `unknown` below rather than as
      // a denial — the mistake the thumbnail version made.
      redirect: 'manual',
      // No credentials, no cookies: the question is what an ANONYMOUS viewer
      // sees. Sending anything would answer a different question.
      credentials: 'omit',
      signal: controller.signal,
    })
    if (res.status >= 200 && res.status < 300) return 'public'
    // 404 is Drive's answer for "not accessible to you", and 403 for some
    // shapes. Both mean the embed will not render.
    if (res.status === 404 || res.status === 403 || res.status === 401) return 'restricted'
    // Anything else — a redirect, a 5xx, a rate limit — is NOT evidence. Saying
    // `restricted` here is what made the first version useless.
    return 'unknown'
  } catch {
    // Timeout, DNS, TLS, a blocked egress — all the same answer. See the header:
    // the write must survive this.
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

/** The human/agent-facing sentence for a status. Used by the route's response
 *  and echoed by `bk`, so both surfaces say the same thing. */
export function previewStatusNote(status: PreviewStatus | null, provider: string): string | null {
  if (provider === 'blob' || status == null) return null
  switch (status) {
    case 'public':
      return 'anyone with the link can view it — it will render in the app'
    case 'restricted':
      return 'NOT viewable without access — share it "anyone with the link" in Drive, then run `bk sales doc recheck <n>`'
    case 'unknown':
      return 'could not be checked (network or an unsupported provider) — it will not be embedded until a recheck says otherwise'
  }
}
