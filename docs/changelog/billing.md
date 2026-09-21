# b/billing — changelog

This file is an **agent** surface. It is merged into `bk changelog` and
`GET /api/changelog` from `packages/platform-agent/src/changelog.ts`, newest
entry first, so an agent can keep an integration current without reading the
repo. Say what changed, whether it is breaking, and how a client should adapt.

## 2026-09-21 — Workspace administration, invitation acceptance, and a default workspace

**Not breaking** for existing calls. New routes and commands, one changed
response, and one refusal that used to be a 500.

### New commands (and their routes)

- `bk billing workspace edit --name "…"` — `PATCH /api/workspaces/{ws}`. Name
  only: `--slug` is refused with **400 `slug_immutable`** (the slug is in every
  URN this app has printed).
- `bk billing workspace transfer --to <user_id>` — `POST …/transfer`. The target
  must already be a member (400 `not_a_member`). Pass the numeric id from
  `bk billing member list`.
- `bk billing workspace delete <slug> --confirm <slug>` — `DELETE
  /api/workspaces/{ws}`. **Only for a workspace nothing was ever issued from.**
  A workspace holding any company, invoice, recurring series, imported bill or
  audit row answers **409 `workspace_retained`** with the counts and a
  suggestion: those records carry a ten-year retention duty (art. 958f CO) and
  the database refuses the delete for everybody. Do not retry it.
- `bk billing member remove <user_id>` — `DELETE …/members/{userId}`. The owner
  removes anyone but themselves; **a member may remove themselves — that is how
  you leave** (there is no `member leave` here). The owner gets 400
  `cannot_remove_owner`: transfer first.
- `bk billing invite candidates` — `GET …/invite-candidates` (owner only).
- `bk billing invite show | accept | decline <token>` and `bk billing invite
  pending` — `GET /api/invitations/{token}`, `POST /api/invitations/accept`,
  `POST /api/invitations/decline`, `GET /api/me/pending-invitations`.
  **Invitations can be accepted now**, in the browser at the link or with `bk`.
  You must be signed in as the address the invitation was sent to.

### Changed

- `POST …/invitations` **sends the invitation email** and reports the real
  result in `email_sent` (it was always `false`); it also returns
  `invitee_has_account`. `accept_url` is still returned, and points at this
  app's own `/invitations/{token}` page.
- `DELETE /api/me/footprint` no longer 500s for somebody who has issued an
  invoice. A sole-owned workspace holding retained records is reported in
  `footprint.blocked_by` with `reason: "retention"` and a `detail`, and the
  delete answers **409 `retention_hold`** (or `owner_with_members` when other
  people are in a workspace too). Only workspaces nothing was issued from are in
  `will_delete`.
- Opening the dashboard with no billing workspace — typically after signing in
  on another blackcode app — now creates one and lands you in it (or opens your
  pending invitation), instead of a "No workspace yet" screen.

- Web only, from the production audit: the invoice list with no company yet
  says "Add a company first" and links there (it used to offer a create form
  with nothing to pick); the landing page no longer borrows b/books' ledger
  wording.

## 2026-09-21 — The real web UI replaces the test scaffold

Every page is redesigned to the platform's standard: a left sidebar with the
workspace switcher, a company switcher in the header (`?company=<slug>`), a
landing page, sign in / sign up / forgot password, account settings (profile,
password, API tokens) and workspace settings (members, invitations). Same
functionality as before. A Google sign-in the whitelist refuses now lands on
a `/blocked` page instead of a 404. **No route, command or response changed**, so nothing
changes for an agent or an integration.

**For browser tests that drove the scaffold:** the `data-testid`s were kept on
the equivalent elements, except these:

- `filter-company` is gone — use the header's `company-switcher`.
- `input-lines` (one textarea) is now a line editor: `line-row-<n>`,
  `line-description-<n>`, … saved with `edit-lines`.
- `send` opens a dialog; its submit is `send-submit`.
- a series' `generate` opens a dialog holding `input-period`, `input-message`
  and the submit.

