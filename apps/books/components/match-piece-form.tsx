'use client'

// The fifth write: a human says what this document proves.
//
// ===========================================================================
// IT IS INTERPRETATION, NOT ACCOUNTING, AND THE FORM SAYS SO
// ===========================================================================
// Matching writes the ENTRY's `piece_*` columns — a Drive reference, a
// checksum, a capture date — and nothing else. No amount, no account, no
// balance, and **deliberately not the evidence tier**: whether a receipt turns
// `partial` into `full` is a sufficiency judgment, and this form must never
// offer to make it. There is no tier control here and there is not meant to be
// one.
//
// The count of writes in this app went from four to five for this, and both
// files that said four moved in the same change. `lib/mutations.ts`'s header
// carries the reasoning; `apps/books/docs/frontend.md` §5 carries the claim.
//
// ===========================================================================
// THE NUMBER NAMES A JOURNAL, AND THE PIÈCE'S BOOK DECIDES WHICH
// ===========================================================================
// `matchPiece` asks `journalOf(piece.entity_id)` before it looks anything up. A
// simplified book's entries are `ri_entry` rows; a double-entry book's are the
// grand livre's; an UNATTRIBUTED pièce reads as the grand livre. So the caller
// supplies the context and the server resolves the number against it — which is
// the shape ticket #51's `resolve` should be fixed into, and the reason this
// write cannot do what that one does.
//
// This form still NAMES the journal, because the caller cannot see `journalOf`
// and "#12" means two different rows in two different books. The label is read
// off `entity.bookkeeping_regime`, which is the same fact the server reads —
// **not a second copy of the rule.** If it were ever wrong the consequence is a
// refusal (`entry_not_found`), never a wrong write, and that is said out loud
// below rather than assumed.
//
// ===========================================================================
// THE REFUSALS ARE READ OFF THE RESULT, NEVER OFF `mutation.error`
// ===========================================================================
// `error` is React state and is null in the tick its setter ran. Every refusal
// this route raises is one a person can act on — `already_matched` explains why
// there is no undo, `entry_not_found` names the journal it looked in — so
// showing a generic "could not save" over any of them would tell the reader the
// app is broken. See `lib/mutations.ts`'s header for the bug this rule exists
// because of.

'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCanWrite, useMatchPiece, type MatchResult } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import type { Entity, InboxPiece } from '@/lib/types'
import { useT } from '@/lib/i18n'
import type { Translate } from '@blackcode/platform-i18n'
import type { BooksKey } from '@/lib/dictionary'

/**
 * Which journal this pièce's `--entry` number will be read in.
 *
 * Mirrors `journalOf` by reading the same field the server reads. Returns null
 * when the book is not in hand yet — the label then says so rather than
 * guessing, because naming the wrong journal is worse than naming none.
 *
 * ── AN UNATTRIBUTED PIÈCE READS AS THE GRAND LIVRE, AND THAT IS THE SERVER'S
 * RULE, NOT OURS ─────────────────────────────────────────────────────────
 * `journalOf(null)` returns `grand_livre`: *"until somebody says whose it is, it
 * cannot reach a personal recettes-dépenses book."* That is also why matching
 * one is an ATTRIBUTION — see `<AttributionWarning>` below.
 */
function journalLabel(
  piece: InboxPiece,
  entities: Entity[],
  t: Translate<BooksKey>
): string | null {
  if (piece.entity === null) return t('match.journalGrandLivre')
  const book = entities.find((e) => e.slug === piece.entity)
  if (!book) return null
  return book.bookkeeping_regime === 'simplified'
    ? t('match.journalRi')
    : t('match.journalGrandLivre')
}


