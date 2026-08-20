'use client'

// A tax figure and the article it rests on — never one without the other.
//
// ===========================================================================
// "A TAX ESTIMATE WITHOUT THE ARTICLE IT RESTS ON IS A NUMBER SOMEBODY MIGHT
// FILE"
// ===========================================================================
// That is the phase brief's sentence and it is the whole contract of this
// component: the citation is a REQUIRED prop, not an optional one, so a figure
// cannot be added to the taxes screen without somebody deciding where its
// authority comes from. `null` is a legal value and it renders a visible refusal
// rather than a blank — a figure whose parameter block carries no citation is a
// figure the reader must be told is uncited.
//
// The citation itself comes from `books.tax_params.params`, per book, and is
// never spelled in this app: `lib/tax.ts` reads it, and a book in another canton
// arrives with its own with no frontend release (decision D-D — nothing may
// assume a Swiss canton, let alone VD/Renens).
//
// ── `confirmed` IS A SEPARATE FACT AND IT IS NOT A STYLE ─────────────────
// It says whether a fiduciary has settled the PARAMETER. The seeded capital-tax
// block is `confirmed: false` with an open question in the same block. A figure
// rendered without that flag has turned an open question into a number somebody
// might file, so the flag is rendered as words beside the figure and never as a
// colour a reader has to know how to read.

'use client'

import { Money } from './money'
import { useT } from '@/lib/i18n'

export function CitedFigure({
  label,
  value,
  citation,
  confirmed,
  note,
  openQuestion,
  /** A working shown under the figure — the arithmetic, not just the answer. */
  children,
}: {
  label: string
  /** The wire string. Money, so `<Money>` — unlike an analysis's filed text. */
  value: string
  /** From the parameter block. `null` is rendered, loudly. */
  citation: string | null
  confirmed: boolean
  note?: string | null
  openQuestion?: string | null
  children?: React.ReactNode
}) {
  const t = useT()
  return (
    <div className="border-b border-border py-3" data-cited-figure={label}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] text-foreground">{label}</span>
        <Money value={value} className="text-[14px] font-medium" />
      </div>

      {children && <div className="mt-1 text-[12px] text-muted-foreground">{children}</div>}

      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {citation ? (
          <span className="text-foreground">{citation}</span>
        ) : (
          // Not an em dash and not silence. An uncited figure is the exact thing
          // this component exists to make impossible to ship quietly.
          <span className="text-destructive">{t('cited.noArticle')}</span>
        )}
        {note && <> · {note}</>}
      </p>

      {/* ── UNCONFIRMED IS STATED WHERE THE FIGURE IS, NOT IN A FOOTNOTE ──
          A caveat the reader has to scroll to is a caveat that did not happen. */}
      {!confirmed && (
        <p className="mt-1 text-[11.5px] text-foreground">
          <span className="font-medium">{t('cited.notConfirmed')}</span>{' '}
          {/* The server's own open question when it has one; ours otherwise.
              `openQuestion` comes off the book's tax parameters and is a filed
              sentence — not chrome, and not translated. */}
          {openQuestion ?? t('cited.notConfirmedDefault')}
        </p>
      )}
    </div>
  )
}