## 2026-09-18 — A minimal web UI, for testing in a browser

Bare pages under `/dashboard/<workspace>/`: overview, companies, invoices (with
every lifecycle action, the PDF and the QR payload), recurring series and
imported history. They call the same routes `bk` does, so nothing changes for an
agent or an integration: **no route, command or response changed.** The real
screens replace these. The phase-0 workspace form now shows the server's own
error sentence instead of only a status code.

## 2026-09-18 — Finite recurring series: `bk billing recurrence`

### New

- **`bk billing recurrence`** — a series bills the same invoice on a schedule, a
  fixed number of times, then stops. Seven commands: `list [--due] [--company]
  [--status]`, `show`, `create`, `edit`, `pause`, `resume`, `generate`.
  Routes: `GET/POST /api/workspaces/{ws}/recurrences`,
  `GET/PATCH …/recurrences/{seq}`, `POST …/recurrences/{seq}/generate`.
- **Nothing schedules anything.** `recurrence list --due` names the active series
  whose next date has arrived (today in Zurich) and the period to generate; an
  agent calls `generate` with that period. An occurrence is an ordinary DRAFT
  with the next number in its company's sequence. Generating is not sending.
- **`create` requires `occurrences_total`** (`--occurrences`); there is no
  default and no open-ended series. A template issued in the start date's
  period counts as the first occurrence.
- **`generate` requires `period`** and never infers it. Refusals an agent should
  handle: `409 already_generated` (the period has a live invoice — the message
  and suggestion name it; retrying is safe), `409 period_not_expected` (the
  suggestion is the command with the right period), `409 series_paused`,
  `409 series_completed`, `409 no_template`, `400 invalid_period`. It honours
  `Idempotency-Key`: the same key and body return the same invoice.
- **A voided occurrence frees its period**: generating it again is a replacement
  (`"replacement": true`), and the counter does not move.
- Every invoice gains **`recurrence`** (the series' #number, or null) and
  **`occurrence_period`**. `bk billing invoice show` prints the series.
- `GET …/audit?subject=recurrence:<seq>` (`bk billing audit list --subject
  recurrence:3`): a series' own history — counter, pauses, replacements.
- `bk meta` serves `recurrence_frequencies`, `recurrence_statuses` and
  `limits.recurrence`.
- `bk guide billing/recurrence`.

### Not public

The recurrence routes are **not** in `integration.routes`: the plan's public
surface does not include them, and adding one is a decision for the
integration surface, not a side effect of shipping the feature.

### Not breaking

Additions only. `recurrence` and `occurrence_period` are refused by
`PATCH …/invoices/{ref}` as `field_not_editable`.

## 2026-09-18 — The invoice PDF and its QR payload are served; `send` is on; a sent invoice keeps its own copy of its issuer

### New

- **`bk billing invoice pdf <ref> [--out FILE|-] [--force]`** —
  `GET /api/workspaces/{ws}/invoices/{ref}/pdf`, `application/pdf`. The A4
  invoice in the document's language with the QR-bill payment part (CHF and
  EUR). Rendered on demand and byte-stable. The response carries
  `X-Billing-Pdf-Sha256` (these bytes), `X-Billing-Sent-Pdf-Sha256` (the bytes
  `send` emailed, when it did) and `X-Billing-Invoice-Status`; the command
  prints whether the two match. It refuses to overwrite a file without `--force`
  and refuses to write a PDF to a terminal.
- **`bk billing invoice qr <ref>`** — `GET …/invoices/{ref}/qr`, `text/plain`.
  The Swiss QR Code payload exactly as the PDF encodes it: LF line endings, no
  trailing newline, elements identified by line number. Do not trim it.
