// A translated app decays one hardcoded string at a time, and nothing goes red.
//
// ===========================================================================
// THIS IS THE WEAKER OF THE TWO GUARDS, AND IT SAYS SO
// ===========================================================================
// The STRONG one is the type. `Dictionary<BooksKey>` is
// `Record<Locale, Record<K, string>>`, so every area file's `fr` owes every key
// its `en` declares: an English string added without its French is a `tsc`
// error, at the call site AND in the French table. That cannot be worded
// wrongly and cannot go inert. Prefer it wherever it reaches.
//
// It reaches everything EXCEPT the one thing this file is for: a string that was
// never put in the dictionary at all. Nothing in the type system can see
// `<p>Loading…</p>`.
//
// ===========================================================================
// WHAT IT CANNOT SEE — read this before trusting it
// ===========================================================================
// It is a TEXT SCAN, and the granularity of a text scan is part of what it
// checks (CLAUDE.md finding #11, which is two inert versions of one scan
// written in a single sitting). Named honestly:
//
//   1. **A template literal.** `` <p>{`Loading ${thing}`}</p> `` is invisible:
//      the scan looks at JSX TEXT and at a fixed list of attributes, and a
//      `{…}` expression is neither.
//   2. **Concatenation.** `{'Loading ' + thing}` — same reason.
//   3. **A string in a variable.** `const msg = 'Try again'` then `{msg}`. The
//      declaration is not JSX text and the use is an expression.
//   3b. **A sentence containing a `(` on a line by itself, or the word
//      `return`.** The JSX-text regex below is `>…<` with a lookbehind, and the
//      lookbehind is what separates `<span>` from `x > 0` and from `=>`. It is
//      a heuristic: a real close-bracket is preceded by a quote, a brace, a
//      slash or a tag character, and a comparison is preceded by a space. A
//      hardcoded sentence that happened to sit immediately after `foo> ` would
//      be missed, and so would one inside a generic call's argument list.
//   4. **An attribute nobody listed.** `ATTRIBUTES` below is a list, and a
//      thirteenth user-visible attribute added to React or to this app is one
//      the scan does not know about. It is asserted to be non-empty and every
//      name in it is one this app actually uses, but it cannot be complete.
//   5. **A string in a `lib/` module** that a component renders. `lib/nav.ts`,
//      `lib/compliance.ts` and `lib/verdict.ts` were exactly this and were
//      converted to KEYS on 2026-08-20 — that is the fix, not a scan.
//   6. **Whether the French is any good.** It checks that a key HAS a French
//      side, never that the sentence is right. Nothing automated can.
//
// So it catches the ordinary case — somebody types a sentence into JSX — and
// nothing else. That is worth having and it is not a substitute for opening the
// pages in both languages.
//
// ── WATCH IT FAIL BEFORE TRUSTING IT ──────────────────────────────────────
// It was watched go red twice, on 2026-08-20:
//
//   a) `<p>Everything is fine here.</p>` added to `components/states.tsx`
//      → "these look like user-facing strings … components/states.tsx".
//   b) a key added to `lib/dictionary/chrome.ts`'s `en` and not to its `fr`
//      → `tsc` error, at the call site and in the French table.
//
// (b) is the type doing the work, and it is listed here because THIS file is
// where somebody will look for it.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALES } from '@blackcode/platform-i18n'
import { DICTIONARY, DICTIONARY_AREAS } from './dictionary'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const rel = (p: string) => relative(APP_ROOT, p).split('\\').join('/')

/** Where the user-facing surface is. Everything under these is scanned. */
const SURFACE = ['app', 'components']

/**
 * Files that render no product copy, with a reason each.
 *
 * Same shape as `lib/read-only.test.ts`'s exclusion list and asserted the same
 * way below: every name has to still exist, so the list cannot rot into a
 * silent exemption.
 */
const NOT_COPY: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'app/layout.tsx',
    why: 'The <title> and <meta description>. They are the app’s NAME in a browser tab and in a search result, not chrome — b/books is called b/books in both languages, and a localised <title> would be one more thing for the two to disagree about.',
  },
  {
    file: 'components/no-books.tsx',
    why: 'The `bk books entity create` block is a COMMAND, in a <pre>. Translating `--legal-form` would produce a French sentence containing a flag that does not exist.',
  },
]

/**
 * Attributes whose value is read by a person or by a screen reader.
 *
 * Not exhaustive and cannot be — see the header, point 4. Every one of these is
 * an attribute this app actually uses.
 */
