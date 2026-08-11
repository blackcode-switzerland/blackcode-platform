# Multi-app final refactor — separating the apps, keeping one login

**Status:** plan, not yet started. Written 2026-08-10.
**Read `SAFETY.md` first if you are about to touch the database.**

---

## 1. What we are changing, and why

The platform was built on a misreading of one sentence. The requirement was:

> *An AI agent working in sales can create an issue in the issues app through the
> same CLI, without switching login.*

That was read as **"the apps share their data"**. It actually means **"the agent
is the thing that connects the apps"**. The difference is the whole refactor.

What the flow genuinely needs is two things, both of which already work:

1. One account, one password, one token — valid against every app
2. One CLI binary that knows every app's address

It does **not** need sales to know about issues' workspaces, comments, inbox,
labels, or activity. Those were built anyway, and they are what makes sales feel
like an add-on to issues rather than an app.

### The contract, after this refactor

| | |
|---|---|
| **Shared** | user accounts · passwords · API tokens · sign-in · the app registry (so the CLI knows where each app lives) · one Vercel Blob store (one bill, one quota — files are already tagged per app) |
| **Not shared** | workspaces · members · invitations · comments · labels · uploads ledger · activity · trash · search · everything else |
| **The connector** | the `bk` CLI, and the agent driving it. Not the database. |

### The sales-specific rule

Sales keeps workspace logic **under the hood**, defaulting to the signed-in
user's own workspace. No switcher, no picker, no workspace settings page —
a sales user never sees the word. If sales ever needs multiple workspaces, the
tables are already there and it becomes a UI change, not a migration.

---

## 2. The safety rule that shapes every phase

> **`apps/issues` is in production and people are using it. Not one comment,
> workspace, label, file or event may be lost, and it must keep working
> throughout. `apps/sales` has no users and no data worth keeping — it can be
> dropped and rebuilt at will.**

This gives the plan its central design decision, and it is what makes the whole
thing low-risk:

> ### We do not migrate a single row of issues' data.
>
> `platform.comments`, `platform.labels`, `platform.uploads`, `platform.events`,
> `platform.entities`, `platform.workspaces`, `platform.workspace_members` stay
> exactly where they are, with exactly the rows they have. Issues keeps reading
> and writing them, unchanged.
>
> What changes is that **sales stops using them** and gets its own. Sales' rows
> in those tables get deleted, and there are almost none.

The `platform.*` tables therefore end up shared-in-name and used by one app. That
is deliberate: renaming them to `issues.*` would mean moving production data for
a cosmetic gain. **Do not do it.** A note goes in the schema saying why.

---

## 3. What we lose, deliberately

Three things go away. Decided 2026-08-10; recorded so nobody re-litigates them.

1. **`bk link`** — recording "this issue relates to this prospect" in the
   database. The agent can put the prospect's address in the issue description
   instead. The link table is the single biggest reason the apps share an index.
2. **Cross-app `bk search` / `bk activity` from the database.** Phase 6 offers
   them back, done properly: the CLI asks both servers and merges the answers.
   Same experience, no shared tables.
3. **The per-workspace app switch** (`platform.workspace_apps`) and per-person
   app access (`platform.app_access`). Both exist to gate an app inside a
   workspace, which stops being a concept when apps do not share workspaces.

---

## 4. Where we are starting from

Measured 2026-08-10 — files in `apps/sales` that touch each shared thing:

| Shared thing | Files in sales | Fate |
|---|---|---|
| cross-app item index (`entities`) | 15 | removed |
| activity (`events`) | 14 | becomes `sales.events` |
| cross-app links | 13 | removed |
| labels | 11 | becomes `sales.labels` |
| comments | 8 | becomes `sales.comments` |
| uploads ledger | 5 | becomes `sales.uploads` |
| inbox | **0** | nothing to do |
| trash (`deletion_batches`) | **0** | already app-local |

---

## 4b. Every `platform.*` table, and what happens to it

All 21, so nothing is decided by omission. **Nothing in the "stays" column has a
single row moved or deleted.**

