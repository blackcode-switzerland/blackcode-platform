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

## Phase 1's missing proofs, run 2026-09-17 (tickets #75–#77)

Tickets #75, #76 and #77 each named proofs that phase 1 never ran. They are now
`lib/db/queries/write-paths.integration.test.ts`, run as `billing_app` against
Docker, plus `lib/meta-contract-version.test.ts` and two recorded observations.
Running them found two real bugs.

| Ticket | Proof | Result |
|---|---|---|
| #75 | twenty concurrent creates | twenty contiguous numbers, `next_seq` advanced by exactly 20 |
| #75 | the number read as MAX+1 **outside** the transaction | **19 of 20 refused** with `duplicate key … uq_invoice_company_seq_no` — the duplicate, caught by the backstop |
| #75 | the same read **inside** the transaction, no company lock | numbers stayed contiguous; only `next_seq` went red. Creation takes the workspace counter lock first, which already serialises one workspace's creates — so contiguity alone does not prove the company lock |
| #75 | void then create | the voided number stays consumed; the next create takes the following one |
| #76 | one audit row per changed field / line path, none for unchanged | **red on the first run**: every line replacement logged a phantom `items[0].qty` change (`1` vs `1.000`). Fixed with numeric comparison of decimal columns (`sameValue`) |
| #76 | `appendFieldChanges` removed from the edit path, then the line path | each went red |
| #77 | two concurrent requests, one `Idempotency-Key` | one invoice |
| #77 | `uq_idempotency_ws_key` dropped as the owner | **two invoices**. Recreating the constraint then failed on the duplicate keys the run had written; they were deleted, the constraint recreated, and the catalog read back |
| #77 | a declared public route with no file | `lib/integration.test.ts` named it, twice |
| #77 | the contract hash moving | **there was no hash.** `/api/meta` never called `contractVersion`. Now served; over HTTP `436685fcf27ec26e` → `0818b5e4641d63d4` with one route added → `436685fcf27ec26e` on removal |

**The suite leaves data behind on purpose.** Invoices cannot be deleted, for the
owner either, so each run leaves one `itest-<timestamp>` workspace in the local
database. Run it with:

    TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
      npx vitest run lib/db/queries/write-paths.integration.test.ts
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

## Phase 2, ticket #85: `lib/pdf/` — the A4 invoice and the payment part

Built 2026-09-18, on `feat/billing-phase-2-be`. `renderInvoiceDocument({invoice,
company})` returns the bytes, whether a payment part was drawn, the page count
and a draw log. **Still not wired into a route**: #86 serves it, lists the fonts
in `outputFileTracingIncludes` and fills `prepareInvoiceDocument`, which is what
turns `send` on.

| Module | What it owns |
|---|---|
| `invoice.ts` | the A4 body in the invoice's language (issuer, client, lines, subtotal/VAT/total, message, footer), pagination with page numbers, the payment part on the LAST page; validates before drawing and throws `PaymentPartRefused` |
| `payment-part.ts` | the 210 × 105 mm strip: receipt 62 mm, payment part 148 mm, separation lines, QR at (67, 17) mm, 46 × 46, the 7 × 7 cross, blank fields at their mandated sizes |
| `sheet.ts` | top-left millimetre coordinates over pdf-lib; rectangles and lines written as raw operators with absolute coordinates inside `BMC … EMC` tags, so a test can read them back |
| `qr-matrix.ts` | `qrcode`, byte mode, ECC M, no ECI |
| `format.ts`, `copy.ts` | printed amounts, addresses and dates; the body's fixed words in fr/de/it/en |
| `fonts/` | Liberation Sans 2.1.5, vendored with its OFL licence and hashes (`fonts/README.md`) |

Three dependencies, runtime, this app only: `pdf-lib`, `@pdf-lib/fontkit`,
`qrcode`.

**Positions inside the sections follow `swissqrbill`'s renderer**, which
implements the SIX Style Guide. The standard states the SIZES in text and those
are asserted; the positions are drawn in its figures, so the printed check
against the Style Guide grid sheet stays a manual step (`qr-bill.md` §8).

### Verified on 2026-09-18, working tree on `91f45e4`

