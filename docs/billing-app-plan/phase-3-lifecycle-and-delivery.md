# Phase 3: Lifecycle and delivery

**Goal:** an invoice can be sent to a client with its PDF attached, marked paid,
or cancelled with a logged reason — and a sent document stops being editable.

- **The problem** — up to here an invoice is a draft that can be changed
  forever. The moment one is sent it becomes a legal claim: the amounts, the
  client and the reference are now facts a third party holds a copy of, and
  editing them silently makes our records disagree with theirs. Cancelling has
  statutory consequences and must keep the number consumed. And the brief asks
  for the PDF to be emailed, while this platform's email package sends one of
  two fixed templates, has no attachment support, and there is no Google
  credential anywhere in it.
- **What this phase does** — adds the freeze columns and the four lifecycle
  routes; extends `packages/platform-email` with attachment support and one
  shared document template, which is a change to a shared package and is
  therefore argued rather than assumed; renders the PDF at send time, records the
  message id and the sha256 of the bytes that went out, and refuses to start if
  the deployment cannot send email at all; and makes a void require the caller to
  retype the invoice number even under `--yes`.
- **Expected result** — `bk billing invoice send <ref> --to …` delivers a real
  email with a real PDF attached and writes one audit row naming the message id;
  a deployment with no Resend key answers `503 email_not_configured` **before**
  anything is rendered or written; editing a sent invoice's amount is refused by
  the database; a voided invoice keeps its number and records who cancelled it
  and why; and the 503 test has been watched failing against an unconditional
  refusal, which is the mutation that caught finding #21.

## In one look

| | |
|---|---|
| **Data** | When a bill was sent, the id of the message that carried it, and a fingerprint of the exact PDF that went out. Why a bill was cancelled, by whom, and when. |
| **Logic** | Freeze the document half of a sent bill and leave the rest editable. Refuse to send before minting anything if email is unavailable. Keep a cancelled number consumed forever. |
| **UI** | Four actions on the invoice: email it, mark it sent, mark it paid, cancel it. Cancelling asks for a reason and makes you retype the number. |

## Module diagram

```
┌─ UI ────────────────────────────────────────────────────────
│  components/invoice-actions.tsx   four buttons       altered
│  components/send-modal.tsx        to, cc, subject        new
│  lib/mutations.ts                 four more hooks   altered
└─────────────────────────────────────────────────────────────

┌─ CLI ───────────────────────────────────────────────────────
│  commands/billing/invoice.go  send, mark-sent,
│                               paid, void            altered
└─────────────────────────────────────────────────────────────

┌─ BUSINESS LOGIC ────────────────────────────────────────────
│  .../invoices/[ref]/send|mark-sent|paid|void/route.ts    new
│  lib/db/queries/lifecycle.ts                            new
│  lib/email/send.ts            the app's binding     altered
└─────────────────────────────────────────────────────────────

┌─ DATA ──────────────────────────────────────────────────────
│  migrations/0007   sent_at, sent_message_id, pdf_sha256
└─────────────────────────────────────────────────────────────
```

**Shared packages this phase ALTERS:** `packages/platform-email`. It is the only
shared-package change in the whole build, and the next section is the argument
for it.

## Build

### The email decision — D-B3, and it is a recorded deviation

`dev-handoff/OPEN-DECISIONS.md` R9 says: *"PDF attached directly to a Gmail send;
never an upload-to-Drive delivery."* The second half of that is honoured exactly.
The first half is not, and here is why, so nobody re-derives it:

- **There is no Google credential on this platform, anywhere.** No `googleapis`,
  no `google-auth-library`, no OAuth scope beyond sign-in. The only Google
  integration is `packages/platform-file-providers`, which parses Drive **URL
  shapes** and whose own header says holding a Google credential is explicitly
  out of scope. `apps/sales` ruled the same integration out and kept
  `external_ref` columns so it could be added later without a migration of
  meaning.
- **Acquiring one to send mail is a security surface, not a feature.** A
  `gmail.send` grant on a company mailbox, an OAuth consent flow, token refresh,
  and a credential that can send mail as a person, all to deliver a document.
- **Resend is already the transport for every message this platform sends**,
  from the verified apex domain `admin@blackcode.ch`, with per-app identity
  carried in the display name because the free plan verifies one domain per
  account. It supports attachments.

So: **Resend, with the app's display name and `reply-to` set to the issuing
company's own address.** The client replies to the company, which is what R9
actually wanted. Write this into `docs/changelog/platform.md` as a deviation with
its reason, and put the same paragraph in `apps/billing/docs/backend.md`.

If Andrea wants the mail to appear in a human's Sent folder, that is a real
requirement this does not satisfy, and it is a conversation about a Google
credential rather than a line of code.

### The change to `packages/platform-email`

Three small additions, and one refusal.

