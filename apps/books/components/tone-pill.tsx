// `<TonePill>` — a state whose colour this APP owns, unlike `<VocabChip>`.
//
// ===========================================================================
// THE DIFFERENCE FROM `<VocabChip>` IS THE WHOLE REASON THIS FILE EXISTS
// ===========================================================================
// `<VocabChip>` gets its colour from the SERVER, because recognition states,
// evidence tiers and source statuses are vocabularies `/api/meta` serves with a
// `color` on each term — so a value added server-side renders correctly with no
// frontend release, and a `switch` here would be a second copy nobody keeps in
// sync.
//
// The three things this pill draws — a compliance rule's review state, its
// severity, and an entry's Devil's-Advocate verdict — are **not in any served
// vocabulary.** `/api/meta` carries seven and none of them is these. They are
// `varchar` columns with no colour attached, so somebody has to choose, and the
// choice is a claim about what a reader should feel. That claim is written down
// where a test can read it — `lib/compliance.ts` and `lib/verdict.ts` — and this
// component only paints what those functions decided.
//
// **So do not add a `switch` here.** If a state needs a tone, it gets one in the
// module that already explains why, and this file stays four class strings.
//
// ── AND `--primary` IS NOT ONE OF THEM ───────────────────────────────────
// Amber means "you are in b/books" (D-B). A state pill wearing it would collide
// with the chrome the reader uses to know which app they are in — the same rule
// the management view's charts follow.

import type { Tone } from '@/lib/compliance'

const TONES: Record<Tone, string> = {
  // The resting state. Deliberately the quietest thing on the screen: nineteen
  // draft rules is what this product looks like when nothing is wrong.
  calm: 'border-border bg-secondary text-muted-foreground',
  good: 'border-primary/40 bg-primary/10 text-foreground',
  warn: 'border-foreground/25 bg-foreground/[0.06] text-foreground',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function TonePill({
  tone,
  children,
  /** The raw wire value, for an agent reading the DOM. Never the label. */
  value,
  title,
}: {
  tone: Tone
  children: React.ReactNode
  value: string
  title?: string
}) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ' +
        TONES[tone]
      }
      data-value={value}
      title={title}
    >
      {children}
    </span>
  )
}
