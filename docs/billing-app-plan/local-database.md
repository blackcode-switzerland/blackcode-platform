# The local database, and how `billing` gets into it

**Read before phase 0.** Everything here was verified against the running
container on 2026-09-16.

- **The problem** — this repo develops against one dockerised Postgres that
  already holds two apps' schemas, and a new app has to be provisioned into it
  by hand: a schema, a role, a row in the app address book, and its own
  migration ledger. None of those steps fail loudly when done in the wrong
  order, and two of them report success having done nothing.
- **What this doc does** — states what is actually in the container today, gives
  the exact commands in the one order that works, and explains why the local
  setup cannot prove the thing it looks like it proves.
- **Expected result** — a `billing` schema and a real `billing_app` role in the
  local database, the boundary probe run **as that role** with its transcript
  recorded, and a developer who knows which local greens are meaningless.

## What is in the container

`docker-compose.yml` at the repo root, one service:

| | |
|---|---|
| Container | `blackcode-postgres`, image `postgres:16-alpine` |
| Port | **5434** on the host, 5432 inside |
| Database | `blackcode_issues` — named for the first app, shared by all of them |
| Superuser | `blackcode` / `blackcode_dev` |
| Volume | `pgdata`, so it survives a restart |
| Health | `pg_isready`, 5s interval — `docker ps` shows `(healthy)` |

Bring it up with `./devops/migrate-local.sh`, which starts it if needed, waits
for health, and then migrates. **Never start a second Postgres on 5434.**

### What it contained on 2026-09-16

Schemas: `platform`, `issues`, `books`, `drizzle`, `public`.

Roles that can log in: **`blackcode` only.**

`platform.apps`:

| slug | base_url | enabled | maintains_blob_index |
|---|---|---|---|
| `books` | `https://books.blackcode.ch` | t | t |
| `issues` | `https://issues.blackcode.ch` | t | t |

Migration ledgers in `drizzle`: `__drizzle_migrations` (issues, the
grandfathered default) and `__drizzle_migrations_books`.

**Three things to notice, because each one will mislead you.**

1. **`sales` is not here.** No `sales` schema, no row in `platform.apps`. The
   local database is issues plus books. So a local `bk` session cannot see sales,
   and an app-isolation failure involving `sales.*` will not reproduce locally.
2. **There is one role, and it is a superuser.** Every app connects locally as
   `blackcode`, which owns everything. So **the app boundary is not enforced
   locally and cannot be tested by using the app.** `apps/books/.env.local` says
   so in its own header. This is the single most important fact on this page.
3. **`public` exists and is empty.** Nothing may use it. The platform is
   `platform.*` plus one schema per app, never `public`.

## Provisioning `billing`, in the one order that works

Three documents in this repo currently disagree about this order.
`docs/adding-an-app.md:357` puts the role before the first deploy;
`docs/platform-db.md:241` says run it *after* the first migration;
`docs/sql/books-app-role.sql:23` says role → register part 1 → migrate →
register part 2. **Follow `books-app-role.sql`.** It is the only one written
after someone got it wrong, and phase 0 includes fixing the other two.

The reason the order is load-bearing is that two steps depend on something
existing and **neither fails loudly**:

- `0002`'s grant loop hands `EXECUTE` on `platform.blob_refs_purge` to every
  `<slug>_app` role **that exists at that moment**. A missing role is skipped
  silently, and re-running the migration will not fix it, because Drizzle has
  recorded it as applied.
- `0002`'s last statement sets `maintains_blob_index` **where the
  `platform.apps` row exists**. No row, no flag, same unrecoverable-by-rerun
  problem.

So:

```bash
PSQL="docker exec -i blackcode-postgres psql -U blackcode -d blackcode_issues"

# 1. The role. Locally the password can be anything; it is not a secret here.
$PSQL -v ON_ERROR_STOP=1 -f docs/sql/billing-app-role.sql

# 2. Register the app, DISABLED. Part 2 of the same file matches nothing yet.
$PSQL -v ON_ERROR_STOP=1 -f docs/sql/billing-app-register.sql

# 3. Migrate, as the migrator (locally the same superuser).
npm run db:migrate:billing

# 4. Confirm the flag actually got set. This must print `t`.
$PSQL -c "SELECT slug, enabled, maintains_blob_index FROM platform.apps WHERE slug='billing';"

# 5. Re-run the register file. Part 2 now matches and enables the app.
$PSQL -v ON_ERROR_STOP=1 -f docs/sql/billing-app-register.sql
```

`docs/sql/billing-app-role.sql` and `billing-app-register.sql` are written in
phase 0 as **substituted copies of the books files**. Do not run
`docs/sql/app-role.sql`: its second half carries literal `issues` / `issues_app`
at lines 82–109, so running it for a new app silently configures issues instead.
That is how `books_app` reached phase 1 with zero privileges in its own schema
while the boundary probe passed.