**1. Attachments and a reply-to on the one Resend call.**
`packages/platform-email/src/send.ts:103` is the entire wire call and today
passes `from`, `to`, `subject`, `html`, `text`. Add:

```ts
attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
replyTo?: string
```

**2. One shared template, `documentEmail`.** In `src/templates.ts`, beside
`invitationEmail` and `passwordResetEmail`, taking
`{ subject, heading, body, attachmentName }`. The copy is a **parameter**; the
template is shared.

**3. One more method on `EmailSender`**: `sendDocumentEmail(to, input)`.

**The refusal:** `src/identity.ts:12-18` states that a per-app template set is
refused, because *"a per-app `templates.ts` is a copy with extra steps; it does
not stop being a copy because a package holds it."* That still holds. b/billing
does not get its own templates; it gets a parameterised one that any app can
use.

The app's binding, `apps/billing/lib/email/send.ts`, re-exports from
`createEmailSender({app, getDb, identity})` and is the **only** module allowed to
import `@blackcode/platform-email`. Its `identity.contactEmail` reads
`process.env.BILLING_CONTACT_EMAIL ?? 'contact@blackcode.ch'`, not the literal
`apps/books/lib/email/send.ts:60` carries: a standalone copy sends on another
company's behalf ([`integration-surface.md`](integration-surface.md) §5), and
its `RESEND_FROM_EMAIL` is that company's own verified domain.

### Migration 0007

| Column | Type | Notes |
|---|---|---|
| `sent_at` | `timestamptz` nullable | set on `draft → sent` |
| `sent_message_id` | `varchar(255)` nullable | the Resend message id. Null for `mark-sent`, which is the "sent outside this app" path. |
| `pdf_sha256` | `char(64)` nullable | of the bytes actually attached. This is the P10 answer: not the document, its fingerprint. |

Guard **G2** already exists from phase 1 and needs no change: it keys on
`status <> 'draft'`, and these three columns are outside its frozen set.

### The four write paths

All four are one transaction ending in `appendAudit`, and all four return a fresh
read.

**`POST …/invoices/{ref}/send`** — body `{to, cc?, subject?, body?}`.

The order of operations is the whole design, and it is finding #21's lesson:

