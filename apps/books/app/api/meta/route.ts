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
import { apiHandler } from '@/lib/api'
import { BILAN_STRUCTURE, CR_STRUCTURE } from '@/lib/statements'
import {
  ENTRY_STATUS,
  EVIDENCE_TIERS,
  MANIFEST_STATES,
  RECOGNITION,
  SOURCE_LAYERS,
  SOURCE_STATUS,
  SOURCE_TYPES,
  TVA_RATES,
} from '@/lib/vocabularies'


/**
 * Unauthenticated on purpose, exactly as the platform's own meta route is: an
 * agent runs `bk meta` to discover the vocabularies BEFORE it has picked a
 * workspace, and nothing here is workspace-scoped or private. There are no
 * amounts and no names in this payload beyond the entity list, which is the
 * user's own books.
 */
export const GET = apiHandler(async (_req: NextRequest) => {
  return NextResponse.json({
    app: 'books',

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
