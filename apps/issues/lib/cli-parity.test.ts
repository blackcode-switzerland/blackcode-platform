// Parity guard: every API route must be reachable from the `bk` CLI.
//
// This replaces lib/openapi/parity.test.ts. The old test asked "does a
// hand-written document describe every route?" — which protected a copy of the
// truth. Now that the CLI is the only supported interface, the question that
// actually matters is "can an agent DO this?" A route with no command is a
// capability nobody can use; a command claiming a route that doesn't exist is a
// broken command waiting to be called.
//
// Both halves are asserted here. The third half — that every leaf command
// declares SOMETHING — lives in Go (cli/internal/commands/routes_test.go),
// because that's where the command tree is.
//
// The CLI's claims come from `bk __routes`, which walks the cobra tree and
// prints each leaf's `routes` annotation. We prefer running it via `go run`; if
// Go isn't available (some CI images run only the JS suite) we fall back to
// cli/routes.json, which `make routes` emits as a build artifact.
//
// ---------------------------------------------------------------------------
// KNOWN BLIND SPOT — read this before trusting a green run
// ---------------------------------------------------------------------------
// This guard sees routes a COMMAND annotates. It does not see the client layer.
// A method in cli/internal/client/ that names a route which does not exist is
// invisible here as long as no command calls it.
//
// That is not hypothetical. `client.UpdateWorkspaceMemberRole` sent PATCH to
// /api/workspaces/{ws}/members/{userId} — a DELETE-only route — from the day it
// was written until Phase 5 deleted it, through every green run of this file.
// It is the second guardrail hole of the same shape (the first: `routes`
// annotations were optional until routes_test.go made them mandatory), and the
// shape is what matters: a guard that reads declarations cannot see code that
// declares nothing.
//
// Left open on purpose. Closing it means extracting routes a second way — by
// parsing c.get/c.postJSON/... call sites and their format strings — which is a
// weaker route-extractor to keep honest alongside the authoritative one. The
// annotations are the contract; an unreferenced client method is dead code, and
// dead code is a review concern. State the scope honestly instead: this file
// proves every route is reachable from `bk`, and every route a command CLAIMS
// exists. It proves nothing about code no command reaches.

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAppRoutes } from '@blackcode/platform-testing'

// This app lives at apps/issues; the CLI stays at the monorepo root. Resolve the
// root from this file rather than from cwd, so the test gives the same answer
// whether it is run by `npm test` at the root, by turbo, or by vitest inside the
// app directory. Getting this wrong makes the guard silently unable to find the
// CLI — which reads as "the CLI claims nothing", not as an error.
const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

// Routes deliberately NOT reachable from the CLI. Each needs a reason — an
// unexplained entry here is how coverage quietly rots.
const EXCLUDED_PATHS = new Map<string, string>([
  // --- browser/session machinery ---
  ['/api/auth/{nextauth}', 'NextAuth handler — browser session machinery'],
  ['/api/auth/register', 'browser sign-up flow'],
  ['/api/auth/password-reset/request', 'browser password recovery'],
  ['/api/auth/password-reset/confirm', 'browser password recovery'],
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
  ['/api/me/password/request-otp', 'in-app password change; session-only by design'],
  ['/api/me/password/confirm', 'in-app password change; session-only by design'],
  ['/api/cli/authorize', 'the browser half of `bk login` — rendered for the user, not called by the binary'],

  // --- telemetry / status page ---
  ['/api/errors/client', 'client-error beacon (telemetry)'],
  ['/api/status', 'public health probe'],
  ['/api/status/errors', 'public status-page feed; triage is `bk super-admin errors`'],
  ['/api/status/errors/{id}', 'public status-page feed; triage is `bk super-admin errors`'],

  // --- retired surfaces (delete these entries when the 410 stubs go) ---
  ['/api/undo', 'retired 1.12.0: 410 Gone stub so a pre-1.12.0 binary that still has `bk undo` gets an actionable answer instead of an HTML 404'],
  ['/api/openapi.json', 'retired: 410 Gone deprecation stub'],
  ['/api/docs', 'retired: 410 Gone deprecation stub'],
])

// Individual METHOD+path pairs excluded where the rest of the path IS covered.
const EXCLUDED_OPERATIONS = new Map<string, string>([
  [
    'DELETE /api/me',
    'account deletion is irreversible and deliberately human-only (web UI, with confirmation)',
  ],
  [
    'PATCH /api/workspaces/{ws}/issues/reorder',
    'manual drag-and-drop ordering; meaningless outside the board UI',
  ],
  [
    'PATCH /api/workspaces/{ws}/projects/reorder',
    'manual drag-and-drop ordering; meaningless outside the board UI',
  ],
])

