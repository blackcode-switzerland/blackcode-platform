# The platform database

One Postgres database, one Neon project, one schema per app plus `platform`.
This file is about the **boundary** — who may read what, and the SQL that
establishes it. For what the tables mean, see [`backend.md`](backend.md); for one
app's own tables, see that app's `docs/backend.md`.

> Promised by Phase 3 step 7 and written in Phase 8. Until then the role SQL
> lived in `docs/sql/app-role.sql` with nothing pointing at it, and
> `docs/adding-an-app.md` referenced a file that did not exist.

## The shape

```
neondb
├── platform.*     what every app shares — identity, workspaces, membership,
│                  per-app access, comments, labels, uploads, events, entities,
│                  links, blob_references
├── issues.*       the issue tracker's own tables
├── sales.*        the sales app's own tables
└── scaffold.*     the scaffold's (apps/_scaffold — never deployed)
```

**The rule, in one line:** an app may read and write `platform.*` and its own
schema. Nothing else. It is enforced by **grants**, not by review — `issues_app`
simply has no `SELECT` on `scaffold.*`.

An app may FK into `platform.*` freely. **`platform` may never FK into an app**:
that direction would make `pg_dump --schema=issues` produce something that
cannot be restored, which is the extraction path §11 of
platform-architecture.md is built on. Migration 0032 dropped the last one.

## Two credentials, and why

| Var | Role | Used by | Rights |
|---|---|---|---|
| `DATABASE_URL` | `<app>_app` | the app at runtime | DML only. Owns nothing |
| `MIGRATE_DATABASE_URL` | `neondb_owner` | `drizzle-kit migrate`, `postbuild` | owns both schemas |

**The app role must not own the tables.** Ownership is what confers DDL: an owner
can `ALTER` or `DROP`, including tables in `platform` that every other app
depends on. Splitting "the role that migrates" from "the role the app runs as"
is what stops one app silently reshaping shared schema.

Neon's built-in `neondb_owner` is the migrator rather than a third minted role —
it already owns everything, and a separate owner would be another credential to
rotate for no additional guarantee. What the rule actually requires is that the
APP role owns nothing, and `docs/sql/app-role.sql` asserts exactly that.

Keep the fallback to `DATABASE_URL` when `MIGRATE_DATABASE_URL` is unset, so
local dev needs one variable. Every future app repeats this pair.

## Creating an app's role

`docs/sql/app-role.sql` is the script. Run it as `neondb_owner`, substituting the
app slug and a generated password. It does seven things, and step 5b is the one
that is easy to skip:

1. `CREATE ROLE <app>_app LOGIN`
2. `GRANT USAGE` on `platform` and `<app>` — reaching the schemas grants nothing
   inside them
3. `GRANT SELECT, INSERT, UPDATE, DELETE` on all tables. **No `TRUNCATE`, no
   `REFERENCES`, no `TRIGGER`**
4. `GRANT USAGE, SELECT` on all sequences — easy to forget, and the failure is
   confusing: every insert into a `serial` table fails with "permission denied
   for sequence" despite the `INSERT` grant
5. `ALTER DEFAULT PRIVILEGES` so the next migration's tables are readable
6. **5b. Revoke write on `platform.blob_references`, leaving `SELECT`.** Step 5
   hands every future platform table full DML; that is wrong for exactly one
   table. A role with `DELETE` on the blob index could erase another app's
   references, after which a delete that should have been refused proceeds and
   the bytes are gone
7. `ALTER ROLE … SET search_path`, and `REVOKE ALL ON SCHEMA drizzle` so a stray
   `drizzle-kit migrate` with app credentials fails loudly instead of
   half-applying

## Then prove it

```bash
psql "postgres://<app>_app:<pw>@<host>/<db>" -f docs/sql/app-boundary-probe.sql
```

**Run it as the app role. `SET ROLE` from the owner is not a substitute** and
gives the wrong answer: `session_user` ignores `SET ROLE`, and inside a
`SECURITY DEFINER` function `current_user` is the function's owner rather than
the caller.

That is not a hypothetical. `platform.blob_refs_purge` shipped in 0037 guarding
on `current_user`, which made the guard true for everybody — any app could purge
any other app's blob references. It was found by running the probe as the real
role and fixed in 0038. Every deny in the probe must be `42501`.

## Triggers: the one thing an app must install

`platform.blob_references` is maintained by **Postgres triggers on each app's
content tables**, not by application code, so that no write path can forget it.
See `packages/platform-db/src/schema.ts` at `blobReferences` for why, and
migration `0037` for the shape.

