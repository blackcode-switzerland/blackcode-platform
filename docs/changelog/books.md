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

## 2026-08-19 — "You have no books yet" names the command instead of telling you to ask somebody

**Not breaking. Copy only — no route, payload or command changed.**

The empty-state screen told a reader with no books that opening one is a setup
step this app does not do from a form, and to **"ask whoever set up your
account"**. That was correct on 2026-08-17: `books.entity` did not exist,
`/api/meta` served the seeded books out of a fixture, and there was no create
route on any surface. Naming a command that would fail is worse than naming none.

The table landed, `POST /api/workspaces/{ws}/entities` landed, and
`bk books entity create` landed with them — and the screen kept apologising. The
first person to sign up for their own account read "ask whoever set up your
account", having just set it up themselves, and reasonably concluded the product
would not let them add a book.

The screen now shows the actual command, with the three flags it requires, what
SA and RI each imply for the bookkeeping regime, and the fact that a book still
needs `bk books exercice create` before anything can be posted to it.

**There is still no button, and that part is a decision**: the legal form fixes
the regime for the life of the entity and the registered seat decides the
cantonal and communal tax parameters every later figure is computed with, and
`books.entity` has no delete. It is a CLI act on purpose, and now it says so.

**What to do:** nothing.

## 2026-08-19 — The last four screens: analyses, the analyse record, the tax snapshot, and the compliance register

**Not breaking. No route changed, no `bk` command changed, nothing on the wire
moved.** This is the web surface catching up with four routes that shipped with
phases 4B and 5, all of which are already readable and writable from the CLI:
`GET …/analyses`, `GET …/analyses/{number}`, `GET …/tax-snapshot`,
`GET /api/compliance-rules` and `PATCH /api/compliance-rules/{rule}`. The CLI
remains the complete surface; `bk books analyse list|show`, `bk books tax` and
`bk books compliance list|show|review` do everything these screens do.

**Thirteen screens now exist.** Nothing in this app still renders
`<NotBuiltYet>`.

### What the four screens show

- **Analyses** (`/dashboard/{ws}/analyses`) — the journal of what agents were
  asked about one book, newest first. Read-only, and deliberately: an analysis
  is filed by the agent that answered it, through `bk books analyse record`.
  There is no "new analysis" button and there will not be one.
- **The analyse record** (`/dashboard/{ws}/analyses/{number}`) — one filed
  answer, whole, with its `based_on` snapshot **rendered exactly as filed**.
  Nothing on that page is recomputed and nothing is reformatted: a filed value
  is text the agent wrote, and re-rounding one would be editing the record. Each
  record has its own URL and agents can deep-link it.
- **Impôts** (`/dashboard/{ws}/taxes`) — the statutory position of one (book,
  exercice), derived at request time and stored nowhere. **Every figure names
  the article it rests on**, read from the book's own tax parameters, and a
  figure whose parameter no fiduciary has confirmed says so beside itself. The
  canton and the commune come from the book; nothing is defaulted. Reached from
  the overview's cross-link, not from the nav — tax tracking over time is a
  different product.
- **Compliance rules** (`/dashboard/{ws}/compliance`) — the nineteen statutory
  checks with their citations, their severity, and their source confidence.
  Reached from the overview and from a verdict. It is not book-scoped, because
  the same law binds every book.

### The fifth write is live on the web: reviewing a compliance rule

`PATCH /api/compliance-rules/{rule}` — `bk books compliance review` — now has a
web form. Approve, edit with corrected wording, or reject.

**A review cannot be undone, and the confirmation says so before it appears.**
There is no un-review, no delete, and no way back to `draft`: draft is where a
rule is born, and reviewing backwards would erase the fact that somebody looked.
The row records who and when, from the session.

An edit that carries no corrected wording is refused by the route
(`edited_needs_logic`) and the form shows that refusal **verbatim** rather than
disabling its own button — the route is the rule, and its sentence explains what
an edit legally is in a way a greyed-out button cannot.

**`draft` is not drawn as a warning.** All nineteen rules are draft and that is
the resting state of the screen: research against Fedlex is not a fiduciary's
sign-off, and nineteen researched rules waiting for a human is what this page
looks like when nothing is wrong.

