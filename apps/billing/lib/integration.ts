// THE PUBLIC SURFACE: the routes an outside system may rely on.
//
// ===========================================================================
// THIS FILE AMENDS A PLATFORM RULE, AND THE AMENDMENT IS DELIBERATE
// ===========================================================================
// `docs/backend.md` and CLAUDE.md both say the HTTP API is private plumbing and
// that the `bk` CLI is its only supported client. That rule protects a real
// property: a route and its command change together in one commit without
// breaking anybody, which is what retiring the OpenAPI spec bought.
//
// b/billing is the first app that has to serve an outside system's backend
// directly — decision **D-B5**, `docs/billing-app-plan/integration-surface.md`.
// The alternative (they shell out to `bk`) was weighed and lost: `bk` is a
// product for people and agents, not a library to embed.
//
// **What the amendment keeps:** every route NOT in the list below is exactly as
// private as it was. For the routes inside it, the breaking change becomes
// explicit instead of impossible — a changelog entry marked breaking, and a
// contract hash that moves.
//
// **What killed the old spec was hand-maintenance, not the idea of a contract.**
// Nothing here is typed twice: this array has four readers and a test.
//
// ===========================================================================
// THE FOUR READERS
// ===========================================================================
// | Reader | What it does with this |
// |---|---|
// | `GET /api/meta` | serves it under `apps.billing.integration`, in the ANONYMOUS half — so a customer's developer can read which routes are public without a credential |
// | `/integration` | a page on the deployment, rendering this list plus the conventions. It describes the version they are RUNNING, which a hosted spec cannot |
// | `lib/integration.test.ts` | every declared path has a file exporting that method, and every declared route has a `bk` command |
// | `bk meta` | prints it. No new command |
//
// Being under `apps.<slug>` in `/api/meta` puts it inside `contractVersion`
// automatically, because that hash covers everything served there
// (`packages/platform-api/src/contract-version.ts`). So adding a route here
// moves the hash and tells every agent its cached copy is stale — without
// anybody remembering to bump anything.

export interface PublicRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Exactly as `bk __routes` spells it, with `{ws}` and `{ref}` placeholders. */
  path: string
  /** The date this route became public, for the reader of the page. */
  since: string
  /** One line: what an integrator uses it for. */
  purpose: string
}

/**
 * The declared public surface.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 * Every account route: `/api/me`, `/api/tokens`, the four password routes,
 * `/api/cli/authorize`, `/api/me/footprint`. Those are the platform's identity
 * surface, shared by four apps, and making one public here would be committing
 * three other apps to a contract they never agreed to.
 *
 * Also absent: `POST /api/workspaces`. A tenant is created by a person, once,
 * in a browser — not by an integration.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    method: 'POST',
    path: '/api/workspaces/{ws}/invoices',
    since: '2026-09-17',
    purpose:
      'Create a draft invoice. REQUIRES an Idempotency-Key: the number is gapless and the row ' +
      'is never deleted, so an unguarded retry mints a second real bill.',
  },
  {
    method: 'GET',
    path: '/api/workspaces/{ws}/invoices',
    since: '2026-09-17',
    purpose:
      'List invoices. Filters: company, status, currency, external_ref. Paginate with limit and cursor.',
  },
  {
    method: 'GET',
    path: '/api/workspaces/{ws}/invoices/{ref}',
    since: '2026-09-17',
    purpose:
      'One invoice by #number or by its printed number, with its lines and its derived totals.',
  },
  {
    method: 'PATCH',
    path: '/api/workspaces/{ws}/invoices/{ref}',
    since: '2026-09-17',
    purpose:
      'Edit a draft. Once an invoice is sent, the document half is frozen and the refusal names which field.',
  },
  {
    method: 'GET',
    path: '/api/workspaces/{ws}/companies',
    since: '2026-09-17',
    purpose:
      'The issuing companies, so an integration can map its own entities onto them. Read-only: ' +
      'a company carries bank details and is configured by a person.',
  },
  {
    method: 'GET',
    path: '/api/workspaces/{ws}/audit',
    since: '2026-09-17',
    purpose:
      'The event feed. Pass since=<seq> for rows ascending from a cursor; this is how you learn ' +
      'a bill was sent, paid or voided by somebody in the browser.',
  },
] as const

/**
 * The conventions, stated once, for the `/integration` page.
 *
 * Prose rather than a schema, because these are the facts an integrator gets
 * wrong on day one and a schema does not carry any of them.
 */
export const CONVENTIONS = [
  {
    title: 'Authentication',
    body:
      'Authorization: Bearer bk_live_… — one token, minted in the browser at /settings/tokens by ' +
      'the person who owns it. Minting is session-only by design: a token that could mint another ' +
      'token is privilege escalation, because revoking the first would not revoke what it created.',
  },
  {
    title: 'Idempotency',
    body:
      'Send Idempotency-Key on every POST. The same key with the same body replays the stored ' +
      'response and sets Idempotent-Replayed: true. The same key with a DIFFERENT body is refused ' +
      'with 422 rather than replayed. A key is replayable for 24 hours.',
  },
  {
    title: 'Money and dates',
    body:
      'Every amount is a decimal string ("1590.00"), never a number — a JSON number is a float64 ' +
      'and is silently wrong in the last rappen. Every date is YYYY-MM-DD with no time and no zone.',
  },
  {
    title: 'Lists',
    body:
      'Lists answer { data, next_cursor }. OPEN the envelope; do not cast around it. next_cursor ' +
      'is opaque — pass it back as ?cursor= — and null means this was the last page.',
  },
  {
    title: 'Errors',
    body:
      'Every 4xx and 5xx carries { code, error, suggestion }. `error` is one sentence for a ' +
      'person and `suggestion` is the recovery; SWITCH ON `code`, never on the sentence. ' +
      'Note the field is `error` rather than `message` — a client reading `message` gets ' +
      'undefined on every refusal.',
  },
  {
    title: 'Correlating with your own records',
    body:
      'Put your identifier in external_ref (unique per workspace) and anything else in metadata ' +
      '(a flat map of string to string, 50 keys). Both are filterable and both stay writable after ' +
      'an invoice is sent, because they are your bookkeeping rather than the document.',
  },
  {
    title: 'Checking our arithmetic against yours',
    body:
      'Send expected_total on a create. If it disagrees with what we derive, the invoice is refused ' +
      'with 409 and nothing is allocated — and the message names the company’s rounding policy and ' +
      'whether its prices include VAT, which is what explains almost every disagreement.',
  },
  {
    title: 'What changes, and how you hear about it',
    body:
      'A public route changes only additively. A breaking change is a new path, or a dated entry in ' +
      'the changelog marked breaking, published at least thirty days before the deploy. Poll ' +
      'contract_version from /api/meta to know whether anything moved; read /api/changelog to learn what.',
  },
] as const