If your app's content can hold an uploaded file URL — a description, a body, a
comment, an attachment row — it needs a trigger per content column, and it must
set `platform.apps.maintains_blob_index = true` **in the same migration, after
the backfill**. Setting the flag before the index is built advertises an empty
index as authoritative, which is how a file still in use gets deleted.

Until it does, blob deletion in **every** deployment refuses — correctly, because
nobody can prove the file is unused. That is not a bug to work around.

## The app dimension on shared tables

These `platform.*` columns exist so more than one app can write these tables
without colliding. The first three landed 2026-08-06 (migrations `0041`–`0043`,
D-14); `error_events.app` landed 2026-08-10 (`0044`). All are the **expand**
half of expand → migrate → contract.

| Column | Form | Rule |
|---|---|---|
| `comments.parent_type` | `<app>:<noun>` | `issues:issue`, `sales:prospect` |
| `deletion_batches.root_type` | `<app>:<noun>` | same |
| `labels.app` | slug, or NULL | NULL = shared. **Historical since 2026-08-10**: `apps/sales` moved to `sales.labels`, so every row is `issues` and nothing else can write one. Kept rather than dropped for the reason `platform.*` was not renamed — moving production data for a cosmetic gain |
| `error_events.app` | slug, nullable | Which deployment threw. `0044` backfilled every existing row to `issues`. Nullable only until both apps have deployed writing it |

> **`error_events.app` is not optional information, and it is the one column
> here that is not about collision.** `error_events.workspace_id` has never had
> a foreign key. That was harmless while there was one set of workspaces; the
> multi-app refactor gives each app its own, and from that point `workspace_id
> = 1` names a different row depending on who wrote it. Reading the workspace
> without the app is then a confidently wrong answer rather than a missing one.
> The two columns have to be read together.
>
> It also has **no FK to `apps.slug`**, unlike `labels.app` and `uploads.app`.
> Those tables hold an app's data, so `ON DELETE set null` is a survivable loss;
> this one holds the record of an app FAILING, and deregistering an app must not
> erase the attribution of exactly the rows somebody is reading to find out what
> went wrong.
>
> All three writers stamp it from the serving deployment, never from a call
> site: `apiHandler`'s `safeLog` and `clientErrorsRoute` take it from
> `AppContext.appSlug`, and `insertErrorEvent` **requires** it in its parameter
> type so an app-level caller cannot omit it. That is what will make the Phase 5
> `SET NOT NULL` a check rather than a hope. `safeLog` is the writer with no
> compile-time guard — it builds a hand-written column list in interpolated SQL
> and swallows its own failures — so it is covered at runtime instead, by
> `apps/issues/lib/api/error-events-app.test.ts`.

Three things about the `<app>:<noun>` columns are easy to get wrong:

**The CHECK validates the shape, not the vocabulary.** `<app>` and `<noun>` are
each `[a-z][a-z0-9_-]{0,39}`, and that is all. Platform does not enumerate an
app's nouns here for the same reason it does not in `entities.entity_type` — an
enumeration means a shared-table migration every time any app invents a noun, and
a hand-maintained list of other people's words is this repo's recurring drift
bug. **`'nonsense:thing'` is therefore accepted.** What is refused is a new BARE
noun (`'prospect'`), which is the collision the qualification exists to prevent.
Validating `<app>` against `platform.apps` would need a generated column plus an
FK; `blob_references` records why that direction is refused, and it would make a
new app's writes illegal until its registration migration ran.

**The wire format stays bare.** Routes return `parent_type: "issue"`, not
`"issues:issue"` — the path already names the app, and `batch_root_type` is
compared client-side against a bare `type`. The qualification is a storage
concern; `packages/platform-db/src/qualified-type.ts` is the only place that
converts, and every read matches the qualified AND the legacy bare form until the
contract step.

**A scope column nobody reads is worse than no column.** `labels.app` was only
worth having because every label read was filtered to
`app IS NULL OR app = <serving app>` — and "read" meant the resolve-by-name
behind label creation, the attach, the rename and the delete, not only the list
route. Before the filter, `bk issues label list` promised a scoping the data did
not do; a column without it makes the promise louder and no truer.

> **And the converse, found on 2026-08-10 (Phase 3): once the table holds one
> app's rows only, the filter becomes the thing it was written to prevent.**
> `apps/sales` moved to `sales.labels`, whose foreign keys cannot reach another
> app's row, and its `visibleToThisApp()` helper was DELETED rather than ported.
> Over a table that cannot hold a foreign row it is a no-op that reads as
> protection — CLAUDE.md's whole subject. The scope is the schema now, and
> `sales.prospect_labels.label_id` references `sales.labels` (migration `0005`,
> the thirteenth foreign key) so an attachment cannot name a foreign label
> either. Enforced by Postgres rather than by a WHERE clause somebody has to
> remember.