/**
 * The server's sentence — or one, when the server did not send a sentence.
 *
 * ── THE MATCH ROUTE'S 404 HAS NO MESSAGE, AND THAT IS A ROUTE DEFECT ──────
 * Reproduced 2026-08-18 against the seeded workspace, on BOTH surfaces:
 *
 *     POST …/pieces/2/match {"entry":999}   →  {"error":"999","code":"entry"}
 *     bk books piece match 2 --entry 999    →  error: 999 (404)
 *
 * `matchPiece` raises `MatchRefused('entry_not_found', "no entry #999 …",
 * "the worklist shows the numbers")` — a real reason and a real recovery. The
 * route then calls `Errors.notFound(code.replace('_not_found',''), String(n))`,
 * which reaches the THREE-argument overload rather than the one-argument one:
 * `entity` becomes the code verbatim (`entry`, losing `_not_found`), `message`
 * becomes the bare number, and the suggestion is never passed. **The reason and
 * the recovery are both discarded at the boundary.** Every other refusal this
 * route raises goes through `Errors.badRequest(code, message, suggestion)` and
 * arrives intact — `already_matched` reads correctly, and this file was written
 * against that path before the 404 was tried.
 *
 * It is the backend's to fix (a route is theirs), and the report asks for it.
 * Until then this screen cannot print what it was given: "999" is not a
 * sentence, and rendering it alone tells the reader nothing about what happened.
 *
 * ── THE SUBSTITUTION IS DELIBERATELY NARROW ──────────────────────────────
 * It fires only on a 404 whose message contains no whitespace — i.e. a bare
 * token where a sentence belongs. A real sentence always has a space in it, so
 * **the day the route is fixed, the server's own words flow through untouched
 * and this branch stops firing** with nothing to remove. It is not a fallback
 * for "any failure", which would be the bug `lib/mutations.ts`'s header exists
 * about: swallowing a good message and printing a generic one.
 */
function refusalText(
  message: string,
  status: number,
  entry: number,
  journal: string | null,
  t: Translate<BooksKey>
): string {
  if (status !== 404 || /\s/.test(message.trim())) return message
  return t('match.notFound', { entry, journal: journal ?? t('match.thisJournal') })
}

export function MatchPieceForm({
  ws,
  piece,
  entities,
  onMatched,
}: {
  ws: string | undefined
  piece: InboxPiece
  entities: Entity[]
  onMatched: (result: MatchResult) => void
}) {
  const canWrite = useCanWrite()
  const t = useT()
  const match = useMatchPiece(ws, piece.number)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState('')
  const [refusal, setRefusal] = useState<{ message: string; code: string } | null>(null)
  // A double submit is two POSTs, and the second one gets `already_matched` —
  // a refusal the reader did not cause, over a write that succeeded.
  const inFlight = useRef(false)

  const journal = journalLabel(piece, entities, t)
  // ── AN UNATTRIBUTED PIÈCE IS THE CASE WITH A SIDE EFFECT ────────────────
  // `books.piece_inbox.entity_id` is nullable — a scanned receipt does not
  // always say whose it is — and this is the only thing on the screen that can
  // change that. POSITIVE: `=== null`, matching the server's own
  // `piece.entity_id ?? entry.entity_id`.
  const unattributed = piece.entity === null

  // ── THE AFFORDANCE ITSELF IS GATED, NOT ONLY WHAT IT OPENS ─────────────
  // A button that renders and then explains it cannot do anything teaches the
  // reader the app is broken rather than that they lack a permission. Phase 2
  // learned this on the resolve button.
  if (!canWrite) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">{t('match.cannotWrite')}</p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
      >
        {t('match.open')}
      </button>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return

    const n = Number(entry.trim())
    if (!Number.isInteger(n) || n < 1) {
      // Refused here rather than sent, because the route's own `missing_entry`
      // says "pass the entry #number this piece documents" — true, and less
      // useful than saying what is wrong with what was typed.
      setRefusal({
        code: 'not_a_number',
        message: t('match.notANumber', {
          value: entry.trim(),
          journal: journal ?? t('match.theEntry'),
        }),
      })
      return
    }

    inFlight.current = true
    setRefusal(null)
    // `finally`, so a refusal releases the guard too. A guard that only clears
    // on success turns one failed submit into a form nobody can use again.
    try {
      const result = await match.run({ entry: n })
      if (!result.ok) {
        // THE SERVER'S OWN SENTENCE. `message` already carries the route's
        // `suggestion` joined onto its reason — except on ONE path, below.
        setRefusal({
          message: refusalText(result.message, result.error.status, n, journal, t),
          code: result.error.code,
        })
        return
      }
      // The whole cache root: the pièce leaves the inbox count, the worklist
      // loses a row, the manifest row moves to `ingested`, and the entry now
      // carries a pièce reference that the ledger and the entry page both show.
      // Enumerating that is a list that goes stale; see `booksCacheFilter`.
      await queryClient.invalidateQueries(booksCacheFilter())
      setOpen(false)
      setEntry('')
      onMatched(result.data)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <form onSubmit={submit} className="mt-2.5 rounded-md border border-border bg-secondary/40 p-3">
      <label
        htmlFor={`match-${piece.number}`}
        className="block text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('match.label')}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">#</span>
        <input
          id={`match-${piece.number}`}
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground focus:border-primary focus:outline-none"
          placeholder="12"
        />
        <button
          type="submit"
          disabled={match.pending}
          className="rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary-strong disabled:opacity-60"
        >
          {match.pending ? t('match.attaching') : t('match.attach')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setRefusal(null)
          }}
          className="px-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          {t('match.cancel')}
        </button>
      </div>

      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {journal ? (
          <>
            {t('match.journalBefore')} <span className="text-foreground">{journal}</span>
            {t('match.journalAfter')}
          </>
        ) : (
          t('match.journalUnknown')
        )}
      </p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {t('match.writesNote')}
      </p>

      {/* ── THE ENTRY MAY REFUSE, AND THE READER IS TOLD BEFORE THE CLICK ───
          `entry_documented` (400), landed with PR #12 and live in BOTH journals:
          *"entry #n already carries a pièce — an entry cites one document;
          replacing evidence is not built until somebody needs it, on purpose."*

          The refusal renders correctly without this — it comes through
          `Errors.badRequest` with its own suggestion, so `result.message`
          carries the whole sentence. What this adds is that the rule is
          knowable BEFORE a person picks an entry. A one-to-one constraint that
          only announces itself on rejection reads as a bug; stated first, it
          reads as the design it is, and it also tells the reader what to do
          instead — which is nothing, because replacing evidence is deliberately
          not built. */}
      <p className="mt-1 text-[11.5px] text-muted-foreground" data-refusal-hint="entry_documented">
        {t('match.oneDocumentNote')}
      </p>

      {unattributed && <AttributionWarning journal={journal} />}

      {refusal && (
        <p
          role="alert"
          data-refusal={refusal.code}
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[12px] text-foreground"
        >
          {refusal.message}
        </p>
      )}
    </form>
  )
}

