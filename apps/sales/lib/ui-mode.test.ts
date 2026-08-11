// D-7 mitigation 2: **no server module imports `ui-mode`.**
//
// ===========================================================================
// WHAT WOULD GO WRONG WITHOUT IT
// ===========================================================================
// `ui_mode` is an affordance switch. `read_only` means the WEB APP renders no
// editing; it does not mean the API refuses writes. Authorisation is
// workspace membership and the workspace role.
//
// The failure this file exists to prevent is one line: a route handler that
// reads the preference and refuses. It would look like a security improvement,
// it would pass review, and it would be a control the user can turn off from
// their own Settings page — a permission enforced by the person it restricts.
// Worse, it would make the toggle *appear* to work, so the real conclusion
// ("this is not a permission; use a role") would stop being obvious to anybody.
//
// The plan calls this out as the guardrail most likely to be inert if misread,
// which is why the check is structural and not a convention.
//
// ===========================================================================
// WHY IT WALKS THE GRAPH INSTEAD OF GREPPING FOR A STRING
// ===========================================================================
// `grep "ui-mode" app/api` catches the direct import and nothing else. The
// realistic version of this mistake is INDIRECT: a route imports
// `lib/access.ts`, which imports `lib/ui-mode.ts` for the mode constant, and the
// grep is green. That is finding #4's shape — a check that matches the obvious
// spelling of a mistake nobody makes.
//
// So this walks the import graph from every SERVER entry point and stops at each
// `'use client'` boundary, which is exactly where server code ends. Reaching
// `lib/ui-mode.ts` from a server root is the failure, at any depth.
//
// ===========================================================================
// WRITTEN WITH ITS FIRST CONSUMER, NOT BEFORE
// ===========================================================================
// Agent6 declined to write this into an app with no `ui_mode` anywhere, and was
// right: a check with nothing to check is the shape of the dead guards this
// project keeps finding. The INPUT assertions below are what keep that true
// going forward — they fail if there are no server roots, or if the module it
// guards has stopped existing.
//
// Watched fail 2026-08-07, three ways (D-26):
//   1. `import { useCanWrite } from '@/lib/ui-mode'` added to
//      `app/api/workspaces/[ws]/preferences/route.ts` → RED, naming the path.
//   2. STEP 3, the one that matters: a TRANSITIVE import — a new
//      `lib/mode-check.ts` (no `'use client'`) importing `@/lib/ui-mode`, and
//      the route importing that. RED, and the failure prints the whole chain.
//   3. the `'use client'` line deleted from `components/settings/preference-
//      settings.tsx`, which its server page renders → RED, chain printed. The
//      boundary is the DIRECTIVE, not the directory, so a component that stops
//      declaring itself a client module is walked into — which is right: without
//      the directive it really would run on the server.
//
// And one thing step 2 found that these three do not cover, which is why there
// is a SECOND check below: a route can consult `ui_mode` without `ui-mode`
// appearing in its graph at all, by reading it out of the query layer. Verified,
// and this file passed 4/4 while a write route refused on the preference. See
// `PREFERENCES_READERS`. D-7 item 2 was amended on 2026-08-07 from "no server
// module IMPORTS ui-mode" to "no server module CONSULTS ui_mode" because of it.
//
// ===========================================================================
// WHAT THIS FILE DOES **NOT** COVER. READ THIS BEFORE ASSUMING IT DOES.
// ===========================================================================
// Both checks are REACHABILITY checks over the import graph. Neither sees a
// route that queries `sales.user_preferences` with its own SQL:
//
//     const [row] = await db.select().from(userPreferences).where(…)
//     if (row?.ui_mode !== 'full') throw Errors.forbidden(…)
//
// That imports the schema, not the query module, so nothing here fires. A third
// layer was considered and NOT built, deliberately: writing that is a more
// conscious act than calling a helper — you have to reach past the module that
// exists for the purpose — and a guard keyed on the schema table would fire on
// `setPreferences` and on any future legitimate reader, which is how a guard
// that fails on correct writing gets weakened or deleted (D-37).
//
// The limit is stated rather than left to be discovered, because an unstated
// limit is how the next person assumes coverage they do not have — which is the
// mechanism behind half of CLAUDE.md's table. If that spelling ever appears, the
// place to catch it is code review and this paragraph.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** The module that must stay out of every server graph. */
const GUARDED = 'lib/ui-mode.ts'

