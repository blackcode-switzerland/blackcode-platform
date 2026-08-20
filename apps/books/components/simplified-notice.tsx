'use client'

// `<SimplifiedBookNotice>` — the RI's balance sheet and income statement, refused.
//
// ===========================================================================
// NOTHING FAILED. DO NOT DRAW THIS AS AN ERROR.
// ===========================================================================
// A sole proprietorship under the turnover threshold keeps **simplified books**
// (art. 957 al. 2 CO): recettes/dépenses and a net-worth statement, and no
// double-entry bookkeeping at all. It therefore has no bilan and no compte de
// résultat — not "not yet", not "missing data", but legally none, ever.
//
// `GET …/bilan` says so with a **400** and the code `no_bilan_for_simplified`,
// and `…/compte-resultat` with `no_cr_for_simplified`. A 400 is how HTTP says
// "you asked for something that does not exist", and it arrives at the query
// hook as a thrown `ApiRequestError` — which is why the naive rendering is
// `<ErrorState>`, a red box with an alert triangle, for a book that is entirely
// in order.
//
// So this is deliberately the OPPOSITE treatment: neutral, explanatory, and it
// ends in the place the reader should actually go. `phase-1/README.md` screen 1:
// *"A red error box here would be wrong: nothing failed, that book legally has
// no bilan."*
//
// ── THE SUGGESTION IS THE SERVER'S, NOT OURS ──────────────────────────────
// The route ships a `suggestion` and `lib/client.ts` carries it through. It is
// written for an agent (`use \`bk books overview\`…`), so it is shown as the
// machine-readable recovery beneath a human one rather than instead of it — the
// same fact addressed to the two readers this product has.

import Link from 'next/link'
import { ArrowRight, Scale } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { scopedHref } from '@/lib/nav'
import type { ApiRequestError } from '@/lib/client'

export function SimplifiedBookNotice({
  /** The refusal itself. Its `message` names the book and cites the article. */
  error,
  /** What was asked for, ALREADY TRANSLATED by the caller — see `because`. */
  statement,
  /**
   * Why THAT statement in particular does not exist for a simplified book.
   *
   * ── IT IS A PROP BECAUSE IT WAS HARDCODED AND WENT WRONG ──────────────────
   * This paragraph read "…no balances to arrange into an art. 959a balance
   * sheet" for both callers, so the income statement explained its own absence
   * by citing the balance sheet's article. Found by opening the page, not by
   * review: the component was shared correctly and the shared copy was only
   * true of one of the two.
   *
   * Passed already translated (`t('statements.simplifiedBecauseBilan')`) rather
   * than as a key, so the caller keeps naming its own document — which is the
   * whole point of the prop.
   */
  because,
  /** `/dashboard/{ws}` — for the link to patrimoine. */
  base,
  scope,
  /** The book's display name. From the scope, because the payload has none. */
  bookName,
}: {
  error: ApiRequestError
  statement: string
  because: string
  base: string
  scope: { entity: string | null; exercice: number | null }
  bookName: string | undefined
}) {
  const t = useT()
  return (
    <section className="rounded-lg border border-border bg-secondary px-4 py-4" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <Scale size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {t('statements.simplifiedTitle', {
              book: bookName ?? t('noExercice.thisBook'),
              statement,
            })}
          </h2>
          {/* The server's own sentence. It names the book and the article, so
              repeating it in our words would be a second wording of one legal
              fact — and the one that goes stale would be ours. */}
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('statements.simplifiedBody', { because })}
          </p>

          <Link
            href={scopedHref(base, '/patrimoine', scope)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline"
          >
            {t('statements.openPatrimoine')}
            <ArrowRight size={14} />
          </Link>

          {error.suggestion && (
            <p className="mt-3 border-t border-border pt-2 text-[12px] text-muted-foreground">
              {t('statements.fromTerminal', { suggestion: error.suggestion })}
            </p>
          )}
          {/* `no_bilan_for_simplified` used to print here. It is the machine
              code and the reader is not the machine: the three sentences above
              already say it in English, and a `bad_scope`-shaped string in
              human copy reads as something having gone wrong. It stays in the
              response for an agent and for the console; the page drops it. F5. */}
        </div>
      </div>
    </section>
  )
}