- **`GET …/invoices/{ref}` and every invoice in a list gain two fields.**
  `derived`: `reference` (with its check digits), `reference_formatted`,
  `account`, `account_formatted`, `creditor`, `has_payment_part`, and
  `problems` — what would make the PDF refuse, each with a `code`, `message` and
  `suggestion`. `issuer`: the issuing company as it was when the invoice left
  draft; `null` on a draft. `bk billing invoice show` prints both.
- Both new routes are **public** (`/api/meta` → `integration.routes`), so
  `contract_version` changes.
- **`bk guide billing/references-and-qr`.**

### Changed — read this if you call `send` or `mark-sent`

- **`send` works.** It no longer answers 501 `document_renderer_not_built`; that
  code is gone from every path, and a client switching on it can drop the branch.
- **`send` and `mark-sent` can now answer 422 `payment_part_invalid`**: the
  record would make a payment part a bank rejects (a company address with no
  town, a QR reference with no QR-IBAN, a character the standard does not carry).
  Nothing is written or mailed, and the message names every problem.
  **`mark-sent` did not validate before and does now** — once sent, the document
  is frozen, so an invoice that could not render at that moment never could.
  **How to adapt:** read `derived.problems` first, or fetch the PDF as a dry run;
  both refuse for exactly the reasons a send would.
- **A payment message containing a character a QR code cannot carry is refused
  when it is written**: 400 `message_character_not_allowed`, on create and on
  edit, naming the character and its position. Typographic dashes and quotes are
  the usual cause. Nothing is substituted for you. Existing drafts are not
  touched; `derived.problems` names any that carry one.
- **A sent invoice renders from its own copy of its company, forever.**
  Editing a company's IBAN, legal name, address, footers or rounding policy
  changes its drafts and its future bills, and no invoice that already left
  draft: not its account, not its creditor block, not its **totals**. This
  closes the gap the previous entry stated. If a sent bill names the wrong
  account, void it and reissue.
- **A void invoice's PDF carries no payment part** and is stamped void, and
  `…/qr` answers 409 `no_payment_part` for it: a cancelled bill must not be
  payable.

### Not breaking

Every existing field keeps its name and type. `issuer` and `derived` are
additions; a PATCH that sends either back is refused as `field_not_editable`,
like `number`.

### Still not done

One bill of each shape through SIX's validation portal, and a scan by two
banking apps. `bk billing invoice qr` exists so that the first is a paste. No
real invoice should go out before both.

## 2026-09-18 — An unknown `--company` is refused; the pitfalls guide; what still blocks a real invoice

### Breaking for one request, which was already wrong

`GET /api/workspaces/{ws}/invoices`, `…/overview` and `…/history` with a
`company` that is not in this workspace now answer **404 `company_not_found`**
instead of an empty page. `bk billing invoice list --company x`,
`bk billing overview --company x` and `bk billing history list --company x`
exit non-zero with a hint. An empty answer read as "that company has no
invoices" when it meant "there is no such company" — a typo in a slug, or a
slug from another workspace. `company` also accepts a company's `#number` now.

**How to adapt:** a caller that filtered by a company it had not checked now
gets a 404 to handle. `GET …/invoices` is a public route, so
`contract_version` changes with its published purpose.

### New

`bk guide billing/pitfalls` — the mistakes specific to this app: a number is
permanent, null VAT is not zero, EUR never carries a QR reference, paid is an
assertion, nothing is scheduled, currencies are never summed together, and
`--company` is the scope at which a wrong answer is a wrong IBAN.

### Known gap, stated so nobody relies on the opposite

**A sent invoice carries no copy of its issuer.** Its document half (client,
lines, currency, reference) is frozen at send; the issuing company's legal
name, address and IBAN are read from the company as it is NOW. Editing a
company's bank details therefore changes the account its unpaid bills point to,
and a regenerated PDF would no longer match the `pdf_sha256` recorded when it
was sent. The fix — a snapshot taken at send — lands with the PDF routes.
Until then, change a company's IBAN only when none of its sent bills is unpaid.

### What still blocks the first real invoice

The app is usable, and a green suite does not mean a real bill can go out. Five
questions are open, none of them ours to answer:

