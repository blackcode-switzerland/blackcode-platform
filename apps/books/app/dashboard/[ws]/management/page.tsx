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
import { useAnalytique, useAnalytiqueCategories, useBilan } from '@/lib/hooks'
import { breakdownTotal, flowTotals } from '@/lib/analytique'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import { ScreenFrame } from '@/components/screen-frame'
import { Grid, Section, Surface } from '@/components/section'
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
  /**
   * The bilan, read for ONE line: `pos === 'tresorerie'`.
   *
   * ── A SECOND REQUEST, AND WHY IT IS THE RIGHT ONE ────────────────────────
   * `GET …/analytique` serves no cash figure, and the runway block was recorded
   * as blocked on a route change because of it. It is not: the bilan already
   * serves cash for this book and this exercice, so the figure exists and is
   * one fetch away. Asking for a payload the app already caches on the balance
   * sheet costs nothing a route change would not have cost more of.
   *
   * It carries its own refusals and this screen ignores all of them
   * deliberately: a simplified book's bilan 400s (art. 957 al. 2) and
   * `bilan.data` is simply undefined, which `cashFrom` turns into `null` and
   * the runway tile renders as "this book has no bilan". A failure here must
   * never put a red box on the management view — the management view is not
   * about the bilan.
   */
  const bilan = useBilan(params.ws, scope)
  const config = useAnalytiqueCategories(params.ws, scope.entity)
  const t = useT()
  const label = useLabel()

  const data = analytique.data
  const totals = data ? flowTotals(data.monthly_flows) : null
  const categoryTotal = data ? breakdownTotal(data.categories) : null
  // Retired buckets are filtered out of the breakdown by the server, so this
  // is the only place a reader can learn that an account has stopped being
  // counted. Nothing else in the app says it.
  const retired = (config.data ?? []).filter((c) => c.retired)

  return (
    <ScreenFrame title={t('mgmt.uiName')}>
      <StatementHeading
        fr={t('mgmt.legalName')}
        en={t('mgmt.uiName')}
        // No article. This document is not fixed by the Code des obligations
        // and citing one would be a false claim about what the reader is
        // looking at — the same rule the two statutory screens follow in
        // reverse, where the citation is dropped once the statement refuses.
        bookName={scope.record?.name}
        exercice={scope.exercice}
      />

      <Surface role="note" className="mb-4">
        <div className="min-w-0 max-w-[95ch] text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{t('mgmt.noticeLead')}</span>{' '}
          {t('mgmt.noticeBody')}
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
            <> {t('mgmt.noticeStaged')}</>
          )}
          {scope.journal === 'recettes_depenses' && (
            <> {t('mgmt.noticeNeutral')}</>
          )}
        </div>
      </Surface>

      {analytique.isLoading && <Loading rows={8} label={t('mgmt.loading')} />}

      {/* A book with no fiscal year is not a failure. Same treatment as the
          statutory screens, and the same code — `resolveScope` raises
          `bad_scope` here identically. */}
      {isNoExerciceRefusal(analytique.error) && (
        <NoExerciceNotice
          error={analytique.error}
          statement={t('mgmt.uiName').toLowerCase()}
          bookName={scope.record?.name}
        />
      )}

      {analytique.error && !isNoExerciceRefusal(analytique.error) && (
        <ErrorState error={analytique.error} title={t('mgmt.failed')} />
      )}

      {data && totals && categoryTotal !== null && (
        <div>
          <RunFigures totals={totals} journal={scope.journal} bilan={bilan.data} />

          {/* ── THE TWO CHART BLOCKS SIT ON A SURFACE NOW (2026-08-21) ───────
              They were bare `<section>`s with a plain `h2`, on the page ground —
              the only screen in the app whose content was not on a card. Against
              a neutral background a chart with no surface under it reads as
              floating, and the whole view looked unfinished beside the ledger. */}
          <Grid>
          <Section
            span={12}
            label={t('mgmt.flowsTitle')}
            /* Two whole sentences rather than one with its first clause swapped
               in: the difference between them is the SUBJECT of the sentence,
               and French does not put the qualifier where English does. */
            note={
              scope.journal === 'grand_livre'
                ? t('mgmt.flowsLeadPosted')
                : t('mgmt.flowsLeadAll')
            }
          >
            <FlowsChart flows={data.monthly_flows} />
          </Section>

          <Section
            span={12}
            label={t('mgmt.breakdownTitle')}
            note={
              data.categories.length > 0 && data.categories[0].accounts === null
                ? t('mgmt.breakdownLeadRi')
                : t('mgmt.breakdownLeadChart')
            }
          >
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
                <span className="font-medium text-foreground">{t('mgmt.gapLead')}</span>{' '}
                {t('mgmt.gapBody')}
              </p>
            )}

            {retired.length > 0 && (
              <div className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t(retired.length === 1 ? 'mgmt.retiredOne' : 'mgmt.retiredMany', {
                    n: retired.length,
                  })}
                </span>{' '}
                {t('mgmt.retiredBody')}{' '}
                {retired.map((c, i) => (
                  <span key={c.key}>
                    {i > 0 && ', '}
                    <span className="text-foreground">{label(c.label) || c.key}</span>{' '}
                    <span className="font-mono text-[11px]">{c.accounts.join(' ')}</span>
                  </span>
                ))}
                .
              </div>
            )}
          </Section>
          </Grid>

          <p className="mt-4 max-w-[95ch] px-1 text-[12px] leading-relaxed text-muted-foreground">
            {t('mgmt.footnote')}
          </p>
        </div>
      )}
    </ScreenFrame>
  )
}
