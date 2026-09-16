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