- **P1** — the real second issuing company.
- **P2** — blackcode's real UID and IBANs. Every IBAN and UID in the seed is a
  placeholder.
- **P3** — the VAT rates, verified against the ESTV. 8.1 is the mockup's
  unverified figure.
- **P11** — the QR reference body scheme, agreed with the bank. Changing it
  after real bills are out means two schemes in the wild.
- **P8** — the rounding rule, confirmed by the fiduciary.

And one deviation from the brief, recorded rather than hidden: invoices are
emailed through **Resend** from the platform's own sender with `Reply-To` set to
the company, not through a Google mailbox — the platform holds no Google
credential. A customer deployment uses its own Resend account and domain.

## 2026-09-18 — Imported history: the bills from before this app, as a read-only archive

**Not breaking. New commands, new routes, two new vocabularies, one new limit
block — so `contract_version` changes.** Re-read `bk meta --app-server billing`.

### What you can do now

- `bk billing history import --file rows.json` (or `--file -` for stdin) —
  `POST /api/workspaces/{ws}/history` with `{"rows": [...]}`. Map each bill from
  a Zoho Books or Invoicely export yourself; the app stores and shows, and does
  no mapping. `bk billing history import --help` has the row shape.
- `bk billing history list` — `GET …/history`, newest bill first, filters
  `--source --currency --year --company --flagged`, paginated with
  `--limit`/`--cursor` like the other lists.
- `bk billing history show <#>` — `GET …/history/{seq}`.

### What to expect

- **All or nothing.** Every problem in the batch comes back in one 400
  (`invalid_history_rows`), each naming its row and field, and nothing is
  written. A row whose source and source ref are already archived refuses the
  whole import with a **409 `already_imported`** naming its `#number` — it is not
  skipped. Importing the same file twice changes nothing and tells you which rows
  were there.
- **`total` is a string** (`"3240.00"`); a JSON number is refused. **`source_ref`
  is stored verbatim**, whitespace included. **A key the row shape does not have
  is refused.** `import_flag` is `{fr, en}` — both or neither — and is never
  cleared. `drive_path` is a path or id on Google Drive, or `null` when the export
  had no PDF; a link into the platform's own file store is refused.
- **Rows are addressed by `#number` only.** The historical `number` is not
  unique and is not accepted as an address.
- **A row is read-only.** There is no edit or delete, and the database refuses
  both.
- **The archive is not a receivable.** An `unpaid` archived bill is not in
  `bk billing overview`.

`bk meta --app-server billing` now serves `vocabulary.history_sources`,
`vocabulary.history_statuses` and `limits.history` (the rows-per-import ceiling
and the field lengths).

### Also in this release

A hard `DELETE FROM platform.users` of a person who had written a billing audit
row used to fail on the audit log's append-only trigger. It now clears the
author, as the column always declared. Account close is a soft delete and was
never affected.

## 2026-09-17 — `contract_version` is served, and the audit log stops recording edits that did not happen

**Not breaking.** Two fixes to things an integration may already rely on.

### `GET /api/meta` now serves `contract_version`

The integration conventions have said since the public routes were declared:
*poll `contract_version` from `/api/meta` to know whether anything moved.* This
app never served it. It does now, at the top level for an anonymous caller and
under `apps.billing` for `bk meta`: a 16-character hash of the declared contract
(vocabularies, limits, public routes and conventions) that changes if and only if
that contract does.

**How to adapt:** store the value; when it differs from the one you stored,
re-read `/api/meta` and `/api/changelog`. If you polled for it before and got
nothing, that was this bug, not your client.

### The audit log no longer records decimal changes nobody made

Replacing an invoice's lines logged a `field_changed` row for `items[i].qty`
on every unchanged line, because the database returns `1.000` and a request
sends `1`. The same would have happened for a unit price (`100` / `100.00`) and a
VAT rate (`8.1` / `8.10`), on lines and on the invoice. Decimal fields are now
compared as numbers.

