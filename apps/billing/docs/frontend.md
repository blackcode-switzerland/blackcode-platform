# b/billing — frontend

This app only. Platform-wide theme tokens, primitives and data-fetching
conventions are in the root `docs/frontend.md`.

## Phase 0 ships four pages and no design

| Page | What it is |
|---|---|
| `/` | the public landing page. Every name on it reads `APP_NAME` |
| `/login` | the sign-in form, copied from the scaffold |
| `/dashboard` | the members page, and the empty state that matters |
| `/cli/authorize` | the browser half of `bk login` |

**Inline styles, no shell, no theme, no toast library, no query client.** That is
a decision, not a shortcut: phase 1 brings the real shell, the company switcher
and five screens, and a design shipped here is a design phase 1 has to undo.
`package.json` therefore does not carry `@tanstack/react-query`, `sonner`,
`lucide-react`, `clsx` or `next-themes` yet.

`app/globals.css` keeps the scaffold's `@source` line **exactly as it is**.
`transpilePackages` in `next.config.js` makes the shared UI package's TypeScript
compile; `@source` makes its CSS exist. Neither implies the other and only one
fails loudly — 151 classes were missing in production for months (D-30).

## The empty state is the page that matters most

A new tenant's first hour is entirely empty states, and `/dashboard` has two:

- **No workspace at all.** The normal state for somebody arriving on a session
  cookie from another blackcode app. It explains why, offers
  `CreateWorkspaceForm`, and says what a workspace is — a tenant, not an issuing
  entity. It also says that an invitation cannot be redeemed yet, because a
  person who sends one and hears nothing deserves to have been told.
- **No pending invitations.** Names the command and says the response carries
  the link, because this app sends no invitation email in phase 0.

## `CreateWorkspaceForm` is the only write

It posts to `POST /api/workspaces` — the same route `bk billing workspace
create` calls. **Not a server action**, deliberately: a server action here would
be a capability the CLI could not reach and the parity guard could not see,
which is CLAUDE.md's "start anywhere, finish in sync" read backwards.

It renders the server's `suggestion` beside the message, which is the same
recovery contract the CLI prints as a `hint:` line.

`CliAuthorizeForm` is the other client component that writes, and it is an
ACCOUNT write rather than a billing one. When phase 1 adds `lib/mutations.ts`,
it must not move there: an invoicing permission that could stop somebody signing
a terminal in would be a preference that had quietly become a permission.

## A page is not a route, and this app already has the risky shape

`/dashboard` is a **server component that reads the database directly** — no
`fetch`, no route, no token. `lib/cli-parity.test.ts` cannot see it at all.

That is the shape that cost `apps/sales` four phases: its dashboard resolved
membership through the shared `listMyWorkspaces` against `platform.workspaces`
and 404'd for every sales-only account while every API route returned 200. It
was found by opening a browser.

The third case in `lib/app-isolation.test.ts` is the only automated check
standing between this page and another app's tenancy. It was copied from
`apps/sales` because **the scaffold does not carry it**, and it was watched
failing on both the named-import and namespace-import spellings before being
kept.

## What phase 1 brings

The shell with the company switcher in the top bar, `lib/client.ts` as the only
`fetch`, `lib/mutations.ts` with one hook per write, `lib/query-keys.ts` with a
tested key helper, and five screens. Decision D-B1 is full write parity: every
field of an invoice editable in the browser and the same field editable by `bk`.

This app does **not** copy `apps/books/lib/read-only.test.ts`' read-only
assertion — that is a different product decision for a different app. It copies
its module-graph half, so a stray `fetch` outside `lib/client.ts` fails the
build.

## What phase 3 put on the wire (backend landed 2026-09-17)

For the action bar, the send modal and the read-only-with-a-reason rendering.
`types/index.ts` is the contract; this is what matters for a screen.

- **Four POSTs**, each returning the fresh invoice: `…/invoices/{ref}/send`
  (`SendInvoiceBody`), `…/mark-sent` (no body), `…/paid` (`MarkPaidBody`),
  `…/void` (`VoidInvoiceBody`). One hook per write in `lib/mutations.ts`.
- **Three new invoice fields**: `sent_at`, `sent_message_id`, `pdf_sha256`. A
  sent invoice with `sent_message_id: null` was **not** emailed by this app —
  render "sent outside the app", never "sending…".
- **`send` and `mark-sent` answer 422 `payment_part_invalid`** when the record
  would make a payment part a bank rejects. Do not wait for the refusal: the
  invoice's own `derived.problems` lists the same problems on every read, each
  with a `code`, a `message` and a `suggestion` — disable the actions and show
  the list. (Until 2026-09-18 `send` answered 501 `document_renderer_not_built`;
  that code is gone.)