| Table | Fate | Why |
|---|---|---|
| `users` | **stays shared** | identity. The whole point |
| `api_tokens` | **stays shared** | one token, every app |
| `password_reset_otps` | **stays shared** | identity |
| `email_whitelist` | **stays shared** | who may hold an account at all |
| `apps` | **stays shared** | the CLI address book (`base_url`) and the blob registry |
| `blob_references` | **stays shared** | Phase 5 keeps it — see there. Already carries `app`, and its `workspace_id` has **no FK on purpose**, so it survives the split untouched |
| `uploads` | **issues keeps it; sales gets `sales.uploads`** | ledger, not storage. One Blob store either way |
| `comments` | **issues keeps it. Sales gets NOTHING** | **CORRECTED after agent 2.** Sales has never used this table — 0 rows in production, 0 call sites. PLAN.md §4 counted 8 files that contain the *word*, in `communications` and in prose. Sales' equivalent already exists: `sales.communications` with `channel = 'note'` (D-13) |
| `labels` | **issues keeps it; sales gets `sales.labels`** | |
| `events` | **issues keeps it; sales gets `sales.events`** | |
| `deletion_batches` | **issues keeps it. Sales gets NOTHING** | **CORRECTED after agent 2.** Sales' bin is `deleted_at` on the row plus a cascade stamping one instant; there are no batches, its restore route *refuses* `--batch` by name. §4 measured 0 files and I still specified the table — a batch table with no writer is a shape somebody later mistakes for a feature |
| `workspaces` | **issues keeps it; sales gets `sales.workspaces`** | |
| `workspace_members` | **issues keeps it; sales gets `sales.workspace_members`** | §4's survey scored this **0 files** and was wrong — sales reaches it only through shared `platform-api` factories, so its own files never name it. Trusting the zero would have left Phase 2 with nothing to bootstrap onto |
| `workspace_invitations` | **issues keeps it; sales gets `sales.invitations`** | |
| `inbox_messages` | **issues keeps it, alone** | sales touches it in 0 files. Nothing to move |
| `entities` | **issues keeps it; sales stops projecting** | sales' rows deleted in Phase 3 |
| `links` | **emptied of sales, then left to issues** | `bk link` retires; issues may keep intra-app links |
| `workspace_apps` | **DROPPED** | Phase 5. Meaningless once apps do not share workspaces |
| `app_access` | **DROPPED** | Phase 5. Same |
| `error_events` | **stays shared, and gains an `app` column** | see below — this is a real gap |
| `transaction_log` | **DROPPED** | see below — it is dead |

### `error_events` — the gap this refactor creates

Today it has a bare `workspace_id` **with no foreign key**, and **no `app`
column**. Both apps write to it and it works, because there is one set of
workspaces.

After the split there are two, and `workspace_id = 1` means two different
things depending on who wrote it. Every error becomes ambiguous and
`bk super-admin errors` starts reporting confidently wrong workspaces.

**Fix, in Phase 1, expand-only:**

1. `ALTER TABLE platform.error_events ADD COLUMN app varchar(40)` — nullable
2. Backfill existing rows to `'issues'`: every row predates the split, and
   issues is the only app whose workspace ids they can mean
3. The shared `apiHandler` sets it from `AppContext.appSlug` — every app gets it
   for free, which is the reason the error log is shared in the first place
4. Later, once both apps are writing it, `SET NOT NULL`

**Keep it shared.** It is an operator surface, not app data — one place to look
when something breaks, and an app inherits it by existing. Splitting it would
mean two error logs and a super-admin page that has to ask both.

### `transaction_log` — dead, drop it

`apps/issues/app/api/undo/route.ts` says so in its own header: *"the feature
never worked (`platform.transaction_log` had no writer, so every undo…)"*. The
undo route is a 410 now. Nothing in the codebase writes the table.

> **CORRECTED 2026-08-10, after agent 1.** This section said "expect
> `count(*) = 0`". **That is wrong**, and had it survived, Phase 5 would have
> stopped on a gate that was mis-specified rather than on a real problem — or
> worse, someone would have "fixed" the gate to let the drop through.
>
> Local dev has **4 rows**. They are stale: newest `created_at` is 2026-05-22,
> nearly three months old, from before undo was retired. Independently confirmed
> that nothing writes it — the only trigger in the entire `platform` schema is
> `trg_blob_refs on comments`. **Grepping the TypeScript was not sufficient to
> establish that; a Postgres trigger is not code any grep of `apps/` would
> find.** Check the catalog, not the repo.

**So the gate is "is anything still writing it?", not "is it empty?":**

```sql
SELECT count(*) AS rows, max(created_at) AS newest
FROM platform.transaction_log;
```

- **`newest` is months old** → stale residue. Rows are expected. Back up, then
  `DROP TABLE platform.transaction_log`.
- **`newest` is recent** → **STOP.** Something writes it that this audit did not
  find, and that is far more interesting than the table. Do not drop it.

Declare the row count as an EXPECTED decrease before dropping, or `verify.sh`
will correctly fail on the table vanishing.

---

## 5. The phases

Each phase is independently shippable and independently revertible. **Do not
start a phase before the previous one is deployed and verified.**

