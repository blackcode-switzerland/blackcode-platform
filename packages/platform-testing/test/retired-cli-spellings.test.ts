// A page must not tell somebody to run a command this binary no longer has.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY IT EXISTS
// ═══════════════════════════════════════════════════════════════════════════
// multiAppFinalRefactor Phase 4 moved ten verbs behind their app name and
// removed `bk link`. It updated the CLI, the deprecation rows and the guide
// topics — every surface the CLI owns. It did not update the two apps' WEB COPY,
// and nothing could have noticed: `guide_test.go` reads `cli/internal/guide`,
// and a React component is not a guide topic.
//
// So on 2026-08-11, four days after the re-tiering shipped, the browser pass
// found this still live in production:
//
//   * `apps/issues` landing page, step 3 of the quickstart:  `bk workspace use my-team`
//   * the same page's FAQ, twice more:                       `bk activity`, `bk trash list`
//   * `apps/sales` search page:            "across every blackcode app, that is `bk search`"
//   * `apps/sales` activity page:          "Run `bk activity --app sales` to page through"
//
// The quickstart one is the sharpest: it is step 3 of the getting-started path
// on a public marketing page, so the first thing a new user was told to type
// answered `unknown command "workspace"`. The deprecation hint rescued them,
// which is exactly why nobody noticed — the recovery path was doing the
// onboarding's job.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS GUARD MATCHES TEXT. READ THIS BEFORE YOU CHANGE THE PATTERN. (D-42)
// ═══════════════════════════════════════════════════════════════════════════
// Guards that grep source have been found inert in this repo six times, and the
// granularity of the match was the bug every time. Three properties keep this
// one honest, and each is asserted rather than intended:
//
//   1. **The list of retired spellings is DERIVED, never written here.** It is
//      parsed out of `cli/internal/commands/deprecations.go`, which is the file
//      CLAUDE.md already requires to gain a row in the same commit as any
//      removal. Hand-writing the list is finding #9 exactly: a guard that checks
//      the six spellings its author happened to remember. If the declaration
//      moves or is renamed, the premise case below fails LOUDLY rather than
//      silently checking an empty set.
//
//   2. **Comments are stripped before matching.** A comment discussing a removal
//      has to write the dead spelling to be about it — `deprecations.go`'s own
//      hints do, and so do a hundred file headers in this repo. Scanning whole
//      files would flag all of them, and the only way anyone would get the suite
//      green again is by deleting the guard. What is left after stripping is
//      string literals and JSX text: what a person can actually read.
//
//   3. **The stripper is asserted not to have eaten everything.** This is the
//      one that matters, and it is finding #16's lesson: a scan whose subject
//      has vanished reports success. `it('still sees rendered bk commands')`
//      requires the stripped text to still contain a LEGITIMATE `bk <app> …`
//      mention. A regex change that blanked every file would pass the case below
//      by iterating nothing; it cannot pass that one.
//
// WHAT IT STILL PASSES ON, stated rather than discovered later:
//   * A command assembled at runtime — `{'bk ' + verb}` — is invisible to it.
//   * Copy that names a retired spelling without the `bk ` prefix ("the search
//     command").
//   * A spelling that was removed WITHOUT a deprecation row. That is a hole in
//     `deprecations.go`, not here, and `routes_test.go` is the guard for it.
//   * Anything outside `apps/*/app` and `apps/*/components` — the marketing
//     copy and the dashboard, which is where user-visible prose lives.
//
// When you change the pattern: put `bk workspace use my-team` back into
// `apps/issues/components/landing-page.tsx`, watch this go red naming it, then
// restore.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

const DEPRECATIONS_GO = join(REPO_ROOT, 'cli', 'internal', 'commands', 'deprecations.go')

/**
 * `var deprecations = map[string]string{ … }` — anchored to the declaration.
 *
 * The same shape `apps/sales/lib/trash-types.test.ts` uses to read a Go slice.
 * Anchoring on the declaration rather than scanning the file is what makes a
 * rename fail here instead of quietly matching some other map.
 */
const DECLARATION = /var\s+deprecations\s*=\s*map\[string\]string\{/

/** The KEYS of that map: the old spellings, quoted, at the start of an entry. */
const KEY_RE = /^\s*"([^"]+)":/gm

