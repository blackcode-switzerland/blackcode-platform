'use client'

// Impôts — a statutory snapshot, and not a tax return.
//
// ===========================================================================
// NOT IN THE NAV, AND THAT IS A PRODUCT DECISION
// ===========================================================================
// `lib/nav.ts` keeps this off the sidebar and it is reached from one cross-link
// on the overview. Tax TRACKING over time — instalments, filings, what is owed
// and when — is a different product (b/tax). This is the position of one (book,
// exercice) at the moment the page was opened, and a permanent nav item would
// promise the other thing.
//
// ===========================================================================
// RING 3: DERIVED AT REQUEST TIME AND STORED NOWHERE
// ===========================================================================
// Nothing on this payload is a column. VAT comes from the entries' own TVA
// fields, profit and equity from the two statements, and the two tax figures
// from the book's own parameter record. `GET …/tax-snapshot` recomputes on every
// call and takes no writes, ever. **No figure here may be cached as a figure** —
// what the query cache holds is a response, invalidated at the app root by any
// write. Same rule as the management view.
//
// ===========================================================================
// THE CANTON AND THE COMMUNE COME FROM THE BOOK. NOTHING HERE ASSUMES A COUNTRY.
// ===========================================================================
// Decision D-D: *"Nothing may assume Swiss-VD. Canton and commune tax parameters
// belong to the entity record, not to the app."* So there is no `VD` and no
// `Renens` in this file, no rate, no coefficient and no article — every one of
// them arrives on `snapshot.tax.params` and is rendered through `lib/tax.ts`. A
// book somewhere else renders correctly with no frontend release, and a book
// with no parameters at all answers `configured: false` and gets a screen that
// says so rather than somebody else's rates.
//
// ===========================================================================
// THE ARITHMETIC IS RENDERED, NOT JUST THE ANSWER
// ===========================================================================
// Two of the four blocks are compositions and a reader who sees only the total
// cannot check either:
//
//   VAT        `net_due = opening_due + output_ytd − input_claimed_ytd`. Without
//              the three inputs a net due and a net claim look the same.
//   Capital    `net_due = gross − credited`, the art. 118 imputation. All three
//              are served precisely because whether it applies this way is the
//              parameters' OPEN QUESTION, and serving only the net would pick an
//              answer the fiduciary has not given.
//
// And the profit tax carries two RATES rather than one: statutory, and effective
// — `s/(1+s)`, because Swiss taxes are themselves deductible. Both are shown
// because a figure computed at one and read at the other is off by a fifth.
//
// ── NOTHING IS ADDED UP HERE ─────────────────────────────────────────────
// Every figure on this page is a string the server computed. This file performs
// no arithmetic at all — not even a total — so there is no `amount()` call, no
// centime accumulator, and nothing that could disagree with `bk books tax` by a
// rappen. The one thing it does is compare what the server sent for VAT against
// what the server sent for VAT, which is a check rather than a derivation.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { isNoTaxSnapshotRefusal, useTaxSnapshot } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import {
  allConfirmed,
  blockCitation,
  blockNote,
  isConfirmed,
  openQuestion,
  ratePercent,
} from '@/lib/tax'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'
import { Grid, Section, Surface } from '@/components/section'
import { NoExerciceNotice, isNoExerciceRefusal } from '@/components/no-exercice-notice'
import { CitedFigure } from '@/components/cited-figure'
import { Money } from '@/components/money'
import type { TaxSnapshotResult } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { money } from '@/lib/format'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const snapshot = useTaxSnapshot(params.ws, scope)
  const t = useT()

  return (
    <ScreenFrame title={t('nav.taxes')}>
      <Link
        href={scopedHref(base, '', scope)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {t('tax.back')}
      </Link>

      <div className="mt-3">
        <StatementHeading
          fr={t('tax.legalName')}
          en={t('tax.uiName')}
          // No article on the heading. The document is not fixed by the Code des
          // obligations; the individual figures each carry their own citation,
          // which is where the authority actually lives.
          bookName={scope.record?.name}
          exercice={scope.exercice}
        />
      </div>

      <div
        className="mb-4 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-[12.5px] text-muted-foreground"
        role="note"
      >
        <span className="font-medium text-foreground">{t('tax.noticeLead')}</span>{' '}
        {t('tax.noticeBody')}
      </div>

      {snapshot.isLoading && <Loading rows={8} label={t('tax.loading')} />}

      {/* A simplified book is REFUSED here, by code, and the refusal is the
          answer rather than a failure — same treatment as the bilan's. A sole
          proprietorship's result is taxed as its owner's personal income, which
          this app does not model. */}
      {isNoTaxSnapshotRefusal(snapshot.error) && (
        <div className="rounded-lg border border-border bg-secondary px-4 py-3.5" role="note">
          <p className="text-sm font-medium text-foreground">
            {t('tax.noneTitle', { book: scope.record?.name ?? t('noExercice.thisBook') })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{snapshot.error.message}</p>
          {snapshot.error.suggestion && (
            <p className="mt-1.5 text-sm text-foreground">{snapshot.error.suggestion}</p>
          )}
          <Link
            href={scopedHref(base, '/patrimoine', scope)}
            className="mt-3 inline-block text-sm font-medium text-primary-strong hover:underline"
          >
            {t('tax.patrimoineLink')}
          </Link>
        </div>
      )}

      {isNoExerciceRefusal(snapshot.error) && (
        <NoExerciceNotice
          error={snapshot.error}
          statement={t('tax.uiName').toLowerCase()}
          bookName={scope.record?.name}
        />
      )}

      {snapshot.error &&
        !isNoTaxSnapshotRefusal(snapshot.error) &&
        !isNoExerciceRefusal(snapshot.error) && (
          <ErrorState error={snapshot.error} title={t('tax.failed')} />
        )}

      {snapshot.data && <Snapshot data={snapshot.data} />}
    </ScreenFrame>
  )
}

function Snapshot({ data }: { data: TaxSnapshotResult }) {
  const t = useT()
  const params = data.tax?.params ?? {}
  // Asked before the reader has read a figure, for `openQuestion`'s reason: a
  // caveat below the number is a caveat that did not happen.
  const settled = data.tax ? allConfirmed(params) : true

  return (
    <Grid data-tax-snapshot={data.entity}>
      {/* ── THE TWO FIGURES EVERYTHING ELSE IS COMPUTED FROM ────────────
          Not estimates and not cited: they are this book's own statements —
          `cr.resultat` and the bilan's capitaux propres — and their authority is
          art. 959a/959b, which those two screens carry. Citing them here would
          claim they were derived by this page. */}
      <Section span={6} label={t('tax.theBook')} note={t('tax.bookNote')}>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Fact label={t('tax.resultat')} value={data.profit} />
          <Fact label={t('tax.equity')} value={data.equity} />
        </div>
      </Section>

      {/* ── VAT: NULL IS "NOT REGISTERED", WHICH IS NOT ZERO ────────────── */}
      <Section
        span={6}
        label={t('tax.tva')}
        note={data.vat === null ? undefined : t('tax.vatNote')}
      >
        {data.vat === null ? (
          <p className="text-[12.5px] text-muted-foreground">
            {t('tax.notRegistered')}
          </p>
        ) : (
          <>
            <div className="border-t border-border">
              <Line label={t('tax.vatOpening')} value={data.vat.opening_due} />
              <Line label={t('tax.vatOutput')} value={data.vat.output_ytd} sign="+" />
              <Line
                label={t('tax.vatInput')}
                value={data.vat.input_claimed_ytd}
                sign="−"
              />
              <Line label={t('tax.vatNet')} value={data.vat.net_due} strong />
            </div>
          </>
        )}
      </Section>

      {/* ── THE TWO ESTIMATES, OR THE HONEST ABSENCE OF THEM ────────────── */}
      {data.tax === null ? (
        <Section span={12} label={t('tax.companyTaxes')}>
          <p className="max-w-[95ch] text-[12.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{t('tax.noParamsLead')}</span>{' '}
            {t('tax.noParamsBody')}
          </p>
        </Section>
      ) : (
        <>
          {!settled && (
            <div className="lg:col-span-12">
              <Surface tone="attention" role="note">
                <p className="max-w-[95ch] text-[12.5px] leading-relaxed text-foreground">
                  <span className="font-medium">{t('tax.unsettledLead')}</span>{' '}
                  {t('tax.unsettledBody')}
                </p>
              </Surface>
            </div>
          )}

          <Section
            span={12}
            label={t('tax.profitTaxHeading', {
              canton: data.tax.canton,
              commune: data.tax.commune,
            })}
            note={t('tax.cantonCommuneNote')}
          >
            <div>
              <CitedFigure
                label={t('tax.cantonal')}
                value={data.tax.profit_tax.cantonal}
                citation={blockCitation(params.cantonal)}
                confirmed={isConfirmed(params.cantonal)}
                note={blockNote(params.cantonal)}
                openQuestion={openQuestion(params.cantonal)}
              />
              <CitedFigure
                label={t('tax.communal')}
                value={data.tax.profit_tax.communal}
                citation={blockCitation(params.communal)}
                confirmed={isConfirmed(params.communal)}
                note={blockNote(params.communal)}
                openQuestion={openQuestion(params.communal)}
              />
              <CitedFigure
                label={t('tax.ifd')}
                value={data.tax.profit_tax.ifd}
                citation={blockCitation(params.ifd)}
                confirmed={isConfirmed(params.ifd)}
                note={blockNote(params.ifd)}
                openQuestion={openQuestion(params.ifd)}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-3">
                <span className="text-[13px] font-medium text-foreground">{t('tax.total')}</span>
                <Money value={data.tax.profit_tax.total} className="text-[14px] font-semibold" />
              </div>
            </div>

            {/* ── TWO RATES, AND WHY THEY DIFFER ──────────────────────────
                `ratePercent` and NOT `percent()` from `lib/format.ts`, which
                rounds to one decimal and rendered these as `16.2%` and `14.0%`
                against `bk`'s `16.23%` and `13.97%`. See its header. Nothing
                here divides anything; the arithmetic was the server's. */}
            {/* `ratePercent` and NOT `percent()` from `lib/format.ts`, which
                rounds to one decimal and rendered these as `16.2%` and `14.0%`
                against `bk`'s `16.23%` and `13.97%`. Nothing here divides
                anything; the arithmetic was the server's. The two rates are
                interpolated into the sentence rather than wrapped in `<span
                className="font-mono">`, because French reorders the clause. */}
            <p className="mt-2 text-[12px] text-muted-foreground">
              {t('tax.rates', {
                statutory: ratePercent(data.tax.profit_tax.statutory_pct),
                effective: ratePercent(data.tax.profit_tax.effective_pct),
              })}
            </p>
            {/* A loss year computes as zero rather than as a refund — the
                server's rule (`pmProfitTax` floors the profit at 0), stated
                because three zeroes over a negative result otherwise read as a
                broken derivation. */}
            {data.profit.trimStart().startsWith('-') && (
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {t('tax.lossYear')}
              </p>
            )}
          </Section>

          <Section span={12} label={t('tax.capitalTax')} note={t('tax.capitalNote')}>
            <div>
              <CitedFigure
                label={t('tax.vatNet')}
                value={data.tax.capital_tax.net_due}
                citation={blockCitation(params.capital_tax)}
                confirmed={isConfirmed(params.capital_tax)}
                note={blockNote(params.capital_tax)}
                openQuestion={openQuestion(params.capital_tax)}
              >
                {/* The imputation shown rather than hidden: the whole reason all
                    three figures are served. */}
                <span>
                  {t('tax.capitalWorking', {
                    gross: money(data.tax.capital_tax.gross),
                    credited: money(data.tax.capital_tax.credited),
                  })}
                </span>
              </CitedFigure>
            </div>
          </Section>
        </>
      )}

      <p className="px-1 text-[11.5px] text-muted-foreground lg:col-span-12">
        {t('tax.footnote', { command: `bk books tax --entity ${data.entity}` })}
      </p>
    </Grid>
  )
}

/** A figure from the statements. Not an estimate, so no citation slot. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <Money value={value} className="text-[14px] font-medium" />
    </div>
  )
}

/** One line of the VAT composition. `sign` shows the arithmetic, not a value. */
function Line({
  label,
  value,
  sign,
  strong = false,
}: {
  label: string
  value: string
  sign?: '+' | '−'
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2">
      <span className={'text-[13px] ' + (strong ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {/* The operator is presentation of the server's formula, never applied
            here — see this file's header on doing no arithmetic. */}
        {sign && <span className="mr-1.5 font-mono text-muted-foreground">{sign}</span>}
        {label}
      </span>
      <Money value={value} className={strong ? 'text-[14px] font-semibold' : 'text-[13px]'} />
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  )
}