---

### Phase 0 — Backup, baseline, and the "nothing lost" ledger

**Goal:** make it impossible to lose issues' data without noticing.

**Nothing in the app changes.** This phase is entirely measurement and safety.

1. Take a full backup — see `SAFETY.md`. Both forms:
   - a Neon branch (instant, point-in-time, free)
   - a `pg_dump` file stored outside the repo
2. Capture a row-count baseline for every `platform.*` table plus every
   `issues.*` table, into `multiAppFinalRefactor/baseline.txt`.
3. Write `multiAppFinalRefactor/verify.sh` — re-runs those counts and **diffs
   them against the baseline**. It must print a per-table PASS/FAIL, and exit
   non-zero on any unexplained decrease.
4. **Watch it fail.** Delete one row in a scratch copy, run the script, see it go
   red, restore. A backup checker nobody has seen fail is not a checker — this
   repo has nineteen written-up cases of exactly that.

**Done when:** `verify.sh` passes against production, and has been seen to fail.

**Revert:** nothing to revert.

---

### Phase 1 — Sales gets its own foundations (additive only)

**Goal:** create everything sales will need, without switching anything over.
Nothing reads these tables yet, so nothing can break.

**Database — `sales` schema only. Issues is not touched.**

New tables, mirroring what sales currently borrows:

```
sales.workspaces              id, slug, name, owner_id, created_at
sales.workspace_members       workspace_id, user_id, role
sales.invitations             workspace_id, email, role, token, expires_at
sales.comments                workspace_id, parent_type, parent_id, author_id, body
sales.labels                  workspace_id, name, color
sales.uploads                 workspace_id, pathname, filename, size, uploaded_by
sales.events                  workspace_id, actor_id, action, entity_type, entity_id
sales.deletion_batches        workspace_id, root_type, root_id, deleted_at
```

Notes that matter:

- **Keep the workspace column everywhere**, even though sales will only ever
  have one per user for now. That is what makes multi-workspace sales a UI
  change later instead of a migration.
- `sales.comments.parent_type` holds bare nouns (`prospect`, `meeting`) — no
  `sales:` prefix. The prefix existed because the table was shared; it is not.
- Blob references: sales keeps a trigger maintaining `platform.blob_references`
  for now (Phase 5 decides its fate). **Do not touch that trigger in this
  phase** — read `packages/platform-storage/src/references.ts` first.

**One expand-only change to a SHARED table, and it is the exception to
"issues is not touched":**

```sql
ALTER TABLE platform.error_events ADD COLUMN app varchar(40);
UPDATE platform.error_events SET app = 'issues' WHERE app IS NULL;
```

Additive and backfilled — no row is removed and no existing reader is affected,
because nothing selects on a column that did not exist. See §4b for why it is
needed: after the split, `error_events.workspace_id` is ambiguous without it.
The shared `apiHandler` starts setting it in the same phase. `SET NOT NULL`
waits until Phase 5, once both apps have been writing it for a while.

**Code:** schema + migration only. No route changes.

**Verification:** `verify.sh` green; `npm run build`; both apps deploy and behave
identically to before.

**Revert:** drop the new tables. Nothing referenced them.

---

### Phase 2 — Sales bootstraps itself

**Goal:** a person can sign up for sales, get a workspace, invite people, and
work — without issues existing.

**Code — `apps/sales`:**

- `lib/auth.ts` — on first sign-in, create `sales.workspaces` + membership in one
  transaction. This reverses the D-3 decision, which was correct only while sales
  had no workspace of its own.
- `app/api/auth/register/route.ts` — self-signup, copied from issues' and pointed
  at sales' tables. Sales has no register route at all today. **It inherits the
  whitelist gate** (`SUPER_ADMINS` + `platform.email_whitelist`) — decision 1.
  Copy that check with the route; a register route without it is an open door on
  the whole platform, since the account it creates is the shared one.
- `app/api/workspaces/**` — stop mounting the platform factories; serve sales'
  own workspaces/members/invitations.
- `app/dashboard/settings/members/page.tsx` — **the members page, visible by
  default.** This is the screen the whole refactor is for.
- Remove the "No access to b/sales" gate and the `PLATFORM_ENFORCE_APP_ACCESS`
  check. A member of a sales workspace is a sales user, full stop.

**ADDED 2026-08-10, and this plan missed it entirely: TWELVE of sales' tables
have a foreign key on `platform.workspaces`** — prospects, contacts,
stage_entries, meetings, communications and seven more. Once sales' workspaces
live in `sales.workspaces`, every one of them points at the wrong table. A
prospect that references an issues workspace is precisely the coupling this
refactor removes, so this is not deferrable to Phase 3.