**`source_confidence` is rendered as provenance, not as doubt.**
`needs_fiduciary_check` is a fact about the source — the article behind the rule
is not settled — and it is shown in the same calm treatment as the other two, so
a reader can see which rules rest on statute the agent read in Fedlex and which
rest on something softer.

### The Devil's Advocate's verdict is now visible on every entry

`POST /entries/{n}/verdict` stays what it is: the agent's door, reached with
`bk books verdict`. There is no button anywhere in the web UI that files one,
and this app still computes no compliance judgment of its own.

What is new is that the entry detail screen renders the stored verdict — on
**every** entry, including the ones nothing has ever looked at.

> **`verdict: null` means NEVER CHECKED. It does not mean clean.** A screen that
> drew the absence as an accepted verdict would invent an assurance nobody gave,
> so the absence is rendered as its own state and says what it does not mean.

A `blocked` verdict refuses to post, server-side, and the post form now renders
that refusal as the answer it is — carrying the pass's own resolution text as
the way out. There is no override and no force flag.

### One correctness fix that is not about these screens

A scoped read fired **once without `?exercice=`** on a page opened directly at
`?entity=<slug>`, before the book list had arrived. `resolveScope` answers a
missing year with the book's newest exercice, so that first answer was a real
statement for a year nobody chose, cached as though it had been asked for.
Nothing rendered wrongly — the page holds on a skeleton until the books arrive —
but a book whose newest exercice is CLOSED would have been served from that
cache entry. Fixed; every scoped read now waits for the book list.

## 2026-08-19 — The management view is on the web, and it is the first screen with charts

**Not breaking. No route changed, no `bk` command changed, nothing on the wire
moved.** This is the web surface catching up with two routes that shipped with
phase 4B's backend: `GET /api/workspaces/{ws}/analytique` and
`GET /api/workspaces/{ws}/analytique/categories`. Everything below is already
readable with `bk books analytique` and `bk books category list`, and the CLI
remains the complete surface.

**What it shows** — `/dashboard/{ws}/management`, per book and per exercice:

- The exercice totals for revenue, charges and the net, over the months that
  carry a movement, with the coverage stated.
- Revenue against charges per month, as grouped columns, with the same figures
  in a table beside them.
- Charges by category, each bucket with its accounts, its share and its
  underlying ledger lines.

**Three things it deliberately does NOT show**, so an agent comparing the two
surfaces is not left looking for them:

- **No per-month averages, no runway, and no cash.** The mockup's five "run
  metrics" divide money by a month count; a franc figure produced by dividing a
  parsed float is not a figure this product will print. Cash and runway are not
  on this route at all. The route serving exercice totals, a treasury figure and
  the recorded runway scenarios would let all five come back honestly.
- **No tax panel.** `GET …/tax-snapshot` has its own screen, still to come.
- **No raw/agent payload panel.** Dropped permanently: agents use `bk`.

**And it reads categories, it does not write them.** `POST …/analytique/
categories` exists and `bk books category create` is how a bucket is made
today. Whether the web surface should offer it is an open decision — the
breakdown's buckets are configuration, and this product's web writes have so
far all been interpretation. It is recorded rather than answered.

**One thing for anyone building against the analytique payload.** Two of its
fields cross the wire as untyped JSON: a category's `label` and its `accounts`.
Every `jsonb` column in this app is declared without a TypeScript type and the
other shaping functions cast on the way out; `publicCategory` and
`costBreakdown` pass the column through. A client typing that payload gets
`unknown` for both and has to assert. `label` is `{fr, en}` and `accounts` is a
string array — **or `null`, on a simplified book**, where a bucket is the
category a movement carries rather than a mapping from accounts.

## 2026-08-19 — The hardening pass: every open finding from the frontend reviews, closed

Nine fixes, all of them answers to tickets #50/#51/#53/#55. Four change the
wire — each one flips a pin the frontend deliberately left on the defect, and
the pins now hold the fixed shape.

**Refusals reach callers now, with their reasons:**

- **The 0004 guard speaks (was: a bare 500).** Drizzle wraps a COMMIT failure,
  so the database's sentence sits on the error's CAUSE CHAIN while `e.message`
  says only "Failed query: COMMIT". The post route now reads the chain
  (`sqlErrorText`): an unbalanced post answers
  `400 guard_refused — entry N does not balance: debit X <> credit Y`.
  Frontends carrying the client-side workaround can delete it, as your own
  pin instructed.
