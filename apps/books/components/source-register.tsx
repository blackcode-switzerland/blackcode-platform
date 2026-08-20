'use client'

// The sources register — "do I have everything?", as a table.
//
// ===========================================================================
// NOTHING ON THIS SCREEN LOOKS SETTABLE, AND THAT IS A DESIGN CONSTRAINT
// ===========================================================================
// `status` is COMPUTED at read time from `expected` against `last_import`.
// There is no status column and `lib/derive/sources.ts` says why: the register's
// answer is only trustworthy while nobody can set it, and the moment somebody
// can flip one to green during a busy week the completeness signal reports
// feelings instead of facts.
//
// So there is no toggle, no dropdown, no "mark as current", and no row action of
// any kind. The one hand-set lifecycle fact in this payload is `retired`, and
// even that is not editable here — no route accepts it. **Creating a source is
// also absent on purpose**: sources are provisioned, not authored, and no POST
// exists.
//
// A screen that renders a chip is making a claim about how the system works. If
// this one grew a control, a reader would reasonably conclude the green ones
// were ticked by somebody.
//
// ===========================================================================
// THIS TABLE IS NOT SCOPED TO A BOOK, AND THE SCREEN AROUND IT IS
// ===========================================================================
// A source belongs to the WORKSPACE. One card attributes spend across several
// books, and `books.source.entity_id` is nullable because an unattributed source
// is legitimate — seeded #9 (PostFinance) has no book and is never-connected,
// which is precisely the row a book-filtered register would hide.
//
// So the register is served UNFILTERED and the book is a COLUMN. The chart of
// accounts above it is per book and keeps the switcher. Two halves of one screen
// answering to different controls is a real design problem and it is named in
// the copy rather than hidden: the reader is told the register is not filtered.
//
// ── THE MOCKUP DRAWS A CHAIN THIS PAYLOAD CANNOT ─────────────────────────
// `app-sources.html` renders "↳ draws from: WIR Bank" under each card, from a
// `draws_from` field. The column EXISTS in `books.source` and `publicSource`
// does not serve it, so the edge cannot be drawn — only each source's own
// `layer`. Rendering the layer chip alone is the honest half; inventing the edge
// from the layer would be a guess. `lib/wire-parity.test.ts` pins the absence,
// so the day it is served this component is what grows the chain.

'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { scopedHref } from '@/lib/nav'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import { findTerm, useMeta } from '@/lib/hooks'
import { DataTable, type Column } from './data-table'
import { DateText } from './date-text'
import { TermChip } from './chips'
import type { Source, SourceStatus } from '@/lib/types'

/**
 * The statuses that mean money may be moving through an unimported channel.
 *
 * `retired` is not one: a retired source is a decision, not a lapse. `current`
 * on a source with no cadence is not one either — the frozen UBS relationship
 * is current with a June import because nothing more should arrive, which is the
 * whole difference between "quiet" and "late".
 */
const NEEDS_ATTENTION: readonly SourceStatus[] = ['stale', 'gap', 'never_connected']

