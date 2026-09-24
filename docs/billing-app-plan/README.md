# b/billing build plan: the seven milestones

How b/billing gets built in this repo as `apps/billing`.

Read this first, then the milestone doc you are working on. One doc per milestone
sits beside this file.

Every milestone doc opens with the same three bullets — **the problem**, **what
this phase does**, **the expected result** — and then carries everything needed
to implement it without asking anyone.

| # | Milestone | What exists when it is done |
|---|---|---|
| 0 | [Register the app](phase-0-register-the-app.md) | An empty `apps/billing` that builds, deploys, and answers `bk billing workspace list` |
| 1 | [Companies and invoices](phase-1-companies-and-invoices.md) | Issuing companies, gapless invoice numbers, line items, the audit log, five screens |
| 2 | [References, QR and PDF](phase-2-references-qr-and-pdf.md) | A spec-compliant QR-bill PDF you can hand to a bank |
| 3 | [Lifecycle and delivery](phase-3-lifecycle-and-delivery.md) | draft → sent → paid, void with a reason, the invoice emailed with its PDF attached |
| 4 | [Recurrence](phase-4-recurrence.md) | Finite series an agent generates; no scheduler in the app |
| 5 | [Imported history](phase-5-imported-history.md) | The Zoho and Invoicely years, browsable, flagged where ambiguous |
| 6 | [Seed and production](phase-6-seed-and-production.md) | Mockup parity proven to the rappen, then live at `billing.blackcode.ch` |

Two reference docs sit beside the milestones and are read from several of them:

- **[`qr-bill.md`](qr-bill.md)** — the Swiss QR-bill rules that bind this app:
  version timeline, the combination matrix, the check-digit vectors, the
  geometry, and how a bill gets validated before a real one goes out. Read it
  before phase 2.
- **[`local-database.md`](local-database.md)** — the dockerised Postgres this
  repo develops against, and the exact commands that provision `billing` in it.
  Read it before phase 0.

Two decision docs, added 2026-09-16 after the requirement that b/billing also
serve a second company as a standalone service, "like Stripe":

- **[`integration-surface.md`](integration-surface.md)** — decision D-B5: a
  declared public subset of routes, idempotency keys, external references and
  metadata, the audit log as an event feed, identity from environment. Its
  items are threaded into phases 0 to 4 where they are cheap; the reasoning
  lives there.
- **[`standalone-deployment.md`](standalone-deployment.md)** — decision D-B6:
  the customer's product as a separate, rebranded repository generated from a
  tag of this one by an extraction script, on a database bootstrapped with no
  other app in it. The platform bootstrap it needs is platform work and can run
  beside phases 1 to 5.

## What b/billing is, in three lines

Swiss QR-bill invoicing for any number of issuing companies. It turns a sold
thing into a legally payable bill with a spec-compliant payment part, tracks it
through a deliberately simple lifecycle, and keeps an append-only record of every
change. It holds no intelligence of its own: agents run outside it and drive it
through `bk billing`.

It is **not** a client registry (b/clients), a product catalogue (b/sales), an
accounting or reconciliation tool (b/books), or a tax-rate authority (b/tax).
`paid` is an assertion, never a computation.

## Where the source material lives

This plan is derived from a finished static HTML mockup in a **separate repo**,
`b-mockups`, under `bbilling/`. That mockup is the specification. Where this plan
and the mockup disagree, the mockup wins — the same way
[`books-app-plan/`](../books-app-plan/README.md) treats `bbooks/`.

