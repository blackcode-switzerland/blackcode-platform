// The stripper the brand guards read their files through.
//
// The case that matters is the FIRST one: a line comment whose prose contains
// `/*`. Two chained regexes read that as a block comment opening, and
// everything up to the next `*/` — in the file this was found in, 3,161
// characters of real code — stopped being scanned while the guard stayed green
// (ticket #756, 2026-09-23). Every other case here exists so the fix cannot be
// "delete the block-comment pass".
import { describe, expect, it } from 'vitest'
import { readableText, stripComments, stripSpecifiers } from '../src/source-text'

describe('stripComments', () => {
  it('keeps code that follows a line comment quoting `/*` (the bug this exists for)', () => {
    const src = [
      "// the plan says `/*` routes are cheap, and that a link which 404s",
      "// is worse than no link. See the note above.",
      "const placeholder = 'you@blackcode.ch'",
      '/** a real block comment mentioning blackcode */',
      "const other = 'kept'",
    ].join('\n')
    const { code, commentsRemoved } = stripComments(src)
    expect(code).toContain('you@blackcode.ch')
    expect(code).toContain('kept')
    expect(code).not.toContain('404s')
    expect(code).not.toContain('a real block comment')
    expect(commentsRemoved).toBe(3)
  })

  it('keeps code that follows a block comment quoting `//`', () => {
    const src = ["/* a note about https:// links and // dividers */", "const a = 'you@blackcode.ch'"].join('\n')
    const { code } = stripComments(src)
    expect(code).toContain('you@blackcode.ch')
    expect(code).not.toContain('dividers')
  })

  it('does not treat `//` inside a string as a comment', () => {
    const { code } = stripComments(`const url = 'https://blackcode.ch/pricing' // trailing`)
    expect(code).toContain('https://blackcode.ch/pricing')
    expect(code).not.toContain('trailing')
  })

  it('does not treat `/*` inside a string as a comment', () => {
    const { code } = stripComments(`const glob = '/*.ts'\nconst brand = 'blackcode'`)
    expect(code).toContain('blackcode')
  })

  it('reads through template literals, including `${…}` holes', () => {
    const src = 'const s = `hello ${name} at blackcode.ch` // gone\nconst t = `/* not a comment */`'
    const { code } = stripComments(src)
    expect(code).toContain('blackcode.ch')
    expect(code).toContain('/* not a comment */')
    expect(code).not.toContain('gone')
  })

  it('does not read a regex containing `//` as a comment', () => {
    const src = "const re = /https:\\/\\//\nconst brand = 'blackcode'"
    const { code } = stripComments(src)
    expect(code).toContain('blackcode')
  })

  it('keeps line numbers: a stripped comment leaves its newlines', () => {
    const src = ['/* one\n   two\n   three */', "const x = 'brand'"].join('\n')
    const { code } = stripComments(src)
    expect(code.split('\n').length).toBe(src.split('\n').length)
    expect(code.split('\n').findIndex((l) => l.includes('brand'))).toBe(3)
  })

  it('counts nothing on a file with no comments', () => {
    expect(stripComments("const a = 1\nconst b = 'x'").commentsRemoved).toBe(0)
  })
})

describe('stripSpecifiers', () => {
  it('removes the package name and keeps the sentence', () => {
    const src = ["import { x } from '@blackcode/platform-ui'", "const copy = 'made by blackcode'"].join('\n')
    const { code, removed } = stripSpecifiers(src)
    expect(removed).toBe(1)
    expect(code).not.toContain('@blackcode/platform-ui')
    expect(code).toContain('made by blackcode')
  })

  it('handles a bare import and a dynamic one', () => {
    const { removed } = stripSpecifiers("import '@blackcode/a'\nconst p = import('@blackcode/b')")
    expect(removed).toBe(2)
  })
})

describe('readableText', () => {
  it('is the two passes in order, and reports what each removed', () => {
    const src = ["import { t } from '@blackcode/platform-i18n' // the dictionary", "const s = 'you@blackcode.ch'"].join('\n')
    const out = readableText(src)
    expect(out.commentsRemoved).toBe(1)
    expect(out.specifiersRemoved).toBe(1)
    expect(out.code).toContain('you@blackcode.ch')
    expect(out.code).not.toContain('platform-i18n')
    expect(out.code).not.toContain('the dictionary')
  })
})
