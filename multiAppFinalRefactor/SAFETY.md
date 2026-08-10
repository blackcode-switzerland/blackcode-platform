# Safety — backups, verification, and what to do when it goes wrong

**Read this before any phase that touches the database.**
Phases 1, 3 and 5 of `PLAN.md` do. Phases 0, 2, 4, 6 and 7 do not.

---

## The one rule

> **`apps/issues` is live and people are using it. `apps/sales` has no users.**
>
> Every destructive step in this refactor targets sales. If a step would touch a
> row that issues can see, stop and re-read the plan — it means something has
> been misread.

---

## Before ANY phase that changes the database

Two backups, because they fail differently. Takes about three minutes.

### 1. A Neon branch — instant, point-in-time, free

Neon console → **Branches** → **Create branch** → from your production branch.
Name it for the phase: `pre-phase-3`, `pre-phase-5`.

This is a full copy of production as of that second. Restoring is a branch
swap, not a data import.

**Delete it when the phase is verified.** A stale branch is a full copy of your
production data sitting around — the thing you cleaned up on 2026-08-10.

### 2. A dump on disk — survives losing the Neon account

```bash
docker exec -i blackcode-postgres pg_dump "<neondb_owner url>" \
  --format=custom --file=/tmp/pre-phase-N.dump
docker cp blackcode-postgres:/tmp/pre-phase-N.dump \
  ~/Documents/BAK/blackcode-platform-backups/
```

> `pg_dump --schema=<one schema>` is **not** a backup of that schema. Its
> triggers and foreign keys reference objects it does not emit, `psql` prints
> errors and **still exits 0**, and you get a database that boots having silently
> lost referential integrity. That is finding #7 in `CLAUDE.md`. Dump the whole
> database or nothing.

---

## The "nothing lost" ledger

Built in Phase 0: `multiAppFinalRefactor/lib-db.sh` (shared psql plumbing —
runs `psql` natively if present, else falls back to
`docker exec blackcode-postgres psql`, so the same scripts work against a
Neon URL from a machine with `psql` installed and against local dev, which has
no native `psql`), `capture-baseline.sh`, `verify.sh` (+ its diff engine,
`verify-diff.awk`), and `backup.sh`.

**What `capture-baseline.sh` records.** Per table, in schemas `platform`,
`issues` and `sales`: `count(*)`, `min(id)`, `max(id)`. Not just a count — a
count alone can't tell "5 rows deleted" from "5 deleted and 5 inserted", and
the second is what a mid-refactor bug looks like. Tables with no integer `id`
column are recorded as `NOID` (count-only) rather than silently skipped. The
file's header records the capture timestamp, the database name, and the
number of tables found; it refuses to write a baseline at all if it finds
zero tables, so an empty baseline can never look like a valid one.

```bash
./multiAppFinalRefactor/capture-baseline.sh "<connection-url>" multiAppFinalRefactor/baseline.txt
```

**What `verify.sh` does.** Re-measures the same three schemas and diffs
against a baseline file. Prints PASS/INFO/FAIL per table, and exits non-zero
on any of: an undeclared count decrease, `min(id)` increasing (even with the
count unchanged — catches a delete paired with an insert), a table missing
from the database, a table missing from the baseline, zero tables found, or a
connection/query failure. Increases are INFO, never a failure — people are
using issues throughout this refactor.

```bash
./multiAppFinalRefactor/verify.sh "<connection-url>" multiAppFinalRefactor/baseline.txt
```

**Run baseline and verify as `MIGRATE_DATABASE_URL`** (`neondb_owner`), the same
role as migrations. Both scripts measure every table in one batched query, so a
permissions problem on any single table fails the entire run rather than
degrading to "48 tables checked, 1 access denied". That is the right trade — a
partial capture that looks complete is worse than a loud total failure — but it
means the bounded app roles cannot run these.

**What it cannot catch — read this before trusting a green.** It confirms HOW
MANY rows a table has and the shape of its id range. It does not confirm WHICH
rows. A delete that removes the right *number* of rows but the wrong *ones*
passes clean. So:

> **`verify.sh` passing does not mean the right 8 rows went — only that 8 went
> and were declared.**

That is why the `SELECT`-first / read-the-`DELETE`-count / `COMMIT` ritual below
is not redundant with it. They are different checks: this ledger is
magnitude-and-omission, that ritual is identity. Neither substitutes for the
other. It also cannot see content corruption — an UPDATE that blanks a column
changes no count, no `min(id)`, no `max(id)`.

**How to use it:** run it after every migration, every delete, and every deploy
in phases 1, 3 and 5. Not at the end of the phase — after every step. A count
that dropped three steps ago is a debugging session; a count that dropped just
now is a one-line fix.

**Expected decreases must be declared, not discovered.** Phase 3 deletes sales'
rows from shared tables. Before running the delete, add a block to
`baseline.txt` naming the table, the exact signed delta, and the reason:

```
# EXPECTED 2026-08-12 phase-3 agent4
# platform.comments -8   sales rows, parent_type LIKE 'sales:%'
```