- **`pdf.test.ts`, 16 cases, measured from the SAVED file**: A4 size; the QR
  symbol 46 × 46 mm at (67, 209) mm from the page's top-left; the cross; the
  separation lines at 62 mm and 192 mm; the blank fields; no slip on USD; each
  language's headings; nothing on the receipt that §3.6 forbids; no heading whose
  value is absent; amounts and VAT; a multi-page invoice with the slip on the
  last page; a refusal instead of a slip the standard would reject.
- **Byte stability (P10), across two processes**: the same invoice renders to
  the same sha256 in two separate `tsx` runs.
- **The QR on the page scans to the payload.** The fixture was rendered, turned
  into a 2400 px PNG with `qlmanage`, cropped to the symbol and decoded with
  `jsQR`: 230 bytes, 31 lines, **byte-identical** to `serializeQrPayload` for the
  same invoice, accents (`à é è`) intact. This is a machine scan of a rendered
  page, not a banking app — the two-app scan is still owed.

## Phase 2, ticket #86: the routes, the seam, and the issuer copy (2026-09-18)

Two public routes, two commands, one migration, and the function `send` had been
waiting on.

| Route | Command | Answers |
|---|---|---|
| `GET …/invoices/{ref}/pdf` | `bk billing invoice pdf <ref> [--out] [--force]` | `application/pdf`, plus `X-Billing-Pdf-Sha256`, `X-Billing-Sent-Pdf-Sha256` (only when `send` delivered it) and `X-Billing-Invoice-Status` |
| `GET …/invoices/{ref}/qr` | `bk billing invoice qr <ref>` | `text/plain`: the payload, LF, no trailing newline |
| `GET …/invoices/{ref}` | `bk billing invoice show <ref>` | gains `issuer` and `derived` |

Both new routes are in `PUBLIC_ROUTES`. Neither writes an audit row.

### One seam, three callers

`lib/delivery/document.ts` — `prepareInvoiceDocument` (validate, then render) and
`prepareQrPayload` (validate, then serialize). `send`, `mark-sent`, `…/pdf` and
`…/qr` all go through it, so they refuse for the same reasons with the same
words: **422 `payment_part_invalid`**, one stable code, every problem in the
message. The individual codes are structured in `derived.problems` on the
invoice, which is how `invoice show` lists them without rendering anything.

`mark-sent` validates too, and that is a behaviour change. Once an invoice is
sent its document half is frozen; one that could not render at that moment could
never be served afterwards, and the only exit would be a void.

`…/qr` answers **409 `no_payment_part`** for a currency the QR-bill does not
carry and for a void invoice, rather than an empty 200: pasted into a validator,
an empty string reads as "the app produced nothing".

### A void invoice loses its payment part

`renderInvoiceDocument` draws no slip for a void invoice and stamps the title
line (`ANNULÉE` / `STORNIERT` / `ANNULLATA` / `VOID`, in `lib/pdf/copy.ts`). A
cancelled bill with a scannable code is the one PDF this app could serve that
moves money by mistake. A void invoice therefore always renders, even if its
issuer could no longer pass validation: nothing about the account is drawn.

### Invariant I12, the issuer half: migration 0011

`lib/invariants.test.ts` carried a case named "KNOWN GAP (#86)" that asserted a
company IBAN edit moved a SENT bill's account, written to go red the day this
landed. It did, and is now the invariant.

`billing.invoice.issuer` is a jsonb copy of the company, **NULL exactly while
the invoice is a draft**:

| Guard | What it holds |
|---|---|
| `invoice_issuer_iff_issued` CHECK | `(status = 'draft') = (issuer IS NULL)` — a write path cannot forget the copy, and a draft cannot carry a stale one |
| `invoice_issuer_shape` CHECK | an object with every key of `ISSUER_FIELDS` plus `captured_at` |
| G2 (`invoice_document_frozen`) | `issuer` is in the frozen list: nobody revises it, the owner included |
| `NEVER_EDITABLE` in `invoices.ts` | the PATCH refuses `issuer` and `derived` by name |

**The app writes the copy, not a trigger.** A trigger would read
`billing.company` a second time, after the render; a company edit committing
between the two would store a snapshot that is not what the client was mailed.
`draftToIssue` in `lifecycle.ts` reads the company row ONCE, and the readiness
checks, the totals (through `rounding`), the PDF and the stored copy all come
from that read — `getInvoiceDocumentSource(…, asIssuedBy)` shapes the invoice by
the snapshot instead of by its own join.

