'use client'

// The receipts inbox — one row per document the capture pipeline delivered.
//
// ===========================================================================
// NOTHING ON THIS SCREEN CHANGES A BALANCE
// ===========================================================================
// A pièce is a document. It is not an écriture, it never posts, and no
// derivation in this app reads `books.piece_inbox`. What a human does here is
// decide what each document PROVES — and even that is interpretation, not
// accounting.
//
// ===========================================================================
// A FLAGGED PIÈCE IS NORMAL TRAFFIC. IT IS NOT DRAWN IN RED.
// ===========================================================================
// The ingest route enforces four rules and this screen has to make all four
// legible:
//
//   1. everything lands STAGED, never auto-posted
//   2. idempotent on (file_id, checksum) — a retry converges
//   3. the SERVER re-validates; the worker's own verdict is stored and read by
//      nothing
//   4. duplicates are FLAGGED, never dropped
//
// Rule 4 and the "flag, never drop" half of validation are the ones a screen
// gets wrong. A payload that fails validation still lands, staged and flagged,
// **on purpose**: a bad sum is exactly the document a human must see, and
// refusing it at the door would hide it in the worker's retry queue. So a
// flagged pièce is the system working, and drawing it in the destructive tint
// would teach the reader to treat the inbox as an error log.
//
// The one red thing on this screen is the SERVER's own status chip, whose colour
// comes down from `/api/meta` with the value — and colours travel with values in
// this app, never from CSS. What this file adds around it is neutral.
//
// ── RULE 3, MADE VISIBLE ────────────────────────────────────────────────
// The detail panel shows the server's verdict and, when they disagree, says the
// worker claimed otherwise. Seeded pièce #5 is the case: the worker's block says
// `passed: true`, the server recomputed and found nothing supports the total.
// Showing only ours would be correct and would waste the evidence; showing the
// worker's as if it were a verdict would be the bug rule 3 exists to prevent.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ExternalLink, Inbox } from 'lucide-react'
import { transactionOf } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { en } from '@/lib/label'
import { money } from '@/lib/format'
import { DateText } from './date-text'
import { Money } from './money'
import { EmptyState } from './states'
import { MatchPieceForm } from './match-piece-form'

// The match control was withheld for one day in August 2026, behind a flag,
// while `matchPiece` could attach a pièce across two legal entities. The
// boundary holds and the flag is gone; the episode is in `docs/changelog/
// books.md` under "Sources, pièces and the fifth write", which is where a
// reader looking for "was this ever off, and why" will actually look. A
// permanently-true constant guarding nothing is not that record.
import type { Entity, InboxPiece, PieceExtractionLine } from '@/lib/types'
import type { MatchResult } from '@/lib/mutations'

export function PiecesInbox({
  ws,
  pieces,
  entities,
  base,
  scope,
  highlight,
}: {
  ws: string | undefined
  pieces: InboxPiece[]
  /** The books, so a match form can name the journal its number is read in. */
  entities: Entity[]
  base: string
  scope: { entity: string | null; exercice: number | null }
  /** A #number to open on arrival — the manifest links in with `?piece=`. */
  highlight?: number | null
}) {
  if (pieces.length === 0) {
    return (
      <EmptyState title="The inbox is empty." icon={Inbox}>
        <p>
          Nothing has been captured yet. Documents arrive here from the Drive worker, never as an
          upload — there is no file picker in this product, and there is not meant to be.
        </p>
      </EmptyState>
    )
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {pieces.map((p) => (
        <PieceRow
          key={p.number}
          ws={ws}
          piece={p}
          entities={entities}
          base={base}
          scope={scope}
          openByDefault={highlight === p.number}
        />
      ))}
    </ul>
  )
}

