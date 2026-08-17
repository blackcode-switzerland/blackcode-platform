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
// WHY `entities` COMES FROM A FIXTURE TODAY
// ---------------------------------------------------------------------------
// Phase 0 adds no tables (docs/books-app-plan/phase-0-contract.md). The books a
// user creates live in `books.entity` from phase 1, and this route reads them
// from the database then. Until it does, the seeded three are served from
// `fixtures/mockup.json` so the frontend can build every screen against real
// shapes before the schema exists — which is the entire purpose of phase 0.
//
// It is a FIXTURE and it says so in the payload: `source: "fixture"`. A frontend
// that quietly ships against fake data believing it is real is the failure this
// field exists to prevent, and phase 1 flips it to `"database"`.
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
import fixture from '@/fixtures/mockup.json'
import type { Entity } from '@/lib/types'

/**
 * Unauthenticated on purpose, exactly as the platform's own meta route is: an
 * agent runs `bk meta` to discover the vocabularies BEFORE it has picked a
 * workspace, and nothing here is workspace-scoped or private. There are no
 * amounts and no names in this payload beyond the entity list, which is the
 * user's own books.
 */
export const GET = apiHandler(async (_req: NextRequest) => {
  const entities = fixture.ENTITIES as unknown as Entity[]

  return NextResponse.json({
    app: 'books',

    // ── THE BOOKS ────────────────────────────────────────────────────────
    // Any number of them. Three are seeded; nothing may assume three.
    entities: {
      source: 'fixture',
      note: 'Seeded from the mockup. Phase 1 serves these from books.entity, where the user creates them.',
      data: entities,
    },

    // Every exercice present in the data. One year today, and the model is
    // parameterised by (entity, exercice) from the first line of code so
    // multi-year is additive rather than a rewrite.
    exercices: [...new Set(entities.map((e) => e.exercice))].sort(),

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
