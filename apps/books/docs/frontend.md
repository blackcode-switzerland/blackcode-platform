# b/books — frontend

**This app only.** Platform-wide conventions, the tokens, the
`@blackcode/platform-ui` primitives, the app shell pattern, are in the root
[`docs/frontend.md`](../../../docs/frontend.md) and are not repeated here.

**Status: all thirteen screens exist, 2026-08-19.** Phases 0 through 5 have
landed on the web surface; nothing renders `<NotBuiltYet>`. What each phase
turned on is in
[`docs/books-app-plan/`](../../../docs/books-app-plan/README.md), and §8 below
maps every screen to the phase that gave it data.

> This line read *"phase 0 complete … no b/books screen exists yet"* until
> 2026-08-19, five phases after it stopped being true. §2 records what a stale
> paragraph in this file costs: the overview was built against the phase-0
> version of that section and rendered "You have no books yet" over a workspace
> holding three books and seventeen entries.

---

## 1. Run it

`.env.local` is gitignored, so you create it. Four lines:

```sh
# apps/books/.env.local
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3200
NEXTAUTH_SECRET=<openssl rand -base64 32>
# Never set RUN_MIGRATIONS locally. It belongs only in Vercel Production.
```

Then, from the repo root:

```sh
docker compose up -d          # Postgres 16 on localhost:5434
npm install
npm run db:migrate:books      # creates the books schema
npm run dev:books             # http://localhost:3200
```

books is 3200. issues is 3000, sales is 3100.

The database name is `blackcode_issues` and that is not a mistake. One local
Postgres holds every app, each in its own schema. `platform.*` is shared,
`books.*` is ours, and we may not read another app's.

Check it worked:

```sh
curl -s localhost:3200/api/meta | head -c 300
```

## 2. What is actually live

> **Rewritten 2026-08-18.** This section described phase 0, when `/api/meta` was
> the only books route and carried the books themselves. Phases 1 and 2 landed
> twelve more and moved the books OUT of that payload — and the stale version of
> this table is exactly what the overview was built against when it rendered
> "You have no books yet" over a workspace holding three books and seventeen
> entries. Nothing threw.

**`GET /api/meta` is unauthenticated on purpose**, the same as the platform's
own, and it is the DYNAMIC CONTRACT — never the data:

| Key | What |
|---|---|
| `entities` | **a POINTER, not a list.** `{source, table, note}`. The books are workspace-scoped; read them with `GET /api/workspaces/{ws}/entities` |
| `vocabularies` | seven of them, colour and icon included |
| `tva_rates` | 8.1, 2.6, 3.8, 0 |
| `statements` | the legal line structures of the bilan and the compte de résultat |

There is no `exercices` key. Fiscal years are per book and per workspace:
`GET /api/workspaces/{ws}/exercices?entity=`.

The books' own routes, all workspace-scoped under `/api/workspaces/{ws}/`:

| Phase | Routes |
|---|---|
| 1 | `entities`, `exercices`, `accounts`, `entries`, `entries/{n}`, `bilan`, `compte-resultat`, `overview`, `patrimoine` |
| 2 | `worklist`, `rules` (GET, POST), `entries/{n}/resolve` (POST) |
| 3 | `sources`, `sources/{n}`, `sources/{n}/manifest`, `pieces`, `pieces/{n}/match` (POST), `pieces/ingest` (POST — the robot door, no UI) |
| 4B | `analytique`, `analytique/categories` (GET, POST), `analyses` (GET, POST), `analyses/{n}`, `tax-snapshot` |
| 5 | `entries/{n}/verdict` (POST) — and, **NOT workspace-scoped**, `/api/compliance-rules` (GET) and `/api/compliance-rules/{rule}` (GET, PATCH) |

Three of these do **not** use the shared `{data, next_cursor}` envelope, and a
hook that reached for `apiList` would render an empty screen over a full one:
`…/worklist` is `{entity, exercice, count, rows}` and `…/sources/{n}/manifest`
is `{source, files}`. `…/sources` and `…/pieces` ARE list routes. All four are
pinned in `lib/wire-parity.test.ts`.

**Two phase-5 routes are not under `/api/workspaces/{ws}/` at all**, and that is
the only pair in this app like it: `GET /api/compliance-rules` and
`PATCH /api/compliance-rules/{rule}`. The same law binds every book, so the
rules are global like the vocabularies, and the GET is unauthenticated for
`/api/meta`'s reason — the payload is law text with citations, holding no
amounts and no names. `useComplianceRules` is therefore the third
`booksGlobalKey` in `lib/hooks.ts`, and `useReviewComplianceRule` is the only
write in `lib/mutations.ts` that takes no workspace.

> **The commented-out stub that stood in `lib/mutations.ts` for two phases had
> the wrong address in it** — `PATCH /api/workspaces/{ws}/compliance-rules/{id}`
> — and would have 404'd. A commented stub is still a claim about the wire, and
> nothing contradicted that one until somebody used it. Recorded in that file's
> header, because the usual argument for commenting rather than stubbing is
> about a stub that returns success, and this is the same lesson from a
> direction nobody expected.

**Phase 3 also changed a phase-2 payload without changing a route.** `getWorklist`
gained `kind: 'piece'` rows and a `suggested_entries` field. `lib/types.ts` said
two kinds, so `npm run typecheck` was red on `_WorklistKeys` for the whole merge
— and the recognition screen, whose branch was `kind === 'ri_entry' ? readOnly :
resolveForm`, offered "Explain this" on every pièce. Pressing it would have
POSTed `/entries/{piece.number}/resolve`, rewriting the journal entry of the same
number. The branch is a tested predicate now: `lib/resolvable.ts`.

**Two more wire facts, found by the cleanup sweep on 2026-08-18 and now pinned
in `lib/wire-parity.test.ts`:**

