'use client'

// One source in full — how to treat it, what it feeds, what we hold from it,
// and how to pull the next one.
//
// ===========================================================================
// THIS PAGE IS THE ARCHIVAL INSURANCE, AND IT IS WHY SOURCES HAVE PAGES
// ===========================================================================
// Seeded source #2 is the argument: UBS froze the relationship without notice
// and the e-banking access is still readable and revocable at any time.
// Everything recoverable was pulled and lives in our Drive. A register row
// cannot carry that; a page can, and the freeform note is the first thing on it.
//
// ── IT IS NOT SCOPED TO A BOOK, AND `<ScreenFrame>` IS STILL RIGHT ───────
// A source belongs to the workspace and names its own book (or none). The frame
// is kept because it handles the four states every screen in this app owes the
// reader — loading, error, no books, and `?entity=typo` — and none of those
// stops being true here. The frame's `record` is simply not what this page reads
// its subject from: the URL's #number is.
//
// ── THE STATUS IS SHOWN WITH ITS THRESHOLDS, NOT ON ITS OWN ──────────────
// "Gap detected" is a verdict. "Gap detected — nothing since 18.07, and this
// source is expected weekly, so stale after 10 days and a gap after 20" is a
// verdict somebody can check. The thresholds come down in `windows`; nothing
// here re-derives them (see `<RunbookPanel>`).
//
// ── THE `?number=` IS THE WORKSPACE #NUMBER AND `useParams` GIVES A STRING ─
// `Number('3x')` is NaN and `Number('')` is 0. Both are parsed here and refused
// before a request goes out, because `…/sources/NaN` is a 400 the reader would
// see as a broken page rather than as a bad address.

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useManifest, useSource, findTerm, useMeta } from '@/lib/hooks'
import { en } from '@/lib/label'
import { scopedHref } from '@/lib/nav'
import { ApiRequestError } from '@/lib/client'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { DataTable, type Column } from '@/components/data-table'
import { DateText } from '@/components/date-text'
import { TermChip } from '@/components/chips'
import { RunbookPanel } from '@/components/runbook-panel'
import { ManifestTable } from '@/components/manifest-table'
import type { SourceDetail, SourcePull } from '@/lib/types'

