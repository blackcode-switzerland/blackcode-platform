# b/billing — frontend

This app only. Platform-wide theme tokens, primitives and data-fetching
conventions are in the root `docs/frontend.md`.

## The web UI (2026-09-21)

The bare test scaffold of 2026-09-18 is gone (`components/min/**`, `lib/web.ts`).
The app now has the same skeleton as `apps/sales` — fixed left sidebar with the
workspace switcher, a slim sticky `PageHeader` per page, a drawer below `lg`,
Google Sans, Tailwind v4 tokens, `next-themes` (dark default), `sonner`,
`useConfirm()` — and its **own skin**: violet primary (`#7c5cff` dark /
`#6d4aff` light), cool violet-tinted neutrals, radius `0.625rem`, money and
numbers in tabular mono. The measured contrast ratios are in
`app/globals.css`'s header; dark mode's white-on-primary is 4.35:1, short of AA
body text, and is a known open point.

| Page | What it is |
|---|---|
| `/` | landing page (signed-out); signed-in goes to `/dashboard` |
| `/login` | sign in / sign up tabs, forgot-password flow, Google if configured |
| `/cli/authorize` | the browser half of `bk login` |
| `/dashboard` | lands you in a workspace: the only one, the remembered one, or a chooser. **With none, it creates one and redirects** (see below); `?new=1` shows the create form instead |
| `/invitations/[token]` | an invitation link lands here: who invited you, to which workspace, Accept / Decline. Signed-out → `/login?callbackUrl=…` |
| `/dashboard/[ws]` | overview: outstanding / overdue / drafts / paid (one line per currency, never summed), to handle, recent invoices, recent changes |
| `/dashboard/[ws]/invoices` · `/[ref]` | list with filters and create; detail with every lifecycle action, lines, payment part, document preview, recurrence, issuer copy, history |
| `/dashboard/[ws]/recurrences` · `/[seq]` | series list (due / status); series detail with generate, pause/resume, total |
| `/dashboard/[ws]/companies` · `/[slug]` | issuing companies: list, create, edit, retire |
| `/dashboard/[ws]/history` · `/[seq]` | the imported archive, read-only, with the JSON import |
| `/dashboard/[ws]/settings` | the workspace: rename, members (make owner / remove, or leave), invitations (send, candidates, copy link, revoke), danger zone (delete — refused with the reason when it holds records) |
| `/dashboard/settings/*` | the account: profile, password, API tokens |

**The company switcher** in the header writes `?company=<slug>`; overview,
invoices, recurrences and history pass it to their route. No param = all
companies.

### Where things live

- `lib/client.ts` — **the only `fetch`**. Errors are `WebError` carrying the
  server's `error`, `code` and `suggestion`; every POST gets a fresh
  `Idempotency-Key`, as `bk` does.
