'use client'

// Income statement — art. 959b CO, par nature, with its amounts.
//
// Ten lines, in the article's order, each carrying a `sign` (+1 produit, −1
// charge) and an `accounts` array. That array is the drill-down: it turns
// "Autres charges d'exploitation, CHF 3'063.60" into the three accounts behind
// it and a link into the ledger filtered by each. `<StatementTable>` renders
// them through `<AccountRef>` — this page's job is to hand them over unchanged.
//
// ── LINES 7 TO 9 ARE NEVER MERGED ─────────────────────────────────────────
// `financier`, `hors_exploitation`, `exceptionnel` are a hard legal requirement
// and collapsing them into one "other" bucket is the commonest way a small
// company's compte de résultat stops being compliant while still adding up
// (`lib/statements.ts`). They are three lines here, all three at zero on the
// seeded books, and all three rendered.
//
// ── THE AMOUNTS ARE ALL POSITIVE, AND THAT IS THE STATEMENT'S CONVENTION ──
// `crFor` negates a produit's movement so a revenue account's credit balance
// prints positive, and leaves a charge as its debit movement. So the column is
// magnitudes and the `sign` says which way each one pulls; only `resultat` at
// the bottom is signed. This is why the total is not the sum of the column, and
// why nothing here adds the column up — the server did, in centimes.
//
// The RI refusal is the same shape as the balance sheet's, with a different
// code (`no_cr_for_simplified`). Same treatment: an explanation, not a red box.
//
// ===========================================================================
// `?view=month` — THE MONTHLY GRID, TICKET #64
// ===========================================================================
// One statement, two ways of reading it. The toggle is in the URL, like the book
// and the year and the ledger's filters, so a monthly view is a shareable
// address and Back undoes the switch (`lib/scope.ts` argues this at length).
//
// **There is still only ONE request.** `useCompteResultat` always asks
// `?by=month`, so the annual body and the twelve months arrive together and the
// toggle chooses which of them to draw. The total under the grid is literally
// the same object the annual view showed a second earlier. The route's own
// header is the reason: *"making it ask twice for two views of one statement
// would invite them to be read from different moments."*
//
// ── THE TOGGLE IS NOT OFFERED WHEN THERE IS NO STATEMENT ──────────────────
// A simplified book has no compte de résultat at all, so it has no monthly one:
// the route raises `no_cr_for_simplified` on the REGIME, above the breakdown,
// and this screen renders `<SimplifiedBookNotice>` instead. Every control here
// hangs off `cr.data`, which that path never produces — the same shape `/bilan`
// uses and the same shape the management screen uses, rather than a third
// spelling with its own `if (simplified)`. A book whose exercice is not open yet
// is the same story through `<NoExerciceNotice>`.
//
// And `months` itself is gated on separately, because the ROUTE makes it
// optional (`by=month` or nothing). If a deployment ever answers without it, the
// annual statement still renders and the toggle is simply absent — a missing
// control, never twelve empty columns.

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useCompteResultat, isSimplifiedRefusal } from '@/lib/hooks'
import { crGroups } from '@/lib/statement-view'
import { StatementTable } from '@/components/statement-table'
import { MonthlyCrGrid } from '@/components/monthly-cr-grid'
import { ScreenFrame } from '@/components/screen-frame'
import { SimplifiedBookNotice } from '@/components/simplified-notice'
import { NoExerciceNotice, isNoExerciceRefusal } from '@/components/no-exercice-notice'
import { ErrorState, Loading } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'
import { PostedOnlyNote } from '@/components/posted-only-note'

