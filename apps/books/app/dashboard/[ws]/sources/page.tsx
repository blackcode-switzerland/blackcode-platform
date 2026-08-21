'use client'

// Accounts & sources — the chart of accounts, and the sources register.
//
// ===========================================================================
// THIS PAGE IS BOOK-SCOPED NOW, AND `lib/nav.ts` STILL SAYS IT IS NOT
// ===========================================================================
// The nav marks it `scoped: false`, on the reasoning that a bank, a card or a
// processor is a channel money arrives through and one channel can feed more
// than one book. That is right about SOURCES — and the chart of accounts is not
// a source. `GET …/accounts` serves one book's 26 accounts, they are copied per
// book at creation, and editing one book's chart cannot touch another's.
//
// So the page is scoped in fact while the nav flag says otherwise, and the flag
// is what hides the book switcher in the top bar. **Leaving the flag alone
// would have shipped a page whose numbers change per book with no control to
// change it** — the reader would have to go to another screen to switch, and
// come back. The flag was flipped to `true` with the chart.
//
// ── PHASE 3 MADE IT A HARDER QUESTION, AND HERE IS THE ANSWER ────────────
// The sources register is now on this screen and it is NOT book-scoped: a card
// attributes spend across books, and `books.source.entity_id` is nullable
// because an unattributed source is legitimate. Seeded #9 (PostFinance) has no
// book at all, is `never_connected`, and is exactly the row a book filter would
// hide — from the register whose entire job is to say what is missing.
//
// **So the page keeps `scoped: true` and the register ignores it.** The chart
// above needs the switcher and changes with it; the register is served
// unfiltered and carries the book as a COLUMN. Two halves answering to different
// controls is a real problem and the alternatives are worse:
//
//   filter the register by book  hides the unattributed source, which is the
//                                one the register exists to surface
//   unscope the whole page       the chart is per book; without the switcher a
//                                reader cannot see another book's accounts
//   split into two screens       a tenth nav item for a table of nine rows, and
//                                the mockup deliberately puts them together
//
// What the page owes the reader instead is to SAY it, which the copy below the
// register does. Raised in the report as a design question, not settled here.
//
// ── `statement_position` IS THE ONLY MAPPING ANYBODY MAY TOUCH ────────────
// It is a NOT NULL foreign key into the legal line list, so an unmapped account
// is impossible rather than merely discouraged. It is shown on every row,
// because it is the answer to "why is this figure on that line" — and the
// answer to "this figure is wrong" is that this mapping, or the entry's
// account, is wrong. **Never the legal category.**
//
// ── ACCOUNT LABELS ARE `{fr, en}` SINCE 2026-08-19 ────────────────────────
// The wire used to carry the mockup's `{fr, enSuffix}` and needed dedicated
// helpers; the backend now normalizes at the door, so `en()` reads an account
// label like any other. See `lib/label.ts` for the closed case.

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useAccounts, useSources } from '@/lib/hooks'
import { useLabel } from '@/lib/use-label'
import { useLocale, useT } from '@/lib/i18n'
import { ScreenFrame } from '@/components/screen-frame'
import { PageHeader } from '@/components/page-header'
import { Grid, Section } from '@/components/section'
import { DataTable, type Column } from '@/components/data-table'
import { AccountRef } from '@/components/account-ref'
import { SourceRegister } from '@/components/source-register'
import type { Account } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const accounts = useAccounts(params.ws, scope)
  // Deliberately unscoped. See the header: filtering the register by book hides
  // the unattributed source, which is the one it exists to surface.
  const sources = useSources(params.ws)
  const t = useT()
  const locale = useLocale()
  const label = useLabel()

  const columns = useMemo<Column<Account>[]>(
    () => [
      {
        key: 'no',
        header: t('sources.colNo'),
        cell: (a) => <AccountRef no={a.no} base={base} scope={scope} />,
        sortValue: (a) => a.no,
      },
      {
        key: 'label',
        header: t('sources.colAccount'),
        // The account's French name, with the English gloss for an English
        // reader — the same rule and the same test as `<StatementTable>`: a
        // French reader glossed with the French would read it twice.
        cell: (a) => (
          <span>
            <span className="text-foreground">{a.label.fr}</span>
            {locale === 'en' && (
              <span className="ml-2 text-[12px] text-muted-foreground">{label(a.label)}</span>
            )}
          </span>
        ),
        sortValue: (a) => a.label.fr,
      },
      {
        key: 'class',
        header: t('sources.colClass'),
        numeric: true,
        cell: (a) => a.class,
        sortValue: (a) => a.class,
      },
      {
        key: 'statement',
        header: t('sources.colStatement'),
        cell: (a) => (
          <span className="text-[12px] uppercase tracking-wider text-muted-foreground">
            {a.statement === 'bilan'
              ? t('statements.bilanLegal')
              : t('statements.crLegal')}
          </span>
        ),
        sortValue: (a) => a.statement,
      },
      {
        key: 'statement_position',
        header: t('sources.colLegalLine'),
        cell: (a) => <span className="font-mono text-[12px]">{a.statement_position}</span>,
        sortValue: (a) => a.statement_position,
      },
    ],
    [base, scope, t, locale, label]
  )

  return (
    <ScreenFrame title={t('nav.sources')}>
      <PageHeader
        eyebrow={t('nav.sources')}
        title={
          <>
            {t('sources.uiName')}
            {t('sources.legalName') !== t('sources.uiName') && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t('sources.legalName')}
              </span>
            )}
          </>
        }
        lead={t('sources.subheading', { book: scope.record?.name ?? '—' })}
      />

      {/* ── THIS SCREEN IS HALF-SCOPED, AND THE LAYOUT NOW SAYS SO ──────────
          The chart of accounts above is per BOOK — it is copied into each one at
          creation. The register below is not: a source is a channel money
          arrives through, `books.source.entity_id` is nullable, and one channel
          feeds several books. `lib/nav.ts` keeps `scoped: true` for the chart's
          sake and the copy names the split rather than hiding it.

          Two sections rather than one column of four paragraphs makes the seam
          visible: the book switcher changes the first and not the second, and a
          reader can now see which is which without reading a disclaimer. */}
      <Grid>
        <Section
          span={12}
          label={t('sources.chartLabel')}
          bodyClassName=""
          note={
            <>
              {t('sources.chartLeadA')}{' '}
              <span className="not-italic font-medium text-foreground">
                {t('sources.chartLeadB')}
              </span>{' '}
              {t('sources.chartLeadC')}
            </>
          }
        >
          <DataTable
            rows={accounts.data}
            columns={columns}
            rowKey={(a) => a.no}
            isLoading={accounts.isLoading}
            error={accounts.error}
            initialSort={{ key: 'no', direction: 'asc' }}
            empty={t('sources.noAccounts')}
          />
        </Section>

        <Section
          span={12}
          label={
            <>
              {t('sources.title')}
              {sources.data && <span className="ml-2 font-normal">{sources.data.length}</span>}
            </>
          }
          bodyClassName=""
          note={
            <>
              <span className="not-italic font-medium text-foreground">
                {t('sources.notFilteredLead')}
              </span>{' '}
              {t('sources.notFilteredBody')} {t('sources.provisioned')}
            </>
          }
        >
          <p className="max-w-[95ch] px-4 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {t('sources.leadA')}{' '}
            <span className="font-medium text-foreground">{t('sources.leadB')}</span>
            {t('sources.leadC')}
          </p>
          <div className="mt-3">
            <SourceRegister
              sources={sources.data}
              isLoading={sources.isLoading}
              error={sources.error}
              base={base}
              scope={scope}
            />
          </div>
        </Section>
      </Grid>
    </ScreenFrame>
  )
}