Do it by MIRRORING, not wiping: copy the `platform.workspaces` rows sales
actually uses into `sales.workspaces` **preserving the id**, copy the matching
memberships, advance the sequence, then swap each constraint. Preserving ids
makes the swap a constraint change with no data movement — **so Phase 2 still
deletes nothing, and Phase 3 remains the only phase that does.** That property
is what makes "where did the row go?" answerable.

The two workspace tables then drift apart, which is correct: after this, a
person's issues workspace and their sales workspace are different things that
happen to share an id today.

`sales.prospect_labels → platform.labels` is a thirteenth FK and belongs to
Phase 3, with the rest of labels.

**There is also a design decision this plan never named**, left to agent 3:
sales' routes use the SHARED `resolveWorkspace`, which reads `platform.*`.
Either `AppContext` gains a workspace resolver so each app supplies its own
source, or sales writes its own resolver. The first keeps the split honest —
plumbing shared, data not — but touches a file both apps depend on.

**Still hidden:** no switcher, no create-workspace flow, no workspace settings.
One workspace per user, invisible.

**Verification — the phase is the test:**

1. A brand-new email signs up at `sales.blackcode.ch`, lands in the app, and is
   never told to go anywhere else
2. That person invites a second brand-new email; they sign in and see the same
   data
3. **Neither account exists in issues, and issues is unaffected** — check
   `platform.workspaces` count is unchanged

**Revert:** re-point the routes at the platform factories. No data moved.

---

> ### DEPLOY NOTE, decided 2026-08-10 after agent 3
>
> **Phases 2 and 3 ship in ONE deploy.** Phase 2 is complete, safe and loses
> nothing, but between it and Phase 3 a brand-new sales workspace cannot create
> a prospect: sales still writes `platform.{events,entities,labels,uploads}`,
> whose `workspace_id` has a foreign key on `platform.workspaces` — and after
> Phase 2 that id is a *sales* workspace id.
>
> Agent 3 measured both outcomes rather than reasoning about them. If the id
> also exists in `platform.workspaces`, **the row lands silently against another
> tenant's workspace**; if it does not, the FK rejects it loudly. Because
> mirroring makes the two id spaces start out overlapping, **the silent outcome
> was also the likely one.** Migration 0004 advances sales' sequence by +1000 so
> every mis-scoped write is a loud failure instead.
>
> The phase boundary survives in git — separate commits, reviewable and
> attributable — which is where it was ever load-bearing.
>
> ### DO NOT "FIX" A FOREIGN-KEY VIOLATION BY DROPPING THE FOREIGN KEY
>
> It is the obvious cheap fix in Phase 3 and it is the expensive one. Verified
> against production: **every FK on `platform.workspaces` is `ON DELETE
> CASCADE`** — twelve of them — and `apps/issues`' `deleteWorkspace` is a bare
> `db.delete(workspaces)` whose own header says *"cascades (FKs handle it)"*.
> Dropping them removes the only mechanism that cleans up an issues workspace's
> labels, events, comments and inbox when it is deleted.
>
> **And `verify.sh` cannot see it**: it fails on decreases, not on absences. A
> workspace deletion that orphans 400 rows shows up as counts that did *not* go
> down. A real limitation of the instrument, found by reasoning about a proposal
> rather than by running one.

### Phase 3 — Sales moves its data off the shared tables

**Goal:** sales stops reading and writing `platform.*` for anything but identity.

**Order matters — one table at a time, deploy between each.** Sales has no users,
so a broken intermediate state costs nothing, but doing them together makes a
failure hard to attribute.

For each of labels → uploads → events:

1. Point sales' query layer at `sales.<table>`
2. Delete sales' rows from the shared table
3. Run `verify.sh` — **issues' counts must be unchanged**

*(comments and trash are not in this list — see §4b. Sales never used either.)*

### The exact counts to expect, measured in production 2026-08-10

SAFETY.md says "if that count is not what the plan predicts, **stop**". So the
plan has to predict, or the ritual trains people to ignore it. **Most of these
are zero, and a zero here is correct — not a sign the query is wrong:**

| Delete target | Rows |
|---|---|
| `platform.comments WHERE parent_type LIKE 'sales:%'` | **0** — table never used |
| `platform.labels WHERE app='sales'` | **0** |
| `platform.uploads WHERE app='sales'` | **0** |
| `platform.events WHERE app='sales'` | **4** |
| `platform.entities WHERE app='sales'` | **2** |
| `platform.links` (any row naming a sales URN) | **1** |
| `platform.workspace_apps WHERE app='sales'` | **1** — Phase 5 |
| `platform.app_access WHERE app='sales'` | **1** — Phase 5 |

