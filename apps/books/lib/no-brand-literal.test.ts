// The brand reaches a person through `lib/app.ts` and nowhere else.
//
// ===========================================================================
// WHY THIS EXISTS IN b/books (TICKET #756, 2026-09-23)
// ===========================================================================
// A copy of this app can run under another company's name, the way b/billing
// does. On 2026-09-23 the name was a literal in `lib/app.ts`, the `<title>`, the
// login card and the sidebar; the footer and the mail said `contact@blackcode.ch`;
// and the two dictionaries carried the family name sixty-odd times ("your
// blackcode account", "every blackcode app", "b/books — a blackcode product").
// All of it now flows from `lib/app.ts` — the dictionaries write `{app}`,
// `{platform}` and `{contactDomain}` and `lib/dictionary/index.ts` substitutes
// the three once, at assembly. This file is what refuses the next literal.
//
// It is `apps/billing/lib/no-brand-literal.test.ts` with this app's surfaces;
// that file's header records why it is a test and not a grep, and why the
// granularity of a text scan is part of what it checks (CLAUDE.md finding #11).
//
// ── THE ALLOWLIST IS ONE SHAPE, NOT A LIST OF LINES ────────────────────────
// `import … from '@blackcode/platform-i18n'` contains the word and reaches
// nobody. Rather than exempt the word inside a package name, the scan REMOVES
// module specifiers before looking, and then asserts that removal actually took
// something out — an allowlist that matched nothing has quietly stopped
// describing the code.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ────────────────────────────────────
// `lib/app.ts` MUST contain the defaults — it is the declaration. `lib/db/seed.ts`
// names the seed workspace `blackcode` for a database only a developer sees, and
// the dashboard pages' JSX comments retell seed-data incidents by that name;
// comments are stripped before the scan looks. It cannot see a name assembled at
// runtime or read from a different env var; the input assertions keep the
// pattern list, the directory list and the allowlist from silently emptying.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readableText } from '@blackcode/platform-testing'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * The directories whose contents a person reads.
 *
 * `app` and `components` are what a browser renders — through `t()`, so the
 * words themselves are in `lib/dictionary`. `lib/email` builds the mail
 * identity, and `lib/db/queries` writes the refusal sentences `bk books …`
 * prints. `lib/` as a whole is absent on purpose — see the header.
 */
const RENDERED_DIRS = ['app', 'components', 'lib/dictionary', 'lib/email', 'lib/db/queries']

/** Files under those directories that are not a rendered surface, each with why. */
const NOT_RENDERED: ReadonlyArray<{ file: string; why: string }> = []

/**
 * Spellings of the brand that must not appear in rendered output.
 *
 * `books` alone is NOT here and must not be: it is the slug, which appears
 * legitimately in every `bk books …` example on every page. The slug is not
 * branded and does not move with a rebrand (`lib/app.ts` says why).
 */
const BRAND_LITERALS: ReadonlyArray<{ re: RegExp; what: string; instead: string }> = [
  { re: /b\/books/, what: 'the product name', instead: 'APP_NAME, or {app} in a dictionary' },
  {
    re: /blackcode/i,
    what: 'the family name, the domain or the npm scope',
    instead: 'PLATFORM_NAME or CONTACT_EMAIL, or {platform} / {contactDomain} in a dictionary',
  },
  { re: /bc-issues/, what: 'the binary’s npm name', instead: 'CLI_NPM_PACKAGE from @blackcode/platform-agent' },
  { re: /b\/billing/, what: 'a sibling product a rebranded deployment does not have', instead: 'a sentence that does not name it' },
]

/** Block comments first, then line comments; `[^:]` keeps `https://` intact. See billing's copy for the stated limits. */


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

  it('scans the dictionaries, which is where this app’s words are', () => {
    expect(files.some((f) => relative(APP_ROOT, f).startsWith('lib/dictionary/'))).toBe(true)
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
