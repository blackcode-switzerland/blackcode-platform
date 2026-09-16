# Phase 5: Imported history

**Goal:** the bills issued before this app existed are browsable in it, keeping
their original numbers, their original system's reference, and a visible note
wherever nobody could work out what a row meant.

- **The problem** — there are roughly seven years of invoices in Zoho Books and
  Invoicely, across several currencies, and Zoho is being retired. Those bills
  are the company's own history: they are needed to answer "what did we charge
  them last time", and some of them are still the evidence behind a tax
  position. They cannot be re-issued into the native sequence, because
  renumbering an invoice a client already holds is a bookkeeping violation. And
  the mapping is genuinely ambiguous in places — a duplicate across the
  migration window, an issuing entity inferred from a bank account, a VAT amount
  missing from the export.
- **What this phase does** — adds one read-only archive table whose rows keep
  their source system's reference verbatim and their historical number
  unchanged, with a per-row flag carrying the ambiguity in words. An agent maps
  the old exports and posts them in; a duplicate source reference is refused by a
  unique constraint rather than merged. The archived PDFs stay on Google Drive
  and this app stores a path, never a file.
- **Expected result** — one screen showing 2019 to 2025 grouped by year, with
  source badges, currency filters and the flags visible rather than hidden; a
  second import of the same source row refused with a 409 naming the existing
  one; and no imported row anywhere near the native invoice sequence.

## In one look

| | |
|---|---|
| **Data** | The bills from before this app, with their original numbers, their source system and reference, and a note on anything unresolved. |
| **Logic** | Refuse a second import of the same source row. Turn a stored Drive path into a link, and say plainly when there is no PDF. |
| **UI** | One screen: the old years, grouped, filterable, flags visible. |

## Module diagram

```
┌─ UI ────────────────────────────────────────────────────────
│  components/history-table.tsx   year groups, filters     new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/billing/history.go                             new
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/history/**                      new
│  lib/db/queries/history.ts                               new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  migrations/0009   history, its unique key, its revokes
└─────────────────────────────────────────────────────────────
```

## Build

### Migration 0009

#### `billing.history` — a read-only archive

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `seq` | `integer` | the workspace `#number`. `UNIQUE(workspace_id, seq)`. |
| `source` | `varchar(16)` | `zoho` / `invoicely`. A closed vocabulary with a `CHECK`. |
| `source_ref` | `varchar(64)` | **the source system's own id, verbatim.** `ZB-000178`, `INV-0293`. Never normalised, never reformatted. |
| `company_id` | FK company | which entity issued it. May itself be flagged uncertain. |
| `number` | `varchar(40)` | **the historical number as issued.** Never renumbered, and deliberately not unique against `invoice.number`. |
| `client_name` | `varchar(200)` | flat text. No b/clients linkage, not even a placeholder. |
| `issue_date` | `date` | |
| `currency` | `char(3)` | includes USD, which is outside QR scope entirely |
| `total` | `numeric(14,2)` | the total **as it was**, stored rather than derived — there are no lines to derive it from |
| `status` | `varchar(10)` | as the source recorded it |
| `import_flag_fr`, `import_flag_en` | `text` nullable | the ambiguity, **in words**. Null means the row mapped cleanly. |
| `drive_path` | `text` nullable | the archived PDF's path or id on Drive. **Null means the export had no PDF**, and that is shown rather than hidden. |
| `imported_at` | `timestamptz` | |

```sql
CREATE UNIQUE INDEX uq_history_source_ref
  ON billing.history (workspace_id, source, source_ref);
```

Then the revokes: `REVOKE UPDATE, DELETE ON billing.history FROM billing_app`.
It is an archive. A row is inserted once and then read forever.

**`total` is the one stored amount in this app**, and the exception is worth
stating: rule 6 says never store a derived value, and this value is not derived
from anything we hold. There are no imported line items. Storing it is the only
way to have it, and a comment on the column says so, so that nobody "fixes" it
by computing from lines that do not exist.

### The import endpoint

`POST …/history`, taking an **array** of rows, one transaction:

- `source_ref` is stored exactly as given. No trimming, no case folding, no
  reformatting. It is the only handle back to the system of record.
- A duplicate `(source, source_ref)` is a **409 naming the existing row's
  `seq`**, through `pgViolation`. Not an upsert and not a merge: two exports
  disagreeing about one bill is something a human has to look at.
