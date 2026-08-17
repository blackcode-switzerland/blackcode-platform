// Google Drive — the first external provider.
//
// ===========================================================================
// WHAT THIS DOES AND WHAT IT REFUSES TO DO
// ===========================================================================
// It reads a URL. That is all. No API key, no OAuth, no token, no network call.
// Everything below is derived from the shape of the url and Drive's documented,
// credential-free endpoints.
//
// That constraint is the design, not a limitation we are working around: making
// a Drive item viewable is the AGENT's job (share it "anyone with the link"),
// and the moment we hold a Google credential we own a security problem that is
// explicitly out of scope. See `gitIgnore/external-file-providers.spec.md` §2.
//
// ===========================================================================
// THE URL SHAPES, AND WHY THE LIST IS EXPLICIT
// ===========================================================================
//   drive.google.com/file/d/<id>/view        a stored file — pdf, video, image
//   drive.google.com/open?id=<id>            the old share shape, still emitted
//   drive.google.com/uc?id=<id>              a direct-download link
//   drive.google.com/drive/folders/<id>      a folder
//   docs.google.com/document/d/<id>/edit     a Doc
//   docs.google.com/spreadsheets/d/<id>/…    a Sheet
//   docs.google.com/presentation/d/<id>/…    Slides
//   docs.google.com/forms/d/<id>/…           a Form
//
// Matched by explicit shape rather than "any google.com url with a long id in
// it", because the second would claim Gmail links, Calendar links and search
// results — every one of which would then render as a broken iframe inside our
// page. A url this file does not recognise falls through to the generic
// external provider and renders as a plain link, which is the correct outcome.
//
// ===========================================================================
// EMBEDDING, AND THE HONEST FAILURE
// ===========================================================================
// `/preview` renders in an iframe **for a viewer who can already open the file
// in Drive**. For anyone else it renders Google's own request-access screen —
// inside our page, wearing our chrome.
//
// This file cannot tell the two apart, because that genuinely requires asking
// Google. So it always reports the embed it WOULD use, and the decision to show
// it belongs to the caller, which holds the probe result
// (`documents.preview_status`). A surface that embedded on this alone would show
// a Google sign-in box on a customer record.

import { mediaKindOf } from '../media-kind'
import type { DescribeHints, FileDescriptor, FileProvider, MediaKind } from '../types'

/**
 * A Drive id: the opaque handle in every url shape above.
 *
 * Deliberately loose (`[\w-]{10,}`) rather than a precise length. Drive ids have
 * changed length over the years and pinning it would mean rejecting real,
 * currently-valid links the day Google changes the generator — a failure that
 * would look like "the app does not support Drive" rather than like a bug. The
 * floor of 10 is what keeps `/file/d/x/view` out.
 */
const ID = /^[\w-]{10,}$/

/** `docs.google.com/<kind>/d/<id>` → the MediaKind for `<kind>`. */
const DOCS_KIND: Record<string, MediaKind> = {
  document: 'doc',
  spreadsheets: 'sheet',
  presentation: 'slides',
  // A Form is not a document anybody previews usefully; `other` renders it as a
  // card with a link, which is what you want to do with a form.
  forms: 'other',
}

type Match = Omit<FileDescriptor, 'provider' | 'internal' | 'label'>

/** `/a/b/c` → `['a','b','c']`, empty segments dropped. */
function segments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

/**
 * The thumbnail Drive serves without credentials, for anything link-shared.
 *
 * `sz=w800` rather than the default, which is small enough to look broken on a
 * card.
 *
 * ===========================================================================
 * IT IS BLOCKED ON AN INSECURE ORIGIN, AND THAT IS A DEV-ONLY ARTIFACT
 * ===========================================================================
 * Measured 2026-08-17 against a genuinely link-shared file, same browser, same
 * url, two origins:
 *
 *     http://localhost:3100      BLOCKED — net::ERR_BLOCKED_BY_ORB
 *     https://sales.blackcode.ch RENDERS — 800x1422
 *
 * Chrome's Opaque Response Blocking refuses Google's response for an `<img>`
 * load from an insecure origin and permits it from a secure one. So **it works
 * in production and fails in local dev**, which is the most misleading way for
 * a thing to fail: it was briefly removed on the strength of the localhost
 * result alone, and that removal was wrong.
 *
 * The url is therefore emitted, and the RENDERER carries an `onError` that
 * falls back to a type icon — so a blocked thumbnail degrades to the icon
 * rather than to a broken-image glyph, in dev and anywhere else it is refused.
 *
 * If a thumbnail is ever needed on an insecure origin, proxy it: our server can
 * fetch the image, and a same-origin response defeats ORB. Not built, because
 * it puts third-party bytes through our infrastructure for a decoration that
 * already works where it matters.
 */
