// THE CLI'S @mention HELP, HELD AGAINST THE REGEX THAT IMPLEMENTS IT.
//
// `@mention` has always worked: `MENTION_RE` in lib/db/queries/comments.ts
// matches `@someone@domain.com` in a plain comment body, resolves it against
// workspace membership and writes an inbox row. Nothing in `bk issues issue
// comment --help` said so, and the 2026-08-12 CLI report filed the whole
// feature as MISSING. Phase 1 added one line of flag help — including a worked
// example — and that line is now a claim about this file.
//
// The claim has two halves and both are asserted, because half of it is the
// half that would go quiet:
//
//   POSITIVE — the example address in the help actually matches. A guard built
//   only on "the wrong shape is rejected" is satisfied by a regex that rejects
//   everything (CLAUDE.md finding #16), and this help line's whole point is
//   that ONE spelling works.
//
//   NEGATIVE — a bare `@username`, which is what a reader who has used any
//   other tracker will type, does not. That is why the help says EMAIL.
//
// It reads the Go source rather than restating the sentence here: a copy of the
// help text in a test is two strings that can drift apart, which is the exact
// defect this file exists to prevent one level up.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const CLI_ISSUE_GO = join(REPO_ROOT, 'cli', 'internal', 'commands', 'issues', 'issue.go')
const COMMENTS_TS = join(REPO_ROOT, 'apps', 'issues', 'lib', 'db', 'queries', 'comments.ts')

/**
 * The regex, taken from the source that runs it rather than retyped. If the
 * declaration moves or is renamed this throws, which is the right outcome — a
 * test that quietly stopped finding its subject would pass forever.
 */
function mentionRegex(): RegExp {
  const src = readFileSync(COMMENTS_TS, 'utf8')
  const m = src.match(/^const MENTION_RE = \/(.+)\/([gimsuy]*)$/m)
  if (!m) {
    throw new Error(
      `MENTION_RE is no longer declared as a top-level regex literal in ${COMMENTS_TS} — ` +
        `this test can no longer see what the CLI help is promising.`
    )
  }
  return new RegExp(m[1], m[2])
}

/** Every `@x@y.z` example appearing in the CLI's comment help strings. */
function examplesInCliHelp(): string[] {
  const src = readFileSync(CLI_ISSUE_GO, 'utf8')
  const lines = src.split('\n').filter((l) => l.includes('@mention'))
  expect(
    lines.length,
    `no line in ${CLI_ISSUE_GO} mentions "@mention" — the help this test guards was removed`
  ).toBeGreaterThan(0)
  const out: string[] = []
  for (const line of lines) {
    for (const m of line.matchAll(/\(@([^)\s]+)\)/g)) out.push(m[1])
  }
  return out
}

describe('the @mention line in `bk issues issue comment --help`', () => {
  it('gives at least one worked example', () => {
    // Assert the input: without this, every check below is vacuous on an empty
    // list. This is the assertion CLAUDE.md finding #5 was caught by.
    expect(examplesInCliHelp().length).toBeGreaterThan(0)
  })

  it('uses an address the server actually resolves', () => {
    const re = mentionRegex()
    for (const example of examplesInCliHelp()) {
      const body = `thanks @${example} — can you take a look?`
      const found = Array.from(body.matchAll(re)).map((m) => m[1])
      expect(
        found,
        `the help offers @${example} as a working mention, and MENTION_RE does not match it`
      ).toContain(example)
    }
  })

  it('does not match the bare @username the help warns against', () => {
    const re = mentionRegex()
    expect(Array.from('thanks @ana — take a look'.matchAll(re))).toHaveLength(0)
  })
})

// The other half of what Phase 1 wrote down: `edit-comment --body` says an
// @mention ADDED by an edit does not notify. That is a fact about
// updateComment(), which never calls resolveMentions() and never touches the
// `mentions` column — so the day someone fixes that, this test fails and the
// help gets corrected with it.
describe('editing a comment', () => {
  it('still does not resolve mentions, as edit-comment --help states', () => {
    const src = readFileSync(COMMENTS_TS, 'utf8')
    const start = src.indexOf('export async function updateComment')
    expect(start, 'updateComment is gone from comments.ts').toBeGreaterThan(-1)
    const next = src.indexOf('\nexport async function', start + 1)
    const body = src.slice(start, next === -1 ? undefined : next)
    expect(body).not.toContain('resolveMentions')

    const cliSrc = readFileSync(CLI_ISSUE_GO, 'utf8')
    expect(
      cliSrc,
      'edit-comment --help no longer warns that an edited-in mention notifies nobody'
    ).toContain('does not notify')
  })
})