**How to adapt:** a feed consumer that saw `qty` changes with equal values before
and after can ignore them; rows already written are permanent, like every audit
row.
## 2026-09-17 — Payment references are checked against the standard

**Breaking for one kind of request, which never produced a valid bill.** No
route, command or field is new; what changes is what a create or an edit
accepts.

### What is refused now

- **A creditor reference (SCOR) body over 21 characters.** 25 is the limit for
  the whole reference, `RF` and its two check digits included; the body was
  wrongly allowed 25. `400 invalid_creditor_reference`.
- **A SCOR body with anything but letters and digits** (`INV-7`). Same code.
- **A QR reference (QRR) body of all zeros.** `400 invalid_qr_reference`.
- **An invoice whose number cannot form a SCOR reference** — more than 21
  letters and digits once punctuation is removed. It used to be truncated, which
  could give two invoices the same reference; it is refused now with
  `409 number_cannot_form_reference`, and **no number is consumed**. Supply
  `ref_body`, shorten the company's `number_format`, or use `NON`.
- **A reference edit on a draft that leaves an invalid pair**: switching to `NON`
  while a body remains (`400 non_takes_no_reference`, send `ref_body: null` with
  it), or to `SCOR`/`QRR` with no body (`400 reference_body_required`).

The database enforces the first three as well, for every writer.

### How a client should adapt

Send `ref_body` only when your bank or client dictates the reference, as 1–21
letters and digits for SCOR or 26 digits for QRR — never the check digits.
`bk meta --app-server billing` serves both limits under `limits.reference`.

### Also

The references are now computed, not only stored (`RF18…`, the 27th QRR digit),
in code that nothing calls yet: the PDF and the QR payload arrive with the rest of
phase 2.

## 2026-09-17 — Sending, paid and void

**Not breaking** for any client that reads invoices by field name. The invoice
object gains three fields; four routes and four commands are new. One phase-1
refusal changes its body (the 403 fix below), and one field that was editable on
a sent invoice no longer is.

### What you can do now

    bk billing invoice send <ref> --to client@example.ch [--cc …] [--subject …] [--body-file …]
    bk billing invoice mark-sent <ref>
    bk billing invoice paid <ref> --date 2026-10-02
    bk billing invoice void <ref> --reason "…" --confirm <printed number>

All four take `--idempotency-key`. `bk guide billing/sending-and-status` is the
topic. All four routes are **public** (`POST …/invoices/{ref}/send|mark-sent|paid|void`).

### `send` refuses today, and says so before doing anything

The PDF and the QR-bill payload are phase 2 and are not built. Until they are,
every send answers **501 `document_renderer_not_built`** after its own checks and
before anything is rendered, mailed or written. Deliver the bill another way and
record it with `bk billing invoice mark-sent`. The rest of the send path — the
email package, the row lock, the transport's idempotency key, the delivery
record — is built and was exercised end to end against a fixture renderer.

### What a client has to get right

1. **`sent_message_id` null on a sent invoice means it was NOT emailed by this
   app** (`mark-sent`). Do not read a null as "not recorded yet".
2. **`send` checks email first**: a deployment that cannot deliver answers
   `503 email_not_configured` and nothing is read or written.
3. **`email_delivery_failed` (502) changed nothing**; the invoice is still a
   draft. **`delivered_not_recorded` (500) means the mail WENT** — do not send
   again; `mark-sent` it.
4. **`paid` is an assertion.** `paid_date` is required, `YYYY-MM-DD`, not in the
   future (Zurich calendar), and only a sent invoice can be paid.
5. **`void` needs a reason** (`reason_fr` and/or `reason_en`; one serves both).
   Send `confirm` equal to the printed number and the server refuses a void
   aimed at the wrong invoice with 409 `confirm_mismatch`. `bk` always sends it
   and requires `--confirm` even with `--yes`.