Seven rows in total. Nearly all of them are residue from the 2026-08-10
deploy-verification run, not from use.

**Re-measure before deleting** — these are from 2026-08-10 and sales is
deployed. A number that has GROWN means somebody started using sales, and that
retires decision 2 (*"sales data does not matter"*) on the spot. That is the
condition worth stopping for; a zero is not.

**Then remove the cross-app machinery from sales:**

- Delete the entity projection — sales rows stop appearing in
  `platform.entities`, and `apps/sales/lib/db/queries/entities.ts` goes
- Delete sales' link routes and its `bk sales`-side link handling
- `DELETE FROM platform.entities WHERE app = 'sales'` and
  `DELETE FROM platform.links WHERE ...` any row naming a sales URN
- Retire `bk super-admin entity-drift` for sales

**Verification:** `verify.sh` green after every single step. Sales' own features
(comments on a prospect, labels, uploads, trash, activity) all work against
sales' tables. Issues untouched throughout.

**Revert:** per table, re-point the query layer. The deletes are the only
one-way step — which is why `SAFETY.md` requires a fresh Neon branch immediately
before each delete.

---

### Phase 4 — The CLI stops pretending the apps share a database

**Goal:** the CLI's verb tiers match the new reality.

The three-tier model (neutral / cross-app / app-owned) was built for shared data.
With identity as the only shared thing, the tiers collapse:

| Verb | Was | Becomes |
|---|---|---|
| `login`, `token`, `profile`, `meta`, `app` | neutral | **unchanged** — genuinely identity |
| `workspace`, `member`, `invite` | neutral | **app-owned** — `bk sales member`, `bk issues member` |
| `search`, `activity` | cross-app | **app-owned**, with Phase 6 offering a fan-out |
| `link` | cross-app | **removed** |
| `storage`, `trash`, `label`, `upload` | mixed | **app-owned**, all of them |
| `inbox` | neutral | **issues-owned** — sales never used it (decision 3) |

**Work:**

- Move commands from `cli/internal/commands/platform/` into the app packages
- `cli/internal/commands/deprecations.go` — a row per moved spelling, **in the
  same commit**. This is what lets a running agent recover from `bk workspace
  list` disappearing.
- Guide topics rewritten: `topics/platform/` shrinks to identity, each app's
  topics grow
- `cli/routes.json` regenerated (`make routes`)
- A CLI release, and **a web deploy per app, twice** — see `docs/devops.md`

**Verification:** `cli-parity.test.ts` per app, `platform-route-coverage.test.ts`,
`routes_test.go`, `guide_test.go`, `groups_test.go` all green — and each one
watched to fail first by breaking what it guards.

**Revert:** deprecation rows keep old spellings working; a CLI point release
restores them.

---

### Phase 5 — Retire the gates and decide the blob question

**Goal:** delete the concepts that no longer mean anything.

**Backup first — this phase drops tables.**

- Drop `platform.workspace_apps` and `platform.app_access`
- Drop `platform.transaction_log` — dead since before the monorepo, no writer,
  and `/api/undo` is a 410. **Confirm `count(*) = 0` first; if it is not, stop**
- `ALTER TABLE platform.error_events ALTER COLUMN app SET NOT NULL` — only after
  confirming no row has a NULL `app`, i.e. both apps have been writing it
- Remove `PLATFORM_ENFORCE_APP_ACCESS` from both Vercel projects and from
  `packages/platform-api/src/require-app-access.ts`
- Remove the Apps panel from issues' workspace settings page
- `platform.apps` **stays** — it is the CLI's address book (`base_url`) and the
  blob-reference registry

**The blob question — decide it here, do not drift into it:**

`platform.blob_references` exists so no app deletes a file another app still
uses. With separate uploads ledgers, the two options are:

- **(a) Keep it.** One store, one index, deletion still asks every app. Safest,
  and the machinery already works.
- **(b) Split it.** Each app owns its files under its own prefix and answers only
  for itself. Simpler, and removes the highest-risk coupling in the repo — at the
  cost of a migration touching production upload rows.

**Recommendation: (a).** It is the one piece of cross-app machinery that earns
its keep, it is already built and tested, and (b) means touching production data
for tidiness. Revisit only if it gets in the way.

---

### Phase 6 — DEFERRED 2026-08-10, not cancelled

**Agent 6 declined it, and the reason is the schedule, not the design.**

