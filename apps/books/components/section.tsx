// The page skeleton: the grid a screen is laid out on, the card a section is
// drawn in, and the three surfaces that exist in this app.
//
// ===========================================================================
// WHY THESE ARE COMPONENTS AND NOT A PARAGRAPH IN A DOC
// ===========================================================================
// Before 2026-08-21 every one of the thirteen screens wrote its own heading, its
// own section wrapper and its own max-width. The result was three heading sizes,
// four label treatments and a `max-w-4xl` column with 500px of empty ground
// beside it on any real monitor — a product whose entire job is comparing
// figures, laid out so that two figures can never be beside each other.
//
// A convention that lives in prose is re-decided by whoever is writing the next
// screen. These are the same convention, in a form that cannot be re-decided by
// accident.
//
// ── THE THREE SURFACES, AND THERE IS NO FOURTH ─────────────────────────────
//
//   ground     `--background`  the page. Nothing sits AT this level
//   raised     `--card` + hairline. Every section. THE DEFAULT
//   marked     raised + a 3px accent rule. The ONE thing on the page that is
//              different: an open write form, a refusal, a blocked verdict
//
// `--muted` is a RECESS, not a fourth surface — table heads, inline code, raw
// bank labels, read-only inspector rows. A recess goes below the card it is in;
// it never floats above the page.
//
// **A screen with two `marked` sections has one too many.** The whole value of
// the level is that it is rare, and a page that marks three things has marked
// nothing. There is no guard for this — it is a review question, and it is the
// first thing to look at when a redesigned screen stops feeling scannable.

import type { ReactNode } from 'react'

/**
 * The page grid.
 *
 * Twelve columns from `lg` up, one column below it. A screen names how wide each
 * of its sections is and the collapse is handled once.
 *
 * `max-w-[1400px]` rather than unbounded: a table of money set 2400px wide puts
 * the label and its figure so far apart that the eye loses the row, which is the
 * opposite failure from the one this replaces and just as bad.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8">{children}</div>
}

/**
 * A row of sections.
 *
 * `gap-4` on both axes. Sections declare their own span; anything that does not
 * fit wraps, so a `span` set wrongly produces a short row rather than an
 * overflow.
 */
export function Grid({ children, className = '' }: { children: ReactNode; className?: string }) {
  // ── `items-start`, SO A SHORT SECTION STAYS SHORT ──────────────────────
  // Grid items stretch to the row's height by default. On the analyse detail
  // that drew a three-line answer as a 600px card with 500px of empty white
  // under it, because the column beside it held two tables — which reads as
  // content that failed to load rather than as content that is short.
  return (
    <div className={'grid grid-cols-1 items-start gap-4 lg:grid-cols-12 ' + className}>
      {children}
    </div>
  )
}

/**
 * How many of the twelve columns a section takes, from `lg` up.
 *
 * An enumerated map rather than a template string, because Tailwind generates
 * classes by SCANNING THE SOURCE: `lg:col-span-${n}` produces no CSS at all and
 * fails silently — the section renders at its natural width and nothing says
 * why. Same mechanism as the `@source` directive at the top of `globals.css`,
 * one layer up.
 */
const SPAN: Record<number, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  12: 'lg:col-span-12',
}

export type SectionTone = 'default' | 'attention' | 'problem'

const TONE_RULE: Record<SectionTone, string> = {
  default: '',
  // The amber is the app's own accent used as a MARK — see D-L and the
  // `--sidebar` note in globals.css. It means "look here", never "error".
  attention: 'border-l-[3px] border-l-primary',
  problem: 'border-l-[3px] border-l-destructive',
}

/**
 * A section of a page: a raised card with a small-caps label, optional controls
 * on the right of that label, the body, and an optional footnote under it.
 *
 * ── THE FOOTNOTE IS NOT DECORATION, AND IT IS WHY THIS PROP EXISTS ──────────
 * This product's screens carry a great deal of legal explanation — why a rollup
 * is not a consolidation, why a simplified book has no bilan, what a figure's
 * basis is. Today most of it is a paragraph of body text sitting above or below
 * a table, at the same weight as the data, which is how a reader ends up
 * skipping both.
 *
 * As a footnote it keeps its full wording and stops competing with the figures.
 * **The sentences are never shortened to fit here** — they are the reason a
 * reader is entitled to trust the number above them.
 */
export function Section({
  label,
  tools,
  note,
  tone = 'default',
  span = 12,
  className = '',
  bodyClassName = '',
  children,
}: {
  /** Already translated. A `BooksKey` resolved by the caller, never a literal. */
  label?: ReactNode
  /** Search, filters, a link — sits opposite the label. */
  tools?: ReactNode
  /** The italic explanation under the body. Kept verbatim; never trimmed. */
  note?: ReactNode
  tone?: SectionTone
  span?: keyof typeof SPAN | number
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={
        'rounded-lg border border-border bg-card ' +
        (SPAN[span as number] ?? SPAN[12]) +
        ' ' +
        TONE_RULE[tone] +
        ' ' +
        className
      }
    >
      {(label || tools) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          {label ? (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </h2>
          ) : (
            <span />
          )}
          {tools ? <div className="flex flex-wrap items-center gap-2">{tools}</div> : null}
        </div>
      )}
      <div className={bodyClassName || 'px-4 py-3.5'}>{children}</div>
      {note ? (
        // `max-w-[95ch]`, and it is not cosmetic: this section is up to 1400px
        // wide and these footnotes are whole legal sentences. A 200-character
        // line is one the eye loses on the way back to the left margin, so the
        // note that explains the figures is the one thing on the page nobody
        // reads. The TABLE wants the full width; the prose about it does not.
        <div className="border-t border-border px-4 py-2.5 text-[12px] italic leading-relaxed text-muted-foreground">
          <div className="max-w-[95ch]">{note}</div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * A raised block that is NOT a section — a notice, a refusal, an open form.
 *
 * Same surface vocabulary, no label row. `tone` is what makes it elevation 2;
 * a `default` `<Surface>` is just a bounded box.
 */
export function Surface({
  tone = 'default',
  className = '',
  children,
  role,
}: {
  tone?: SectionTone
  className?: string
  children: ReactNode
  role?: string
}) {
  return (
    <div
      role={role}
      className={
        'rounded-lg border border-border bg-card px-4 py-3.5 ' +
        TONE_RULE[tone] +
        (tone !== 'default' ? ' shadow-sm ' : ' ') +
        className
      }
    >
      {children}
    </div>
  )
}
