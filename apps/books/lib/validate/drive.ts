// What the ROBOT DOOR accepts about the file behind a pièce.
//
// ===========================================================================
// A PIÈCE NOBODY CAN OPEN IS NOT EVIDENCE
// ===========================================================================
// Second report, 2026-08-20, and the first fix did not catch it because the
// first diagnosis was wrong. The harness was not putting the id in the link
// field — it was sending NO LINK AT ALL, and no checksum either:
//
//   drive_file_id  19Bh3YwYucUQ_6AYUGLfAu38Pc1FZ2B1o
//   web_view_link  NULL
//   sha256, md5    NULL
//
// Both fields were optional, so the delivery was accepted, and the screen fell
// back to printing the bare id beside "none recorded — duplicate detection
// cannot see this document". The UI was right: `pieces-inbox.tsx` renders a
// real link whenever there is one. There was nothing to render.
//
// So both are REQUIRED now, and the reasoning is the same for each: this is the
// only door documents come through, and a pièce that cannot be opened or
// distinguished is not evidence, it is a row that looks like evidence.
//
//   THE LINK. `piece_drive_ref` is what a fiduciary or the AFC follows to the
//   document ten years from now (art. 958f). Drive returns `webViewLink` in the
//   same response as `id`; a worker that has the file has the link.
//
//   THE CHECKSUM. The idempotency index is
//   `(workspace, drive_file_id, COALESCE(sha256, md5_checksum, ''))`. With
//   neither, the key collapses to '' — so a SECOND, DIFFERENT capture of the
//   same file id collides with the first and is silently treated as a retry.
//   An invoice reissued at a corrected amount would be dropped, not flagged,
//   and the inbox would show one document where two arrived. That is worse
//   than the message admits, and it is why absence is refused rather than
//   noted.
//
// Neither refusal asks the worker for anything it does not already hold.
//
// ===========================================================================
// A DRIVE FILE ID IS NOT A LINK, AND THE DOOR TOOK EITHER
// ===========================================================================
// Reported 2026-08-20 from a harness run. The worker had the file in Drive and
// delivered:
//
//   source.web_view_link = "1TbLMz3WTc65dkq100ly106Xz1rviK3Rr"
//
// which is the FILE ID, not the link to it. Nothing objected. `pieces.ts` builds
// the entry's `piece_drive_ref` as `web_view_link ?? drive://<file_id>`, so the
// bare id won — and the reference filed against the écriture, the one a
// fiduciary or the AFC follows to see the document ten years from now
// (art. 958f), was a string that opens nothing.
//
// It is the most plausible mistake at this door. Drive's API hands back `id`
// and `webViewLink` side by side, both strings, and only one of them is a URL.
// Getting them the wrong way round produces a piece that ingests cleanly, shows
// a plausible reference on screen, and is unusable as evidence.
//
// ── WHY REFUSE RATHER THAN REPAIR ──────────────────────────────────────────
// `https://drive.google.com/file/d/<id>/view` could be built from the id, and
// this deliberately does not. A pièce reference is a RECORD: it says where the
// document a booked entry rests on actually is. Manufacturing that URL would
// mean the app asserting a location it has never seen and cannot check — the
// id might be a folder, a Doc, or a file in another Drive entirely, and each
// produces a link that resolves to something wrong rather than to nothing. The
// worker knows which; it is holding the API response. So the door says what
// went wrong and where the right value is, and the worker sends it.
//
// The suggestion carries the URL SHAPE so an agent that genuinely only has the
// id knows what to go and fetch, rather than guessing at the field.

export interface DriveSourceRefusal {
  code: string
  message: string
  suggestion: string
}

/**
 * A Drive file id: Drive's own opaque key. No scheme, no slashes, no spaces —
 * which is exactly what makes it indistinguishable from a URL only by shape.
 */
const FILE_ID = /^[A-Za-z0-9_-]{8,128}$/

/** Anything with a scheme. Deliberately broad: the point is "is this a URL". */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export interface DriveSourceLike {
  file_id?: unknown
  web_view_link?: unknown
  sha256?: unknown
  md5_checksum?: unknown
}