The design is settled and better than this plan's: **`--all-apps` searches each
app's own active workspace.** Well defined, it is "search my stuff", and agent
5's per-app `ActiveWorkspaces` map is exactly the input. The incoherent phrasing
was "search THIS workspace across apps", which nobody needs.

It cannot ship yet because **`bk search` was removed as a bare verb in Phase 4,
one day earlier, with a deprecation row telling every agent there is no
cross-app index any more.** A fan-out spans apps so it must be a bare verb —
reintroducing it inside the deprecation window makes that hint false while it is
still being read, by exactly the agents most likely to be reading it.

> **A deprecation hint is a promise with a duration.** `deprecations.go` keeps
> entries for two minor releases. Do not contradict one inside its own window.

Buildable after the window closes, to the spec above. If it is never built, the
loss stays deliberate and documented in §3.

### Phase 6 — the original brief, kept for the spec (optional)

**Goal:** restore the convenience without the coupling.

`bk search "acme" --all-apps` asks **every app's server** using the same token
and merges the results client-side, tagging each row with its app. Same for
`bk activity --all-apps`.

This is the refactor's thesis made literal: **the CLI is the connector.** No
shared index, no projection, no drift, and it keeps working when app #3 arrives
because the address book already lists it.

Optional because nothing depends on it. Do it if you miss the feature.

---

### Phase 7 — The scaffold and the docs

**Goal:** app #3 is born correct.

- `apps/_scaffold` gains its own workspaces/members/invitations/comments/labels,
  self-signup, and the members page — so the default for a new app is
  independence
- `docs/adding-an-app.md` rewritten around the new contract; open item 7
  (`platform-email`) still stands
- `docs/platform-architecture.md` — the shared/not-shared table replaces the
  three-tier CLI section
- `docs/platform-db.md` — why `platform.*` still holds issues' data, and why we
  did not rename it
- `docs/sales-app-plan.md` — D-11, D-28, D-36 are superseded by this document.
  **Do not delete that file**: ~50 source files cite it by path
- `CLAUDE.md`, `AGENTS.md` — the contract in the overview
- `docs/changelog/platform.md` + `sales.md` — dated entries; the CLI verb moves
  are user-facing and breaking for anyone scripting them

---

## 6. Decisions — settled 2026-08-10

1. **Sales self-signup inherits the whitelist.** `SUPER_ADMINS` +
   `platform.email_whitelist`, the same gate issues uses. One shared identity
   means an open door on sales is an open door on the platform.
2. **Sales data does not matter.** Nobody has used it. Phase 3's deletes need no
   preservation step, and sales' tables may be dropped and rebuilt freely.
   *(This licence applies to `sales.*` and to sales' rows in shared tables. It
   never applies to `issues.*` or `platform.*` rows belonging to issues.)*
3. **`bk inbox` becomes issues-owned.** Sales touches `inbox_messages` in zero
   files; there is nothing to move and nothing to build.

---

## 6b. How the CLI tells the apps apart — now, and after

**Today there are two mechanisms.**

**App-named groups** — the app is in the command path, which is what makes a
command legible to the agent that wrote it:

```
bk sales prospect list
bk issues issue create
```

**Bare verbs** — no app in the command, so they go to whichever app the user is
"homed" on (the `*` in `bk app list`), set by `bk login --server` or
`bk app use`, overridable for one invocation with `--app-server <slug>`:

```
bk workspace list   bk search   bk member list   bk inbox   bk storage
```

**The second mechanism exists only because the apps share data.** `bk search` is
documented as *"search every app's entities in the active workspace"* — a
sentence that needs a shared index to mean anything. Once the apps are separate,
a bare `bk search` has no defensible answer to "search where?".

### After Phase 4

Bare stays only for what is genuinely one thing everywhere — identity and the
binary itself:

```
login · logout · whoami · token · profile · app · meta · guide · changelog · skill · version
```

Everything else gains its app:

```
bk sales member list      bk issues member list
bk sales trash list       bk issues inbox
bk sales search "acme"    bk issues search "acme"
```

**So `--app-server` and the "home app" concept nearly disappear.** They exist to
disambiguate bare verbs; with bare verbs reduced to identity there is nothing
left to disambiguate. That is the real prize for an agent: **no hidden state
decides where a command lands.** Today `bk trash purge` destroys things in
whichever app you were last homed on, and nothing in the command says which.

Keep `--app-server` as a flag anyway — `bk app list --app-server issues` is
still a reasonable thing to want, and removing a flag agents may have learned is
a deprecation for no gain.

`bk app` itself narrows: it stops being *"apps enabled for a workspace, and who
may use them"* (that is `workspace_apps`, dropped in Phase 5) and becomes purely
the address book — which app exists, where it lives, is it reachable.

