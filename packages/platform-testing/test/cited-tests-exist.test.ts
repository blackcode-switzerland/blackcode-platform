// A comment that cites a test file must cite one that exists.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS GUARD MATCHES TEXT. READ THIS BEFORE YOU CHANGE THE PATTERN. (D-42)
// ═══════════════════════════════════════════════════════════════════════════
// Guards that grep source have been found inert in this repo five times, and in
// every case the granularity of the match was the bug, not the intent: three
// globs that matched none of the real escapes (#4), a substring match over six
// hand-written strings (#9), a scan of whole files where one component vouched
// for two others and then a match on the WORD `focus` that `const focus = null`
// satisfied (#11), an import regex that knew `import` and `from` but not
// `require` (#13).
//
// **The trap specific to THIS file is self-reference.** It looks for strings
// ending in `.test.ts`, and it is itself a `.test.ts` file full of them. A scan
// that included its own directory would find the examples written in this
// header, resolve them against nothing, and either fail forever or — worse, if
// someone "fixed" that by loosening the resolver — pass over a repo where every
// citation is dead. Four self-reference traps have been hit on this project.
//
// The mitigations, both deliberate:
//   1. `test/` directories are excluded from the scan, so this file cannot see
//      itself. That is why the citations in this header are safe to write.
//   2. `it('found citations to check')` fails when the scan finds none, so a
//      pattern that stops matching anything cannot report success. That is the
//      failure mode this repo calls "assert your inputs", and it is the only
//      reason a text scan is trustworthy at all.
//
// When you change the pattern: point a citation at a file that does not exist,
// watch this go red, then restore.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT EXISTS
// ═══════════════════════════════════════════════════════════════════════════
// `apps/sales/lib/db/queries/entities.ts` carried, in the header of the file
// CLAUDE.md names as one of the two things standing between a code change and
// unrecoverable data loss:
//
//     `entities.projection.test.ts` asserts it, and asserts BOTH ways round
//
// There was no such file. The property had been checked by hand and the comment
// recorded the intention as though it were a committed check. Anyone reading
// that header — including an agent deciding whether a change was safe — would
// reasonably have concluded the invariant was guarded. It was not.
//
// A citation is a claim about what this repo protects. This makes the claim
// checkable.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

const SCAN_ROOTS = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')]

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'migrations',
  // See the header: excluding `test/` is what keeps this file from finding its
  // own examples. It is a real gap — a dead citation inside a test directory is
  // not caught — and it is the cheaper half of the trade.
  'test',
  '__tests__',
])

const SOURCE_EXT = /\.(ts|tsx)$/

/**
 * A citation: a `*.test.ts` / `*.test.tsx` filename mentioned in source.
 *
 * Deliberately matches the BARE FILENAME as well as a path, because that is how
 * these are actually written — "`entities.projection.test.ts` asserts it", not a
 * repo-relative path. A bare name is resolved against the citing file's own
 * directory first, which is what the author meant, and then against the whole
 * repo, because a comment may legitimately name a guard living elsewhere.
 */
const CITATION_RE = /[\w./-]*[\w-]+\.test\.tsx?/g

interface Citation {
  /** Repo-relative path of the file doing the citing. */
  from: string
  /** The cited filename or path, verbatim. */
  cited: string
}

function sourceFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.eslintrc.json') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...sourceFilesUnder(p))
    } else if (SOURCE_EXT.test(entry.name)) {
      // A test file citing itself, or citing a sibling it lives beside, is not
      // what this is looking for — and including them would put this file's own
      // header in scope through any future directory-layout change.
      if (/\.test\.tsx?$/.test(entry.name)) continue
      out.push(p)
    }
  }
  return out
}

/** Every `*.test.ts` path anywhere in the repo, by basename and by suffix. */
function allTestFiles(): { byName: Map<string, string[]>; paths: string[] } {
  const paths: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue
        walk(p)
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        paths.push(p)
      }
    }
  }
  for (const root of SCAN_ROOTS) walk(root)
  const byName = new Map<string, string[]>()
  for (const p of paths) {
    const n = basename(p)
    byName.set(n, [...(byName.get(n) ?? []), p])
  }
  return { byName, paths }
}

const TESTS = allTestFiles()

function collectCitations(): Citation[] {
  const out: Citation[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFilesUnder(root)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(CITATION_RE)) {
        out.push({ from: file.slice(REPO_ROOT.length + 1), cited: m[0] })
      }
    }
  }
  return out
}

const CITATIONS = collectCitations()