- **`…/overview` serves `worklist` as well as `unrecognized`, and they are
  different numbers.** `unrecognized` is strictly `recognition = 'unrecognized'`;
  `worklist` is `unrecognized` OR `inferred`, which is what the Recognition
  screen lists and what `bk books overview` prints under `TO RESOLVE`.
  `lib/types.ts` declared only the first, so nothing could read the second and
  the rollup panel labelled the strict count "Need a human" — 4 against `bk`'s 5
  on the seeded workspace. **Anything phrased as work outstanding reads
  `worklist`.** Neither is the same as `WorklistResult.count`, which also counts
  pièce rows. Caught by `_OverviewKeys`, and it could only be caught by a
  BIDIRECTIONAL assertion: a payload carrying more than the type asks for is not
  a TypeScript error.

- **`…/entries/{number}` is NOT scoped by entity or exercice.** It resolves on
  `workspace_id + seq`, correctly, because `books.entry.seq` is workspace-wide —
  so `?entity=` and `?exercice=` on that URL are inert. The transaction screen
  used to print the book and year from those parameters beside the entry, which
  meant changing the book selector relabelled an unchanged écriture with another
  company's name (reproduced in one click). **The payload carries neither field**,
  so no screen can state them; serving `entity` and `exercice` there is an open
  backend request. Until then the screen names no book, and says why.

Everything else under `app/api/` is the platform surface, mounted from the shared
factories: auth, `/api/me`, workspaces, members, invitations, and — since
2026-08-19 — the whole account surface (passwords, tokens, CLI authorization).
See **§10** for what that is and why none of it is a books write.

`entities.source` is still the field to watch, and
[`components/states.tsx`](../components/states.tsx)'s `<FixtureNotice>` renders
it. A screen that ships against fixture data believing it is real is the failure
that field exists to prevent.

## 3. Two rules

### Never import the fixture

`fixtures/mockup.json` is the mockup dumped verbatim. It is the seed source and
the test oracle. It is **not** a data source for a component.

Read through [`lib/client.ts`](../lib/client.ts), always. If the data is not
there yet, that is a route the backend owes you, not a file to reach into.

This is the one shortcut no guard catches. A JSON import is not a `fetch`, so
nothing goes red. It is held by this line and by review.

### Routes are backend, components are frontend

Every route in this repo needs a matching `bk` command or the build fails
([`lib/cli-parity.test.ts`](../lib/cli-parity.test.ts)). If you need an endpoint,
ask rather than adding one.

## 4. The data model you render against

```
workspace      one account's container       in the URL as [ws]
   └── entity        one book, any number    ?entity=blackcode
        └── exercice     one fiscal year
             └── entry        one écriture
                  └── entry_line
```

**A workspace is not a book.** The user creates books and may have any number, so
a workspace cannot be one. This is decision D1 in the plan, and the mockup agrees:
it switches books with `?entity=`, a filter, on the same screens.

### There are TWO journals, and the wire does not say which one you got

The tree above is the DOUBLE-ENTRY book. A book kept under art. 957 al. 2 CO —
`bookkeeping_regime: 'simplified'` — has no `entry_line` and no `entry`: its
movements are `books.ri_entry` rows, one amount each, with a `direction` instead
of two sides.

**`GET …/entries` serves both, from one route, with no marker field on the
payload.** The route's own header: *"The caller named the book (or accepted the
default), so the caller knows which shape it gets — context explicit, no marker
field."* And since phase 4A `?status=` and `?account=` are **refused** on a
simplified book (400 `ri_no_such_filter`) rather than silently ignored.

So every screen decides which journal it is looking at *before* it reads a row,
and the decision is made in exactly one place:

| | |
|---|---|
| [`lib/journal.ts`](../lib/journal.ts) | `journalFor(regime)` → `'grand_livre' \| 'recettes_depenses' \| null`, and `journalAccepts(journal, filter)` for the two refused filters |
| `useScope().journal` | the derivation, run once, from the book the URL resolves to |
| `useEntries` / `useRiEntries` | two hooks, two cache slots, each enabled only for its own journal |
| `<AccountRef>` | takes the journal and renders the account as a FACT rather than a drill-down link where the target would refuse it |

**The branch is positive and enumerated** — `=== 'simplified'`, never
`!== 'double_entry'` — for the reason `lib/resolvable.ts` records at length: the
worklist's negative test was exhaustive for two kinds and, when a third arrived,
failed toward a write. `null` means "cannot tell" and a screen renders it as
such; it is never resolved into a default.

> **This was live and wrong on `spec/b-books`.** Before the branch, the ledger
> rendered the seeded RI book's six movements through grand-livre columns: a
> blank `N°`, a blank `Status`, "This entry has no lines." on every row, **no
> amount and no direction anywhere** — and every label linked to `/ledger/{n}`,
> which reads `books.entry` and opened another book's écriture under this book's
> name in the header. Nothing threw. Third payload to change shape under a merged
> screen; assume there is a fourth.

### A closed fiscal year is a fact, and it travels through `useScope`

`bk books exercice close` landed 2026-08-20 and **there is no reopen, by
design**. Until that day `lib/scope.ts` reduced the fiscal-year list to
`number[]` and dropped `status`, so a filed year and a live one rendered
identically on every screen in the product.

| | |
|---|---|
| [`lib/exercice.ts`](../lib/exercice.ts) | the reducer: `exerciceOptions(rows)` and `statusOf(options, year)`. A separate module because `lib/scope.ts` is `'use client'` and the tests run in a `node` environment |
| `useScope().exerciceOptions` | `{year, status}[]`, deduped and newest first |
| `useScope().exerciceStatus` | the status of the year currently in scope |

**`status` is `'open' | 'closed' | null`, and `null` is not "open".** It covers
three real situations: the years have not arrived, the book has none, and — the
one no browser will show you — an UNSCOPED year list in which two books' rows for
the same year disagree. Picking the first row's status there would be a legal
claim about somebody's books read off an array order. **Test for `=== 'closed'`,
never for `!== 'open'`.**