- `lib/queries.ts` / `lib/query-keys.ts` — one TanStack Query hook per GET.
- `lib/mutations.ts` — one hook per write. `mutateAsync` resolves only after the
  affected queries have refetched, so a success toast never sits beside the old
  values (the bug the test scaffold's Playwright walk caught on 2026-09-18).
- `lib/ui-vocab.ts` — status → label + tone. Colours come from tokens only.
- `components/shell/**` — `BillingShell`, `PageHeader`/`PageBody`, the two
  switchers. `components/ui-kit/**` — sections, tiles, `DataTable` (a table on
  `md+`, cards below), states, `Money`, `DateText`, form fields.
- one folder per screen under `components/`.

### The rules the screens keep

- **Client components calling the routes `bk` calls.** No server actions. The
  only database reads in pages are the membership checks in
  `app/dashboard/page.tsx`, `app/dashboard/[ws]/layout.tsx` and
  `app/dashboard/settings/layout.tsx` (see the next section), and the
  invitation lookup in `app/invitations/[token]/page.tsx`. **The one page that
  writes** is `/dashboard`'s default-workspace bootstrap — next section but one.
- **Nothing the server derives is computed in the browser** — totals, the
  reference, the account, the next period, the problems list. `Money` prints
  the API's string; its only change is display grouping (`15’209.80`).
- **Errors show the server's sentence and suggestion**; success is a toast
  after the refetch.
- **`data-testid`s from the test scaffold are kept** on the equivalent
  elements (`input-<field>`, `invoice-row-<number>`, `field-<name>`, `error`,
  `done`, …); the few that changed are listed in the 2026-09-21 changelog entry.
- **No rendered string contains the brand** — the product name, the family
  name, the domain, the npm scope or a sibling product. Every one comes from
  `lib/app.ts` (`APP_NAME`, `PLATFORM_NAME`, `CONTACT_EMAIL`,
  `EMAIL_PLACEHOLDER`) or from `CLI_NPM_PACKAGE`, and a client component imports
  them directly: the values are inlined at build time by `next.config.js`
  `env`, which is what lets a client component read them at all
  (`docs/backend.md` → Branding). `lib/no-brand-literal.test.ts` refuses the
  next literal.


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

## The default workspace: `/dashboard` writes, once (phase 2, 2026-09-21)

A person signed in on another blackcode app arrives here on the shared session
cookie without ever taking this app's sign-in path — which is where the
workspace bootstrap (`ensureWorkspaceForUser`) runs. In production they got a
"No workspace yet" screen and a forced step.

So when a validated user with **no** billing workspace opens `/dashboard`
(without `?new=1`), the page:

1. opens their newest pending invitation, if they have one — somebody invited
   into an existing workspace should not land in an empty one of their own;
2. otherwise runs `ensureWorkspaceForUser` and redirects into the result.

**Why a page may write here, when no other page does:**

- it is the same function sign-in and `POST /api/auth/register` call, not a
  second implementation of workspace creation;
- it is idempotent — keyed on membership, re-checked inside its transaction —
  so a reload, two tabs or a race with a sign-in cannot mint two;
- membership is the whole gate (`lib/api.ts`), so it grants a tenant of their
  own and nothing else — no other app's data, nobody else's workspace;
- it runs only for `getValidatedSessionUser()`, on this app's own dashboard,
  which is as much a decision to use the app as signing in at its `/login`.

This reverses the phase-0 position at `createWorkspaceForUser` ("a tenant
appearing because somebody loaded a page is a tenant nobody decided to
create"); that function's header records the reversal. `NoWorkspace` is now a
failure screen only — the bootstrap threw — and shows the error, a retry, and
the manual create form.

`redirect()` throws `NEXT_REDIRECT`, so the page computes the target inside a
`try` and redirects outside it; a redirect inside the `try` would be caught and
reported as a failed bootstrap.

## Workspace administration and invitations (phase 2, 2026-09-21)

Every control is a route `bk` also calls — the table is in
`components/settings/workspace-settings.tsx`'s header.

- **Rename** is name-only; the slug is shown as fixed (the route answers 400
  `slug_immutable`).
- **Delete is refused-with-reason, not hidden.** The danger zone reads
  `GET …/companies?include_retired=true`: a workspace that has ever had a
  company cannot be deleted (every retained table hangs off a company), so the
  section explains the ten-year retention instead of offering a button. The
  route's 409 `workspace_retained` is still the authority; the read only saves
  somebody typing the slug for nothing. Delete confirms with `useConfirm`'s
  prompt and `requireMatch: <slug>` — never `window.prompt`.
- **Leave** is `DELETE …/members/{your id}` — the same route the owner uses to
  remove somebody. There is no `/leave` route. The owner has no Leave button:
  they transfer first.
- **Invitations are emailed** (`platform-email`, `email_sent` is the real
  result) and the link is still shown and copyable, per row too.
  `invite-candidates` feeds a `<datalist>` for the address field and a row of
  "people you already work with" chips; a super admin's platform-wide
  candidates go only into the datalist, never into that row.
- **The switcher's "Create workspace" opens `WorkspaceCreateModal`**, which
  wraps the same `CreateWorkspaceForm` as `/dashboard?new=1`, then writes the
  active workspace and navigates. Two forms for one route would be two places
  for validation to drift.
- **Account settings → delete my data** lists retention-held workspaces
  separately (`blocked_by[].reason === 'retention'`), and says invoices are
  kept for ten years; it no longer promises to delete them.

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