6. **Send `Idempotency-Key` on all four.** A retry then replays the first answer
   (`Idempotent-Replayed: true`) instead of meeting a 409 about its own success,
   and for `send`, instead of a second bill in the client's inbox.

### Changed

- **`language` and the invoice-level `vat_rate` are frozen once an invoice is
  sent**, in the database as well as the app. `language` decides every word on
  the document; it had been editable after send by omission. `sent_at`,
  `sent_message_id` and `pdf_sha256` are frozen once written and refused by
  `PATCH` on any invoice.
- **403 refusals now carry the right fields.** Phase 1's owner-only IBAN refusal
  answered `{ error: "<code>", code: "<suggestion>", suggestion: "<sentence>" }`.
  It is `{ code, error, suggestion }` in the right places now. If you matched on
  the old scrambled `code`, match on `iban_owner_only`.
- **`bk billing invoice create` now takes `--idempotency-key`.** Its help used to
  say the command sent a key on its own; it never did. Without the flag, every
  run creates a new invoice.
- `GET /api/meta` serves `limits.delivery` (subject, body, copies, void reason).

## 2026-09-17 — Companies and invoices

**Not breaking.** New tables, new routes, new commands. Nothing that worked
before behaves differently.

### What you can do now

    bk billing company create --slug acme-sa --name "Acme SA" --vat-registered
    bk billing company list | show | edit | retire
    bk billing invoice create --company acme-sa \
      --client-name "Junod SA" --item "Consulting|12|days|132.50|8.1"
    bk billing invoice list | show | edit
    bk billing invoice line set <ref> --item "…"
    bk billing audit list [--subject invoice:7] [--since <seq>]
    bk billing overview

`bk guide billing/companies-and-numbering` and `bk guide billing/invoices` are
the topics. `bk meta --app-server billing` carries the vocabularies and limits.

### Six things a client has to get right

1. **`<ref>` is the #number or the printed number.** `invoice show 7` and
   `invoice show BC-2026-0007` reach the same document. They are different
   numbers and both are real: the first is this app's address space, the second
   is what the client sees and what goes in the payment reference.

2. **Money and dates are strings.** `"1590.00"`, `"2026-09-17"`. Never a JSON
   number: a float64 is silently wrong in the last rappen, and an invoice wrong
   in the last rappen does not match the payment slip attached to it.

3. **A line's VAT rate has three states, not two.** Unset means the line carries
   **no VAT** — an exempt act, or a company that is not registered. `"0"` is a
   real rate (export, reverse charge) and prints as 0%. They are different facts
   on a VAT return, and one invoice may mix them.

4. **Totals are derived and never stored.** They come from the lines, whether the
   prices include VAT, and the issuing company's rounding policy. Changing a
   company's `rounding` therefore changes every total it has ever produced.

5. **`POST …/invoices` needs an `Idempotency-Key`.** The number is gapless and
   the row is never deleted, so an unguarded retry mints a **second real
   invoice** that can only be voided. The same key with the same body replays and
   sets `Idempotent-Replayed: true`; the same key with a different body is
   refused with `422`. `bk` sends one per invocation automatically.

6. **`GET …/audit?since=<seq>` is the event feed, and the flag changes the
   order.** Without it, newest first. With it, ascending from the cursor —
   because a descending feed would make a poller re-read the same page forever.
   Nothing can appear below a cursor you have passed.

### A declared public surface — and it amends a platform rule

**This is new for this platform and deliberate.** The standing rule is that the
HTTP API is private plumbing and `bk` is its only supported client. b/billing
declares a **small public subset** so an outside system's backend can drive it
directly (decision D-B5):

    POST   /api/workspaces/{ws}/invoices
    GET    /api/workspaces/{ws}/invoices
    GET    /api/workspaces/{ws}/invoices/{ref}
    PATCH  /api/workspaces/{ws}/invoices/{ref}
    GET    /api/workspaces/{ws}/companies
    GET    /api/workspaces/{ws}/audit

