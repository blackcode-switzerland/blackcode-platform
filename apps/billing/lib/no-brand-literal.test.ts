// The brand reaches a person through `lib/app.ts` and nowhere else.
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
// This checks the thing that matters: no rendered string contains the brand.
// Comments are stripped first, then module specifiers; string literals and JSX
// text are what remain.
//
// ===========================================================================
// WIDENED 2026-09-23 (TICKET #756): THE BRAND IS MORE THAN THE PRODUCT NAME
// ===========================================================================
// The first version looked for `b/billing` only, and it was green while the
// login form said `you@blackcode.ch`, the footer said `contact@blackcode.ch`,
// the landing page said "your blackcode account", the authorize page said
// "blackcode-wide token" and the install line named `@blackcode_sa/bc-issues`.
// Every one of those is what a patient or a clinic sees on a deployment that
// must not say Blackcode. So the list now has the family name, the domain, the
// npm scope, the old binary name and the sibling product — and it scans the
// non-UI surfaces a person still reads: the mail, the PDF, and the sentences
// the queries put into refusals and the audit log.
//
// ── THE ALLOWLIST IS ONE SHAPE, NOT A LIST OF LINES ────────────────────────
// `import … from '@blackcode/platform-ui/…'` contains the word and reaches
// nobody. Rather than exempt the word inside a package name (which would exempt
// `'@blackcode/platform-' + x` in a string too), the scan REMOVES module
// specifiers before looking: `from '…'`, `import '…'` and `import('…')`. It then
// asserts that removal actually took something out, because an allowlist that
// matched nothing is one that has quietly stopped describing the code.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
// `lib/app.ts` MUST contain the defaults — it is the declaration — and
// `lib/db/seed*.ts` names the seed workspace `blackcode` for a database only a
// developer sees. `lib/pdf/fixtures.ts` is a sample issuer for two test files.
// Widening to those would ban the one place a value is allowed to live.
//
// It also cannot see a name assembled at runtime (`'b/' + 'billing'`) or one
// read from a different env var. A text scan cannot, and pretending otherwise
// is finding #11 again. The input assertions keep the pattern list, the
// directory list and the allowlist from silently emptying; they cannot know
// about a spelling nobody told them about.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readableText } from '@blackcode/platform-testing'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * The directories whose contents a person reads.
 *
 * `app` and `components` are what a browser renders. `lib/email` builds the
 * mail identity, `lib/pdf` the invoice a customer holds, `lib/delivery` the
 * covering note, and `lib/db/queries` the refusal sentences and the audit-log
 * prose that `bk billing … show` prints to clinic staff.
 *
 * `lib/` as a whole is absent on purpose — see the header.
 */
const RENDERED_DIRS = ['app', 'components', 'lib/email', 'lib/pdf', 'lib/delivery', 'lib/db/queries']

/** Files under those directories that are not a rendered surface, each with why. */
const NOT_RENDERED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'lib/pdf/fixtures.ts',
    why: 'A sample issuer ("Blackcode Sàrl") imported by two test files and nothing else; it is test data, not a template.',
  },
]

/**
 * Spellings of the brand that must not appear in rendered output.
 *
 * `billing` alone is NOT here and must not be: it is the slug, which appears
 * legitimately in every `bk billing …` example on every page. The slug is not
 * branded and does not move with a rebrand (`lib/app.ts` says why).
 */
const BRAND_LITERALS: ReadonlyArray<{ re: RegExp; what: string; instead: string }> = [
  { re: /b\/billing/, what: 'the product name', instead: 'APP_NAME' },
  { re: /Blackcode Billing/, what: 'the product name', instead: 'APP_NAME' },
  {
    re: /blackcode/i,
    what: 'the family name, the domain or the npm scope',
    instead: 'PLATFORM_NAME, CONTACT_EMAIL, EMAIL_PLACEHOLDER or CLI_NPM_PACKAGE',
  },
  { re: /bc-issues/, what: 'the binary’s npm name', instead: 'CLI_NPM_PACKAGE from @blackcode/platform-agent' },
  { re: /b\/books/, what: 'a sibling product a rebranded deployment does not have', instead: 'a sentence that does not name it' },
]

/**
 * Strip `//` line comments and block comments, so a comment explaining the rule
 * does not violate it.
 *
 * ── THE ORDER MATTERS AND THE NAIVETY IS BOUNDED ───────────────────────────
 * Block comments first, then line comments. It is a regex, not a parser, so it
 * also blanks anything that LOOKS like a comment inside a string literal — a
 * URL like `https://x` keeps its tail only because of the `[^:]` guard. That
 * direction of error makes the scan see LESS, which could hide a violation, so
 * it is worth stating rather than glossing.
 *
 * It is acceptable here because the mutation runs recorded in
 * `docs/backend.md` inject a literal into real JSX and into a real string
 * literal and both are seen. A parser for this would be a second, weaker
 * TypeScript reader beside `tsc`, which is a worse trade than a stated limit.
 */


function renderedFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
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
  const skip = new Set(NOT_RENDERED.map((n) => join(APP_ROOT, n.file)))
  return out.filter((f) => !skip.has(f))
}

describe('no rendered string carries the brand', () => {
  it('every directory it scans exists (a renamed directory would shrink coverage silently)', () => {
    for (const d of RENDERED_DIRS) {
      expect(statSync(join(APP_ROOT, d)).isDirectory(), `${d} is not a directory`).toBe(true)
    }
  })

  it('every exemption names a file that exists', () => {
    for (const n of NOT_RENDERED) {
      expect(statSync(join(APP_ROOT, n.file)).isFile(), `${n.file} is exempted but does not exist`).toBe(true)
      expect(n.why.length, `${n.file} is exempted without a reason`).toBeGreaterThan(20)
    }
  })

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

  it('the allowlist removes something (else it has stopped describing the code)', () => {
    let removed = 0
    for (const file of files) removed += readableText(readFileSync(file, 'utf8')).specifiersRemoved
    expect(removed, 'no module specifier was stripped from any scanned file').toBeGreaterThan(0)
  })

  it('reads the brand from lib/app.ts, never a literal', () => {
    const offenders: string[] = []
    for (const file of files) {
      const { code } = readableText(readFileSync(file, 'utf8'))
      for (const brand of BRAND_LITERALS) {
        const lines = code.split('\n')
        const at = lines.findIndex((l) => brand.re.test(l))
        if (at >= 0) {
          offenders.push(
            `${relative(APP_ROOT, file)}:${at + 1} renders ${brand.what} (${brand.re}); use ${brand.instead}`
          )
        }
      }
    }
    expect(
      offenders,
      'these files put the brand into something a person reads:\n' +
        offenders.join('\n') +
        '\n\nA copy of this app runs under another company’s name ' +
        '(docs/backend.md → Branding), and a literal here is the first thing that ' +
        'deployment shows wrong.'
    ).toEqual([])
  })
})