- `import_flag_*` carries anything the mapper could not resolve. **Ambiguity is
  surfaced, never guessed.** The mockup's own flags are the register of what
  this actually means in practice: a possible duplicate across the
  Invoicely-to-Zoho migration window, an issuing entity inferred from the bank
  account, a USD bill with no VAT amount in the source, a row marked void in
  Zoho with no reason recorded.
- `drive_path` is a path or an id, **never a file and never a blob**. This app
  does not have an upload ledger and must not acquire one here.

There is no importer UI and no mapping engine. `BRIEF.md` forbids both by name:
the agent maps and posts, the app stores and shows. One endpoint, called with a
prepared file.

### Provenance is permanent

An `import_flag` is not cleared when somebody resolves the question. Rule 6 of
`RULES-OF-THE-ROAD.md`: anything inferred stays visibly marked as inferred
**forever**, because confirmation resolves the question and does not erase the
origin. If a resolution needs recording, it is an audit row beside the flag, not
an edit to it — which is also why `UPDATE` is revoked.

## Routes and CLI

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/history` (`?source= ?currency= ?year= ?flagged= ?company=`) | `bk billing history list` |
| `POST /api/workspaces/{ws}/history` | `bk billing history import --file rows.json` or `--file -` |
| `GET /api/workspaces/{ws}/history/{seq}` | `bk billing history show` |

`--file -` reads stdin, which is how an agent pipes a mapped batch without
quoting a JSON array through a shell. Use `cmdutil.ReadBody`.

The import command's output **names what it wrote**: how many rows, how many
were refused as duplicates and which `source_ref`s they were, and how many
carry flags. A count alone is the difference between an import somebody checks
and one nobody looks at for a month.

## The web surface

One page, `/dashboard/[ws]/history`:

- **Grouped by year**, newest first, each group with its own count.
- Filters: source, currency, year, and "only flagged".
- The flag text rendered **inline on the row**, in the UI language, not behind a
  tooltip. A hidden warning is not a warning.
- **`PDF · Drive`** as a link where `drive_path` is set, built by
  `@blackcode/platform-file-providers`' Drive URL shaper — which parses and
  builds URL shapes and makes no network call, which is exactly what is wanted.
  Where it is null, the row says **"no PDF in the export"** in words.
- Never the raw URL inline. The mockup is explicit about this and it is a
  readability decision rather than a security one.

**Table layout: auto, not fixed.** A pinned `colgroup` with `table-layout: fixed`
over variable-width content produces overlapping headers and clipped chips, and
three separate builders hit it independently in one day on the mockup side. Use
`white-space: nowrap` on the atoms that must not break — money, dates, reference
codes, badges — and let the columns size themselves.

## Done when

- [ ] 2019 to 2025 render grouped, and the counts and totals match the mockup
- [ ] A second import of the same `(source, source_ref)` is refused with a 409
      naming the existing row
- [ ] Twenty concurrent imports of the same row insert **one**
- [ ] `source_ref` round-trips byte-identically, including one with surrounding
      whitespace deliberately present in the fixture
- [ ] A row with `drive_path = null` shows "no PDF in the export"; one with a
      path shows a working link
- [ ] Flags render inline, in both languages, and a flagged row is findable by
      the filter
- [ ] `billing_app` cannot `UPDATE` or `DELETE` a history row — checked as that
      role
- [ ] A USD row lists correctly and offers no payment part anywhere
- [ ] **These were watched failing, then restored:** the unique index dropped;
      `source_ref` trimmed on the way in; the flag moved into a `title`
      attribute; `UPDATE` re-granted
- [ ] The page opened in a browser, in FR and EN, and **on the empty tenant**,
      where it must say what it is for rather than showing an empty frame

## Frontend gets

One page, and it is the least dense in the app. The mockup's
`app-history.html` is the layout.

## Notes

**Imported rows never enter the native sequence.** Position **P6**, and it is the
one that would be expensive to reverse. An archive row keeps its own number in
its own namespace, and nothing joins the two. If Andrea ever wants history to
become first-class invoices, that is a migration with a renumbering question
attached, and this phase deliberately builds nothing toward it.

**No linkage to b/clients, not even a nullable column.** `client_name` is flat
text. A nullable `client_ref` pointing at an app that does not exist is a shape
somebody later mistakes for a feature, and the mockup's own flag
("individual client — b/clients match uncertain") is the honest way to carry that
uncertainty instead.

**This phase is independent of everything above it.** It touches no other table
and could be built any time after phase 1. It is scheduled here because it is the
cheapest thing to defer, not because anything blocks it — so if the real bills
start flowing before this lands, that is fine and expected.