**The backfill in `0041`/`0042` is deploy-order-sensitive.** It is invisible to
the build that ships with it (which matches both forms) and to every other app,
but a build from *before* it still looks for the bare noun and renders empty
comment threads. Chain the migration and the promote — the same remedy as a
migrate-first cutover below — rather than applying it by hand ahead of time.

Rollbacks: `docs/sql/phase1e-*.sql`, one per migration, each stating what
promoting the previous build already achieves without them.
`0044`'s is `docs/sql/0044-error-events-app-rollback.sql`, and its two steps are
deliberately unequal: dropping the index is free, dropping the column destroys
attribution that cannot be recomputed — `workspace_id` is precisely the value
that stopped being self-describing — so step 2 ships commented out.

## An app with its own workspaces (the multi-app refactor)

`sales.*` gained `workspaces`, `workspace_members`, `invitations`, `labels`,
`uploads` and `events` on 2026-08-10 (migration `0003`), and two migrations the
same day put them to work: **`0004`** moved twelve foreign keys onto
`sales.workspaces` (sign-up, the bootstrap, members, invitations), and **`0005`**
moved the thirteenth, `sales.prospect_labels.label_id`, onto `sales.labels`.

**Phase 3 is done: `apps/sales` reads and writes no `platform.*` table except
identity.** Its labels, its upload ledger and its event spine are its own, its
rows were deleted from `platform.{labels,uploads,events,entities,links}`, and it
no longer projects into the cross-app index at all.

What that leaves, and it is worth being precise because the table names have not
changed: **`platform.{comments,labels,uploads,events,entities,links,workspaces,
workspace_members,workspace_invitations,inbox_messages}` are `apps/issues`' data
under a shared name.** They were not renamed to `issues.*` — that would mean
moving production data for a cosmetic gain (PLAN.md §2). Genuinely shared, and
written by every app: `users`, `api_tokens`, `password_reset_otps`,
`email_whitelist`, `apps`, `error_events`, and **`blob_references`**, which is
the one piece of cross-app machinery the refactor keeps.

**The Blob store did not split.** One store, one bill, one quota, one delete
gate. What split is the LEDGER — which of an app's files exist —
`packages/platform-api/src/upload-ledger.ts`, and `platform.blob_references` was
deliberately not touched.

See `multiAppFinalRefactor/PLAN.md`.

### `0004` mirrored ids rather than remapping them, and that has two consequences

Twelve of this app's tables had a foreign key on `platform.workspaces`. The
migration copied the `platform.workspaces` rows the app actually uses into
`sales.workspaces` **preserving the id**, then swapped each constraint — so it is
a catalog change with no data movement and it deletes nothing.

**1. The two tables drift from here, and that is correct.** After this, a
person's issues workspace and their sales workspace are different things that
happened to share a number on one day.

**2. The id spaces must not overlap, and the sequence is what enforces it.**
Between Phase 2 and Phase 3, this app still writes four PLATFORM tables that
carry a `workspace_id` with an FK on `platform.workspaces`: `events`, `entities`,
`labels`, `uploads`. Those writes now carry a SALES workspace id, and there are
exactly two outcomes:

- the id also exists in `platform.workspaces` → **the FK is satisfied and the row
  lands against somebody else's workspace.** Silent. Measured: a sales workspace
  minted at id 2 wrote a `platform.events` row attributed to platform workspace
  2, which belongs to another user.
- it does not → `violates foreign key constraint
  events_workspace_id_workspaces_id_fk`. Loud and attributable.

Mirroring ids makes the two spaces start out overlapping, so without an offset
the early sales workspaces land squarely in the silent case. `0004` therefore
advances `sales.workspaces_id_seq` a thousand past the `platform.workspaces`
high-water mark, converting the silent case into the loud one until Phase 3
points those four query layers at `sales.*`. **Do not "tidy" that offset away.**

### `platform.users.active_workspace_id` is one column and two questions

It is shared by every deployment, and after the split the same number means a
different team depending on who wrote it — `/api/meta`, the issues dashboard's
default-workspace picker and `platform-storage`'s upload attribution all read it.
So an app that owns its workspaces **must not write its ids into that column and
must not read its own default out of it**; it answers "which workspace by
default" from its own tenancy (`WorkspaceSource.getDefaultForUser`). This is
`error_events.workspace_id`'s ambiguity in the identity table, and the fix is the
same shape: keep the column, stop asking it a question it cannot answer.