/**
 * A change the reader did not ask for, said BEFORE the click.
 *
 * ===========================================================================
 * MATCHING AN UNATTRIBUTED PIÈCE IS ALSO AN ATTRIBUTION
 * ===========================================================================
 * `matchPiece` sets `entity_id: piece.entity_id ?? entry.entity_id` on the
 * pièce, in the SAME TRANSACTION as the match. The backend's own comment says
 * why: *"Matching an unattributed piece IS the attribution"* — saying which
 * entry a document proves is saying whose it is. That is right, and it is a
 * second write the form was not asking about.
 *
 * A pièce with no book is not an edge case here. `books.piece_inbox.entity_id`
 * is nullable because a scanned receipt does not always say whose it is, and an
 * unattributed one is **the only kind that cannot be reached any other way**:
 * the worklist is entity- and exercice-scoped, so it never lists one, and the
 * inbox is the whole of its surface (DECISIONS.md D-G).
 *
 * ── AND IT IS ONE-WAY, WHICH IS WHY IT IS SAID FIRST ─────────────────────
 * There is no unmatch, so there is no un-attribute. Filing a receipt under the
 * wrong legal entity is exactly the mistake this product's boundary rules exist
 * to prevent, and the recovery is a conversation with the backend rather than a
 * button. A reader who learns this from the result has learned it too late.
 *
 * The journal is repeated because the two facts are the same fact seen twice: an
 * unattributed pièce reads as the GRAND LIVRE (`journalOf(null)`), so the entry
 * it can reach is a double-entry book's, so the book it will be filed under is
 * that entry's. Someone who wants it filed under a simplified book cannot do it
 * from here at all, and saying so is better than a refusal they have to decode.
 */
function AttributionWarning({ journal }: { journal: string | null }) {
  const t = useT()
  return (
    <p
      className="mt-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
      data-attribution="unattributed"
    >
      <span className="font-medium text-foreground">{t('match.attributionLead')}</span>{' '}
      {t('match.attributionBody', { journal: journal ?? t('match.journalGrandLivre') })}
    </p>
  )
}
