# Phase 3: Sources and pièces

**Goal:** know where every franc came from, and accept documents from an
external worker.

Two halves. The sources register answers "do I have everything". The pièces
pipeline answers "can I prove it".

> **Building in a week?** This whole phase is deferred. See
> [`week-one.md`](week-one.md): documents become `piece_url` and `piece_hash`
> columns on the entry, and `source` becomes a flat lookup with no layers, no
> `draws_from` and no computed staleness. Keep the API field name `drive_ref` so
> nothing on the frontend changes when the real pipeline lands here.

## In one look

| | |
|---|---|
| **Data** | Every place money data comes from such as bank accounts, cards and Stripe, the raw files pulled from each, and receipts stored as a link to the file rather than the file itself. |
| **Logic** | Work out whether a source is up to date, late or missing data from how often it should update, accept receipts posted in by an outside robot and recheck its maths, and flag identical receipts instead of deleting one. |
| **UI** | Three screens go live: the source list, one source's detail page, and the receipts inbox. Nothing here changes a balance. |

## Module diagram

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘                 ▲
                                    │
  Drive worker ──▶ POST ingest ─────┘   (outside the app)
```

```
┌─ UI ────────────────────────────────────────────────────────
│  components/sources      the source list                    new
│  components/source       one source, runbook, pulls         new
│  components/pieces       the receipts inbox                 new
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/books/source.go        list, show                 new
│  commands/books/piece.go         list, ingest, match        new
│  commands/books/manifest.go                                 new
│  client/books.go                                        altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/sources, sources/[n], manifest     new
│  app/api/workspaces/[ws]/pieces, pieces/[n]/match           new
│  app/api/workspaces/[ws]/pieces/ingest    the robot door    new
│  lib/derive/sources.ts    staleness from cadence            new
│  lib/derive/manifest.ts   the two tier Drive manifest       new
│  lib/validate/extraction.ts   server side revalidation      new
│  lib/db/queries/sources.ts, pieces.ts                       new
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        5 tables                      altered
│  migrations/0005         sources, pulls, runbooks,
│                          piece inbox, drive manifest
│  unique index on (drive_file_id, md5_checksum)
└─────────────────────────────────────────────────────────────
```

**Platform packages: imported, never altered.** Note what is deliberately NOT
used: `platform-storage`. Receipts live in Google Drive and the legal archive,
never in Vercel Blob, so this app records no uploads and adds no blob triggers.

**Shared files this phase alters:** none.

**One box sits outside the app.** The Drive worker is a separate stateless
process. It holds a `bk_live_...` token and posts to the ingest route like any
other caller. It never touches the database.

## Build

### Migration 0005: tables

| Table | Notes |
|---|---|
| `source` | Every bank, card, processor, SaaS feed and Drive folder. Spend side only. |
| `source_pull` | Raw files pulled, with hash and Drive reference. Our own copy. |
| `runbook` | Versioned automation steps. Credential **references** only, never secrets. |
| `piece_inbox` | One row per document the worker delivered. Always staged. |
| `drive_manifest` | One row per Drive file, with a state machine. |

### Computed, never stored (`lib/derive/`)

`sourceStatus`, `sourceWindows`, `sourceBalance`, `driveFoldersManifest`,
`fileManifestFor`, `piecesFor`, `pieceInboxFor`

Source status is derived from cadence against `last_import`. Do not add a status
column. Somebody will set it by hand and the completeness signal dies.

The only status fact set by hand is `retired`, which is a lifecycle event.

### The ingest endpoint

`POST /api/workspaces/{ws}/pieces/ingest`

The external Drive worker posts an `ExtractionResult` here. Schema is in
`_bridge/to-claude/ocr-spike-handoff/prototype/extraction-schema.json`, in the `b-mockups` repo.

Four rules:

1. **Always staged.** A staged row never touches a balance.
2. **Idempotent** on `(drive_file_id, md5_checksum)`. Enforce with a unique index.
3. **Re-validate on the server.** Sum check, VAT rate whitelist
   `{0, 2.6, 3.8, 8.1}`, date plausibility. Ignore the worker's own flags. The
   boundary trusts bytes and arithmetic, not the caller.
4. **Flag duplicates, never drop them.** Refunds and split payments look
   identical to duplicates.

The worker authenticates with a `bk_live_...` token. `resolveUser` already
handles bearer tokens, so no new auth is needed.

### Document matching

Matching a document to a transaction happens inside phase 2's worklist. There is
no second review queue.

### Routes and CLI

| Route | Command |
|---|---|
| `GET /api/workspaces/{ws}/sources` | `bk books source list` |
| `GET /api/workspaces/{ws}/sources/{n}` | `bk books source show` |
| `GET /api/workspaces/{ws}/sources/{n}/manifest` | `bk books manifest` |
| `GET /api/workspaces/{ws}/pieces` | `bk books piece list` |
| `POST /api/workspaces/{ws}/pieces/ingest` | `bk books piece ingest` |
| `POST /api/workspaces/{ws}/pieces/{n}/match` | `bk books piece match` |

## Done when

- [ ] The spike's `worker.mjs` posts a real extraction and it appears staged in
      the inbox and in the worklist
- [ ] Posting the same file twice creates one row
- [ ] A tampered payload fails server validation even when the worker said it
      passed
- [ ] Balances are unchanged by anything in this phase

## Frontend gets

**3 pages live:** Comptes & sources, Source detail, Pièces justificatives.

## Notes

**Files are references, never blobs.** Store `drive_ref`, `archive_ref` and a
sha256. Do not put documents in Vercel Blob. Do not add blob triggers to these
columns.

**No cash source row, ever.** Cash is not an importable feed, so a row for it
would poison the computed staleness. Out of pocket spend is an expense against
the shareholder current account.

**The legal archive is separate from Drive.** Drive is the inbox and the human
view. The immutable copy is a GCS bucket with a retention lock. That is decided
but not built. `archive_ref` is honestly empty until it is.

**Order flex.** The sources register alone could move earlier if the completeness
view is wanted sooner. Pièces cannot, because review lives in phase 2's worklist.