`rounding` is in the copy. It prints nothing and decides every total (D-B7), so
read from the live company a sent invoice's total moved with the setting. The
test for a future company column is in `lib/issuer.ts`: *would an already-sent
PDF look or add up differently if it changed?*

Every reader goes through `issuerOf(snapshot, live)`. `lib/issuer.test.ts` holds
`ISSUER_FIELDS`, 0011's backfill and 0011's shape CHECK to one another, and
fails if anything under `lib/pdf`, `lib/delivery`, `lib/qr` or the two routes
reaches for `billing.company` itself.

The backfill marks its rows `"backfilled": true`: the company as it was on
migration day, not at issue, because that moment was never recorded. b/billing
is undeployed, so this touches development databases only. `invoice show` says
BACKFILLED on those rows.

### The fonts, and how to know Vercel will have them

`lib/pdf/fonts.ts` reads two TTFs by a `process.cwd()` path the tracer cannot
follow. `next.config.js` includes them for `/api/workspaces/**` — every
workspace route, because the renderer sits behind `lifecycle.ts`, which a dozen
routes import, and a per-route list is a list somebody forgets.
`lib/pdf/font-tracing.test.ts` walks each route's imports transitively and
matches the include keys with Next's own bundled `picomatch`.

Read off a real `next build` on 2026-09-18: `route.js.nft.json` names both TTFs
for `…/pdf`, `…/send`, `…/mark-sent` and `…/companies`, and **neither** for
`/api/meta` — so the instrument can see an absence.

### What the first HTTP call found

**Every one of the mockup's eleven payment messages carries an em dash**
(U+2014), which a Swiss QR Code cannot encode (§4.1.1). The mockup never noticed
because its QR is a deliberate fake. Seeded verbatim, `invoice pdf` refused the
whole `blackcode` workspace. Three changes:

- the WRITE door refuses the character (`message_character_not_allowed`), so a
  draft that saves is a draft that can be sent. The app still never substitutes;
- the seed replaces U+2014 with `-` in messages only, says why in
  `qrSafeMessage`, and its read-back now fails if any seeded bill has a
  `derived.problems` entry or an issuer copy on the wrong side of draft;
- `character_not_allowed`'s suggestion named the creditor-name reason for a
  message field. It is per field now.

**To raise with Andrea:** the mockup's message convention (`Facture N — objet`)
cannot go on a QR-bill as typed.

Also: the first `next dev` of the session answered an HTML 404 for every
`[ref]/*` sub-route, including `…/paid`, which predates this ticket. A
`next build` and a restart cleared it and it did not recur; the cause was not
established (a stale `.next/dev` is the suspicion, not a finding).

### Verified on 2026-09-18, working tree on `e6bce0a`, over HTTP with the built `bk`

| Did | Saw |
|---|---|
| `invoice pdf PX-0001` (praxis-demo) | 29 569 bytes, `PDF document, version 1.7`; read as a page: issuer block, lines, `dont TVA`, payment part with QR, both IBAN blocks |
| the same, twice, `--out -` piped to `shasum` | one hash, equal to the one the command printed and the server's header |
| the same again, default path | exit 2, "already exists and may be the copy that was sent" |
| `invoice qr 1` through `od -c` | 31 lines, LF, ends `E P D` with no newline |
| `invoice pdf 7` (blackcode, before the seed fix) | exit 6, 422 `payment_part_invalid`, naming U+2014 at character 22 |
| `invoice qr 3` (void) | exit 2, 409 `no_payment_part` |
| `invoice pdf 3` (void) | renders; `ANNULÉE` beside the title, no payment part |
| `invoice show 1` | full reference, `Pay to` account and creditor, `Issuer: copied … BACKFILLED`, the problem list under the totals |

`lib/delivery/send.integration.test.ts` does what HTTP cannot without a Resend
key: a transport that keeps what it is handed. The sha256 of the mailed bytes
equals `pdf_sha256`, equals a re-render from the database — and still does after
the company's IBAN, legal name, rounding and footer are edited. It differs once
the payment message is edited, and matches again when the edit is reverted.