/**
 * The two ways round this pair can be wrong, both refused by name.
 *
 * Returns null when there is nothing to say — including when `web_view_link`
 * is absent, which is a legitimate delivery: `pieces.ts` falls back to
 * `drive://<file_id>`, an honest internal reference that does not pretend to
 * be a link somebody can click.
 */
export function driveSourceRefusal(source: DriveSourceLike): DriveSourceRefusal | null {
  const id = source.file_id
  const link = source.web_view_link

  // ── THE MIRROR MISTAKE: a URL where the id belongs ────────────────────────
  // Worth its own refusal because the damage is different and quieter. The id
  // is the idempotency key — `uq_books_piece_inbox_file_checksum` is over
  // (workspace, drive_file_id, checksum) — so a URL here still dedupes against
  // itself, and the row simply never matches the same document delivered
  // correctly. Two pièces for one invoice, neither of them wrong on its face.
  if (typeof id === 'string' && (HAS_SCHEME.test(id) || id.includes('/'))) {
    return {
      code: 'file_id_is_a_url',
      message: `source.file_id is "${id}", which is a link rather than a Drive file id`,
      suggestion:
        'file_id is Drive\'s own `id` field — opaque, no scheme and no slashes. The link goes in `web_view_link`. Sending the URL here also breaks idempotency: the id is the dedupe key, so the same document delivered correctly later lands a second time',
    }
  }

  if (link === null || link === undefined || link === '') {
    return {
      code: 'missing_web_view_link',
      message: 'source.web_view_link is missing: this pièce would be filed with no way to open the document',
      suggestion:
        'send Drive\'s `webViewLink` — it comes back in the same response as `id`, so a worker holding the file is holding the link. The reference is what somebody follows to this document years later (art. 958f), and an id alone opens nothing',
    }
  }

  if (typeof link !== 'string') {
    return {
      code: 'bad_web_view_link',
      message: 'source.web_view_link is not a string',
      suggestion: 'send Drive\'s `webViewLink`, or omit the field entirely',
    }
  }

  if (HAS_SCHEME.test(link)) return null

  // ── THE REPORTED MISTAKE ─────────────────────────────────────────────────
  // Named separately from "not a URL" because knowing WHICH mistake it is, is
  // the whole value of the message: the caller has the right value in hand,
  // under a different key.
  if (FILE_ID.test(link)) {
    return {
      code: 'web_view_link_is_a_file_id',
      message: `source.web_view_link is "${link}", which is a Drive file id rather than a link to it`,
      suggestion:
        `Drive returns \`id\` and \`webViewLink\` side by side — send the second one here and the first as \`file_id\`. It looks like https://drive.google.com/file/d/${link}/view, but send the value Drive gave you rather than building it: this reference is what a fiduciary follows to the document years later, and the app will not assert a location it has never seen. Omit the field if you truly have no link`,
    }
  }

  return {
    code: 'bad_web_view_link',
    message: `source.web_view_link is "${link}", which is not a link`,
    suggestion: 'send Drive\'s `webViewLink` — an absolute URL',
  }
}

/**
 * A delivery must be distinguishable from the next one through the same file
 * id. See the header for why absence is refused rather than merely reported.
 *
 * Either checksum satisfies it. SHA-256 is what the books CITE as proof (0015)
 * and is preferred; MD5 is Drive's own field and still identifies a delivery,
 * which is all this rule needs. The route separately refuses a malformed
 * `sha256`, because a hash that proves nothing is worse than none.
 */
export function checksumRefusal(source: DriveSourceLike): DriveSourceRefusal | null {
  const has = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  if (has(source.sha256) || has(source.md5_checksum)) return null
  return {
    code: 'missing_checksum',
    message:
      'this delivery carries neither sha256 nor md5_checksum, so duplicate detection cannot see it',
    suggestion:
      'send `sha256` — the SHA-256 of the bytes the worker captured — or Drive\'s `md5Checksum`. Without one the dedupe key for this file id is empty, so the NEXT capture of the same file would be mistaken for a retry of this one and silently dropped: a reissued invoice would never reach the inbox',
  }
}
