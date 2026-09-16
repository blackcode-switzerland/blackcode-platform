// GET /api/meta — `bk meta`
//
// The DYNAMIC half of what an agent needs to know: the values that can change
// without a release of the `bk` binary. The static half — how the commands
// behave, their flags and exit codes — is embedded in the binary and served by
// `bk guide`.
//
// That split is a platform rule, and the practical consequence is that no help
// text and no guide topic may restate anything served here. A `--help` string
// listing the invoice statuses is confidently wrong the first time one changes,
// with nothing to say so.
//
// ---------------------------------------------------------------------------
// THIS ROUTE NEEDS NO NEW CLI COMMAND
// ---------------------------------------------------------------------------
// `GET /api/meta` is already claimed by `bk meta`, a PLATFORM bare verb
// (cli/internal/commands/platform/meta.go). Parity scopes a platform command's
// route to the apps that actually have a file for it, so mounting this file is
// what puts billing in that check — no per-app command, and adding one would be
// a second claim on the same route.
//
// ---------------------------------------------------------------------------
// MOUNTING IT IS WHAT MAKES `bk login --server <billing>` WORK AT ALL
// ---------------------------------------------------------------------------
// `bk login` and `bk meta` learn every app's address from `apps.<slug>.base_url`
// in THIS payload (cli/internal/config/config.go). An app that serves no `apps`
// block writes an EMPTY registry, and then every `bk billing …` command on that
// machine fails with "no server known for app billing".
//
// b/books shipped exactly that and it was invisible from inside the app, because
// the login half worked perfectly: a token was minted, and the next command had
// nowhere to send. `platform.apps` carried the row the whole time — only the
// issues deployment ever served it. So this is not optional plumbing; it is the
// bootstrap.
//
// ---------------------------------------------------------------------------
// THE SPELLING IS `vocabulary`, SINGULAR
// ---------------------------------------------------------------------------
// Matching `apps/issues` and `apps/sales`. b/books serves `vocabularies`, and
// that one divergence is why `cli/internal/commands/platform/meta_vocab.go`
// carries a two-spelling decoder — a parser that exists only because one app
// chose a different plural. Do not add a third spelling.
//
// ---------------------------------------------------------------------------
// ANONYMOUS CALLERS STILL GET THE VOCABULARIES
// ---------------------------------------------------------------------------
// An agent runs `bk meta` to learn the vocabularies BEFORE it has picked a
// workspace, and nothing in the vocabulary half is workspace-scoped or private.
// So auth is offered rather than demanded: an unauthenticated call gets the
// vocabularies, an authenticated one gets those plus who it is and where every
// app lives.
//
// `docs/billing-app-plan/integration-surface.md` §1 puts the public-route
// declaration in this same anonymous half, for the same reason and with one
// extra one: it is a customer's integration documentation, and requiring a
// credential to read which routes are public would be a strange front door.
// That block arrives with phase 1's `lib/integration.ts`.
import { NextRequest, NextResponse } from 'next/server'
import { platformMetaBlock } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { APP_SLUG } from '@/lib/app'
import {
  ACTOR_VIA,
  AUDIT_ACTIONS,
  DOCUMENT_LANGUAGES,
  INVITATION_STATUSES,
  INVOICE_STATUSES,
  MEMBER_ROLES,
  REFERENCE_TYPES,
  ROUNDING_POLICIES,
} from '@/lib/vocabularies'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  METADATA_LIMITS,
  PAYMENT_MESSAGE_MAX,
  WORKSPACE_NAME_MAX,
} from '@/lib/limits'
import { CONVENTIONS, PUBLIC_ROUTES } from '@/lib/integration'

/**
 * What this app contributes to its own registry entry, and it is the same
 * constants the payload below serves — so the two can never disagree.
 *
 * This is also what `contractVersion` hashes
 * (`packages/platform-api/src/contract-version.ts`): everything under
 * `apps.<slug>`. Which means a value added here moves the hash and tells every
 * agent its cached copy is stale, and a value added ONLY to the payload below
 * does not. Put a vocabulary in both.
 */