/**
 * Did the server answer "no such source", rather than fail?
 *
 * Matches the STATUS, not the code and not the message. The code is `source`
 * rather than `source_not_found` because of the overload trap described at the
 * call site, and the message is the bare number — so neither is something to
 * match on, and a status is what this actually needs to know.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404
}

export default function Page() {
  const params = useParams<{ ws: string; number: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const { data: meta } = useMeta()

  // A #number the address bar can hold and this app cannot use. Refused here,
  // not by the server: a 400 from `…/sources/abc` reads as a broken page.
  const parsed = Number(params.number)
  const number = Number.isInteger(parsed) && parsed > 0 ? parsed : null

  const source = useSource(params.ws, number)
  const manifest = useManifest(params.ws, number)

  return (
    <ScreenFrame title="Source">
      <p className="mb-3">
        <Link
          href={scopedHref(base, '/sources', scope)}
          className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-primary-strong"
        >
          <ArrowLeft size={12} />
          Accounts &amp; sources
        </Link>
      </p>

      {number === null && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
          <p className="text-sm font-medium text-foreground">
            <span className="font-mono">{params.number}</span> is not a source number.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Source numbers are the ones in the register. Nothing was requested.
          </p>
        </div>
      )}

      {number !== null && source.isLoading && <Loading rows={5} label="Loading this source" />}
      {number !== null && source.error && (
        // ── A 404 HERE IS AN ADDRESS, NOT A FAILURE, AND THE ROUTE SENDS NO
        //    SENTENCE FOR EITHER ─────────────────────────────────────────
        // `GET …/sources/{n}` raises `Errors.notFound('source', String(n))`,
        // which reaches the THREE-argument overload: the code becomes `source`
        // (losing `_not_found`) and the message becomes the bare number. So
        // `<ErrorState>` rendered the heading "This source could not be loaded"
        // over the body "99" and the word "source" — verified in the browser on
        // `/sources/99`. The same trap is in the manifest route and in
        // `pieces/{n}/match`; all three are the backend's to fix and the report
        // asks for it. See `refusalText` in `<MatchPieceForm>` for the other half.
        //
        // Meanwhile: a source number that names nothing is a bookmark that has
        // gone stale, and telling somebody the request FAILED sends them looking
        // for a fault that is not there.
        isNotFound(source.error) ? (
          <div className="rounded-lg border border-border px-4 py-3.5" role="alert">
            <p className="text-sm font-medium text-foreground">
              There is no source <span className="font-mono">#{number}</span> in this account.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Source numbers are the ones in the register. The address is asking for one that does
              not exist — the request reached the server and was answered.
            </p>
          </div>
        ) : (
          <ErrorState error={source.error} title="This source could not be loaded" />
        )
      )}
      {source.data && (
        <Body source={source.data} base={base} scope={scope} meta={meta} manifest={manifest} />
      )}
    </ScreenFrame>
  )
}

function Body({
  source,
  base,
  scope,
  meta,
  manifest,
}: {
  source: SourceDetail
  base: string
  scope: { entity: string | null; exercice: number | null }
  meta: ReturnType<typeof useMeta>['data']
  manifest: ReturnType<typeof useManifest>
}) {
  const notes = en(source.notes_freeform)
  const cadenceKnown = !!source.expected && source.expected !== 'none'

  const pullColumns: Column<SourcePull>[] = [
    {
      key: 'file',
      header: 'File',
      cell: (p) => (
        <span className="block min-w-0">
          <span className="block font-mono text-[12px] text-foreground">{p.file}</span>
          {p.drive_ref && (
            <span className="block break-all font-mono text-[10.5px] text-muted-foreground">
              {p.drive_ref}
            </span>
          )}
        </span>
      ),
      sortValue: (p) => p.file,
    },
    {
      key: 'period',
      header: 'Period / format',
      cell: (p) => (
        <span className="text-[12px] text-muted-foreground">
          {[p.period, p.format].filter(Boolean).join(' · ') || (
            <span className="italic">not recorded</span>
          )}
        </span>
      ),
      sortValue: (p) => p.period ?? '',
    },
    {
      key: 'hash',
      header: 'Hash',
      cell: (p) =>
        p.hash ? (
          // The whole value in `title` and `data-hash`, the head on screen —
          // the same treatment `<DriveLink>` gives an entry's pièce hash.
          <span className="font-mono text-[11px] text-muted-foreground" title={p.hash} data-hash={p.hash}>
            {p.hash.slice(0, 18)}
          </span>
        ) : (
          // A pulled file with no hash cannot prove what was captured. That is a
          // finding, not a blank.
          <span className="text-[11.5px] italic text-destructive" data-hash="none">
            no hash
          </span>
        ),
      sortValue: (p) => p.hash ?? '',
    },
    {
      key: 'pulled',
      header: 'Pulled',
      cell: (p) =>
        p.pulled ? (
          <DateText value={p.pulled} className="text-[12px]" />
        ) : (
          <span className="text-[12px] italic text-muted-foreground">not recorded</span>
        ),
      sortValue: (p) => p.pulled ?? '',
    },
  ]

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">{source.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TermChip term={findTerm(meta, 'source_status', source.status)} value={source.status} />
          <TermChip term={findTerm(meta, 'source_types', source.type)} value={source.type} />
          {source.layer && (
            <TermChip term={findTerm(meta, 'source_layers', source.layer)} value={source.layer} />
          )}
          <span className="font-mono text-[12px] text-muted-foreground">#{source.number}</span>
        </div>
        <p className="mt-2 max-w-2xl text-[12.5px] text-muted-foreground">
          {/* The verdict WITH the arithmetic behind it. A status nobody can
              check is a status nobody should believe — and this one is computed,
              so the check is available. */}
          {source.retired ? (
            <>
              Retired. This is the one lifecycle fact a person sets, and it beats every cadence: the
              last import was <DateText value={source.last_import} /> and nothing is late, because
              nothing more is expected.
            </>
          ) : source.status === 'never_connected' ? (
            // FOUND IN THE BROWSER, 2026-08-18. This branch did not exist and
            // source #9 (PostFinance) fell into the no-cadence one, which
            // explains why a status "can read current" — over a row reading
            // NEVER CONNECTED. A confident wrong explanation of a correct chip,
            // which is worse than no explanation at all.
            <>
              Nothing has ever been imported from this source, so there is no date to measure a
              cadence against. That is the whole verdict: the register can say the channel is
              unconnected, and it cannot tell you whether that is a decision or an oversight.
            </>
          ) : cadenceKnown ? (
            <>
              Expected {source.expected}. Last import{' '}
              {source.last_import ? <DateText value={source.last_import} /> : 'never'} — stale after{' '}
              {source.windows.stale_after_days} days, a gap after {source.windows.gap_after_days}.
              Computed each time this page is read, from the cadence against that date. Nothing here
              is settable.
            </>
          ) : (
            <>
              No cadence is expected, so nothing can be late. That is why the status can read
              current over an import from months ago — the difference between quiet and late is the
              whole reason this is computed rather than ticked.
            </>
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {source.entity ? (
            <>
              Book: <span className="font-mono text-foreground">{source.entity}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Not attributed to a book.</span> Nothing
              this source carries reaches any statement until somebody says whose it is.
            </>
          )}
        </p>
      </div>

      <section className="mb-6 rounded-lg border border-border px-4 py-3.5">
        <h2 className="text-sm font-medium text-foreground">Notes — how to treat this source</h2>
        {notes ? (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {notes}
          </p>
        ) : (
          // "No notes yet" is a real answer for a source nobody has written up.
          <p className="mt-1.5 text-[12.5px] italic text-muted-foreground">
            No notes have been written for this source.
          </p>
        )}
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Freeform on purpose: quirks, treatment rules, and what a statement never tells you.
          Contact details live in the vault and are referenced here, never pasted.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold text-foreground">Ledger accounts fed here</h2>
        {source.ledger_accounts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No balance-sheet account is carried for this source. That is normal for a flow or
            document source — a card, a processor or a Drive folder moves money that settles into a
            bank account rather than holding any itself.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {source.ledger_accounts.map((no) => (
              <li key={no}>
                {/* The drill-down only works inside a book: `…/ledger?account=`
                    is entity-scoped, and an unattributed source has no book to
                    scope it to. So the link is a link only when there is one. */}
                {source.entity ? (
                  <Link
                    href={scopedHref(base, '/ledger', { entity: source.entity, exercice: scope.exercice }, { account: no })}
                    className="inline-block rounded border border-border px-2 py-1 font-mono text-[12px] text-foreground hover:border-primary hover:text-primary-strong"
                  >
                    {no}
                  </Link>
                ) : (
                  <span
                    className="inline-block rounded border border-dashed border-border px-2 py-1 font-mono text-[12px] text-muted-foreground"
                    title="This source names no book, so there is no ledger to open it in."
                  >
                    {no}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {source.runbook ? (
        <div className="mb-6">
          <RunbookPanel runbook={source.runbook} source={source} />
        </div>
      ) : (
        <section className="mb-6 rounded-lg border border-dashed border-border px-4 py-3.5">
          <h2 className="text-sm font-medium text-foreground">No pull runbook</h2>
          {/* The consequence differs by source, so the sentence does. Written
              unconditionally first and caught in the browser: it told a reader
              looking at a RETIRED card that the steps live in somebody's head,
              which is a gap in an operation that has stopped. */}
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {source.retired ? (
              <>
                Nothing records how this source was pulled. It is retired, so nothing more is
                expected from it — what is lost is the account of how the files above were obtained,
                which matters for as long as they have to be defensible.
              </>
            ) : cadenceKnown ? (
              <>
                Nothing records how this source is pulled, and it is expected {source.expected}. That
                is a gap in the operation and not only in the documentation: the steps live in
                somebody&apos;s head, and the status above measures whether they were followed.
              </>
            ) : (
              <>
                Nothing records how this source is pulled. No cadence is expected either, so nothing
                is overdue — but there is also nothing written down for whoever pulls it next.
              </>
            )}
          </p>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">
          Files pulled from this source
          {source.pulls.length > 0 && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {source.pulls.length}
            </span>
          )}
        </h2>
        <p className="mb-2 max-w-2xl text-[12.5px] text-muted-foreground">
          Our copy, on our side. These are pièces comptables — hashed at capture, kept ten years
          (art. 958f CO). The institution&apos;s portal is a convenience; this is the archive.
        </p>
        <DataTable
          rows={source.pulls}
          columns={pullColumns}
          rowKey={(p) => p.file}
          initialSort={{ key: 'pulled', direction: 'desc' }}
          // Two different empties, because a Drive-worker source keeps its files
          // in the MANIFEST below and having none here is expected of it.
          // Written as one sentence first, which told a reader of source #8 —
          // six files, all extracted — that the register was measuring their
          // absence.
          empty={
            source.type === 'drive_folder'
              ? 'No files have been pulled by hand from this source. A Drive folder is polled by the worker instead, and what it holds is in the manifest below.'
              : 'No files have been pulled from this source. For a source imported by hand that is the ordinary state; for one with a cadence it is the thing the status above is measuring.'
          }
        />
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">File manifest</h2>
        <p className="mb-2 max-w-2xl text-[12.5px] text-muted-foreground">
          The worker&apos;s own ledger of this source&apos;s Drive folder — every file it has seen
          and where each sits in the state machine. It answers &ldquo;did we miss a file?&rdquo; as a
          query, so nobody re-lists Drive to find out.
        </p>
        <ManifestTable
          files={manifest.data?.files}
          isLoading={manifest.isLoading}
          error={manifest.error}
          base={base}
          scope={scope}
        />
        {/* What the SERVER answered for. The envelope echoes the source #number,
            and comparing it is the only way to notice a request that resolved to
            a different source than the URL asked for. */}
        {manifest.data && manifest.data.source !== source.number && (
          <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-foreground" role="alert">
            This manifest is for source #{manifest.data.source}, not #{source.number}. Do not read
            it as this source&apos;s.
          </p>
        )}
      </section>
    </>
  )
}
