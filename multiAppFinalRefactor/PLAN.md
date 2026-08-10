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
| `comments` | **issues keeps it; sales gets `sales.comments`** | |
| `labels` | **issues keeps it; sales gets `sales.labels`** | |
| `events` | **issues keeps it; sales gets `sales.events`** | |
| `deletion_batches` | **issues keeps it; sales gets `sales.deletion_batches`** | sales touches it in 0 files today |
| `workspaces` | **issues keeps it; sales gets `sales.workspaces`** | |
| `workspace_members` | **issues keeps it; sales gets `sales.workspace_members`** | |
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

**Phase 5, after backup, and only after confirming it is empty:**

```sql
SELECT count(*) FROM platform.transaction_log;   -- expect 0
DROP TABLE platform.transaction_log;
```

If that count is **not** 0, stop and tell someone — it would mean something
writes it that this audit did not find, and that is more interesting than the
table.

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

### Phase 3 — Sales moves its data off the shared tables

**Goal:** sales stops reading and writing `platform.*` for anything but identity.

**Order matters — one table at a time, deploy between each.** Sales has no users,
so a broken intermediate state costs nothing, but doing them together makes a
failure hard to attribute.

For each of comments → labels → uploads → events → trash:

1. Point sales' query layer at `sales.<table>`
2. Delete sales' rows from the shared table
   (`DELETE FROM platform.comments WHERE parent_type LIKE 'sales:%'`)
3. Run `verify.sh` — **issues' counts must be unchanged**

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

### Phase 6 — Give cross-app search back, properly (optional)

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
