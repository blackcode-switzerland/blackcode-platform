'use client'

// The worker's ledger of one Drive folder: every file it has seen, and where
// each sits in the state machine.
//
// ===========================================================================
// "NO FILES ON RECORD" IS AN ANSWER, NOT A FAILURE
// ===========================================================================
// Most seeded sources have an empty manifest and it is the first state anybody
// sees. A bank is pulled by hand into a Drive archive; only the Drive-inbox
// source has a worker keeping a ledger. So an empty table here means *"nothing
// has been tracked for this source"* — which is a true and useful thing to know
// — and it must not read as "the request failed" or as "still loading".
//
// `<EmptyState>` says it in words rather than leaving a table with a header and
// no rows, because a header over nothing is exactly what a broken fetch looks
// like.
//
// ── THE POINT OF THIS TABLE IS "DID WE MISS A FILE" ──────────────────────
// Which is a question about the SET, not about any row, so the summary line is
// part of the answer and not decoration: five files, five fetched, one in
// review, none archived. A reader scanning rows cannot compute that, and an
// agent reads `bk books manifest` instead.
//
// ── `archived` IS FALSE EVERYWHERE, HONESTLY ─────────────────────────────
// The immutable legal-archive copy is a backend decision that has been made and
// not built. "Not yet" is what the column says, on every row, and that is the
// correct rendering of a promise nobody has kept yet — a tick would be a claim
// about a ten-year retention obligation that nothing behind this screen fulfils.

import { DateText } from './date-text'
import { TermChip } from './chips'
import { DataTable, type Column } from './data-table'
import { EmptyState } from './states'
import { findTerm, useMeta } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import { useMemo } from 'react'
import type { ManifestFile } from '@/lib/types'

export function ManifestTable({
  files,
  isLoading,
  error,
  base,
  scope,
}: {
  files: ManifestFile[] | undefined
  isLoading?: boolean
  error?: unknown
  base: string
  scope: { entity: string | null; exercice: number | null }
}) {
  const { data: meta } = useMeta()

  // The vocabulary is looked up ONCE for the whole table rather than per row —
  // `<TermChip>` exists for exactly this, and a hundred `useMeta()`
  // subscriptions are not free.
  const columns = useMemo<Column<ManifestFile>[]>(
    () => [
      {
        key: 'name',
        header: 'File',
        cell: (f) => (
          <span className="block min-w-0">
            <span className="block font-mono text-[12px] text-foreground">
              {/* A file the worker recorded with no name is a real state and it
                  must not render as an empty cell. */}
              {f.name ?? <span className="italic text-muted-foreground">unnamed</span>}
            </span>
            <span className="block break-all font-mono text-[10.5px] text-muted-foreground">
              {f.file_id}
            </span>
          </span>
        ),
        sortValue: (f) => f.name ?? f.file_id,
      },
      {
        key: 'created',
        header: 'Created',
        // A Drive timestamp, not a Postgres `date` — `<DateText>` slices and
        // never parses, so it is right for both. See `ManifestFile`.
        cell: (f) => <DateText value={f.created_time} className="text-[12px]" />,
        sortValue: (f) => f.created_time ?? '',
      },
      {
        key: 'fetched',
        header: 'Fetched',
        cell: (f) =>
          f.fetched ? (
            <DateText value={f.fetched} className="text-[12px]" />
          ) : (
            <span className="text-[12px] italic text-muted-foreground">not yet</span>
          ),
        sortValue: (f) => f.fetched ?? '',
      },
      {
        key: 'piece',
        header: 'Pièce',
        cell: (f) =>
          f.piece === null ? (
            <span className="text-[12px] text-muted-foreground">—</span>
          ) : (
            <Link
              href={scopedHref(base, '/documents', scope, { piece: f.piece })}
              className="font-mono text-[12px] text-primary-strong hover:underline"
            >
              #{f.piece}
            </Link>
          ),
        sortValue: (f) => f.piece ?? 0,
      },
      {
        key: 'state',
        header: 'State',
        cell: (f) => (
          <TermChip term={findTerm(meta, 'manifest_states', f.state)} value={f.state} />
        ),
        sortValue: (f) => f.state,
      },
      {
        key: 'archived',
        header: 'Archived',
        cell: (f) =>
          f.archived ? (
            <span className="text-[12px] text-foreground" title={f.archive_ref ?? undefined}>
              yes
            </span>
          ) : (
            <span className="text-[12px] italic text-muted-foreground">not yet</span>
          ),
        sortValue: (f) => (f.archived ? 1 : 0),
      },
    ],
    [meta, base, scope]
  )

  const summary = useMemo(() => {
    if (!files) return null
    return {
      total: files.length,
      fetched: files.filter((f) => f.fetched !== null).length,
      extracted: files.filter((f) => f.piece !== null).length,
      review: files.filter((f) => f.state === 'needs_review').length,
      archived: files.filter((f) => f.archived).length,
    }
  }, [files])

  // The empty answer, in words. A header row over nothing is what a failed
  // fetch looks like, and this is not one.
  if (!isLoading && !error && files && files.length === 0) {
    return (
      <EmptyState title="No files on record for this source." icon={FolderOpen}>
        <p>
          That is an answer, not a failure. A manifest is kept by the Drive worker, and only a
          source it polls has one — a bank pulled by hand into an archive folder has files on our
          side without a worker tracking them, and they are in the pulls table above.
        </p>
      </EmptyState>
    )
  }

  return (
    <>
      {summary && summary.total > 0 && (
        <p className="mb-2 text-[12px] text-muted-foreground">
          {summary.total} files · {summary.fetched} fetched · {summary.extracted} extracted ·{' '}
          {summary.review} in review · {summary.archived} archived
        </p>
      )}
      <DataTable
        rows={files}
        columns={columns}
        rowKey={(f) => f.file_id}
        isLoading={isLoading}
        error={error}
        initialSort={{ key: 'created', direction: 'desc' }}
      />
    </>
  )
}
