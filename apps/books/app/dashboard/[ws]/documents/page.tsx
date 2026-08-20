'use client'

// Pièces justificatives — the receipts inbox.
//
// ===========================================================================
// THIS IS THE MOCKUP'S `app-pieces.html`, AT THE NAV'S OWN PATH
// ===========================================================================
// The phase-3 plan calls this screen `/dashboard/{ws}/pieces`. The nav has had
// a `paperclip` item at `/documents` labelled "Supporting documents" since phase
// 0, sitting THIRD on purpose — above the general ledger, because every entry
// legally needs its document (art. 958f CO) and burying the inbox says the
// opposite.
//
// Building at `/pieces` would have left that item pointing at `<NotBuiltYet>`
// and put the real screen at an address nothing links to. So the inbox lands
// here, on the item that was always meant for it, and the plan's path is the
// thing that moves. Recorded in the report, not decided in silence.
//
// ── IT IS NOT SCOPED TO A BOOK, AND `lib/nav.ts` NOW SAYS SO ─────────────
// `books.piece_inbox.entity_id` is NULLABLE — a scanned receipt does not always
// say whose it is, and deciding that is one of the judgments this screen exists
// for. A book filter would hide exactly the documents that need attributing.
//
// So the item is `scoped: false` and the switcher is hidden, rather than shown
// over a list it does not change. That is `lib/nav.ts`'s own rule: a control
// that appears to do nothing is worse than an absent one, because the reader
// assumes they used it wrong.
//
// ── THE ONE WRITE ────────────────────────────────────────────────────────
// Attaching a pièce to an entry is the FIFTH write in this app, and the count
// moved from four to five in the same change that added it. The reasoning is in
// `lib/mutations.ts`'s header and the claim is in
// `apps/books/docs/frontend.md` §5; DECISIONS.md D-G is the question it answers.
// It changes no balance: it writes the entry's document reference, checksum and
// capture date, and deliberately not its evidence tier.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
//   an upload control     documents are Drive references, never uploads. There
//                         is no file picker in this product and there is not
//                         meant to be one. `pieces/ingest` is the robot door: an
//                         external worker holds a token and posts to it.
//   "entries without a
//    document"            the mockup's third section. It is phase-1 data
//                         (`GET …/entries`, per book) on a phase-3 screen, and
//                         half-building it would put a book-scoped table under a
//                         heading that is not. Raised in the report.

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { usePieces } from '@/lib/hooks'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { PiecesInbox } from '@/components/pieces-inbox'
import { useScope } from '@/lib/scope'
import { useT } from '@/lib/i18n'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const search = useSearchParams()
  const base = `/dashboard/${params.ws}`

  // The whole inbox. See the header: filtering by book hides the documents that
  // have none, which are the ones a person is here to attribute.
  const pieces = usePieces(params.ws)
  const t = useT()

  // `?piece=5` — where a manifest row links in. A #number that is not in the
  // list simply opens nothing, which is the right behaviour for a bookmark that
  // has gone stale.
  const highlight = useMemo(() => {
    const raw = search?.get('piece')
    if (!raw) return null
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [search])

  const rows = pieces.data ?? []
  /**
   * How many documents are waiting on a person.
   *
   * `needs_review` OR not yet matched. Deliberately NOT `rows.length`: a matched
   * pièce is still in the inbox and still worth reading, and a count that never
   * shrinks teaches the reader to ignore it.
   */
  const toHandle = rows.filter((p) => p.needs_review || p.matched_entry === null).length

  return (
    <ScreenFrame title={t('docs.uiName')}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          {t('docs.uiName')}
          {t('docs.legalName') !== t('docs.uiName') && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t('docs.legalName')}
            </span>
          )}
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">{t('docs.lead')}</p>
        <p className="mt-1.5 max-w-2xl text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">{t('docs.noBalanceLead')}</span>{' '}
          {t('docs.noBalanceBody')}
        </p>
        {/* ── THE WRITE THAT WAS WITHHELD, AND IS NOT ANY MORE ────────────────
            This screen carried a paragraph telling the reader that attaching a
            document was switched off, and that `bk books piece match` "has the
            same gap, so it is not a way round". Both sentences were true when
            written on 2026-08-18 and **both were false by the end of that day**:
            the backend landed the entity filter, the control went on, and the copy
            did not follow. (The flag itself is gone since 2026-08-19 — it had
            been permanently true, and a constant guarding nothing is not a
            record of anything.)

            So for a day this page told a reader a working control did not work,
            standing directly above the working control. Found by the phase-4A
            review, which checked the sentence against the route rather than
            against the flag — the route refuses a cross-book attach and accepts
            a same-book one, both verified.

            The lesson is narrow and worth keeping: **prose that describes a
            defect is code that goes stale when the defect is fixed**, and
            nothing compiles it. When a flag flips, grep for what the flag was
            explained by. */}
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">
          {t('docs.inbox')}
          {pieces.data && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {t('docs.counts', { toHandle, total: rows.length })}
            </span>
          )}
        </h2>
      </div>

      {pieces.isLoading && <Loading rows={4} label={t('docs.loading')} />}
      {pieces.error && <ErrorState error={pieces.error} title={t('docs.failed')} />}
      {pieces.data && (
        <PiecesInbox
          ws={params.ws}
          pieces={rows}
          entities={scope.entities}
          base={base}
          scope={scope}
          highlight={highlight}
        />
      )}

      <section className="mt-6 rounded-lg border border-dashed border-border px-4 py-3.5">
        <h2 className="text-sm font-medium text-foreground">{t('docs.howTitle')}</h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          {t('docs.how1a')}{' '}
          <span className="font-medium text-foreground">{t('docs.how1b')}</span>
          {t('docs.how1c')}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t('docs.how2')}</p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t('docs.how3')}</p>
      </section>
    </ScreenFrame>
  )
}
