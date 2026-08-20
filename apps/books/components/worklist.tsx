'use client'

// The worklist — every row that needs a human, and the one place in b/books
// where a person changes a record.
//
// ===========================================================================
// THREE KINDS OF ROW, AND WHICH OF THEM HAS A BUTTON DEPENDS ON THE JOURNAL
// ===========================================================================
// `GET …/worklist` merges `books.entry`, `books.ri_entry` and — since phase 3 —
// `books.piece_inbox` into one list, and all three tables keep SEPARATE `seq`
// counters, so a row's #number from any one kind is also, usually, some other
// kind's #number. `POST /entries/{n}/resolve` used to address `books.entry`
// ONLY, so resolving an RI row by its number rewrote that entry and answered
// 200. Reproduced 2026-08-18: RI #5 (TWINT *8842, 120.00) → `books.entry` #5,
// the January payroll, in a different book. Ticket #51.
//
// ── #51 IS ANSWERED SINCE PHASE 4A, AND THE ANSWER IS CONDITIONAL ────────
// The route now reads `body.entity`: naming a SIMPLIFIED book resolves against
// that book's recettes-dépenses journal. So an `ri_entry` row HAS a button here
// now — when the scoped book is simplified, which is the condition that makes
// the request unambiguous. Verified both ways on 2026-08-19 before this screen
// was widened: with the book named the RI row changed and the grand-livre entry
// did not, and **without it the January payroll was rewritten exactly as
// before**. The commands are in `lib/resolvable.ts`'s header; the widening is
// `resolveTargetFor`, which takes the row AND the journal and is positive on
// both.
//
// A pièce still has no button, and neither does any row whose journal is not
// known. Every one of those is READ-ONLY and says so ON THE ROW, with the
// reason. Not in a footnote and not in a tooltip: the reader is looking at a row
// that behaves differently from the one above it, and the difference is not
// their fault.
//
// ── THE BRANCH IS POSITIVE, AND IT WAS NEGATIVE UNTIL IT BIT ──────────────
// (And it stayed positive through the widening, which is the harder half:
// admitting a new case is exactly when a `!==` gets written.)
// It used to read `row.kind === 'ri_entry' ? readOnly : resolveForm`. That was
// exhaustive while there were two kinds and correct on the day it was written.
// **Phase 3's backend added a third**, six pièce rows landed in the else, each
// rendered "Explain this", and pressing it would have POSTed
// `/entries/{piece.number}/resolve` — pièce #1 rewriting journal entry #1.
//
// Nothing was written wrong: a correct backend change retargeted a correct
// branch, which is CLAUDE.md finding #10's exact mechanism. `npm run typecheck`
// WAS red on `_WorklistKeys` in `lib/wire-parity.test.ts` and had been for the
// whole merge — the guard fired and nobody read it. The `row as ResolvableRow`
// cast below is what kept the compiler quiet at THIS line, and it is why the
// list is now enumerated positively: a fourth kind is a rendering nobody wrote,
// never a write nobody meant.
//
// ===========================================================================
// A SUGGESTION IS AN OPINION. NOTHING HERE APPLIES ONE.
// ===========================================================================
// `suggested_rules` is computed live by the server against the book's active
// rules and is never stored. This screen shows what each suggested rule WOULD
// explain and offers to put its explanation in the box — a human then reads it,
// edits it if they like, and presses the button. Nothing auto-applies, nothing
// pre-ticks "teach a rule", and clicking "use this" writes nothing.
//
// ===========================================================================
// A RESOLVED ROW STAYS, AND SHOWS WHAT IT WAS
// ===========================================================================
// The route serves only `unrecognized` and `inferred`, so a resolved row leaves
// the payload — the count shrinks, which is correct and is what the overview
// must follow. But "a resolved row still shows: was unrecognized" is a phase-2
// acceptance criterion and the product's whole audit claim, so the row is kept
// on screen from the resolve RESULT (which carries `history`) until the reader
// reloads. The mockup does the same thing and for the same reason.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FileText, Lock } from 'lucide-react'
import { scopedHref } from '@/lib/nav'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import { ruleAmount } from '@/lib/format'
import { suggestionsFor, type ReadScope } from '@/lib/hooks'
import { useCanWrite } from '@/lib/mutations'
import { DateText } from './date-text'
import { Money } from './money'
import { VocabChip } from './chips'
import { HistoryTrail } from './history-trail'
import { ResolveForm } from './resolve-form'
import { resolveTargetFor } from '@/lib/resolvable'
import type { Journal } from '@/lib/journal'
import { EmptyState } from './states'
import type { RecognitionRule, ResolveResult, WorklistRow } from '@/lib/types'

