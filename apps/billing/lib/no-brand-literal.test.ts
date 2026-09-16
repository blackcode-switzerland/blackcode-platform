// The product name reaches a person through `APP_NAME` and nowhere else.
//
// ===========================================================================
// WHY THIS IS A TEST AND NOT THE GREP THE PLAN ASKED FOR
// ===========================================================================
// `docs/billing-app-plan/phase-0-register-the-app.md` states the exit criterion
// as a shell command:
//
//     grep -rn "b/billing" apps/billing/app apps/billing/components
//
// Run on 2026-09-17 it returned five hits and every one was a COMMENT — the
// header of `app/page.tsx` explaining why the name is environment-driven, and
// four route files saying things like "serving it is not `b/billing` has its own
// login". None of those reaches a browser.
//
// So the criterion as written cannot pass without deleting comments that earn
// their place, and a criterion nobody can satisfy is a criterion somebody
// ignores. **The granularity of a text scan is part of what it checks**
// (CLAUDE.md finding #11, where a scan of whole component FILES let one page
// vouch for another, and its replacement then matched the WORD `focus` and
// passed against `const focus = null`).
//
// This checks the thing that matters: no rendered string contains the default
// product name. Comments are stripped first; string literals and JSX text are
// what remain.
//
// ===========================================================================
// WHY IT MATTERS BEYOND TIDINESS
// ===========================================================================
// A copy of this app runs as another company's invoicing product
// (`docs/billing-app-plan/standalone-deployment.md`). A literal in a page is
// the first thing that deployment shows wrong, and the browser tab renders
// before anything else on the screen — `app/layout.tsx` carried
// `title: 'Scaffold app'` when it was copied, which is exactly that failure one
// app earlier.
//
// It is also the narrow, per-app ancestor of the brand-leak guard the
// extraction script ships INSIDE the customer's artifact. That one scans every
// text file for `[Bb]lackcode`, the old npm scope and the old binary name. This
// one scans the rendered surface of this app for this app's own name, which is
// the half that can be checked here.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
// `lib/`, `docs/` and the migrations. `lib/app.ts` MUST contain the default —
// it is the declaration — and `lib/vocabularies.ts`' header naming the app is
// prose in a module no browser renders. Widening this to `lib/` would be
// banning the one place the value is allowed to live.
//
// It also cannot see a name assembled at runtime (`'b/' + 'billing'`) or one
// read from a different env var. A text scan cannot, and pretending otherwise
// is finding #11 again. The `has something to look for` assertion keeps the
// pattern list from silently emptying; it cannot know about a spelling nobody
// told it about.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * The directories whose contents a browser renders.
 *
 * `lib/` is absent on purpose — see the header. So are `docs/` and
 * `lib/db/migrations/`, which are read by people and by Postgres, not by a
 * browser.
 */
const RENDERED_DIRS = ['app', 'components']

/**
 * Spellings of the product name that must not appear in rendered output.
 *
 * `billing` alone is NOT here and must not be: it is the slug, which appears
 * legitimately in every `bk billing …` example on every page. The slug is not
 * branded and does not move with a rebrand (`lib/app.ts` says why).
 */
const BRAND_LITERALS = ['b/billing', 'Blackcode Billing']

/**
 * Strip `//` line comments and block comments, so a comment explaining the rule
 * does not violate it.
 *
 * ── THE ORDER MATTERS AND THE NAIVETY IS BOUNDED ───────────────────────────
 * Block comments first, then line comments. It is a regex, not a parser, so it
 * also blanks anything that LOOKS like a comment inside a string literal — a
 * URL like `https://x` would lose its tail. That direction of error makes the
 * scan see LESS, which could hide a violation, so it is worth stating rather
 * than glossing.
 *
 * It is acceptable here because the pattern being hunted contains a slash and a
 * word (`b/billing`), and the mutation test below injects it into real JSX and
 * into a real string literal to prove both are still seen. A parser for this
 * would be a second, weaker TypeScript reader beside `tsc`, which is a worse
 * trade than a stated limit.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function renderedFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  for (const d of RENDERED_DIRS) walk(join(APP_ROOT, d))
  return out
}

describe('no rendered string carries the product name', () => {
  const files = renderedFiles()

  it('has files to scan (guards against a vacuous pass)', () => {
    expect(
      files.length,
      `scanned 0 files under ${RENDERED_DIRS.join(', ')} — it could not have found a ` +
        'violation if one existed'
    ).toBeGreaterThan(0)
  })

  it('has something to look for', () => {
    expect(
      BRAND_LITERALS.length,
      'the pattern list is empty, so the scan below looks for nothing and always passes'
    ).toBeGreaterThan(0)
  })

  it('reads the name from APP_NAME, never a literal', () => {
    const offenders: string[] = []
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const brand of BRAND_LITERALS) {
        if (code.includes(brand)) {
          const line = code.split('\n').findIndex((l) => l.includes(brand)) + 1
          offenders.push(`${relative(APP_ROOT, file)}:${line} renders "${brand}"`)
        }
      }
    }
    expect(
      offenders,
      'these files put the product name into rendered output:\n' +
        offenders.join('\n') +
        '\n\nImport `APP_NAME` from `@/lib/app` instead. A copy of this app runs under ' +
        "another company's name (docs/billing-app-plan/standalone-deployment.md), and a " +
        'literal here is the first thing that deployment shows wrong.'
    ).toEqual([])
  })
})