- **Every 404 carries its reason and its recovery.** Nine call sites answered
  things like `error: 999`; all now pass the refusal's message and suggestion
  through (`bk books piece match 2 --entry 999` answers "no entry #999 …" with
  the worklist hint).

**Wire changes (all additive or shape-corrections you asked for):**

- **`account.label` is `{fr, en}`** — phase-0-contract.md's promise, kept at
  the door: storage keeps the mockup's `{fr, enSuffix}`, `publicAccount`
  normalizes. `en()` reads an account label like any other; the dedicated
  helpers are gone. A custom label with no English half serves `en: ""`.
- **Patrimoine item amounts are `numeric` strings**, like every other amount.
  The hooks conversion is deleted, per the pin's own note.
- **Entry payloads name their book and year**: `entity` (slug) and `exercice`
  (year) on both journals' rows, list and show. The transaction screen can
  state whose écriture it is instead of inferring it from a URL filter. And
  stated as a decision: a bare `GET /entries/{n}` resolving workspace-wide is
  INTENDED for reads — membership is the gate, and the payload now tells the
  truth about what it found; every write path holds the entity boundary by
  refusal.
- **`fx` is a contract now**: when present, ALL THREE of
  `{original, rate, source}` are — both writers always wrote the whole story;
  the type finally says so.

**The pièce pipeline:**

- **SHA-256 for captured files (migration 0015).** `source.sha256` rides
  ingest (64 hex chars, `bad_sha256` otherwise), dedupe prefers it, and a
  matched entry cites `sha256:…` over Drive's md5. MD5 stays as Drive's own
  cross-check and the legacy key.
- **Duplicate suspects by IDENTICAL FACTS, not just identical bytes.** The
  mockup's own twin pair — the Philfruits receipt and the EFT slip of the
  same purchase — is different bytes and the same money, which checksum
  dedupe could never flag. Ingest now also flags same-date-same-total within
  the same book: `duplicate_of` set, `needs_review` true, never dropped
  (refunds and split payments look identical; a human decides). The seeded
  inbox finally shows the duplicate banner, honestly.
- **`/api/meta`'s `source_types` carry a `note` each** saying whether that
  type is expected to feed a ledger account — so no client invents the
  sentence again that told PostFinance, a bank, that having no ledger account
  is normal. Render the vocabulary's words.

## 2026-08-19 — Phase 5: compliance, retention, and the app that refuses

The last in-app phase. Three routes, one enforcement, one platform answer.

**The 19 compliance rules are served** (`GET /api/compliance-rules`, `bk books
compliance list/show`) — statutory rules researched against Fedlex, each with
its citation, trigger, check logic, consequence, severity (blocker / warning /
info) and `source_confidence`. **Every rule is DRAFT until the fiduciary signs
off**, and the payload says so; render the state. `PATCH
/api/compliance-rules/{rule}` (`bk books compliance review`) records the
sign-off — approve, edit (corrected wording lands in `edited_logic`, the
original stays), or reject — with who and when. No path back to draft, no
delete, ever: a verdict may cite a rule forever.

**Verdicts are the Devil's Advocate's door** — the eighth write, the third for
an outside process. `POST /entries/{n}/verdict` (`bk books verdict`, `--entity`
for an RI number) files a STRUCTURED verdict: `accepted`,
`accepted_with_warning`, or `blocked`, with the `rules` that triggered (each
must exist), `worst_case` and `resolves`. History-first: a replaced verdict
stays in the entry's trail. The rule from #53 applies from birth: an `entity`
that does not own the number refuses with `entry_other_book`.

