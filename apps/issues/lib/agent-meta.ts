// The derived half of GET /api/meta — everything an agent needs that changes
// WITHOUT a CLI release, assembled from the modules that actually enforce it.
//
// The split this file implements (see AGENT-SURFACE-SIMPLIFICATION-PLAN.md §2.1):
//
//   static behaviour (flags, exit codes, workflows) → embedded in the binary,
//                                                     served by `bk guide`
//   dynamic data     (enums, limits, media rules,   → served from here, live,
//                     workspaces, CLI versions)       via `bk meta`
//
// A guide fetched from the server would describe a binary the agent isn't
// running. A limit baked into the binary would go stale the moment we changed
// it. Embedded guide + live meta is the only combination that stays coherent.
//
// NOTHING here may be hand-typed. Every value is imported from its enforcer:
//   lib/limits.ts      — the length/count caps the routes check
//   lib/upload.ts      — the upload size cap + block list
//   lib/rich-text.ts   — how an uploaded url renders
//
// The CLI versions are not here: they are platform-wide and read live from npm,
// so `platformMetaBlock` (packages/platform-api/src/meta.ts) serves them.

import { LENGTH_LIMITS } from './limits'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, BLOCKED_UPLOAD_MIME_TYPES } from './upload'
import { INLINE_MEDIA_PREFIXES } from './rich-text'

/** `meta.limits` — every cap an agent must respect before it sends a request. */
export const META_LIMITS = {
  upload_max_bytes: MAX_UPLOAD_BYTES,
  upload_max_label: MAX_UPLOAD_LABEL,
  ...LENGTH_LIMITS,
} as const

/** `meta.media` — how an uploaded file renders once its url is in a rich-text body. */
export const META_MEDIA = {
  // A MIME whose type starts with one of these renders inline: an image
  // preview, a <video> player, or an <audio> player.
  inline_prefixes: INLINE_MEDIA_PREFIXES,
  // PDFs get a card with View + Download.
  view_and_download: ['application/pdf'],
  // Every other type gets a plain download card. Same node, different affordance.
  download_card: 'every other type',
  // Rejected by POST /api/upload with 400 file_type_not_allowed. Everything not
  // listed here is accepted, whatever its type.
  blocked_mime_types: BLOCKED_UPLOAD_MIME_TYPES,
  // Only urls produced by our own upload pipeline are upgraded to a media node.
  // External urls stay plain links and raw <iframe> is stripped on render — so
  // "embed this video" always means "upload it first".
  uploaded_assets_only: true,
} as const
