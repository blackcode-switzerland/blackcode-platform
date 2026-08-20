// Deriving `MediaKind` from a mime type or a filename.
//
// MIME FIRST, EXTENSION SECOND, AND NEVER THE OTHER WAY ROUND. A mime type was
// reported by whatever stored the file; an extension is a guess about a string.
// `report.pdf.txt` is a text file, and only one of the two knows that.
//
// Both are best-effort and the fallback is `other`, which renders as a plain
// card. There is no failure case: a file we cannot classify is still a file
// somebody can open.

import type { FileEmbed, MediaKind } from './types'

/**
 * Extension → kind.
 *
 * Not exhaustive and not trying to be — an unknown extension falls to `other`,
 * which is a correct answer rather than a gap. Entries earn their place by
 * being things a sales or issues attachment is actually likely to be.
 */
const BY_EXTENSION: Record<string, MediaKind> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  avif: 'image', svg: 'image', bmp: 'image', heic: 'image', heif: 'image',
  // video — mp4/mov/webm are the three a browser can actually play inline
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', avi: 'video', mkv: 'video',
  // audio
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
  // documents
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  // archives
  zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive', '7z': 'archive',
}

/** The mime prefixes and exact types worth recognising. */
const BY_MIME_EXACT: Record<string, MediaKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/vnd.oasis.opendocument.text': 'doc',
  'application/vnd.ms-excel': 'sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'sheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'sheet',
  'text/csv': 'sheet',
  'application/vnd.ms-powerpoint': 'slides',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/vnd.oasis.opendocument.presentation': 'slides',
  'application/zip': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  // Google's own mime types, which arrive when an app has richer metadata than
  // a url. Kept here rather than in the Drive provider so that a caller holding
  // a mime and no recognisable url still classifies correctly.
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
  'application/vnd.google-apps.folder': 'folder',
}

/** `image/png` → `image`. Checked after the exact table. */
function fromMimePrefix(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/')) return 'doc'
  return null
}

/** The last dot-segment of a path, lowercased, or null. */
export function extensionOf(pathOrName: string): string | null {
  const clean = pathOrName.split(/[?#]/)[0] ?? ''
  const base = clean.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  // `>` not `>=`: a leading dot is a hidden file (`.env`), not an extension.
  if (dot <= 0 || dot === base.length - 1) return null
  return base.slice(dot + 1).toLowerCase()
}

/**
 * What kind of thing this is. `other` when nothing recognises it.
 *
 * `mime` wins because it was reported by the store rather than inferred from a
 * string somebody typed.
 */
export function mediaKindOf(input: { mime?: string | null; filename?: string | null }): MediaKind {
  const mime = input.mime?.trim().toLowerCase().split(';')[0] ?? ''
  if (mime) {
    const exact = BY_MIME_EXACT[mime]
    if (exact) return exact
    const prefix = fromMimePrefix(mime)
    if (prefix) return prefix
  }
  const ext = input.filename ? extensionOf(input.filename) : null
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext]
  return 'other'
}

/**
 * How to embed a file whose bytes we can serve directly.
 *
 * Only the three a browser plays without a plugin, plus pdf in an iframe. A
 * `.docx` gets `none` and a download card — an iframe pointed at one downloads
 * the file in some browsers and shows binary in others, and neither is a
 * preview.
 */
export function embedForOwnBytes(kind: MediaKind, url: string): FileEmbed {
  switch (kind) {
    case 'image':
      return { mode: 'image', url }
    case 'video':
      return { mode: 'video', url }
    case 'audio':
      return { mode: 'audio', url }
    case 'pdf':
      return { mode: 'iframe', url }
    default:
      return { mode: 'none', url: null }
  }
}
