'use client'

// One filed analysis, whole — and the screen the phase exists for.
//
// ===========================================================================
// THE ONE RULE THAT MAKES THIS PAGE WORTH HAVING
// ===========================================================================
// From the route itself:
//
//   > the `based_on` snapshot exactly as it was filed. **NEVER recomputed** —
//   > a stored answer that silently reflows is a different answer.
//
// So this renders a SNAPSHOT, and it must never mix a stored figure with a
// freshly derived one. Every value on the page comes off the record as text and
// goes to the screen as text: nothing here calls `amount()`, nothing renders
// `<Money>`, and nothing re-groups or re-rounds a filed number. See
// `<FiguresTable>`'s header for why formatting one would be editing it.
//
// **Whether the answer has gone stale is a separate question, asked separately,
// and answered only as far as this app honestly can** — `<BookTodayNotice>`,
// whose header records that the mockup's `analysisDrift` reads three stored
// numbers this wire does not carry, and that a label→figure mapping would be a
// guess. It recomputes nothing and it says what it asked.
//
// ===========================================================================
// THE BOOK IS NAMED FROM THE RECORD, NOT FROM THE SCOPE
// ===========================================================================
// `getAnalysis` resolves on `(workspace_id, seq)` and does not filter by book,
// exactly like `getEntryByNumber`. The entry detail screen used to print the
// book from `?entity=`, and switching the selector relabelled an unchanged
// écriture with another company's name — reproduced in one click on 2026-08-18.
//
// This payload carries `entity`, so the failure is avoidable here rather than
// merely disclosed: the heading names the record's own book, and when the URL
// asks for a different one the page says so out loud instead of quietly
// answering a question nobody asked.
//
// ===========================================================================
// AND IT IS DEEP-LINKABLE, BECAUSE AGENTS LINK IT
// ===========================================================================
// `/dashboard/{ws}/analyses/{number}` takes the workspace #number — what
// `bk books analyse show` takes, and what a URN carries. A bad number is the
// route's own 404 with its own suggestion, rendered by `<ErrorState>`; not a
// crash and not a redirect to the list.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useAnalysis, useEntries, useRiEntries } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { speech } from '@/lib/label'
import { analysisRows, bookToday, hasSnapshot, type DatedRow } from '@/lib/analysis'
import { ScreenFrame } from '@/components/screen-frame'
import { PageHeader } from '@/components/page-header'
import { Grid, Section } from '@/components/section'
import { Badge } from '@/components/badge'
import { ErrorState, Loading } from '@/components/states'
import { DateText } from '@/components/date-text'
import { FiguresTable, NoSnapshotNotice } from '@/components/analysis-figures'
import { BookTodayNotice } from '@/components/book-today-notice'
import { useT } from '@/lib/i18n'