### Not done

- **The manual tiers of `qr-bill.md` §8**: four bills through SIX's validation
  portal, two banking apps, the grid-sheet print. `invoice qr` is what makes the
  first one a paste. Needs a person.
- **A real email to a real inbox** (needs a Resend key).
- The ticket's `derived.totals`: not added. `totals` is already on the invoice,
  and a second copy in one response is two numbers that must agree.

## Migration 0009: an audit author can be hard-deleted (2026-09-18)

Found while designing phase 5's history table, which has the same shape. The
audit log's `actor_user_id` is `ON DELETE SET NULL`, and 0005's append-only
trigger refused the UPDATE that SET NULL is carried out as — so a hard
`DELETE FROM platform.users` failed for anybody who had written a billing audit
row. **Account close is a soft delete** (`softDeleteUser`, an UPDATE), so no
close through the product was ever affected; only a manual hard delete was, and
because `platform.users` is shared, that meant one started from any app.

0009 re-creates `billing.audit_append_only()` to permit exactly one UPDATE: a
non-null actor becoming null with every other column unchanged (compared as
`to_jsonb` rows minus that column). `billing_app` still cannot issue it — UPDATE
is revoked — and a foreign-key action runs as the table's owner.

`lib/db/owner-guards.integration.test.ts` checks it as the OWNER, the identity
the trigger exists to stop, in transactions it rolls back. It needs its own
credential, `TEST_OWNER_DATABASE_URL`, and skips loudly naming that variable
(`integrationDescribe` gained `envVar` for it). Watched failing: before 0009
(the erasure case), and with an exemption that forgot "nothing else changed"
(the combined-change case).

## Phase 3: lifecycle and delivery

Built on 2026-09-17, **before phase 2**. Four write paths in
`lib/db/queries/lifecycle.ts`, four public routes under
`app/api/workspaces/[ws]/invoices/[ref]/`, migration `0007_billing_delivery.sql`,
and one change to a shared package (`packages/platform-email`, decision D-B3 —
the reasoning is in `docs/changelog/platform.md`).

### The seam `send` goes through (it refused until 2026-09-18)

`send` needs the QR-bill validation and the PDF, and both are phase 2, which was
built second. Rather than mail a stand-in document or pass a validator that
checks nothing, `lib/delivery/document.ts` exported ONE function,
`prepareInvoiceDocument`, that threw **501 `document_renderer_not_built`** until
phase 2 filled it. Ticket #86 did, on 2026-09-18: it validates and then renders,
and that code is gone from every path. See "Phase 2, ticket #86" below.

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

## Phase 5: imported history (ticket #93, 2026-09-18)

Bills from before this app existed, as a read-only archive. Built on
`feat/billing-phase-5-be`. Migration **0010** (not the plan's 0009: phase 2
took 0008 and the audit fix above took 0009), `lib/db/queries/history.ts`, three
routes, `bk billing history list|show|import`, guide topic
`06-imported-history.md`.

| Route | `bk billing` |
|---|---|
| `GET …/history` (`source`, `currency`, `year`, `flagged`, `company`, `limit`, `cursor`) | `history list` |
| `POST …/history` (`{rows: […]}`) | `history import --file rows.json` / `--file -` |
| `GET …/history/{seq}` | `history show <#>` |

None is public (`lib/integration.ts`): an import is a one-off an agent runs for
the business that owns the archive.

### What building it decided, where the plan left room

- **Status is a closed vocabulary of three: `paid`, `unpaid`, `void`.** The
  plan said "as the source recorded it"; a free-text column is one the screen
  cannot render and the CHECK cannot guard. A source's `sent`, `overdue` or
  `partially paid` is `unpaid` here, and what the word loses goes in the flag.
  An unpaid archived bill is not a receivable: nothing sums it into the overview.
- **Who imported a row is on the row** (`imported_by`, `imported_via`), not in
  `billing.audit`. The audit log is a PUBLIC event feed, an archive import is not
  an event an integration polls for, and a row that is never edited has no edit
  workflow to log. `imported_by` is `ON DELETE SET NULL` with 0009's exemption,
  in the table's own trigger function.