- **Phase 2 gives the screens three things** (ticket #86):
  - `derived` on every invoice: `reference`, `reference_formatted`, `account`,
    `account_formatted`, `creditor`, `has_payment_part`, `problems`. **Render the
    payment part from this block and from nothing else** — never from the
    company record. A sent invoice's account and creditor come from its own copy
    of the company, and `derived` is where that has already been resolved.
  - `issuer`: that copy. `null` on a draft, and only on a draft. Show "as issued
    on <captured_at>" from it; `backfilled: true` means a migration filled it in.
  - `GET …/invoices/{ref}/pdf` (open in a tab for Preview, `download` for
    Download) and `GET …/invoices/{ref}/qr` (the payload the on-screen QR must
    encode — draw the matrix from this string, never from a re-serialization in
    the browser). A void invoice has `has_payment_part: false`: draw no slip.
- **Frozen after send**, in the database: `currency`, `language`, `ref_type`,
  `ref_body`, `client`, `vat_rate`, `prices_include_vat`, `issue_date`, the lines.
  Still editable: `due_date`, `message`, `external_ref`, `metadata`. A PATCH of a
  frozen field answers 409 `document_frozen` naming it — render those fields
  read-only with the reason, before the request.
- **`void` takes a reason** (one is enough) and should send `confirm` equal to
  the printed number; the server refuses a mismatch with 409 `confirm_mismatch`.
  Collect the reason with `useConfirm`'s prompt variant, never `window.prompt`.
- **`paid_date`** is required, `YYYY-MM-DD`, not in the future.
- **Undo is not possible for any of the four**; say so in the toast instead of
  offering one.
- Limits for the modal (subject, body, copies, reason length) are served at
  `GET /api/meta` under `limits.delivery`. Do not copy the numbers.

## What phase 4 put on the wire (backend landed 2026-09-18)

For #92 — the recurrence card, the `↻ n/N` badge, "Make recurring…".

- **Every invoice** carries `recurrence` (the series' #number, or null) and
  `occurrence_period`. The badge reads `recurrence`; fetch the series for `n/N`.
  **A void keeps its series** — show the badge on it too.
- **`GET …/recurrences/{seq}`** is the card: `status`, `frequency`,
  `start_date`, `occurrences_done`/`occurrences_total`, `next_date`,
  `next_period`, `due`, `label.{fr,en}`, `template`/`template_number`, and
  `invoices[]` (every invoice carrying it, voids included, each with its
  period). State the end condition in words — "stops after 8 occurrences".
- **`POST …/recurrences`** is "Make recurring…": `template`, `frequency`,
  `start_date`, **`occurrences_total` (required — the form has no "forever")**.
  P13's default is 12 × monthly. The response may already count the template as
  the first occurrence; say so from `occurrences_done`.
- **Pause/resume** are `PATCH {status: 'paused' | 'active'}`. `completed` is
  never sent; a completed series shows no actions but "view".
- **"Generate" is not on the plan's screen list** and the app schedules nothing.
  If a button is added, it must send the `next_period` it displays, never
  compute one, and render `409 already_generated` as "already exists: <number>",
  linking to it.
- `GET …/audit?subject=recurrence:<seq>` is the card's history.

## The minimal test UI (2026-09-18) — scaffolding, to be replaced

A bare, deliberately unstyled web surface so the backend can be driven in a
browser with Playwright before the real screens exist. **It is not the design
and not a starting point for one**; #79 onward replace it.

| Page | Routes it calls |
|---|---|
| `/dashboard` (existing) — now links each workspace | — (server component, as before) |
| `/dashboard/[ws]` overview | `GET …/overview` |
| `/dashboard/[ws]/companies` list + create | `GET/POST …/companies` |
| `/dashboard/[ws]/invoices` list, filter, create | `GET/POST …/invoices`, `GET …/companies` |
| `/dashboard/[ws]/invoices/[ref]` detail and every action | `GET/PATCH …/invoices/{ref}`, `…/pdf`, `…/qr`, `…/send`, `…/mark-sent`, `…/paid`, `…/void`, `GET …/audit?subject=invoice:` |
| `/dashboard/[ws]/recurrences` list (`due`), create | `GET/POST …/recurrences` |
| `/dashboard/[ws]/recurrences/[seq]` detail, generate, pause/resume, total | `GET/PATCH …/recurrences/{seq}`, `POST …/generate`, `GET …/audit?subject=recurrence:` |
| `/dashboard/[ws]/history` list + import (paste JSON) | `GET/POST …/history` |

**The rules it keeps, which the real screens should keep too:**

- **Client components calling the same routes `bk` calls.** No server actions,
  no database reads in a page — so nothing here is a capability the CLI lacks,
  and a route test covers what the page does. One `fetch`, in `lib/web.ts`.
- **Every POST sends a fresh `Idempotency-Key`**, as `bk` does.
- **Errors show the server's `error` and `suggestion`**, with the code. The
  envelope is `{ error, code, suggestion }`; the phase-0 create-workspace form
  read `message`, which never exists, and showed only the status — fixed here.
- **A success line appears only after the data has reloaded.** The first
  version announced "marked sent" beside the old status; a Playwright walk
  caught it on its second run. `useLoad().reload()` returns a promise for that.
- **Nothing is computed in the browser that the server derives**: totals, the
  reference, the account, the next period, the problems list are all read from
  the response. `generate` sends the period as typed, never a default.

**For tests:** every element a script needs has a `data-testid`
(`input-<field>`, `invoice-row-<number>`, `field-<name>`, `error`, `done`, …).
That attribute is the contract, not the markup. `lib/web.ts`' header says the
same, so a later refactor keeps them.

**What it does not do:** i18n, the company switcher, the payment-part preview,
empty states beyond one line, any styling beyond undoing Tailwind's reset (a
`<style>` block scoped to the workspace layout).

**Verified 2026-09-18** with a Playwright script (Chromium, outside the repo):
register a throwaway account, sign in through `/login`, and walk the empty
overview → company → a refused em-dash message → a draft (total, no problems,
QR payload, PDF with the session) → mark sent (issuer copied) → paid → a series
refused without a count → created → generated → the same period refused →
pause/resume → a history import → the overview. 21 steps, five consecutive
green runs; watched failing with error lines hidden.
