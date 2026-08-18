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
> here on.
>
> **Phases 0 to 2 shipped before this file existed.** They are not written up
> below as if they had been announced at the time — a dated log records what was
> said on a date, and back-dating announcements nobody made is worse than the
> gap. What they added is stated once, plainly, in the closing entry, so an agent
> reading `bk changelog --app books` is not left believing this app began at
> phase 3.

## 2026-08-18 — The match write holds the entity boundary

The phase-3 review found that `POST /pieces/{n}/match` could attach a pièce to
**another legal entity's** grand-livre entry: `entry.seq` is workspace-unique,
so any book's number resolved, and only the recettes-dépenses branch checked
whose it was. In doing so it could also silently replace evidence an entry
already carried — on the reviewer's repro, a posted entry's Drive reference and
sha256, overwritten with no record. That write was withheld in the UI behind a
flag. Fixed server-side; the flag can come off.

**Two new refusals**, same shape as every refusal (`code`, message,
`suggestion`), HTTP 400:

- **`entry_other_book`** — the piece is attributed to one book and the number
  names an entry in another. The worklist's `suggested_entries` were already
  scoped to the piece's own book; the write now enforces what the suggestions
  promised.
- **`entry_documented`** — the entry (either journal) already carries a pièce.
  Evidence is never replaced silently; a second document for the same entry is
  a feature nobody has needed yet, on purpose.
- (`already_matched`, on the piece side, is unchanged.)

**Two behaviours a client may rely on:**

- **The match is recorded in the entry's `history`** — the same append-only
  trail `resolve` keeps: `{at, event: "piece_matched", piece, was}`, where
  `was` holds the (empty, the guard proves) prior `piece_*` fields.
- **Matching an unattributed piece attributes it.** A piece with no book may
  still match any grand-livre entry, and saying which entry it documents says
  whose it is: `piece.entity_id` is set from the entry in the same
  transaction. It cannot reach a recettes-dépenses book while unattributed,
  as before.

No route added or renamed, no wire field changed. `bk books piece match`
surfaces the new refusals as-is.
## 2026-08-18 — Web screens corrected: the overview under-counted, and a transaction named the wrong book

Hardening pass over the twelve built screens. **No route changed and no `bk`
command changed** — every fix below is in the web UI, and in two places the web
UI is now saying what `bk` was already saying.

**Breaking for nobody. Read this if you compare the web figures against `bk`.**

- **The overview's "Need a human" was the wrong number, and `bk` was right.**
  `GET …/overview` serves both `unrecognized` (strictly
  `recognition = 'unrecognized'`) and `worklist` (`unrecognized` OR `inferred`,
  which is what the Recognition queue actually lists and what
  `bk books overview` prints under `TO RESOLVE`). The web read the first and
  labelled it "Need a human". On the seeded workspace it showed **4 where `bk`
  totalled 5**, and per book "2 unrecognized" where `bk` said 3. The web now
  reads `worklist` and the two agree. `unrecognized` is still served and is
  still the right field if you specifically mean that state.

- **The transaction screen stated a book and a fiscal year it does not know.**
  `GET …/entries/{number}` resolves on `workspace_id + seq` and is **not scoped
  by entity or exercice** — correctly, because `books.entry.seq` is
  workspace-wide. The screen was printing the book and year from the URL's
  `?entity=` / `?exercice=` filter beside the entry, so opening one book's
  écriture and changing the book selector relabelled that unchanged entry with
  another company's name. It no longer names either. **If you consumed that
  heading as the entry's book, it was never that.** The payload carries neither
  field; serving them is an open backend request.

- **The Recognition screen treated "this book has no fiscal year" as a failure.**
  Every book starts with no exercice (`bk books entity create` opens none), so
  this was the first screen a new book showed, and it showed two red alert boxes
  printing the raw `bad_scope` code. It now renders the same calm explanation
  the balance sheet and income statement already used, carrying the server's own
  `suggestion` (`bk books exercice create --year …`).

