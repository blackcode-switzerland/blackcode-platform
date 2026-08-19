'use client'

// The journal of one book, one fiscal year — and since phase 4A there are TWO
// of them behind this one screen.
//
// ===========================================================================
// THE SCREEN BRANCHES ON THE REGIME BEFORE IT READS A ROW
// ===========================================================================
// `GET …/entries` serves the grand livre for a double-entry book and the
// recettes-dépenses journal for a simplified one, and there is **deliberately no
// marker field on the wire** — from the route's own header: *"The caller named
// the book (or accepted the default), so the caller knows which shape it gets —
// context explicit, no marker field."*
//
// So the discriminator is `bookkeeping_regime`, which `useScope()` already
// resolves, and the branch is `lib/journal.ts`'s — POSITIVE and enumerated,
// `journal === 'grand_livre'`, never `!== 'recettes_depenses'`. The reason is on
// record in `lib/resolvable.ts`: the worklist's `!== 'ri_entry'` was exhaustive
// for two kinds and, when a third arrived, failed toward a write.
//
// ── WHAT THIS SCREEN DID BEFORE THE BRANCH, IN A BROWSER, ON 2026-08-19 ────
// `/dashboard/blackcode/ledger?entity=ri` rendered the six seeded RI movements
// through grand-livre columns:
//
//   · `N°` blank on every row       — an RI journal has no `entry_no`
//   · `Status` blank on every row   — it has no posting lifecycle
//   · "This entry has no lines."    — six times, over rows that are not lines
//   · **no amount and no direction shown anywhere** — the ONLY two facts an
//     RI movement carries, and neither had a column
//   · every label linked to `/ledger/{n}`, which reads `books.entry` and opened
//     **another book's écriture** under this book's name in the header: RI #3
//     (CAISSE DE COMPENSATION VD, 640.00 dépense) opened blackcode SA's
//     WIR-PMT REF-88213 IMMOREGIE SA.
//
// The last one is this app's worst failure mode — one book's record under
// another's name — and nothing threw. This is the THIRD payload to change shape
// under a merged screen; phase 1's and phase 3's are in `phase-4a/README.md`.
//
// ── AND THE OLD EMPTY STATE BECAME UNREACHABLE WITHOUT BEING TOUCHED ──────
// This file used to carry a `simplified` empty state saying "this book keeps no
// grand livre… a screen for the simplified movements needs a route that does not
// exist yet". It was correct when written and it is gone now, both because the
// route exists and because **it was already dead**: it only rendered when the
// list came back empty, and after 4A the list comes back FULL. A correct backend
// change retargeted a correct branch — CLAUDE.md finding #10 — and the symptom
// was not an empty screen but a wrong one.
//
// ===========================================================================
// THE LIST-AND-DETAIL PATTERN THE REST OF THE APP REUSES. GET IT RIGHT ONCE.
// ===========================================================================
// A grand-livre row is one écriture, shown WHOLE: every line of it, both sides,
// because the other side is what says where the money went. `?account=` filters
// which entries appear and never which lines of them are shown — that is the
// route's behaviour and this screen must not undo it by rendering only the
// matching line.
//
// ── `?account=` ARRIVES FROM THE INCOME STATEMENT ─────────────────────────
// Each CR line carries its `accounts`, `<AccountRef>` links to here with the
// number, and this page reads it out of the URL. It is a URL a reader can
// bookmark and an agent can construct, so it is shown as a removable filter
// rather than as hidden state.
//
// ── THE #NUMBER IS THE ADDRESS, NOT THE JOURNAL NUMBER ────────────────────
// `number` is the workspace seq and is what `/ledger/{number}`, `bk books entry
// show` and a URN all take. `entry_no` is the statutory journal number, gapless
// within (entity, exercice), and is what a reader comparing against a filing
// needs. Both are shown; they are not interchangeable and the columns say so.
//
// **The two journals keep SEPARATE `seq` counters**, which is why an RI row is
// not a link: `/ledger/{n}` reads `books.entry` and there is no route that
// serves one recettes-dépenses movement. That is the same fact ticket #51 is
// about, and it is a backend ask in the report.

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { useScope, type ScopeState } from '@/lib/scope'
import { useEntries, useRiEntries } from '@/lib/hooks'
import { journalAccepts, JOURNAL_NAME, type Journal } from '@/lib/journal'
import { scopedHref } from '@/lib/nav'
import { en } from '@/lib/label'
import { ScreenFrame } from '@/components/screen-frame'
import { usePageTitle } from '@/components/books-shell'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, Loading } from '@/components/states'
import { DateText } from '@/components/date-text'
import { Money } from '@/components/money'
import { VocabChip } from '@/components/chips'
import { EntryLines } from '@/components/entry-lines'
import type { Entry, RiEntry } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`

  // Every filter comes from the URL, so a filtered ledger is a shareable page
  // and the browser's Back button undoes a filter. Same reason as the scope.
  const account = search?.get('account') ?? null
  const status = search?.get('status') ?? null
  const recognition = search?.get('recognition') ?? null

  const journal = scope.journal

  /**
   * The heading, and the SHELL is told it too.
   *
   * `<ScreenFrame title>` labels the loading and error states and nothing else,
   * so setting it here alone left the H1 reading "General ledger" over a book
   * that keeps no general ledger — the ternary was correct and rendered nowhere
   * (phase-4A review, F-5). `usePageTitle` is what reaches the header.
   *
   * `null` while the journal is unknown, so the nav label stands rather than
   * this screen guessing which document the reader is looking at.
   */
  const heading =
    journal === 'recettes_depenses'
      ? 'Receipts and expenses'
      : journal === 'grand_livre'
        ? 'General ledger'
        : 'Journal'
  usePageTitle(journal === null ? null : heading)

  // ── THE FILTERS ARE SPLIT BY WHAT THIS JOURNAL WILL ACCEPT ──────────────
  // Not by what the URL says. `?status=` and `?account=` are REFUSED by an RI
  // journal (400 `ri_no_such_filter`), not ignored, so a URL carrying one is a
  // request this screen must not send. `journalAccepts` is the one table that
  // decides it, and the rejected ones are still listed below — dropping a filter
  // silently would be a list the reader believes is narrower than it is.
  const applied = {
    account: journalAccepts(journal, 'account') ? account : null,
    status: journalAccepts(journal, 'status') ? status : null,
    recognition: journalAccepts(journal, 'recognition') ? recognition : null,
  }
  const ignored = [
    account !== null && applied.account === null ? ('account' as const) : null,
    status !== null && applied.status === null ? ('status' as const) : null,
    recognition !== null && applied.recognition === null ? ('recognition' as const) : null,
  ].filter((k): k is 'account' | 'status' | 'recognition' => k !== null)

  // Both hooks are always CALLED — hooks are not conditional — and each one is
  // enabled only for its own journal. The one that is not this book's fires no
  // request and holds no data, so there is never a moment where a payload of one
  // shape is in the slot of the other.
  const entries = useEntries(params.ws, scope, journal, {
    account: applied.account ?? undefined,
    status: applied.status ?? undefined,
    recognition: applied.recognition ?? undefined,
  })
  const riEntries = useRiEntries(params.ws, scope, journal, {
    recognition: applied.recognition ?? undefined,
  })

  const name = journal === null ? null : JOURNAL_NAME[journal]

  function clearFilter(key: string) {
    const next = new URLSearchParams(search?.toString() ?? '')
    next.delete(key)
    router.replace(`${base}/ledger?${next.toString()}`, { scroll: false })
  }

  return (
    <ScreenFrame title={heading}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          {/* The statutory document's own name, which is French for both of them
              — the same exception D-A carves out for the bilan's line labels.
              It is read from the journal, never from the book's name: two books
              of the same regime keep the same document. */}
          {name ? name.fr : '—'}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {name ? name.en : 'Resolving which journal this book keeps'}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.record?.name ?? '—'} · exercice {scope.exercice ?? '—'}
        </p>
        {journal === 'recettes_depenses' && (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            This book is kept under art. 957 al. 2 CO — recettes and dépenses, with no double entry
            behind them. There are no accounts and no posting step: a movement is a fact on
            arrival. Its net worth is on{' '}
            <Link
              href={scopedHref(base, '/patrimoine', scope)}
              className="text-primary-strong hover:underline"
            >
              the patrimoine statement
            </Link>
            , which is the other half of what that article requires.
          </p>
        )}
      </div>

      {(applied.account || applied.status || applied.recognition) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filtered
          </span>
          {applied.account && (
            <FilterPill label={`account ${applied.account}`} onClear={() => clearFilter('account')} />
          )}
          {applied.status && (
            <FilterPill label={`status ${applied.status}`} onClear={() => clearFilter('status')} />
          )}
          {applied.recognition && (
            <FilterPill
              label={`recognition ${applied.recognition}`}
              onClear={() => clearFilter('recognition')}
            />
          )}
          {applied.account && (
            <span className="text-[11.5px] text-muted-foreground">
              Whole entries that touch this account — both sides are shown, not just the matching
              line.
            </span>
          )}
        </div>
      )}

      {/* ── A DROPPED FILTER IS SAID OUT LOUD ───────────────────────────────
          The URL asked for something this journal cannot answer. Sending it is
          a 400; dropping it quietly hands the reader a LONGER list than the one
          they asked for, with nothing on the page to say so — and a list that is
          wider than its own filter chip claims is the shape of every confident
          wrong answer in this app's history. */}
      {ignored.length > 0 && (
        <p
          role="status"
          data-ignored-filters={ignored.join(',')}
          className="mb-3 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
        >
          The address asked to filter by{' '}
          <span className="font-mono text-foreground">{ignored.join(' and ')}</span>, and{' '}
          {journal === 'recettes_depenses' ? (
            <>
              this journal has neither a posting status nor accounts to filter by. The list below is
              the whole journal, unfiltered — the drill-down you followed was built for a
              double-entry book.
            </>
          ) : (
            <>
              which journal this book keeps is not known yet, so no filter has been applied. The
              list below is unfiltered.
            </>
          )}
        </p>
      )}

      {journal === null ? (
        // Not an empty table and not a guess. `null` means the books have not
        // arrived, or `?entity=` names nothing, or the regime is a value this
        // bundle does not know — and each of those is a different sentence from
        // "this book has no entries".
        <UnknownJournal scope={scope} />
      ) : journal === 'grand_livre' ? (
        <GrandLivre
          rows={entries.data}
          isLoading={entries.isLoading}
          error={entries.error}
          base={base}
          scope={scope}
          filtered={!!(applied.account || applied.status || applied.recognition)}
        />
      ) : (
        <RecettesDepenses
          rows={riEntries.data}
          isLoading={riEntries.isLoading}
          error={riEntries.error}
          scope={scope}
          filtered={!!applied.recognition}
        />
      )}
    </ScreenFrame>
  )
}

/**
 * The grand livre — one écriture per row, shown whole.
 *
 * Unchanged from phase 1 except that it is now reached only for a
 * `grand_livre` book, which is what makes every column on it true.
 */
function GrandLivre({
  rows,
  isLoading,
  error,
  base,
  scope,
  filtered,
}: {
  rows: Entry[] | undefined
  isLoading: boolean
  error: unknown
  base: string
  scope: ScopeState
  filtered: boolean
}) {
  const columns = useMemo<Column<Entry>[]>(
    () => [
      {
        key: 'entry_no',
        header: 'N°',
        cell: (e) => (
          <span className="font-mono text-[12px] text-muted-foreground">{e.entry_no}</span>
        ),
        sortValue: (e) => e.entry_no,
      },
      {
        key: 'date',
        header: 'Date',
        cell: (e) => <DateText value={e.date} />,
        // The ISO string sorts correctly as text and needs no Date. See
        // `components/date-text.tsx` for why that matters here specifically.
        sortValue: (e) => e.date,
      },
      {
        key: 'label',
        header: 'Entry',
        cell: (e) => (
          <div className="min-w-0">
            <Link
              href={scopedHref(base, `/ledger/${e.number}`, scope)}
              className="font-medium text-foreground hover:text-primary-strong"
            >
              {/* The bank's own words. Never overwritten, and the first thing on
                  the row — the whole product is about explaining these. */}
              {e.raw_label}
            </Link>
            {e.counterparty && (
              <span className="ml-2 text-[12px] text-muted-foreground">{e.counterparty}</span>
            )}
            <EntryLines lines={e.lines} base={base} scope={scope} />
          </div>
        ),
        sortValue: (e) => e.raw_label,
      },
      {
        key: 'recognition',
        header: 'Recognition',
        cell: (e) => <VocabChip vocabulary="recognition" value={e.recognition} />,
        sortValue: (e) => e.recognition,
      },
      {
        key: 'evidence',
        header: 'Evidence',
        cell: (e) => <VocabChip vocabulary="evidence_tiers" value={e.evidence_tier} withNote />,
        sortValue: (e) => e.evidence_tier,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (e) => <VocabChip vocabulary="entry_status" value={e.status} />,
        sortValue: (e) => e.status,
      },
      {
        key: 'number',
        header: '#',
        numeric: true,
        cell: (e) => <span className="font-mono text-[12px] text-muted-foreground">{e.number}</span>,
        sortValue: (e) => e.number,
      },
    ],
    [base, scope]
  )

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(e) => e.number}
      isLoading={isLoading}
      error={error}
      initialSort={{ key: 'date', direction: 'asc' }}
      empty={
        filtered ? (
          <EmptyState title="No entry matches these filters.">
            <p>The book has entries; none of them satisfy every filter above at once.</p>
          </EmptyState>
        ) : (
          <EmptyState title="No entries in this exercice.">
            <p>
              Nothing has been posted or staged for {scope.record?.name ?? 'this book'} in{' '}
              {scope.exercice ?? 'this year'}.
            </p>
          </EmptyState>
        )
      }
    />
  )
}

/**
 * The recettes-dépenses journal — art. 957 al. 2 CO's half of a simplified book.
 *
 * ===========================================================================
 * WHAT IS ON A ROW HERE, AND WHY IT IS NOT THE SAME COLUMNS
 * ===========================================================================
 * A movement carries ONE amount and a DIRECTION. There is no debit and no
 * credit, no chart account, no journal number and no posting status — those are
 * facts about a double entry and this is not one. Rendering the grand livre's
 * columns here produced four blank cells and a false sentence; see the file
 * header.
 *
 * ── THE AMOUNT AND THE DIRECTION ARE TWO COLUMNS, NOT ONE SIGNED NUMBER ───
 * Folding them into a signed amount would be arithmetic on the display path,
 * and it would be WRONG in a way that matters: **`neutral` is a third
 * direction** (migration 0009 — a transfer between the owner's own accounts is
 * logged and counts in neither recettes nor dépenses), and a signed column has
 * nowhere to put it. `<Money>` also renders a negative in the destructive
 * colour, which would paint every ordinary expense red.
 *
 * ── THE DIRECTION IS NOT A CHIP, AND THAT IS A GAP, NOT A CHOICE ──────────
 * Vocabulary colours come from `/api/meta` and never from CSS or a `switch`.
 * **There is no `ri_direction` vocabulary in that payload** — the seven it
 * serves are recognition, evidence_tiers, entry_status, source_types,
 * source_layers, source_status and manifest_states. So the value is rendered as
 * the server's own word, uncoloured, which is the same treatment the worklist
 * gives a pièce's status and for the same reason: borrowing another
 * vocabulary's colour for a different fact is worse than plain text.
 * **Asking for `ri_direction` in `/api/meta` is in the report.**
 *
 * ── AND A ROW IS NOT A LINK ──────────────────────────────────────────────
 * `/ledger/{n}` reads `books.entry`. The two journals keep separate `seq`
 * counters, so this row's #number is also, usually, some écriture's #number, and
 * linking it would open a different record in a different book — which is
 * exactly what this screen was doing before the branch. There is no route
 * serving one recettes-dépenses movement; that is a backend ask.
 */
function RecettesDepenses({
  rows,
  isLoading,
  error,
  scope,
  filtered,
}: {
  rows: RiEntry[] | undefined
  isLoading: boolean
  error: unknown
  scope: ScopeState
  filtered: boolean
}) {
  const columns = useMemo<Column<RiEntry>[]>(
    () => [
      {
        key: 'date',
        header: 'Date',
        cell: (r) => <DateText value={r.date} />,
        sortValue: (r) => r.date,
      },
      {
        key: 'label',
        header: 'Movement',
        cell: (r) => (
          <div className="min-w-0">
            {/* The bank's own words, never overwritten, and NOT a link. */}
            <span className="font-medium text-foreground">{r.raw_label}</span>
            {r.counterparty && (
              <span className="ml-2 text-[12px] text-muted-foreground">{r.counterparty}</span>
            )}
            {r.explanation && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">{en(r.explanation)}</p>
            )}
          </div>
        ),
        sortValue: (r) => r.raw_label,
      },
      {
        key: 'category',
        header: 'Category',
        // What kind of movement, in place of a chart account. `{fr, en}` from the
        // server; the English side, per D-A. Null is a real value — it renders as
        // nothing rather than as an em dash, because there is no missing account
        // here for an em dash to stand in for.
        cell: (r) =>
          r.category ? (
            <span className="text-[12.5px] text-muted-foreground">{en(r.category)}</span>
          ) : null,
        sortValue: (r) => (r.category ? en(r.category) : ''),
      },
      {
        key: 'direction',
        header: 'Direction',
        // The server's own word. No colour and no translation — see the header.
        cell: (r) => (
          <span
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
            data-direction={r.direction}
          >
            {r.direction}
          </span>
        ),
        sortValue: (r) => r.direction,
      },
      {
        key: 'amount',
        header: 'Amount',
        numeric: true,
        // Unsigned, always. The sign is the Direction column beside it.
        cell: (r) => <Money value={r.amount} bare />,
        // Sorted as TEXT, deliberately — `sortValue` takes a string or a number,
        // and `Number("2800.00")` on the display path is the float this app does
        // not do. A `numeric(14,2)` string sorts wrongly as text across
        // magnitudes, so this column is sorted by the wire value and that is a
        // known limit rather than a hidden one: the honest fix is an `order`
        // parameter on the route, which `components/data-table.tsx` already says
        // is the answer for a list this one cannot sort correctly.
        sortValue: (r) => r.amount,
      },
      {
        key: 'recognition',
        header: 'Recognition',
        cell: (r) => <VocabChip vocabulary="recognition" value={r.recognition} />,
        sortValue: (r) => r.recognition,
      },
      {
        key: 'evidence',
        header: 'Evidence',
        cell: (r) => <VocabChip vocabulary="evidence_tiers" value={r.evidence_tier} withNote />,
        sortValue: (r) => r.evidence_tier,
      },
      {
        key: 'number',
        header: '#',
        numeric: true,
        cell: (r) => <span className="font-mono text-[12px] text-muted-foreground">{r.number}</span>,
        sortValue: (r) => r.number,
      },
    ],
    []
  )

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.number}
        isLoading={isLoading}
        error={error}
        initialSort={{ key: 'date', direction: 'asc' }}
        empty={
          filtered ? (
            <EmptyState title="No movement matches that filter.">
              <p>The journal has movements; none of them are in that recognition state.</p>
            </EmptyState>
          ) : (
            <EmptyState title="No movements in this exercice.">
              <p>
                Nothing has been recorded for {scope.record?.name ?? 'this book'} in{' '}
                {scope.exercice ?? 'this year'}.
              </p>
            </EmptyState>
          )
        }
      />
      {rows && rows.length > 0 && (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          A movement is shown unsigned and its direction is a column: a{' '}
          <span className="font-mono">neutral</span> transfer between your own accounts is recorded
          here and counts in neither recettes nor dépenses. These rows have no detail page — the
          two journals number themselves separately, so this #number is not an écriture&apos;s.
        </p>
      )}
    </>
  )
}

/**
 * The book, and therefore the journal, is not known.
 *
 * Three different situations, and the screen says which: the books are still in
 * flight, `?entity=` names nothing, or the regime is a value this bundle does
 * not know. None of them is "no entries", and none of them may be resolved into
 * a default journal — a default is a document somebody else chose.
 */
function UnknownJournal({ scope }: { scope: ScopeState }) {
  if (scope.isLoading || (scope.entity !== null && scope.record === null && scope.entities.length === 0)) {
    return <Loading rows={6} label="Loading the journal" />
  }

  if (scope.record === null) {
    return (
      <EmptyState title="No book by that name.">
        <p>
          The address asks for <span className="font-mono">{scope.entity ?? '—'}</span>, and this
          account has no book with that name. Choose one from the switcher above.
        </p>
      </EmptyState>
    )
  }

  // The book resolved and its regime is a value this bundle does not know. The
  // list is not requested, because which shape the route would answer with is
  // exactly what is unknown.
  return (
    <EmptyState title="This book keeps a journal this version does not know.">
      <p>
        {scope.record.name} records its bookkeeping regime as{' '}
        <span className="font-mono text-foreground">{scope.record.bookkeeping_regime}</span>, and
        this app knows how to read a journal for a double-entry book and for a simplified one.
      </p>
      <p className="mt-2">
        Nothing has been requested, because the shape of the answer is what is unknown — showing you
        one of the two would be a guess. <span className="font-mono">bk books entry list</span>{' '}
        reads it either way.
      </p>
    </EmptyState>
  )
}

function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-[1px] text-[11px] text-foreground">
      <span className="font-mono">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove the ${label} filter`}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={11} />
      </button>
    </span>
  )
}