export function SourceRegister({
  sources,
  isLoading,
  error,
  base,
  scope,
}: {
  sources: Source[] | undefined
  isLoading?: boolean
  error?: unknown
  base: string
  scope: { entity: string | null; exercice: number | null }
}) {
  const { data: meta } = useMeta()
  const t = useT()
  const label = useLabel()

  const problems = useMemo(
    () => (sources ?? []).filter((s) => NEEDS_ATTENTION.includes(s.status)),
    [sources]
  )

  const columns = useMemo<Column<Source>[]>(
    () => [
      {
        key: 'name',
        header: t('sources.colSource'),
        cell: (s) => (
          <span className={'block min-w-0 ' + (s.retired ? 'opacity-60' : '')}>
            <Link
              href={scopedHref(base, `/sources/${s.number}`, scope)}
              className="font-medium text-foreground hover:text-primary-strong"
            >
              {s.name}
            </Link>
            {s.ledger_accounts.length > 0 && (
              <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                {s.ledger_accounts.join(' · ')}
              </span>
            )}
          </span>
        ),
        sortValue: (s) => s.name,
      },
      {
        key: 'type',
        header: t('sources.colType'),
        cell: (s) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <TermChip term={findTerm(meta, 'source_types', s.type)} value={s.type} />
            {/* Each source's OWN layer. Not the chain — see the header. */}
            {s.layer && (
              <TermChip term={findTerm(meta, 'source_layers', s.layer)} value={s.layer} />
            )}
          </span>
        ),
        sortValue: (s) => s.type,
      },
      {
        key: 'entity',
        header: t('sources.colBook'),
        cell: (s) =>
          s.entity ? (
            <span className="font-mono text-[12px] text-foreground">{s.entity}</span>
          ) : (
            // NOT an em dash. An unattributed source is a real state with a
            // consequence — nothing it carries is on any book's statements —
            // and it must read as a fact, not as a blank cell.
            <span className="text-[12px] italic text-muted-foreground" data-entity="none">
              {t('sources.notAttributed')}
            </span>
          ),
        sortValue: (s) => s.entity ?? '',
      },
      {
        key: 'method',
        header: t('sources.colMethod'),
        cell: (s) =>
          s.method ? (
            <span className="text-[12px] text-muted-foreground">{s.method}</span>
          ) : (
            <span className="text-[12px] italic text-muted-foreground">
              {t('sources.notRecorded')}
            </span>
          ),
        sortValue: (s) => s.method ?? '',
      },
      {
        key: 'last_import',
        header: t('sources.colLastImport'),
        cell: (s) => (
          <span className="block">
            {s.last_import ? (
              <DateText value={s.last_import} className="text-[12px]" />
            ) : (
              <span className="text-[12px] italic text-muted-foreground">
                {t('sources.never')}
              </span>
            )}
            {s.expected && s.expected !== 'none' && (
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {t('sources.expected', { cadence: s.expected })}
              </span>
            )}
          </span>
        ),
        sortValue: (s) => s.last_import ?? '',
      },
      {
        key: 'status',
        header: t('sources.colStatus'),
        cell: (s) => (
          <span
            className="inline-flex flex-col items-start gap-0.5"
            // The computed verdict, machine-readable. An agent reading the DOM
            // gets the value; the chip's label is presentation.
            data-status={s.status}
          >
            <TermChip term={findTerm(meta, 'source_status', s.status)} value={s.status} />
            {s.expected && s.expected !== 'none' && !s.retired && (
              <span className="text-[10.5px] text-muted-foreground">
                {t('sources.windows', {
                  stale: s.windows.stale_after_days,
                  gap: s.windows.gap_after_days,
                })}
              </span>
            )}
          </span>
        ),
        sortValue: (s) => s.status,
      },
    ],
    [meta, base, scope, t]
  )

  return (
    <>
      {/* The gap detector, first: "do I have everything?" before the table that
          answers it row by row. Deliberately NOT in the destructive tint — a
          late import is an operational fact to act on, and this app reserves red
          for what it means elsewhere. The chips inside carry the SERVER's
          colours, which is the one place a status colour may come from. */}
      {problems.length > 0 && (
        <div
          className="mb-3 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5"
          role="status"
          data-attention={problems.length}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-primary-strong" />
          <p className="text-[12.5px] text-foreground">
            <span className="font-medium">
              {t(problems.length === 1 ? 'sources.attentionOne' : 'sources.attentionMany', {
                n: problems.length,
              })}
            </span>{' '}
            {t('sources.attentionBody', { names: problems.map((s) => s.name).join(' · ') })}
          </p>
        </div>
      )}

      <DataTable
        rows={sources}
        columns={columns}
        rowKey={(s) => s.number}
        isLoading={isLoading}
        error={error}
        initialSort={{ key: 'name', direction: 'asc' }}
        empty={t('sources.registerEmpty')}
      />

      {/* Freeform notes are the reason each source has its own page. Shown as a
          pointer, not inlined: they run to several sentences and would make the
          index unreadable. */}
      {sources && sources.some((s) => s.notes_freeform) && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {t('sources.freeformNote', {
            n: sources.filter((s) => label(s.notes_freeform)).length,
          })}
        </p>
      )}
    </>
  )
}