function PieceRow({
  ws,
  piece,
  entities,
  base,
  scope,
  openByDefault,
}: {
  ws: string | undefined
  piece: InboxPiece
  entities: Entity[]
  base: string
  scope: { entity: string | null; exercice: number | null }
  openByDefault: boolean
}) {
  const [open, setOpen] = useState(openByDefault)
  const tx = transactionOf(piece.extraction)
  /**
   * What this session just attached, kept so the row can say so.
   *
   * The cache is invalidated on success, so the refetched pièce carries
   * `matched_entry` and this state is redundant within a tick — except when the
   * refetch is slow or fails, and a row that silently keeps offering "attach"
   * after a write succeeded is how somebody submits twice. Same reasoning as
   * the worklist's `ResolvedMap`, one screen along.
   */
  const [justMatched, setJustMatched] = useState<MatchResult | null>(null)
  const matchedEntry = piece.matched_entry ?? justMatched?.matched_entry ?? null
  const matchedJournal = piece.matched_journal ?? justMatched?.matched_journal ?? null

  return (
    <li className="py-3" data-piece={piece.number} data-needs-review={piece.needs_review}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-0.5 hidden shrink-0 text-muted-foreground hover:text-foreground sm:block"
          aria-label={open ? 'Hide detail' : 'Show detail'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{piece.merchant}</span>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              pièce #{piece.number}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
            <Money value={piece.total} className="font-medium text-foreground" />
            <DateText value={piece.date} />
            {/* ── DELIBERATELY NOT A CHIP ──────────────────────────────
                A pièce's lifecycle is `staged | matched`, and `staged` HAPPENS
                to be spelled the same as an écriture's. There is no
                `piece_status` vocabulary on `/api/meta`, so a chip here could
                only borrow `entry_status` — which would put the entry
                vocabulary's colour and its label over a document, claiming a
                staged écriture waiting to post where there is a document
                waiting for a judgment. Colours travel with values in this app;
                borrowing one is the same fault as spelling it in CSS.
                A backend request: serve a `piece_status` vocabulary. */}
            <span className="font-mono uppercase tracking-wider" data-status={piece.status}>
              {piece.status}
            </span>
            {piece.entity ? (
              <span className="font-mono">{piece.entity}</span>
            ) : (
              // Attribution is the judgment this row is waiting for, so its
              // absence is stated rather than left blank.
              <span className="italic" data-entity="none">
                no book yet
              </span>
            )}
            <span>{piece.document_type}</span>
          </div>

          {/* ── THE TWO FLAGS, AS JUDGMENTS TO MAKE ────────────────────── */}
          {piece.needs_review && (
            <p className="mt-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px] text-foreground">
              <span className="font-medium">A person needs to look at this.</span>{' '}
              {piece.validation.problems.length > 0
                ? piece.validation.problems.join('; ')
                : 'The server flagged it during validation.'}{' '}
              <span className="text-muted-foreground">
                It landed anyway, and that is deliberate — refusing it at the door would hide it in
                the worker&apos;s retry queue.
              </span>
            </p>
          )}

          {piece.duplicate_of !== null && (
            <p className="mt-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px] text-foreground">
              <span className="font-medium">
                Same content as pièce #{piece.duplicate_of}.
              </span>{' '}
              <span className="text-muted-foreground">
                Flagged, never dropped: a refund and a re-scan look identical and mean different
                money, so which one this is stays a human&apos;s call.
              </span>
            </p>
          )}

          {matchedEntry !== null && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Documents{' '}
              {matchedJournal === 'grand_livre' && piece.entity ? (
                <Link
                  href={scopedHref(base, `/ledger/${matchedEntry}`, {
                    entity: piece.entity,
                    exercice: scope.exercice,
                  })}
                  className="font-mono text-primary-strong hover:underline"
                >
                  entry #{matchedEntry}
                </Link>
              ) : (
                // A recettes-dépenses row has no detail page — `/ledger/{n}`
                // reads `books.entry` and would open a DIFFERENT record. So the
                // number is a fact here, never a link. Same rule the worklist
                // follows for an RI row.
                <span className="font-mono text-foreground">
                  {matchedJournal === 'recettes_depenses' ? 'recettes-dépenses' : 'entry'} #
                  {matchedEntry}
                </span>
              )}
              . Matching writes the entry&apos;s pièce reference and deliberately does not change
              its evidence tier — whether a receipt turns partial into full is a sufficiency
              judgment, and judgments stay human.
            </p>
          )}

          {/* ── THE WRITE IS WITHHELD, AND THIS IS WHY ────────────────────────
              `matchPiece`'s grand-livre branch resolves the entry number on
              `workspace_id + seq` ALONE — no entity filter, where its own
              recettes-dépenses branch three lines above has one. `books.entry.seq`
              is workspace-unique, so the number resolves, and a pièce belonging
              to one legal entity attaches cleanly to ANOTHER entity's entry.

              The phase-3 review did it from this form: on a posted AIOS entry it
              replaced the Drive reference and the sha256 of the document already
              proving it, wrote a NULL hash, left `evidence_tier` at `full`, and
              recorded nothing in `history` — `resolveEntry` writes history,
              `matchPiece` does not.

              Two legal entities' books must never mix. The plan calls that law,
              not a preference, and this route can break it.

              A client-side guard would be theatre: the boundary is the server,
              and `bk books piece match` reaches it either way. Constraining the
              input to entity-scoped candidates would close OUR path, but the
              inbox route does not serve them (`candidatesFor` exists; only the
              worklist uses it), so that needs the backend too.

              So the affordance is withheld until the server filters by entity.
              `<MatchPieceForm>` and `useMatchPiece` are complete and tested and
              stay in the tree — re-enabling is deleting this condition. Reported
              on ticket #53. */}
          {matchedEntry === null && (
            <MatchPieceForm
              ws={ws}
              piece={piece}
              entities={entities}
              onMatched={setJustMatched}
            />
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[12px] text-primary-strong hover:underline sm:hidden"
          >
            {open ? 'Hide detail' : 'Detail'}
          </button>

          {open && <PieceDetail piece={piece} tx={tx} />}
        </div>
      </div>
    </li>
  )
}

function PieceDetail({
  piece,
  tx,
}: {
  piece: InboxPiece
  tx: ReturnType<typeof transactionOf>
}) {
  const lines = useMemo<PieceExtractionLine[]>(
    () => piece.extraction.lines ?? [],
    [piece.extraction]
  )
  const v = piece.validation
  // The worker's own claim, stored verbatim inside `extraction`. Read by
  // nothing that decides anything — shown only where it CONTRADICTS ours.
  const workerClaim = piece.extraction.validation?.passed
  const workerDisagrees = workerClaim !== undefined && workerClaim !== v.passed

  return (
    <div className="mt-2.5 rounded-lg border border-border px-3 py-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        <Row label="Received">
          <DateText value={piece.received} />
          {piece.pipeline && <span className="ml-2 text-muted-foreground">{piece.pipeline}</span>}
        </Row>
        <Row label="Document">
          {piece.source.web_view_link ? (
            <a
              href={piece.source.web_view_link}
              target="_blank"
              // `noopener` is not optional on a `target="_blank"` to a
              // third-party origin, and Drive does not need to know which screen
              // of an internal bookkeeping tool the click came from.
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-primary-strong hover:underline"
            >
              <ExternalLink size={11} className="shrink-0" />
              {piece.source.file_name ?? piece.source.file_id}
            </a>
          ) : (
            <span className="font-mono">{piece.source.file_name ?? piece.source.file_id}</span>
          )}
        </Row>
        <Row label="Drive file id">
          <span className="break-all font-mono text-muted-foreground">{piece.source.file_id}</span>
        </Row>
        <Row label="Checksum">
          {piece.source.md5_checksum ? (
            <span className="break-all font-mono text-muted-foreground">
              md5:{piece.source.md5_checksum}
            </span>
          ) : (
            // The checksum is what idempotency and duplicate detection are keyed
            // on. Without it, a re-scan under a new file id lands as a new
            // document and nothing flags it — so this absence is a finding.
            <span className="italic text-destructive" data-checksum="none">
              none recorded — duplicate detection cannot see this document
            </span>
          )}
        </Row>
        {tx?.ticket_number && <Row label="Ticket">{tx.ticket_number}</Row>}
        {tx?.payment_method && <Row label="Paid by">{tx.payment_method}</Row>}
        {typeof piece.extraction.confidence === 'number' && (
          <Row label="Extractor confidence">{Math.round(piece.extraction.confidence * 100)}%</Row>
        )}
      </dl>

      {/* ── THE LINES, AS THE WORKER READ THEM ────────────────────────── */}
      <div className="mt-3">
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Lines</h3>
        {lines.length === 0 ? (
          // An empty lines array is not an empty state — it is the reason
          // seeded pièce #5 failed validation ("nothing supports the total").
          <p className="mt-1 text-[12px] text-muted-foreground">
            None. The document carries a total with nothing itemised behind it — a card slip rather
            than a receipt. That is why the sum check below cannot pass.
          </p>
        ) : (
          <table className="mt-1 w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 font-normal">Line</th>
                <th className="py-1 text-right font-normal">Qty</th>
                <th className="py-1 text-right font-normal">Amount</th>
                <th className="py-1 text-right font-normal">TVA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 text-foreground">{l.description ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {l.quantity ?? '—'}
                    {l.unit === 'kg' ? ' kg' : ''}
                  </td>
                  {/* The extraction's amounts are JSON NUMBERS — this is the
                      worker's payload, not a `numeric` column — so they are
                      formatted through `money()` with no currency rather than
                      through `<Money>`, whose prop type is the guard that keeps
                      floats out of the statutory display path. */}
                  <td className="py-1 text-right tabular-nums text-foreground">
                    {money(l.amount, '')}
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {l.vat_rate === null || l.vat_rate === undefined ? '—' : `${l.vat_rate}%`}
                  </td>
                </tr>
              ))}
              {tx?.total !== undefined && (
                <tr className="border-t-2 border-foreground font-semibold">
                  <td className="py-1">Total</td>
                  <td />
                  <td className="py-1 text-right tabular-nums text-foreground">
                    {money(tx.total, '')}
                  </td>
                  <td className="py-1 text-right text-[11px] font-normal tabular-nums text-muted-foreground">
                    {(piece.extraction.vat_summary ?? [])
                      .map((s) => `${s.rate}% ${money(s.gross, '')}`)
                      .join(' · ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── THE SERVER'S VERDICT ──────────────────────────────────────── */}
      <div className="mt-3">
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Validation — recomputed here
        </h3>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <Check ok={v.lines_sum_matches_total} label="lines sum to the total" />
          <Check ok={v.vat_rates_valid} label="VAT rates in force" />
          <Check ok={v.date_plausible} label="date plausible" />
        </ul>
        {v.problems.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-[12px] text-muted-foreground">
            {v.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {workerDisagrees ? (
            <>
              <span className="font-medium text-foreground">
                The worker claimed this {workerClaim ? 'passed' : 'failed'}, and the server
                disagrees.
              </span>{' '}
              Its verdict is stored as evidence of what it said and is read by nothing — every check
              above was recomputed here from the payload&apos;s own arithmetic. This is the one
              shown, and the one to act on.
            </>
          ) : (
            <>
              Recomputed on the server from the payload&apos;s own arithmetic. The worker&apos;s own
              verdict is stored inside the extraction as evidence of what it claimed, and is read by
              nothing.
            </>
          )}
        </p>
      </div>

      {piece.extraction.notes && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          <span className="text-[11px] uppercase tracking-wider">Extractor notes</span>
          <br />
          {piece.extraction.notes}
        </p>
      )}

      {piece.note && (
        <p className="mt-3 text-[12px] text-foreground">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Note</span>
          <br />
          {en(piece.note)}
        </p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  )
}

/**
 * One deterministic check, passed or not.
 *
 * A failed check is stated in words as well as by the mark — `✓`/`✗` alone is a
 * distinction some readers cannot make, and this is a legal document's
 * arithmetic. Not tinted destructive: a failed check here is the system doing
 * its job, and the row above already says a person is needed.
 */
function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={ok ? 'text-foreground' : 'text-muted-foreground'}>
        {ok ? '✓' : '✗'}
      </span>
      <span className={ok ? 'text-muted-foreground' : 'font-medium text-foreground'}>
        {label}
        {!ok && <span className="sr-only"> — failed</span>}
      </span>
    </li>
  )
}