`verify.sh` sums every declaration for a table and requires the actual
decrease to match the sum **exactly** — not "some decrease happened". A
declared `-8` followed by an actual `-9`, or an actual `-7`, both fail. This is
deliberate: a declaration is not a blanket "ignore this table", and the two
directions of mismatch were both watched to fail before this was trusted (see
below).

**Taking a backup:**

```bash
./multiAppFinalRefactor/backup.sh "<neondb_owner url>" ~/Documents/BAK/blackcode-platform-backups/pre-phase-N.dump
```

Refuses to run without a destination path. After `pg_dump` returns, it checks
the file is non-empty, at least 1 KB, and — via `pg_restore --list` — an
actually-valid custom-format archive, so a `pg_dump` that exits 0 having
written nothing or garbage cannot be read as a successful backup (finding
#7/#15 in `CLAUDE.md`).

### Watched fail before it was trusted (Phase 0, 2026-08-10)

Run against local Postgres (`docker compose up -d`, `localhost:5434`), never
production. Every case below was injected, observed red by name, then
restored, and the real `baseline.local-example.txt` was re-verified clean
afterward. Full detail, including two bugs this exercise found and fixed
(`verify.sh` crashing silently on a connection failure, and a file-role
mix-up in the awk diff engine when the declarations file is empty), is in
`multiAppFinalRefactor/agent1/agent-2026-08-10-1.txt`.

```bash
docker exec -i blackcode-postgres psql "<local url>" \
  -c "DELETE FROM platform.password_reset_otps WHERE id = 6"
./multiAppFinalRefactor/verify.sh "<local url>" multiAppFinalRefactor/baseline.local-example.txt
# must go RED and name platform.password_reset_otps — then restore the row.
```

If it does not go red, the script is decoration. Nineteen guards in this repo
have been found green and inert; two of them were written by the session that
wrote the rule about it, within the hour.

---

## Deletes: the only one-way steps

Phase 3 deletes sales' rows from shared tables; Phase 5 drops two tables.

**Rules for every delete:**

1. A fresh Neon branch **immediately before** — not this morning's
2. Run the `SELECT` form first and read the count:
   ```sql
   SELECT count(*) FROM platform.comments WHERE parent_type LIKE 'sales:%';
   ```
3. If that count is not what the plan predicts, **stop**. A surprise here means
   the assumption "sales has no data anyone wants" is wrong.
4. Delete inside an explicit transaction, check the row count, then `COMMIT`:
   ```sql
   BEGIN;
   DELETE FROM platform.comments WHERE parent_type LIKE 'sales:%';
   -- read the DELETE count. Right? COMMIT. Wrong? ROLLBACK.
   ```
5. `verify.sh` immediately after

**Never `DELETE` without a `WHERE` naming sales.** Not once, not "just to see".

---

## Migrations

- **Always run as `MIGRATE_DATABASE_URL`** (`neondb_owner`), never as the app
  role. The app roles have no DDL, by design.
- **One migration ledger per app** (D-34). Sales' migrations live in
  `apps/sales/lib/db/migrations` and are recorded in sales' own ledger. A shared
  ledger silently skips migrations and exits 0.
- **Every migration needs a rollback script** in `docs/sql/`, with
  `\set ON_ERROR_STOP on` at the top. Without it, `psql` reports success after
  failing every statement — findings #7 and #15.
- **Rehearse on a Neon branch before production.** The 2026-08-10 deploy did
  this and it caught a provisioning order that failed silently.

---

## If something goes wrong

**A deploy is broken, data is fine** → Vercel **Instant Rollback** on the
affected project. Seconds, no database involvement.

**A migration did the wrong thing** → run its rollback script from `docs/sql/`.
Read the header first: several are deliberately in two steps, and step 2 is
commented out because it is only correct when undoing the migration rather than
the code.

**Data is actually lost** → restore the Neon branch you took before the phase.
This is why the branch is taken immediately before, not once per day.

**You are not sure what happened** → stop. Do not run another migration to fix
it. Take a fresh branch of the current state first, so the broken state is also
recoverable, then investigate.

---

## Deploy order, every time

Both apps, from the repo root, after every phase that ships code:

```bash
./devops/release.sh web issues
./devops/release.sh web sales
```

And after any CLI release, both again — each deployment answers the "current
version?" question and `bk` asks whichever app the user is homed on. See
`docs/devops.md`.

---

## Checklist per database phase

```
[ ] Neon branch taken, named for the phase
[ ] pg_dump written to ~/Documents/BAK/blackcode-platform-backups/
[ ] baseline.txt current, and any EXPECTED decrease written into it first
[ ] verify.sh green before starting
[ ] verify.sh green after every step, not just at the end
[ ] issues opened in a browser: sign in, open an issue, see its comments
[ ] Neon branch deleted once verified
```

That last line matters. The branch is a full copy of production data, and
leaving it is the same mistake as leaving the rehearsal branch on deploy day.