/** What the screen remembers about a row it just resolved, per #number. */
export type ResolvedMap = Record<string, ResolveResult>

/** A key that cannot collide across the three kinds. See the header. */
function rowId(row: WorklistRow): string {
  return `${row.kind}:${row.number}`
}

export function Worklist({
  ws,
  scope,
  journal,
  base,
  rows,
  rules,
  resolved,
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  /**
   * Which journal this book keeps. Half of the decision that lets a row write —
   * see `resolveTargetFor`. `null` means it is not known, and every row is
   * read-only until it is.
   */
  journal: Journal | null
  base: string
  rows: WorklistRow[]
  rules: RecognitionRule[] | undefined
  resolved: ResolvedMap
  onResolved: (row: WorklistRow, result: ResolveResult) => void
}) {
  const t = useT()
  if (rows.length === 0) {
    return (
      <EmptyState title={t('rec.allExplained')}>
        <p>
          {t('rec.allExplainedBody', {
            book: scope.entity ?? t('rec.thisBook'),
            year: scope.exercice ?? t('rec.thisYear'),
          })}
        </p>
      </EmptyState>
    )
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {rows.map((row) => (
        <Row
          key={rowId(row)}
          ws={ws}
          scope={scope}
          journal={journal}
          base={base}
          row={row}
          rules={rules}
          result={resolved[rowId(row)] ?? null}
          onResolved={onResolved}
        />
      ))}
    </ul>
  )
}

