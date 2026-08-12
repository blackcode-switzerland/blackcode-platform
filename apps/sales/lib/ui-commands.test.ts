// The UI names no `bk` commands — and where it deliberately does, they are real.
//
// ===========================================================================
// THE RULE CHANGED ON 2026-08-12, AND SO DID THIS FILE
// ===========================================================================
// This test used to assert one thing: every `bk …` spelling printed by this
// app's UI is a command the binary actually has. That was the right check while
// the UI's whole idiom was to name a command — empty states, write gates and
// `AgentOnly` notes all ended in one, fifteen at the last count.
//
// The idiom is gone. Naming a CLI command at a HUMAN reading a sales page was
// an instruction addressed to somebody who is not there: they supervise the
// agent, they do not install a Go binary. `components/forms.tsx`' header has
// the full argument.
//
// So the property is now TWO properties, and the second is stronger than
// anything this file checked before:
//
//   1. ORDINARY UI COPY NAMES NO COMMAND AT ALL. Not "names only real ones" —
//      names none. This is the §6 rule, and it is enforced rather than trusted
//      because prose is the one surface in this repo nothing else reads.
//
//   2. THE TWO PAGES THAT ARE *ABOUT* THE CLI still name real commands. The
//      landing page's quickstart and the token page's `bk login` are legitimate
//      — they exist to tell somebody how to start using the tool — so they keep
//      the original existence check.
//
// ── AND THE SCANNER GOT WIDER, WHICH CLOSES A STATED HOLE ──────────────────
// It matched backticked spellings only. `landing-page.tsx` prints its quickstart
// inside a `<pre>` as a template literal, so NONE of those four commands were
// ever checked — and the file says so in a comment: "the page is not covered by
// any check in this repo". It is now. The scan reads any `bk <verb>` in
// non-comment source, which is what makes rule 1 enforceable at all: a command
// smuggled into prose without backticks was invisible to the old pattern.
//
// ===========================================================================
// WHY THE ORIGINAL CHECK EXISTED: ONE OF THEM DID NOT, AND NOTHING SAW IT
// ===========================================================================
// The Documents page told people documents were "linked with
// `bk sales doc create --url`". There is no `doc create` — the verb is `add`.
// Somebody following that sentence got `unknown command` and no way to tell
// whether the feature or the sentence was wrong.
//
// It passed typecheck, lint, every test and the build, because **a string in
// JSX is prose and nothing in this repo checks prose.** That is the same hole
// `bk undo` sat in on `apps/issues`' landing page for months.
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
//   2. **Commands built by interpolation.** `` `bk sales ${noun} list` `` is
//      invisible to the scan, and that is deliberate — a pattern that guessed
//      would produce false failures, which is worse than a stated gap.
//   3. **Prose that names no command.** "the agent records it" is unfalsifiable
//      by any instrument, and is the reason the marketing rule is "write
//      benefits, not capabilities".
//   4. **`apps/issues`' landing page**, where this class of defect was first
//      found. A test may not reach into another app; that app needs its own
//      copy of this file.
//
// WATCHED FAILING on the finished tree (2026-08-12), all three checks:
//   - `bk sales meeting schedule` put back into `today-page.tsx`'s empty state
//     → RED on rule 1, naming the file. Restored.
//   - the landing page's `bk sales prospect list` changed to `… listt`
//     → RED on rule 2, naming the spelling and the file. Restored.
//   - both scan patterns replaced with one that matches nothing
//     → RED on the premise. Restored.
// And on 2026-08-11, for the version this replaces:
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
 * The files that are legitimately ABOUT the CLI, with the reason each is
 * allowed to name one. Every entry needs a reason, as an exclusion in
 * `cli-parity.test.ts` does — an unexplained one is how a rule rots into a
 * list of whatever happened to be there.
 */
const CLI_PAGES: Record<string, string> = {
  'components/landing-page.tsx':
    'The marketing page, whose subject IS the agent surface — its quickstart ' +
    'block is how somebody installs and authenticates the tool in the first ' +
    'place. A page explaining the CLI is the one page that may name it.',
  'components/settings/token-settings.tsx':
    'The API tokens page. A token exists to be pasted into `bk login`; naming ' +
    'the command it is FOR is what makes the page usable, and the reader here ' +
    'has already decided to use the CLI.',
}

/**
 * A `bk …` spelling anywhere in non-comment source.
 *
 * ── WIDER THAN THE BACKTICKED PATTERN IT REPLACES ──────────────────────────
 * It was ``/`(bk [a-z0-9 |-]+?)`/`` — backticks on both ends — which matched the
 * idiom the UI happened to use and nothing else. Two things escaped it: the
 * landing page's `<pre>` quickstart (a template literal, four commands, checked
 * by nothing) and any command written into prose without backticks, which is
 * precisely how rule 1 would be broken by somebody not thinking about it.
 *
 * Bounded at two words after the app segment, which covers every real spelling
 * (`bk login`, `bk sales prospect list`) without swallowing the rest of a
 * sentence. A stray match in prose is a FALSE POSITIVE THAT IS STILL RIGHT: it
 * means a sentence reads as if it names a command, which rule 1 forbids anyway.
 */
