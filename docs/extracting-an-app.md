# Extracting an app

platform-architecture.md §11 claims one of these apps could be sold or spun out.
This is that claim, **rehearsed on 2026-08-05** against a full copy of production
data, with the result and the one trap that would have ruined it.

Verdict: **it works, and it takes about twenty minutes.** But the obvious command
is the wrong one, and the wrong one fails silently.

---

## ⚠️ The trap: `pg_dump --schema=issues` is NOT an extraction

It looks like exactly the right command. It is not, and what makes it dangerous
is that the restore **appears to succeed**.

Rehearsed, with numbers:

```bash
pg_dump "$URL" --schema=issues --no-owner --no-privileges > issues-only.sql
psql -d issues_only < issues-only.sql          # exit code 0
```

| | |
|---|---|
| Tables restored | 11 |
| Rows in `issues.issues` | 669 |
| **Blob-reference triggers** | **0** |
| **Foreign keys to `platform`** | **0** |
| Errors printed | 27 × `schema "platform" does not exist` |
| **Exit code** | **0** |

The triggers *are* in the dump — they belong to the tables, so `pg_dump` emits
all five. They point at `platform.blob_refs_sync()`, which is in a schema the
dump excluded, so every `CREATE TRIGGER` fails at restore. So do all 22 foreign
keys into `platform.users`, `platform.workspaces` and `platform.labels`.

Without `ON_ERROR_STOP=1`, `psql` reports those 27 failures and **exits 0**. You
are left with a database that is fully populated, boots, serves content — and has
silently lost referential integrity and the entire blob-reference index
maintenance. Nothing looks wrong. `bk super-admin blob-drift` would report the
truth, but only if someone ran it.

**Always restore with `-v ON_ERROR_STOP=1`.** A partial restore that exits 0 is
the worst possible outcome.

## The extraction that actually works

An app is not just its schema. It is its schema **plus the platform tables it
depends on** — identity, workspaces, membership, comments, labels, uploads,
events, the blob index — because those are what its foreign keys point at. Take
all of it:

```bash
pg_dump "$SOURCE_URL" \
  --schema=platform --schema=issues --schema=drizzle \
  --no-owner --no-privileges > extracted.sql

createdb extracted
psql -d extracted -v ON_ERROR_STOP=1 -f extracted.sql     # must exit 0
```

**Include `drizzle`, and here is why** — it is the detail nobody thinks of until
it has already happened. `drizzle.__drizzle_migrations` is the ledger of which
migrations have run. Omit it and the extracted database restores fine, then the
new deployment's first `drizzle-kit migrate` finds an EMPTY ledger against a
FULLY POPULATED database and attempts all forty migrations from scratch —
`CREATE TABLE` on tables that exist, `ALTER TABLE … SET SCHEMA` on tables already
moved, a `NOT NULL` tightening that has already been applied. Some fail, some
succeed, and the order decides which. It is the single most destructive way to
begin operating an extracted copy.

Rehearsed result, into a plain `postgres:17` container with no Neon involved:

| | |
|---|---|
| Restore errors | **0** |
| Schemas | `platform`, `issues`, `drizzle` |
| Rows in `issues.issues` | 669 |
| Blob-reference triggers | **6** |
| `platform.*` blob functions | **5** |
| `platform.blob_references` rows | 110 |
| Migration ledger | 41 |

## Then prove it works, three ways

A restore that reports success is not a working system. All three of these were
run:

**1. The triggers still fire.** Not "the triggers exist" — that was true in the
broken restore too:

```sql
INSERT INTO issues.issues (workspace_id, title, description)
VALUES (…, 'probe', '<img src="https://x.public.blob.vercel-storage.com/e.png">');
-- → platform.blob_references gains 1 row.  Rolled back.
```

**2. The app's own test suite, pointed at the extracted database.**

```bash
cd apps/issues
PLATFORM_DB_DRIVER=pg TEST_DATABASE_URL="postgres://…/extracted" npx vitest run
# → 203 passed (203)
```

**3. The app boots and serves, and not only its health check.** A health probe
exercises the server's own code paths; it is not evidence the product works
(Phase 7's outage was green on `/api/status` throughout).

```
GET /api/status     → {"overall":"ok","probes":{"database":{"status":"ok"}}}
GET /api/meta       → 401     (auth is wired, not bypassed)
GET /dashboard      → 307     (middleware is running)
x-bk-cli-latest / x-bk-cli-min served
436 live issues readable
```

## What it cost

**About 20 minutes**, most of it pulling a Postgres image. The dump is 3.2 MB for
this dataset; the restore takes seconds.

### What hurt

1. **The obvious command is wrong and fails silently.** See above. This is the
   whole finding.
2. **No local `pg_dump`.** Neon is Postgres 17 and `pg_dump` must be at least the
   server's version; `docker run --rm postgres:17 pg_dump "$URL" …` avoids
   installing anything.
3. **Test-registry contamination.** The rehearsal branch had a throwaway `sales`
   row in `platform.apps` from the `docs/adding-an-app.md` walk, and it came
   along in the dump — failing one access test in the extracted copy until it was
   removed.

   That is the trivial version of a question this document **deliberately does
   not answer**: a full `platform` dump carries every app's rows in
   `platform.apps`, and `platform.users` carries every user of every app. Some of those are other customers' names.
   **That is a data-protection question, not a schema question**, and the right
   answer depends on the counterparty, the contract and the jurisdiction —
   none of which a rehearsal has. Whoever does a real extraction owns it. Raise
   it before the dump, not after.

### What an extraction still owes

The database is the easy half. Not rehearsed, and not free:

- **Blob storage.** Files live under an `<app>/…` prefix in a shared store, but
  everything uploaded before Phase 7 sits flat at the root with no prefix.
  `platform.uploads.app` is the attribution, never the path — so selecting one
  app's blobs is a query against the ledger, then a copy, then a rewrite of every
  URL embedded in content. That is a project, not a command.
- **The platform packages.** `packages/platform-*` would be vendored into the
  extracted repo. They have no published versions and no release process.
- **Identity.** `platform.users` contains every user of every app. An extraction
  hands over accounts belonging to people who never used the extracted app.

None of these are blockers, and all of them are cheaper to know about now than to
discover during a sale.