const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(p))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

/** `'use client'` or `"use client"` on one of the first lines. */
function isClientModule(src: string): boolean {
  return /^\s*['"]use client['"]/m.test(src.slice(0, 400))
}

/** Every import/export specifier in a module. */
function specifiersOf(src: string): string[] {
  const out: string[] = []
  const re = /(?:from|import)\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

/**
 * Resolve a specifier to a file in this app, or null.
 *
 * `@/` and relative paths only — a bare package specifier leaves this app and
 * cannot reach `lib/ui-mode.ts`, which nothing outside the app imports.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(APP_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * Server entry points: every API route, plus every page/layout that is NOT a
 * client component.
 *
 * A `'use client'` page is a browser module and its graph is not server code —
 * the boundary is the directive, which is what Next.js itself uses.
 */
function serverRoots(): string[] {
  const roots: string[] = []
  for (const f of walkFiles(join(APP_ROOT, 'app'))) {
    const name = rel(f)
    const isRoute = name.startsWith('app/api/') && name.endsWith('/route.ts')
    const isPage = /\/(page|layout|template|error|not-found)\.tsx?$/.test(name)
    if (!isRoute && !isPage) continue
    if (isClientModule(readFileSync(f, 'utf8'))) continue
    roots.push(f)
  }
  if (existsSync(join(APP_ROOT, 'middleware.ts'))) roots.push(join(APP_ROOT, 'middleware.ts'))
  return roots
}

/** BFS from the server roots, stopping at every `'use client'` module. */
function findServerPathsTo(target: string): string[][] {
  const targetAbs = join(APP_ROOT, target)
  const found: string[][] = []
  const seen = new Set<string>()

  for (const root of serverRoots()) {
    const queue: Array<{ file: string; chain: string[] }> = [{ file: root, chain: [rel(root)] }]
    while (queue.length > 0) {
      const { file, chain } = queue.shift()!
      if (file === targetAbs) {
        found.push(chain)
        break
      }
      const key = `${root}::${file}`
      if (seen.has(key)) continue
      seen.add(key)

      const src = readFileSync(file, 'utf8')
      // A client module ends the server graph. Its own imports are the
      // browser's problem, and `lib/ui-mode.ts` living there is the point.
      if (file !== root && isClientModule(src)) continue

      for (const spec of specifiersOf(src)) {
        const next = resolveSpecifier(file, spec)
        if (next) queue.push({ file: next, chain: [...chain, rel(next)] })
      }
    }
  }
  return found
}

describe('the inputs — assert these first', () => {
  it('the guarded module exists', () => {
    // A renamed or deleted `lib/ui-mode.ts` makes every assertion below pass by
    // there being nothing to find. That is the exact shape of the dead guards
    // CLAUDE.md catalogues, so it fails loudly instead.
    expect(
      existsSync(join(APP_ROOT, GUARDED)),
      `${GUARDED} does not exist. If the affordance switch moved, this file has to move ` +
        'with it — otherwise D-7 mitigation 2 is a green test over an absent module.'
    ).toBe(true)
  })

  it('found server entry points to walk from', () => {
    const roots = serverRoots()
    expect(
      roots.length,
      'no server routes or pages found — this guard would pass over an empty graph'
    ).toBeGreaterThan(10)
    expect(
      roots.map(rel).some((r) => r.startsWith('app/api/')),
      'no API route among the roots; the walk is not starting where writes happen'
    ).toBe(true)
  })

  it('the walk can actually reach a lib module (the resolver works)', () => {
    // Without this, a broken `resolveSpecifier` — a changed alias, a moved
    // `tsconfig` path — would silently resolve nothing and report a clean graph.
    // The guard would be green because it followed no edges at all.
    const reached = findServerPathsTo('lib/pipeline.ts')
    expect(
      reached.length,
      'no server module resolves to lib/pipeline.ts, which several routes import ' +
        'directly. The import resolver is broken, so the check below is walking ' +
        'an empty graph and cannot fail.'
    ).toBeGreaterThan(0)
  })
})

/**
 * The server-side READER of the stored preference, and who may call it.
 *
 * ── THIS SECOND CHECK IS THE ONE D-7 DID NOT ASK FOR ───────────────────────
 * The mandated guard is "no server module imports `ui-mode`", and on its own it
 * is INERT against the likeliest spelling of the mistake. Verified 2026-08-07 by
 * writing this into `PATCH …/prospects/{n}`:
 *
 *     const prefs = await getPreferences(ctx.workspace.id, ctx.user.id)
 *     if (prefs.ui_mode !== 'full') throw Errors.forbidden('read-only mode')
 *
 * `lib/ui-mode.ts` is nowhere in that graph — the value comes from the query
 * layer, where it has to live, because something must store it. The suite passed
 * 4/4 with `ui_mode` acting as a permission on a write route.
 *
 * That is D-26 step 2 answered honestly and step 3 confirming it. The mitigation
 * as specified guards the CLIENT module; what has to be guarded is the READ. So:
 * `getPreferences` may be called by the route that serves preferences and by
 * nothing else. `setPreferences` is fine anywhere — writing a display setting is
 * not consulting one — but it lives in the same module and confining the module
 * is simpler than confining a function, so both are covered by one rule and the
 * allowance is the route that legitimately needs it.
 */
const PREFERENCES_QUERY = 'lib/db/queries/preferences.ts'

/** Server files allowed to reach the preferences store, each with a reason. */
const PREFERENCES_READERS = new Map<string, string>([
  [
    'app/api/workspaces/[ws]/preferences/route.ts',
    'it IS the preferences route — GET returns the row and PATCH writes it. It ' +
      'does not branch on the value, which is the whole point: it serves it.',
  ],
])

describe('D-7: ui_mode is an affordance switch, not a permission', () => {
  it('only the preferences route reaches the stored preference', () => {
    const paths = findServerPathsTo(PREFERENCES_QUERY).filter(
      (chain) => !PREFERENCES_READERS.has(chain[0])
    )
    expect(
      paths.map((chain) => chain.join('\n    → ')),
      'a server module other than the preferences route reaches ' +
        `${PREFERENCES_QUERY}. The only reason to read \`ui_mode\` on the server is to ` +
        'branch on it, and branching on it makes a browser display preference into a ' +
        'permission that the person it restricts can switch off from their own ' +
        'Settings page (D-7).\n\n' +
        'This is the check that catches the mistake the "no server module imports ' +
        'ui-mode" one does not: the value can be read straight out of the query ' +
        'layer without ui-mode appearing anywhere.\n\n' +
        'If a route genuinely must refuse a write, that is workspace membership ' +
        'and the workspace role — a viewer role (B-4), not a preference.\n\nChains:\n'
    ).toEqual([])
  })

  it('every allowance is still real', () => {
    // A stale entry is coverage silently dropped: the route moved or was
    // renamed, and the name now suppresses nothing while still reading as a
    // considered decision.
    for (const [file] of PREFERENCES_READERS) {
      expect(existsSync(join(APP_ROOT, file)), `${file} no longer exists — stale allowance`).toBe(
        true
      )
    }
  })

  it('no server module imports lib/ui-mode.ts, at any depth', () => {
    const paths = findServerPathsTo(GUARDED)
    expect(
      paths.map((chain) => chain.join('\n    → ')),
      'a SERVER module reaches lib/ui-mode.ts. `ui_mode` is what the browser ' +
        'renders (D-7); the server must never consult it. A route that refused a ' +
        'write because of it would be a permission the user can turn off from ' +
        'their own Settings page, and it would make the toggle look like a ' +
        'control while protecting nothing.\n\n' +
        'What to do instead: authorisation is workspace membership and the ' +
        'workspace role. If somebody must genuinely be unable to write, that is a ' +
        'workspace role (B-4), not a preference.\n\nChains found:\n'
    ).toEqual([])
  })
})
