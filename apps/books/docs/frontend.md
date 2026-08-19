# b/books — frontend

**This app only.** Platform-wide conventions, the tokens, the
`@blackcode/platform-ui` primitives, the app shell pattern, are in the root
[`docs/frontend.md`](../../../docs/frontend.md) and are not repeated here.

**Status: phase 0 complete, 2026-08-17.** The contract exists. No b/books screen
exists yet. One books route is live. What each phase turns on is in
[`docs/books-app-plan/`](../../../docs/books-app-plan/README.md).

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

Three of these do **not** use the shared `{data, next_cursor}` envelope, and a
hook that reached for `apiList` would render an empty screen over a full one:
`…/worklist` is `{entity, exercice, count, rows}` and `…/sources/{n}/manifest`
is `{source, files}`. `…/sources` and `…/pieces` ARE list routes. All four are
pinned in `lib/wire-parity.test.ts`.

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

Everything else under `app/api/` is platform scaffold: auth, `/api/me`,
workspaces, members, invitations.

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

**Four of the five write hooks are real** (2026-08-19): `useResolveEntry` and
`useCreateRule` from phase 2, `useMatchPiece` from phase 3, and **`usePostEntry`
from phase 4A**, all in [`lib/mutations.ts`](../lib/mutations.ts).
`useApproveComplianceRule` is still commented out and arrives with the screen
that needs it. It is commented rather than stubbed, because a stub that returns
success is a lie a component builds on.

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
- **`lib/read-only.test.ts` now permits a SECOND write module**, `lib/account.ts`
  — for `POST /api/auth/register` and `PATCH /api/me`, neither of which touches
  `books.*`. `lib/mutations.ts` is still the only module that writes to the
  books. **The writes are five since 2026-08-18** — see §5 for what added the
  fifth and why. The reasoning is in both files'
  headers.

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
| Compta analytique, Analyses, Analyse detail, Impôts | phase 4 | no |

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

## 9. Language

**English chrome.** French only where the law fixes the wording: the bilan and
compte de résultat line labels, which the filed PDF has to reproduce. Those
arrive from `lib/statements.ts` and from the API, already in French. Never
translate them and never write French UI copy around them.