export default function Page() {
  const params = useParams<{ ws: string; number: string }>()
  const scope = useScope()
  const t = useT()
  const base = `/dashboard/${params.ws}`

  // `Number()` and an integer test, like the entry screen: `/analyses/abc` must
  // reach the route as nothing rather than as `NaN` in a URL.
  const parsed = Number(params.number)
  const number = Number.isInteger(parsed) && parsed > 0 ? parsed : null
  const analysis = useAnalysis(params.ws, scope, number)

  // The two journals, each enabled only for its own — `useEntries`'s rule. The
  // scope here is the URL's book, which is what the reader is looking at; when
  // the record belongs to a different one the notice below says the check does
  // not describe it.
  const entries = useEntries(params.ws, scope, scope.journal)
  const riEntries = useRiEntries(params.ws, scope, scope.journal)

  const record = analysis.data
  // The book named on the RECORD against the book named in the URL. Two
  // different claims, and the page must not conflate them.
  const sameBook = record ? record.entity === scope.entity : true

  // `books.ri_entry` has no posting status, so those rows carry an empty one and
  // `bookToday` counts no staged movements for a simplified book — which is what
  // `<BookTodayNotice>` renders, rather than a zero that would read as "none
  // outstanding". The mapping is here and not in the hook, because a `DatedRow`
  // is what the check needs and neither payload is one.
  const rows: DatedRow[] | null =
    scope.journal === 'grand_livre'
      ? (entries.data?.map((e) => ({ date: e.date, status: e.status })) ?? null)
      : scope.journal === 'recettes_depenses'
        ? (riEntries.data?.map((e) => ({ date: e.date, status: '' })) ?? null)
        : null

  const today = record && rows ? bookToday(record.asked, rows) : null

  return (
    <ScreenFrame title={t('analysis.title')}>
      <Link
        href={scopedHref(base, '/analyses', scope)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {t('analysis.all')}
      </Link>

      {number === null && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5"
        >
          <p className="text-sm font-medium text-foreground">
            {t('analysis.notANumber', { value: params.number })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('analysis.notANumberBody', { command: 'bk books analyse list' })}
          </p>
        </div>
      )}

      {analysis.isLoading && (
        <div className="mt-3">
          <Loading rows={6} label={t('analysis.loading')} />
        </div>
      )}

      {analysis.error && (
        <div className="mt-3">
          <ErrorState error={analysis.error} title={t('analysis.failed')} />
        </div>
      )}

      {record && (
        <article data-analysis={record.number}>
          <PageHeader
            eyebrow={t('nav.analyses')}
            title={speech(record.question)}
            lead={record.scenario_label ? speech(record.scenario_label) : undefined}
            meta={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                <span className="figure text-foreground">{record.agent}</span>
                <span>·</span>
                <DateText value={record.asked} />
                <span>·</span>
                <span>{t('analyses.askedBy', { who: record.asked_by })}</span>
                <span>·</span>
                {/* THE RECORD'S OWN BOOK. Not the scope's — see the header. */}
                <span>{t('analysis.book', { slug: record.entity })}</span>
                <Badge>
                  <span className="figure">#{record.number}</span>
                </Badge>
              </span>
            }
          />

          {/* ── THE URL ASKS ABOUT ONE BOOK AND THE RECORD IS ANOTHER'S ────
              The route resolves on `(workspace_id, seq)` alone, so following a
              link with the wrong `?entity=` opens a real record under the wrong
              selector. The entry screen could only DISCLOSE this — its payload
              carries no book — and this one can name both, which is the better
              half of the same fix. */}
          {!sameBook && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-l-[3px] border-border border-l-destructive bg-card px-3 py-2.5 text-[12.5px] text-foreground shadow-sm"
            >
              <span className="font-medium">{t('analysis.otherBookLead')}</span>{' '}
              {t('analysis.otherBookBody', {
                selected: scope.entity ?? '—',
                number: record.number,
                filed: record.entity,
              })}
            </p>
          )}

          <Grid>
          <Section
            span={7}
            label={t('analysis.theAnswer')}
            note={
              record.runway_after_months !== null ? (
                <>
                  {t('analysis.runwayUnder', { n: record.runway_after_months })}{' '}
                  {/* The mockup's gauges each draw a before against an after,
                      and this payload has one side. Stating the absence is what
                      stops a reader taking the figure for a delta. */}
                  {t('analysis.runwayNoDelta')}
                </>
              ) : undefined
            }
          >
            <p className="max-w-[95ch] text-sm leading-relaxed text-foreground">
              {speech(record.verdict)}
            </p>
          </Section>

          <div className="space-y-4 lg:col-span-5">
            <Figures label={t('analysis.figuresTitle')} value={record.figures} kind="figures" />

            <Section span={12} label={t('analysis.readTitle')} note={t('analysis.readLead')}>
              {hasSnapshot(record.based_on) ? (
                <SnapshotRows value={record.based_on} />
              ) : (
                <NoSnapshotNotice present={false} />
              )}
            </Section>
          </div>

          <div className="lg:col-span-12">
            <BookTodayNotice
              asked={record.asked}
              today={today}
              book={scope.record?.name ?? scope.entity}
              exercice={scope.exercice}
              journal={scope.journal}
              loading={entries.isLoading || riEntries.isLoading}
            />
          </div>
          </Grid>

          {/* ── SAY WHAT THIS SCREEN CAN KNOW, NOT WHAT THE DEPLOYMENT SHOULD BE
              This claimed "the app's database role holds no UPDATE or DELETE on
              the table". Migration 0013 does revoke them from `books_app` and
              warns loudly when that role is absent — but **there is no
              `books_app` role in this database and the app connects as
              `blackcode`, which holds both.** The screen stated the end state
              regardless, so on every environment that has not been provisioned
              the way the docs describe, it was telling a reader something false
              about the guarantee behind the record in front of them.

              What is true everywhere, and is the part that matters, is that
              there is no update route: nothing this product exposes can change a
              filed answer. The grant is a deployment fact, and a screen that
              cannot check it should not assert it. Found by the phase-5 review,
              which asked the database instead of reading the migration. */}
          <p className="mt-5 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
            {t('analysis.immutable', {
              bk: 'bk',
              command: `bk books analyse show ${record.number}`,
            })}
          </p>
        </article>
      )}
    </ScreenFrame>
  )
}

/** The `figures` block, rendered only when the record carries readable rows. */
function Figures({
  label,
  value,
  kind,
}: {
  label: string
  value: unknown
  kind: 'figures' | 'based-on'
}) {
  const { rows, dropped } = analysisRows(value)
  if (rows.length === 0 && dropped === 0) return null
  return (
    <Section span={12} label={label}>
      <FiguresTable rows={rows} dropped={dropped} kind={kind} />
    </Section>
  )
}

/** The snapshot's rows, or the reason there are none to show. */
function SnapshotRows({ value }: { value: unknown }) {
  const { rows, dropped } = analysisRows(value)
  if (rows.length === 0) return <NoSnapshotNotice present />
  return <FiguresTable rows={rows} dropped={dropped} kind="based-on" />
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  )
}