function Row({
  ws,
  scope,
  journal,
  base,
  row,
  rules,
  result,
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  journal: Journal | null
  base: string
  row: WorklistRow
  rules: RecognitionRule[] | undefined
  result: ResolveResult | null
  onResolved: (row: WorklistRow, result: ResolveResult) => void
}) {
  const t = useT()
  const label = useLabel()
  const [open, setOpen] = useState(false)
  const suggestions = suggestionsFor(row, rules)
  const [prefill, setPrefill] = useState<string | null>(null)
  // ── THE AFFORDANCE ITSELF IS GATED, NOT JUST WHAT IT OPENS ──────────────
  // `<ResolveForm>` refuses when this is false, and that was the whole gate
  // until it was watched: the "Explain this" button was still rendered, and
  // pressing it replaced itself with a sentence. A button that exists and does
  // nothing is a dead affordance — the reader learns the app is broken, not
  // that they cannot write. So the row says so where the button would be.
  const canWrite = useCanWrite()

  // POSITIVE on both axes, and computed once so the affordance and the form
  // cannot disagree about which journal the number is read in.
  const target = resolveTargetFor(row, journal)

  return (
    <li className="py-3" data-kind={row.kind} data-number={row.number}>
      {/* Stacked at phone width, chip-then-content above it. At 390px the
          side-by-side arrangement spent a third of the row on an empty gutter
          and squeezed the resolve form into what was left. */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:gap-2">
        {/* PROVENANCE IS PERMANENT: once resolved, the chip says what it WAS,
            not only what it now is. `result.recognition` is the server's
            conclusion; `row.recognition` is what it arrived as. */}
        {result ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <VocabChip vocabulary="recognition" value={result.recognition} />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('rec.was')}
            </span>
            <VocabChip vocabulary="recognition" value={row.recognition} />
          </span>
        ) : (
          <VocabChip vocabulary="recognition" value={row.recognition} />
        )}

        <div className="min-w-0 flex-1">
          {/* The bank's own words, first, and never overwritten. An RI row has
              no entry detail page — `/ledger/{n}` reads `books.entry` and would
              open a DIFFERENT record — so it is deliberately not a link. */}
          {row.kind === 'entry' ? (
            <Link
              href={scopedHref(base, `/ledger/${row.number}`, scope)}
              className="font-medium text-foreground hover:text-primary-strong"
            >
              {row.raw_label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{row.raw_label}</span>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
            <Money value={row.amount} className="font-medium text-foreground" />
            <DateText value={row.date} />
            <VocabChip vocabulary="evidence_tiers" value={row.evidence_tier} withNote />
            {/* `status` is null for EVERY ri_entry — a simplified book has no
                staging step. `<VocabChip>` renders nothing for a null value, so
                the absence shows as an absence rather than as `staged`.
                A PIÈCE is excluded on purpose: its lifecycle happens to spell
                `staged` the same way and does not mean the same thing, and
                there is no `piece_status` vocabulary to draw it from — so the
                chip would borrow the entry vocabulary's colour and label for a
                document. Plain text instead. See `<PiecesInbox>`. */}
            {row.kind === 'piece' ? (
              <span className="font-mono uppercase tracking-wider" data-status={row.status}>
                {row.status}
              </span>
            ) : (
              <VocabChip vocabulary="entry_status" value={row.status} />
            )}
            {row.counterparty && <span>{row.counterparty}</span>}
            <span className="font-mono">
              {row.kind} #{row.number}
            </span>
          </div>

          {/* An inferred row carries the agent's guess in `books.entry.
              explanation`, and THE WORKLIST DOES NOT SERVE IT. Rather than
              render a blank line where the mockup shows "Agent guess: …", the
              row says where the guess is. The report asks for the field. */}
          {row.recognition === 'inferred' && row.kind === 'entry' && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('rec.inferredLead')}{' '}
              <Link
                href={scopedHref(base, `/ledger/${row.number}`, scope)}
                className="text-primary-strong hover:underline"
              >
                {t('rec.inferredLink')}
              </Link>{' '}
              {t('rec.inferredAfter')}
            </p>
          )}

          {suggestions.length > 0 && !result && (
            <Suggestions suggestions={suggestions} onUse={(text) => { setPrefill(text); setOpen(true) }} />
          )}

          {result && (
            <div className="mt-1.5">
              <p className="text-[12.5px] text-foreground">
                {label(result.explanation) || '—'}
                {/* `typeof === 'number'`, not `!== null`. The resolve response is
                    built inline in the route and no shaping function pins it, so
                    `wire-parity` structurally cannot see it — renaming the field
                    server-side left 194/194 green and a clean typecheck. And
                    `undefined !== null` is TRUE, so the missing field rendered
                    "rule # taught" on an entry resolved with the box unticked: a
                    false statement about the audit trail, on the screen whose
                    whole claim is that it is defensible. F-2 of the review. */}
                {typeof result.taught_rule === 'number' && (
                  <span className="ml-1.5 font-semibold text-primary-strong">
                    {t('rec.ruleTaught', { n: result.taught_rule })}
                  </span>
                )}
              </p>
              <HistoryTrail history={result.history} />
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {t('rec.leftWorklist')}
              </p>
            </div>
          )}

          {/* POSITIVE, and enumerated on BOTH axes — the kind and the journal.
              A row with no target explains itself; nothing else reaches a write.
              See the header for what a negative test cost when a third kind
              arrived, and `lib/resolvable.ts` for what the second axis is for. */}
          {!result &&
            (target === null ? (
              <ReadOnlyReason kind={row.kind} journal={journal} base={base} scope={scope} row={row} />
            ) : !canWrite ? (
              <p className="mt-2 text-[12px] text-muted-foreground">{t('rec.cannotWrite')}</p>
            ) : (
              <>
                {!open && (
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
                  >
                    {t('rec.explainThis')}
                  </button>
                )}
                {open && (
                  <ResolveForm
                    // Remounted when a suggestion is taken, so the box picks the
                    // text up even if the form was already open. Remounting also
                    // discards a half-typed explanation, which is why "use this"
                    // is the only thing that changes the key.
                    key={prefill ?? 'blank'}
                    // The narrowing that makes #51 unreachable. `target` is
                    // non-null inside this branch and nowhere else, and it
                    // carries the journal WITH the row — **there is no cast
                    // here any more.** The old `row as ResolvableRow` was what
                    // kept the compiler quiet at the one line that mattered
                    // while `_WorklistKeys` was red for a whole merge.
                    ws={ws}
                    scope={scope}
                    target={target}
                    initialExplanation={prefill ?? ''}
                    onResolved={(r) => onResolved(row, r)}
                  />
                )}
              </>
            ))}
        </div>
      </div>
    </li>
  )
}

