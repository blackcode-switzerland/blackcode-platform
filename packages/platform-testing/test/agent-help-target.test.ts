// Every app's X-BK-Help header must point at a page that exists.
//
// `X-BK-Help` is set on every API response from the app's `manifest.help`
// (packages/platform-api/src/handler.ts). It is where a stuck agent is sent, so
// a header pointing at a 404 is worse than no header — three apps carried
// exactly that sentence as the reason they had NO manifest until 2026-09-28,
// when each gained `app/agent-updator/page.tsx` and `app/llms.txt/route.ts`.
//
// ── WHY IT ENUMERATES apps/* INSTEAD OF NAMING THE APPS ─────────────────────
// CLAUDE.md finding #22: a per-app list that a new app must opt into is a guard
// whose coverage shrinks silently every time the platform grows. So every
// directory under apps/ is checked, and the only way out is `NOT_AN_APP_FRONT_DOOR`
// below, with a reason.
//
// ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
// It reads `help: '<path>'` out of `lib/agent-manifest.ts` with a regex, and
// checks that `lib/api.ts` references the manifest. A help path assembled at
// runtime, or a manifest wired some other way, is invisible to it — the
// "found at least one" assertion stops that from passing vacuously, not from
// being missed.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS = join(REPO_ROOT, 'apps')

/** Directories under apps/ that are not a deployed front door, each with why. */
const NOT_AN_APP_FRONT_DOOR: Record<string, string> = {
  _scaffold:
    'The copy-me app. It is never deployed, and its lib/api.ts says why it carries no manifest; a copy adds one as a step of docs/adding-an-app.md.',
}

const apps = readdirSync(APPS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(APPS, e.name, 'package.json')))
  .map((e) => e.name)
  .filter((name) => !(name in NOT_AN_APP_FRONT_DOOR))

describe('every app sends a stuck agent somewhere real', () => {
  it('found the apps (guards against a vacuous pass)', () => {
    expect(apps.length).toBeGreaterThanOrEqual(4)
  })

  it('every exemption names a directory that exists', () => {
    for (const name of Object.keys(NOT_AN_APP_FRONT_DOOR)) {
      expect(existsSync(join(APPS, name)), `apps/${name} is exempt but does not exist`).toBe(true)
    }
  })

  for (const app of apps) {
    describe(app, () => {
      const manifestFile = join(APPS, app, 'lib', 'agent-manifest.ts')

      it('has lib/agent-manifest.ts, wired into its API context', () => {
        expect(existsSync(manifestFile), `apps/${app}/lib/agent-manifest.ts is missing`).toBe(true)
        const api = ['lib/api.ts', 'lib/api/context.ts']
          .map((f) => join(APPS, app, f))
          .find((f) => existsSync(f))
        expect(api, `apps/${app} has no lib/api.ts or lib/api/context.ts`).toBeDefined()
        const src = readFileSync(api!, 'utf8')
        expect(src, `apps/${app}'s API context sets no manifest`).toMatch(/manifest:\s*\{[^}]*AGENT_MANIFEST\.help/)
      })

      it('its help path is a page, and it serves /llms.txt', () => {
        const help = readFileSync(manifestFile, 'utf8').match(/help:\s*'(\/[^']+)'/)?.[1]
        expect(help, `apps/${app}/lib/agent-manifest.ts declares no help path`).toBeDefined()
        const page = join(APPS, app, 'app', ...help!.slice(1).split('/'), 'page.tsx')
        expect(existsSync(page), `X-BK-Help points at ${help}, but apps/${app}/app${help}/page.tsx does not exist`).toBe(true)
        expect(existsSync(join(APPS, app, 'app', 'llms.txt', 'route.ts')), `apps/${app} serves no /llms.txt`).toBe(true)
      })
    })
  }
})
