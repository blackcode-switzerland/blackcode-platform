// "Switching book cannot show the previous book's numbers" — asserted twice,
// because one of the two assertions is nearly worthless on its own.
//
// ===========================================================================
// THE UNIT TEST IS THE WEAK HALF. THE SCANNER IS THE POINT.
// ===========================================================================
// Testing that `booksKey` returns different keys for different books proves
// something nobody doubted. It says nothing about whether any hook CALLS it —
// and a correct key builder that one hook forgot is exactly the shape this bug
// ships in. `apps/sales` learned the general lesson the expensive way
// (CLAUDE.md finding #10): an assertion phrased for one value, left pointing at
// another, keeps passing and stops guarding.
//
// So the second `describe` reads the source of `lib/hooks.ts` and every
// component, and fails on a `queryKey:` written any way other than through this
// module. That is a property of the module graph rather than of anyone's
// intentions, which is the same arrangement `lib/read-only.test.ts` uses for
// writes and the reason that one is trustworthy.
//
// ── WATCHED FAIL BEFORE BEING TRUSTED (2026-08-17) ────────────────────────
// Each case below was made to go red before it was kept — the mutation is
// recorded beside it. An assertion nobody has seen fail is not an assertion.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { booksKey, booksGlobalKey, BOOKS_KEY_ROOT } from './query-keys'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

/** The one module allowed to spell a key. */
const KEY_MODULE = 'lib/query-keys.ts'

/**
 * Not the web surface. Same subtraction, and the same reason, as
 * `read-only.test.ts` — a hardcoded `app`/`components`/`lib` walk cannot see a
 * directory added later, and a hook living in one would build its own cache keys
 * with this scanner green. Fixed 2026-08-17, F3 of the review.
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

const SOURCES = walk(APP_ROOT)

/** Strip comments, so a comment ABOUT `queryKey:` does not fail the rule. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the key shape separates books and years', () => {
  const scopeA = { entity: 'alpha', exercice: 2026 }
  const scopeB = { entity: 'beta', exercice: 2026 }

  // Mutation watched: `[BOOKS_KEY_ROOT, resource, {...}]` → `[resource, {...}]`.
  it('every key is namespaced under the app', () => {
    expect(booksKey('bilan', scopeA)[0]).toBe(BOOKS_KEY_ROOT)
    expect(booksGlobalKey('meta')[0]).toBe(BOOKS_KEY_ROOT)
  })

  // THE ONE THAT MATTERS.
  // Mutation watched: dropping `entity` from the object in `booksKey` — this
  // case went red and the two below stayed green, which is why it is separate.
  it('two books never share a cache slot', () => {
    expect(booksKey('bilan', scopeA)).not.toEqual(booksKey('bilan', scopeB))
  })

  // Mutation watched: dropping `exercice` from the object in `booksKey`.
  it('two fiscal years never share a cache slot', () => {
    expect(booksKey('bilan', { entity: 'alpha', exercice: 2025 })).not.toEqual(
      booksKey('bilan', { entity: 'alpha', exercice: 2026 })
    )
  })

  it('"no book chosen" is its own slot, not the first book\'s', () => {
    expect(booksKey('bilan', { entity: null, exercice: 2026 })).not.toEqual(
      booksKey('bilan', { entity: 'alpha', exercice: 2026 })
    )
  })

  it('two resources in the same book never share a slot', () => {
    expect(booksKey('bilan', scopeA)).not.toEqual(booksKey('cr', scopeA))
  })

  it('the same question asked twice is the same key', () => {
    expect(booksKey('ledger', scopeA, { account: '1020' })).toEqual(
      booksKey('ledger', scopeA, { account: '1020' })
    )
  })

  it('a filter is part of the key, not decoration', () => {
    expect(booksKey('ledger', scopeA, { account: '1020' })).not.toEqual(
      booksKey('ledger', scopeA, { account: '6570' })
    )
  })

  // A filter is merged INTO the scope object rather than appended as a fourth
  // element, so a filtered key is never a prefix of the unfiltered one —
  // TanStack Query invalidates by prefix, and a prefix relationship here would
  // make `invalidate(['books','ledger',{…}])` reach further than intended.
  it('a filtered key is not a prefix of the unfiltered one', () => {
    expect(booksKey('ledger', scopeA, { account: '1020' })).toHaveLength(
      booksKey('ledger', scopeA).length
    )
  })
})

describe('every hook actually uses it', () => {
  // Guards against a vacuous pass: if the walk finds nothing, every assertion
  // below is trivially true. CLAUDE.md finding #5 was caught by exactly this.
  it('found the modules this file is about', () => {
    expect(SOURCES.length, `nothing walked under ${APP_ROOT}`).toBeGreaterThan(5)
    expect(existsSync(join(APP_ROOT, KEY_MODULE)), `${KEY_MODULE} is gone`).toBe(true)
    const withKeys = SOURCES.filter((f) => /queryKey\s*:/.test(codeOf(readFileSync(f, 'utf8'))))
    expect(
      withKeys.length,
      'no module declares a queryKey at all — this scanner is checking nothing'
    ).toBeGreaterThan(0)
  })

  // Mutation watched: `queryKey: booksGlobalKey('meta')` → `queryKey: ['meta']`
  // in lib/hooks.ts. Went red naming the file and the literal.
  it('no queryKey is built from a literal', () => {
    const offenders: string[] = []
    for (const f of SOURCES) {
      if (rel(f) === KEY_MODULE) continue
      const src = codeOf(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/queryKey\s*:\s*([^,\n]+)/g)) {
        const expr = m[1].trim()
        if (!/^books(Key|GlobalKey)\s*\(/.test(expr)) {
          offenders.push(`${rel(f)}: queryKey: ${expr}`)
        }
      }
    }
    expect(
      offenders,
      'every queryKey must come from lib/query-keys.ts, so that no read can quietly ' +
        'omit which BOOK it is about:\n' + offenders.join('\n')
    ).toEqual([])
  })
})
