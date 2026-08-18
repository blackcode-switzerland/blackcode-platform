// "The web surface is read-mostly" — asserted as a fact about the module graph,
// not as anybody's good intentions.
//
// ===========================================================================
// WHAT THIS BUYS, AND WHAT IT DOES NOT CLAIM
// ===========================================================================
// b/books has thirteen screens and five writes. That ratio is a design decision,
// and a design decision nobody can check is a design decision that decays: one
// `fetch` inside a component, and "read-mostly" is back to being a sentence in a
// document.
//
// The arrangement that keeps it checkable:
//
//   lib/client.ts     the ONLY `fetch(`. Transport, consults nothing.
//   lib/mutations.ts  the ONLY module that sends `apiSend`. Every hook built on
//                     one primitive, which reads useCanWrite().
//   components/**     call those hooks. No fetch, no apiSend, no method strings.
//
// So "can a component write?" is answered by three assertions instead of an
// audit.
//
// **What this does NOT claim** is that every button is correctly hidden. It claims
// that every record write goes through one gated function, so a missed affordance
// FAILS LOUDLY instead of writing — which is what makes it findable at all.
//
// Adapted from apps/sales/lib/read-only.test.ts, which is the fuller version and
// worth reading before extending this one. This app's is smaller because this app
// has no write affordances yet; it ships now so the first one arrives into a
// guarded shape rather than retrofitting the guard around it.
//
// ── WATCH IT FAIL BEFORE TRUSTING IT ──────────────────────────────────────
// Fourteen guardrails in this repo have been found green but inert, and five of
// those by the phase whose job was to disbelieve the previous ones. Before relying
// on this file: add `fetch(` to a component, run it, watch it go red, restore.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

/** The one module allowed to call `fetch`. */
const TRANSPORT = 'lib/client.ts'
/** The one module allowed to send a write TO THE BOOKS. */
const RECORD_WRITES = 'lib/mutations.ts'
/**
 * The one module allowed to send a write to the shared blackcode ACCOUNT.
 *
 * ── ADDED 2026-08-17, AND WIDENING A GUARD DESERVES ITS REASON ─────────────
 * This list was one entry long and the sprint-1 frontend needed two writes that
 * are not bookkeeping: create an account (`POST /api/auth/register`, no session
 * exists yet) and edit your own profile (`PATCH /api/me`, `platform.users`, one
 * row across every blackcode app). Neither touches `books.*`.
 *
 * The alternatives were both worse. Putting them in `lib/mutations.ts` would
 * have made them "one of the five writes", which they are not, and would gate
 * them on `useCanWrite()` — a hook phase 2 replaces with the WORKSPACE ROLE, at
 * which point it would be deciding whether a stranger may create an account.
 * Letting a component call `apiSend` directly would have deleted the guard.
 *
 * **The claim this file makes is unchanged in strength**: a write comes from a
 * named module or the suite is red. What changed is that "a books write" and "an
 * account write" are now distinguishable, which they were not when there was one
 * name for both. `lib/account.ts`'s header carries the same reasoning from the
 * other side.
 *
 * If a third name is ever added here, ask what it is that the two existing ones
 * do not cover — the answer is usually that it belongs in one of them.
 */
const ACCOUNT_WRITES = 'lib/account.ts'

/**
 * Directories under the app root that are NOT the web surface.
 *
 * ── WHY THIS IS A SUBTRACTION AND NOT A LIST OF THREE ──────────────────────
 * This file used to walk `app`, `components` and `lib`, and nothing asserted
 * those were the whole surface. A component placed anywhere else called
 * `fetch('/api/…', {method: 'POST'})` with all 41 tests green — watched, on
 * 2026-08-17, by putting one in `features/`. A directory nobody thought of is a
 * normal thing to add while writing thirteen screens, so the guard is inverted:
 * everything is the web surface unless it is named here, and every name has to
 * still exist (below), so this list cannot rot into a silent exemption.
 *
 * This is the arrangement `platform-testing/test/cited-tests-exist.test.ts` uses
 * for the same reason.
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

/** Every TypeScript file in the app except the exclusions above. */
const SOURCES = walk(APP_ROOT)