- **An entry's original-currency block is rendered.** `fx` (`{original, rate,
  source}`, migration 0011) is described as display-only and was displayed
  nowhere. The transaction screen now shows it when present, field by field —
  absent fields are omitted rather than dashed, because the writer may omit any
  of them. Nothing computes with it; amounts stay CHF.

- **The pièces inbox now says why it cannot attach a document.**
  `POST …/pieces/{n}/match` and `bk books piece match` both work, and the web
  form for them is deliberately switched off. The screen said nothing about it,
  so six documents sat there unactionable with no explanation. It now states the
  reason. **Note for anyone reaching for the CLI as a workaround: there is not
  one.** `matchPiece`'s grand-livre branch resolves the entry on
  `workspace_id + seq` with no entity filter, so
  `bk books piece match <p> --entry <n>` will attach a pièce across two legal
  entities and exits 0 — verified against seeded data, where a blackcode SA
  receipt attached to an AIOS Companion SA écriture and overwrote that entry's
  existing Drive reference and SHA-256 with a NULL hash, leaving `evidence_tier`
  untouched and writing no history. Do not use it across books until the route
  filters by entity.

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

**The write count went from four to five — and the fifth is WITHHELD in the web
UI for now.** Attaching a pièce to the entry it proves is
`POST /api/workspaces/{ws}/pieces/{n}/match`, `bk books piece match`. It writes
the entry's document reference, checksum and capture date, and **deliberately
does not change the entry's `evidence_tier`**: whether a receipt is sufficient
proof is a judgment, and judgments stay human.

**Use `bk books piece match` with care until further notice.** The route resolves
its `--entry` number against the grand livre on workspace and number alone, with
no book filter, so **a pièce belonging to one legal entity can be attached to
another entity's entry** — and doing so overwrites any document reference and
checksum already on that entry, without recording anything in its `history`. A
simplified book's journal is not affected; it filters correctly.

The web UI's control is therefore built and switched off rather than shipped, and
will appear here again when the route filters by book.

**One client-visible fix.** `entry.piece.hash` and `entry.piece.captured` are
**nullable** and always have been — `books.entry.piece_hash` is a nullable
column. A client typing them as non-null will break the first time it reads an
entry whose pièce was attached by `match` from a document with no checksum,
which is every document the current capture pipeline produces. Nothing on the
wire changed; the shape is being stated because it was previously mis-declared
on our side.

---

## 2026-08-17 — Everything before this log existed (recorded late, 2026-08-18)

**Not an announcement.** This entry was written on 2026-08-18, after the fact,
because phases 0 to 2 shipped before anyone created this file and an agent
reading only the entry above would conclude b/books began with sources and
pièces. It says what exists and where to read the contract; it does not pretend
to have been published on the date in its heading.

**The app.** `apps/books`, its own `books.*` Postgres schema and role, sharing
one blackcode account with every other app. One workspace holds any number of
**books** (legal entities); each book keeps its own chart of accounts, its own
fiscal years and its own statements, and two books never mix.

**The routes, all workspace-scoped under `/api/workspaces/{ws}/`:**

| Route | `bk` |
|---|---|
| `entities` (GET, POST) | `bk books entity list` / `create` |
| `exercices` (GET, POST) | `bk books exercice list` / `create` |
| `accounts` | `bk books account list` |
| `entries`, `entries/{n}` | `bk books entry list` / `show` |
| `bilan` | `bk books bilan` |
| `compte-resultat` | `bk books cr` |
| `overview` | `bk books overview` |
| `patrimoine` | `bk books patrimoine` |
| `worklist` | `bk books worklist` |
| `rules` (GET, POST) | `bk books rule list` / `create` |
| `entries/{n}/resolve` (POST) | `bk books resolve` |

`GET /api/meta` is the dynamic contract — vocabularies, VAT rates, the statutory
line structures — and never the data. **It does not carry the books or the
fiscal years**: those are workspace-scoped rows and are read from `entities` and
`exercices`.

**Four things a client must get right**, each of which has already broken one:

- **Money is a string on the wire** and stays one. `numeric(14,2)` does not fit a
  float, and a bilan balances to the rappen.
- **Dates are plain dates**, not instants. Parsing `"2026-01-05"` into a
  timestamp moves a booking across a year boundary for anyone west of Greenwich.
- **A simplified book has no bilan.** `GET …/bilan` refuses it with
  `no_bilan_for_simplified` and points at `patrimoine`. That is correct, not an
  error, and permanent — confirmed 2026-08-18.
- **The worklist merges three tables** (`entry`, `ri_entry`, `piece_inbox`) whose
  `seq` counters are separate. **`POST /entries/{n}/resolve` addresses
  `books.entry` only**, so resolving a row of any other kind by its number
  rewrites an unrelated journal entry. Read `kind` before acting on `number`.

The full design record is `docs/books-app-plan/`, and the frontend contract is
`apps/books/docs/frontend.md`.
