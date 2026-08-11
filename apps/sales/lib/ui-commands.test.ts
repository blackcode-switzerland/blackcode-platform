// Does every `bk …` command this app's UI NAMES actually exist in the binary?
//
// ===========================================================================
// WHY: ONE OF THEM DID NOT, AND NOTHING COULD SEE IT
// ===========================================================================
// The Documents page told people documents were "linked with
// `bk sales doc create --url`". There is no `doc create` — the verb is `add`.
// Somebody following that sentence got `unknown command` and no way to tell
// whether the feature or the sentence was wrong.
//
// It passed typecheck, lint, every test and the build, because **a string in
// JSX is prose and nothing in this repo checks prose.** That is the same hole
// `bk undo` sat in on `apps/issues`' landing page for months, and this app is
// unusually exposed to it: it is a READ-ONLY surface by design, so its empty
// states and its write gates name a CLI command as the way to do the thing —
// fifteen of them, at the last count. Every one is a claim about a spelling.
//
// ===========================================================================
// THE INSTRUMENT, AND HOW IT DISCRIMINATES
// ===========================================================================
// Cobra makes an unknown subcommand hard to detect from the outside, and three
// obvious probes DO NOT WORK. They were each tried by hand first:
//
//   1. `bk sales prospect bogus --help` exits **0**. `--help` short-circuits
//      before argument validation.
//   2. `bk sales prospect bogus --zzz` reports "unknown FLAG", not "unknown
//      command" — flag parsing happens against the parent.
//   3. `bk sales prospect bogus` (bare) does report "unknown command" — and it
//      RUNS anything that is real, which is a network call and, for a verb with
//      no required arguments, a write. Not acceptable in a unit test.
//
// What works and touches nothing: `--help` prints a `Usage:` block, and the
// FIRST usage line of a real leaf is the leaf's own full path with its
// arguments (`bk sales prospect create --name <company> [flags]`), while an
// unknown subcommand falls back to the PARENT's (`bk sales prospect [flags]`).
// So the discriminator is whether the usage line begins with the full spelling.
//
// Both directions are asserted below, on fixed controls, so this file cannot
// pass by being unable to see anything (CLAUDE.md finding #16).
//
// ===========================================================================
// WHAT IT DOES NOT CHECK, STATED SO NOBODY CLAIMS MORE
// ===========================================================================
//   1. **FLAGS.** `bk sales doc add --title` is real; a UI string naming
//      `--titel` would pass. Only the command path is verified.
//   2. **Commands built by interpolation.** The scan reads literal backticked
//      spellings out of the source. `` `bk sales ${noun} list` `` is invisible
//      to it, and that is deliberate — a pattern that guessed would produce
//      false failures, which is worse than a stated gap.
//   3. **Prose that names no command.** "the agent records it" is unfalsifiable
//      by any instrument, and is the reason the marketing rule is "write
//      benefits, not capabilities".
//   4. **`apps/issues`' landing page**, where this class of defect was first
//      found. A test may not reach into another app; that app needs its own
//      copy of this file.
//
// D-26 step 3, watched failing on the fixed tree (2026-08-11):
//   - `bk sales doc add` changed back to `bk sales doc create` in
//     `components/catalog/catalog-pages.tsx` → RED, naming the file and the
//     spelling. Restored.
//   - the `EXPECT_REAL` control changed to a bogus verb → RED.
//   - the `EXPECT_GONE` control changed to a real one → RED.
//
// ===========================================================================
// IT NEEDS GO, AND IT FAILS RATHER THAN SKIPPING WITHOUT IT
// ===========================================================================
// `packages/platform-testing`'s parity check falls back to the `cli/routes.json`
// artifact when there is no Go toolchain. There is no equivalent artifact here:
// **`routes.json` is not a command inventory.** It is keyed on
// app+method+path, so two commands claiming the SAME route collapse to one —
// `bk sales objection counter` and `bk sales meeting log` are both real and
// both absent from it, because a sibling verb claims their route. Checking
// against it would have reported two false failures on the day this was
// written.
//
// So the binary is the only honest source, and a missing toolchain is a hard
// failure with a readable message rather than a skip. Go is already a hard
// requirement of this repo's gate (`cd cli && go build ./... && go test ./...`),
// and a silently-skipped check reports success — CLAUDE.md finding #12.

import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

/** Where a user-visible string can live. Not `app/`: pages are thin wrappers. */
const SCAN_DIRS = ['components']

