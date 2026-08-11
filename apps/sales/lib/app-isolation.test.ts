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
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
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
 * The list is symmetric by hand: adding this app meant adding `'sales'` to
 * `apps/issues` and `apps/_scaffold` in the same change. A one-sided guard only
 * catches the app that remembered.
 */
const OTHER_SCHEMAS = ['issues', 'scaffold']

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

// ===========================================================================
// THE THIRD BOUNDARY: THIS APP'S TENANCY IS `sales.workspaces`
// ===========================================================================
// Added 2026-08-10 (multiAppFinalRefactor Phase 5), after the bug it catches had
// been live since Phase 2 and had survived four phases of verification green.
//
// **`app/dashboard/[ws]/layout.tsx` resolved membership through the SHARED
// `listMyWorkspaces` from `@blackcode/platform-db`**, which reads
// `platform.workspaces`. Phase 2 moved this app's workspaces to
// `sales.workspaces` and repointed the sibling `app/dashboard/layout.tsx`; this
// file, one directory down, was missed.
//
// The consequence was total and invisible: a brand-new sales sign-up — the exact
// account Phase 2 exists to create — got **404 on their own dashboard**, while
// every API route worked for them. Measured, not inferred.
//
// ── WHY THE TWO BOUNDARIES ABOVE CANNOT SEE IT ─────────────────────────────
// Neither is wrong; it is simply not the thing they check.
//
//   - `imports nothing from another app` — `@blackcode/platform-db` is not
//     another app. It is the shared package every app is SUPPOSED to import.
//   - `queries no other app schema` — the offending file names no schema at all.
//     `platform` is not in `OTHER_SCHEMAS` and must not be: this app reads
//     `platform.users` legitimately on every request.
//
// Both were injected with the real regression and watched to stay GREEN before
// this was written. That is the gap: **a shared helper whose PREMISE moved.**
// The import is legal, the schema is legal, and the answer is another app's
// tenants. Agent 4's §3 (`searchRoute` leaking issues' titles into sales) and
// agent 5's §4.2 (`/api/users` listing people from issues) are the same shape —
// this is the third, and the first one guarded.
//
// ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────
// It bans IMPORTING the platform tenancy readers by name, and calling them
// through a namespace import. It does not try to understand what a function
// does — a text scan cannot, and finding #11 is what happens when one pretends
// to. The banned list is short, explicit, and every entry reads
// `platform.workspaces` or `platform.workspace_members`.
//
// STILL PASSES ON: reaching the same rows through raw SQL, through a re-export
// (a local module that re-exports the platform helper), or through a platform
// helper added later and not added here. The `has something to look for`
// assertion keeps the list from silently emptying; it cannot know about a
// function nobody told it about. When you add a tenancy reader to
// `@blackcode/platform-db`, add it here.
const PLATFORM_TENANCY_READERS = [
  'listMyWorkspaces',
  'getWorkspaceForUser',
  'getWorkspaceById',
  'listWorkspaceMembers',
  'setActiveWorkspace',
  'getMembership',
]

/** Every `.ts`/`.tsx` under this app that is not itself a test. */
function appSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
        continue
      }
      // TEST FILES ARE EXCLUDED, and the immediate reason is self-reference:
      // THIS file names the banned helpers in its own prose and in its own
      // banned list, so a scan including itself reports itself. That is the
      // fifth self-reference trap on this project (see
      // platform-testing/test/cited-tests-exist.test.ts for the other four) and
      // it fired within a minute of the namespace check being added.
      //
      // It is also right on the merits: a test may import a platform helper to
      // build a fixture or to assert what it does. This rule is about what the
      // app SERVES. The cost is a real gap — a dead reach inside a test file is
      // not caught — and it is the cheaper half of the trade.
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
    }
  }
  walk(root)
  return out
}

describe("this app's tenancy is its own", () => {
  const offenders: string[] = []
  const files = appSourceFiles(APP_ROOT)

  for (const file of files) {
    const text = readFileSync(file, 'utf8')

    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@blackcode\/platform-db'/g)) {
      // `.split(/\s+as\s+/)[0]` matters: `listMyWorkspaces as platformList` is
      // the same reach under a local name, and matching the local name would
      // miss it. Watched red on that spelling.
      const named = m[1]
        .split(',')
        .map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      for (const banned of PLATFORM_TENANCY_READERS) {
        if (named.includes(banned)) {
          offenders.push(
            `${relative(APP_ROOT, file)}: imports ${banned} from @blackcode/platform-db`
          )
        }
      }
    }

    // NAMESPACE IMPORTS reach the same rows and the named scan cannot see them.
    // Injected and watched this suite stay GREEN before this block existed,
    // which is why it exists rather than a note calling them unlikely. Finding
    // #13 is an import regex that knew `import` and `from` but not `require`.
    for (const m of text.matchAll(
      /import\s*\*\s*as\s+(\w+)\s*from\s*'@blackcode\/platform-db'/g
    )) {
      const ns = m[1]
      for (const banned of PLATFORM_TENANCY_READERS) {
        if (new RegExp(`\\b${ns}\\.${banned}\\b`).test(text)) {
          offenders.push(
            `${relative(APP_ROOT, file)}: calls ${ns}.${banned} (namespace import of @blackcode/platform-db)`
          )
        }
      }
    }
  }

  it('has files to scan', () => {
    expect(
      files.length,
      `scanned 0 files under ${APP_ROOT} — it could not have found a violation if one existed`
    ).toBeGreaterThan(0)
  })

  it('has something to look for', () => {
    expect(
      PLATFORM_TENANCY_READERS.length,
      'the banned list is empty, so the scan below looks for nothing and always passes'
    ).toBeGreaterThan(0)
  })

  it('resolves workspaces and members through sales.*, never platform.*', () => {
    expect(
      offenders,
      "this app's workspaces are `sales.workspaces` (Phase 2). These helpers read " +
        "`platform.workspaces` / `platform.workspace_members`, which are `apps/issues`' " +
        'tables — so they answer about another app\'s tenants. Use `lib/db/queries/workspaces.ts`.\n\n' +
        "This is not hypothetical: `app/dashboard/[ws]/layout.tsx` did exactly this and " +
        "404'd every sales-only account on their own dashboard from Phase 2 until 2026-08-10, " +
        'while every API route worked. Both boundaries above stayed green on it.\n\nFound:\n'
    ).toEqual([])
  })
})