/**
 * Mentions that are NOT claims — a comment narrating a citation that was wrong,
 * which necessarily has to write the dead name to be about it.
 *
 * ── AN ALLOWANCE LIST IS HOW A GUARD ROTS, SO THIS ONE HAS TWO RULES ───────
 *   1. Every entry carries a REASON. Unexplained entries are indistinguishable
 *      from ones added to quiet a real failure.
 *   2. `it('has no stale allowances')` deletes the escape hatch for you: if the
 *      citation stops being present, or starts resolving, the entry fails.
 *      Without that, this list keeps a guard green over code nobody rechecked —
 *      which is the exact failure mode the guard exists to catch, moved one
 *      level up.
 *
 * Keyed `<citing file> -> <cited name>`, so an allowance covers ONE mention in
 * ONE file rather than a name everywhere.
 */
const ALLOWED = new Map<string, string>([
  // EMPTY, as of 2026-08-10. Its one entry covered a comment in
  // `apps/sales/lib/db/queries/entities.ts`, and that file is gone: Phase 3 of
  // the multi-app refactor removed this app's projection into
  // `platform.entities` altogether. The staleness assertion below is what
  // reported it — the allowance outlived the thing it excused by about an hour,
  // which is precisely the case it was written for.
  //
  // An empty map is a legitimate state and NOT a reason to delete this list or
  // the assertion: the next honest "this comment names a dead file on purpose"
  // goes here with its reason.
])

const allowKey = (c: Citation) => `${c.from}::${c.cited}`

/** Can this citation be resolved to a real file? */
function resolves(c: Citation): boolean {
  const citingDir = join(REPO_ROOT, dirname(c.from))

  // A path, relative to the citing file — what the author most likely meant.
  const asRelative = resolve(citingDir, c.cited)
  if (existsSync(asRelative) && statSync(asRelative).isFile()) return true

  // A path, relative to the repo root.
  const asRepoPath = join(REPO_ROOT, c.cited)
  if (existsSync(asRepoPath) && statSync(asRepoPath).isFile()) return true

  // A bare filename, or a partial path, matched anywhere in the repo. A comment
  // may legitimately name a guard that lives in another package.
  const name = basename(c.cited)
  const candidates = TESTS.byName.get(name)
  if (!candidates?.length) return false
  if (!c.cited.includes('/')) return true
  return TESTS.paths.some((p) => p.endsWith('/' + c.cited) || p.endsWith(c.cited))
}

describe('every test file cited in a comment exists', () => {
  // Assert the inputs, twice. A scan that found no citations, or no test files
  // to resolve them against, would pass the case below by iterating nothing —
  // and a citation guard that silently checks zero citations is exactly the
  // shape of thing it was written to catch.
  it('found citations to check', () => {
    expect(
      CITATIONS.length,
      `no "*.test.ts" citations found under ${SCAN_ROOTS.join(', ')}. Either the ` +
        'pattern stopped matching, or the scan is looking in the wrong place — ' +
        'both mean the case below checked nothing.'
    ).toBeGreaterThan(0)
  })

  it('found test files to resolve them against', () => {
    expect(
      TESTS.paths.length,
      'the scan found no *.test.ts files at all, so every citation would be ' +
        'reported dead for the wrong reason.'
    ).toBeGreaterThan(0)
  })

  it('resolves every one of them', () => {
    const dead = CITATIONS.filter((c) => !ALLOWED.has(allowKey(c)) && !resolves(c)).map(
      (c) => `${c.from} cites ${c.cited}`
    )
    expect(
      [...new Set(dead)].sort(),
      'these comments cite a test file that DOES NOT EXIST. A citation is a claim ' +
        'about what this repo protects, and a reader — human or agent — will take ' +
        'it as one when deciding whether a change is safe.\n' +
        'Either write the test, or change the comment to say the property is ' +
        'checked by hand:\n' +
        dead.join('\n')
    ).toEqual([])
  })

  // The allowance list's own guard. An entry that no longer describes anything
  // real is an escape hatch left open over code nobody rechecked.
  it('has no stale allowances', () => {
    const present = new Set(CITATIONS.map(allowKey))
    const stale: string[] = []
    for (const [k, reason] of ALLOWED) {
      if (!present.has(k)) {
        stale.push(`${k} — the mention is gone. Delete this entry. ("${reason}")`)
      } else {
        const [from, cited] = k.split('::')
        if (resolves({ from, cited })) {
          stale.push(`${k} — now RESOLVES, so the allowance is doing nothing. Delete it.`)
        }
      }
    }
    expect(
      stale,
      `these allowances no longer describe anything real:\n${stale.join('\n')}`
    ).toEqual([])
  })
})
