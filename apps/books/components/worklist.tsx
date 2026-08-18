'use client'

// The worklist — every row that needs a human, and the one place in b/books
// where a person changes a record.
//
// ===========================================================================
// THREE KINDS OF ROW, AND ONLY ONE OF THEM HAS A BUTTON
// ===========================================================================
// `GET …/worklist` merges `books.entry`, `books.ri_entry` and — since phase 3 —
// `books.piece_inbox` into one list. `POST /entries/{n}/resolve` addresses
// `books.entry` ONLY, and all three tables keep SEPARATE `seq` counters, so a
// row's #number from any other kind is also, usually, some journal entry's
// #number. Resolving by it rewrites that entry and answers 200. Reproduced
// 2026-08-18: RI #5 (TWINT *8842, 120.00) → `books.entry` #5, the January
// payroll, in a different book. Raised on ticket #51.
//
// Until that is answered, only an `entry` row has a button. Every other kind is
// READ-ONLY and says so ON THE ROW, with the reason. Not in a footnote and not
// in a tooltip: the reader is looking at a row that behaves differently from the
// one above it, and the difference is not their fault.
//
// ── THE BRANCH IS POSITIVE, AND IT WAS NEGATIVE UNTIL IT BIT ──────────────
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

import { useState } from 'react'
import Link from 'next/link'
import { FileText, Lock } from 'lucide-react'
import { scopedHref } from '@/lib/nav'
import { en } from '@/lib/label'
import { ruleAmount } from '@/lib/format'
import { suggestionsFor, type ReadScope } from '@/lib/hooks'
import { useCanWrite } from '@/lib/mutations'
import { DateText } from './date-text'
import { Money } from './money'
import { VocabChip } from './chips'
import { HistoryTrail } from './history-trail'
import { ResolveForm } from './resolve-form'
import { isResolvable, type ResolvableRow } from '@/lib/resolvable'
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
  base,
  rows,
  rules,
  resolved,
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  base: string
  rows: WorklistRow[]
  rules: RecognitionRule[] | undefined
  resolved: ResolvedMap
  onResolved: (row: WorklistRow, result: ResolveResult) => void
}) {
  if (rows.length === 0) {
    return (
      <EmptyState title="Everything is explained.">
        <p>
          Nothing in {scope.entity ?? 'this book'} for {scope.exercice ?? 'this year'} is waiting
          for a human. That is the goal state, not an empty screen.
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
  base,
  row,
  rules,
  result,
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  base: string
  row: WorklistRow
  rules: RecognitionRule[] | undefined
  result: ResolveResult | null
  onResolved: (row: WorklistRow, result: ResolveResult) => void
}) {
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
              was
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
              Something already proposed a meaning for this.{' '}
              <Link
                href={scopedHref(base, `/ledger/${row.number}`, scope)}
                className="text-primary-strong hover:underline"
              >
                Read it on the entry
              </Link>{' '}
              before confirming — the worklist does not carry it.
            </p>
          )}

          {suggestions.length > 0 && !result && (
            <Suggestions suggestions={suggestions} onUse={(text) => { setPrefill(text); setOpen(true) }} />
          )}

          {result && (
            <div className="mt-1.5">
              <p className="text-[12.5px] text-foreground">
                {en(result.explanation) || '—'}
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
                    rule #{result.taught_rule} taught
                  </span>
                )}
              </p>
              <HistoryTrail history={result.history} />
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                It has left the worklist. It stays here, showing what it was, until you reload.
              </p>
            </div>
          )}

          {/* POSITIVE, and enumerated. `kind === 'entry'` is the only path to a
              write; everything else explains itself. See the header for what a
              negative test cost when a third kind arrived. */}
          {!result &&
            (!isResolvable(row) ? (
              <ReadOnlyReason kind={row.kind} base={base} scope={scope} row={row} />
            ) : !canWrite ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                This session cannot change records.
              </p>
            ) : (
              <>
                {!open && (
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
                  >
                    Explain this
                  </button>
                )}
                {open && (
                  <ResolveForm
                    // Remounted when a suggestion is taken, so the box picks the
                    // text up even if the form was already open. Remounting also
                    // discards a half-typed explanation, which is why "use this"
                    // is the only thing that changes the key.
                    key={prefill ?? 'blank'}
                    // The narrowing that makes the RI bug unreachable. `row` is
                    // `kind: 'entry'` inside this branch and nowhere else.
                    ws={ws}
                    scope={scope}
                    row={row as ResolvableRow}
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
 * gets `data-readonly` plus the ticket, which is the recovery.
 *
 * ── THE TWO REASONS ARE DIFFERENT, SO THEY ARE TWO SENTENCES ─────────────
 * An `ri_entry` has no button because resolve would hit the WRONG TABLE
 * (ticket #51). A `piece` has no button because resolve is not what a document
 * needs at all — a pièce is matched to an entry, which is a different act with
 * a different route. Collapsing them into "read-only" would tell a reader the
 * inbox is broken when it is somewhere else on purpose.
 */
function ReadOnlyReason({
  kind,
  base,
  scope,
  row,
}: {
  kind: WorklistRow['kind']
  base: string
  scope: ReadScope
  row: WorklistRow
}) {
  if (kind === 'piece') {
    return (
      <p
        data-readonly="piece"
        className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
      >
        <FileText size={12} className="mt-0.5 shrink-0" />
        <span>
          This is a document, not a transaction. Explaining is not what it needs — a pièce is
          attached to the entry it proves, and{' '}
          {row.suggested_entries.length > 0 ? (
            <>
              this one could document{' '}
              {/* The candidates, as facts. Nothing here applies one, and the
                  #numbers name whichever journal the pièce's own book keeps —
                  `journalOf`, on the server. */}
              <span className="font-mono text-foreground">
                {row.suggested_entries.map((n) => `#${n}`).join(', ')}
              </span>
              .{' '}
            </>
          ) : (
            <>nothing in the books matches its amount and date yet. </>
          )}
          <Link
            href={scopedHref(base, '/documents', scope)}
            className="text-primary-strong hover:underline"
          >
            Open it in supporting documents
          </Link>
          .
        </span>
      </p>
    )
  }

  return (
    <p
      data-readonly="ri_entry"
      className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
    >
      <Lock size={12} className="mt-0.5 shrink-0" />
      <span>
        Read-only. This row is from the simplified book, and the resolve route addresses the
        double-entry journal only — the two number series overlap, so resolving this row by its
        number would rewrite an unrelated entry. Raised with the backend on ticket #51.
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
  return (
    <div className="mt-1.5 space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        A rule would explain this — nothing has applied it
      </p>
      {suggestions.map((rule) => (
        <div key={rule.number} className="text-[12px] text-muted-foreground">
          <span className="font-mono">#{rule.number}</span> {rule.pattern.counterparty} ·{' '}
          {ruleAmount(rule.pattern.amount_chf, rule.pattern.tolerance_chf)}
          {en(rule.explanation) && <span> — {en(rule.explanation)}</span>}
          {en(rule.explanation) && (
            <button
              type="button"
              onClick={() => onUse(en(rule.explanation))}
              className="ml-1.5 text-primary-strong hover:underline"
            >
              use this explanation
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
