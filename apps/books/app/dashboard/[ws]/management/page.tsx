'use client'

// Management view — compta analytique. Phase 4B, the only screen in this
// product with charts.
//
// ===========================================================================
// NOTHING ON THIS PAGE IS STATUTORY, AND IT SAYS SO FIRST
// ===========================================================================
// The balance sheet and the income statement are art. 959a and 959b documents:
// their line list is fixed by law and a filing reproduces them. This is not
// one. It is simple arithmetic over the same posted data, arranged the way a
// person running a company wants to read it, and the disclaimer at the top is
// the mockup's own — kept, because a screen that looks like the statutory ones
// and is not is the easiest thing on this site to misread.
//
// ── RING 3: DERIVED AT REQUEST TIME, STORED NOWHERE ───────────────────────
// `GET …/analytique` recomputes on every call and accepts no writes, ever.
// **No figure on this page may be cached as a figure.** What the query cache
// holds is a RESPONSE, invalidated at the app root by any write
// (`booksCacheFilter`) — see `useAnalytique`'s header.
//
// ===========================================================================
// WHAT IS DELIBERATELY NOT HERE, AND WHERE IT WENT
// ===========================================================================
// The mockup's screen has six panels. Three are built:
//
//   Run metrics       → `<RunFigures>`, as three exact TOTALS rather than the
//                       mockup's five per-month averages. Its header carries
//                       the reason: an average is a division of money, and
//                       cash and runway are not on this route at all.
//   Monthly flows     → `<FlowsChart>`
//   Cost breakdown    → `<CostBreakdown>`
//
// And three are not:
//
//   Runway attribution  needs the Analyses journal (`…/analyses`) and a cash
//                       figure. Both are phase 5; the journal has its own
//                       screen there and this panel restates it.
//   Taxes incurred      needs `GET …/tax-snapshot`, which is the Taxes screen's
//                       route and is phase 5. Building half of it here would
//                       put two derivations of the same figure in the tree.
//   Raw / agent surface DROPPED, permanently. Andrea's answer of 2026-08-18:
//                       the «état brut» screen is not built, agents use `bk`.
//                       `booksFrontend/DECISIONS.md` records it.
//
// ── THE BOOK SWITCHER WORKS HERE AND THE JOURNAL DECIDES NOTHING ABOUT THE
//    READ ──────────────────────────────────────────────────────────────────
// Unlike the ledger, this is ONE route for both regimes: a simplified book's
// breakdown groups its dépenses by the category each movement carries, and its
// flows read the directions. So there is no `journal` branch around the fetch.
// The journal still travels INTO `<CostBreakdown>`, because it decides whether
// a line's #number is an address — see that file's header.