Read it from `/api/meta` under `apps.billing.integration`, which also carries the
conventions. Those routes change **only additively**; a breaking change is a new
path, or an entry here marked breaking at least thirty days ahead. Poll
`contract_version` to know whether anything moved.

**Every other route under `/api` is exactly as private as before** and carries no
stability promise.

### Correlating with your own records

`external_ref` (unique per workspace, filterable) and `metadata` (a flat map of
string to string, 50 keys) on companies and invoices. Both stay writable after an
invoice is sent, because they are your bookkeeping rather than the document.

`expected_total` on a create is worth sending from a script: if it disagrees with
what we derive, the invoice is refused with `409` and **no number is allocated**,
and the message names the company's rounding policy and its price mode — which
is what explains almost every disagreement between two billing systems.

### What is refused, and why

- **A sent invoice's document half is frozen**: amounts, lines, client, currency,
  reference, issue date. The refusal names the field. Editable after sending:
  the payment message, the due date, `external_ref`, `metadata`. A correction to
  anything else is a void plus a reissue.
- **The number, the issuer and the `#number` can never change.**
- **Nothing is ever deleted.** No `DELETE` route, no `bk billing invoice delete`,
  and the database refuses it in two independent ways. Art. 958f CO, ten-year
  retention.
- **A QR reference needs the company to have a QR-IBAN**, and is CHF only.
- **A company that is not VAT-registered** may carry no rate on any line.

### Still to come

The payment reference, the QR payload and the PDF; then sending, marking paid
and voiding. `bk billing invoice send` and `bk billing invoice pdf` do not exist
yet.

## 2026-09-17 — b/billing exists: the app is registered, migrated and answering

**Not breaking.** A new app. Nothing that worked before behaves differently.

`billing` is registered in `platform.apps` and serves at
`https://billing.blackcode.ch`. It owns its own tenancy and nothing else yet.

**What you can do today**

    bk login --server https://billing.blackcode.ch
    bk billing workspace list
    bk billing workspace create --name "Acme SA"
    bk billing workspace use <slug>
    bk billing member list
    bk billing invite send --email someone@example.com
    bk billing invite list
    bk billing invite revoke <id>

`bk guide billing` is the topic; `bk meta --app-server billing` carries the
vocabularies and limits.

**What you cannot do yet, and should not code against**

There are no companies, no invoices, no line items and no audit log. If you are
looking for `bk billing invoice`, it does not exist and you have not mistyped
it. Those arrive in phase 1, with their routes and commands in the same change,
and they get their own entry here.

**Two behaviours worth knowing now**

- **`bk billing workspace use` is scoped to this app.** It does not move
  `bk issues`, `bk sales` or `bk books`. Two apps' workspace tables have
  overlapping ids, so one shared setting would mean selecting here silently
  retargeted the others.
- **An invitation cannot be accepted yet.** `invite send` records the offer and
  returns its link; no route redeems it. `invite list` and `invite revoke` work.
  Until the accept flow lands, a workspace somebody creates is theirs alone.

**Deliberately absent, and permanently**

`bk billing trash`, `bk billing label`, `bk billing upload`,
`bk billing storage`, and `workspace delete`. An invoice is voided with a
reason, never binned — the void is a record and the number stays consumed — so
there is no soft-deleted state to list and no purge path to expose. Art. 958f CO
imposes a ten-year retention duty on invoices, and a workspace holds them.

**Assumptions this app ships with**

Nine of the mockup's open questions were answered provisionally so code could be
written, each recoverable at a stated cost, and they are in
`docs/billing-app-plan/README.md`. Five remain open and gate the first real
invoice: a real second legal entity, blackcode's real UID and IBANs, the
ESTV-verified VAT rates, and the QRR reference scheme agreed with the bank.

**One recorded deviation.** The brief asked for invoices sent from Gmail. They
will be sent through Resend, on the platform's verified domain, because there is
no Google credential anywhere on this platform and acquiring one to send mail is
a security surface the platform does not have. Decision D-B3.
