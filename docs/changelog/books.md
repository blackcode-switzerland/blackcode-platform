# Changelog — b/books app

Breaking and notable changes to the **b/books** app: books (legal entities),
fiscal years, the chart of accounts, the grand livre, the statutory statements,
recognition, sources and pièces justificatives. Newest first. If a command that
used to work now fails, check here first — and check `platform.md` too, which
carries changes to workspaces, members, files, tokens and the `bk` CLI itself.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your books), run
**`bk meta`** and `bk books entity list`.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every app's file into one feed by date, each entry tagged with its
app. `bk changelog --app books` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry here. Timestamp it and describe what changed and how to adapt.
> A change touching shared platform data goes in `platform.md` instead, even
> when this app is what prompted it.

> **2026-08-18 — this file was created.** b/books had no changelog file through
> phases 0–3, so nothing it shipped was reported on the agent surface. Files are
> discovered by reading this directory, so the app appears in `bk changelog` from
> here on. The entries below start at phase 3; phases 0–2 are recorded in
> `docs/books-app-plan/` and are not backfilled, because a dated log is a record
> of what was announced and inventing announcements after the fact is worse than
> the gap.

## 2026-08-18 — Sources, pièces and the fifth write

Phase 3's screens are live in the web UI. **No route changed**, so no `bk`
command changed either: everything below reads or writes through routes and
commands that shipped with phase 3's backend.

**New screens.**

- **Accounts & sources** (`/dashboard/{ws}/sources`) now carries the sources
  register beside the chart of accounts — every bank, card, processor, SaaS
  spend and Drive folder, with the **computed** completeness status and the
  thresholds behind it. `bk books source list`.
- **Source detail** (`/dashboard/{ws}/sources/{number}`) — the freeform notes,
  the ledger accounts fed, the pull runbook, the raw files pulled, and the
  worker's file manifest. `bk books source show`, `bk books manifest`.
- **Supporting documents** (`/dashboard/{ws}/documents`) — the receipts inbox,
  one row per captured document, with the server's own validation verdict and
  the extracted lines. `bk books piece list`.

**Not breaking, and worth knowing:**

- **The register and the inbox are not filtered by book.** A source can feed
  more than one, and both `books.source.entity_id` and
  `books.piece_inbox.entity_id` are nullable — an unattributed source or a
  scanned receipt that does not say whose it is would be hidden by a filter, and
  those are exactly the rows a person is looking for. The book is a column on
  both. `bk books source list --entity <slug>` still narrows.
- **A source's status is computed at read time** from cadence against
  `last_import` and is not settable anywhere, by anybody. There is no status
  column and there will not be one. The only hand-set lifecycle fact is
  `retired`.
- **A flagged pièce is normal traffic.** A document that fails validation still
  lands, staged and flagged; duplicates are flagged and never dropped. Neither is
  drawn as an error.

**The write count went from four to five.** Attaching a pièce to the entry it
proves — `POST /api/workspaces/{ws}/pieces/{n}/match`, `bk books piece match` —
is now available in the web UI as well as from `bk`. It writes the entry's
document reference, checksum and capture date, and **deliberately does not
change the entry's `evidence_tier`**: whether a receipt is sufficient proof is a
judgment, and judgments stay human. `apps/books/docs/frontend.md` §5 and
`lib/mutations.ts` both moved from four to five in the same change.

**One client-visible fix.** `entry.piece.hash` and `entry.piece.captured` are
**nullable** and always have been — `books.entry.piece_hash` is a nullable
column. A client typing them as non-null will break the first time it reads an
entry whose pièce was attached by `match` from a document with no checksum,
which is every document the current capture pipeline produces. Nothing on the
wire changed; the shape is being stated because it was previously mis-declared
on our side.
