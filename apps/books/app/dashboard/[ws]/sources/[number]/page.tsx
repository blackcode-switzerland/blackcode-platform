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
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
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
  const t = useT()

  // A #number the address bar can hold and this app cannot use. Refused here,
  // not by the server: a 400 from `…/sources/abc` reads as a broken page.
  const parsed = Number(params.number)
  const number = Number.isInteger(parsed) && parsed > 0 ? parsed : null

  const source = useSource(params.ws, number)
  const manifest = useManifest(params.ws, number)

  return (
    <ScreenFrame title={t('source.title')}>
      <p className="mb-3">
        <Link
          href={scopedHref(base, '/sources', scope)}
          className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-primary-strong"
        >
          <ArrowLeft size={12} />
          {t('source.back')}
        </Link>
      </p>

      {number === null && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
          <p className="text-sm font-medium text-foreground">
            {t('source.notANumber', { value: params.number })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('source.notANumberBody')}</p>
        </div>
      )}

      {number !== null && source.isLoading && <Loading rows={5} label={t('source.loading')} />}
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
              {t('source.notFound', { n: number ?? '—' })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t('source.notFoundBody')}</p>
          </div>
        ) : (
          <ErrorState error={source.error} title={t('source.failed')} />
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
  const t = useT()
  const label = useLabel()
  const notes = label(source.notes_freeform)
  const cadenceKnown = !!source.expected && source.expected !== 'none'

  const pullColumns: Column<SourcePull>[] = [
    {
      key: 'file',
      header: t('source.colFile'),
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
      header: t('source.colPeriod'),
      cell: (p) => (
        <span className="text-[12px] text-muted-foreground">
          {[p.period, p.format].filter(Boolean).join(' · ') || (
            <span className="italic">{t('sources.notRecorded')}</span>
          )}
        </span>
      ),
      sortValue: (p) => p.period ?? '',
    },
    {
      key: 'hash',
      header: t('source.colHash'),
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
            {t('source.noHash')}
          </span>
        ),
      sortValue: (p) => p.hash ?? '',
    },
    {
      key: 'pulled',
      header: t('source.colPulled'),
      cell: (p) =>
        p.pulled ? (
          <DateText value={p.pulled} className="text-[12px]" />
        ) : (
          <span className="text-[12px] italic text-muted-foreground">
            {t('sources.notRecorded')}
          </span>
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
              {t('source.retiredVerdictBefore')} <DateText value={source.last_import} />{' '}
              {t('source.retiredVerdictAfter')}
            </>
          ) : source.status === 'never_connected' ? (
            // FOUND IN THE BROWSER, 2026-08-18. This branch did not exist and
            // source #9 (PostFinance) fell into the no-cadence one, which
            // explains why a status "can read current" — over a row reading
            // NEVER CONNECTED. A confident wrong explanation of a correct chip,
            // which is worse than no explanation at all.
            t('source.neverConnectedVerdict')
          ) : cadenceKnown ? (
            <>
              {t('source.cadenceVerdictBefore', { cadence: source.expected ?? '' })}{' '}
              {source.last_import ? (
                <DateText value={source.last_import} />
              ) : (
                t('sources.never')
              )}{' '}
              {t('source.cadenceVerdictAfter', {
                stale: source.windows.stale_after_days,
                gap: source.windows.gap_after_days,
              })}
            </>
          ) : (
            t('source.noCadenceVerdict')
          )}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {source.entity ? (
            <>
              {t('source.bookLabel')}{' '}
              <span className="font-mono text-foreground">{source.entity}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {t('source.notAttributedLead')}
              </span>{' '}
              {t('source.notAttributedBody')}
            </>
          )}
        </p>
      </div>

      <section className="mb-6 rounded-lg border border-border px-4 py-3.5">
        <h2 className="text-sm font-medium text-foreground">{t('source.notesTitle')}</h2>
        {notes ? (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {notes}
          </p>
        ) : (
          // "No notes yet" is a real answer for a source nobody has written up.
          <p className="mt-1.5 text-[12.5px] italic text-muted-foreground">
            {t('source.noNotes')}
          </p>
        )}
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {t('source.notesNote')}
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold text-foreground">
          {t('source.ledgerAccounts')}
        </h2>
        {source.ledger_accounts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            {t('source.noLedgerAccounts')}
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
                    title={t('source.noBookForDrill')}
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
          <h2 className="text-sm font-medium text-foreground">{t('runbook.none')}</h2>
          {/* The consequence differs by source, so the sentence does. Written
              unconditionally first and caught in the browser: it told a reader
              looking at a RETIRED card that the steps live in somebody's head,
              which is a gap in an operation that has stopped. */}
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {source.retired ? (
            t('source.noRunbookRetired')
            ) : cadenceKnown ? (
            t('source.noRunbookCadence', { cadence: source.expected ?? '' })
            ) : (
            t('source.noRunbookNoCadence')
            )}
          </p>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">
          {t('source.pullsTitle')}
          {source.pulls.length > 0 && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {source.pulls.length}
            </span>
          )}
        </h2>
        <p className="mb-2 max-w-2xl text-[12.5px] text-muted-foreground">
          {t('source.pullsLead')}
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
              ? t('source.pullsEmptyDrive')
              : t('source.pullsEmpty')
          }
        />
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">
          {t('source.manifestTitle')}
        </h2>
        <p className="mb-2 max-w-2xl text-[12.5px] text-muted-foreground">
          {t('source.manifestLead')}
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
            {t('source.manifestMismatch', {
              served: manifest.data.source,
              asked: source.number,
            })}
          </p>
        )}
      </section>
    </>
  )
}