1. **`canDeliverEmail()` first, before anything is rendered or written.** If
   false, throw `Errors.serviceUnavailable('email_not_configured', …)` with a
   suggestion naming `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Nothing has
   happened yet.
2. Validate: the invoice is `draft`, the recipient parses, the payload validates.
   A bill the standard would refuse must not leave the building.
3. Render the PDF. Hash it.
4. Send. A Resend failure is a 502 and **no status change** — a bill marked sent
   that was not is worse than one that has to be retried.
5. Write `status = 'sent'`, `sent_at`, `sent_message_id`, `pdf_sha256`, and the
   audit row naming the recipient and the message id.

Note what `canDeliverEmail()` means: `emailEnabled() || NODE_ENV !== 'production'`.
Outside production, with no key, the send **succeeds** and the payload is logged.
That is the platform's deliberate honest-degradation behaviour and its client
header says not to "fix" it into a 503.

**`POST …/invoices/{ref}/mark-sent`** — no email. For a bill delivered on paper
or from another mailbox. Audited as such, and `sent_message_id` stays null so
the two paths are distinguishable forever.

**`POST …/invoices/{ref}/paid`** — body `{paid_date}`. **An assertion, never a
computation.** There is no bank matching and no reconciliation in this app; that
is b/books' job entirely, and the audit detail should say so in the same words
the mockup's does.

**`POST …/invoices/{ref}/void`** — body `{reason_fr, reason_en}`, and the reason
is **mandatory**. Writes `{ts, by, reason}`, sets `status = 'void'`, and the
number **stays consumed**. There is no delete anywhere in this app.

### The confirmation that actually guards

```
bk billing invoice void <ref> --reason "…" --confirm BC-2026-0033
```

`--confirm` must equal the invoice's own `number`, and it is **required even
with `--yes` and even under `BK_NO_PROMPT=1`**. `cmdutil.Confirm()` is not a
guard for agents: it returns true under `--yes`, under `BK_NO_PROMPT=1`, and on
any non-TTY — which is exactly how agents run.

Three details, each learned the hard way elsewhere in this repo:

- **Trim the flag value before comparing.** `--confirm " BC-2026-0033 "` once
  passed a comparison and then put the untrimmed value on the wire, so the server
  was deciding on input the CLI had never looked at.
- **Read the target before the write**, so the comparison is against the real
  number rather than the argument the caller typed twice.
- **Word the error so it contains "required"**, because `classify()` maps that to
  exit 2, matching what `bk workspace delete` does. A pre-check in the binary
  must exit the same code the server would.

And the reporting rule for anything irreversible: **say what you did, not how
many.** The void confirmation echoes the number, the client name and the total,
captured before the write.

## Routes and CLI

| Route | Command |
|---|---|
| `POST /api/workspaces/{ws}/invoices/{ref}/send` | `bk billing invoice send <ref> --to a@b.ch [--cc] [--subject] [--body-file]` |
| `POST /api/workspaces/{ws}/invoices/{ref}/mark-sent` | `bk billing invoice mark-sent <ref>` |
| `POST /api/workspaces/{ws}/invoices/{ref}/paid` | `bk billing invoice paid <ref> --date 2026-10-02` |
| `POST /api/workspaces/{ws}/invoices/{ref}/void` | `bk billing invoice void <ref> --reason "…" --confirm <number>` |

`send` honours `Idempotency-Key` like every allocating `POST`
([`integration-surface.md`](integration-surface.md) §2), and here the stake is
not a number but a second email in the client's inbox. The key is checked before
step 1 of the send ordering; a replay returns the stored response with
`Idempotent-Replayed: true` and sends nothing. All four routes join
`PUBLIC_ROUTES` in this phase.

Use `--body-file FILE` or `--body -` for the message text. A multi-line body
typed as a flag value is where UTF-8 and newline escaping break on Windows
PowerShell, and `cmdutil.ReadBody` already solves it.

## The web surface

Four buttons in the invoice's action bar, and a small send modal for the
recipient, cc and subject. Cancelling goes through `useConfirm`'s **prompt**
variant to collect the reason — never `window.prompt`.

After send, the frozen fields render **read-only with a hint saying why**, not
merely disabled. A field that is greyed out with no explanation reads as a bug;
one that says "locked because this invoice has been sent — a correction is a void
and a reissue" teaches the model.

Toasts on all four, undo where undo is possible — and it is not possible on any
of these four, so say that instead of offering it.

## Done when

- [ ] `bk billing invoice send` delivers a real email with a real PDF attached,
      to a real inbox, from `b/billing <admin@blackcode.ch>` with `reply-to` the
      company's address
- [ ] The audit row names the recipient and the Resend message id, and
      `pdf_sha256` matches the attachment
- [ ] **The 503 path returns 503 and writes nothing**, asserted on the
      **response**. Then mutate the route to `if (true || !canDeliverEmail())`
      and watch the test **fail** — this is finding #21 verbatim, where a
      positive case passed against an unconditional refusal because the error
      handler's own `error_events` write tripped the flag it was watching
- [ ] A Resend failure leaves the invoice in `draft` with no `sent_at`
- [ ] `PATCH` of `unit_price`, `client`, `currency`, `ref_type` or `vat_rate` on
      a sent invoice is refused **by the database**, and `message`, `due_date`
      and `paid_date` still succeed
- [ ] A void records the reason, keeps the number, and the next create takes the
      following number rather than the voided one
- [ ] `bk billing invoice void` with no `--confirm`, with a wrong `--confirm`,
      and with `--yes` plus no `--confirm`, all refuse — **including with
      `BK_NO_PROMPT=1` set**
- [ ] `--confirm " BC-2026-0033 "` with surrounding spaces is accepted and the
      trimmed value is what reaches the server
- [ ] A bill that fails payload validation cannot be sent
- [ ] **These were watched failing, then restored:** `attachments` dropped from
      the Resend call; the `canDeliverEmail()` check moved to after the render;
      G2 disabled; the `--confirm` comparison made case-insensitive or untrimmed;
      `appendAudit` dropped from the void path
- [ ] The action bar exercised in a browser for each of the four actions, on a
      draft, a sent and a voided invoice, in FR and EN

## Frontend gets

The four actions, the send modal, and the read-only-with-a-reason rendering of a
sent invoice.

## Notes

**`paid` is an assertion.** Nothing in this app watches a bank account. The
status says a human or an agent asserted the money arrived; b/books owns the
money truth and may one day inform this, but **b/billing never reconciles.** Do
not add an `amount_paid` column, a partial-payment flow or an aging calculation
without a design pass — the first two are explicitly v2 in `SCOPE.md` and the
third is arithmetic on existing facts and therefore fine, but it belongs on the
overview rather than in the schema.

**No reminders and no dunning.** Not in v1, and per `SCOPE.md` the *sending* of
a reminder stays human-gated indefinitely rather than just for now. An
agent-drafted reminder is fine; an agent-sent one to a paying client is a
relationship decision.

**The email log lives in the audit table, not in a new one.** The message id on
the audit row is the whole record. An `email_log` table would be a second place
to look for the same fact.

**`sent_message_id` being null is meaningful**, and that is why `mark-sent`
exists as its own route rather than as a flag on `send`. "Sent by us, here is the
message" and "sent somehow, we were told" are different facts and a null is how
the second one says so.