---

## 7. Sequencing and effort

| Phase | Risk to production | Rough size |
|---|---|---|
| 0 Backup + baseline | none | half a day |
| 1 Sales foundations | none — additive, incl. one expand-only column on `error_events` | half a day |
| 2 Sales bootstraps | none — sales only | 1 day |
| 3 Sales moves off shared tables | **low, and the only phase that deletes** | 1–2 days |
| 4 CLI re-tiering | none to data; a real change for users | 1 day |
| 5 Retire gates | low — drops two config tables | half a day |
| 6 Fan-out search | none | half a day, optional |
| 7 Scaffold + docs | none | 1 day |

**Most of this is deletion.** The design is settled; what remains is a list.

---

## 8. The standing rule still applies

Every guard, test, backup check and migration in this refactor must be **watched
failing before it is trusted** — break the thing it protects, see it go red,
restore. This repo has nineteen written-up cases of a check that was green and
inert, several of them written by the same session that wrote the rule.

`verify.sh` is the one that matters most here. It is the only thing standing
between this refactor and losing somebody's comments.

---

## 9. The open ledger — what this refactor did NOT close

Written 2026-08-11 by agent 7, the last agent, and accepted. Each is a decision
somebody has to make, not a bug somebody forgot.

> **STATUS 2026-08-11, after Phase 8 (agent 8).** Items **2, 3 and 4 are
> CLOSED** — annotated in place below rather than deleted, because the ledger is
> a dated record of what was owed. **6 stays open and its precondition is still
> unmet.** 1, 5 and 7 are untouched. Item 8 is NEW: Phase 8 found that
> `deleteAccountReport` has been enumerating only `platform.workspaces` since
> Phase 2 and therefore cannot see any app but issues.

1. **Arriving on another app's cookie gets you a session and no workspace.**
   Production behaviour today. The session is shared across `*.blackcode.ch`
   (D-16), but membership is per app and `ensureWorkspaceForUser` has exactly two
   call sites — the **sign-in callback** and **`POST /api/auth/register`**.
   Somebody arriving on an existing cookie from another app takes neither path:
   they did not register here, and they did not sign in here. They land on "no workspace yet" and the only way out is to sign out
   and back in. **It also makes `adding-an-app.md`'s signed proof 9 read
   stronger than it is**: "already signed in" proves the cookie is shared, not
   that the person can use the app. Three candidate answers, none taken —
   bootstrap on first authenticated request (cheap, but any app then silently
   mints tenancy for anyone with an account); an explicit "get started" button;
   or decide a new app is invite-only and the empty state is correct.
2. ~~**`workspace_invitations.app` has no reader.**~~ **CLOSED 2026-08-11** —
   dropped by migration `0046`. New rows were NULL, historical rows kept; it was
   `transaction_log`'s exact shape. The gate could not be "is it all NULL?",
   because the historical rows legitimately carry values — it is "has anything
   written one SINCE Phase 5 changed the writer", and that distinction was
   watched to hold in both directions.
3. ~~**`error_events.workspace_id` has no writer**~~ **CLOSED 2026-08-11** —
   dropped by migration `0046`. `app` stays: it has a real reader (the
   super-admin Errors tab, and the index built for it). Note for the record that
   `tsc`, not grep, found the third caller passing this column — an app-local
   email module nobody had thought to look in.