function currentApp() {
  return {
    vocabulary: {
      member_roles: MEMBER_ROLES,
      invitation_statuses: INVITATION_STATUSES,
      invoice_statuses: INVOICE_STATUSES,
      reference_types: REFERENCE_TYPES,
      document_languages: DOCUMENT_LANGUAGES,
      rounding_policies: ROUNDING_POLICIES,
      audit_actions: AUDIT_ACTIONS,
      actor_via: ACTOR_VIA,
    },
    limits: {
      workspace_name_max: WORKSPACE_NAME_MAX,
      payment_message_max: PAYMENT_MESSAGE_MAX,
      page_size_default: LIST_LIMIT_DEFAULT,
      page_size_max: LIST_LIMIT_MAX,
      metadata: METADATA_LIMITS,
    },
    // ── THE PUBLIC SURFACE, IN THE ANONYMOUS HALF ──────────────────────────
    // Decision D-B5. Served here so it rides inside `contractVersion` — which
    // hashes everything under `apps.<slug>` — meaning a route added to
    // `PUBLIC_ROUTES` moves the hash and tells every agent its cached copy is
    // stale, with nobody having to remember to bump anything.
    //
    // Anonymous on purpose: this is a customer's integration documentation, and
    // requiring a credential to read WHICH routes are public would be a strange
    // front door.
    integration: {
      routes: PUBLIC_ROUTES,
      conventions: CONVENTIONS,
      note:
        'These routes are a declared public contract and change only additively. ' +
        'Everything else under /api is private plumbing with no stability promise — ' +
        'the `bk` CLI is its only supported client.',
    },
  }
}

export const GET = apiHandler(async (req: NextRequest) => {
  // Offered, not demanded: `resolveUser` reads a bearer token or a session
  // cookie and answers null for neither.
  const user = await appContext.resolveUser(req)
  const platform = user
    ? await platformMetaBlock(appContext, req, user, { currentApp: currentApp() })
    : null

  return NextResponse.json({
    app: APP_SLUG,

    // ── WHO, WHERE, AND THE ADDRESS BOOK ─────────────────────────────────
    // Null for an anonymous caller, which is what the vocabulary-only half is
    // for. `apps` is what `bk login` writes into its registry.
    user: platform?.meta.user ?? null,
    active_workspace: platform?.meta.active_workspace ?? null,
    workspaces: platform?.meta.workspaces ?? [],
    current_app: platform?.meta.current_app ?? null,
    apps: platform?.meta.apps ?? null,
    links: platform?.meta.links ?? null,
    cli: platform?.meta.cli ?? null,

    // ── THE VOCABULARIES AND LIMITS, FOR AN ANONYMOUS CALLER TOO ─────────
    // Served flat here as well as nested under `apps.billing`, which is what
    // `apps/issues` and `apps/sales` do. The nested copy is the one the contract
    // hash covers and the one `bk meta` reads; the flat copy is what a person
    // curling this route sees first.
    ...currentApp(),

    // ── WHAT THIS APP HOLDS, AND WHAT IT DOES NOT YET ────────────────────
    // Said plainly rather than left to be inferred from an empty payload. An
    // agent that reads this in phase 0 and concludes the app is broken has read
    // it correctly-but-wrongly, and one sentence prevents that.
    entities: {
      source: 'database',
      tables: ['billing.company', 'billing.invoice', 'billing.invoice_line', 'billing.audit'],
      note:
        'Companies and invoices are workspace-scoped, so this unauthenticated route cannot ' +
        'list them. Read them with `bk billing company list` and `bk billing invoice list`, ' +
        'or GET /api/workspaces/{ws}/invoices. The payment reference, the QR payload and the ' +
        'PDF arrive in phase 2; sending, paid and void in phase 3.',
    },
  })
})
