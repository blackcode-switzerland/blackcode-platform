// Our own storage — Vercel Blob, and the local `/uploads/` path.
//
// ===========================================================================
// THIS IS THE ONLY PROVIDER WHERE `internal` IS TRUE, AND THAT IS LOAD-BEARING
// ===========================================================================
// `internal: true` means WE hold the bytes, which is what makes the file:
//
//   - counted by `platform.blob_references` and protected by the cross-app
//     delete gate;
//   - ours to delete, and therefore ours to lose;
//   - viewable by anybody who can see the record, with no external permission
//     system in the way — which is why an internal image can simply be rendered
//     while a Drive one cannot.
//
// The recogniser here MUST agree with `platform.is_uploaded_asset` in Postgres,
// which is what the delete gate actually consults. Those are two implementations
// of one question, and the failure of a disagreement is asymmetric in the usual
// direction: a url this file calls internal that the database does not is a file
// the UI treats as protected while nothing protects it.
//
// The database function is:
//
//     WHEN u LIKE '/uploads/%' THEN true
//     WHEN u ~* '^https?://' THEN blob_url_host(u) = 'blob.vercel-storage.com'
//                              OR blob_url_host(u) LIKE '%.blob.vercel-storage.com'
//
// and the two branches below are that, in the same order.

import { embedForOwnBytes, mediaKindOf } from '../media-kind'
import type { DescribeHints, FileDescriptor, FileProvider } from '../types'

type Match = Omit<FileDescriptor, 'provider' | 'internal' | 'label'>

const BLOB_HOST = 'blob.vercel-storage.com'

/** Mirrors `platform.is_uploaded_asset`'s host test. See the header. */
export function isOwnBlobHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === BLOB_HOST || host.endsWith(`.${BLOB_HOST}`)
}

export const blob: FileProvider = {
  id: 'blob',
  // Named for the company rather than the vendor. The badge tells a reader who
  // is responsible for the file, and "Vercel Blob" answers a question nobody on
  // a customer record is asking. If the store is ever replaced, the label stays
  // true and only this file changes.
  label: 'Blackcode storage',
  internal: true,

  match(url: URL, hints: DescribeHints): Match | null {
    const isLocalUpload = url.pathname.startsWith('/uploads/')
    if (!isOwnBlobHost(url.hostname) && !isLocalUpload) return null

    const kind = mediaKindOf({
      mime: hints.mime,
      // The url's own path carries the filename for both shapes, and an
      // explicit hint beats it — a blob path can be suffixed for uniqueness.
      filename: hints.filename ?? url.pathname,
    })
    return {
      // Our own files have no foreign handle. Null rather than the blob path:
      // `external_id` means "the OTHER system's id for this", and inventing one
      // for ourselves would make `external_id != null` stop meaning "external".
      external_id: null,
      media_kind: kind,
      // We serve the bytes, so the browser can render them directly — a real
      // `<img>`/`<video>`, not somebody else's iframe.
      embed: embedForOwnBytes(kind, url.toString()),
      // An image IS its own thumbnail. For everything else there is nothing to
      // show without generating one, which is work this package does not do.
      thumbnail_url: kind === 'image' ? url.toString() : null,
      open_url: url.toString(),
    }
  },
}