const ATTRIBUTES = [
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  'note',
  'empty',
  'statement',
  'because',
  'what',
]

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(p)
  }
  return out
}

const SOURCES = SURFACE.flatMap((d) => walk(join(APP_ROOT, d)))

/** Comments are prose ABOUT the code and must not trip a scan of the code. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Does this text read as a SENTENCE somebody wrote, rather than as code?
 *
 * Two words or more, at least one of them four letters or longer, and starting
 * with a capital or a lower-case word — which is what a sentence looks like and
 * what `scope.record?.name ?? '—'` does not. Deliberately conservative: a scan
 * that fires on `{' '}` or on a css class teaches people to add exemptions, and
 * an exemption list is how a guard stops guarding.
 */
function looksLikeCopy(text: string): boolean {
  const t = text.trim()
  if (t.length < 8) return false
  // The tail of a generic call — `useRef<HTMLElement>(null)` — reaches here as
  // `(null)\n  return (`. Prose does not open with a bracket.
  if (/^[()]/.test(t)) return false
  // A line of code that the bracket heuristic let through. `return`, `const`
  // and `function` are not words this product's copy uses; `if` is, so it is
  // deliberately NOT in this list.
  if (/\b(return|const|let|function|await|typeof)\b/.test(t)) return false
  // Anything with a brace, a bracket, an arrow or a semicolon is code that the
  // crude JSX-text regex happened to capture.
  if (/[{}[\]<>;=]|=>/.test(t)) return false
  if (/^[\d\s·—–\-+%.,:/#]*$/.test(t)) return false
  const words = t.split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w))
  if (words.length < 2) return false
  return words.some((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4)
}

describe('the inputs — assert these first, or the check below is theatre', () => {
  it('walked a real surface', () => {
    // A scan over zero files finds zero violations and reports a confident
    // green. CLAUDE.md names this as a corollary of the standing rule.
    expect(SOURCES.length, `nothing walked under ${APP_ROOT}`).toBeGreaterThan(40)
    const dirs = new Set(SOURCES.map((f) => rel(f).split('/')[0]))
    for (const d of SURFACE) {
      expect(dirs.has(d), `${d}/ is not being scanned`).toBe(true)
    }
  })

  it('every exemption names a file that exists', () => {
    expect(NOT_COPY.length, 'the exemption list is empty').toBeGreaterThan(0)
    const missing = NOT_COPY.filter((e) => !existsSync(join(APP_ROOT, e.file)))
    expect(
      missing.map((e) => e.file),
      'these are exempt from the hardcoded-string scan and no longer exist. An exemption ' +
        'for a file that is gone is a comment, not an exemption.'
    ).toEqual([])
    for (const e of NOT_COPY) {
      expect(e.why.length, `${e.file} is exempt with no reason given`).toBeGreaterThan(30)
    }
  })

  it('the sentence test can tell copy from code', () => {
    // The discriminator itself, asserted both ways. Without this the scan could
    // be made green by weakening `looksLikeCopy` until it matched nothing, which
    // is the shape of every inert guard in CLAUDE.md's table.
    expect(looksLikeCopy('Loading the balance sheet'), 'missed an obvious sentence').toBe(true)
    expect(looksLikeCopy('This entry has no lines.'), 'missed an obvious sentence').toBe(true)
    expect(looksLikeCopy('#'), 'fired on punctuation').toBe(false)
    expect(looksLikeCopy('2026'), 'fired on a number').toBe(false)
    expect(looksLikeCopy(' · '), 'fired on a separator').toBe(false)
    expect(looksLikeCopy('bk'), 'fired on a two-letter token').toBe(false)
  })
})

describe('no user-facing string is hardcoded in a component', () => {
  it('JSX text goes through t()', () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      const r = rel(file)
      if (NOT_COPY.some((e) => e.file === r)) continue
      const code = codeOf(readFileSync(file, 'utf8'))
      const hits = new Set<string>()
      // The lookbehind is the whole discriminator between a JSX close bracket
      // and an operator: `<span>` and `className="x">` end in a tag character,
      // a quote or a brace, while `length > 0` has a SPACE before the `>` and
      // an arrow has `=`. See the header, point 3b — it is a heuristic and it
      // is named as one.
      for (const m of code.matchAll(/(?<=[^\s=\-!<>])>([^<>{}]+)</g)) {
        if (looksLikeCopy(m[1])) hits.add(m[1].trim())
      }
      if (hits.size > 0) offenders.push(`${r}\n    ${[...hits].join('\n    ')}`)
    }
    expect(
      offenders,
      'these look like user-facing strings written straight into JSX. Move each one into ' +
        '`lib/dictionary/` and render it with `t()`, or — if it is a command, a served ' +
        'value or a legal citation — say so in NOT_COPY with a reason:\n' +
        offenders.join('\n')
    ).toEqual([])
  })

  it('a user-visible attribute goes through t()', () => {
    const attrs = ATTRIBUTES.join('|')
    const re = new RegExp(`\\b(?:${attrs})\\s*=\\s*(['"])([^'"]+)\\1`, 'g')
    const offenders: string[] = []
    for (const file of SOURCES) {
      const r = rel(file)
      if (NOT_COPY.some((e) => e.file === r)) continue
      const code = codeOf(readFileSync(file, 'utf8'))
      const hits = new Set<string>()
      for (const m of code.matchAll(re)) {
        if (looksLikeCopy(m[2])) hits.add(`${m[0]}`)
      }
      if (hits.size > 0) offenders.push(`${r}\n    ${[...hits].join('\n    ')}`)
    }
    expect(
      offenders,
      'these attributes carry a literal sentence. A `title=` and an `aria-label=` are read ' +
        'by a person; route them through `t()`:\n' + offenders.join('\n')
    ).toEqual([])
  })

  it('the attribute list is not empty and names attributes this app uses', () => {
    expect(ATTRIBUTES.length).toBeGreaterThan(5)
    const all = SOURCES.map((f) => codeOf(readFileSync(f, 'utf8'))).join('\n')
    const unused = ATTRIBUTES.filter((a) => !new RegExp(`\\b${a}\\s*=`).test(all))
    expect(
      unused,
      'these attributes are scanned for and appear nowhere in the app. An entry that matches ' +
        'nothing is a name somebody added on the assumption it was used:\n' + unused.join(', ')
    ).toEqual([])
  })
})

