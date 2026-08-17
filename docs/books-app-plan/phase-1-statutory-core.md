# Phase 1: Statutory core

**Goal:** five pages show real data, and the accounting rules are enforced by the
database rather than by app code.

This is the keystone phase. Three derivations unlock five pages and feed three
more.

> **Building in a week?** See [`week-one.md`](week-one.md). It keeps every guard
> and invariant below, drops `opening_balance` and `patrimoine`, and elects
> voluntary double entry for the sole proprietorship so `ri_entry` and its
> derivations are not built twice.

## In one look

| | |
|---|---|
| **Data** | Books, which the user creates and can have any number of, their financial years and account lists, every money entry with its two sides and its supporting document, and the starting balance of each account at the beginning of each year. |
| **Logic** | Add up entries to get each account's balance, build the balance sheet and profit and loss from those balances, and refuse any entry that does not balance or any edit to a saved one. |
| **UI** | Five screens go live with real numbers: overview, entry list, single entry, balance sheet, profit and loss. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/overview     the books list, any number         new
│  components/ledger       entry list, account filter         new
│  components/entry        one entry's detail                 new
│  components/bilan        balance sheet, legal order         new
│  components/cr           profit and loss, legal order       new
│  lib/client.ts           swap fixtures for real calls   altered
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/entity.go, exercice.go, account.go          new
│  commands/books/entry.go, bilan.go, cr.go, overview.go      new
│  client/books.go         the read methods               altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/entities|exercices|accounts        new
│  app/api/workspaces/[ws]/entries|bilan|compte-resultat      new
│  lib/derive/movement.ts, balance.ts                         new
│  lib/derive/bilan.ts, cr.ts, ri.ts                          new
│  lib/db/queries/transactions.ts, accounts.ts, overview.ts   new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        8 tables                           new
│  migrations/0001         the tables
│  migrations/0002         balance, immutability, mapping guards
│  migrations/0003         revoke UPDATE and DELETE on posted rows
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.** Same four as phase 0. Nothing in
`packages/platform-*` changes for the accounting core, and if it looks like it
should, that is a signal to re-read the boundary rules first.

**Shared files this phase alters:** none.

## Build

### Migration 0001: tables

| Table | Notes |
|---|---|
| `entity` | One row per book. **The user creates these and may have any number.** Three are seeded; nothing anywhere may assume three. `legal_form` drives everything. |
| `exercice` | Fiscal year per entity. Calendar year. Must allow past, closed years. |
| `account` | The Swiss PME chart, per entity. `statement_position` is the only mapping you may touch. |
| `opening_balance` | Per entity, per exercice, per account. A table, not a constant. |
| `transaction` | One row per écriture. SA books. |
| `transaction_line` | The debit and credit lines. |
| `ri_entry` | The RI book. Single entry. Not a small transaction. |
| `patrimoine` | RI net worth snapshots, compiled on demand. |

### Migration 0002: guards, written in SQL

These are not app checks. They are database objects.

1. **Balanced lines.** Deferred constraint trigger. Fires on `posted` rows only,
   because a staged row may have a null account.
2. **Posted rows immutable.** Block `UPDATE` and `DELETE`. Corrections are
   reversing entries, so add `reverses_transaction_id`.
3. **`statement_position`.** `NOT NULL` foreign key. An unmapped account is a
   load error. There is no fallback "other" bucket.
4. **An SA can never be simplified.** `CHECK` constraint, so the state cannot be
   represented.

### Migration 0003: grants

`REVOKE UPDATE, DELETE` on the posted ledger tables from `books_app`. The app
role then cannot break immutability even by accident.

### Derivations (`lib/derive/`)

Pure functions. Every one takes `(entityId, exerciceId)`. Never store a result.

`movement`, `balance`, `crFor`, `bilanFor`, `riTotals`, `isBalanced`

The mockup's helpers in `bbooks/assets/bbooks-data.js`, in the `b-mockups` repo, are the reference
implementation. Port the signatures, add the year boundary.

### Queries (`lib/db/queries/`)

`listTransactions`, `getTransaction`, `listRiEntries`, `listAccounts`,
`getOverview`, `getPatrimoine`

### Routes and CLI

Write both in the same pull request or the parity test fails the build.

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/entities` | `bk books entity list` |
| `POST /api/workspaces/{ws}/entities` | `bk books entity create` |
| `POST /api/workspaces/{ws}/exercices` | `bk books exercice create` |
| `GET /api/workspaces/{ws}/exercices` | `bk books exercice list` |
| `GET /api/workspaces/{ws}/accounts` | `bk books account list` |
| `GET /api/workspaces/{ws}/entries` | `bk books entry list` |
| `GET /api/workspaces/{ws}/entries/{n}` | `bk books entry show` |
| `GET /api/workspaces/{ws}/bilan` | `bk books bilan` |
| `GET /api/workspaces/{ws}/compte-resultat` | `bk books cr` |
| `GET /api/workspaces/{ws}/overview` | `bk books overview` |

### Seed

Load the mockup's `bbooks/assets/bbooks-data.js`, from the `b-mockups` repo, into Postgres. This is your fixture and your test data.

## Done when

- [ ] Five pages render live data
- [ ] Actif equals passif on every entity, tested with a fourth one created at
      runtime so nothing silently assumes three
- [ ] Numbers match the mockup at `localhost:8734/bbooks` exactly, to the rappen
- [ ] Three invariant tests go red when broken:
      post an unbalanced entry fails, edit a posted entry fails, delete a row
      with history fails

## Frontend gets

**5 pages live:** Vue d'ensemble, Grand Livre, Transaction detail, Bilan,
Compte de résultat.

## Notes

**A supporting document is legally required on every entry, and it is still
nullable.** Art. 957a al. 2 CO requires a `pièce comptable` behind every booking,
and it applies to the sole proprietorship's single entry book too, by analogy
under art. 957 al. 3. But **do not make `piece` `NOT NULL`.** Real entries exist
with no recoverable document, notably the frozen UBS history the app was built to
handle. That is exactly what `evidence_tier` expresses:

| Tier | Evidence held | Profit tax | Input VAT |
|---|---|---|---|
| `full` | Compliant invoice, art. 26 LTVA | safe | safe |
| `partial` | Bank record plus reconstructed plausibility | likely, needs fiduciary sign off | **lost** |
| `bare` | Bank record only | at risk | **lost** |

**The two consequences are independent and never merged.** A bank record can
support a profit tax deduction and can never support an input VAT claim. So
`tva.input_claimed` is its own field and is never derived from the tier.

`evidence_tier` is a first class column on `transaction` and on `ri_entry` from
migration 0001, not an afterthought in phase 3. Phase 3 adds the documents
themselves; the field that says what evidence exists belongs here.

**Documents are links, never uploads.** `piece` holds
`{ drive_ref, hash, captured }`. The file lives in Google Drive and, later, in
the locked archive. Nothing is ever uploaded into this app.

**Two numbers per entry.** The platform `seq` addresses a row (`bk books entry
show 42`) and is never the serial `id`. Accounting also needs `entry_no`, a
gapless number scoped to `(entity, exercice)`, for the statutory journal. Model
both.

**The mockup has no fiscal year.** Its derivations sum every posting with no year
boundary, and `OPENING` is a hardcoded constant including a magic carry forward.
Your version takes `(entity, exercice)` from the first line of code. Skipping this
means rewriting the whole derivation layer later.

**Statement structures are code, not tables.** Nobody edits them at runtime. A
change is a reviewed code change citing the article.

**Zero balance legal lines still exist.** They may be visually collapsed. They are
never absent from the model.