| In the `b-mockups` repo, under `bbilling/` | What it gives you |
|---|---|
| `BRIEF.md` | The original scope, captured from Andrea. Its "Design principle" section is the app's constitution: the agent is the logic layer, the app holds legible data. |
| `dev-handoff/DATA-MODEL.md` | Every entity the mockup implies, and **the 13 invariants (§11) you must never break.** The single most valuable file in the package. |
| `dev-handoff/SCOPE.md` | v1 vs later, and the explicit non-goals. |
| `dev-handoff/ARCHITECTURE.md` | The borrowed-data pattern, which is why this app is small. |
| `dev-handoff/OPEN-DECISIONS.md` | 13 resolved, 14 pending. The authoritative settled-vs-pending list. |
| `research/QR-BILL-TECHNICAL-SPEC.md` | An implementation-ready extraction of SIX IG v2.4: the full 34-line payload table, both check-digit algorithms with verified vectors, the geometry in mm. **Read it fully before touching payments.** §6 is the build checklist. |
| `research/ig-qr-bill-v2.4-en.pdf` | The official 70-page source. |
| `assets/billing-data.js` | The reference implementation. Every derivation in this plan exists there as working code, and its header comments are part of the spec. |
| `_screenshots/` | Six PNGs: what each screen looks like finished. |

Run the mockup from the `b-mockups` root and open
`http://localhost:8734/bbilling/index.html`. **Do not modify it.** Parity with it
is the acceptance test for phases 1 to 5.

`WORKSPACE-MODEL.md` at that repo's root is the tenant shape all the b/ apps were
given on 2026-09-07. It mirrors this platform's real model, so it is confirmation
rather than instruction — but §10's list of tenancy bugs, found by looking at
pages rather than at diffs, is worth reading once before phase 1.

## The one rule above all others

**This app sends real payment slips to real clients.** A wrong IBAN, a bad check
digit, a broken payload or a hole in the invoice sequence is not a UI bug — it is
money arriving at the wrong place, or a bookkeeping violation. When anything
about payments, references, VAT or numbering is ambiguous: **stop and ask
Andrea** rather than guessing a plausible-looking value. Same standing rule as
b/books.

Gaps in the mockup's sample **data** are different: note the pattern and move on.

## The shape of the app

Every milestone adds to these same four layers. The diagram in each milestone doc
is this picture with that phase's files filled in.

```
  humans ──▶ UI  ─┐
                  ├──▶ routes ──▶ queries ──▶ database
  agents ──▶ CLI ─┘

┌─ UI ────────────────────────────────────────────────────────
│  components/**       forms and listings. writes go through
│  lib/client.ts       the only fetch in the app
│  lib/mutations.ts    the only place a write is sent from
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  cli/internal/commands/billing/**   one command per route
│  cli/internal/client/billing.go     the wire types
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  app/api/workspaces/[ws]/**   thin. auth, validate, shape.
│  lib/derive/**                pure maths, never stored
│  lib/qr/**                    payload, references, validation
│  lib/pdf/**                   the A4 page and the payment part
│  lib/db/queries/**            the ONLY place that touches SQL
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  lib/db/schema.ts        the tables, in the billing schema
│  lib/db/migrations/**    tables, guards, grants
└─────────────────────────────────────────────────────────────
```

Two rules the picture encodes:

**UI and CLI are parallel consumers of the same routes.** Never two
implementations of the same logic, one for humans and one for agents. This app
has full write parity in the browser, which makes the rule sharper rather than
looser: the form and the command hit the same route, or one of them is wrong.

**Nothing skips a layer.** A component never calls the database, a route never
holds business logic, and a derivation never writes.

## The plan in one table

Plain terms. This is the version to read first, and the version to show anyone
who is not building the backend.