/** The URL parameter that chooses the reading. One spelling, used three times. */
const VIEW_PARAM = 'view'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const cr = useCompteResultat(params.ws, scope)

  // `=== 'month'`, so any other value — `?view=quarter`, `?view=`, a typo — is
  // the annual statement rather than an empty grid. The annual view is the
  // document; it is the right thing to fall back to.
  const monthly = search?.get(VIEW_PARAM) === 'month'
  const months = cr.data?.months

  /**
   * Switch reading, preserving every other parameter.
   *
   * `?entity=` and `?exercice=` MUST survive it — the same rule `lib/scope.ts`
   * applies in the other direction — or toggling to the monthly view silently
   * moves the reader to the default book. `replace`, not `push`: flipping the
   * view four times should not need four presses of Back to leave the page.
   */
  function setView(next: 'year' | 'month') {
    const q = new URLSearchParams(search?.toString() ?? '')
    if (next === 'month') q.set(VIEW_PARAM, 'month')
    else q.delete(VIEW_PARAM)
    const qs = q.toString()
    router.replace(`${base}/income-statement${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  return (
    <ScreenFrame title="Income statement">
      <StatementHeading
        fr="Compte de résultat"
        en="Income statement"
        // Not cited when the book has no such statement — see the balance
        // sheet, same reason. F4.
        // Cited only when the document actually exists. Heading a page
        // "art. 959b CO, par nature" above an explanation that this book has no such
        // statement contradicts itself in two lines — true for a simplified
        // book (F4) and equally for one whose exercice is not open yet.
        article={cr.data ? 'art. 959b CO, par nature' : undefined}
        bookName={scope.record?.name}
        exercice={scope.exercice}
        exerciceStatus={scope.exerciceStatus}
      />

      {/* F1: the statements exclude staged entries and said so nowhere, while
          their own drill-down shows them. Disclosed here rather than implied.

          Gated on the statement EXISTING. Rendered unconditionally it announced
          "every posting below is counted" above the RI refusal, which has no
          postings and no statement — a confident wrong sentence, of exactly the
          kind this note was added to remove. Caught in the browser, not by a
          test: nothing here can fail. */}
      {cr.data && <PostedOnlyNote ws={params.ws} scope={scope} journal={scope.journal} />}

      {cr.isLoading && <Loading rows={8} label="Loading the income statement" />}

      {isSimplifiedRefusal(cr.error) && (
        <SimplifiedBookNotice
          error={cr.error}
          statement="income statement"
          because="there are no expense and revenue accounts to arrange into the art. 959b lines"
          base={base}
          scope={scope}
          bookName={scope.record?.name}
        />
      )}

      {/* Also not a failure: a book whose exercice has not been opened yet.
          Same rule as the refusal above — nothing broke, so nothing is red. */}
      {isNoExerciceRefusal(cr.error) && (
        <NoExerciceNotice
          error={cr.error}
          statement="income statement"
          bookName={scope.record?.name}
        />
      )}

      {cr.error && !isSimplifiedRefusal(cr.error) && !isNoExerciceRefusal(cr.error) && (
        <ErrorState error={cr.error} title="The income statement could not be derived" />
      )}

      {cr.data && (
        <>
          {/* The toggle. Only when the payload actually carries months — see the
              header of this file. Two buttons rather than a `<select>`: there
              are two readings and both are worth naming on screen. */}
          {months && (
            <div className="mb-3 flex items-center gap-1" role="group" aria-label="Reading">
              <ViewButton active={!monthly} onClick={() => setView('year')}>
                Year
              </ViewButton>
              <ViewButton active={monthly} onClick={() => setView('month')}>
                By month
              </ViewButton>
            </div>
          )}

          {monthly && months ? (
            <MonthlyCrGrid cr={{ ...cr.data, months }} meta={scope.meta} />
          ) : (
            <>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Each line lists the accounts feeding it. Follow one to see its postings in the
                general ledger. Amounts are magnitudes — the sign of each line is fixed by the
                article, and only the result at the foot is signed.
              </p>

              <StatementTable
                groups={crGroups(cr.data, scope.meta)}
                base={base}
                scope={scope}
                footer={{ label: "Résultat de l'exercice", amount: cr.data.resultat }}
              />
            </>
          )}
        </>
      )}
    </ScreenFrame>
  )
}

/**
 * One of the two readings.
 *
 * `aria-pressed` rather than a `role="tab"` pair: these do not switch panels
 * inside one document, they change which document is on screen and the URL says
 * so. A toggle button is what that is.
 */
function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-md border px-2.5 py-1 text-[12px] transition-colors ' +
        (active
          ? 'border-border bg-accent font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}