function thumbnail(id: string): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w800`
}

function fileMatch(id: string, hints: DescribeHints): Match {
  // A stored Drive file's kind cannot be read from the url — `/file/d/<id>/view`
  // says nothing about whether it is a video or a pdf. So we use whatever the
  // caller knows (a mime it recorded, the original filename) and otherwise say
  // `other`, which renders as a card rather than guessing wrong.
  //
  // This is why `bk sales doc add --url <drive> --kind video` still matters: the
  // author's label is real information we cannot derive.
  const kind: MediaKind = hints.mime || hints.filename ? mediaKindOf(hints) : 'other'
  return {
    external_id: id,
    media_kind: kind,
    // `/preview` is the embeddable renderer for a stored file of ANY type —
    // Drive picks the viewer. That is why this is `iframe` rather than `video`
    // even for a video: an `<video src>` pointed at Drive does not play, Drive's
    // own player does.
    embed: { mode: 'iframe', url: `https://drive.google.com/file/d/${id}/preview` },
    thumbnail_url: thumbnail(id),
    open_url: `https://drive.google.com/file/d/${id}/view`,
  }
}

export const googleDrive: FileProvider = {
  id: 'google_drive',
  label: 'Google Drive',
  internal: false,

  match(url: URL, hints: DescribeHints): Match | null {
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const seg = segments(url)

    if (host === 'drive.google.com') {
      // /file/d/<id>/view
      if (seg[0] === 'file' && seg[1] === 'd' && seg[2] && ID.test(seg[2])) {
        return fileMatch(seg[2], hints)
      }
      // /drive/folders/<id>  — and the older /folderview?id=
      const folderId =
        seg[0] === 'drive' && seg[1] === 'folders' && seg[2] && ID.test(seg[2])
          ? seg[2]
          : seg[0] === 'folderview' && url.searchParams.get('id')
            ? url.searchParams.get('id')
            : null
      if (folderId && ID.test(folderId)) {
        return {
          external_id: folderId,
          media_kind: 'folder',
          // A folder has no preview. Saying so is the point — the alternative is
          // an iframe showing a Drive chrome nobody wanted inside a card.
          embed: { mode: 'none', url: null },
          thumbnail_url: null,
          open_url: `https://drive.google.com/drive/folders/${folderId}`,
        }
      }
      // /open?id=<id> and /uc?id=<id> — both address a stored file
      if (seg[0] === 'open' || seg[0] === 'uc') {
        const id = url.searchParams.get('id')
        if (id && ID.test(id)) return fileMatch(id, hints)
      }
      return null
    }

    if (host === 'docs.google.com') {
      // /<document|spreadsheets|presentation|forms>/d/<id>/...
      // `/d/e/<token>/pubhtml` is a PUBLISHED doc, whose token is not a file id;
      // seg[2] === 'e' filters it out rather than storing a token as an id.
      const kindKey = seg[0] ?? ''
      const kind = DOCS_KIND[kindKey]
      if (kind && seg[1] === 'd' && seg[2] && seg[2] !== 'e' && ID.test(seg[2])) {
        const id = seg[2]
        const base = `https://docs.google.com/${kindKey}/d/${id}`
        return {
          external_id: id,
          media_kind: kind,
          embed: {
            // Slides uses `/embed`; Docs and Sheets use `/preview`. Forms are
            // not previewed at all — a form belongs opened, not framed.
            mode: kindKey === 'forms' ? 'none' : 'iframe',
            url:
              kindKey === 'forms'
                ? null
                : kindKey === 'presentation'
                  ? `${base}/embed`
                  : `${base}/preview`,
          },
          // Docs/Sheets/Slides answer the same thumbnail endpoint as files.
          thumbnail_url: kindKey === 'forms' ? null : thumbnail(id),
          open_url: `${base}/edit`,
        }
      }
      return null
    }

    return null
  },
}