| Milestone | Data (what we store) | Business logic (what the code works out) | UI (what the frontend builds) |
|---|---|---|---|
| **[0. Register the app](phase-0-register-the-app.md)** | • Nothing about invoicing yet.<br>• Only the tables every app on this platform has: workspaces, who is in them, pending invitations, a number counter.<br>• A Postgres role of its own, and a row in the app address book. | • Nothing of its own.<br>• It borrows the shared request layer: sign-in, tokens, error logging, version headers.<br>• Everything here is checklist, not invention. | • The login page and an empty dashboard.<br>• Both copied from the scaffold and renamed. |
| **[1. Companies and invoices](phase-1-companies-and-invoices.md)** | • Store each issuing company: its address, bank details, VAT status and number format.<br>• Store every invoice with its lines, its client address and its status.<br>• Store who changed what and when, forever. | • Hand out the next invoice number so the sequence never has a hole and two people never get the same one.<br>• Add up the lines, work out the VAT, produce the total — never storing any of them.<br>• Refuse an edit that would rewrite a number or a sent document. | • Five screens: overview, invoice list, invoice detail, companies, and the settings page.<br>• Every field on an invoice is editable in the browser.<br>• The company switcher appears in the top bar. |
| **[2. References, QR and PDF](phase-2-references-qr-and-pdf.md)** | • Nothing new is stored.<br>• The reference is stored without its check digit, because the check digit is worked out every time. | • Work out the payment reference and its check digit, two different algorithms for two reference types.<br>• Refuse combinations the Swiss standard forbids, such as a euro bill on a QR-IBAN.<br>• Assemble the QR code's contents and draw the invoice as a PDF. | • Download PDF and Preview PDF appear on the invoice.<br>• The payment part is drawn on screen exactly as it will print. |
| **[3. Lifecycle and delivery](phase-3-lifecycle-and-delivery.md)** | • Store when a bill was sent, the id of the email that carried it, and a fingerprint of the exact PDF that went out.<br>• Store why a bill was cancelled, by whom, and when. | • Freeze the parts of a sent bill that are the document, and leave the rest editable.<br>• Refuse to send if this deployment cannot send email, before anything else happens.<br>• Keep a cancelled bill's number consumed forever. | • Four buttons on the invoice: email it, mark it sent, mark it paid, cancel it.<br>• Cancelling asks for a reason and makes you retype the invoice number. |
| **[4. Recurrence](phase-4-recurrence.md)** | • Store rules such as "bill this same thing four times a year, eight times, then stop".<br>• Store how many have been issued and which period each invoice belongs to. | • Work out the next date and stop at the cap.<br>• Make generating the same period twice impossible, so a retrying agent can never double-bill. | • A recurrence card on the invoice, a repeat badge in the list, and a "make this recurring" action. |
| **[5. Imported history](phase-5-imported-history.md)** | • Store the bills from before this app existed, keeping their original numbers and their original system's reference.<br>• Store a note on any row nobody could resolve. | • Refuse a second import of the same source row.<br>• Turn a stored Drive path into a link, and say so plainly when a PDF is missing. | • One screen: the old years, grouped, filterable, with the flags visible. |
| **[6. Seed and production](phase-6-seed-and-production.md)** | • A development seed built from the mockup's own data, and a second, near-empty tenant. | • Prove every total and every reference matches the mockup to the rappen. | • Every screen checked in a browser, in both languages, on a full tenant and an empty one. |

## Why the order is what it is

The tables each milestone adds are listed in its own doc. This table is only the
ordering argument, which is the part people push back on.

