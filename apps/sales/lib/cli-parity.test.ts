// Parity guard for THIS app: every route reachable from `bk`, every route `bk`
// claims real.
//
// The check itself lives in `@blackcode/platform-testing` so every app runs the
// same one. What belongs here is only what is specific to this app: its slug and
// its exclusions.
//
// COPY THIS FILE when you copy the app. It is the guardrail that makes "the CLI
// is the only supported interface" true rather than aspirational — a route with
// no command is a capability agents cannot reach, and a command naming a route
// that does not exist is a broken command waiting to be called.
//
// There is ONE exclusion below and it is not a product capability. Reach for one
// LAST: writing the `routes` annotations is what surfaces the holes, and in
// `apps/issues` only two exclusions turned out to be genuine product decisions.
// An unexplained exclusion is how coverage quietly rots, so every entry must
// carry a reason.
//
// ---------------------------------------------------------------------------
// IT WENT GREEN WITH PHASE 4/5, AND IT WAS RED ON PURPOSE BEFORE THAT
// ---------------------------------------------------------------------------
// Phase 2 scaffolded the app with no routes and no commands, and the FIRST
// assertion below — "discovers both sides" — failed for exactly that reason.
// That assertion exists precisely so an app cannot pass this guard by having
// nothing to check (CLAUDE.md finding #5: `bk __routes` deduped two apps into
// one, and only this assertion made it visible). Turning it off, adding a
// "skip if empty" branch, or deleting the file in that window would have
// re-opened the hole it was written to close, in the one window where nobody
// would have noticed.
//
// VERIFIED 2026-08-07 (Phase 6), three ways, each watched failing and restored:
//   - a route with no command       → "no uncovered capability" RED
//   - that route re-exported via an export list → the coverage check goes quiet
//     and the INVISIBLE-EXPORT check fires instead. That is the pair working:
//     the first guard alone would have passed on it.
//   - the exclusion below removed   → the NextAuth route immediately fails the
//     invisible-export check, which is what proves the entry is load-bearing
//     rather than a string that matches nothing.

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAppRoutes } from '@blackcode/platform-testing'
import { APP_SLUG } from './app'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

/**
 * Routes deliberately not reachable from the CLI. Each needs a reason.
 *
 * Both entries are browser session machinery rather than product capabilities,
 * and neither is a capability an agent loses: an agent authenticates with a
 * `bk_live_…` token and reaches neither path.
 *
 * Excluding NextAuth's catch-all also settles how it exports its handlers: it
 * necessarily writes `export { handler as GET, handler as POST }`, which the
 * invisible-export check would otherwise flag. Exclusions are read FIRST for
 * that reason (`packages/platform-testing/src/cli-parity.ts`) — an excluded
 * route's methods are never compared against anything, so the form it exports
 * them in cannot hide a capability.
 */
const EXCLUDED_PATHS = new Map<string, string>([
  ['/api/auth/{nextauth}', 'NextAuth handler — browser session machinery, never called by the binary'],
  [
    '/api/auth/register',
    'browser sign-up flow (added 2026-08-10 with this app\'s self-signup). Same entry, ' +
      'same reason, in apps/issues: an agent authenticates with a `bk_live_…` token, ' +
      'which it can only hold because a human already created the account. A `bk` ' +
      'command that created platform accounts would be a much larger decision than a ' +
      'missing one — and the route is gated on the email whitelist, which is asserted ' +
      'by lib/auth/register-gate.test.ts rather than by this file',
  ],
  [
    '/api/cli/authorize',
    'the browser half of `bk login` (D-21) — the binary OPENS /cli/authorize in a browser and the ' +
      'page posts here; it never calls this route itself. Same entry, same reason, in apps/issues. ' +
      'Mounted rather than skipped because `bk login --server https://sales…` is a legitimate ' +
      'command and a 404 there is the invisible failure D-1 exists to remove',
  ],
])


/**
 * Platform operations this app MOUNTS THE PATH FOR and deliberately does not
 * serve, `"<METHOD> <path>"` → why.
 *
 * ---------------------------------------------------------------------------
 * WHY A METHOD-LEVEL EXCLUSION EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * The drift scope is by PATH: mount a platform route and this app becomes
 * responsible for every method `bk` claims on it. That coarseness is deliberate
 * and worth keeping — scoping by (method, path) would make the check vacuous,
 * since it would only ever ask about methods that already exist.
 *
 * So the one legitimate case — "this app serves GET here and will never serve
 * POST" — needs to be SAID, and saying it is the point. Reach for this last;
 * writing the annotation is what surfaces the holes.
 *
 * Kept honest by the staleness assertion at the bottom of this file: an entry
 * naming a path this app no longer mounts fails the suite.
 */
const UNSERVED_OPERATIONS = new Map<string, string>([
  [
    'POST /api/workspaces',
    'D-3 — a workspace is the COMPANY, and sales has no create-workspace flow: ' +
      'you are granted access to one, you do not open one from a sales context. ' +
      '`bk workspace create` is answered by the issues deployment. GET is mounted ' +
      'beside it because `bk workspace use` cannot select a workspace without it, ' +
      'which is what made the north-star script fail at its second command.',
  ],
  [
    'PATCH /api/workspaces/{ws}',
    'renaming a workspace is company-level administration and `updateWorkspace` is ' +
      'still app-local to issues. Sales READS the workspace it works in (GET is ' +
      'mounted — `bk workspace use` resolves a slug through it) and does not ' +
      'administer it. `bk workspace edit` is answered by the issues deployment.',
  ],
  [
    'DELETE /api/workspaces/{ws}',
    'destroying a workspace carries a cascade with exactly one implementation, on ' +
      'purpose. Two deployments able to run it is two places for that cascade to ' +
      'diverge, and the failure would be unrecoverable. `bk workspace delete` is ' +
      'answered by the issues deployment.',
  ],
])

