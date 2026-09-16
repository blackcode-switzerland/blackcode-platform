// Every limit this app enforces, declared ONCE.
//
// ===========================================================================
// THE RULE: A NUMBER WITH MORE THAN ONE READER HAS EXACTLY ONE SOURCE
// ===========================================================================
// A limit is declared here, imported by the route that enforces it, and served
// by `/api/meta` so an agent can read the current value rather than a remembered
// one. **Never re-typed** — not in a help string, not in a guide topic, not in a
// client-side `maxLength`.
//
// `cli/internal/guide/guide_test.go` fails the build on a topic that hardcodes a
// size or a count, and the reason it matches by SHAPE rather than by value is
// CLAUDE.md finding #9: the guard's first version banned the CORRECT spelling of
// a limit and passed a stale one, so the only case it could not catch was a
// topic that had gone out of date.
//
// The shared limits — upload size, blocked MIME types — live in
// `packages/platform-api/src/limits.ts`. This file is for limits that are this
// app's own.
//
// ===========================================================================
// WHAT IS NOT HERE YET
// ===========================================================================
// Phase 1 adds the metadata caps from
// `docs/billing-app-plan/integration-surface.md` §3 (50 keys, 40 characters per
// key, 500 per value, following Stripe's so a caller migrating from it keeps its
// data) and the 140-character payment-message budget that phase 2's QR payload
// shares with billing information. Phase 2 adds the 997-character payload cap.
//
// **There is deliberately no `VAT_ROUNDING_STEP` here, and there will not be.**
// An earlier draft of the plan declared one. Decision D-B7 replaced it with
// `billing.company.rounding`, a per-company policy, because two companies in one
// workspace may keep different books — so the value is data, and a constant
// would have been a second, contradicting source. See phase 1's Derivations.

/**
 * `billing.workspaces.name` is `varchar(80)`.
 *
 * Declared here and imported by `POST /api/workspaces` so the route's 400 and
 * the column cannot disagree. The web form's `maxLength` is the same number
 * typed by hand, and that is the one place a copy is tolerated: importing this
 * module into a client component would pull the barrel into the browser bundle
 * for one integer, and the route's own 400 carries the number and a suggestion
 * when a caller exceeds it anyway.
 */
export const WORKSPACE_NAME_MAX = 80
