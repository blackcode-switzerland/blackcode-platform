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
// Note there are no exclusions below. Reach for one LAST: writing the `routes`
// annotations is what surfaces the holes, and in `apps/issues` only two
// exclusions turned out to be genuine product decisions. An unexplained
// exclusion is how coverage quietly rots, so every entry must carry a reason.

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAppRoutes } from '@blackcode/platform-testing'
import { APP_SLUG } from './app'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

/**
 * Routes deliberately not reachable from the CLI at all. Each needs a reason.
 *
 * Reach for one LAST. Writing the `routes` annotations is what surfaces the
 * holes, and in `apps/issues` only two entries turned out to be genuine product
 * decisions. An unexplained exclusion is how coverage quietly rots.
 */
const EXCLUDED_PATHS = new Map<string, string>([
  [
    '/api/me/footprint',
    'session-only by design, the same reason `/api/me/password/*` carries — and here it ' +
      'is a capability decision as well as a technical one. GET is the census a ' +
      'whole-account close fans out (it forwards a COOKIE, because a token is valid at ' +
      'exactly one origin), and DELETE removes this app\'s data for the caller. Both ' +
      'inherit `DELETE /api/me`\'s settled reasoning: an agent must never delete its ' +
      'owner\'s data, and `Confirm()` is not a guard for agents — it auto-approves under ' +
      'BK_NO_PROMPT=1 and on a non-TTY. `requireSessionResolver` makes the route ' +
      'structurally unreachable from `bk` rather than merely unimplemented there',
  ],
  // Both entries arrived on 2026-08-11 with this app's self-signup, and both are
  // the same entries — for the same reasons — that `apps/issues` and
  // `apps/sales` carry. Copy them with the routes.
  [
    '/api/auth/{nextauth}',
    'NextAuth handler — browser session machinery, never called by the binary. It ' +
      'also exports via a list (`export { handler as GET, handler as POST }`), ' +
      'which the export-shape guard cannot read; excluding the PATH is what takes ' +
      'it out of that scan too',
  ],
  [
    '/api/auth/register',
    'browser sign-up. An agent authenticates with a `bk_live_…` token, which it can ' +
      'only hold because a human already created the account, so there is nothing ' +
      'here for `bk` to call. A command that created platform ACCOUNTS would be a ' +
      'much larger decision than a missing one — the account is shared across every ' +
      'deployment. The property that matters on this route is the whitelist gate, ' +
      'and it is asserted by lib/auth/register-gate.test.ts rather than by this file',
  ],
])

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * METHODS THIS APP DOES NOT SERVE ON A PATH IT DOES MOUNT (D-36, as amended)
 * ═══════════════════════════════════════════════════════════════════════════
 * You will need this the moment you mount your first platform route factory,
 * and the reason is not obvious: drift is scoped to paths this app has a FILE
 * for, so mounting `GET /api/workspaces/{ws}` puts EVERY platform claim on that
 * path — `PATCH`, `DELETE` — into your check, whether or not you export them.
 *
 * That is correct behaviour and not a bug to route around. **An app serving a
 * SUBSET of the platform surface is permanent and legitimate; an ACCIDENTAL
 * subset is a bug.** The test is: does every bare verb have a host, from THIS
 * app's login? `bk workspace edit` has one — the issues deployment — so not
 * serving it here is a decision. `bk workspace use` would NOT have had one, so
 * `GET` is mounted beside them.
 *
 * An entry here is a DECISION WITH A REASON, not a way to quiet a failure.
 * `EXCLUDED_PATHS` cannot express it: an exclusion pushes on coverage (`real`),
 * and it would remove the path from the very set drift compares against.
 *
 * The scaffold's three entries are real — it mounts the workspace reads and not
 * the writes — and they are also the worked example to copy.
 */
const UNSERVED_OPERATIONS = new Map<string, string>([
  [
    'POST /api/workspaces',
    'a workspace is the COMPANY (D-3). You are granted access to one; you do not ' +
      'open one from a new app. `bk workspace create` is answered by the issues ' +
      'deployment. GET is mounted beside it because `bk workspace use` cannot ' +
      'select a workspace without it — which is what made the sales north-star ' +
      'script fail at its second command.',
  ],
  [
    'PATCH /api/workspaces/{ws}',
    'renaming a workspace is company-level administration and `updateWorkspace` ' +
      'is still app-local to issues. This app READS the workspace it works in and ' +
      'does not administer it. `bk workspace edit` is answered by issues.',
  ],
  [
    'DELETE /api/workspaces/{ws}',
    'destroying a workspace carries a cascade with exactly one implementation, on ' +
      'purpose. Two deployments able to run it is two places for that cascade to ' +
      'diverge, and the failure would be unrecoverable. `bk workspace delete` is ' +
      'answered by issues.',
  ],
])

describe('CLI ↔ routes parity', () => {
  // There is no `hostsPlatformRoutes` to set, and that is one less thing to get
  // wrong when you copy this app (it was retired on 2026-08-07). Drift for a
  // PLATFORM command's route is scoped to the routes this app actually has a
  // file for, derived from the filesystem — so mounting `/api/me` puts that
  // route in your check and nothing else does, and forgetting to declare
  // anything is not a state you can be in.
  //
  // The other half — "is every platform command answerable by SOMEBODY?" — is
  // asserted once, for the whole repo, in packages/platform-testing's own suite.
  // Do not add a copy here: the failure "nobody serves GET /api/inbox" is not
  // your app's, and N copies of it tempt whoever hits it to fix their own.
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
  // injecting one and watching `next build` list a route parity had stopped
  // seeing. Detected rather than parsed, deliberately — a second, weaker route
  // extractor beside the authoritative one is a worse trade than a stated rule.
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

  // An exclusion outliving its reason is coverage quietly dropped, and it is the
  // failure mode nobody looks for: the entry keeps working, so nothing ever
  // draws attention to it. `allPaths` includes excluded routes, so an entry
  // pointing at a path this app no longer mounts is still detectable — which is
  // why the two sets are kept separate rather than subtracted from `real`.
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
