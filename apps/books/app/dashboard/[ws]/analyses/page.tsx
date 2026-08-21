'use client'

// Analyses — the journal of questions somebody put to an agent.
//
// ===========================================================================
// THIS SCREEN READS. IT DOES NOT AUTHOR, AND THERE IS NO "NEW ANALYSIS" BUTTON
// ===========================================================================
// `POST …/analyses` exists and `bk books analyse record` exists, and neither is
// ours. An analysis is filed by the agent that answered the question — ring 0,
// an append from the world, in decision D-H's terms — and the asking happens
// outside this app entirely: a person asks Companion or Claude Code, the agent
// reads this app's data contract, and the answer lands in this journal.
//
// A capability in `bk` and not in the web UI is a gap under
// START-ANYWHERE-FINISH-IN-SYNC **unless it is a recorded decision**, and this
// is the record. It is the same reasoning that keeps `entry declare` and
// `source import` out: the app is not the door the world comes through.
//
// ===========================================================================
// THE MOCKUP'S TWO CHARTS ARE NOT BUILT, AND THE REASON IS THE WIRE
// ===========================================================================
// `app-analyses.html` draws a scenario map — every stored answer plotted by
// runway against net/month, with a live "TODAY" dot — and a per-row runway
// mini-bar showing before against after. Both read `a.metrics`, an object
// carrying `revenue_monthly`, `burn_monthly.{before,after}`,
// `net_monthly.{before,after}`, `runway_months.{before,after}`, `cash_chf` and
// `driver`.
//
// **`metrics` is not a column and is not on the wire.** `publicAnalysis` serves
// `figures` and `based_on`, both arrays of `{label, value}` where the value is
// TEXT, plus one number: `runway_after_months`. One side of one pair. Every
// chart on that page needs both sides, and the "TODAY" dot needs a cash figure
// this app does not serve and may not invent (D-D forbids the mockup's
// `'1020' + '1021' + '1022'`).
//
// So the journal is a list of records, and the report asks for `metrics` rather
// than reconstructing it from prose. Building the map against parsed strings
// would be the recompute the detail route forbids, one screen earlier.
//
// ── THE YEAR SELECTOR DOES NOT FILTER THIS SCREEN, AND IT SAYS SO ────────
// `books.analysis` has no `exercice_id` and the route reads no `?exercice=`. The
// switcher stays in the chrome — it is shared by every scoped page — so the copy
// names the fact rather than leaving a control that appears to do nothing, which
// is the treatment `lib/nav.ts` gives the half-scoped sources screen.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useAnalyses } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { speech } from '@/lib/label'
import { analysisRows } from '@/lib/analysis'
import { ScreenFrame } from '@/components/screen-frame'
import { Section } from '@/components/section'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'
import { DateText } from '@/components/date-text'
import type { Analysis } from '@/lib/types'
import { useT } from '@/lib/i18n'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const analyses = useAnalyses(params.ws, scope.entity)
  const t = useT()

  return (
    <ScreenFrame title={t('nav.analyses')}>
      <StatementHeading
        fr={t('analyses.legalName')}
        en={t('analyses.uiName')}
        // No article. This is a journal of questions, not a document the Code
        // des obligations fixes the shape of — the same rule the management
        // view follows, in reverse of the two statutory screens.
        bookName={scope.record?.name}
        exercice={scope.exercice}
      />

      {analyses.isLoading && <Loading rows={4} label={t('analyses.loading')} />}

      {analyses.error && (
        <ErrorState error={analyses.error} title={t('analyses.failed')} />
      )}

      {analyses.data && (
        <Section
          label={
            <>
              {t('analyses.uiName')}
              <span className="ml-2 font-normal">{analyses.data.length}</span>
            </>
          }
          bodyClassName=""
          /* Both standing notes, as the section's footnote. The second is the
             one that matters: this list is NOT filtered by the book switcher,
             and a reader who assumes it is would read another book's questions
             as this book's. */
          note={
            <>
              {t('analyses.leadA')}{' '}
              <span className="not-italic text-foreground">{t('analyses.leadB')}</span>{' '}
              {t('analyses.leadC')}{' '}
              {t('analyses.notFiltered', { book: scope.record?.name ?? t('rec.thisBook') })}
            </>
          }
        >
          {analyses.data.length === 0 ? (
            <div className="px-4 py-3.5">
              <EmptyState title={t('analyses.empty')} icon={MessagesSquare}>
                <p>{t('analyses.emptyBody')}</p>
              </EmptyState>
            </div>
          ) : (
            <div>
              {analyses.data.map((a) => (
                <AnalysisRow key={a.number} analysis={a} base={base} scope={scope} />
              ))}
            </div>
          )}
        </Section>
      )}
    </ScreenFrame>
  )
}

/**
 * One filed answer.
 *
 * The question is the link, because the question is what a person is looking
 * for. `runway_after_months` is shown as the ONE number the record carries and
 * is labelled "after" — there is no "before" on the wire, so nothing here draws
 * a delta or an arrow, which would state a figure nobody filed.
 */
function AnalysisRow({
  analysis,
  base,
  scope,
}: {
  analysis: Analysis
  base: string
  scope: { entity: string | null; exercice: number | null }
}) {
  const t = useT()
  const verdict = speech(analysis.verdict)
  const scenario = analysis.scenario_label ? speech(analysis.scenario_label) : null
  // The count is read through the guard, not off `.length`, so a malformed row
  // is not counted as a source the agent read. `lib/analysis.ts`.
  const basedOn = analysisRows(analysis.based_on)

  return (
    <div className="border-b border-border py-3" data-analysis={analysis.number}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
        {/* The agent is a fact on the record and is rendered as text rather than
            as a chip: it is free text (`varchar(120)`), not a vocabulary, so
            there is no served colour and inventing one would be a map from a
            value to a hue that goes stale the first time somebody files under a
            new agent name. */}
        <span className="font-mono text-foreground">{analysis.agent}</span>
        <span>·</span>
        <DateText value={analysis.asked} />
        <span>·</span>
        <span>{t('analyses.askedBy', { who: analysis.asked_by })}</span>
        <span className="ml-auto font-mono">#{analysis.number}</span>
      </div>

      <Link
        href={scopedHref(base, `/analyses/${analysis.number}`, scope)}
        className="mt-1 block text-[14px] font-medium text-foreground hover:text-primary-strong"
      >
        {speech(analysis.question)}
      </Link>

      {scenario && <p className="mt-0.5 text-[12px] text-muted-foreground">{scenario}</p>}

      {verdict && <p className="mt-1.5 text-[12.5px] text-foreground">{verdict}</p>}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        {/* `!== null` and not truthiness: a runway of 0 months is a real and
            very interesting answer, and `0 && …` would hide it. */}
        {analysis.runway_after_months !== null && (
          <span>{t('analyses.runwayAfter', { n: analysis.runway_after_months })}</span>
        )}
        <span>
          {t(basedOn.rows.length === 1 ? 'analyses.inputsOne' : 'analyses.inputsMany', {
            n: basedOn.rows.length,
          })}
        </span>
        <Link
          href={scopedHref(base, `/analyses/${analysis.number}`, scope)}
          className="ml-auto inline-flex items-center gap-1 text-primary-strong hover:underline"
        >
          {t('analyses.openRecord')}
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}