- **All or nothing, and a repeat is a 409, not a skip.** One import is one
  transaction; every row problem is reported at once; a `(source, source_ref)`
  already archived refuses the whole batch naming its `#number`. Re-importing a
  file changes nothing and says which rows were there. The unique index is the
  mechanism; the read before the insert only turns it into a sentence, and a race
  loser's unique violation is caught and answered with the same 409.
- **`drive_path` refuses the blob store's host at a CHECK** rather than carrying
  a `platform.blob_references` trigger. A column that cannot hold one of our files
  needs no entry in the index of our files, and 0002's "complete" flag stays true.
- **A flag is both languages or neither**, at the CHECK and at the door. A flag
  in one language is hidden from every reader of the other.
- **Numbers for an import come from one allocation** (`allocateSeqBlock`), so a
  batch is contiguous and 500 rows are not 500 round trips under the counter lock.
- **Unknown keys are refused**, and the CLI sends the rows as raw JSON rather
  than through a Go struct, so a mapper's typo reaches the server to be refused.
- **Money is a string**; a JSON number is refused with the string it should have
  been.
- **The list is newest bill first; the cursor is a `#number`** whose row's date
  is read back to continue. Stable because the rows cannot move.
- **Addressed by `#number` only.** The historical number is not unique (two
  systems, two companies) and is refused as an address rather than resolved to
  one of several bills.

`fixtures/mockup.json` is new: `scripts/extract-mockup.mjs` runs the mockup's
`billing-data.js` in a sandbox and writes its data and its own derived answers,
stamped with the mockup commit (`e406174`) and the file's sha256. Phase 5 uses
its fourteen history rows; phase 6's parity test uses the answers.

### Verified on 2026-09-18, working tree on `0e0f3b5`

- **As `billing_app`** (`history.integration.test.ts`, 12 cases): the mockup's
  fourteen rows import as #n…#n+13 with 5 flagged and 2 without a PDF, and what
  is read back is what was sent; the second import is a 409 naming all fourteen;
  a batch with one archived row writes nothing; **twenty concurrent imports of
  one row insert exactly one, and the nineteen losers get the named 409**; a
  padded `source_ref` comes back byte for byte; `billing_app` can SELECT and gets
  42501 for UPDATE and DELETE; the list pages through everything once in order and
  filters by year, source, currency, company and flag.
- **As the owner** (`owner-guards.integration.test.ts`, rolled back): the
  trigger refuses UPDATE and DELETE; a hard delete of the importer clears
  `imported_by` and keeps the row; the blob host and a one-language flag are
  refused by their CHECKs. **That last case failed on its first run** — see below.
- **Over HTTP with the real binary**, against `next dev` on 3300 and a one-hour
  local token (deleted afterwards): `history import` of the fourteen rows; the
  same file again → exit 2 naming ten rows and "4 more"; `--file -` with a
  wrapped object and five problems across two rows → one 400 listing all five;
  a padded ref shown in quotes and returned intact by `-o json`; `--flagged`,
  `--year 2024 --source zoho`, `--limit 5` then `--cursor 10`; `show` by #number,
  by historical number (refused before any request) and missing (404);
  `--source quickbooks` → 400 naming the two sources. `/api/meta` serves both
  vocabularies and `limits.history`.

### What checking it found

- **A CHECK that passed a one-language flag.** The first `history_flag_both_languages`
  was `(fr IS NULL AND en IS NULL) OR (fr ~ '\S' AND en ~ '\S')`. With `fr`
  NULL the second branch is `NULL AND true`, which is NULL, and a CHECK treats
  NULL as satisfied — so `('only English', NULL)` inserted. The owner-side test
  caught it on its first run; the branch now tests `IS NOT NULL` first.
- **`holds-covers-entities.test.ts` was satisfied by an import line.** It searched
  `footprint.ts` for a table's identifier anywhere in the code, and the file's
  `import { … } from '../schema'` names every table it uses — so removing the
  history count and keeping the import stayed green. It now requires the
  identifier as the argument of `.from()`. Finding #11's mechanism, a second time
  in this one file.
- **The seed hid its own failures.** It printed `e.message`, which Drizzle makes
  "Failed query: delete from billing.workspaces …"; the database's reason was on
  the `cause`. It prints the chain now. And its rebuild needed the history
  trigger added to the ones it disables, or the first import into the seeded
  workspace would have made it impossible to re-seed — confirmed both ways.