Where it is SAID is a deliberate, written-down decision, not an accident of which
component had the value to hand:

- the **year switcher**, in both its branches, because it is the control that
  names the year and it is in the header of every book-scoped screen;
- the **three statutory documents** — bilan, compte de résultat, patrimoine —
  through `<StatementHeading exerciceStatus>`, because those are what a person
  prints and sends to a fiduciary, and a statement of a filed year is a different
  document from a draft of the same numbers;
- **nowhere else.** The working screens have the header above them; a badge on
  each would be seven more wordings of one legal fact. The full argument, and the
  one change that would revisit it, is at `<ExerciceSwitcher>` in
  `components/books-shell.tsx`.

### The compte de résultat has two readings, and ONE request

`/dashboard/{ws}/income-statement` draws the annual statement or a monthly grid,
chosen by `?view=month` — in the URL, like the book, the year and the ledger's
filters, so the reading is shareable and Back undoes it.

`useCompteResultat` asks for `?by=month` **always**, so there is one query and
one cache entry carrying the annual body and the twelve months together. The
route's header is the reason: *"making it ask twice for two views of one
statement would invite them to be read from different moments."* Switching
reading does not refetch, and the total under the grid is the same object the
annual view showed a second earlier.

The three rules ticket #64 is actually about all live in
[`lib/monthly-cr.ts`](../lib/monthly-cr.ts), not in the component — the row order
comes once from the annual body and is reused for every column, a `pos` a month
does not carry is an em dash and never `0.00`, and every total comes off the wire.
They are a property of a transform, so `lib/monthly-cr.test.ts` can assert them;
inside a `.tsx` render nothing in this app could.

**The toggle is not offered where there is no statement.** Everything hangs off
`cr.data`, which the `no_cr_for_simplified` path never produces — the same shape
`/bilan` uses, not a third spelling. A bookmarked `?view=month` on a simplified
book renders the refusal, verified in a browser.

**That the hook still ASKS for `by=month` is itself guarded**, in
`lib/wire-parity.test.ts` — added in review because it was the one link in the
chain that nothing checked. `months` is optional on `CrResult` by design, so a
hook that stops asking produces a valid payload, a page that renders the annual
statement without complaint, and a monthly toggle that has silently vanished:
515/515 green and `tsc` clean. The guard reads the hook's function BODY with
comments stripped, because its docstring says `by=month` five times and a
whole-file scan is satisfied by prose.

**The year column is pinned to the right only from `sm` up.** Below 640px the
left label column and a pinned year column together leave less clear width than
one month column, so at 390×844 the reader landed on a grid where January's
figure sat entirely underneath the year's — the wrong number in the month's
place, not a missing one. Measured in review; the reasoning and both
measurements are at the scroll wrapper in `components/monthly-cr-grid.tsx`.

### The word "workspace" must never appear in the UI

It is platform tenancy. It names nothing in this product. The mockup has no team,
no members page, no sharing, and not one human-identity field across its 27 data
structures. There is one user, many books, and a fiduciary who receives an export
rather than a login.

So: no workspace switcher, no create-workspace flow, no members page until
somebody asks for one. `[ws]` stays in the URL because the platform's route
factories require it. Never explain it to the reader.

`apps/sales` settled the same point: its team page says "your team" and the word
workspace appears nowhere on it.

## 4bis. Charts — the house pattern, set by one screen

**The management view (`/dashboard/{ws}/management`) is the only screen in this
product with charts, and everything it chose is now the pattern.** Written
2026-08-19, with the `dataviz` skill loaded first because there was nothing to
copy.

### The line the whole screen is built on

> **A FIGURE is exact. A GEOMETRY is a float.**

- A figure comes off the wire as a string, or it is added here in CENTIMES with
  `toCentimes`/`fromCentimes` from `lib/derive` — `lib/rollup.ts`'s pattern,
  reused rather than re-implemented. It reaches the screen through `<Money>`.
- A geometry — a bar's length, a column's height, a percentage share, an axis
  ceiling — comes from `amount()` and is **never rendered as an amount**.

`lib/analytique.ts` is split into those two halves under headed comments, and
its three `amount()` call sites are the only ones this screen has. The split is
what makes the claim checkable: everything below the second header returns a
`number`, and `<Money>`'s prop type refuses one.

**The server serves no totals for this screen**, so the exercice figures are
added in the browser. `lib/analytique.test.ts` pins that with an input at a
magnitude where a float accumulator and this one disagree — and **read
`lib/rollup.test.ts` before touching it**: the first version of the equivalent
assertion there passed against a rollup rewritten to use floats.

### What the two charts refuse, and why

- **No line chart, ever, on the monthly series.** It is SPARSE — a month with
  no movement is absent, not zero — so a stroke between two points states a
  figure for the months between them. Grouped columns cannot interpolate.
  `hasGaps` makes the chart say so in words when a month really is missing
  between two that are served.