## Then prove it, as the role

This is the part the local setup makes possible and that production makes
awkward, so do it here:

```bash
docker exec -i blackcode-postgres psql \
  "postgres://billing_app:<local-pw>@localhost:5432/blackcode_issues" \
  -f docs/sql/app-boundary-probe.sql
```

**Read the positive checks first — (1), (4a), (4e).** A role that was granted
nothing denies everything with `42501` and passes six of the probe's eight
denial checks, so the denials are the weaker half. Check (4d) must print
`blob_refs_purge`'s own refusal, not a schema denial; if it prints a schema
denial, the `EXECUTE` grant from step 1 did not land.

Check (2) will report `SKIPPED` loudly where it has no second app schema to
point at. That is correct behaviour and not a pass.

**`SET ROLE` from the superuser is not a substitute.** `session_user` ignores
`SET ROLE`, and inside a `SECURITY DEFINER` function `current_user` is the
function's owner — which is exactly how `platform.blob_refs_purge`'s own
authorisation guard was true for everybody (finding #2). Connect as the role or
do not claim the result.

Record the transcript in `apps/billing/docs/backend.md`, stamped with the commit
it describes. A verification claim that does not name the file state it was true
for silently becomes a claim about code that no longer exists.

## Adding the app to the ledger tooling

`devops/db-ledger/lib-db.sh:105` reads:

```sh
TRACKED_SCHEMAS="'platform','issues','sales','scaffold'"
```

**`books` is missing from it**, which means `verify.sh` has been giving the books
schema a clean bill by never asking about it — the same shape as a probe that
reports success having skipped its own work. Phase 0 adds both `billing` and
`books`, then re-runs `capture-baseline.sh`.

## The env file

`apps/billing/.env.local`, not committed:

```sh
# b/billing local development.
#
# Local Postgres comes from the repo-root docker-compose (port 5434). The same
# superuser credential serves as BOTH the app role and the migrator locally,
# which is exactly why the app-boundary probe has to be run by hand against the
# real `billing_app` role — see docs/billing-app-plan/local-database.md.
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues

# billing runs on 3300. issues is 3000, sales is 3100, books is 3200.
NEXTAUTH_URL=http://localhost:3300
NEXTAUTH_SECRET=local-dev-only-not-a-real-secret-0000000000

# NEVER set RUN_MIGRATIONS locally. It gates the postbuild migration and belongs
# only in Vercel Production.
```

**`NEXTAUTH_SECRET` must be byte-identical to the other apps' local value.**
Cookies ignore ports, so all four local apps share one cookie on `localhost`; a
different secret means the session minted by one app makes another throw
`JWEDecryptionFailed`.

## Useful queries

```bash
PSQL="docker exec -i blackcode-postgres psql -U blackcode -d blackcode_issues"

# Which schemas exist
$PSQL -Atc "select schema_name from information_schema.schemata order by 1;"

# What billing_app may actually do — the positive check, not the denials
$PSQL -Atc "select table_schema, table_name, privilege_type
            from information_schema.table_privileges
            where grantee='billing_app' order by 1,2,3;"

# Default privileges, the half that is usually missing
$PSQL -Atc "select * from pg_default_acl;"

# The app role must own nothing
$PSQL -Atc "select c.relname from pg_class c join pg_roles r on r.oid=c.relowner
            where r.rolname='billing_app';"   -- 0 rows

# What the catalog says about a trigger or constraint. CHECK THE CATALOG,
# NOT THE REPO: a constraint name, a trigger and a cascade are facts about the
# database that no grep of apps/ can see.
$PSQL -Atc "select conname, contype, confrelid::regclass
            from pg_constraint where conrelid='billing.invoice'::regclass;"
$PSQL -Atc "select tgname from pg_trigger
            where tgrelid='billing.invoice'::regclass and not tgisinternal;"

# Which migrations this app has applied
$PSQL -c "select * from drizzle.__drizzle_migrations_billing order by created_at;"
```

## What a green local run does not prove

Written out because every item here has produced a false pass on this project:

| Local green | What it does not tell you |
|---|---|
| The app serves requests | Nothing about grants. You are a superuser. |
| The boundary probe passed | Nothing, unless you ran it **as `billing_app`** and read the positive checks. |
| `npm run db:migrate:billing` succeeded | Nothing about production, where the migrator is a different role and `RUN_MIGRATIONS` gates the hook. The check for that is the deploy log saying "applying Drizzle migrations". |
| The suite is green | Nothing about the pages. Every check in this repo that verifies behaviour sees `app/api/**` and nothing else. Open the pages. |
| No cross-app query was found | Nothing about `sales`, which is not in this database. |