- **The local database was one shared migration behind** (`apps/issues` 0048,
  `platform.users.locale`), so every authenticated request 500'd. Not this
  phase's code; applied with `npm run db:migrate --workspace=issues`.
- **`vocabularies.test.ts` checked one CHECK per vocabulary.** `imported_via`
  restates `audit_via_check`'s two values on a second table; `alsoConstraints`
  covers it now.

## Phase 6, backend (ticket #95, 2026-09-18)

Built on `feat/billing-phase-6-be`. The release, the production checks and the
per-page browser walk are not in it: the first two need a human with the
Vercel project that does not exist yet and an npm OTP, and the third is the
frontend's ticket (#96).

### The seed: three workspaces, the mockup verified on the way in

`npm run db:seed:billing` (`scripts/seed.ts`) builds:

| Workspace | What | Why |
|---|---|---|
| `blackcode` | the mockup's two companies, eleven invoices and fourteen imported bills, read from `fixtures/mockup.json` | parity: it is the mockup, not something shaped like it |
| `demo-tenant` | one company, nothing else | the empty states, and the only state in which a cross-tenant leak is visible |
| `praxis-demo` | decision D-B7's shape: prices including VAT, an exempt line beside two rates, rounding on the total | the first customer's bill, which the mockup predates — in its own workspace so `blackcode` stays exactly the mockup |

At the end it reads every mockup invoice back through `getInvoice` — the app's
read path, derivations included — and compares number, subtotal, VAT, total,
reference, printed reference and printed account with the answers the mockup's
own code gave. **Any difference stops the seed**, listing each. The history rows
go in through `importHistory`, the real write door.

Deliberately absent, and said so in the seed's header: the mockup's four
**recurrences** (phase 4 is not built) and its fifteen **audit rows** (they name
mockup actors that are not accounts, and an append-only log is the last place
for invented rows — phase 1's decision, kept).

Two fixes to the seed itself: the owner is now the OLDEST account (`ORDER BY
id`); the first version's unordered `LIMIT 1` handed the seeded workspace to a
test account an integration suite had created, and the developer's own login
stopped being a member of it. And its error output prints the cause chain (phase
5).

### The tests phase 6 asked for

| File | What it holds the app to |
|---|---|
| `lib/derive/parity.test.ts` | every mockup invoice's totals, reference, printed reference, account and number, against the mockup's OWN answers (45 cases, no database) |
| `lib/invariants.test.ts` | DATA-MODEL §11's thirteen invariants as named groups; the pure ones always, the rest as `billing_app`. I9 is a tripwire (phase 4), I12 records a gap (below) |
| `lib/runtime.integration.test.ts` | three companies created at runtime and invoiced concurrently, each holding its own sequence, references and account; and an EMPTY tenant beside a full one, with the same company slug in both, reading nothing of the other's |
| `lib/db/schema-parity.test.ts` | `schema.ts` against `pg_attribute`: tables, columns, types and nullability, both directions. Cited by `schema.ts` since phase 1 and never written — see finding #24 in CLAUDE.md |

### The subject-parameter rule

`?company=` changes what a list is ABOUT, so an unknown one is refused:
`GET …/invoices`, `…/overview` and `…/history` answer 404 `company_not_found`
through `lib/api/company-filter.ts`, which also resolves a `#number`. Until now
all three answered an empty page, which reads as "no invoices" — verified before
and after with `bk`. `{ref}` and `{seq}` were already refused when unknown.

### What checking it found

- **I12 is half-built.** A sent invoice freezes its document half but carries
  no copy of its ISSUER: the company's legal name, address and IBAN are read as
  they are now. Editing a company's IBAN changes what its unpaid sent bills
  settle on — confirmed against the database by the KNOWN GAP case in
  `invariants.test.ts` — and a regenerated PDF would not match the recorded
  `pdf_sha256`. Belongs to #86, which wires the renderer: snapshot the issuer at
  send, render sent bills from it, and flip that case.
- **The 140-character budget was declared twice**, in `lib/limits.ts` and in
  `lib/qr/validate.ts`. The validator reads the limit now.
- **`totals.ts` cited the wrong file** for the inclusive-versus-exclusive VAT
  proof; `totals.test.ts` has it.
- Findings **#24, #25 and #26** in CLAUDE.md: the cited-tests guard resolving to
  another app's file, the help-tour regex that could not read two-space rows (it
  hid a real `bk books --help` drift, fixed), and this app's footprint guard
  satisfied by an import line (phase 5).
