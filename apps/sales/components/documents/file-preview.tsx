'use client'

// Showing a document — the web half of sales #40.
//
// ===========================================================================
// THE RULE: NEVER EMBED SOMETHING THAT WILL RENDER A SIGN-IN SCREEN
// ===========================================================================
// A Google Drive `/preview` iframe renders the file for a viewer who can
// already open it in Drive, and Google's own request-access page for everybody
// else — inside our page, wearing our chrome, on a customer record.
//
// We cannot tell those apart from the browser, and we hold no Google
// credentials to ask with. What we have is the server's probe result
// (`file.preview_status`), and this component's central decision is to trust it
// conservatively: **embed only on `public`.** `restricted` and `unknown` both
// render an honest card with a button that opens the file where it actually
// lives.
//
// Getting that backwards would not look like a bug in testing — whoever is
// building this is signed in to Drive, so every embed works for them and fails
// for the customer-facing case they cannot see.
//
// ===========================================================================
// AND: THE BADGE SAYS WHOSE FILE IT IS
// ===========================================================================
// Asked for explicitly, and it is not decoration. "Blackcode storage" and
// "Google Drive" differ in who can delete the file, who controls who sees it,
// and whether it survives somebody leaving the company. A listing that rendered
// both identically — which is what this app did until now — hides all three.

import { ExternalLink, File, FileSpreadsheet, FileText, Film, Folder, Image as ImageIcon, Lock, Music, Presentation } from 'lucide-react'
import { MediaLightbox } from '@blackcode/platform-ui/media-lightbox'
import type { SalesDocument } from '@/lib/hooks'

/** One icon per media kind. `other` gets the generic file. */
function KindIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const props = { size, className: 'shrink-0' }
  switch (kind) {
    case 'image':
      return <ImageIcon {...props} />
    case 'video':
      return <Film {...props} />
    case 'audio':
      return <Music {...props} />
    case 'pdf':
      return <FileText {...props} />
    case 'doc':
      return <FileText {...props} />
    case 'sheet':
      return <FileSpreadsheet {...props} />
    case 'slides':
      return <Presentation {...props} />
    case 'folder':
      return <Folder {...props} />
    default:
      return <File {...props} />
  }
}

/**
 * Whose file is this.
 *
 * Deliberately not colour-coded by "good/bad" — neither is wrong, they are
 * different. Ours is filled (we are responsible for it); external is outlined
 * (we are pointing at it).
 */
export function SourceBadge({ doc }: { doc: SalesDocument }) {
  const { internal, label, preview_status, media_kind } = doc.file
  // A folder is not "restricted" in any sense a reader can act on — see
  // `PreviewFallback`. It simply has no preview, so it gets no warning chip.
  const blocked =
    !internal && media_kind !== 'folder' && preview_status !== null && preview_status !== 'public'
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ' +
          (internal
            ? 'bg-primary/10 text-primary'
            : 'border border-border text-muted-foreground')
        }
        title={
          internal
            ? 'Stored by us — we hold the file and it is protected from deletion while in use'
            : `Stored in ${label} — we reference it and never delete it`
        }
      >
        <KindIcon kind={doc.file.media_kind} size={11} />
        {label}
      </span>
      {blocked && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          title={
            preview_status === 'restricted'
              ? 'Not viewable without access at the provider, so it cannot be previewed here'
              : 'We could not check whether this is viewable, so it is not previewed'
          }
        >
          <Lock size={11} />
          {preview_status === 'restricted' ? 'Restricted' : 'Unchecked'}
        </span>
      )}
    </span>
  )
}

/**
 * Can this document be previewed at all?
 *
 * TWO conditions, and they answer different questions. `embed_mode` is what the
 * file CAN do — a folder and an unrecognised host can do nothing. `preview_status`
 * is whether we may — an external file is embedded only on an explicit `public`
 * verdict, because anything else renders the provider's sign-in page inside our
 * chrome. Our own files carry `null` and are always embeddable; there is no
 * external permission system in the way.
 */
export function canPreview(doc: SalesDocument): boolean {
  const f = doc.file
  const mayEmbed = f.internal || f.preview_status === 'public'
  return mayEmbed && f.embed_mode !== 'none' && Boolean(f.embed_url)
}

/**
 * The preview, FULL SCREEN.
 *
 * It used to expand inline, inside the list row, and that read badly: a player
 * between two rows pushes the page around, competes with its own row for
 * attention, and is stuck at the width of a list never designed to hold a
 * video. `MediaLightbox` is the shared overlay; this component only decides
 * WHAT to hand it.
 *
 * Callers must gate on `canPreview` — this returns null rather than a fallback,
 * because an overlay is opened by an explicit click and there is nothing to
 * show if there was nothing to open.
 */
export function FilePreviewModal({
  doc,
  onClose,
}: {
  doc: SalesDocument
  onClose: () => void
}) {
  const f = doc.file
  if (!canPreview(doc) || !f.embed_url) return null
  return (
    <MediaLightbox
      mode={f.embed_mode as 'image' | 'video' | 'audio' | 'iframe'}
      src={f.embed_url}
      title={doc.title}
      openUrl={f.open_url}
      // Whose system is about to render. If it asks for a login, this is what
      // tells the reader whose login it is.
      sourceLabel={f.label}
      onClose={onClose}
    />
  )
}

/**
 * What to show INLINE when there is no preview — and it must never be a blank
 * box. This is the only thing that still renders in the row itself; an actual
 * preview goes full screen.
 *
 * Three different reasons land here and the card says which, because the
 * remedy differs: a folder has no preview by nature, a restricted file needs
 * sharing changed at the provider, and an unchecked one needs a recheck.
 */
export function PreviewFallback({ doc }: { doc: SalesDocument }) {
  const f = doc.file
  // FOLDER FIRST, and the order is the fix for a bug caught in the browser: a
  // folder was reporting `restricted` and telling somebody to share it "anyone
  // with the link" so it could be previewed. It never can be — a folder has no
  // embed at any permission level. The route stopped probing these at all; this
  // is the rendering half of the same fix, so an already-stored verdict cannot
  // resurrect the wrong advice.
  const reason =
    f.media_kind === 'folder'
      ? 'A folder — open it to see what is inside. Folders are never previewed here.'
      : f.preview_status === 'restricted'
        ? `Not viewable without access in ${f.label}. Share it “anyone with the link” to preview it here.`
        : f.preview_status === 'unknown'
          ? `We could not check whether this is viewable in ${f.label}.`
          : null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3">
      <span className="mt-0.5 text-muted-foreground">
        <KindIcon kind={f.media_kind} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{doc.title}</p>
        {reason && <p className="mt-0.5 text-xs text-muted-foreground">{reason}</p>}
      </div>
      <a
        href={f.open_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
      >
        <ExternalLink size={12} />
        Open
      </a>
    </div>
  )
}