function retiredSpellings(): string[] {
  const text = readFileSync(DEPRECATIONS_GO, 'utf8')
  const start = text.search(DECLARATION)
  if (start < 0) return []
  const body = text.slice(start)
  const keys = [...body.matchAll(KEY_RE)].map((m) => m[1])
  return (
    keys
      // Flag rows ("--app", "--reference") are keyed bare and match whatever
      // command they were typed on. A page mentioning `--app` is not claiming a
      // command exists, and `bk changelog --app` is still real.
      .filter((k) => !k.startsWith('--'))
  )
}

const RETIRED = retiredSpellings()

const SCAN_ROOTS = ['issues', 'sales', '_scaffold'].flatMap((app) => [
  join(REPO_ROOT, 'apps', app, 'app'),
  join(REPO_ROOT, 'apps', app, 'components'),
])

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'migrations'])
const SOURCE_EXT = /\.(ts|tsx)$/

function sourceFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...sourceFilesUnder(p))
    } else if (SOURCE_EXT.test(entry.name)) {
      // A test asserting on a retired spelling is doing its job.
      if (/\.test\.tsx?$/.test(entry.name)) continue
      out.push(p)
    }
  }
  return out
}

/**
 * Everything a reader of the rendered page cannot see, removed.
 *
 * Block comments first (which covers JSX `{/* … *\/}`), then line comments. The
 * `(?<!:)` on the line-comment rule is not decoration: without it `'https://x'`
 * inside a string literal truncates the rest of that line, which would hide a
 * real mention sitting after a URL.
 *
 * NEWLINES ARE PRESERVED, and that is not tidiness. The failure message quotes a
 * line number, and a reader who opens the file at a number computed on collapsed
 * text finds unrelated code there — which is how a correct guard gets a
 * reputation for lying and then gets ignored. Every comment is replaced by its
 * own newlines, so a reported line is the line in the file.
 */
function stripComments(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(?<!:)\/\/[^\n]*/g, blank)
}

interface Mention {
  /** Repo-relative path of the file. */
  file: string
  /** The retired spelling it names. */
  spelling: string
  /** The line, trimmed, for the failure message. */
  line: string
}

function collect(): { mentions: Mention[]; renderedBkMentions: number; scanned: number } {
  const mentions: Mention[] = []
  let renderedBkMentions = 0
  let scanned = 0

  for (const root of SCAN_ROOTS) {
    for (const file of sourceFilesUnder(root)) {
      scanned++
      const stripped = stripComments(readFileSync(file, 'utf8'))
      renderedBkMentions += [...stripped.matchAll(/\bbk\s+[a-z]/g)].length

      for (const spelling of RETIRED) {
        // `bk <spelling>` on a word boundary, so `bk issues issue …` is not read
        // as the retired `bk issue`, and `bk sales trash list` is not `bk trash`.
        const re = new RegExp(`\\bbk\\s+${spelling.replace(/\s+/g, '\\s+')}\\b`, 'g')
        for (const m of stripped.matchAll(re)) {
          const before = stripped.slice(0, m.index)
          const lineNo = before.split('\n').length
          mentions.push({
            file: file.slice(REPO_ROOT.length + 1),
            spelling,
            line: `line ${lineNo}: …${stripped.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ').trim()}…`,
          })
        }
      }
    }
  }
  return { mentions, renderedBkMentions, scanned }
}

const { mentions: MENTIONS, renderedBkMentions: RENDERED_BK, scanned: SCANNED } = collect()

/**
 * Rendered text that names a retired spelling ON PURPOSE.
 *
 * Same two rules as `cited-tests-exist.test.ts`'s list, for the same reason: an
 * unexplained entry is indistinguishable from one added to quiet a real
 * failure, and an entry that stops describing anything is an escape hatch left
 * open over code nobody rechecked.
 *
 * Keyed `<file>::<spelling>`.
 */