- **Only one mockup invoice exercises five-rappen VAT rounding** (BC-2026-0037,
  238.14 → 238.15): removing that rounding fails one parity case of 45. The
  rounding policies are covered in depth by `totals.test.ts`; the mockup is thin
  there, and that is a fact about the mockup.
- `apps/books/lib/db/schema-parity.test.ts` announces its skip with
  `console.warn`, which vitest drops — finding #12's mechanism. Not changed here
  (another app's test); billing's copy uses `integrationDescribe`.

### Verified on 2026-09-18

- `npm run db:seed:billing` against the local database: "11 invoices read back
  and equal to the mockup". With the mockup companies set to round on the total
  instead, it refused: `BC-2026-0037 VAT: this app 238.14, the mockup 238.15`.
- As `billing_app`: `invariants.test.ts` 21/21, `runtime.integration.test.ts`
  5/5, `schema-parity.test.ts` 3/3, and phase 5's suites unchanged.
- `bk billing invoice list|overview|history list --company nope` → 404, exit 5;
  `--company blackcode` lists; `--company 2` resolves the second company.

### Still owed at the end of phase 6's backend

- **The release** (`./devops/release.sh`, web → cli → web for every app), the
  deploy log's "applying Drizzle migrations", `bk app list` from a clean global
  install, and the north-star sequence against production. All need the
  `bc-billing` Vercel project, which does not exist.
- **The issuer snapshot** (I12), with #86.
- **Phase 4**: recurrence, the seed's four series, and I9 made real.
- **The per-page browser report** on all three tenants in FR and EN (#96).
- The five open questions in the changelog: P1, P2, P3, P11, P8.

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

Phase 2 (ticket #85) added these, on 2026-09-18:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/pdf/pdf.test.ts` | the QR module size computed from 45 mm | 1 case: the 46 × 46 measurement |
| the same | `setCreationDate(new Date())` | 1 case: the two-process byte comparison |
| the same | the receipt printing the additional-information heading | 2 cases: "never on the receipt" and "no heading whose value is absent" |
| the same | `hasPaymentPart` forced true | 2 cases: both USD ones — red because validation then refused the bill, which is the barrier between a USD invoice and a slip |

Phase 5 added these, on 2026-09-18:

| Guard | The mutation | What it said |
|---|---|---|
| `history.test.ts` | a JSON-number total accepted; a one-language flag accepted; the blob-host check case-sensitive; the in-batch duplicate check off | one case each, by name |
| `history.integration.test.ts` | `source_ref` trimmed on insert | the byte-for-byte case |
| the same | the race loser's unique violation not translated | the twenty-way race: raw constraint errors instead of the named 409 |
| the same | `uq_history_source_ref` dropped (owner) | the race: more than one row. The second-import case stayed GREEN, because the read before the insert still saw the rows — which is why the race case exists. Restored by deleting the duplicates with the trigger off in one transaction, recreating the index, and reading `pg_indexes` and `pg_trigger` back |
| the same | `GRANT UPDATE … TO billing_app` | "cannot UPDATE": the trigger's P0001 instead of the privilege's 42501. Revoked, `table_privileges` read back: `INSERT,SELECT` |
| `owner-guards.integration.test.ts` | `trg_history_read_only` dropped | the owner UPDATE and DELETE cases. Recreated, `pg_trigger` read back |
| the same | (not injected) | the one-language flag case failed on its FIRST run — a real CHECK bug, above |
| `vocabularies.test.ts` | `'sent'` added to `history_status_check`; `'cron'` to `history_imported_via_check` | the history-status triple; the ACTOR_VIA triple through `alsoConstraints` |
| `holds-covers-entities.test.ts` | the history count removed, the import kept | stayed GREEN — the guard's own defect, above. After the fix: red, naming `billing.history` |
| `cli-parity.test.ts` | `history show`'s annotation set to `none` | the route named as unreachable |
| `pagination_claim_test.go` | (not injected) | caught a REAL gap: the platform guide's list of paginating commands did not name `history list` |
| the seed | (not injected) | with a row in the seeded workspace, the old rebuild failed on the history trigger; confirmed through the new cause-chain output |

Phase 6 added these, on 2026-09-18:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/derive/parity.test.ts` | VAT not rounded to five rappen under `line_0_05` | 1 of 45: BC-2026-0037 — the only mockup invoice whose VAT is not already a multiple of 0.05 |
| the same | the QRR carry table's last two entries swapped | the seven QRR invoices' reference cases |
| the same | IBANs printed in blocks of five | all eleven account cases |
| the seed's read-back | the mockup companies rounding on the total | refused, naming BC-2026-0037's VAT |
| `lib/invariants.test.ts` | an invariant's group renamed out of the index; the QR budget typed as 141 again; a `total` column on the invoice mirror | the index case; both I11 cases; both I6 cases |
| `lib/runtime.integration.test.ts` | the history list unscoped; the company lookup unscoped; the QRR body without the company | the empty-tenant list case; the other-tenant address and filter cases; the three-company case (two companies sharing references) |
| `lib/db/schema-parity.test.ts` | `history.total` as `numeric(12,2)`; `imported_via` undeclared; `drive_path` declared `notNull` | the column case, each naming the column |
| `help_prose_table_test.go`, generalised | `invite … accept` invented in billing's tour; `create` dropped from its workspace row | "names accept, which the binary does not carry"; "has create — the table never names it" |
| `guide_test.go` | three invoice statuses, then the three history statuses, restated in `07-pitfalls.md` | named the INVOICE_STATUSES and then the HISTORY_STATUSES vocabulary |
| `cited-tests-exist.test.ts`, tightened | (not injected) | five REAL dead citations, above |

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

Ticket #86 added these, on 2026-09-18:

| Guard | The mutation | What it said |
|---|---|---|
| `invoice_issuer_iff_issued` (catalog) | the constraint dropped from the local database | I12's "the database holds it": the forgetful `SET status = 'sent'` succeeded. Left a sent row with no copy, repaired before the constraint went back; `pg_constraint` re-read |
| G2's `issuer` line (catalog) | the function replaced without it | the same case: expected `P0001`, got no error. Restored from `pg_get_functiondef`, `pg_proc` re-read |
| `lib/delivery/send.integration.test.ts` | `issuer` dropped from send's UPDATE; the read path ignoring the stored copy; mark-sent's validation removed; the write door's character check off | 23514 from the database on every send; "still is after the company is edited" (and I12 with it); the mark-sent case; the write-door case |
| `lib/invariants.test.ts` I12 | a void from draft taking no copy | three cases: every void-from-draft in the file is refused by the CHECK |
| `lib/delivery/document.test.ts` | the seam's validation removed; then the renderer's too; the void checks; CRLF in the seam | the 422 case (the renderer still threw, as a bare error with no code); plus `pdf.test.ts`' blank-account case; each void case; "character for character" |
| `lib/issuer.test.ts` | `rounding` out of `ISSUER_FIELDS`; `footer_en` out of the CHECK; `billingCompany` imported by the renderer; the same in a comment; the scan pointed at `lib/email` | three cases; one; one; **green, correctly**; "found files to scan" |
| `lib/pdf/font-tracing.test.ts` | the include key narrowed to the PDF route; the glob changed to `*.otf`; the target file renamed | named the other rendering routes; the glob case; the vacuous-pass case |
| `lib/db/queries/frozen-fields.test.ts` | the `issuer` line removed from 0011 | "the trigger freezes the delivery evidence" |
| the seed's read-back | `qrSafeMessage` made a no-op | refused, naming each bill and U+2014 |
| `raw_response_test.go` (new) | the raw branch moved above the error handling; the body trimmed | a JSON 422 came back as content; the hostile bytes differed |
| `guide_test.go` | the three reference types restated in the new topic | named `REFERENCE_TYPES`, line 119 |

## Still owed at the end of phase 3

- ~~Phase 2, which turns `send` on~~ — done 2026-09-18, ticket #86.
- **A real email to a real inbox**, with the attachment's sha256 compared to
  `pdf_sha256`. Needs a Resend key; it is the headline done-when of
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