import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useAnalytique, useAnalytiqueCategories } from '@/lib/hooks'
import { breakdownTotal, flowTotals } from '@/lib/analytique'
import { en } from '@/lib/label'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'
import { NoExerciceNotice, isNoExerciceRefusal } from '@/components/no-exercice-notice'
import { RunFigures } from '@/components/run-figures'
import { FlowsChart } from '@/components/flows-chart'
import { CostBreakdown } from '@/components/cost-breakdown'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const analytique = useAnalytique(params.ws, scope)
  const config = useAnalytiqueCategories(params.ws, scope.entity)

  const data = analytique.data
  const totals = data ? flowTotals(data.monthly_flows) : null
  const categoryTotal = data ? breakdownTotal(data.categories) : null
  // Retired buckets are filtered out of the breakdown by the server, so this
  // is the only place a reader can learn that an account has stopped being
  // counted. Nothing else in the app says it.
  const retired = (config.data ?? []).filter((c) => c.retired)

  return (
    <ScreenFrame title="Management view">
      <StatementHeading
        fr="Compta analytique"
        en="Management view"
        // No article. This document is not fixed by the Code des obligations
        // and citing one would be a false claim about what the reader is
        // looking at — the same rule the two statutory screens follow in
        // reverse, where the citation is dropped once the statement refuses.
        bookName={scope.record?.name}
        exercice={scope.exercice}
      />

      <div
        className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-secondary px-3.5 py-2.5"
        role="note"
      >
        <div className="min-w-0 text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">
            Management accounting — informational, not statutory.
          </span>{' '}
          Arithmetic over this book&apos;s own movements. Nothing on this page is filed and
          nothing on it is stored: every figure is derived when the page is opened.
          {/* ── THE EXCLUSIONS ARE PER REGIME AND THE WRONG ONE IS A FALSE
              STATEMENT ────────────────────────────────────────────────────
              A grand livre has staged entries and they are excluded here, the
              same way they are from the balance sheet. `books.ri_entry` has no
              `status` column at all — there is nothing to exclude and saying
              so would describe a distinction that book does not have. What a
              simplified book DOES exclude is a `neutral` movement: a transfer
              between the owner's own accounts is logged and counts in neither
              direction (`monthlyFlowsRi`, `costBreakdownRi`), which is a real
              omission from these totals and is therefore disclosed. */}
          {scope.journal === 'grand_livre' && (
            <>
              {' '}
              Staged entries are excluded everywhere on this page, exactly as they are from the
              balance sheet and the income statement, so an unexplained backlog is invisible
              here.
            </>
          )}
          {scope.journal === 'recettes_depenses' && (
            <>
              {' '}
              A transfer between your own accounts is logged in the book and counts in neither
              direction, so it is in none of these figures.
            </>
          )}
        </div>
      </div>

      {analytique.isLoading && <Loading rows={8} label="Loading the management view" />}

      {/* A book with no fiscal year is not a failure. Same treatment as the
          statutory screens, and the same code — `resolveScope` raises
          `bad_scope` here identically. */}
      {isNoExerciceRefusal(analytique.error) && (
        <NoExerciceNotice
          error={analytique.error}
          statement="management view"
          bookName={scope.record?.name}
        />
      )}

      {analytique.error && !isNoExerciceRefusal(analytique.error) && (
        <ErrorState error={analytique.error} title="The management view could not be derived" />
      )}

      {data && totals && categoryTotal !== null && (
        <div className="space-y-7">
          <RunFigures totals={totals} journal={scope.journal} />

          <section>
            <h2 className="mb-1 text-sm font-medium text-foreground">
              Revenue against charges, per month
            </h2>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {scope.journal === 'grand_livre' ? 'Posted écritures only, and only' : 'Only'} the
              months that carry a movement. Months with nothing in them are absent from the
              series rather than drawn at zero — this is what the books hold, not a
              twelve-month shape with holes filled in.
            </p>
            <FlowsChart flows={data.monthly_flows} />
          </section>

          <section>
            <h2 className="mb-1 text-sm font-medium text-foreground">
              Where the money goes — charges by category
            </h2>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {data.categories.length > 0 && data.categories[0].accounts === null ? (
                <>
                  This book keeps recettes-dépenses, so a bucket is the category carried by each
                  dépense rather than a mapping from ledger accounts. An uncategorised movement
                  lands in its own named bucket instead of vanishing — the total is still the
                  total.
                </>
              ) : (
                <>
                  An inspectable mapping from ledger accounts to a cost bucket, and never a
                  statutory line. A bucket with no postings this year is still on the screen: the
                  set of buckets is configuration, so an absent one would say the bucket does not
                  exist.
                </>
              )}
            </p>
            <CostBreakdown
              categories={data.categories}
              total={categoryTotal}
              base={base}
              scope={scope}
              journal={scope.journal}
            />

            {/* The two totals are different questions and the page shows both
                rather than picking one. The breakdown counts the accounts a
                bucket claims; the monthly flows count every CR account that is
                not class 3. An unmapped charge account is in the second and
                not in the first, and the gap is the reader's to close. */}
            {categoryTotal !== totals.charges && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  This total is smaller than the charges above.
                </span>{' '}
                The breakdown counts only the accounts a category claims; the monthly series
                counts every charge account in the book. The difference is charges sitting in no
                active category.
              </p>
            )}

            {retired.length > 0 && (
              <div className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {retired.length} retired {retired.length === 1 ? 'category' : 'categories'}.
                </span>{' '}
                A retired bucket is not deleted — a past analysis may cite a breakdown that used
                it — and its accounts are counted in no bar above:{' '}
                {retired.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && ', '}
                    <span className="text-foreground">{en(c.label) || c.key}</span>{' '}
                    <span className="font-mono text-[11px]">{c.accounts.join(' ')}</span>
                  </span>
                ))}
                .
              </div>
            )}
          </section>

          <p className="border-t border-border pt-3 text-[12px] text-muted-foreground">
            Runway, the recorded analyses and the tax position are not on this page. The first two
            arrive with the Analyses screen; the tax snapshot has its own screen and its own
            derivation, and a second copy of it here would be the one that went stale.
          </p>
        </div>
      )}
    </ScreenFrame>
  )
}