**One enforcement, server side:** a `blocked` entry refuses to post
(`verdict_blocked`, carrying the agent's own `resolves` text as the way out).
Warned entries post and stay visible. Nothing else is enforced — flags are
facts, and the app computes no compliance judgment of its own.

**Wire change, additive:** `entry` and `ri_entry` payloads gain `verdict`
(null until an agent pass writes one) — pin it as `Verdict | null`.
`/api/meta` gains `verdict_states`, `rule_review_states`, `rule_confidence`.

**The footprint now answers honestly, and the answer is a refusal.** The
scaffold's copy would have hard-deleted solely-owned workspaces — statutory
records included — and counted a table 0007 dropped. Now: a workspace whose
books hold records (écritures, RI entries, pièces, pulls, analyses) reports as
`blocked_by`, and `purge` refuses naming **art. 958f CO** — ten-year
retention. The account may close; the books stay. Only a workspace whose books
recorded nothing purges. **Platform side, take note:** the whole-account close
flow meets its first refusing app.

**Invariants:** DATA-MODEL §17 is now an audited checklist —
`lib/invariants.test.ts` tests what was untested (an SA/Sàrl with simplified
books is refused at `createEntity` itself and at the route,
`sa_needs_double_entry`; « consolidé » is grepped out of everywhere but the
personal overview's disclaimer; the 958f purge refusal) and names the file
pinning each of the other thirteen.

Also: `bk guide books` rewritten for phases 4-5 (statuses and vocabularies
still come from `bk meta`, never from the guide).

## 2026-08-19 — Phase 4B: the management layer, and the agent write-back

Five routes, two of them writes. Everything derived is computed at request
time and never stored; everything filed is permanent.

**New routes and `bk` verbs:**

| Route | `bk` |
|---|---|
| `GET /analytique` | `bk books analytique` |
| `GET /analytique/categories`, `POST` | `bk books category list` / `create` |
| `GET /analyses`, `POST` | `bk books analyse list` / `record` |
| `GET /analyses/{n}` | `bk books analyse show` |
| `GET /tax-snapshot` | `bk books tax` |

**The analytique** (`GET /analytique?entity=&exercice=`): the cost breakdown
per category — each bucket carrying its underlying lines, largest first, an
avoir counted against its bucket — and the `monthly_flows` series (produits /
charges per month, POSTED lines only, exercice-scoped). A simplified book
answers with its dépenses grouped by their own `category` label, uncategorized
under a named bucket; its flows read the directions, and a neutral transfer is
in neither series.

**Categories are per book and writable** — the seventh write. Seeded with the
mockup's five (`personnel`, `bureau`, `it_ai`, `admin`, `autres`) on every
double-entry book. `POST` refuses: an account not in the book's chart
(`unknown_account`), a bilan account (`not_a_flow_account` — a category counts
flows), an account another ACTIVE category already counts (`accounts_claimed`
— one franc, one bar), a duplicate key, a simplified book (`ri_no_categories`).
Labels are normalized to `{fr, en}` on the wire, always. No delete: `retired`
is the exit, and retired rows are served flagged.

**The analyses journal** — the sixth write, and the agent write-back contract
made real. `POST /analyses` files `{entity, asked_by, agent, question,
verdict, figures[], based_on[], scenario_label?, runway_after_months?}`. The
row is APPEND-ONLY: migration 0013 revokes UPDATE and DELETE from the app
role, no edit route exists, and none will. `based_on` items need `label` and
`value` (`based_on_incomplete` otherwise): the snapshot of what the agent READ
is the point of the record, and it is never recomputed. A drifted answer is
re-asked into a new row; both stand. `asked` is the server's clock;
`runway_after_months` is served as a number so charts need no prose parsing.

**The tax snapshot** (`GET /tax-snapshot?entity=&exercice=`): `profit` and
`equity` from the statements, `vat` from the entries' own TVA columns (`null`
when not registered; input counts only when CLAIMED), and the two PM tax
ESTIMATES from the entity's parameter record — canton, commune, rates,
citations, `confirmed` flags, served verbatim under `tax.params`. A book with
no record answers `configured: false` and `tax: null` — an honest "not
configured", never someone else's rates. Two flags worth reading:

- **`capital_tax.confirmed` is `false` on the seeded books, deliberately.**
  The art. 118 imputation question is open with the fiduciary; the snapshot
  serves `gross`, `credited` and `net_due` so either reading is available.
- A simplified book refuses the whole route
  (`no_tax_snapshot_for_simplified`): its result is its owner's personal
  income, which this app does not model.

Nothing existing changed shape: no column moved, no route renamed, migrations
0001-0012 untouched.
## 2026-08-19 — The web ledger reads both journals, and posting is on the web

**Not breaking for `bk`.** No route changed and no payload changed; this is the
web UI catching up to what phase 4A's backend already serves. Two of the three
items below are corrections to screens that were quietly wrong.

### The general ledger now renders a simplified book

`GET …/entries` has served two shapes since phase 4A — the grand livre for a
double-entry book, the recettes-dépenses journal for a simplified one — with, by
design, **no marker field on the payload**: the caller named the book, so the
caller knows which shape it gets.

The web ledger did not branch on it. On a simplified book it was drawing
recettes-dépenses movements through grand-livre columns: no amount and no
direction shown at all, a blank journal number, a blank posting status, "This
entry has no lines." on every row — and each row linked to `/ledger/{n}`, which
reads the double-entry journal, so following one **opened a different book's
écriture** under the simplified book's name. The two journals keep separate
number series, which is why the numbers resolved.

It branches on the book's `bookkeeping_regime` before it reads a row now, and
renders the simplified journal with its own columns (date, movement, category,
direction, amount). Those rows are deliberately **not** links: nothing serves one
recettes-dépenses movement on its own.

*Nothing to adapt for an agent.* `bk books entry list --entity <simplified-book>`
was always correct and is unchanged.

### `?status=` and `?account=` are no longer sent to a simplified book

Those two filters are **refused** by an RI journal (400 `ri_no_such_filter`),
not ignored. The web UI was sending both: the ledger's status filter, and the
income statement's account drill-down, which appends `?status=posted` so a figure
reconciles to its own drill-down.

The chart of accounts renders for a simplified book too, so every account number
on that screen was a link to a 400. Those numbers are now shown as facts rather
than as drill-downs — a simplified book has no chart mapping to drill into — and
a URL that still carries either filter says on the page that it was not applied
rather than dropping it silently.

### Posting a staged entry is on the web

`POST …/entries/{n}/post` and `bk books entry post` have both existed since
phase 1; the web UI had no way to do it. It is on the entry detail page now, for
a staged entry only.

It is not an ordinary button, because posting is the one write in this product
with no undo: it moves a line into the immutable record, where nobody — human or
agent — can modify or delete it, and a correction becomes a new reversing entry.
So it **requires the entry's #number to be typed back** before it will submit,
the way `bk workspace delete <slug> --confirm <slug>` requires the slug, and it
states what freezes (date, amounts, accounts) and what stays open (the
explanation, counterparty, recognition state and supporting document).

**`already: true` is rendered as "already posted", not as an error**, matching
the route's deliberate idempotency: an agent that retries has not failed.

### Known defect, not fixed here: the 0004 guard's refusal never reaches a client

Migration 0004 checks at COMMIT that a posted entry balances, carries at least
two lines and has every line mapped. The route means to translate that refusal
into `guard_refused` (400) with the database's own sentence. **It cannot, and
never has.** Under drizzle-orm 0.45 a failure raised at COMMIT arrives wrapped,
with the database's message on the error's `cause`, so the route's check never
matches and the refusal surfaces as **500 `internal_error`** — on `bk books entry
post` exactly as on the web form.

Reproduced with an entry whose two lines are mapped and unbalanced (77.00 against
99.00): 500 on both surfaces, while the same statements in `psql` answer *"entry
1272 does not balance: debit 77.00 <> credit 99.00"*.

*How to adapt:* a 500 from `bk books entry post` means the entry was **not**
posted and is unchanged — the transaction rolls back whole — and almost always
means it failed one of those three conditions. `bk books entry show <n>` and its
lines are what the guard reads. This is a route fix and is tracked; the message
will start arriving as a 400 with a real sentence.

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

> **Superseded 2026-08-18, same day.** The route now refuses a cross-book match
> and the web control is switched on. See "The match write holds the entity
> boundary" above. The warning below is kept because it was true when written,
> and anyone reading a version of this app from that day needs it.

**Use `bk books piece match` with care until further notice.** The route resolves
its `--entry` number against the grand livre on workspace and number alone, with
no book filter, so **a pièce belonging to one legal entity can be attached to
another entity's entry** — and doing so overwrites any document reference and
checksum already on that entry, without recording anything in its `history`. A
simplified book's journal is not affected; it filters correctly.

The web UI's control was therefore built and switched off rather than shipped.
**It is on since 2026-08-18**, once the route's refusal was verified in both
directions — it refuses a pièce from another book, and it still accepts one from
the same book.

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