describe('CLI ↔ routes parity', () => {
  // There is no `hostsPlatformRoutes` any more, and its absence is the point.
  //
  // It was a hand-set boolean meaning "put every platform command's claim into
  // my drift check", and it could not express the state this repo is actually
  // in: an app serving a legitimate SUBSET of the platform surface. This app
  // mounts nearly all of it; `apps/sales` mounts some and never will mount
  // `bk inbox` or `bk super-admin errors`. Drift scope is now DERIVED from the
  // platform routes each app has a file for, and the "does anybody serve this
  // route?" half moved to packages/platform-testing's own suite, where it is one
  // failure for the repo rather than N copies of one. Full reasoning in the
  // header of @blackcode/platform-testing's cli-parity.ts (2026-08-07).
  const { real, allPaths, claimed, ownClaims, mountedPlatformRoutes, invisibleExports, cli } =
    collectAppRoutes(
      { appRoot: APP_ROOT, cliDir: CLI_DIR, appSlug: 'issues' },
      new Set(EXCLUDED_PATHS.keys())
    )
  const covered = claimed

  // Both sides of this guard are discovered by walking the filesystem, and both
  // paths are now computed from this file's location rather than from cwd. That
  // makes "found nothing" a real failure mode — and an empty set would make the
  // two coverage assertions below pass vacuously, reporting green while checking
  // nothing. Assert the inputs are non-empty before trusting any conclusion.
  it('discovers both sides (guards against a vacuous pass)', () => {
    expect(real.size, `no API routes found under ${join(APP_ROOT, 'app', 'api')}`).toBeGreaterThan(0)
    expect(
      cli.routes.length,
      `the CLI claims no routes at all — is ${CLI_DIR} the right directory?`
    ).toBeGreaterThan(0)
  })

  // The drift scope is derived from this set, so an empty one would silently
  // excuse every platform command's route from this app's check — the same
  // vacuous-green shape the retired flag's self-check guarded, kept because the
  // derivation replaced the declaration and not the reason for checking it.
  //
  // This app is the one that mounts nearly all of the platform surface, so a
  // near-empty set here means the mounts were removed, not that a subset is
  // intended. `apps/sales` legitimately has a small one and asserts nothing.
  it('still mounts the platform surface it is the host for', () => {
    expect(
      mountedPlatformRoutes.length,
      'no route in this app matches any platform command claim — either the CLI stopped ' +
        'tagging bare verbs with "platform" (check `bk __routes`), or the mounts were ' +
        'removed. Either way this suite is no longer checking what it says it checks.'
    ).toBeGreaterThan(10)
  })

  // A route can serve traffic and be INVISIBLE to the coverage check above:
  // `export const { GET } = handlers()` and `export { GET } from './x'` both
  // work and match none of the patterns `methodsOf` reads. Found on 2026-08-07
  // by injecting one into apps/sales — `next build` listed the route and parity
  // stayed green. Detected rather than parsed, deliberately: see
  // `invisibleMethodExports`.
  it('exports every handler in a form the guard can see', () => {
    const found = invisibleExports.map(
      (e) => `${e.file} exports ${e.methods.join(', ')} via an export list`
    )
    expect(
      found,
      'these route files export an HTTP method in a form this guard CANNOT SEE, so the ' +
        'route silently drops out of the coverage check while the app still serves it. ' +
        'Write `export const GET = …` (one line per method):\n' +
        found.join('\n')
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
        const op = `${m} ${url}`
        if (EXCLUDED_OPERATIONS.has(op)) continue
        if (!covered.has(op)) uncovered.push(op)
      }
    }
    expect(
      uncovered,
      'routes with no bk command — add one, or add a documented entry to ' +
        `EXCLUDED_PATHS / EXCLUDED_OPERATIONS in this file:\n${uncovered.join('\n')}`
    ).toEqual([])
  })

  it('every route the CLI claims actually exists (no drift)', () => {
    const drift: string[] = []
    for (const r of ownClaims) {
      const methods = real.get(r.path)
      if (!methods) {
        // Could be an excluded path the CLI legitimately touches (e.g. the blob
        // handshake inside `bk upload`) — check the raw filesystem before failing.
        if (!EXCLUDED_PATHS.has(r.path) && !pathExists(r.path)) {
          drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
        }
        continue
      }
      if (!methods.has(r.method)) {
        drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
      }
    }
    expect(
      drift,
      `bk claims routes that do not exist — fix the \`routes\` annotation:\n${drift.join('\n')}`
    ).toEqual([])
  })

  // `allPaths` includes the excluded routes, so an exclusion pointing at a
  // DELETED route is still detectable as stale — that is the whole point of
  // keeping them separate from `real`.
  const pathExists = (p: string) => allPaths.has(p)

  it('every exclusion names a route that still exists', () => {
    const stale: string[] = []
    for (const [path, reason] of EXCLUDED_PATHS) {
      if (!pathExists(path)) stale.push(`${path} — "${reason}"`)
    }
    for (const [op, reason] of EXCLUDED_OPERATIONS) {
      const path = op.slice(op.indexOf(' ') + 1)
      if (!pathExists(path)) stale.push(`${op} — "${reason}"`)
    }
    expect(
      stale,
      `these exclusions point at routes that no longer exist — delete them:\n${stale.join('\n')}`
    ).toEqual([])
  })
})