4. ~~**`WorkspaceSource.getById` has no caller.**~~ **CLOSED 2026-08-11** —
   deleted from the interface, three implementations and two fakes. Its
   justification was written into the interface header ("upload attribution
   reads one by id") and Phase 3 moved upload attribution to `UploadLedger`
   without noticing the sentence had outlived the caller.
5. **Retired capabilities in prose are unguarded.** The landing page sold
   `bk undo` for months over a journal that never had a writer, and three server
   `suggestion` strings named removed commands — the strings an agent ACTS on.
   The new guard catches a page naming a retired COMMAND; it cannot catch a page
   describing a retired CAPABILITY.
6. **`SET NOT NULL` on `error_events.app`** — deferred. Production has 0 rows
   saying `sales` because sales has not errored since the column existed. The
   precondition is working, not failing.

   **STILL OPEN after Phase 8, and agent 8 could not check it.** The condition is
   a fact about PRODUCTION, and README rule 2 forbids an agent reaching it. Local
   dev cannot stand in: it has never run sales against this column either, so a
   local "0 sales rows" measures the local database, not the precondition. **This
   item needs the human, not the next agent** — one query, run once both apps
   have errored:
   `SELECT app, count(*) FROM platform.error_events GROUP BY app;`
7. **Phase 6 (cross-app fan-out)** — deferred, spec above, blocked only by
   `bk search`'s deprecation window.

8. **`deleteAccountReport` enumerates `platform.workspaces` only** — so
   "what would closing my account do?" answers for `apps/issues` and is silent
   about every other app. Found and OBSERVED in Phase 8, not yet fixed: a person
   owning one issues workspace and one sales workspace gets a report naming the
   issues one alone. Closing the account then soft-deletes the user
   (`deleted_at`, `password_hash = NULL`) — an UPDATE, so
   `sales.workspaces.owner_id`'s `ON DELETE RESTRICT` never fires — and the sales
   workspace survives, owned by an account that can no longer authenticate,
   unmentioned. **This is the whole subject of the next phase**; see agent 8's
   reply for the mechanism and why the alternatives lose.

8. **Closing an account STRANDS another app's data — live today.** Measured by
   agent 8 on 2026-08-11, and it is not the reporting bug it first looked like.
   `deleteAccountReport` reads `platform.workspaces`, which is issues-only since
   Phase 2, so the dry-run names one workspace and never mentions the person's
   sales workspace. **The report is not empty — it is confidently incomplete,
   which is worse: an empty report invites suspicion and a partial one reads as
   authoritative.**

   Then the delete does not delete it. `sales.workspaces.owner_id` is
   `ON DELETE RESTRICT`, but `softDeleteUser` **UPDATEs** the user row rather
   than deleting it — so the rule never fires, nothing refuses, and the sales
   workspace survives owned by an account that can no longer authenticate. Not
   data lost: data **stranded**, and unrecoverable by the person, because there
   is no sign-in left to recover with.

   > ~~**Until this is fixed, do not close an account that has data in more than
   > one app.**~~ **CLOSED 2026-08-11 by Phase 9 (agent 9).**

   **Phase 9 opened with the honesty fix** — `DeleteAccountReport` carries the
   app it covers, as a required field, and the screen renders it — and then
   built the mechanism: `GET/DELETE /api/me/footprint` on every app,
   `AppContext.footprint` required, and a server-side census fanned out over
   `platform.apps.base_url` with the caller's session cookie. `?scope=all_apps`
   purges every other app first and closes the account LAST, so a partial
   failure leaves a working account rather than stranded data, and it is refused
   outright (409) while any app is unreachable.

   **`ON DELETE RESTRICT` STAYS AND IS STILL INERT** — deliberately, with the
   reasoning now written on the column (`apps/sales/lib/db/schema.ts`). It
   cannot fire against an UPDATE, dropping it would swap an inert guard for no
   guard, and making the delete hard so it CAN fire would make it refuse the
   closure outright while the twelve cascades on `platform.workspaces` took
   issues' content with them. What protects the data is the application layer.

   **AND ONE THING AGENT 8 GOT WRONG, found by measuring rather than reasoning.**
   §2.4 said a wrong or stale `base_url` "would make an app look unreachable,
   which now BLOCKS deletion — a safe direction". It does not. An address
   pointing at ANOTHER APP IN THE SUITE answers confidently, as that app: with
   `sales.base_url` set to the issues deployment, the census reported ISSUES'
   workspaces under the name "Sales", `reachable: true`, and the close would have
   purged one origin twice and stranded the real sales data. Every app now names
   itself in its reply and both the census and the purge reject an answer from an
   app they did not address.

9. **A config error can make one app answer AS another, and every guard stays
   green.** Found in Phase 9 by asking *what would this still pass on?* — not by
   review, not by any test. Point one app's `base_url` at another app in the
   suite and the census reports BOTH as `reachable: true`, with the same data,
   under two names. `all_apps` then purges one origin twice, reads its "I am
   empty" as the other app's answer, asserts the census satisfied, and closes
   the account over untouched data.

   **The reachable/unreachable TYPE could not catch it** — the safety property
   the whole design rested on. It distinguishes "no answer" from "no data"; it
   cannot distinguish "the wrong app's answer" from "this app's answer", because
   both are answers.

   Fixed by rejecting a reply whose `app` is not the app addressed, on the
   census AND the purge — the purge matters more, because by the time it answers
   it has already deleted something. **The information needed was already on the
   wire and nobody had read it**, which is `error_events.workspace_id`'s shape:
   a value present, carried, and unexamined.

### And one rule this project produced, which belongs everywhere

> **An absence is only evidence if you know your instrument could have seen the
> presence.**

Agent 7 wrote "silent no-op" four times before realising its instrument could
not see a 4-second toast. Same sentence as *"a check you have not watched fail
is not a check"*, pointed at observation instead of at tests.