const ALLOWED = new Map<string, string>([
  // Fourteen of this guard's first twenty-four hits were real and were FIXED
  // rather than allowed. These ten are the text that has to name the dead
  // spelling in order to be ABOUT it.

  // `/api/undo` is the 410 Gone document for a command that was removed, and its
  // whole job is to say so and name the replacement. CLAUDE.md: "A 410 with a
  // suggestion is something an agent on stale context can act on inside the same
  // run." It cannot do that without writing the spelling the agent typed.
  ['apps/issues/app/api/undo/route.ts::undo', 'the 410 that announces `bk undo`’s removal'],
  ['apps/issues/app/api/undo/route.ts::trash', 'the same 410 names the 2.x trash spelling it replaces'],

  // These three suggestions name the CURRENT spelling first and the 2.x one in
  // parentheses — `run \`bk <app> trash list\` (\`bk trash list\` on bk 2.x)`.
  // An agent reads the first; a caller on an old binary is not left guessing.
  //
  // PRUNE CANDIDATE: the parenthetical is for CLI 2.x and the floor is well past
  // it. Dropping it is a one-line edit in each file plus deleting these three
  // entries — deliberately not done here, because widening a phase to tidy a
  // hint is how a phase stops being reviewable.
  [
    'apps/issues/app/api/workspaces/[ws]/trash/parse.ts::trash',
    'names the current spelling first; the 2.x form is a parenthetical for old binaries',
  ],
  [
    'apps/issues/app/api/workspaces/[ws]/trash/resolve.ts::trash',
    'names the current spelling first; the 2.x form is a parenthetical for old binaries',
  ],
  [
    'apps/issues/app/api/workspaces/[ws]/trash/restore/route.ts::trash',
    'names the current spelling first; the 2.x form is a parenthetical for old binaries',
  ],
])

const allowKey = (m: Mention) => `${m.file}::${m.spelling}`

describe('no page tells somebody to run a retired `bk` spelling', () => {
  // ── ASSERT THE INPUTS. Each of these three can fail on its own, and each
  //    corresponds to a way this guard has a documented history of going inert.

  it('parsed the retired spellings out of deprecations.go', () => {
    expect(
      existsSync(DEPRECATIONS_GO),
      `${DEPRECATIONS_GO} is missing — this guard derives its whole subject from it.`
    ).toBe(true)
    expect(
      RETIRED.length,
      'no command keys parsed from `var deprecations = map[string]string{…}` in ' +
        'deprecations.go. Either the declaration was renamed or the entry shape ' +
        'changed — and either way the case below just checked NOTHING. Fix the ' +
        'parser; do not delete this assertion.'
    ).toBeGreaterThan(0)
  })

  it('found app source to scan', () => {
    expect(
      SCANNED,
      `no .ts/.tsx files under ${SCAN_ROOTS.join(', ')}. The scan is looking in the wrong place.`
    ).toBeGreaterThan(0)
  })

  // THE POSITIVE CASE, and the reason the negative one below means anything.
  // A stripper that blanked every file would make the failure list empty and
  // this suite green over a repo full of dead commands (finding #16: a check
  // built on "was this absent?" cannot tell a clean repo from an empty scan).
  it('still sees rendered bk commands after stripping comments', () => {
    expect(
      RENDERED_BK,
      'after stripping comments there is not one `bk <something>` left in any ' +
        "app's rendered source. That is not plausible — both apps print `bk` " +
        'commands to users. The comment stripper is eating string literals and ' +
        'JSX text, so the check below is scanning blank pages.'
    ).toBeGreaterThan(0)
  })

  it('names no retired spelling in rendered copy', () => {
    const bad = MENTIONS.filter((m) => !ALLOWED.has(allowKey(m))).map(
      (m) => `${m.file} — \`bk ${m.spelling}\`\n    ${m.line}`
    )
    expect(
      [...new Set(bad)].sort(),
      'this rendered copy tells somebody to run a spelling `bk` no longer has. ' +
        'The binary answers `unknown command` and only the deprecation hint saves ' +
        'them — and a hint is a promise with a duration, not documentation.\n' +
        'Name the app-qualified spelling instead (`bk issues workspace use …`), ' +
        'or, if the capability itself is gone, say what to do instead:\n' +
        bad.join('\n')
    ).toEqual([])
  })

  it('has no stale allowances', () => {
    const present = new Set(MENTIONS.map(allowKey))
    const stale: string[] = []
    for (const [k, reason] of ALLOWED) {
      if (!present.has(k)) stale.push(`${k} — the mention is gone. Delete this entry. ("${reason}")`)
    }
    expect(stale, `these allowances no longer describe anything real:\n${stale.join('\n')}`).toEqual(
      []
    )
  })
})
