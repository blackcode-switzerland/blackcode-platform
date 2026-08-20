// GET /api/meta — `bk meta`
//
// The DYNAMIC half of what an agent needs to know: the values that can change
// without a release of the `bk` binary. The static half — how the commands
// behave, their flags and exit codes — is embedded in the binary and served by
// `bk guide`.
//
// That split is a platform rule, and the practical consequence is that no help
// text and no guide topic may restate anything served here. A `--help` string
// listing the recognition states is confidently wrong the first time one changes,
// with nothing to say so.
//
// ---------------------------------------------------------------------------
// THIS ROUTE NEEDS NO NEW CLI COMMAND
// ---------------------------------------------------------------------------
// `GET /api/meta` is already claimed by `bk meta`, a PLATFORM bare verb
// (cli/internal/commands/platform/meta.go). Parity scopes a platform command's
// route to the apps that actually have a file for it, so mounting this file is
// what puts books in that check — no per-app command, and adding one would be a
// second claim on the same route.
//
// ---------------------------------------------------------------------------
// `entities` NOW COMES FROM THE DATABASE (phase 1)
// ---------------------------------------------------------------------------
// It was served from `fixtures/mockup.json` through phase 0, marked
// `source: "fixture"`, so the frontend could build every screen against real
// shapes before any table existed.
//
// `books.entity` exists now, so this reads it. **`source` is kept in the payload**
// rather than deleted: a frontend that quietly ships against fake data believing it
// is real is the failure the field exists to prevent, and a reader of a deployed
// `/api/meta` should still be able to tell which they are looking at.
//
// This route is UNAUTHENTICATED, so it cannot resolve a workspace and therefore
// cannot list one user's books. It reports the vocabularies and the law, and says
// where the books actually come from. `bk books entity list` is the scoped read.
import { NextRequest, NextResponse } from 'next/server'
import { platformMetaBlock } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { BILAN_STRUCTURE, CR_STRUCTURE } from '@/lib/statements'
import {
  ENTRY_STATUS,
  EVIDENCE_TIERS,
  MANIFEST_STATES,
  RECOGNITION,
  RULE_CONFIDENCE,
  RULE_REVIEW_STATES,
  SOURCE_LAYERS,
  SOURCE_STATUS,
  SOURCE_TYPES,
  TVA_RATES,
  VERDICT_STATES,
} from '@/lib/vocabularies'


/**
 * ANONYMOUS CALLERS STILL GET THE VOCABULARIES. AUTHENTICATED ONES ALSO GET THE
 * ADDRESS BOOK — AND WITHOUT THAT, `bk books` COULD NOT BOOTSTRAP AT ALL.
 *
 * ── BALA'S #57, 2026-08-20: "blocking for deployment" ──────────────────────
 * Driving the CLI the way a first-time user does, against a books server:
 *
 *   $ bk login --server http://localhost:3200      # succeeds, token minted
 *   $ bk books entity list
 *   no app registry yet, so `bk books …` has no address to use
 *
 * `bk login` and `bk meta` learn every app's address from `apps.<slug>.base_url`
 * in THIS payload (cli/internal/config/config.go:43). This route served no
 * `apps` block and no `user`, so logging in against books wrote an EMPTY
 * registry. `platform.apps` carried the books row the whole time — only the
 * issues deployment ever served it. In any deployment where issues is not
 * reachable, a first-time books user could not bootstrap the CLI, and it was
 * invisible from inside the app because the login half worked perfectly.
 *
 * ── WHY THE FIX IS HERE AND NOT A CLI FALLBACK ─────────────────────────────
 * The report left the choice open: books' meta carries the address book, or
 * `bk login` falls back to the home server. It has to be this end. A fallback
 * would paper over ANY app that fails to serve its own registry, and would do
 * it silently — which is precisely the property that let this reach a
 * deployment review. An app that cannot say where it lives should fail
 * visibly, once, rather than be rescued by every client forever.
 *
 * `apps/sales` has always called `platformMetaBlock` here; books is the app
 * that diverged. This restores the platform contract.
 *
 * ── AND THE ANONYMOUS HALF IS KEPT, BECAUSE IT COSTS NOTHING ───────────────
 * The original header's reasoning stands on its own: an agent runs `bk meta` to
 * learn the vocabularies BEFORE it has picked a workspace, and nothing in the
 * vocabulary half is workspace-scoped or private. So auth is not REQUIRED here
 * as it is in sales and issues — it is used when it is offered. An unauthenticated
 * call gets exactly the payload it got before this change; an authenticated one
 * gets that plus who it is and where every app lives.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  // Offered, not demanded: `resolveUser` reads a bearer token or a session
  // cookie and answers null for neither.
  const user = await appContext.resolveUser(req)
  const platform = user
    ? await platformMetaBlock(appContext, req, user, {
        currentApp: {
          // What books contributes to its own registry entry. The same constants
          // the payload below serves, so the two can never disagree.
          vocabularies: {
            recognition: RECOGNITION,
            evidence_tiers: EVIDENCE_TIERS,
            entry_status: ENTRY_STATUS,
            source_types: SOURCE_TYPES,
            source_layers: SOURCE_LAYERS,
            source_status: SOURCE_STATUS,
            manifest_states: MANIFEST_STATES,
            verdict_states: VERDICT_STATES,
            rule_review_states: RULE_REVIEW_STATES,
            rule_confidence: RULE_CONFIDENCE,
          },
          tva_rates: TVA_RATES,
        },
      })
    : null

  return NextResponse.json({
    app: 'books',

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

    // ── THE BOOKS ────────────────────────────────────────────────────────
    // Any number of them, and this route cannot name them: it is
    // unauthenticated by design, so it has no workspace to read.
    entities: {
      source: 'database',
      table: 'books.entity',
      note: 'Books are workspace-scoped. Read them with `bk books entity list`, or GET /api/workspaces/{ws}/entities.',
    },

    // ── THE VOCABULARIES ─────────────────────────────────────────────────
    // Colour and icon travel with the value, so a new state needs no frontend
    // release. Evidence tiers carry their legal consequence in `note`.
    vocabularies: {
      recognition: RECOGNITION,
      evidence_tiers: EVIDENCE_TIERS,
      entry_status: ENTRY_STATUS,
      source_types: SOURCE_TYPES,
      source_layers: SOURCE_LAYERS,
      source_status: SOURCE_STATUS,
      manifest_states: MANIFEST_STATES,
      // Phase 5: the Devil's Advocate's verdicts, and the rules' review lifecycle.
      verdict_states: VERDICT_STATES,
      rule_review_states: RULE_REVIEW_STATES,
      rule_confidence: RULE_CONFIDENCE,
    },

    tva_rates: TVA_RATES,

    // ── THE LAW ──────────────────────────────────────────────────────────
    // Served so the frontend renders the legal line list without duplicating it,
    // and so a reader can see the order the statements must follow. These are
    // code constants (lib/statements.ts): read-only here, and not editable
    // anywhere.
    statements: {
      bilan: BILAN_STRUCTURE,
      cr: CR_STRUCTURE,
    },
  })
})