/**
 * Why this row has no button, said on the row.
 *
 * ── IT NAMES THE MECHANISM, NOT "NOT SUPPORTED" ───────────────────────────
 * A reader looking at rows that behave differently deserves to know it is a
 * defect being worked around and not their mistake. And an agent reading the DOM
 * gets `data-readonly`, which is the recovery.
 *
 * ── THE REASONS ARE DIFFERENT, SO THEY ARE DIFFERENT SENTENCES ───────────
 * A `piece` has no button because resolve is not what a document needs at all —
 * a pièce is matched to an entry, which is a different act with a different
 * route. An `ri_entry` used to have none because resolve hit the WRONG TABLE
 * (ticket #51); **that is fixed, and it now has one** whenever the scoped book
 * is the simplified one the row came from. What is left in its place is the
 * narrow case where the journal is not known — the books are in flight, or the
 * regime is a value this bundle does not recognise — and that is a
 * "not yet", not a defect. Collapsing these into "read-only" would tell a reader
 * something is broken when two of the three are working as designed.
 */
function ReadOnlyReason({
  kind,
  journal,
  base,
  scope,
  row,
}: {
  kind: WorklistRow['kind']
  journal: Journal | null
  base: string
  scope: ReadScope
  row: WorklistRow
}) {
  const t = useT()
  if (kind === 'piece') {
    return (
      <p
        data-readonly="piece"
        className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
      >
        <FileText size={12} className="mt-0.5 shrink-0" />
        <span>
          {t('rec.pieceLead')}{' '}
          {/* The candidates, as facts. Nothing here applies one, and the
              #numbers name whichever journal the pièce's own book keeps —
              `journalOf`, on the server. */}
          {row.suggested_entries.length > 0
            ? t('rec.pieceCould', {
                numbers: row.suggested_entries.map((n) => `#${n}`).join(', '),
              })
            : t('rec.pieceNoMatch')}{' '}
          <Link
            href={scopedHref(base, '/documents', scope)}
            className="text-primary-strong hover:underline"
          >
            {t('rec.pieceLink')}
          </Link>
          .
        </span>
      </p>
    )
  }

  // Everything else: a kind whose journal is not known, or a pair this app has
  // not been taught. Both are "not yet", and neither may write — the number
  // alone does not say which journal it names, and a write taken on a guessed
  // journal is exactly ticket #51.
  return (
    <p
      data-readonly={journal === null ? 'journal_unknown' : `${kind}_in_${journal}`}
      className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
    >
      <Lock size={12} className="mt-0.5 shrink-0" />
      <span>
        {journal === null
          ? t('rec.readOnlyUnknownJournal')
          : t('rec.readOnlyWrongJournal', { kind })}
      </span>
    </p>
  )
}

/**
 * What the machine WOULD say, and an explicit way to take it or leave it.
 *
 * Pressing "use this explanation" writes nothing: it fills the box and opens the
 * form. The person still reads it, still edits it, and still presses Resolve.
 */
function Suggestions({
  suggestions,
  onUse,
}: {
  suggestions: RecognitionRule[]
  onUse: (text: string) => void
}) {
  const t = useT()
  const label = useLabel()
  return (
    <div className="mt-1.5 space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('rec.suggestionsHeading')}
      </p>
      {suggestions.map((rule) => (
        <div key={rule.number} className="text-[12px] text-muted-foreground">
          <span className="font-mono">#{rule.number}</span> {rule.pattern.counterparty} ·{' '}
          {ruleAmount(rule.pattern.amount_chf, rule.pattern.tolerance_chf)}
          {label(rule.explanation) && <span> — {label(rule.explanation)}</span>}
          {label(rule.explanation) && (
            <button
              type="button"
              onClick={() => onUse(label(rule.explanation))}
              className="ml-1.5 text-primary-strong hover:underline"
            >
              {t('rec.useThisExplanation')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
