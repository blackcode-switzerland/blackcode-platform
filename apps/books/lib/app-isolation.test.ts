// This app stays inside its own boundary — enforced by resolution, not by a
// glob over import strings.
//
// COPY THIS FILE when you copy the app, and change `OTHER_SCHEMAS`.
//
// The eslint rule that used to cover the first half did not work: relative
// climbs out of an app have no fixed depth and the segment `apps` never appears
// in the specifier, so `import '../../issues/lib/app'` slipped through every
// pattern. See the header of platform-testing's app-isolation.ts.
//
// THAT RULE IS GONE — deleted from `apps/*/.eslintrc.json` on 2026-08-06.
// Do not put it back. It survived the migration that identified it as inert and
// was still passing `import '../../issues/lib/work-items'` at exit 0 four days
// later, sitting next to this file and citing the architecture doc, which is
// exactly what makes a dead check expensive: it reads as protection. A glob over
// import strings cannot express "resolves into a sibling app", so there is no
// version of it worth keeping. THIS FILE is the boundary. If you want more
// confidence, add a case here — do not add a lint rule.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findCrossAppImports,
  scanCrossSchemaQueries,
  type SchemaQueryAllowance,
} from '@blackcode/platform-testing'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const APPS_ROOT = join(APP_ROOT, '..')

/**
 * Postgres schemas belonging to OTHER apps. Never `platform`, never our own.
 *
 * Keep it symmetric: adding an app means adding its schema HERE and in every
 * other app, in the same change. A one-sided guard only catches the app that
 * remembered.
 */
const OTHER_SCHEMAS = ['issues', 'sales']

/**
 * Deliberate exceptions, each with a reason. **Reach for one last.**
 *
 * The scanner already subtracts the two GENERIC false-positive shapes — a
 * hostname (`issues.blackcode.ch`) and a path (`docs/changelog/sales.md`) — so an
 * entry here is a genuine one-off, not a recurring class. Every entry is checked
 * for staleness below: if its `match` stops appearing in its `file`, the suite
 * fails rather than letting a dead exclusion keep suppressing.
 */
const ALLOW: SchemaQueryAllowance[] = []

const scan = scanCrossSchemaQueries({
  root: APP_ROOT,
  otherSchemas: OTHER_SCHEMAS,
  allow: ALLOW,
})

describe('the inputs — assert these first, or the check below is theatre', () => {
  // A scan over zero files, or for zero schema names, finds zero violations and
  // reports a confident green. CLAUDE.md names this as a corollary of the
  // standing rule, and finding #5 was caught by exactly such an assertion.
  it('read some files', () => {
    expect(
      scan.filesScanned,
      `scanned 0 files under ${APP_ROOT} — it could not have found a violation if one existed`
    ).toBeGreaterThan(0)
  })

  it('has other apps to look for', () => {
    expect(
      scan.schemas.length,
      'OTHER_SCHEMAS is empty, so the scan below looks for nothing and always passes'
    ).toBeGreaterThan(0)
  })

  it('every allowance still matches something', () => {
    expect(
      scan.stale.map((a) => `${a.file}: ${a.match}`),
      'these allowances no longer match anything. A stale exclusion is coverage that ' +
        'was dropped and then kept off — the line moved or was rewritten, and the entry ' +
        'now suppresses nothing while still reading as a considered decision. Delete it, ' +
        'or fix its `match`.'
    ).toEqual([])
  })
})

describe('app isolation', () => {
  it('imports nothing from another app', () => {
    const found = findCrossAppImports(APP_ROOT, APPS_ROOT)
    expect(
      found.map((f) => `${f.file} → ${f.specifier} (apps/${f.otherApp})`),
      'an app may never import from another app. Only packages/platform-* is shared — ' +
        'if two apps need this code, extract it there. See docs/platform-architecture.md §7.6.'
    ).toEqual([])
  })

  it('queries no other app schema', () => {
    expect(
      scan.hits.map((f) => `${f.file}:${f.lineNumber}: ${f.line}`),
      'an app may read and write `platform.*` and its own schema, nothing else. ' +
        'In production the per-app Postgres role refuses it outright (docs/sql/app-role.sql); ' +
        'this catches it before a shared local credential lets it work by accident. ' +
        'This scan covers `lib/db/migrations/*.sql` too — a trigger copied from another ' +
        "app's migration and not fully renamed is the way this bug actually happens."
    ).toEqual([])
  })
})