/**
 * Strip comments before matching.
 *
 * Without this, a comment SAYING "never call fetch(" fails the test that enforces
 * it — a guard tripping on correct writing, which teaches people to delete the
 * explanation rather than keep the rule.
 */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the web surface is read-mostly', () => {
  it('found the modules this file is about (guards against a vacuous pass)', () => {
    expect(SOURCES.length, `nothing walked under ${APP_ROOT}`).toBeGreaterThan(5)
    for (const f of [TRANSPORT, RECORD_WRITES, ACCOUNT_WRITES]) {
      expect(existsSync(join(APP_ROOT, f)), `${f} does not exist — this file is stale`).toBe(true)
    }
  })

  it('the exclusion list is real, so it cannot become a silent exemption', () => {
    // An ignore list that has drifted off the filesystem stops being an
    // exclusion and becomes a comment. Both halves are asserted: the list is not
    // empty, and every name in it is a directory that exists.
    expect(NOT_THE_WEB_SURFACE.length, 'the exclusion list is empty').toBeGreaterThan(0)
    const missing = NOT_THE_WEB_SURFACE.filter(
      (d) => d !== 'node_modules' && d !== '.next' && d !== '.turbo' && !existsSync(join(APP_ROOT, d))
    )
    expect(
      missing,
      'these are excluded from the read-only scan but no longer exist. Delete them from ' +
        `NOT_THE_WEB_SURFACE or the list is describing a directory layout that is gone:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('the walk reaches a directory nobody listed', () => {
    // The regression test for the escape that was watched happen: the scan must
    // cover a NEW top-level directory, not just app/components/lib. Asserted on
    // the walk itself rather than by planting a file, so it holds with no
    // filesystem side effect.
    const covered = new Set(SOURCES.map((f) => rel(f).split('/')[0]))
    expect(covered.has('app'), 'app/ is not being scanned').toBe(true)
    expect(covered.has('components'), 'components/ is not being scanned').toBe(true)
    expect(covered.has('lib'), 'lib/ is not being scanned').toBe(true)
    // middleware.ts sits at the app root and is neither app/, components/ nor
    // lib/. If the walk cannot see it, the walk is a hardcoded list again.
    expect(
      SOURCES.map(rel),
      'the scan is not reaching the app root — a file outside app/components/lib is invisible to it'
    ).toContain('middleware.ts')
  })

  it('there is exactly one fetch() in the whole web surface', () => {
    const callers = SOURCES.filter((f) => /\bfetch\s*\(/.test(codeOf(readFileSync(f, 'utf8')))).map(rel)
    expect(
      callers,
      `only ${TRANSPORT} may call fetch(). Route every request through apiGet/apiSend so the ` +
        'read-mostly shape stays checkable:\n' + callers.join('\n')
    ).toEqual([TRANSPORT])
  })

  it('nothing else so much as names fetch, aliased or on an object', () => {
    // `fetch(` was the only spelling checked, so `const send = fetch` and
    // `window.fetch(…)` both walked past it. The identifier itself is the thing
    // to ban. `\bfetch\b` does not match `refetch()`, which TanStack returns and
    // which several components legitimately call.
    const namers = SOURCES.filter(
      (f) => rel(f) !== TRANSPORT && /\bfetch\b/.test(codeOf(readFileSync(f, 'utf8')))
    ).map(rel)
    expect(
      namers,
      `only ${TRANSPORT} may reference fetch at all. Naming it — aliasing it, reading it off ` +
        `window — routes around every check in this file:\n${namers.join('\n')}`
    ).toEqual([])
  })

  it('nothing else imports apiSend, even under another name', () => {
    // F4 in the 2026-08-17 review: the write check matched the literal token
    // `apiSend`, so `import { apiSend as send }` and then `send(…)` passed. The
    // import is the chokepoint — you cannot alias what you did not import.
    const importers = SOURCES.filter((f) => {
      const r = rel(f)
      if (r === TRANSPORT || r === RECORD_WRITES || r === ACCOUNT_WRITES) return false
      const code = codeOf(readFileSync(f, 'utf8'))
      return /import\s*(type\s*)?\{[^}]*\bapiSend\b[^}]*\}\s*from/.test(code)
    }).map(rel)
    expect(
      importers,
      `only ${RECORD_WRITES} and ${ACCOUNT_WRITES} may import apiSend. Importing it elsewhere ` +
        `bypasses useCanWrite() whatever it is then called:\n${importers.join('\n')}`
    ).toEqual([])
  })

  it('only the two named write modules send apiSend', () => {
    const senders = SOURCES.filter((f) => {
      if (rel(f) === TRANSPORT) return false // it DEFINES apiSend
      return /\bapiSend\s*[<(]/.test(codeOf(readFileSync(f, 'utf8')))
    })
      .map(rel)
      // Sorted so the assertion is about the SET and not about the order the
      // filesystem happened to hand them back in. `lib/account.ts` sorts before
      // `lib/mutations.ts`, but that is a fact about two strings, not a fact
      // worth asserting.
      .sort()
    expect(
      senders,
      `only ${RECORD_WRITES} (books records) and ${ACCOUNT_WRITES} (the shared blackcode ` +
        'account) may send a write. A component that calls apiSend bypasses both:\n' +
        senders.join('\n')
    ).toEqual([ACCOUNT_WRITES, RECORD_WRITES].sort())
  })

  it('the record-write module really does gate on the mode', () => {
    const src = codeOf(readFileSync(join(APP_ROOT, RECORD_WRITES), 'utf8'))
    expect(src, `${RECORD_WRITES} no longer reads useCanWrite`).toMatch(/\buseCanWrite\(/)
    expect(
      src,
      `${RECORD_WRITES} no longer refuses when the session cannot write — a write that ` +
        'silently no-ops is worse than one that errors, because the user believes it happened'
    ).toMatch(/throw new Error/)
  })

  it('has exactly one mutation primitive, and it is the gated one', () => {
    const src = codeOf(readFileSync(join(APP_ROOT, RECORD_WRITES), 'utf8'))
    const primitives = src.match(/function useRecordMutation\b/g) ?? []
    expect(
      primitives.length,
      `${RECORD_WRITES} must have exactly ONE mutation primitive. Two means two places for ` +
        'the gate to be forgotten.'
    ).toBe(1)
  })

  it('no module outside lib/mutations.ts names an /api/workspaces write path', () => {
    // A component holding a workspace-scoped path plus a method string is a write
    // waiting to escape the gate, even before it calls anything.
    const offenders = SOURCES.filter((f) => {
      const r = rel(f)
      if (r === TRANSPORT || r === RECORD_WRITES) return false
      const src = codeOf(readFileSync(f, 'utf8'))
      return /'(POST|PATCH|DELETE)'/.test(src) && /\/api\/workspaces/.test(src)
    }).map(rel)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
