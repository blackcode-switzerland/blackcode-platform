// The declared public surface is real, and reachable from `bk`.
//
// ===========================================================================
// WHAT THIS GUARDS, AND WHY THE DECLARATION NEEDS GUARDING AT ALL
// ===========================================================================
// `lib/integration.ts` is the one hand-written list this app adds, and it is a
// PROMISE to somebody outside the repo. The two ways it can become a lie:
//
//   1. **A declared route does not exist.** An integrator reads the page, calls
//      it, and gets a 404 — having been told in writing that it was supported.
//   2. **A declared route has no `bk` command.** That does not break the
//      integrator, but it breaks the platform's own rule: the CLI is the whole
//      product, and a publicly-promised capability that agents cannot reach is
//      the drift `cli-parity.test.ts` exists to prevent, one level up.
//
// The spec that was retired in 2026-08 was a hand-maintained copy of facts that
// lived elsewhere. This list is not a copy of anything — it is a decision — but
// it names things that live elsewhere, and those names are checked.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAppRoutes } from '@blackcode/platform-testing'
import { PUBLIC_ROUTES, CONVENTIONS } from './integration'
import { APP_SLUG } from './app'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

/** `/api/workspaces/{ws}/invoices/{ref}` → `app/api/workspaces/[ws]/invoices/[ref]/route.ts`. */
function routeFileFor(path: string): string {
  const segments = path
    .replace(/^\/api\//, '')
    .split('/')
    .map((s) => (s.startsWith('{') ? `[${s.slice(1, -1)}]` : s))
  return join(APP_ROOT, 'app', 'api', ...segments, 'route.ts')
}

describe('the declared public surface', () => {
  it('is not empty (guards against a vacuous pass)', () => {
    // Every assertion below iterates the list, so an empty one passes them all
    // while promising nothing — and a reader of `/api/meta` would see an empty
    // `integration` block and conclude the app has no public surface rather
    // than that the declaration had been emptied.
    expect(PUBLIC_ROUTES.length, 'PUBLIC_ROUTES is empty').toBeGreaterThan(0)
    expect(CONVENTIONS.length, 'CONVENTIONS is empty').toBeGreaterThan(0)
  })

  it('declares no route twice', () => {
    const seen = PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`)
    expect(seen).toEqual([...new Set(seen)])
  })

  it('every declared route has a file exporting that method', () => {
    const missing: string[] = []
    for (const r of PUBLIC_ROUTES) {
      const file = routeFileFor(r.path)
      if (!existsSync(file)) {
        missing.push(`${r.method} ${r.path} — no file at ${file.replace(APP_ROOT, '.')}`)
        continue
      }
      const src = readFileSync(file, 'utf8')
      // The same spelling `cli-parity.test.ts` reads: `export const GET = …`,
      // one line per method. A destructured export serves traffic and is
      // invisible to both guards.
      if (!new RegExp(`export\\s+const\\s+${r.method}\\b`).test(src)) {
        missing.push(`${r.method} ${r.path} — the file exists but does not \`export const ${r.method}\``)
      }
    }
    expect(
      missing,
      'these routes are DECLARED PUBLIC and are not served:\n' +
        missing.join('\n') +
        '\n\nAn integrator has been told in writing that these work. Either mount them or remove ' +
        'them from PUBLIC_ROUTES — and removing one is a breaking change that owes a changelog entry.'
    ).toEqual([])
  })

  it('every declared route is reachable from bk', () => {
    const { claimed } = collectAppRoutes(
      { appRoot: APP_ROOT, cliDir: CLI_DIR, appSlug: APP_SLUG },
      new Set()
    )
    expect(claimed.size, 'bk claims no routes at all — is the CLI dir right?').toBeGreaterThan(0)

    const unreachable = PUBLIC_ROUTES.filter((r) => !claimed.has(`${r.method} ${r.path}`)).map(
      (r) => `${r.method} ${r.path}`
    )
    expect(
      unreachable,
      'these routes are declared public and no `bk` command reaches them:\n' +
        unreachable.join('\n') +
        '\n\nThe CLI is the whole product, so a capability promised to an outside system and ' +
        'unreachable by an agent is the drift cli-parity exists to prevent — one level up.'
    ).toEqual([])
  })

  it('every declared route carries a since date and a purpose', () => {
    const thin = PUBLIC_ROUTES.filter(
      (r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.since) || r.purpose.trim().length < 20
    ).map((r) => `${r.method} ${r.path}`)
    expect(
      thin,
      'these entries have no usable `since` or no real `purpose`:\n' +
        thin.join('\n') +
        '\n\nBoth are rendered on /integration. An entry with neither is a route somebody has to ' +
        'guess the shape of.'
    ).toEqual([])
  })
})
