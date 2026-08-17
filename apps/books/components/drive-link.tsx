// `<DriveLink>` — a supporting document, which is a REFERENCE and never a file.
//
// ===========================================================================
// THERE IS NO FILE PICKER IN THIS PRODUCT, AND THIS COMPONENT IS WHY
// ===========================================================================
// Documents live in Google Drive. What b/books holds is `{ drive_ref, hash,
// captured }` — a pointer, a sha256 taken at capture, and the date it was taken.
// The hash is what makes the digital copy admissible under art. 958f CO: it is
// the evidence that the file behind the link is the file that was seen.
//
// Nothing is ever uploaded into this app. That is not a limitation to be fixed
// later — it is the design (`PIECES-PIPELINE-DESIGN.md`), and the moment this
// app stores a blob it inherits a ten-year retention obligation for it. So there
// is no `<input type="file">` anywhere in b/books, and if one appears, this
// comment is the thing it contradicts.
//
// ── THE HASH IS SHOWN, TRUNCATED, AND COPYABLE IN FULL ─────────────────────
// A reader checking a document against its record needs the hash; a screen full
// of 64-hex-character strings is unreadable. First twelve characters, with the
// whole value in `title` and in `data-hash` — so a person can see it, an agent
// can read it, and neither has to open a modal.
//
// ── AN ABSENT DOCUMENT IS THE FINDING, NOT AN EMPTY CELL ───────────────────
// `piece: null` is the single most important fact a supporting-documents screen
// can show: an entry with no document is what limits the evidence tier, which is
// what costs the input VAT claim. So null renders "no document" in the
// destructive tint rather than an em dash. It is a fact, not an error — hence
// tinted text and not a badge, the same rule `<Money>` follows for negatives.

import { ExternalLink } from 'lucide-react'
import { DateText } from './date-text'
import type { Piece } from '@/lib/types'

export function DriveLink({
  piece,
  /** Show the capture date beside the link. Off in dense tables. */
  withCaptured = false,
  className = '',
}: {
  piece: Piece | null | undefined
  withCaptured?: boolean
  className?: string
}) {
  if (!piece) {
    return (
      <span className={'text-xs text-destructive ' + className} data-piece="none">
        no document
      </span>
    )
  }

  return (
    <span className={'inline-flex items-baseline gap-2 ' + className}>
      <a
        href={piece.drive_ref}
        target="_blank"
        // `noopener` is not optional on a `target="_blank"` to a third-party
        // origin: without it the opened tab can reach back through
        // `window.opener`. `noreferrer` because Drive does not need to know
        // which screen of an internal bookkeeping tool the click came from.
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[13px] hover:text-primary-strong"
      >
        <ExternalLink size={12} className="shrink-0" />
        Document
      </a>
      <span
        className="font-mono text-[11px] text-muted-foreground"
        title={piece.hash}
        data-hash={piece.hash}
      >
        {piece.hash.slice(0, 12)}
      </span>
      {withCaptured && (
        <DateText value={piece.captured} className="text-[11px] text-muted-foreground" />
      )}
    </span>
  )
}