describe('CLI ↔ routes parity', () => {
  // There is no `hostsPlatformRoutes`, retired on 2026-08-07 — and this app is
  // why. It could not express "serves SOME of the platform surface", which is
  // this app's permanent state rather than a build-out one: sales will never
  // serve `bk inbox` (per-user, cross-workspace), `bk super-admin errors`
  // (platform-wide data, any host answers) or `bk storage list` (D-28: one
  // ledger, one quota, same rows from every deployment).
  //
  // Drift for a PLATFORM claim is now scoped to the routes this app actually has
  // a file for. Mount `/api/meta` and that route joins this check; nothing else
  // does. The other half — "is every platform command answerable by SOMEBODY?" —
  // is asserted once for the whole repo in packages/platform-testing's suite.
  const { real, allPaths, claimed, ownClaims, appOwnClaims, invisibleExports, cli } = collectAppRoutes(
    { appRoot: APP_ROOT, cliDir: CLI_DIR, appSlug: APP_SLUG },
    new Set(EXCLUDED_PATHS.keys())
  )

  // Both sides are discovered by walking the filesystem, so "found nothing" is a
  // real failure mode — and an empty set makes the two assertions below pass
  // while checking nothing. Assert the inputs before trusting the conclusions.
  it('discovers both sides (guards against a vacuous pass)', () => {
    expect(real.size, `no API routes found under ${join(APP_ROOT, 'app', 'api')}`).toBeGreaterThan(0)
    expect(cli.routes.length, `the CLI claims no routes — is ${CLI_DIR} right?`).toBeGreaterThan(0)
    expect(
      appOwnClaims.length,
      `no bk command is ATTRIBUTED to "${APP_SLUG}" — is the command group registered in cli/internal/commands/root.go, ` +
        'and does cli/internal/guide/topics/ have a directory named for this app? ' +
        'Route attribution comes from the guide section list.\n' +
        'This asserts on `appOwnClaims`, NOT `ownClaims`: the latter also counts every ' +
        'PLATFORM route this app mounts, which kept it non-empty with attribution ' +
        'totally broken. Watched fail 2026-08-07 — see the field\'s header.'
    ).toBeGreaterThan(0)
  })

  // A route can serve traffic and be INVISIBLE to the coverage check above:
  // `export const { GET } = handlers()` and `export { GET } from './x'` both
  // work and match none of the patterns `methodsOf` reads, so the route drops
  // out of the check while the app still serves it. Found on 2026-08-07 by
  // injecting one INTO THIS APP — `next build` listed the route and parity
  // stayed green. Detected rather than parsed, deliberately: a second, weaker
  // route extractor beside the authoritative one is a worse trade than a rule.
  it('exports every handler in a form the guard can see', () => {
    const found = invisibleExports.map(
      (e) => `${e.file} exports ${e.methods.join(', ')} via an export list`
    )
    expect(
      found,
      'these route files export an HTTP method in a form this guard CANNOT SEE. ' +
        'Write `export const GET = …`, one line per method:\n' + found.join('\n')
    ).toEqual([])
  })

  it('every leaf command declares its routes', () => {
    expect(
      cli.commands_unannotated,
      `these bk commands have no \`routes\` annotation:\n${cli.commands_unannotated.join('\n')}`
    ).toEqual([])
  })

  it('every API route is reachable from bk (no uncovered capability)', () => {
    const uncovered: string[] = []
    for (const [url, methods] of real) {
      for (const m of methods) {
        if (!claimed.has(`${m} ${url}`)) uncovered.push(`${m} ${url}`)
      }
    }
    expect(
      uncovered,
      `routes with no bk command — add one, or add a documented EXCLUDED_PATHS entry:\n${uncovered.join('\n')}`
    ).toEqual([])
  })

  it('every route this app claims actually exists (no drift)', () => {
    const drift: string[] = []
    for (const r of ownClaims) {
      if (UNSERVED_OPERATIONS.has(`${r.method} ${r.path}`)) continue
      const methods = real.get(r.path)
      if (!methods || !methods.has(r.method)) {
        drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
      }
    }
    expect(
      drift,
      `bk claims routes that do not exist — fix the \`routes\` annotation:\n${drift.join('\n')}`
    ).toEqual([])
  })

  // An exclusion outliving its reason is coverage quietly dropped. `allPaths`
  // includes excluded routes, so an entry pointing at a path this app no longer
  // mounts is still detectable — which is why the two sets are kept separate.
  it('every exclusion names a route this app still has', () => {
    const stale: string[] = []
    for (const [path, reason] of EXCLUDED_PATHS) {
      if (!allPaths.has(path)) stale.push(`${path} — "${reason}"`)
    }
    for (const [op, reason] of UNSERVED_OPERATIONS) {
      const path = op.slice(op.indexOf(' ') + 1)
      if (!allPaths.has(path)) stale.push(`${op} — "${reason}"`)
    }
    expect(
      stale,
      `these exclusions point at routes this app no longer has — delete them:\n${stale.join('\n')}`
    ).toEqual([])
  })
})