const BK_COMMAND = /(?<![\w`-])bk (?:sales |issues )?[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?/g

/**
 * The backticked form, kept for the `a | b | c` expansion below.
 *
 * The app wrote `bk sales contact add | edit | rm` — three commands sharing a
 * prefix — and each half has to be probed as its own spelling rather than as
 * one impossible string.
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
 * Text inside `//` and slash-star comments is NOT scanned.
 *
 * D-42, the fifth instance on this project: a guard that matches text will match
 * the text that explains it. Half this app's files carry a header discussing the
 * commands they used to name — including this change's own notes about what was
 * removed and why. Left in, those comments would fail this test forever, and the
 * "fix" somebody would reach for is an allowance naming the file, which is an
 * entry that keeps itself alive. `lib/palette.test.ts` solved the same problem
 * the same way.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

interface Claim {
  command: string
  file: string
}

/**
 * Every (command, file) pair — deduped PER FILE, not per command.
 *
 * ── THE KEY IS THE POINT ───────────────────────────────────────────────────
 * The first version of this deduped on the command alone and kept whichever
 * file it was seen in first. `bk login` appears in BOTH `landing-page.tsx` and
 * `token-settings.tsx`, so the second occurrence vanished — and that is exactly
 * the shape that would defeat rule 1: a command printed on an allowed page AND
 * on an ordinary one would be attributed to the allowed page and reported as
 * fine. Found by this file's own premise assertion, which noticed
 * `token-settings.tsx` had contributed nothing.
 *
 * A command in two ordinary files is now two offenders, which is right: they
 * are two strings to fix.
 */
function claimsInApp(): Claim[] {
  const found = new Map<string, Claim>()
  const add = (command: string, file: string) => {
    const key = `${file} ${command}`
    if (!found.has(key)) found.set(key, { command, file })
  }
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(join(APP_ROOT, dir))) {
      const rel = file.slice(APP_ROOT.length + 1)
      const src = stripComments(readFileSync(file, 'utf8'))
      // The backticked form first, so a `a | b | c` list expands into its parts
      // before the bare scan sees the same text as one truncated command.
      for (const m of src.matchAll(BK_IN_BACKTICKS)) {
        for (const cmd of expand(m[1])) add(cmd, rel)
      }
      for (const m of src.matchAll(BK_COMMAND)) add(m[0], rel)
    }
  }
  return [...found.values()].sort(
    (a, b) => a.command.localeCompare(b.command) || a.file.localeCompare(b.file)
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
    // Finding #5's assertion, repointed. It used to demand more than EIGHT
    // commands app-wide, which was true while every empty state named one and
    // became false the moment §6 removed them — the assertion went red for the
    // right reason and had to be re-aimed rather than relaxed.
    //
    // What it asserts now is that the scanner still WORKS: the two CLI-facing
    // pages do name commands, so a rename of `components/`, a regex that
    // stopped matching, or a quickstart refactored into a variable would leave
    // this at zero and be caught. Aimed at files that are SUPPOSED to have
    // matches, which is the only place a positive assertion can live once the
    // rest of the app is required to have none.
    const claims = claimsInApp()
    expect(
      claims.length,
      'the scanner found no `bk …` spelling anywhere, including in the pages ' +
        `that exist to name them (${Object.keys(CLI_PAGES).join(', ')}). The ` +
        'scan is broken, and both checks below are vacuous.'
    ).toBeGreaterThan(3)
    for (const page of Object.keys(CLI_PAGES)) {
      expect(
        claims.some((c) => c.file === page),
        `${page} is listed as a page that names CLI commands and the scan found ` +
          'none in it. Either it stopped naming them — in which case delete its ' +
          'CLI_PAGES entry — or the scanner cannot see them.'
      ).toBe(true)
    }
  })

  // ── RULE 1, THE NEW ONE ──────────────────────────────────────────────────
  it('ordinary UI copy names no bk command at all', () => {
    const offenders = claimsInApp().filter((c) => !(c.file in CLI_PAGES))
    expect(
      offenders,
      'These files print a `bk` command at a human reading the web app.\n' +
        'The reader of a sales page supervises the agent; they are not going to\n' +
        'open a terminal, and a command here is an instruction addressed to\n' +
        'somebody who is not there. Say WHO maintains the thing instead — see\n' +
        "components/forms.tsx' header.\n" +
        'If the page is genuinely about the CLI, add it to CLI_PAGES with a reason:\n' +
        offenders.map((c) => `  ${c.command}   (${c.file})`).join('\n')
    ).toEqual([])
  })

  // ── RULE 2, THE ORIGINAL ONE ─────────────────────────────────────────────
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

  // The exclusion list is load-bearing, so it cannot name a file that no longer
  // exists: a stale entry silently exempts nothing while reading as a decision.
  it('every CLI_PAGES entry names a real file, with a reason', () => {
    for (const [file, reason] of Object.entries(CLI_PAGES)) {
      expect(() => statSync(join(APP_ROOT, file)), `CLI_PAGES names ${file}, which is gone`).not.toThrow()
      expect(reason.length, `the CLI_PAGES entry for ${file} has no reason`).toBeGreaterThan(40)
    }
  })
})
