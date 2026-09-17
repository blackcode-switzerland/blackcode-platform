# b/billing — backend

This app only. Platform-wide contracts are in the root `docs/`: `backend.md` for
the API conventions and the `platform.*` schema, `platform-db.md` for the
database boundary, `adding-an-app.md` for how an app is registered.

The build plan is `docs/billing-app-plan/`, one document per milestone.

## What exists (phase 0)

`billing.*` holds four tables and nothing about invoicing:

| Table | What it is |
|---|---|
| `workspaces` | this app's tenants. `slug` is UNIQUE and appears in every URN this app prints |
| `workspace_members` | **the access gate.** Membership of a workspace IS permission to use this app; `platform.workspace_apps` and `platform.app_access` were dropped on 2026-08-10 |
| `invitations` | offers. Nothing redeems them yet — there is no accept route |
| `counters` | `(workspace_id, entity_type, last_value)` — the workspace `#number` allocator |

`counters` is deliberately not the scaffold's `note_counters`, which is one
column per entity type and so needs an ALTER every time the app grows a noun.
This app grows four more across phases 1, 4 and 5.

**Two numbers, and conflating them would be the worst bug this app could
ship.** `seq` from `counters` is the ADDRESS an agent and a URN use
(`bc:billing:acme/invoice/12`). The statutory invoice number is per COMPANY,
gapless, and allocated in phase 1 from `billing.company.next_seq` by a
row-locking `UPDATE … RETURNING`. Never a Postgres `SEQUENCE`: a rollback would
consume a value and leave a hole.

## The account surface, and why it is larger than the scaffold's

The scaffold mounts nine method exports. This app mounts those plus the five
b/books proved are needed:

| Route | Why it is here |
|---|---|
| `/api/cli/authorize` **and `app/cli/authorize/page.tsx`** | `bk login --server https://billing…` opens the PAGE and the page posts to the route. Mount only the route and the browser 404s while the terminal waits forever on a loopback listener, with no error at either end |
| `/api/me/footprint` GET + DELETE | without it, closing a blackcode account **strands** this app's data, owned by an account that can no longer sign in |
| the four password routes | the app has its own login, so it owes its own recovery. `apps/sales` used to send people to `apps/issues` to change a password both apps share |
| `/api/tokens`, `/api/tokens/{id}` | `bk login` authorizes at this origin, and it is how the first external customer's service account gets its credential |
| `/api/meta` | **its own route, not a factory.** Mounting it is what makes `bk login --server <billing>` work at all: the CLI learns every app's address from `apps.<slug>.base_url` in this payload, and an app serving no `apps` block writes an EMPTY registry |

`POST /api/workspaces` is served here and is **not** in the scaffold's set. The
reasoning is in the route file and in `createWorkspaceForUser`.

## Decisions this app took in phase 0

**The empty-workspace dead end (`docs/2026-08-multi-app-refactor.md` §9.1) is
closed with an explicit act.** Somebody arriving on a session cookie from another
blackcode app has a valid session here and no workspace, because
`ensureWorkspaceForUser` runs only in the sign-in callback and in
`POST /api/auth/register`. They now get a "create a workspace" action that calls
`POST /api/workspaces`, the same route `bk billing workspace create` calls.

The rejected option was bootstrapping on first authenticated request. It is
cheapest and it is wrong for this app: it would mean anyone holding a blackcode
account for any reason silently acquires tenancy in the app that sends real
payment slips.

**No one-workspace-per-person cap, unlike b/books.** A second workspace here is
a genuinely separate TENANT; a second issuing entity is a company inside one
workspace. Phase 6 also needs two workspaces owned by one person to force every
empty state.

**`APP_NAME`, `CONTACT_EMAIL` and `EMAIL_ACCENT` read the environment.** A copy
of this app runs as another company's invoicing product, so what a person reads
must move without a rebuild. `APP_SLUG` never does: it is the schema, the CLI
namespace and the guide directory.

## The boundary probe, run as `billing_app`

