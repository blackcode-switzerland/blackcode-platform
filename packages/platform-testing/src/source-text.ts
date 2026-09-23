// What a person can READ from a source file: its strings and its JSX text,
// with comments and module specifiers taken out.
//
// ===========================================================================
// WHY THIS IS NOT TWO `String.replace` CALLS
// ===========================================================================
// The brand guards (`apps/*/lib/no-brand-literal.test.ts`) began with
//
//     src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
//
// and it was GREEN while a brand literal sat in plain code. The reason is worth
// stating, because it is the shape of half the findings in CLAUDE.md's table:
// **the first pass cannot tell a block comment from the two characters that
// open one appearing inside something else.** `apps/books/components/
// login-form.tsx` has a line comment whose prose quotes a route pattern, so the
// file contains `/*` inside a `//` line. The block-comment regex opened there
// and closed at the next `*/` — **3,161 characters later**, swallowing real
// code in between, including the input class and anything a rebrand would leak
// into it. Measured 2026-09-23 (ticket #756) by putting `you@blackcode.ch` in
// that gap and watching the guard stay green.
//
// Stripping line comments first only moves the hole: a `//` inside a block
// comment then ends it early. There is no ordering of two regexes that is
// right, because the question ("is this `/*` code, a string, or prose?") needs
// the state a scanner carries and a regex does not.
//
// ── WHAT IT KNOWS ──────────────────────────────────────────────────────────
// Single and double quoted strings and their escapes, template literals with
// nested `${…}`, line comments, block comments, and regex literals (so that
// `/https:\/\//` is not read as a comment). Enough to answer the one question
// the guards ask. It is NOT a TypeScript parser and does not pretend to be:
// what it returns is text to search, not an AST.
//
// ── A REGEX LITERAL OR A DIVISION? ─────────────────────────────────────────
// The lexer's classic ambiguity. A `/` starts a regex when what precedes it
// cannot end an expression — an operator, a comma, an opening bracket, a
// keyword, or the start of the file — and is division otherwise. Guessing wrong
// on a division is harmless here (a few characters of arithmetic are searched
// as if they were a pattern, and no brand hides in arithmetic); guessing wrong
// on a regex containing `//` would hide the rest of the line, so the rule
// leans towards "regex".

/** A line comment's text, and where it was, for a caller that wants to report on it. */
export interface StrippedSource {
  /** The source with comments removed; strings, JSX text and code remain. */
  code: string
  /** How many comments were taken out. Zero on a file with none — assert on it before trusting a clean scan. */
  commentsRemoved: number
}

const BEFORE_REGEX = /[(,=:[!&|?{};+\-*%~^<>]$/

/**
 * Remove every comment, keeping everything a person can read.
 *
 * Newlines inside a removed comment are KEPT, so a line number computed from
 * the result still points at the right line of the original.
 */
export function stripComments(src: string): StrippedSource {
  let out = ''
  let i = 0
  let commentsRemoved = 0
  // A comment is consumed whole in one step, so there is no `line` or `block`
  // state to be in: what remains is code, a string, a template or a regex.
  let state: 'code' | 'regex' | "'" | '"' | 'template' = 'code'
  // `${…}` depth inside template literals, so a `}` knows whether it closes one.
  const templateStack: number[] = []
  let braceDepth = 0

  const keepNewlines = (text: string) => text.replace(/[^\n]/g, '')

  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]

    if (state === 'code') {
      if (c === '/' && next === '/') {
        const end = src.indexOf('\n', i)
        const stop = end === -1 ? src.length : end
        out += keepNewlines(src.slice(i, stop))
        commentsRemoved += 1
        i = stop
        continue
      }
      if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2)
        const stop = end === -1 ? src.length : end + 2
        out += keepNewlines(src.slice(i, stop))
        commentsRemoved += 1
        i = stop
        continue
      }
      if (c === "'" || c === '"') {
        state = c
        out += c
        i += 1
        continue
      }
      if (c === '`') {
        state = 'template'
        templateStack.push(braceDepth)
        out += c
        i += 1
        continue
      }
      if (c === '/') {
        // Regex or division: look at the last thing that was not whitespace.
        const before = out.replace(/\s+$/, '')
        if (before === '' || BEFORE_REGEX.test(before) || /\b(return|typeof|case|in|of|do|else)$/.test(before)) {
          state = 'regex'
        }
        out += c
        i += 1
        continue
      }
      if (c === '{') braceDepth += 1
      if (c === '}') {
        braceDepth -= 1
        if (templateStack.length > 0 && braceDepth === templateStack[templateStack.length - 1]) {
          // Closing a `${…}`: back inside the template literal.
          state = 'template'
        }
      }
      out += c
      i += 1
      continue
    }

    if (state === "'" || state === '"') {
      if (c === '\\') {
        out += src.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === state) state = 'code'
      out += c
      i += 1
      continue
    }

    if (state === 'regex') {
      if (c === '\\') {
        out += src.slice(i, i + 2)
        i += 2
        continue
      }
      // A `[` … `]` class may contain an unescaped `/`; this is close enough for
      // the question asked, and erring here only searches a few more characters.
      if (c === '/' || c === '\n') state = 'code'
      out += c
      i += 1
      continue
    }

    // Template literal.
    if (c === '\\') {
      out += src.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === '$' && next === '{') {
      state = 'code'
      braceDepth += 1
      out += '${'
      i += 2
      continue
    }
    if (c === '`') {
      state = 'code'
      templateStack.pop()
      out += c
      i += 1
      continue
    }
    out += c
    i += 1
  }

  return { code: out, commentsRemoved }
}

/** `from '…'`, `import '…'` and `import('…')` — a package name is not copy. */
const SPECIFIER = /\bfrom\s+(['"])[^'"\n]+\1|\bimport\s*\(\s*(['"])[^'"\n]+\2\s*\)|\bimport\s+(['"])[^'"\n]+\3/g

/**
 * Remove module specifiers. `@blackcode/platform-ui` is a package that reaches
 * nobody; exempting the WORD instead would also exempt it inside a sentence.
 */
export function stripSpecifiers(code: string): { code: string; removed: number } {
  let removed = 0
  const out = code.replace(SPECIFIER, (m) => {
    removed += 1
    return m.replace(/[^\n]/g, '')
  })
  return { code: out, removed }
}

/** Both passes, in the one order that is correct: comments by scanner, then specifiers. */
export function readableText(src: string): { code: string; commentsRemoved: number; specifiersRemoved: number } {
  const { code, commentsRemoved } = stripComments(src)
  const { code: out, removed } = stripSpecifiers(code)
  return { code: out, commentsRemoved, specifiersRemoved: removed }
}
