# b/books build plan: the six phases

How b/books gets built in this repo as `apps/books`.

Read this first, then the phase doc you are working on. One doc per phase sits
beside this file.

## Start here: [week one](week-one.md)

The six phases below are the full build. **[`week-one.md`](week-one.md) is the
compressed first slice**: a real, correct bookkeeping tool in seven days, cutting
a vertical slice through phases 0, 1 and 2.

It differs from the phase docs in five deliberate ways:

1. Four screens, not thirteen. Build a vertical slice, not every layout.
2. The CLI carries every write. The UI is read only, with one exception.
3. Seven tables. Seven more are deferred, and documents become a pasted Drive
   link on the entry.
4. The sole proprietorship elects voluntary double entry, so there is one ledger
   model instead of two.
5. Six invariants stay non negotiable anyway, because each is an afternoon and
   they are what makes it bookkeeping.

Nothing built in week one is thrown away. Read that doc first if you are
building; read the phases below for the full specification of anything it
touches.

## What b/books is, in three lines

Swiss statutory bookkeeping for three separate sets of books: blackcode SA, AIOS
Companion SA, and Andrea's sole proprietorship. It turns raw bank noise into
explained, audit defensible records. It holds no intelligence of its own: agents
run outside it and drive it through `bk books`.

## Where the source material lives

This plan is derived from a finished static HTML mockup in a **separate repo**,
`b-mockups`, under `bbooks/`. That mockup is the specification. Where this plan
and the mockup disagree, the mockup wins, exactly as
[`sales-app-plan.md`](../sales-app-plan.md) treated `bsales-mockup`.

| In the `b-mockups` repo, under `bbooks/` | What it gives you |
|---|---|
| `BRIEF.md` | The Swiss accounting research: CO articles, SA vs sole proprietorship, VAT, bank formats, related parties. Read before touching the data model. |
| `dev-handoff/DATA-MODEL.md` | Every table implied by the mockup, with fields, relationships, and the 16 invariants you must never break. **Caution: extracted at mockup v17, and the mockup is at v19.** One confirmed gap: the analysis record gained `scenario_label` and `runway_after_months` at v18. Verify field by field against `bbooks-data.js` before migration 0001. |
| `dev-handoff/SCOPE.md` | What is in v1, what is a later phase, and the explicit non goals. |
| `dev-handoff/ARCHITECTURE.md` | How the mockup's structure maps onto a real backend. |
| `dev-handoff/OPEN-DECISIONS.md` | Settled vs pending. The authoritative list. |
| `assets/bbooks-data.js` | The reference implementation. Every calculation in this plan exists there as working code. |

Run the mockup from the `b-mockups` root with `serve.cmd`, then open
`http://localhost:8734/bbooks/index.html`. **Do not modify it.** Parity with it
is the acceptance test for phases 1 to 4.

## The one rule above all others

Do not mess up the accounting. These are a real company's real books. When
anything about the ACCOUNTING is ambiguous, stop and ask Andrea rather than
guessing a plausible looking financial structure. Gaps in the mockup's sample
DATA are different: note the pattern and move on.

## The shape of the app

Every phase adds to these same four layers. The diagram in each phase doc is
this picture with that phase's files filled in.

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘

