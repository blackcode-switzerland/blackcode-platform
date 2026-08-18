'use client'

// Pièces justificatives — the receipts inbox.
//
// ===========================================================================
// THIS IS THE MOCKUP'S `app-pieces.html`, AT THE NAV'S OWN PATH
// ===========================================================================
// The phase-3 plan calls this screen `/dashboard/{ws}/pieces`. The nav has had
// a `paperclip` item at `/documents` labelled "Supporting documents" since phase
// 0, sitting THIRD on purpose — above the general ledger, because every entry
// legally needs its document (art. 958f CO) and burying the inbox says the
// opposite.
//
// Building at `/pieces` would have left that item pointing at `<NotBuiltYet>`
// and put the real screen at an address nothing links to. So the inbox lands
// here, on the item that was always meant for it, and the plan's path is the
// thing that moves. Recorded in the report, not decided in silence.
//
// ── IT IS NOT SCOPED TO A BOOK, AND `lib/nav.ts` NOW SAYS SO ─────────────
// `books.piece_inbox.entity_id` is NULLABLE — a scanned receipt does not always
// say whose it is, and deciding that is one of the judgments this screen exists
// for. A book filter would hide exactly the documents that need attributing.
//
// So the item is `scoped: false` and the switcher is hidden, rather than shown
// over a list it does not change. That is `lib/nav.ts`'s own rule: a control
// that appears to do nothing is worse than an absent one, because the reader
// assumes they used it wrong.
//
// ── THE ONE WRITE ────────────────────────────────────────────────────────
// Attaching a pièce to an entry is the FIFTH write in this app, and the count
// moved from four to five in the same change that added it. The reasoning is in
// `lib/mutations.ts`'s header and the claim is in
// `apps/books/docs/frontend.md` §5; DECISIONS.md D-G is the question it answers.
// It changes no balance: it writes the entry's document reference, checksum and
// capture date, and deliberately not its evidence tier.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
//   an upload control     documents are Drive references, never uploads. There
//                         is no file picker in this product and there is not
//                         meant to be one. `pieces/ingest` is the robot door: an
//                         external worker holds a token and posts to it.
//   "entries without a
//    document"            the mockup's third section. It is phase-1 data
//                         (`GET …/entries`, per book) on a phase-3 screen, and
//                         half-building it would put a book-scoped table under a
//                         heading that is not. Raised in the report.

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { usePieces } from '@/lib/hooks'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { PiecesInbox } from '@/components/pieces-inbox'
import { useScope } from '@/lib/scope'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const search = useSearchParams()
  const base = `/dashboard/${params.ws}`

  // The whole inbox. See the header: filtering by book hides the documents that
  // have none, which are the ones a person is here to attribute.
  const pieces = usePieces(params.ws)

  // `?piece=5` — where a manifest row links in. A #number that is not in the
  // list simply opens nothing, which is the right behaviour for a bookmark that
  // has gone stale.
  const highlight = useMemo(() => {
    const raw = search?.get('piece')
    if (!raw) return null
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [search])

  const rows = pieces.data ?? []
  /**
   * How many documents are waiting on a person.
   *
   * `needs_review` OR not yet matched. Deliberately NOT `rows.length`: a matched
   * pièce is still in the inbox and still worth reading, and a count that never
   * shrinks teaches the reader to ignore it.
   */
  const toHandle = rows.filter((p) => p.needs_review || p.matched_entry === null).length

  return (
    <ScreenFrame title="Supporting documents">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          Pièces justificatives{' '}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            Supporting documents
          </span>
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
          Every entry needs its document (art. 957a al. 3 CO), kept ten years (art. 958f). Google
          Drive is the inbox and the human view; the legal archive is a separate immutable copy.
          b/books keeps references, hashes and capture dates — never the file itself.
        </p>
        <p className="mt-1.5 max-w-2xl text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">Nothing here changes a balance.</span> A
          document is not an écriture: it lands staged, it never posts, and no statement reads this
          table. This list is the whole inbox and is not filtered by book — a scanned receipt does
          not always say whose it is, and saying so is one of the judgments this screen is for.
        </p>
        {/* ── THE WITHHELD WRITE, NAMED ON THE SCREEN ──────────────────────────
            Attaching a pièce to the entry it proves is a capability this product
            has: `POST /pieces/{n}/match` and `bk books piece match` both ship,
            and `<MatchPieceForm>` is built and tested. It is switched off here
            because `matchPiece`'s grand-livre branch resolves the entry on
            `workspace_id + seq` with no entity filter — see the block at its
            mount site in `components/pieces-inbox.tsx`.

            Withholding it is right. Withholding it SILENTLY was not: until
            2026-08-18 this screen listed six documents a person could read and
            not act on, said nothing about why, and the recognition screen sent
            readers here with "Open it in supporting documents" — a dead end that
            did not name its own exit. That is the rule this repo applies to
            every `bk` failure and it holds for a screen.

            ── AND THE FIRST DRAFT OF THIS PARAGRAPH POINTED AT THE CLI ──────
            It read "the way to do it is `bk books piece match`, which resolves
            the entry through the pièce's own book", on the strength of
            `matchPiece` calling `journalOf(piece.entity_id)` first and of
            DECISIONS.md D-G saying the same. **Both are wrong about what that
            call does.** `journalOf` chooses WHICH JOURNAL — grand livre or
            recettes-dépenses — and the recettes-dépenses branch then filters on
            `entity_id` while the grand-livre branch does not.

            Reproduced against the seeded workspace before this copy shipped:
            `bk books piece match 1 --entry 16` printed `matched piece #1 ->
            entry #16` and exited 0, attaching blackcode SA's receipt to AIOS
            Companion SA's écriture — overwriting the Drive reference and the
            sha256 of the document already proving it with a NULL hash, leaving
            `evidence_tier` at `full`, and writing nothing to `history`. The
            data was restored.

            So there is no workaround to point at, and this paragraph says that
            instead of sending a reader to the same defect through a different
            door. It goes when the server filters by entity — ticket #53. */}
        <p className="mt-1.5 max-w-2xl text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">
            Attaching a document to the entry it proves is switched off.
          </span>{' '}
          The form is built and withheld: it resolves the entry by number without checking which
          book that entry belongs to, so it can attach one company&apos;s receipt to another
          company&apos;s écriture — and overwrite the reference and checksum of the document
          already proving it. The command-line route has the same gap, so it is not a way round.
          Nothing is lost meanwhile: a document that is here is kept and hashed, and matching is
          an interpretation added later.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">
          Inbox
          {pieces.data && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {toHandle} to handle · {rows.length} in all
            </span>
          )}
        </h2>
      </div>

      {pieces.isLoading && <Loading rows={4} label="Loading the inbox" />}
      {pieces.error && <ErrorState error={pieces.error} title="The inbox could not be loaded" />}
      {pieces.data && (
        <PiecesInbox
          ws={params.ws}
          pieces={rows}
          entities={scope.entities}
          base={base}
          scope={scope}
          highlight={highlight}
        />
      )}

      <section className="mt-6 rounded-lg border border-dashed border-border px-4 py-3.5">
        <h2 className="text-sm font-medium text-foreground">How documents get here</h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Paper receipts are scanned with the stock Google Drive app into an inbox folder. A
          stateless worker polls it, a vision model extracts the fields against a fixed schema, and
          deterministic checks — the sum, the Swiss VAT rates, the date — run{' '}
          <span className="font-medium text-foreground">outside the model, on the server</span>. The
          worker&apos;s own verdict is stored as evidence of what it claimed and is read by nothing.
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Everything lands staged. A document that fails validation lands anyway, flagged, because a
          bad sum is exactly the document a human must see — refusing it at the door would hide it
          in the worker&apos;s retry queue. Two documents with the same content are both kept, for
          the same reason: a refund and a re-scan look identical and mean different money.
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          There is no upload control on this screen and there is not meant to be one — documents are
          Drive references, and the ingest route is a door an external worker posts to with a token.
        </p>
      </section>
    </ScreenFrame>
  )
}