| Milestone | Why it sits here |
|---|---|
| **0. Register** | First, always. Nothing can be built against an app that has no schema, no role and no address. It is a walk of [`adding-an-app.md`](../adding-an-app.md) and almost none of it is thinking. |
| **1. Companies and invoices** | The keystone. The number allocator and the audit contract decided here cannot be changed later without touching every row, and every phase after this one writes through them. |
| **2. References, QR, PDF** | Needs an invoice to reference. Comes before sending, because you cannot email a document that does not render yet, and it is the highest-risk work in the project — it wants a whole phase and an external validator. |
| **3. Lifecycle and delivery** | Needs the PDF, because `send` attaches it. The freeze rules need something worth freezing. **Built first anyway, on 2026-09-17**: `send` refused with `document_renderer_not_built` behind one seam until phase 2 filled it on 2026-09-18 (#86) — see the phase doc's "As built". |
| **4. Recurrence** | Needs a template invoice and the full create path, since an occurrence is just another draft. |
| **5. Imported history** | Independent of everything above and worth nothing until the native path is trusted. Deliberately last of the features. |
| **6. Seed and production** | Must be last. Parity is only meaningful once there is a whole app to compare. |

## Fixed vs movable

0 then 1 then 2 is fixed. 6 must follow everything.

The real flex is **5**, which touches no other table and could be built at any
point after 1 — it is scheduled late because it is the cheapest thing to defer,
not because it is blocked. **3** and **4** cannot swap: a recurrence generates
drafts, and a draft with no way to leave `draft` is not worth generating.

## Decisions taken, 2026-09-16

Seven questions. The first four were decided before writing this plan; D-B5,
D-B6 and D-B7 were added the same day, after the requirement that b/billing also
serve a second company as a standalone service and a first reading of that
company's code. They are recorded here so nobody re-litigates them from the
mockup, which predates all seven.

| # | Decision | Answer | Why |
|---|---|---|---|
| **D-B1** | Who writes through the web UI? | **Full write parity.** Every field editable in the browser, and the same field editable by `bk`. | The mockup's whole invoice-detail page is an editor, and the brief says every field is exposed. b/books' read-only web surface is a different product decision for a different app: bookkeeping is posted once, an invoice is drafted and corrected. **Consequence: this app does NOT copy `apps/books/lib/read-only.test.ts` as a read-only guard.** It copies its module-graph half — one `fetch`, one place writes are sent from — and drops the read-only assertion. See phase 1. |
| **D-B2** | How is the PDF and the QR code produced? | **In-house.** Our own payload serializer, validators and check digits; `qrcode` for the module matrix; `pdf-lib` + `@pdf-lib/fontkit` with Liberation Sans for the page and the payment part. | The spec's own §6 checklist is the acceptance test, and it is only an acceptance test if the bytes are ours to read. A library may draw; it may not decide. Liberation Sans is one of the four fonts the standard permits (`qr-bill.md` §4) and is freely redistributable. |
| **D-B3** | How does an invoice reach a client? | **Resend, through `packages/platform-email`, extended with attachment support.** | The brief says "PDF attached to a Gmail send". There is no Google credential anywhere on this platform and `apps/sales` explicitly ruled that integration out of scope; acquiring one to send mail is a security surface the platform does not have. Resend is already the transport for every other message this platform sends, on the verified apex domain. **This is a recorded deviation from OPEN-DECISIONS R9** and the reason is in phase 3. |
| **D-B4** | Are line items a column or a table? | **A table, `billing.invoice_line`.** The wire shape stays `items: [...]`, exactly as the mockup serves it. | The mockup embeds them, and for a static JS file that is right. In Postgres it is not: a money value inside `jsonb` is a JSON number, therefore a float64, and this repo's money rule is that an amount is `numeric(14,2)` and a string on the wire. It is also what let a per-line VAT rate become a column the same day the first external customer needed one (D-B7), rather than a rewrite. See phase 1. |
| **D-B5** | Can another company's system plug into b/billing over HTTP? | **Yes, through a declared public subset of routes**, served from one declaration that `/api/meta` carries, the contract hash covers, a page renders and a test checks. Every other route stays private. | This amends the platform rule that the HTTP API has no public contract (`docs/backend.md:20`). The alternative, integrating through `bk`, was weighed and lost. What the rule protects, a route and its command changing together without breaking anybody, is kept for every route outside the subset and made explicit for the routes inside it. See [`integration-surface.md`](integration-surface.md). |
| **D-B6** | How does a second company get b/billing as its own product? | **A separate, rebranded repository generated from a tag of this one** by `devops/extract-billing.sh` with a `brand.json`: the other apps deleted, every list that names them shrunk to one entry, the brand applied, a fresh git history, and a brand-leak guard inside the artifact. Its database is bootstrapped empty, so nothing is disabled: the other apps are absent. | "Totally separate" is five things (runtime, git, brand, data, release) and a copy of this repo gives none of them cleanly; a hand-maintained copy stops receiving fixes on its first commit. What this decision leaves open is whether the customer's repo stays a generated artifact or becomes a one-time snapshot, which is a question of who maintains it. See [`standalone-deployment.md`](standalone-deployment.md). |
| **D-B7** | One VAT rate per invoice or per line? Prices with VAT inside or added? Rounding fixed or per company? | **Per line, either mode, per company.** `invoice_line.vat_rate` nullable (null is exempt, `0` is a rate); `invoice.prices_include_vat`, frozen with the document; `company.rounding`, a closed vocabulary of four policies with the mockup's as default — the fourth, `exact_0_05`, added 2026-09-23 when a closer read of the first customer's code showed they never round a LINE: qty × price stays exact, the sum is exact, and only the payable total is rounded, once. | Read from the first external customer's code on 2026-09-16: their invoices put a VAT-exempt medical act beside a taxable product, their prices include VAT, and they round VAT to the rappen and the total to five. Phase 1 had already written that a per-line rate is "a column later, a rewrite after"; a customer arriving before the first row made it now. See phase 1, Derivations. |

### The mockup's pending questions, answered provisionally

`dev-handoff/OPEN-DECISIONS.md` lists 14 pending. Nine of them block code, so
this plan takes a position on each, marked as an assumption in the code and in
`docs/changelog/billing.md`. **Each one is still Andrea's to overturn** and the
cost of overturning it is recorded.

| # | Question | Position for v1 | Cost to change later |
|---|---|---|---|
| P4 | Does `BC-{YYYY}-{SEQ4}` restart each year? | **No.** The sequence counts forever; the year is display only. | One column, plus a decision about the year the change takes effect. Cheap. |
| P7 | Does a cancelled occurrence count toward a series cap? | **No.** A void and its replacement are one occurrence. | The partial unique index in phase 4. Cheap. |
| P8 | VAT rounding | **A per-company policy**, default `line_0_05` (the mockup's: every line and every VAT amount to five rappen). `total_0_05`, `exact_0_05` (the first customer's: lines never rounded, the total rounded once — 2026-09-23) and `none` exist for companies whose books differ. Reshaped by D-B7. | A company setting an owner changes; every historical total of that company changes with it. Confirm with the fiduciary before the first real bill. |
| P9 | May a sent invoice be edited? | **The document is frozen, the rest is not.** Amounts, client, dates, currency and reference lock on send; the payment message, the due date and the status stay open. A correction is void plus reissue. | A trigger. Moderate — loosening is easy, tightening after real bills exist is not. |
| P10 | Is the sent PDF archived? | **No. It is regenerated, byte-stably**, and the sha256 of what was sent is recorded on the audit entry. | Adding archival later is additive. Making regeneration byte-stable later is not, which is why it is a phase 2 requirement rather than a phase 3 one. |
| P11 | What do the 26 QRR digits encode? | `00000000000000` + company `seq` (4) + invoice `seq_no` (8). | **Settle with the bank before the first real QRR bill.** The bank may want the leading digits as a grouping key (§4.3.2). Changing it after bills are out means two schemes in the wild. |
| P5 | Emit Annex D `//S1` billing information? | **No.** But the 140-character shared budget is enforced from day one. | Additive. |
| P14 | eBill, alternative procedures | **No.** | Additive. |
| P6 | Do imported rows ever become real invoices? | **No.** History is a read-only archive with its own numbering. | Large. Do not build toward it. |

Five stay open and are **not** ours: P1 the real second entity, P2 blackcode's
real UID and IBANs, P3 the ESTV-verified VAT rates, P12 the stack (answered by
this repo existing), P13 the recurrence defaults. Phase 6 ships the mockup's
placeholders, each visibly flagged, and the first real invoice cannot be issued
until P1, P2, P3 and P11 have real answers.

## The borrowed-data rule, and why this app is small

Confirmed three times by Andrea on 2026-08-17 and recorded as OPEN-DECISIONS R1:
**b/billing owns invoices, line items, status and recurrence. Nothing else.**

| Data | Owner | What this app does in v1 | What changes later |
|---|---|---|---|
| Client identity and address | **b/clients** | A free-text block on the invoice, kept structurally separate | Becomes a reference plus the snapshot frozen at issue |
| VAT rates | **b/tax** | A local list in `lib/vat-rates.ts`, ESTV-unverified and flagged | A lookup by date |
| Bank accounts (IBAN, QR-IBAN) | **b/books** | Read-only fields on the company profile | A picker over b/books' account register |
| Products and pricing | **b/sales** | Not represented; a line is free text | Optional prefill, still free text once inserted |
| Whether a payment actually arrived | **b/books** | `paid` is set by a human or an agent saying so | b/books may inform. b/billing never reconciles. |

Three rules keep the eventual swap cheap:

1. **One accessor per borrowed field.** Pages and routes never reach a local
   store directly. Swapping a source means reimplementing one function.
2. **Visible provenance.** Every borrowed field carries the dashed `⇠ b/xxx`
   chip in the UI, and the chip names the workspace slug it resolved against.
   Keep the chips in the real build.
3. **Never grow an editor for borrowed data.** A wrong IBAN is fixed in b/books.

None of those apps exist on this platform yet. **Do not build toward them**
beyond the accessor. There is no cross-app join on this platform and there is not
going to be one: a relation between two apps' records lives in the text of one of
them, as a URN.

## The CLI is not a separate phase

`bk` is the only supported interface for agents; the HTTP API is private plumbing
with no public contract. So the CLI is half of every route, in the same commit.

The parity test enforces it. A route with no command fails the build. A command
naming a route that does not exist fails the build.

| When | CLI work |
|---|---|
| Phase 0 | The scaffolding: the command group, its registration in `root.go`, the guide topics directory, the typed client, and the workspace reads. Required — route attribution is read from the guide topics directory, so without it the parity test is vacuous rather than passing. |
| Phases 1–5 | One command per route, same commit as the route. Listed in each phase doc. |
| Phase 6 | The guide topics filled out, and the pitfalls topic written. |

**One thing with no precedent in this repo, and it is yours to design:** the
`--company` flag. Every other app scopes by workspace and stops; b/books added
`--entity` and `--exercice`. This app needs one extra dimension, the issuing
company. Decide the grammar in phase 1 and keep it identical across every
command, including where it is remembered and where it must be stated.

**The app-owned verb tier: mount `workspace`, `member` and `invite`, and nothing
else.** No `upload` (this app stores no files), no `trash` and no `label` (an
invoice is never deleted — it is voided, and its number stays consumed). An app
that mounts neither the verbs nor the routes is a valid state and nothing
complains, so the decision is written here in order not to read as an omission.

## Three things nothing may assume

**The number of companies is open.** The user creates them. The mockup seeds two
and invents the second; nothing anywhere may hardcode two, and "the company"
must not appear in code or copy where a specific company is meant.

**The wire shape is the mockup's shape.** `lib/types.ts` mirrors
`billing-data.js` field for field, including `items: [...]` even though the
storage is a table (D-B4). Renaming a field costs the frontend a rewrite and
costs an agent on stale context a broken run.

**A number, once allocated, is permanent.** There is no delete and no renumber
anywhere in this app, at any layer. A void keeps its number and records why.

## Rules that hold in every phase

1. The query layer is the only place that touches the database. Routes stay thin.
2. Every route needs a `bk` command in the same commit, with its `routes`
   annotation or the literal `"none"`.
3. Never expose the serial `id`. Expose the workspace `seq` as `number`.
4. Money is `numeric(14,2)` in Postgres and a **string** on the wire. Never a
   float, never a `Number` on the display path. Dates are `date`, sliced as
   strings, never constructed as a `Date`.
5. No hard delete. No renumbering. Ever.
6. Never store a derived value: totals, VAT, check digits, formatted blocks.
7. Every write appends to `billing.audit`, in the same transaction.
8. Per-currency sums are never merged. `CHF x + EUR y`, never a converted total.
9. Payment, reference, VAT or numbering doubt: stop and ask Andrea. Mock data
   gaps: note the pattern and move on.

## Prove it fires

[`CLAUDE.md`](../../CLAUDE.md) carries 23 findings of guards that were green and
inert, and the rate has not fallen as the rule became better known. This app adds
two of its own reasons to care: a wrong number is a bookkeeping violation, and a
wrong IBAN is money gone.

So for every guard in every phase: **break the thing it guards, watch it go red,
then ask what it would still pass on, inject that too, and watch again.** Each
phase doc names its own mutation targets under "Done when". The three that matter
most across the whole build:

- Replace the number allocator with a `MAX(seq_no) + 1` read outside the
  transaction and watch the concurrency test produce a duplicate.
- Drop `appendAudit` from one write path and watch the audit test fail.
- Change one line ending in the payload serializer and watch the golden test
  fail.

And the human half of the same rule: before reporting that something is done or
absent, say what question your command actually asked, and check that it is the
question you are answering.

## Related documents

**In this repo**, read these before starting phase 0:

- [`adding-an-app.md`](../adding-an-app.md) — the authoritative checklist. Walk
  it top to bottom. Read "what the second app actually cost" before estimating.
- [`working-in-this-repo.md`](../working-in-this-repo.md) — the traps that have
  actually bitten here, and how to work in this repo.
- [`platform-db.md`](../platform-db.md) — the database boundary, roles, grants.
- [`platform-architecture.md`](../platform-architecture.md) — current design rules.
- [`books-app-plan/`](../books-app-plan/README.md) — the precedent. Same job, one
  app earlier, and its `reports/` folder is the record of where its plan was
  wrong.

**In the `b-mockups` repo**, under `bbilling/`: see "Where the source material
lives" above. `dev-handoff/DATA-MODEL.md` §11 and
`research/QR-BILL-TECHNICAL-SPEC.md` are the two that matter most.

## Status

Draft written 2026-09-16, before `apps/billing` exists. Nothing has been built;
the plan has been checked against the repo as it stands on branch
`feat/billing-app`, and every file:line reference in these docs was verified on
that date.

Amended the same day: decisions D-B5 and D-B6, recorded in
[`integration-surface.md`](integration-surface.md) and
[`standalone-deployment.md`](standalone-deployment.md), after the requirement
that b/billing also serve a second company as a standalone service. Their
items are threaded into phases 0 to 4; nothing else in the plan moved. D-B6
was rewritten the same day, from a second deploy target of this repo to a
separate, rebranded product; the first version survives nowhere. D-B7 followed
from reading the first customer's billing code the same day, and phase 1's tables
and derivations changed with it.

Two facts about the world that these docs depend on, and that will expire:

- **IG QR-bill v2.3 is the version in force**; v2.4 takes effect 14 November 2026
  and v2.3 stays valid until November 2027. This plan builds to v2.4's rules,
  which are valid under both. See [`qr-bill.md`](qr-bill.md).
- **The `bk` floor was 4.2.0** when this was written. Since 2026-09-24 it is
  the npm `min` dist-tag, read live by every app
  (`packages/platform-agent/src/cli-version.ts`). Adding this app moves neither
  `latest` nor `min` by itself; the release does.

When `apps/billing` exists, this folder moves to `apps/billing/docs/`, per the
placement rule in `working-in-this-repo.md`. It sits in root docs for now because
there is no app directory to hold it — the same reason
[`books-app-plan/`](../books-app-plan/README.md) sat here.