Local Docker (`blackcode-postgres`, port 5434, database `blackcode_issues`),
2026-09-17, on branch `feat/billing-phase-0-be`.

Provisioned in the order `docs/sql/billing-app-role.sql` states — role, register
part 1, migrate, register part 2 — because two migrations depend on things
existing and neither fails loudly.

**The positive checks, read first.** A role granted nothing denies everything
with `42501` and passes six of the probe's eight denial checks, so the denials
are the weaker half (CLAUDE.md finding #16).

| Check | Result |
|---|---|
| **(1) own schema readable** | ok — `billing.workspaces` readable |
| **(4a) blob index readable** | ok — count returned |
| **(4e) purging its OWN references** | ok — succeeded, 0 rows |
| (2) `issues.issues` | refused, `42501` |
| (3) `CREATE TABLE platform.…` | refused, permission denied for schema platform |
| (4b) forging a foreign reference | refused, permission denied for table blob_references |
| (4c) erasing a foreign reference | refused, same |
| **(4d) purging ANOTHER app's references** | refused by **`blob_refs_purge`'s own guard**: "role billing_app may not purge references held by app not-this-app" — not a schema denial, which is what would mean the grants never landed |
| (5) `drizzle.__drizzle_migrations` | refused, permission denied for schema drizzle |

**And the grants that prove the role is provisioned rather than empty** — this
is the query that returned 0 rows for `books_app` on 2026-08-17 while its probe
passed:

| | |
|---|---|
| tables in `billing` with DML for `billing_app` | 4 of 4 (`counters`, `invitations`, `workspace_members`, `workspaces`) |
| default ACL entries for future tables | 2 |
| `EXECUTE` on `platform.blob_refs_purge` | true |
| `maintains_blob_index` | true |
| tables owned by `billing_app` | **0** |
| privileges outside SELECT/INSERT/UPDATE/DELETE | **0** |
| schemas reachable | `platform`, `billing` (and `public`, which is empty and has no CREATE) |

Migrations landed as three rows in `drizzle.__drizzle_migrations_billing` — this
app's own ledger. A shared ledger silently skips an app's migrations, because
drizzle takes one high-water mark over the whole table.

## Phase 1: companies and invoices

Five more tables, three migrations, and the two contracts that cannot change
later without touching every row.

| Table | What it is |
|---|---|
| `company` | the issuing entity. Owns its own invoice sequence via `next_seq` |
| `invoice` | a numbered legal document. Three identifiers, all different |
| `invoice_line` | a table, not `jsonb` (D-B4): a money value inside `jsonb` is a float64 |
| `audit` | append-only, and it IS the edit workflow. Also the event feed |
| `idempotency_keys` | so a retried create replays instead of minting a second real bill |

### The two numbers, and a third identifier nothing prints

| | What it is | From | Printed where |
|---|---|---|---|
| `id` | the row | `serial` | nowhere |
| `seq` | the workspace `#number`, the ADDRESS | `billing.counters` | `invoice show 7`, the URN, the route path |
| `seq_no` → `number` | the per-company STATUTORY sequence | `company.next_seq` | the document, and inside the payment reference |

`seq_no` is gapless because `UPDATE company SET next_seq = next_seq + 1 …
RETURNING` takes a row lock for the rest of the transaction. A second create
waits; a rollback reverts the increment **before the waiter is released**, so the
waiter gets the same number and no hole appears. A Postgres `SEQUENCE` is
explicitly non-transactional and would leave one.

That serialises creation per company. It is the price of the guarantee and it is
the right trade at this volume.

### Nothing derived is stored

No `subtotal`, no `vat`, no `total`, no `line_total` column. Every total is
computed from the lines, the price mode and the company's rounding policy on
every read.

That is not tidiness. Since decision **D-B7** the rounding policy is a COMPANY
setting, so a stored total would have to be rewritten across history whenever
that setting moved — a migration triggered by a settings change.

### The rules with no database object behind them

Four, and they are the ones most likely to be quietly lost, because a write path
that forgot to call one would pass every other guard in this repo:

| Rule | Why not a CHECK |
|---|---|
| QRR requires the company to HAVE a QR-IBAN | needs the company row |
| an unregistered company charges no VAT on any line | needs the company row |
| the 140-character payment message budget | a property of the request |
| `expected_total` against the derived total | a property of the request |

`lib/db/queries/invoices.test.ts` exercises all four directly. They are exported
for that reason, and `invoices.ts`' header names them so a third write path has
to notice.

### What only a real HTTP call found

Three bugs survived `tsc`, the unit tests, `cli-parity` and the build, and were
found by the first `curl` against the routes on 2026-09-17. All three are
CLAUDE.md's "a route is not a page" corollary one layer down.

| Bug | Symptom | Why nothing else saw it |
|---|---|---|
| **nothing derived the reference body.** `ref_body` was left null while the company default was QRR | `check_violation`, 400 on every create | the CHECK was right and the code had no reference generator at all. `lib/derive/reference.ts` got one, with the P11 warning (moved to `lib/qr/reference.ts` in phase 2) |
| **the fresh read ran INSIDE the transaction**, through `getDb()` — a different connection, where the uncommitted row is invisible | "invoice vanished after insert", 500 | the types were fine and every pure-function test was green. All five write paths now read after the commit |
| **a hand-rolled `ApiStatusError`** on the assumption `apiHandler` recognises any `{status, code, message}` shape. It recognises `ApiError` | the 422 became a 500 with no code and no suggestion | `Errors.unprocessable` existed the whole time. The mistake was inventing a shape instead of reading the module that owns error responses |

The third one also corrected the wire contract: the error body's human field is
**`error`**, not `message`. `types/index.ts` said `message`, which is what a
reader would guess and is wrong — a client switching on it reads `undefined` on
every refusal.

### Verified end to end, as the real role

Against the local Docker database on 2026-09-17, with a real `bk_live_…` token
over HTTP, and then as `billing_app` directly.

**The arithmetic**, every figure checked against an independent computation:

| Invoice | Shape | Derived |
|---|---|---|
| `PX-0001` | exempt + 8.1% + 2.6%, prices INCLUDE VAT, `total_0_05` | subtotal 388.00, VAT 0.46 + 8.99, total **388.00** (nothing added) |
| `BC-2026-0001` | 8.1%, prices EXCLUDE VAT, `line_0_05` | subtotal 1770.00, VAT 143.35, total **1913.35** |
| `BC-2026-0003` | exempt only, EUR | subtotal 3600.00, no VAT block |
| overview | per currency, never merged | CHF outstanding 2982.40 of which overdue 2594.40, paid 1913.35; EUR all zero |

**Idempotency:** the same key with the same body replayed the same `#seq` and set
`Idempotent-Replayed: true`; the same key with a different body returned 422
`idempotency_key_reused`; no key at all minted a second invoice, which is correct
— unguarded is unguarded.

**Eleven write-door refusals**, each with the right status, code and suggestion:
QRR without a QR-IBAN (409), `total_mismatch` naming the policy and the price
mode (409), a 141-character message (400), an unknown language (400), editing the
number (400), editing a sent invoice's currency and its lines (409 each), fields
and `items` in one patch (400), nested metadata (400), an unknown status filter
(400). Editing a sent invoice's **due date** returned 200, which is G2 working
rather than absent.

**And as `billing_app`**, the refusals AND the positives, because a check built
only on denials cannot tell a working boundary from a role that can do nothing
(finding #16):

| Refused | How |
|---|---|
| DELETE on `invoice`, `audit`, `company` | permission denied — the revoke, before the trigger is reached |
| UPDATE on `audit` | permission denied |
| changing an invoice number | G1's trigger, naming the correction path |
| `paid → sent`, reviving a void | G3's trigger, naming the machine |
| a `NON` invoice with a reference body | G4's CHECK |
| another app's schema | permission denied for schema books |

| Allowed | Result |
|---|---|
| reading its own invoices | 9 rows |
| editing a draft's message | 2 rows |
| appending to the log | inserted |
| deleting a draft's line | deleted — draft editing works, which the revoke would have broken |

## Phase 2, ticket #84: `lib/qr/` — references, character set, payload, validation

Built 2026-09-17, on `feat/billing-phase-2-be`. Pure functions, no I/O, no new
runtime dependency. `swissqrbill` (MIT) is a **dev** dependency, used only in
`oracle.test.ts` as a second opinion (decision D-B2). Nothing here is wired into
a route yet: #85 renders the PDF, #86 exposes it and fills phase 3's
`prepareInvoiceDocument` seam, which is what turns `send` on.

| Module | What it owns |
|---|---|
| `reference.ts` | QRR mod-10 recursive and SCOR mod-97-10, generate and validate; ISO 13616 IBAN check; QR-IID detection; the printed groupings; **the P11 body scheme**, moved here from `lib/derive/reference.ts` |
| `charset.ts` | §4.1.1 by codepoint. Rejects, never transliterates; positions counted in characters |
| `labels.ts` | Annex C, all five languages, frozen |
| `payload.ts` | Table 8, serialized; the invoice → fields mapping (legal name as creditor, debtor only when its address is complete) |
| `validate.ts` | every refusal, all at once, each with a code and a suggestion |
| `spec-examples.ts` | the standard's Example 2, as test data |

`apps/billing/docs/qr-bill-spec.md` is the research extraction, vendored, with a
box at the top listing what the PDF says differently.

### What checking against the standard found

- **The SCOR body limit was wrong in phase 1**, in code and in the database.
  ISO 11649 allows 25 characters for the WHOLE reference; `referenceBodyFor`
  truncated the body to 25 and 0005's CHECK allowed 25, so a long invoice number
  produced a reference no bank takes — and truncation could give two invoices the
  same one. The body limit is 21 now, a number that cannot form a reference is
  **refused** (409 `number_cannot_form_reference`, and the allocated number is
  rolled back), and migration 0008 tightens the CHECK.
- **The phase-1 seed carried such a reference** — PX-0001, a 24-digit SCOR body.
  Migration 0008 refused to apply over it, naming the invoice, until the seed was
  corrected. It refuses rather than rewrites: a sent bill's reference is printed
  on a document a client holds.
- **A QR reference of all zeros** passed 0005's CHECK. It does not now.
- **A supplied `ref_body` was never checked** at create or edit beyond the CHECK.
  `referenceBodyProblem` checks it at the write door, as the pair it will be
  after the patch — a type change alone can leave a body the new type cannot
  carry.
- **Example 2's creditor name** in the v2.4 PDF is `Max Muster & Söhne (sample
  company)`; the research extraction had dropped the parenthesis.
- **The standard does not say** what happens to line 32 when only line 33 is used;
  `payload.ts` keeps positions and `swissqrbill` does not. Recorded, unreachable
  in v1.

### Verified on 2026-09-17

- **The standard's numbers, recomputed:** the Annex B vector, the QR references of
  Annex A examples 1 and 2, the SCOR vector, the example 4 erratum (fails, and
  `RF24` is its correct check), and the IBANs of examples 1–3.
- **Example 2's payload, byte for byte**, with CR+LF.
- **`swissqrbill` agrees** on 500 random QRR bodies, 500 random SCOR bodies, 63
  valid and corrupted IBANs, the printed groupings, and the payload for Example 2
  and all four shapes this app issues.
- **As `billing_app`:** a 21-character SCOR body and a non-zero 26-digit QRR body
  are accepted; a 22-character body, a hyphenated body, and 26 zeros are refused by
  the CHECKs. (The first run of this probe touched zero QRR rows — the seed has no
  QRR draft — and was redone against a draft converted inside the transaction.)
- **Over HTTP:** a supplied SCOR body with a hyphen and one of 22 characters → 400;
  21 → 201; a number format yielding 27 letters and digits → 409 with
  `next_seq` unchanged; draft edits to a 22-character body, to NON with a body left
  over, and to SCOR with no body → 400, and the corrected pair → 200.

## Phase 3: lifecycle and delivery

Built on 2026-09-17, **before phase 2**. Four write paths in
`lib/db/queries/lifecycle.ts`, four public routes under
`app/api/workspaces/[ws]/invoices/[ref]/`, migration `0007_billing_delivery.sql`,
and one change to a shared package (`packages/platform-email`, decision D-B3 —
the reasoning is in `docs/changelog/platform.md`).

### `send` is built and refuses, and the seam is where phase 2 lands

`send` needs the QR-bill validation and the PDF, and both are phase 2. Rather than
mail a stand-in document or pass a validator that checks nothing,
`lib/delivery/document.ts` exports ONE function, `prepareInvoiceDocument`, that
phase 2 fills with validate-then-render. Today it throws **501
`document_renderer_not_built`**, after the route's own checks and before anything
is rendered, mailed or written, with `mark-sent` as the suggestion.
`lib/delivery/document.test.ts` asserts the refusal and is the test phase 2
rewrites.

### The order of a send

1. **`canDeliverEmail()`, in the route, first.** Production with no Resend key
   answers `503 email_not_configured` and nothing else runs.
   `lib/api/send-route.test.ts` asserts the RESPONSE both ways (finding #21).
2. Parse the body; no database.
3. **`SELECT … FOR UPDATE` on the invoice.** It must be a draft.
4. Readiness (`assertReadyToIssue`): a line, a client name, a positive total, an
   account for the reference type, a live company, and the write-door rules
   re-run — a draft can have been edited into a state `create` would refuse.
   Plus a company email, because it becomes `reply-to`.
5. The document (the seam above).
6. The transport, with an idempotency key derived from WHAT is sent (recipients,
   subject, body, PDF sha256). A refusal is **502 `email_delivery_failed`**, and
   the transaction rolls back: still a draft, no audit row.
7. `status`, `sent_at`, `sent_message_id`, `pdf_sha256` and one `sent` audit row,
   in the transaction that has held the lock since step 3.

The lock is held across the transport call deliberately: committing first could
mark a bill sent that never left, and mailing first reopens the double send.

**The one state no ordering removes** is mail accepted, then commit failed. It
answers **500 `delivered_not_recorded`** naming the message id and `mark-sent`,
and writes an `error_events` row with the Postgres cause (Drizzle hides it in
`cause`). A retry of the same send within Resend's window is deduplicated by the
transport key.

**Development carve-out.** Outside production with no key, `canDeliverEmail()` is
true and the send completes WITHOUT delivering: the server log prints what would
have gone, `sent_message_id` and `pdf_sha256` stay null, and the audit detail says
"WITHOUT delivery". The platform's rule, not this app's (`client.ts`).

### What 0007 changed, including in phase 1's guard

- Three columns: `sent_at`, `sent_message_id`, `pdf_sha256`, with four CHECKs — a
  sent or paid invoice has a `sent_at`; a message id has a fingerprint; delivery
  facts have a `sent_at`; the fingerprint is 64 lowercase hex.
- **G2 was replaced**, although the plan said it needed no change. `language` was
  in neither of 0005's lists — neither frozen nor stated as editable — while it
  decides every word on the document. The invoice-level `vat_rate` was frozen by
  the app and not by the trigger, under a comment claiming the two mirrored.
  Both are frozen in the database now, with the three delivery columns.
  `frozen-fields.test.ts` compares the newest definition with `DOCUMENT_FIELDS`.
- Backfill: dev rows that walked `sent`/`paid` got `sent_at = updated_at`. On a
  database with real bills it touches nothing, because none exist.

### Two phase-1 defects this phase made reachable, fixed

- **`setInvoiceLines` took the invoice's row lock last.** A send could lock,
  render and commit while a line replacement that had already read `draft`
  rewrote the lines underneath; its final `updated_at` bump then committed new
  amounts on a sent invoice. It locks first now.
- **The 403 envelope was scrambled in four routes** —
  `Errors.forbidden(code, message, suggestion)` against a signature of
  `(message, suggestion, code)`. One mapping in `lib/api/refusal.ts` now, tested
  per status.

### Verified on 2026-09-17, against Docker Postgres

Over HTTP with a real `bk_live_…` token:

| Request | Result |
|---|---|
| send a ready draft | **501** `document_renderer_not_built`; still a draft, 0 audit rows |
| send with no `to`; with `"a@b.ch, c@d.ch"` | 400 `recipient_required`; 400 `invalid_recipient` |
| send a sent invoice | 409 `already_sent` |
| mark-sent with a key, then the same key again | 200; **200 with `Idempotent-Replayed: true`** |
| mark-sent again with no key | 409 `already_sent` |
| PATCH `language`, `client`, lines on a sent invoice | 409 `document_frozen` ×3 |
| PATCH `due_date` + `message` on it | 200, two `field_changed` rows |
| PATCH `sent_message_id` | 400 `field_not_editable` |
| paid on a draft; in 2027; on 2026-02-30 | 409 `not_sent`; 400 `paid_date_in_future`; 400 `invalid_paid_date` |
| paid; paid again | 200; 409 `already_paid` |
| void with no reason; `confirm: "px-0002"` | 400 `void_reason_required`; 409 `confirm_mismatch` |
| void; void again | 200 with `{ts, by, reason}`; 409 `already_void` |
| the next create for that company | `PX-0003` — the voided `PX-0002` stays consumed |

With a **temporary fixture renderer** in the seam (never committed):

| Case | Result |
|---|---|
| two concurrent sends of one draft | one 200, one 409 `already_sent`, **one** audit row, one log line |
| the same, with `.for('update')` removed from `lockInvoice` | **three transport calls** for three requests; one recorded, two 500s — which also exposed that `delivered` was set on the dev path, so those 500s said "WAS emailed" of mail that never left. Fixed |
| a real Resend call with an invalid key | **502** `email_delivery_failed: API key is invalid`; still a draft, no audit row, the idempotency key released (a retry ran again rather than 409) |

The first fixture send found a bug the unit tests could not: readiness parsed the
total with `parseMinor(total, 2)`, whose second argument is a multiplier, not a
count of places. It passed on every `.00` total and threw a 500 on `540.50`. The
test fixture now has real cents, and the old spelling turns four cases red.

As `billing_app` over `psql`, positives first: a sent invoice's `due_date` and
`message` update; a draft goes to `sent` with its delivery facts. Refused: G2 on
`language`, `vat_rate`, `sent_message_id`, `sent_at`, and a line of a sent
invoice; `invoice_sent_requires_sent_at`, `invoice_message_requires_fingerprint`,
`invoice_pdf_sha256_shape`, `invoice_delivery_requires_sent_at`. With
`trg_invoice_document_frozen` and `trg_invoice_line_frozen` disabled inside a
rolled-back transaction, the same `language` and `unit_price` edits succeeded;
after rollback both triggers read enabled.

The line race, with a second session holding the invoice row for four seconds
and committing `sent`: the HTTP line replacement waited ~4s and answered **409
`document_frozen`**, lines unchanged. With the lock-first block removed, the same
race answered **200** and `9999.00` was committed on the sent invoice.

Through the built `bk` binary: `send` printed the 501 and its hint; `void`
without `--confirm` and with `--confirm 11` both exited **2** before any write;
`--confirm " BC-2026-0007 "` voided it and echoed the number, client and amount;
`mark-sent` on a sent invoice exited **2** on the server's 409.

## The guards, watched failing

A check nobody has watched fail is not a check (CLAUDE.md's standing rule).
Every guard this phase added or relies on was broken, observed red, and
restored, on 2026-09-17:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/cli-parity.test.ts` | `cli/internal/guide/topics/billing/` renamed away, `make routes` re-run | "no bk command is ATTRIBUTED to billing" — route attribution comes from the guide section list |
| `lib/app-isolation.test.ts` third case | `import { listMyWorkspaces } from '@blackcode/platform-db'` added to `app/dashboard/page.tsx` | named the file and the helper |
| the same, namespace form | `import * as pdb` plus `pdb.listMyWorkspaces(…)` — the spelling the named scan cannot see | named the call |
| `lib/db/queries/holds-covers-entities.test.ts` | a `probe` table added to the schema with no `holds` line | "billing.probe … an app that under-reports its footprint is silently SKIPPED" |
| the same, vacuous-pass case | the declaration regex changed so it matches nothing | "has been passing without a subject" |
| `lib/no-brand-literal.test.ts` | `b/billing` in JSX text; then in a string literal; then an empty file list | each reported, including "scanned 0 files" |
| `migration-journal.test.ts` | one journal entry deleted | "these migrations … will never apply … this is exactly what shipped on 2026-08-17" |
| `migration-ledger.test.ts` | the ledger table name reverted to drizzle's default | "two apps would migrate into the SAME drizzle ledger … SILENTLY SKIPPED" |
| `guide_test.go` `vocabularySources` | a topic restating three invitation statuses | `--- FAIL: …/billing` — the app-specific section that b/books never had |
| the same, source path | `vocabularySources["billing"]` pointed at a missing file | `TestVocabularySourcesAreReal` |
| `help_app_roster_test.go` (new) | the billing row deleted from the root help tour; then a row naming an app the binary lacks | both directions reported |
| `devops/release.sh` | `release.sh web billing` with the placeholder project id | refused, naming the step that fixes it |

Phase 1 added these, on 2026-09-17:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/derive/totals.test.ts` | the inclusive VAT formula given the exclusive divisor | named the invoice and the expected 8.99 |
| the same | `hasVatBlock` rewritten as `> 0`, merging exempt into zero-rated | named the case |
| the same | `parseRappen` replaced with `Number()` — the `1e3` bug | three tests, including the one that would bill 1000× |
| the same | rounding changed from half-away-from-zero to `Math.round` | the credit-note symmetry case |
| `lib/vocabularies.test.ts` | a value added to the served list; removed from the union; added to the CHECK; then the constraint RENAMED | the first three fired. **The fourth passed**, because the name matched as a prefix — fixed with a word boundary, then it fired |
| `holds-covers-entities.test.ts` | a table named only in a comment | it had accepted that, so `company` and `invoice` went unreported. Comments are stripped now, and it checks the Drizzle identifier |
| `nextstep_test.go` | the next step dropped from `invoice create` | named the function and the file. **Its first version also false-positived** on a GET whose comment said "ON DELETE SET NULL"; it reads the annotation value now |
| `seed-guard.test.ts` | the allowlist turned into a blocklist | the two tests that matter — it would have let a non-Neon production host through |
| `guide_test.go` | three invoice statuses restated in a topic | `--- FAIL: …/billing` |
| the same | the same three words inside longer words | silent, which is the point |
| the same | `QRR, SCOR, NON` restated | silent at first — the extractor read lowercase only. Widened, then it fired |
| `help_flag_drift_test.go` | (not injected) | caught a REAL drift: the audit group's help named `--since`, which only its leaf accepts |

Phase 2 (ticket #84) added these, on 2026-09-17:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/qr/reference.test.ts` + `oracle.test.ts` | the mod-10 carry table's last two entries swapped | 8 cases: the Annex B vector, example 1's reference, the 500-body library comparison, and everything that reads a QRR reference |
| `reference.test.ts` | SCOR check digits as `97 − …` | the vector, the erratum case, and reference completion |
| the same | `SCOR_BODY_MAX` back to 25 | the 22-character body accepted, three cases. (The limit was also a literal `21` in two regexes, so this mutation could not have reached them — they read the constant now) |
| `charset.test.ts` | Latin-1's lower bound moved to 0x80 | the boundary case |
| `labels.test.ts` | `Konto / Zahlbar an` → `Konto / zahlbar an` | named the key and language |
| `payload.test.ts` | the join forced to LF; the trailing-A-line trim removed; one Ultimate Creditor line deleted | the CR+LF golden; "ends at EPD"; seven cases including the golden |
| `validate.test.ts` | returns `[]`; refuses everything; QR-IBAN matrix check removed; the 140 budget in UTF-16 units | 17 refusal cases; the four positive shapes and Example 2; the matrix case; the emoji budget case |
| migration 0008 | run over the phase-1 seed | refused, naming `PX-0001 (SCOR 210000000003139471430009)` |

Phase 3 added these, on 2026-09-17:

| Guard | The mutation | What it said |
|---|---|---|
| `packages/platform-email/test/send.test.ts` | the `attachments` spread removed from `deliver()`; then `replyTo`; then the idempotency option | the bytes case; then the reply-to case, twice. The invitation key-set case stayed green, as it should |
| `lib/api/send-route.test.ts` | `if (true \|\| !canDeliverEmail())` | the "can deliver" case — finding #21's exact mutation |
| the same | the check moved below `sendInvoice` | the "cannot deliver" case: the send path was entered |
| `lib/api/refusal.test.ts` | the old `forbidden(code, message, suggestion)` order | both 403 cases |
| `lib/db/queries/frozen-fields.test.ts` | `language` out of `DOCUMENT_FIELDS`; out of 0007; 0007's definition hidden | each direction, then three cases at once. **Its first run found its own extractor blind to `pdf_sha256`** (`[a-z_]+` has no digits) |
| `lib/db/queries/lifecycle.test.ts` | readiness back to `parseMinor(total, 2)` | four cases, once the fixture had real cents |
| `lifecycle_test.go` | presence check removed; compared with `ref`; raw flag sent; `EqualFold` | each its own case. The raw-flag mutation's first spelling did not compile — a red that proved nothing, redone |
| `guide_references_test.go` (new) | the referenced topic renamed away | named the help and both topics. Its first run false-positived on the valid bare slug `bk guide files` |
| `guide_test.go` | (not injected) | caught a REAL restatement in the new topic: `sent, paid or voided` is the audit-action vocabulary |
| `invoice_sent_requires_sent_at` | (not injected) | refused phase 1's seed walk, `SET status = 'sent'` — confirmed by running the old seed |

## Still owed at the end of phase 3

- **Phase 2**, which turns `send` on: `prepareInvoiceDocument` must validate and
  render, and `document.test.ts` flips with it.
- **A real email to a real inbox**, with the attachment's sha256 compared to
  `pdf_sha256`. Needs phase 2 and a Resend key; it is the headline done-when of
  `docs/billing-app-plan/phase-3-lifecycle-and-delivery.md` and it is not done.
- **The 503 over HTTP in production mode.** Asserted by `send-route.test.ts` on
  the response; not run against `next start` with `NODE_ENV=production`.
- **The email shell's fixed words are English** (see the platform changelog).

## Still owed at the end of phase 0

- **The Vercel project.** `bc-billing` does not exist. `devops/release.sh`
  carries billing's registry line with a placeholder project id and **refuses to
  deploy it**, naming the step that fixes it — a real-looking id would deploy to
  whichever project the working copy was last linked to.
- **The production probe.** The transcript above is local, against the owner
  credential for the app and the real role for the probe. Production has a
  separate migrator, which the local container does not model.
- **`bk login` through a browser.** The loopback round-trip needs a real
  browser session and is a human step.
- **The QRR reference scheme is position P11 and is not settled with the bank.**
  `lib/qr/reference.ts` (was `lib/derive/reference.ts`) implements the plan's layout — 14 zeros, the company
  `#number` in 4, the invoice `seq_no` in 8 — in one function, with that warning
  in its header. Changing it after real bills are out means two schemes in the
  wild.
- ~~**The reference CHECK DIGIT is not computed yet.**~~ Computed since
  2026-09-17 (ticket #84, `lib/qr/reference.ts`); the PDF is still owed.
  `ref_body` is stored without it, deliberately: a stored check digit is a value
  that can disagree with the body it checks.
- **`/api/me/footprint`'s `holds` array now counts companies and invoices**, and
  `holds-covers-entities.test.ts` went red the moment 0004's tables were
  mirrored, which is how it came to be written rather than forgotten.

## Frontend

`apps/billing/docs/frontend.md`.
