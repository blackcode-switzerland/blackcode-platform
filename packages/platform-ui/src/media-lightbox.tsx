'use client'

// A full-screen preview for anything: an image, a video, an audio file, or a
// third-party embed.
//
// ===========================================================================
// WHY NOT INLINE
// ===========================================================================
// The first version of sales' document preview expanded in place, inside the
// row. It worked and it read badly: a player appearing between two list rows
// pushes everything below it down, competes with the row it belongs to for
// attention, and is constrained to the width of a list that was never designed
// to hold a video. A preview wants the screen.
//
// ===========================================================================
// WHY THIS IS A SIBLING OF `image-lightbox.tsx` AND NOT A REFACTOR OF IT
// ===========================================================================
// They overlap — portal, backdrop, Escape, scroll lock — and merging them is
// the obviously tidy move. It is not taken here, deliberately:
// `ImageLightbox` is mounted by `rich-text-editor.tsx`, which BOTH production
// apps render on every description and every comment. Refactoring the component
// under it to serve a second caller is a change whose blast radius is "all
// content editing in both apps", and the payoff is forty lines.
//
// If a third caller appears, extract the shell then — with both consumers in
// front of you. Recorded so the duplication reads as a decision rather than as
// something nobody noticed.
//
// ===========================================================================
// AN EMBED IS SOMEBODY ELSE'S PAGE
// ===========================================================================
// `iframe` mode renders a document from a provider we do not control. It gets
// no `allow-same-origin` relaxation and no top-navigation permission: it may
// show itself and nothing else. `referrerPolicy="no-referrer"` keeps our
// workspace urls out of their logs.

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'

export type MediaLightboxMode = 'image' | 'video' | 'audio' | 'iframe'

export interface MediaLightboxProps {
  /** What to render. Comes from the file descriptor, not from a guess. */
  mode: MediaLightboxMode
  src: string
  title: string
  /** "Open the original" — always offered, because an embed can fail in ways
   *  this component cannot detect and the reader needs a way out. */
  openUrl?: string
  /** Where the file lives, e.g. "Google Drive". Shown so a viewer knows whose
   *  system is about to render, and whose login they are seeing if it asks. */
  sourceLabel?: string
  onClose: () => void
}

export function MediaLightbox({
  mode,
  src,
  title,
  openUrl,
  sourceLabel,
  onClose,
}: MediaLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', onKey)
    // Lock the page behind the overlay. Restored to whatever it WAS rather than
    // to `''`: a nested overlay would otherwise unlock scrolling for the one
    // still open when the inner closes.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus off the trigger and into the dialog, so Escape and Tab belong
    // to the overlay rather than to the list behind it.
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onKey])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      // `bg-black/70` — the "slight transparent background" asked for. Enough
      // that the page reads as inert, little enough that you can still see
      // where you are.
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mb-3 flex w-full max-w-5xl items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{title}</p>
        {sourceLabel && (
          <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
            {sourceLabel}
          </span>
        )}
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white transition-colors hover:bg-white/20"
          >
            <ExternalLink size={12} />
            Open original
          </a>
        )}
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label="Close preview"
          className="shrink-0 rounded-lg bg-white/10 p-1.5 text-white transition-colors hover:bg-white/20"
        >
          <X size={16} />
        </button>
      </div>

      {/*
        `stopPropagation` so a click INSIDE the media does not close the
        overlay — otherwise pressing play on a video dismisses it, which is the
        single most annoying way to get a lightbox wrong.
      */}
      <div
        className="flex w-full max-w-5xl flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={title} className="max-h-full max-w-full object-contain" />
        )}
        {mode === 'video' && (
          <video src={src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        )}
        {mode === 'audio' && <audio src={src} controls autoPlay className="w-full max-w-xl" />}
        {mode === 'iframe' && (
          <iframe
            src={src}
            title={title}
            allow="fullscreen"
            referrerPolicy="no-referrer"
            className="h-full max-h-[80vh] w-full rounded-lg border-0 bg-white"
          />
        )}
      </div>

      <p className="mt-3 text-[11px] text-white/50">Press Esc or click outside to close</p>
    </div>,
    document.body
  )
}