describe('the dictionary itself', () => {
  it('every locale carries every key', () => {
    // The TYPE already guarantees this per area file. Asserted at runtime too
    // because the type is checked by `tsc` and this suite is what people run —
    // and because it is what catches a key lost in the spread below.
    const keys = Object.keys(DICTIONARY.en)
    expect(keys.length, 'the dictionary is empty').toBeGreaterThan(300)
    for (const loc of LOCALES) {
      const missing = keys.filter((k) => !(k in DICTIONARY[loc]))
      expect(missing, `${loc} is missing ${missing.length} keys:\n${missing.join('\n')}`).toEqual([])
      const blank = keys.filter((k) => (DICTIONARY[loc] as Record<string, string>)[k].trim() === '')
      expect(blank, `${loc} has blank values:\n${blank.join('\n')}`).toEqual([])
    }
  })

  it('no key is defined in two area files', () => {
    // The area files are merged with a spread, so a duplicate is a SILENT
    // overwrite — the later file wins and the earlier one's translation is
    // never rendered, with nothing to see.
    const seen = new Map<string, number>()
    for (const [i, area] of DICTIONARY_AREAS.entries()) {
      for (const key of Object.keys(area.en)) {
        const first = seen.get(key)
        expect(first, `"${key}" is defined in two area files (${first} and ${i})`).toBeUndefined()
        seen.set(key, i)
      }
    }
    expect(seen.size, 'the areas contributed nothing').toBe(Object.keys(DICTIONARY.en).length)
  })

  it('every area file contributes something', () => {
    // An area file left as an empty stub is a whole screen nobody translated,
    // and the merge would hide it perfectly.
    const empty = DICTIONARY_AREAS.map((a, i) => [i, Object.keys(a.en).length] as const).filter(
      ([, n]) => n === 0
    )
    expect(empty, `area files with no keys: ${empty.map(([i]) => i).join(', ')}`).toEqual([])
  })

  it('a placeholder in one language exists in the other', () => {
    // `{n}` in English and `{count}` in French renders the literal `{count}` on
    // a French screen — a rendering fault the type cannot see, because both
    // sides are strings.
    const bad: string[] = []
    for (const key of Object.keys(DICTIONARY.en)) {
      const names = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
      const enNames = names((DICTIONARY.en as Record<string, string>)[key])
      for (const loc of LOCALES) {
        if (loc === 'en') continue
        const locNames = names((DICTIONARY[loc] as Record<string, string>)[key])
        for (const n of locNames) {
          if (!enNames.has(n)) bad.push(`${key}: ${loc} uses {${n}} and en does not`)
        }
        for (const n of enNames) {
          if (!locNames.has(n)) bad.push(`${key}: en uses {${n}} and ${loc} does not`)
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})