Two things about that which generalise beyond this refactor:

**A per-app copy is not a copy.** Each of those tables drops the columns that
only existed because the platform table was shared — `app` everywhere, the
`app IS NULL OR app = <serving app>` scope on labels, `workspace_invitations.app`.
A scope helper left behind over a table that cannot hold a foreign row reads as
protection and is a no-op, which is what `CLAUDE.md`'s standing rule is about.
It also drops what has never had a writer (`workspaces.deleted_at`, still
unwritten in both apps) rather than carrying it forward to acquire two meanings.

**Cross-schema FKs into `platform.users` stay, and are the point.** Identity is
the shared thing. `sales.workspaces.owner_id → platform.users.id` is the
boundary being drawn, not a breach of it — the forbidden direction is still
`platform` → an app, for the `pg_dump` reason above.

**New tables need no re-grant, and that was verified rather than assumed.**
`docs/sql/<app>-app-role.sql` step 5 runs `ALTER DEFAULT PRIVILEGES … AS THE
MIGRATOR`, which covers tables created afterwards. A bounded probe role was
provisioned *before* these six tables existed, the migration was applied, and
the role's DML on all six plus their sequences was confirmed with no further
`GRANT` — while still being refused `issues.*` and refused DDL on its own
tables. `GRANT … ON ALL TABLES` alone would NOT have covered them; it means
"all tables that exist right now".

## Counters live in the app, not in platform

An app's `#number` sequence is app data. Keep the counter table in your own
schema; do not add a column to a shared one. `apps/_scaffold` does it in three
lines, and migration `0040` moved `workspace_counters` out of `platform` for
exactly this reason — see platform-architecture.md §4.6.

Allocate with `UPDATE … RETURNING` inside the same transaction as the row
insert, never read-then-write: two concurrent creates would otherwise read the
same value and collide.

## Migrations

Drizzle, in the app that owns the schema. `apps/issues/lib/db/migrations/` holds
the platform migrations too, because `issues` was the first app and the ledger
cannot be split retroactively — a second app's migrations go in its own
directory against its own schema.

> ### Every app needs its OWN ledger table, and the default is broken here (D-34)
>
> Drizzle's default ledger is `drizzle.__drizzle_migrations`, and its migrator
> takes **one high-water mark over the whole table**:
>
> ```
> select … from <ledger> order by created_at desc limit 1
> for (const m of migrations)
>   if (!last || Number(last.created_at) < m.folderMillis) apply(m)
> ```
>
> It has no notion of which app wrote a row. Two apps sharing it means whichever
> migrated last raises the mark for both, and the other app's next migration is
> **silently skipped** — no error, no row inserted, and the same comparison skips
> it again on every later run. The tables simply never appear, and the first
> symptom is a runtime error about a relation that does not exist.
>
> Sales hit this on its first migration: issues' `0043` is stamped later than
> anything a new app can generate. So each app sets its own:
>
> ```ts
> migrations: { table: '__drizzle_migrations_<slug>', schema: 'drizzle' }
> ```
>
> `packages/platform-testing`'s migration-ledger suite checks it across every
> app, so an app that omits the block or copies another app's table name fails
> there rather than in production. `apps/_scaffold/drizzle.config.ts` is the
> worked example.

- **Rehearse on a Neon branch first**, including the rollback. Every phase of
  this migration did, and it caught a real bug in three of them.
- **Expand → migrate → contract** for anything a running deployment reads. Add
  nullable, backfill, tighten in a later release once no deployed code can write
  the old shape — and verify that in the CODE, not just in the data.
- A migration that breaks running code (`SET SCHEMA`, a rename, a `NOT NULL` the
  current build violates) is **migrate-first**: chain the migration and the
  promote with `&&` so the promote fires the instant the migration succeeds and
  not at all if it fails.
- `RUN_MIGRATIONS=1` makes `postbuild` migrate during a production build. For a
  deploy-first ordering it **must be removed first**, or the build applies your
  migration before you have gated it.

## Assertions worth re-running

```sql
-- (a) The app role owns nothing.
SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
WHERE r.rolname = '<app>_app';

-- (b) It holds no DDL-implying privilege anywhere.
SELECT table_schema, table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = '<app>_app'
  AND privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE');

-- (c) It cannot write the blob index.
SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_schema='platform' AND table_name='blob_references';
```

Both (a) and (b) must return zero rows; (c) must show `SELECT` and nothing else
for every `*_app` role.