- **No colour keyed to a category.** One measure over nominal categories is one
  hue for every bar. The mockup gives each bucket its own colour with a sixth
  reserved for `autres`; that is a value-ramp on nominal categories (the
  `dataviz` skill's own anti-pattern) *and* a colour keyed to a slug we know
  today, which the phase brief forbids because categories are served and a new
  one must render with no frontend release.
- **No tooltip as the only way to read a value.** Every chart has a table twin.
  The hover read-out is a convenience; the table is the record.

### The colours are validated, not chosen

`--chart-1` and `--chart-2` in `app/globals.css`, run through the `dataviz`
skill's `validate_palette.js` **against this app's own chart surface** in both
themes. The dark steps were re-stepped to pass: the originals sat outside the
lightness band a dark surface needs. Slots 3–5 have never been measured and
nothing uses them — run them before the first chart that does.

**`--primary` is never a series colour.** Amber means "you are in books" (D-B),
and a mark wearing it collides with the chrome the reader uses to know which app
they are in. An entity accent is user data and belongs on the entity chip.

### Why not `@blackcode/platform-ui/charts`

The shared kit is mounted by nobody here, and the reason is in
`components/flows-chart.tsx`'s header: it is built for COUNTS. `HorizontalBars`
renders its value with `formatNumber` (`13350` → `13.4K`) and takes
`value: number`, `AreaLineChart` draws a line, and `ColumnChart` renders "No
data." when its total is zero — which is a real month here, not an absent one.
Books' charts are money, and money is a string.

## 5. The surface is read-mostly, and that is checked

Thirteen screens, **five** writes: resolve an entry, create a rule, post a
staged entry, approve a compliance rule, **match a pièce to an entry**.
Everything else reads.

> **It was four until 2026-08-18, and the fifth is a recorded decision.**
> `POST /pieces/{n}/match` landed with phase 3's backend along with
> `bk books piece match`, and this section and `lib/mutations.ts` both said
> four. Either the count became five and both files said so, or matching stayed
> a CLI act — what was not acceptable was a fifth write appearing while two
> files still claimed four, which is how a documented invariant quietly stops
> being one. Both moved in the same change.
>
> What decided it was the START-ANYWHERE-FINISH-IN-SYNC rule rather than the
> count: a capability that exists in `bk` and not in the web UI is a gap unless
> it is a deliberate, recorded decision, and the two decisions of that kind in
> this repo (`DELETE /api/me`, the board-ordering reorders) are both destruction
> the product keeps human. This is the opposite — it is the judgment the
> receipts inbox exists to collect.
>
> And it is the same CLASS as resolve, which is what makes it safe to add rather
> than merely consistent to add. **It writes no amount, no account and no
> balance**: it fills the entry's `piece_*` interpretation columns and
> deliberately does not touch the `evidence_tier`, because whether a receipt
> turns `partial` into `full` is a sufficiency judgment and judgments stay
> human. Nothing derived reads `books.piece_inbox`.

```
lib/client.ts     the ONLY fetch(). Transport, consults nothing.
lib/mutations.ts  the ONLY module that sends apiSend. One gated primitive.
components/**     call the hooks. No fetch, no apiSend, no method strings.
```

[`lib/read-only.test.ts`](../lib/read-only.test.ts) asserts that arrangement, so
"can a component write?" is answered by three assertions instead of an audit. Put
a `fetch(` in a component and it goes red. That has been verified by doing it.

**The gate is not a security control.** `useCanWrite()` is client-side and the
user owns the client. Authorisation is workspace membership and the role, on the
server. What the gate buys is that a missed affordance fails loudly instead of
writing.

**All five write hooks are real since 2026-08-19**, all in
[`lib/mutations.ts`](../lib/mutations.ts): `useResolveEntry` and `useCreateRule`
from phase 2, `useMatchPiece` from phase 3, `usePostEntry` from phase 4A, and
**`useReviewComplianceRule` from phase 5**, which closed the set.

`useMatchPiece` is still switched OFF in the UI (`MATCH_WRITE_ENABLED` in
`components/pieces-inbox.tsx`, ticket #53) — the capability exists and is
recorded, and it is gated because the grand-livre lookup does not filter by
book.

### The fifth write: reviewing a compliance rule

`PATCH /api/compliance-rules/{rule}`, from
[`components/compliance-review-form.tsx`](../components/compliance-review-form.tsx).
Three outcomes — approve, edit with corrected wording, reject.

- **There is no un-review and no delete**, and `draft` is refused as a review
  verdict: reviewing backwards would erase the fact that somebody looked. So the
  confirmation is a second, explicit step that says what becomes permanent
  before the button appears.
- **It is NOT `entry post`'s ritual**, and the difference is the ring rather
  than the severity. Posting crosses out of ring 2 into ring 0 and freezes
  amounts under migration 0004's triggers, so it makes the reader type the
  target back. This is ring 2: it writes meaning about a rule and moves no
  franc. A ritual used for everything is a ritual nobody reads.
- **The submit button is not disabled for a missing correction.** The route
  refuses `edited_needs_logic` — *"an edit without the corrected wording is an
  approval wearing a different name"* — and the form renders that sentence
  verbatim. `canSubmitReview` in `lib/compliance.ts` is the same test and drives
  an inline hint instead, so the route keeps the last word and the reader
  learns why rather than that something is broken.
- **The wording box is not prefilled.** Prefilling it with `check_logic` would
  make "edit" the cheapest button on the screen and produce a correction
  identical to the original, with a fiduciary's name on it.

### `draft`, severity and provenance are decided in a MODULE, not in JSX

[`lib/compliance.ts`](../lib/compliance.ts) holds the tones and the wording, and
`<TonePill>` only paints. Three claims live there because each is a `className`
away from being wrong where only a browser could see it:

- **`draft` is `calm`.** Nineteen researched rules waiting for a human is the
  resting state of that screen, not a backlog.
- **`source_confidence` carries no tone at all.** It is a fact about the SOURCE
  — `needs_fiduciary_check` means the article is not settled, not that the rule
  is doubtful — and drawing a disclosure as a defect is how people stop reading
  it.
- **An unknown value is named, never binned.** All three columns are `varchar`,
  not enums this bundle owns; a lookup returns `null` and the screen prints the
  raw string. Falling into `draft` would hide a rejection and falling into
  `blocker` would invent one.

### `verdict: null` means NEVER CHECKED, not clean

[`lib/verdict.ts`](../lib/verdict.ts), rendered by
[`components/verdict-panel.tsx`](../components/verdict-panel.tsx) on **every**
entry — including the ones nothing has looked at, which is the point. A section
that simply disappeared for a null would let the absence read as an accepted
verdict, which is an assurance nobody gave. It is F-2's `undefined !== null`
mistake one field over.

`POST /entries/{n}/verdict` is the agent's door (`bk books verdict`) and no
button in this app files one. The one enforced consequence is server-side:
`postEntry` refuses a `blocked` entry with `verdict_blocked`, carrying the
agent's own `resolves` text as the suggestion, and `<PostEntryForm>` prints it
verbatim. The form is still OFFERED on a blocked entry — hiding it would replace
the server's sentence with this app's guess at it.

### `entry post` is the only write that leaves ring 2

The other four are interpretation: they write meaning, they append the old state
to `history`, and nothing they touch is a balance. **Posting is the transition
into the immutable record** — migration 0004's triggers make a posted entry
unmodifiable and undeletable by anybody, and a correction from there is a new
reversing entry beside the old one.

So [`components/post-entry-form.tsx`](../components/post-entry-form.tsx) is not
an ordinary button:

- **The target is repeated back.** The reader types the entry's #number, the way
  `bk workspace delete <slug> --confirm <slug>` requires the slug. `useConfirm()`
  is a dialog answered by reflex; this must not be reachable by reflex.
- **It says what becomes immutable, and what does not.** The date, the amounts
  and the accounts freeze. The explanation, the counterparty, the recognition
  state and the supporting document stay open, and that split is exactly
  migration 0004's freeze line rather than a simplification of it.
- **`already: true` is rendered as "already posted", never as an error.** The
  route is idempotent because the Companion retries, and a retry is not a
  failure.

It is rendered only on the entry detail page and only for a `staged` entry — a
positive test, so a third status added server-side gets no write affordance
rather than the wrong one.

> **The 0004 guard's own words do not reach the client, and that is a live
> backend defect** (found 2026-08-19). The route means to translate the deferred
> constraint into `guard_refused`, but under drizzle-orm 0.45 a failure raised at
> COMMIT arrives wrapped in a `DrizzleQueryError` whose `message` is `Failed
> query: COMMIT` — the database's sentence is on `.cause`. So the branch has
> never fired, and an unbalanced entry answers **500 `internal_error`** on both
> the web form and `bk books entry post`. The form says the entry is unchanged
> and names the three conditions the guard tests, rather than guessing which one
> failed. `lib/wire-parity.test.ts` pins the defect so the workaround is deleted
> when the route is fixed.

### The six phase-4A verbs we do NOT build

`source import`, `entry declare`, `source create`, `source edit`,
`source record-pull` and `source runbook-set` are all ring 0 (appends from the
world) or ring 1 (structure and provenance). **This product's web surface is for
reading and for meaning**; those belong to the Companion and to `bk`. Recorded as
decision D-H in `booksFrontend/DECISIONS.md`, with the ring for each and with the
note that revisiting it is a product decision rather than a consequence of a
route existing.

> **`useMatchPiece` IS SWITCHED OFF IN THE UI, AND THIS PARAGRAPH USED TO SAY
> WHY IT WAS SAFE. IT WAS WRONG.** What stood here was: *"the entry #number is
> disambiguated by the pièce's own book — `matchPiece` asks
> `journalOf(piece.entity_id)` first … the caller supplies context rather than
> having to get a number right, which is the shape ticket #51's `resolve` should
> be fixed into."* `journalOf` chooses **which journal** — grand livre or
> recettes-dépenses — and nothing more. The recettes-dépenses branch then filters
> its lookup on `entity_id`; **the grand-livre branch does not.**
>
> So for a double-entry book the entry is resolved on `workspace_id + seq`
> alone, exactly like the `resolve` route this paragraph held it up as the fix
> for. Verified 2026-08-18 against the seeded workspace:
> `bk books piece match 1 --entry 16` attached blackcode SA's pièce to AIOS
> Companion SA's écriture, printed `matched piece #1 -> entry #16`, exited 0,
> replaced that entry's Drive reference and SHA-256 with a NULL hash, left
> `evidence_tier` at `full` and wrote nothing to `history`. The data was restored.
>
> The web form is withheld for this reason (`components/pieces-inbox.tsx`, and
> the documents screen now says so to the reader). **`bk books piece match` is
> not a workaround** — it reaches the same code. Re-enabling both waits on the
> server filtering the grand-livre lookup by entity; ticket #53.
>
> The same claim was in `booksFrontend/DECISIONS.md` D-G and is corrected there
> too. It is worth noting how it survived: the call to `journalOf(piece.entity_id)`
> is real and is on the line the claim points at, so reading the code confirmed
> the sentence. Running it did not.

### A write answers with a RESULT, not with `null` and a flag

`run` resolves to `WriteResult<T>` — `{ok: true, data}` or
`{ok: false, error, message}` — and `message` already carries the route's own
`suggestion` joined onto its reason.

**Read the failure off that return value, never off `mutation.error`.** `error`
is React state and is null in the tick its setter ran, so a submit handler that
reads it shows a generic fallback while the server's sentence is discarded. That
bug shipped once on the sign-up form ("Could not create your account." over
"Email already registered. Sign in instead, or use a different email."), and
[`lib/account.ts`](../lib/account.ts) carries the full account of it.

It matters more on recognition than anywhere else, because every refusal that
route can raise is one a person can act on:

| code | what the reader must be told |
|---|---|
| `bad_recognition` | unrecognized and inferred are the states resolve moves AWAY from |
| `bad_rule` | a taught rule needs a counterparty fragment |
| `posted_lines_frozen` | a correction is a reversing entry; explanation, counterparty and recognition still apply |
| `missing_counterparty` | a rule needs a counterparty fragment |

A screen rendering "Could not save" over the third one tells an accountant the
app is broken when what happened is the law working.

### `useCanWrite()` still returns `true`, and that is now a statement

Phase 0 wrote "phase 2 replaces this with the workspace role". Phase 2 read the
wire and could not: **no route this app serves tells the browser the signed-in
person's role in this workspace.** `books.workspace_members.role` exists and is
read only on the server, inside `resolveWorkspace`. Inventing a role client-side
would be a gate that guesses. The frontend report asks for `role` on
`GET /api/workspaces/{ws}`; until it lands, everyone who can reach a workspace
can write in it, which is what the server already enforces.

**Gate every affordance on it anyway** — including the button that opens a form,
not only the form. A button that renders and then explains it cannot do anything
is a dead affordance, and the reader learns the app is broken rather than that
they lack a permission.

## 6. What phase 0 gave you to build with

| Module | What |
|---|---|
| [`lib/types.ts`](../lib/types.ts) | the wire shapes. Money is a **string**, dates are ISO strings |
| [`lib/format.ts`](../lib/format.ts) | `money`, `group`, `date`, `percent`, `amount` |
| [`lib/statements.ts`](../lib/statements.ts) | art. 959a and 959b line structures, in legal order |
| [`lib/vocabularies.ts`](../lib/vocabularies.ts) | the seven vocabularies, with colours |

Three things about these that will bite otherwise:

- **Money crosses the wire as a string** and stays one. `numeric(14,2)` does not
  fit a float, and a bilan balances to the rappen. `amount()` exists for view
  arithmetic only, never for display.
- **`format.ts` uses an ASCII apostrophe** for grouping, not sales' U+2019, and
  keeps two decimals where sales rounds to whole francs. Both are deliberate: the
  phase 1 acceptance test compares output string for string against the mockup.
  Do not "fix" either.
- **Vocabulary colours travel with the value.** Never hardcode one, and never
  spell a vocabulary into prose. Both go stale the day a value is added, with
  nothing to say so.

**Zero-balance legal lines still exist.** They may be collapsed visually. They
are never absent from the model.

**Three figures will not match the static mockup, on purpose.** blackcode has
two entries dated 2025, and the API keeps them in a closed exercice 2025 while
the mockup summed both years into one statement. The 2026 bilan totals are
identical to the rappen, but résultat de l'exercice, résultat reporté and the
CR's autres charges each differ by the 2025 result (4850.00). If you are
comparing a screen against the mockup and one of those three is off by exactly
that amount, the API is right. The full reasoning is in
[`lib/db/seed.ts`](../lib/db/seed.ts), and `lib/db/seed-parity.test.ts` pins it.

## 7. What was missing, and what the frontend chose — settled 2026-08-17

> **This section described an absence. The absence was filled on 2026-08-17 by
> the frontend's sprint 1, so it now records the DECISION instead.** The original
> wording ("there is no TanStack Query and no provider… also absent: any shell,
> nav, or theme wiring") was correct when written and is not any more.

The dependency set was left to the frontend rather than guessed, and the frontend
took the stack the root [`docs/frontend.md`](../../../docs/frontend.md) already
makes the platform convention, copied from
[`apps/sales/app/providers.tsx`](../../sales/app/providers.tsx):

- `@tanstack/react-query`, `next-themes`, `sonner`, `lucide-react` — plus
  `clsx`, `tailwind-merge` and `tw-animate-css`, at the versions `apps/sales`
  pins.
- `app/providers.tsx` in the order that file's header specifies:
  `SessionProvider → QueryClientProvider → ThemeProvider → ConfirmProvider`.
- `app/globals.css` is now this app's own palette: **ledger gold `#e8b84b`**,
  cream neutrals, `--radius: 0.5rem`. Token *names* are unchanged, so the
  `@blackcode/platform-ui` primitives keep working.

Two things a backend reader should know because they touch this file's contract:

- **`lib/query-keys.ts` is new and every read goes through it.** Almost every
  read in this app is scoped by `(entity, exercice)`, so the key shape is
  `['books', resource, { entity, exercice, …filters }]`, spelled in one module
  and enforced by `lib/query-keys.test.ts`, which scans for a `queryKey:` written
  any other way.
- **`lib/read-only.test.ts` permits a SECOND write module**, `lib/account.ts`.
  It held two writes when this was written (`POST /api/auth/register`, `PATCH
  /api/me`) and holds **seven** since 2026-08-19 — the account surface in §10.
  Not one of them touches `books.*`, which is the test for whether something
  belongs there. `lib/mutations.ts` is still the only module that writes to the
  books. **The books writes are five since 2026-08-18** — see §5 for what added
  the fifth and why. The reasoning is in both files' headers.

**One correction this section owes you:** §2's table and `lib/types.ts` both
declare `entities` as an `Entity[]`. `app/api/meta/route.ts` actually serves
`entities: { source, note, data }` — the envelope that carries
`source: "fixture" | "database"`, which is the field the whole phase-0 contract
turns on. The route is right and `BooksMeta` in `lib/types.ts` is stale. The
frontend types against the wire shape (`MetaPayload` in `lib/hooks.ts`) and is
not going to edit `lib/types.ts`.

## 8. The thirteen screens, and when each gets real data

> **This is a map of screens to PHASES. It is not a route map** — the per-route
> mapping lives with each phase's own plan. And the paragraph that used to sit
> here advising "build analytique early against fixtures" has been **deleted
> rather than annotated**, because it prescribed a design this app rejected:
> components never import `fixtures/mockup.json` (§3), and analytique has no
> route until phase 4. Rewritten 2026-08-18.

| Screen | Live at | Built |
|---|---|---|
| Vue d'ensemble, Grand Livre, Transaction, Bilan, Compte de résultat | phase 1 | yes |
| Patrimoine, Accounts | phase 1 | yes |
| Reconnaissance | phase 2 | **yes, 2026-08-18** |
| Comptes & sources, Source detail, Pièces justificatives | phase 3 | **yes, 2026-08-18** |
| Compta analytique | phase 4B | **yes, 2026-08-19** |
| Analyses, Analyse detail, Impôts | phase 4B / 5 | **yes, 2026-08-19** |
| Compliance rules | phase 5 | **yes, 2026-08-19** |

**Nothing in this app renders `<NotBuiltYet>` any more.** The component stays,
because the next route this app grows will need it.

**Two of these are OFF-NAV and reached from a cross-link on the overview**
(`lib/nav.ts`): Impôts, because tax tracking over time is a different product
and a permanent nav item would promise it; and Compliance rules, because signing
a rule off is not part of a working loop. Compliance is also the only entry in
that file with `scoped: false` because of the DATA rather than the screen — the
route is not under `/api/workspaces/{ws}/` at all.

**Two of phase 3's screens are NOT book-scoped, and `lib/nav.ts` says so.** A
source can feed more than one book and `books.source.entity_id` is nullable; a
scanned receipt does not always say whose it is and `books.piece_inbox.entity_id`
is nullable too. A book filter would hide exactly the rows a person is on those
screens to find. `/documents` is therefore `scoped: false`, and the sources
register on `/sources` ignores the scope while the chart of accounts above it
does not — a half-scoped screen, named in the copy rather than hidden.

**The pièces inbox lives at `/dashboard/{ws}/documents`, not `/pieces`.** The nav
has had a `paperclip` item there since phase 0, sitting third on purpose;
building at `/pieces` would have left it pointing at `<NotBuiltYet>` and put the
real screen at an address nothing links to.

**Build against the ROUTE, in phase order, and open the page.** A screen built
ahead of its route is a screen built against a shape nobody has served, and a
wire shape that changes does not fail to compile — it renders `undefined` and an
accounting screen makes something up.

## 9. Language — EN / FR since 2026-08-20

**b/books is bilingual.** The switch is on the blackcode account
(`platform.users.locale`), the mechanism is the shared
`@blackcode/platform-i18n`, and **every string in `app/` and `components/` comes
from `lib/dictionary/`**.

D-A was rewritten on the day this shipped. The old rule — "English chrome, no
i18n system, no toggle" — survives in exactly one clause, and it is the clause
that mattered.

### The three kinds of text, and the function each goes through

| Kind | Function | Locale-aware? |
|---|---|---|
| **Our copy** | `t('nav.overview')`, `lib/i18n.tsx` | Yes |
| **A served `{fr, en}` pair** — account names, explanations, notes | `useLabel()` → `pick()` | Yes |
| **A statutory LINE label** | `legal()` in `lib/label.ts` | **NO — French in both** |
| **The English side, specifically** | `en()` | No, and that is its meaning |

`en()` deliberately did **not** become locale-aware. It has one caller left —
`<StatementTable>`'s gloss beside a French statutory line, rendered only for an
English reader, because glossing French with French shows the same words twice —
and `lib/analysis.test.ts` asserts on it. Redefining a function under an
assertion that keeps passing is CLAUDE.md finding #10. `pick()` is new; `en()` is
untouched.

### What the switch does not reach

1. **A statutory line label.** Art. 959a / 959b fix that wording.
2. **Anything exported or filed.** No export exists yet; when one does it is
   French whatever the reader chose. `lib/label.ts`'s header carries the rule
   where an export would import it.
3. **A served vocabulary.** `/api/meta`'s recognition states, evidence tiers and
   source statuses carry their own labels. A second language is a backend ask.
4. **`bk`.** English, and staying English.

### The document heading follows the reader

`<StatementHeading fr={…} en={…}>` — `fr` is the LEGAL name (French in both
languages), `en` is the name in the reader's language. The h1 is `en`, and `fr`
is rendered under it **only when the two strings differ**, which is the test that
gives a French reader one heading rather than the same word twice. The prop names
did not change with their meaning; the component's header records why.

### Where the strings live, and the two guards

`lib/dictionary/`, one file per area, each owing **both** languages:

```ts
export const en = { 'nav.overview': 'Overview' } as const
export const fr: Record<keyof typeof en, string> = { 'nav.overview': 'Vue d’ensemble' }
```

- **The type is the strong guard.** `Dictionary<BooksKey>` is
  `Record<Locale, Record<K, string>>`, so an English string added without its
  French fails `tsc` — at the call site *and* in the French table. It cannot be
  worded wrongly and cannot go inert. It even covers a computed key:
  ``t(`landing.f${n}.title`)`` narrows against `BooksKey` with no cast.
- **`lib/hardcoded-strings.test.ts` is the weak one.** A text scan for a
  sentence that never reached the dictionary at all. Its own header names the six
  things it cannot see, and it was watched to fail six ways before being
  believed.

**A `lib/` module that holds copy holds KEYS, not words.** `lib/nav.ts`
(`labelKey`), `lib/compliance.ts` and `lib/verdict.ts` (`labelKey` /
`meaningKey`) are the three, converted on 2026-08-20 — a pure function cannot
call a hook, and a face table full of English is invisible to every scan.

### No flash, and `<html lang>` follows

`app/layout.tsx` resolves the locale on the SERVER from the session row and
passes it to `<Providers locale>`. The first paint is already correct — this is
strictly easier than the theme, which needs a blocking script because
`localStorage` is unreachable from the server. **There is no `useEffect` that
swaps the language after mount, and there must never be one.**

The one effect in the whole arrangement lives in the package and writes
`document.documentElement.lang` when the value changes, so a reader who switches
without navigating does not leave the document announcing the wrong language to a
screen reader. That was measured, not assumed: every visible string changed and
`lang` did not.

### Writing it

`useSetLocale()` in `lib/account.ts` — an ACCOUNT write, not a books one, which
is why it is in that file and named by `lib/read-only.test.ts`. It moves three
things: the column (`PATCH /api/me`), the React context (so the switch is
immediate) and the `bk_locale` cookie (so the SERVER is right on the next request
and `/login` is right with no session at all). Both switches — Settings →
Preferences and the sidebar — call it, because two code paths is how they end up
disagreeing, and in this app the sidebar is on the settings page.

**`null` is a real argument.** It clears the preference and hands the reader back
to `Accept-Language`; the settings page spells it "Follow my browser". Without it
a choice made once could be changed but never undone.

---

## 10. The account surface — auth, settings, tokens (2026-08-19)

**None of this is b/books.** It is the blackcode account: one `platform.users`
row, one `platform.api_tokens` list, one password, shared by every app in the
suite. The equivalent sections are `apps/sales/docs/frontend.md` §6 and §9, and
this app deliberately matches them rather than inventing a third arrangement —
somebody who knows where their tokens live in b/issues must find them in the same
place here.

### 10.1 What b/books serves, and what it did not

b/books took fullstack ownership on 2026-08-19 and mounted the five routes the
other two apps already had. Before that day, three screens carried the same
apology — the login page said to reset a password in b/issues or b/sales, and
Settings said b/books had no password form — and all three were true. It was not
a policy decision; it was `@blackcode/platform-email` never having been added and
the routes never having been mounted.

| Route | Factory | Front door |
|---|---|---|
| `POST /api/auth/password-reset/request` | `publicPasswordResetRequestRoute` | login → Forgot password? |
| `POST /api/auth/password-reset/confirm` | `publicPasswordResetConfirmRoute` | same panel, step 2 |
| `POST /api/me/password/request-otp` | `passwordRequestOtpRoute` | Settings → Account |
| `POST /api/me/password/confirm` | `passwordConfirmRoute` | same panel, step 2 |
| `GET`/`POST` `/api/tokens`, `DELETE /api/tokens/{id}` | `tokensRoute`, `tokenRoute` | Settings → API tokens |
| `POST /api/cli/authorize` | `cliAuthorizeRoute` | the `/cli/authorize` page |

**All six are session-only.** `requireSessionResolver` throws at MOUNT TIME if
the app supplies no session resolver, and does not fall back to a bearer token: a
token that can mint another, or change the password behind itself, is a
credential that can lock its owner out. That is why every one of them is in
`lib/cli-parity.test.ts`'s `EXCLUDED_PATHS` with its own reason — they are
structurally unreachable from `bk`, not merely unimplemented there.

### 10.2 `/cli/authorize` is a page, and it is why `bk login --server` works

`bk login` opens `/cli/authorize` in a browser on whichever server it was pointed
at; the PAGE posts to that server's `/api/cli/authorize`. Mounting the route
without the page is the invisible failure: a 404 in the browser and a terminal
waiting for a callback that never comes. `bk login --server https://books…`
404'd until this page existed, while `bk guide` had said for months that
`--server` may name any deployment.

`parseCallbackURL` refuses anything that is not a localhost loopback, in the page
AND again in the route. The page checks first so a bad request is refused with a
sentence instead of a button that fails after the click.

### 10.3 Settings is four tabs, the same four as the other apps

`/dashboard/settings` redirects to `/profile`. The tabs are **Profile**,
**Account**, **API tokens**, **Preferences** — same order, same labels as
b/sales.

- **Profile** — name, tagline, photo. `PATCH /api/me`. The email is rendered as
  text, not a disabled input: changing it is changing which account you are, in
  every app, and there is no route that does it. A disabled field would imply one
  exists.
- **Account** — sign-out, the password form, the ten-year note, and the address
  book. A Google-connected account is told its credential lives at Google rather
  than being offered a form that sends a code for a password it does not use.
- **API tokens** — mint, copy once, revoke in two steps. The revoke confirmation
  names the token, for the same reason the CLI's irreversible verbs make the
  caller repeat the target back: an agent losing its credential mid-run does not
  look like a bin icon being clicked, it looks like the API being down.
- **Preferences** — the theme, and only the theme. b/sales' version holds
  `ui_mode`, a per-workspace row this app does not have. The page says the choice
  lives in the BROWSER; a settings page that does not distinguish "saved to your
  account" from "saved on this laptop" is how somebody concludes the app lost
  their preference.

The **shell is mounted in the settings layout**, not in `[ws]/layout.tsx` —
settings is a sibling of `[ws]`, not a child. b/sales shipped every settings page
with no sidebar for exactly this reason and fixed it the same way. With no
membership at all the pages still render, frameless: somebody whose workspace
bootstrap failed is exactly the person who needs their profile and their tokens.

### 10.4 Two things that will look like bugs and are not

**The reset flow answers `200` locally with no Resend key**, and says "we sent a
code". `canDeliverEmail()` is `emailEnabled() || NODE_ENV !== 'production'`, and
outside production the code goes to the **server log** —
`[password-reset] OTP for …` in `npm run dev`'s output. Refusing there would make
the flow untestable without a Resend account. In production an unconfigured app
refuses with `503 email_not_configured` and a suggestion naming the two env vars.
Verified end to end on 2026-08-19: request → 200 → code in the log → confirm →
back to sign-in.

**`bk token list` 401s against a bearer token.** That is `requireSessionResolver`
doing its job and it behaves identically in every app; a token cannot list or
mint tokens. Use the browser, or `bk login`.

### 10.5 Where the writes live

Every one of these goes through **`lib/account.ts`**, never `apiSend` in a
component and never `lib/mutations.ts`:

- `lib/mutations.ts` — the five BOOKS writes, gated on `useCanWrite()`
- `lib/account.ts` — the **eight** ACCOUNT writes, gated on nothing (the server
  gates them; this module is transport plus a loading flag). The eighth is
  `useSetLocale`, added 2026-08-20: it writes `platform.users.locale` through
  `PATCH /api/me`, and it is here rather than in `lib/mutations.ts` for this
  file's one test — it touches no `books.*` table

`lib/read-only.test.ts` names exactly those two modules and goes red on anything
else that imports `apiSend`, under any alias. The test for which file something
belongs in is one question: **does it touch `books.*`?** These do not.
`useAccountWriteAt` exists because revoking a token needs a path known only when
the row is clicked, and hooks cannot be called per row.