/**
 * A backticked `bk …` spelling, as this app's UI writes one.
 *
 * Anchored to a backtick on both ends so it reads the same literals a reader
 * sees rendered. Stops at a flag or a `|`, because the app writes
 * `bk sales contact add | edit | rm` — three commands sharing a prefix — and
 * each half is expanded below rather than probed as one impossible string.
 */
const BK_IN_BACKTICKS = /`(bk [a-z0-9 |-]+?)`/g

/** `bk sales contact add | edit | rm` → three full spellings. */
function expand(raw: string): string[] {
  const parts = raw.split('|').map((p) => p.trim())
  const head = parts[0].split(/\s+/)
  if (parts.length === 1) return [parts[0]]
  const prefix = head.slice(0, -1) // `bk sales contact`
  return [parts[0], ...parts.slice(1).map((tail) => [...prefix, tail].join(' '))]
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

/**
 * Backticks inside `//` and `/* *​/` comments are NOT scanned.
 *
 * D-42, the fifth instance on this project: a guard that matches text will match
 * the text that explains it. Half this app's files carry a header discussing the
 * commands they name, including — after 2026-08-11 — the note in
 * `catalog-pages.tsx` recording that `bk sales doc create` never existed. Left
 * in, that comment would fail this test forever, and the "fix" somebody would
 * reach for is an allowance naming the file, which is an entry that keeps itself
 * alive. `lib/palette.test.ts` solved the same problem the same way.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

interface Claim {
  command: string
  file: string
}

function claimsInApp(): Claim[] {
  const found = new Map<string, string>()
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(join(APP_ROOT, dir))) {
      const src = stripComments(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(BK_IN_BACKTICKS)) {
        for (const cmd of expand(m[1])) {
          if (!found.has(cmd)) found.set(cmd, file.slice(APP_ROOT.length + 1))
        }
      }
    }
  }
  return [...found].map(([command, file]) => ({ command, file })).sort((a, b) =>
    a.command.localeCompare(b.command)
  )
}

let bk = ''

/** True when `bk <words> --help` prints THAT command's own usage line. */
function commandExists(command: string): boolean {
  const words = command.split(/\s+/).slice(1) // drop the leading `bk`
  let out: string
  try {
    out = execFileSync(bk, [...words, '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    // A non-zero exit is an answer too: read whatever it printed.
    out = String((err as { stdout?: string }).stdout ?? '') + String((err as { stderr?: string }).stderr ?? '')
  }
  const usage = out.match(/^Usage:\n\s*(.+)$/m)?.[1] ?? ''
  return usage.startsWith(command)
}

describe('every bk command the UI names is a command bk has', () => {
  beforeAll(() => {
    // Built once. `go run` per probe would recompile the whole binary fifteen
    // times; `platform-testing` uses `go run` because it invokes it once.
    const dir = mkdtempSync(join(tmpdir(), 'bk-ui-commands-'))
    bk = join(dir, 'bk')
    execFileSync('go', ['build', '-o', bk, './cmd/bk'], { cwd: CLI_DIR, timeout: 180_000 })
  }, 200_000)

  // ── THE CONTROLS ─────────────────────────────────────────────────────────
  // Without these, "nothing was found to be missing" is indistinguishable from
  // "the probe cannot tell". Both were watched inverted.
  const EXPECT_REAL = 'bk sales prospect create'
  const EXPECT_GONE = 'bk sales prospect bogus'

  it('THE PREMISE: the probe can see a real command', () => {
    expect(commandExists(EXPECT_REAL), `${EXPECT_REAL} is real and must be seen`).toBe(true)
  })

  it('THE PREMISE: the probe can see a missing command', () => {
    expect(commandExists(EXPECT_GONE), `${EXPECT_GONE} does not exist and must be refused`).toBe(
      false
    )
  })

  it('THE PREMISE: the scan found commands to check', () => {
    // Finding #5's assertion. A rename of `components/`, a regex that stopped
    // matching, or a refactor into interpolated strings would otherwise leave
    // this file green while checking nothing.
    expect(claimsInApp().length).toBeGreaterThan(8)
  })

  it('names no command that does not exist', () => {
    const bad = claimsInApp().filter((c) => !commandExists(c.command))
    expect(
      bad,
      'These commands are printed by this app\'s UI and `bk` does not have them.\n' +
        'A reader who follows one gets "unknown command" and cannot tell whether\n' +
        'the feature or the sentence is wrong. Fix the string, or add the command:\n' +
        bad.map((c) => `  ${c.command}   (${c.file})`).join('\n')
    ).toEqual([])
  })
})