┌─ UI ────────────────────────────────────────────────────────
│  components/**       read mostly. only four buttons write.
│  lib/client.ts       the only fetch in the app
│  lib/mutations.ts    the only gated write hook
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  cli/internal/commands/books/**   one command per route
│  cli/internal/client/books.go     the wire types
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/**   thin. auth, validate, shape.
│  lib/derive/**                pure maths, never stored
│  lib/db/queries/**            the ONLY place that touches SQL
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        the tables, in the books schema
│  lib/db/migrations/**    tables, guards, grants
└─────────────────────────────────────────────────────────────
```

Two rules the picture encodes:

**UI and CLI are parallel consumers of the same routes.** Never two
implementations of the same logic, one for humans and one for agents.

**Nothing skips a layer.** A component never calls the database, a route never
holds business logic, and a calculation never writes.

## The plan in one table

Plain terms. This is the version to read first, and the version to show anyone
who is not building the backend.

| Phase | Data (what we store) | Business logic (what the code works out) | UI (what the frontend builds) |
|---|---|---|---|
| **[0. Contract](phase-0-contract.md)** | • Nothing goes into a database in this phase.<br>• Sample data is copied out of the mockup into JSON files.<br>• Those files are what every screen reads from for now. | • Turn a raw number into money text like CHF 1'234.50.<br>• Turn a raw date into a readable date.<br>• Serve one list of allowed values for every dropdown and chip. | • Build the layout of all 13 screens using the sample files.<br>• Screens look finished but are connected to nothing real.<br>• This is the frontend dev's main stretch of work and it starts immediately. |
| **[1. Statutory core](phase-1-statutory-core.md)** | • Store books, which the user creates and can have any number of, with their financial years and account lists.<br>• Store every money entry with its two sides, plus a link to its supporting document.<br>• Store the starting balance of each account at the beginning of each year. | • Add up all entries to get the current balance of each account.<br>• Build the balance sheet and the profit and loss report from those balances.<br>• Refuse any entry whose two sides do not match, and refuse any edit to a saved entry. | • Five screens go live with real numbers.<br>• Those are overview, entry list, single entry, balance sheet and profit and loss.<br>• The frontend dev swaps sample files for real calls on those five. |
| **[2. Recognition](phase-2-recognition.md)** | • Store rules such as "payments to this landlord on this account mean office rent".<br>• Store which entry taught each rule.<br>• Keep every entry's original unexplained state forever. | • Compare each new bank line against every rule and explain it if one matches.<br>• Put anything that matches nothing onto a to do list.<br>• Save a human's explanation as a new rule so the same thing is automatic next time. | • One screen goes live, the to do list.<br>• The first buttons that change data appear here.<br>• The save pattern built here is reused by every later screen. |
| **[3. Sources and pièces](phase-3-sources-pieces.md)** | • Store every place money data comes from, such as bank accounts, cards and Stripe.<br>• Store the raw files pulled from each of those places.<br>• Store receipts and invoices as a link to the file, never the file itself. | • Work out whether a source is up to date, late or missing data, from how often it should update.<br>• Accept receipts posted in by an outside robot and recheck its maths before trusting it.<br>• Flag two receipts that look identical instead of deleting one. | • Three screens go live.<br>• Those are the source list, one source's detail page and the receipts inbox.<br>• Nothing here changes a balance, so these screens stay almost entirely read only. |
| **[4. Management](phase-4-management.md)** | • Store past answers to business questions such as "can we afford this hire".<br>• Store the exact numbers each answer was based on at the time.<br>• Store which account belongs to which spending category. | • Work out income per month and spending per month.<br>• Work out where the money goes by category, such as tools versus salaries versus office.<br>• Work out the tax estimate from the profit and the equity. | • Four screens go live and all 13 are then finished.<br>• The dashboard with real charts is the single biggest piece of frontend work in the project.<br>• Those charts can be built earlier against sample files, so they do not have to wait. |
| **[5. Compliance](phase-5-compliance.md)** | • Store the rulebook of legal checks.<br>• Store the verdict each check gave on each entry.<br>• Store whether a human approved, edited or rejected each rule. | • Refuse to save an entry that a check marked as blocked.<br>• Refuse to delete anything, because Swiss law requires keeping records for ten years.<br>• Never invent a score or a judgement, only report facts such as a missing document. | • Warning flags appear on entries that failed a check.<br>• One new screen lets a human approve or reject each legal rule.<br>• No other screen changes. |

## Why the order is what it is

The tables each phase adds are listed in its own phase doc. This table is only
the ordering argument, which is the part people push back on.

| Phase | Screens live after it | Why it sits here |
|---|---|---|
| **0. Contract** | 0 | First, always. It costs little, it comes out of the mockup before a database exists, and it unblocks the frontend dev permanently. |
| **1. Statutory core** | 5 | The keystone. Three calculations unlock 5 screens and feed 3 more. The year and company scoping decided here cannot be changed later. |
| **2. Recognition** | 6 | Needs saved entries to explain. Comes before receipts because its to do list is where receipt review lands. |
| **3. Sources and pièces** | 9 | Needs both predecessors: entries to match receipts against, and phase 2's to do list to review them in. |
| **4. Management** | 13 | Must be last. The dashboard reads from every phase before it, so built earlier it gets built twice. |
| **5. Compliance** | 13 plus one | Needs records to flag. The retention answer needs the full set of tables to be honest about what it holds. |

## Fixed vs movable

Phase 0 then 1 is fixed. Phase 4 must follow everything.

The one flex is inside phase 3: the sources register alone could move ahead of
recognition if the completeness view is wanted early. Pièces cannot, because
their review lives in phase 2's worklist.

## The 7 pieces every page needs

Each phase produces complete sets of these for a group of pages.

| # | Piece | Lives in | Can ship before data? |
|---|---|---|---|
| 1 | Shape: the public JSON a component types against | `lib/types.ts` and the route's shaping function | yes |
| 2 | Vocabulary: chips and enums | `/api/meta`, served as `bk books meta` | yes |
| 3 | Seeded rows | migration plus seed script | no |
| 4 | Route: workspace scoped GET | `app/api/workspaces/[ws]/...` | no |
| 5 | CLI command with a `routes:` annotation | `cli/internal/commands/books/` | no, same PR as the route |
| 6 | Derivation: pure function, never a stored amount | `lib/derive/*.ts` | no |
| 7 | Mutation: only the four intervention points | `lib/db/queries/*` | no |

Pieces 1 and 2 come out of `bbooks-data.js` mechanically. Do them for all 13
pages at once in phase 0.

## The CLI is not a separate phase

`bk` is the only supported interface for agents. The HTTP API is private
plumbing with no public contract. So the CLI is not a later workstream, it is
half of every route you write.

The parity test enforces this. A route with no command fails the build. A command
naming a route that does not exist fails the build.

| When | CLI work |
|---|---|
| Phase 0 | The scaffolding: command group, registration in `root.go`, guide topics folder, typed client. Plus `bk books meta` and the workspace reads. Required, because route attribution reads the guide topics folder. |
| Phases 1 to 4 | One command per route, in the same pull request as the route. Listed in each phase doc. |
| Phase 5 | Guide topics filled out. `bk books meta` completed. |

**Two things with no precedent in the repo.** Both are yours to design.

1. `--entity` and `--exercice` flags. Every other app scopes by workspace and
   stops. b/books has two more dimensions. Decide the grammar in phase 1 and keep
   it identical across every command.
2. The app owned verb tier (`bk books trash`, `label`, `upload`). Mount none of
   them. Uploads go to Drive, not Vercel Blob. Accounting rows have no purge
   path. An app that mounts neither the verbs nor the routes is a valid state and
   nothing complains, but write the decision down so it does not read as an
   omission.

## Three things nothing may assume

**The number of books is open.** The user creates them. Three are seeded, and no
query, screen, test or tax parameter may hardcode three. Anything scoped to a
canton or commune belongs to the entity, not to the app.

**The API shape is the mockup's shape.** `lib/types.ts` mirrors `bbooks-data.js`
field for field, because the frontend dev codes against it. Renaming a field
costs them a rewrite. See phase 0.

**Every entry legally needs a supporting document, and the column is still
nullable.** Art. 957a al. 2 CO requires one, but entries exist with no
recoverable document, so `evidence_tier` records what evidence there is rather
than the schema refusing the row. Documents are Drive links, never uploads. See
phase 1.

## Rules that hold in every phase

1. The query layer is the only place that touches the database. Routes stay thin.
2. Every route needs a `bk` command in the same pull request. The parity test
   fails the build otherwise.
3. Never expose the serial `id`. Expose the workspace `seq` as `number`.
4. Money is `numeric(14,2)`. Never a float.
5. Soft delete only. No hard delete for accounting rows (10 year retention).
6. Never store a derived amount. Derive it every time.
7. Accounting doubt: stop and ask Andrea. Mock data gaps: note the pattern and
   move on.

## Decisions needed before phase 1

Three of these block migration 0001.

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Workspace = one client's books with an `entity_id` column, or workspace = legal entity? | **Settled: one workspace, `entity_id` column.** The user creates books and may have any number, so a workspace cannot be one book. Matches the mockup's `?entity=`. Keeps related party mirroring simple. | migration 0001 |
| D2 | One number or two: platform `seq` vs a gapless per exercice `entry_no`? | Two. `seq` addresses a row. `entry_no` is the statutory journal number. | migration 0001 |
| D3 | Language | UI and CLI in English. Statutory line names stay French (they are legal text and the filed PDF must be French). Needs a one line confirmation from Andrea. | phase 0 |
| D4 | URL and CLI grammar for exercice | `?entity=...&exercice=2026` on routes. `--entity` and `--exercice` flags with remembered defaults. | phase 1 routes |
| D5 | Does the frontend call routes directly? | Yes. Frontend uses routes, agents use `bk`, both over the same query layer. | phase 0 |

## Two open items to raise, not solve alone

**Footprint.** `AppContext.footprint` is required and answers "what does this app
hold for a person, and how do you remove it". b/books cannot delete anything for
10 years. The account close flow has to handle an app that refuses. Nobody has
hit this before. Raise before implementing.

**i18n.** The platform has none. Building one is platform work, not app work.
See D3.

## Related documents

**In this repo**, read these before starting phase 0:

- [`adding-an-app.md`](../adding-an-app.md): the authoritative checklist. Walk it
  top to bottom. Read "what the second app actually cost" before estimating.
- [`platform-architecture.md`](../platform-architecture.md): current design rules
- [`platform-db.md`](../platform-db.md): the database boundary, roles and grants
- [`working-in-this-repo.md`](../working-in-this-repo.md): conventions
- [`sales-app-plan.md`](../sales-app-plan.md): the precedent. Same job, one app
  earlier.

**In the `b-mockups` repo**, under `bbooks/`: see "Where the source material
lives" at the top of this file. `BRIEF.md` and `dev-handoff/DATA-MODEL.md` are
the two that matter most.

## Status

This plan is a draft written on 2026-08-17, before `apps/books` exists. Two of
its decisions (D1 and D3 above) are still unconfirmed by Andrea, and the mockup
it derives from has three slices still pending: prior year backfill, multi year
navigation, and the statutory PDF export. Those will add screens beyond the 13
counted here.

When `apps/books` exists, this folder moves to `apps/books/docs/`, per the
placement rule in `working-in-this-repo.md`. It sits in root docs for now because
there is no app directory to hold it, which is the same reason
`sales-app-plan.md` sits here.
