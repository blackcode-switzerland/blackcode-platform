// The module-graph half of `apps/sales/lib/read-only.test.ts`, ported here —
// WITHOUT the read-only assertion. b/billing ships full write parity (decision
// D-B1): there is no `ui_mode`, no `useCanWrite()`, nothing to gate. What is
// still a property worth checking is the SHAPE sales' file protects underneath
// that gate:
//
//   lib/client.ts      the ONE `fetch(` in the app. Transport only.
//   lib/mutations.ts   the ONE module that calls `useMutation` — one exported
//                      hook per write, discoverable in a single file rather
//                      than scattered through components.
//   (nowhere)           no server action anywhere. A `'use server'` module or
//                      function is a second way to write that neither this
//                      scan's sibling `lib/cli-parity.test.ts` (routes only)
//                      nor a browser click can see — CLAUDE.md's "a route is
//                      not a page" corollary, one layer further down.
//
// ===========================================================================
// COMMENT STRIPPING: source-text.ts, not a regex pair (finding #27)
// ===========================================================================
// `apps/sales/lib/read-only.test.ts` strips comments with
// `src.replace(/\/\*[\s\S]*?\*\//g, ...).replace(/(^|[^:])\/\/.*$/gm, ...)` and
// that same repo's `no-brand-literal.test.ts` used the same shape until
// 2026-09-23, when a LINE comment whose prose quoted `/*` opened a block
// comment that did not close for 3,161 characters, silently exempting real
// code from the scan while it stayed green. `stripComments`
// (packages/platform-testing/src/source-text.ts) is the replacement: it knows
// strings, template holes and regex literals from comments, so a `/*` inside a
// `//` line cannot open anything. This file's own header contains the literal
// needles `fetch(`, `useMutation` and `'use server'` while explaining the
// rule — the same self-reference `read-only.test.ts`'s header warns about —
// which is exactly what a comment-stripping scanner has to get right to avoid
// flagging its own prose.
//
// ── WATCHED FAIL, THREE WAYS, EACH RESTORED (2026-09-28) ───────────────────
//   A. `fetch('/api/workspaces/x')` added to
//      `components/companies/company-list.tsx` → RED, "there is exactly one
//      module that calls fetch()"
//   B. a second `useMutation({...})` added inside `lib/mutations.ts` (not
//      through `useWrite`) → RED, "lib/mutations.ts calls useMutation exactly
//      once"
//   C. `'use server'` added as the first line of
//      `app/dashboard/[ws]/invoices/actions.ts` (a new file) → RED, "no
//      server action anywhere in the web surface"
// See the ticket #79 report for the exact diffs and failure output.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from '@blackcode/platform-testing'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

/** The one module allowed to call `fetch` to reach our own API. */
const TRANSPORT = 'lib/client.ts'
/** The one module allowed to call `useMutation`. */
const RECORD_WRITES = 'lib/mutations.ts'

/**
 * Not the web surface. A hardcoded `app`/`components`/`lib` walk cannot see a
 * directory added later — `apps/books`' `lib/query-keys.test.ts` names this
 * same subtraction after finding the general shape (2026-08-17, F3).
 */
const NOT_THE_WEB_SURFACE = ['node_modules', '.next', '.turbo', 'fixtures', 'public', 'docs']

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (NOT_THE_WEB_SURFACE.includes(entry.name)) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

const SOURCES = [
  ...walk(join(APP_ROOT, 'app')),
  ...walk(join(APP_ROOT, 'components')),
  ...walk(join(APP_ROOT, 'lib')),
]

/** The source with comments removed — strings, JSX text and code remain. */
function codeOf(file: string): string {
  return stripComments(readFileSync(file, 'utf8')).code
}

describe('the inputs — assert these first, or the checks below are theatre', () => {
  it('found the modules this file is about', () => {
    expect(SOURCES.length, `nothing walked under ${APP_ROOT}`).toBeGreaterThan(30)
    for (const f of [TRANSPORT, RECORD_WRITES]) {
      expect(existsSync(join(APP_ROOT, f)), `${f} does not exist — this file is stale`).toBe(true)
    }
  })
})

describe('one fetch, one mutation file, no server actions', () => {
  it('there is exactly one module that calls fetch()', () => {
    const callers = SOURCES.filter((f) => /\bfetch\s*\(/.test(codeOf(f))).map(rel)
    // toEqual([TRANSPORT]) is both the assertion AND the premise: if
    // lib/client.ts had stopped calling fetch, `callers` would be `[]` and this
    // would fail on the premise rather than passing vacuously against no
    // fetch anywhere in the app.
    expect(
      callers,
      `only ${TRANSPORT} may call fetch(). A component or route calling it directly ` +
        'bypasses the one place a request is built (the Idempotency-Key, the JSON ' +
        `envelope, WebError) and makes that property unverifiable. Found in:\n${callers.join('\n')}`
    ).toEqual([TRANSPORT])
  })

  it('there is exactly one module that calls useMutation', () => {
    const callers = SOURCES.filter((f) => /\buseMutation\s*[<(]/.test(codeOf(f))).map(rel)
    expect(
      callers,
      `only ${RECORD_WRITES} may call useMutation. Every write must be a named, exported ` +
        'hook in that one file — discoverable by reading it, rather than scattered through ' +
        `components where nobody could enumerate them by looking. Found in:\n${callers.join('\n')}`
    ).toEqual([RECORD_WRITES])
  })

  it('lib/mutations.ts calls useMutation exactly once', () => {
    // File-level uniqueness (above) cannot see a SECOND useMutation call added
    // inside the one allowed file, outside `useWrite`. Counting occurrences
    // does.
    const src = codeOf(join(APP_ROOT, RECORD_WRITES))
    const count = (src.match(/\buseMutation\s*[<(]/g) ?? []).length
    expect(
      count,
      'every hook in lib/mutations.ts must compose useWrite(), which is the single ' +
        'useMutation in this module. A second one is not necessarily ungated — but the ' +
        'moment there are two, nobody can enumerate the writes by reading this file.'
    ).toBe(1)
  })

  it('no server action anywhere in the web surface', () => {
    // Both spellings: a module-level directive and a function-level one, single
    // or double quoted.
    const offenders = SOURCES.filter((f) => /(['"])use server\1/.test(codeOf(f))).map(rel)
    expect(
      offenders,
      'a server action is a second way to write our own data that bypasses ' +
        'lib/client.ts and lib/mutations.ts entirely — cli-parity.test.ts only sees ' +
        '`app/api/**`, and a server action never lands there ("a route is not a page", ' +
        `CLAUDE.md). Found in:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
