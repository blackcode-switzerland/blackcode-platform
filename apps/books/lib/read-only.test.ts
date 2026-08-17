// "The web surface is read-mostly" — asserted as a fact about the module graph,
// not as anybody's good intentions.
//
// ===========================================================================
// WHAT THIS BUYS, AND WHAT IT DOES NOT CLAIM
// ===========================================================================
// b/books has thirteen screens and four writes. That ratio is a design decision,
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
/** The one module allowed to send a write. */
const RECORD_WRITES = 'lib/mutations.ts'

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
    for (const f of [TRANSPORT, RECORD_WRITES]) {
      expect(existsSync(join(APP_ROOT, f)), `${f} does not exist — this file is stale`).toBe(true)
    }
  })

  it('there is exactly one fetch() in the whole web surface', () => {
    const callers = SOURCES.filter((f) => /\bfetch\s*\(/.test(codeOf(readFileSync(f, 'utf8')))).map(rel)
    expect(
      callers,
      `only ${TRANSPORT} may call fetch(). Route every request through apiGet/apiSend so the ` +
        'read-mostly shape stays checkable:\n' + callers.join('\n')
    ).toEqual([TRANSPORT])
  })

  it('only lib/mutations.ts sends apiSend', () => {
    const senders = SOURCES.filter((f) => {
      if (rel(f) === TRANSPORT) return false // it DEFINES apiSend
      return /\bapiSend\s*[<(]/.test(codeOf(readFileSync(f, 'utf8')))
    }).map(rel)
    expect(
      senders,
      `only ${RECORD_WRITES} may send a write. A component that calls apiSend bypasses ` +
        'useCanWrite():\n' + senders.join('\n')
    ).toEqual([RECORD_WRITES])
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
