// THE GUARD THAT MAKES THE CLI'S ENUMERATED HELP ALLOWED.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A SECOND COPY AT ALL
// ---------------------------------------------------------------------------
// `bk sales` flag descriptions name their values — `--kind pdf | deck | image |
// video | link` — instead of only saying "run `bk meta`". Twenty flags took a
// vocabulary and six of them enumerated, so an agent learned from one flag that
// the values were in the help and was failed by the next; it guessed
// `--type discovery` on `meeting schedule` and `--category outreach` on
// `template create`, and paid a round trip each time.
//
// Enumerating collides with the standing rule that a DYNAMIC value lives on the
// server and never in the binary: the web app and the CLI ship separately, so a
// stage added here is silently wrong in a released `bk` until the next CLI
// release. The rule exists to prevent SILENT drift, not duplication as such,
// and this file is what makes the drift loud. It is the same trade
// `lib/db/label-default-color.test.ts` already takes: SQL cannot import a
// constant, so the second copy is unavoidable and the test is what stops it
// drifting. Go cannot import TypeScript either.
//
// `bk meta` remains the authority — every enumerated flag still says so, and
// `bk meta --vocab <key>` is the live answer. The enumeration is the fast path.
//
// ---------------------------------------------------------------------------
// IT HAS TO GO RED IN BOTH DIRECTIONS, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// A guard that only catches "somebody deleted a value from the Go list" is half
// a guard: the drift the rule is written for is a value added HERE and never
// carried over. Both were watched failing before this file was trusted:
//
//   1. a fake stage added to STAGES in `pipeline.ts`, CLI untouched  → RED
//   2. a value deleted from one list in `cli/internal/commands/sales/vocab.go` → RED
//
// `cli/internal/commands/sales/vocab_test.go` is the other half of the pair: it
// holds the FLAGS to `vocab.go`. This one holds `vocab.go` to the source of
// truth. Either alone passes on the bug the other exists for.
//
// ---------------------------------------------------------------------------
// READING `cli/` FROM AN APP IS NOT A BOUNDARY VIOLATION
// ---------------------------------------------------------------------------
// `cli/` is shared by every app, and `lib/cli-parity.test.ts` already reads
// `cli/routes.json` for exactly this reason. What is forbidden is an app
// reaching into ANOTHER APP (`lib/app-isolation.test.ts`), and nothing here
// does. It reads `cli/internal/commands/sales/vocab.go` — this app's own
// command package — as TEXT, never as a module.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VOCABULARY } from './pipeline'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const VOCAB_GO = join(REPO_ROOT, 'cli', 'internal', 'commands', 'sales', 'vocab.go')
const SEARCH_TS = join(APP_ROOT, 'lib', 'db', 'queries', 'search.ts')

/**
 * Vocabularies served by `/api/meta` that the CLI deliberately does not
 * enumerate in any flag. Each needs a reason, exactly as an exclusion in
 * `cli-parity.test.ts` does — an unexplained one is how coverage rots.
 */
const NOT_IN_THE_CLI: Record<string, string> = {
  objection_statuses:
    'No flag takes one. Status is set by the VERB — `objection counter` writes ' +
    '"countered" and `objection resolve` writes "resolved" — precisely so that ' +
    'writing an answer and the objection going away stay two events.',
}

/** Parse the `vocabularies` map out of vocab.go. Text, not a module. */
function goVocabularies(): Record<string, string[]> {
  const src = readFileSync(VOCAB_GO, 'utf8')
  const start = src.indexOf('var vocabularies = map[string][]string{')
  expect(
    start,
    'vocab.go no longer declares `var vocabularies = map[string][]string{` — this ' +
      'parser is stale, and a stale parser that finds nothing is a guard that passes ' +
      'on everything',
  ).toBeGreaterThan(-1)

  const body = src.slice(start)
  const end = body.indexOf('\n}')
  expect(end, 'the vocabularies map is not closed by a `}` at column 0').toBeGreaterThan(-1)

  const out: Record<string, string[]> = {}
  for (const line of body.slice(0, end).split('\n')) {
    const m = /^\s*"([a-z_]+)":\s*\{(.*)\},\s*$/.exec(line)
    if (!m) continue
    out[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((v) => v[1])
  }
  return out
}

/** SEARCH_TYPES, read as text so this file never imports the query layer. */
function searchTypes(): string[] {
  const src = readFileSync(SEARCH_TS, 'utf8')
  const m = /export const SEARCH_TYPES = \[([\s\S]*?)\] as const/.exec(src)
  expect(m, 'lib/db/queries/search.ts no longer declares `export const SEARCH_TYPES = [...] as const`').not.toBeNull()
  return [...m![1].matchAll(/'([^']+)'/g)].map((v) => v[1])
}

describe('the CLI enumerates this app’s vocabularies, and cannot drift from them', () => {
  const go = goVocabularies()

  // ASSERT THE INPUT. A regex that matched nothing would make every expectation
  // below vacuous — CLAUDE.md finding #5 is a guard that found nothing and
  // passed. The counts are checked before anything is compared.
  it('found both sides', () => {
    expect(Object.keys(go).length, `parsed ${Object.keys(go).length} lists out of vocab.go`).toBeGreaterThanOrEqual(
      13,
    )
    expect(Object.keys(VOCABULARY).length).toBeGreaterThanOrEqual(13)
    for (const [key, values] of Object.entries(go)) {
      expect(values.length, `vocab.go's ${key} parsed as an empty list`).toBeGreaterThan(0)
    }
  })

  // Direction 1 — the one the standing rule exists for. A value added to
  // pipeline.ts and not carried into the CLI is exactly the silent drift that
  // makes a hardcoded list wrong, and it is invisible to every other check.
  it('every value this app serves is named by the CLI', () => {
    for (const [key, options] of Object.entries(VOCABULARY)) {
      if (key in NOT_IN_THE_CLI) continue
      expect(
        go[key],
        `\`${key}\` is served by GET /api/meta and cli/internal/commands/sales/vocab.go has ` +
          `no list for it. Either add it there (and enumerate it on the flag that takes it), ` +
          `or add it to NOT_IN_THE_CLI with the reason.`,
      ).toBeDefined()
      expect(
        go[key],
        `\`${key}\` has drifted: this app serves it and the CLI's --help names something else. ` +
          `Update cli/internal/commands/sales/vocab.go in this change — a released \`bk\` ` +
          `would otherwise print a stale list with nothing to say so.`,
      ).toEqual(options.map((o) => o.value))
    }
  })

  // Direction 2 — a value in the CLI that this app does not serve. It would be
  // rejected by the route, so the help would be teaching a caller to fail.
  it('the CLI names nothing this app does not serve', () => {
    const served: Record<string, string[]> = Object.fromEntries([
      ...Object.entries(VOCABULARY).map(([k, options]) => [k, options.map((o) => o.value)]),
      ['search_types', searchTypes()],
    ])
    for (const [key, values] of Object.entries(go)) {
      expect(
        served[key],
        `cli/internal/commands/sales/vocab.go has \`${key}\` and this app serves no such ` +
          `vocabulary. A flag enumerating it is teaching callers values the route will refuse.`,
      ).toBeDefined()
      expect(values, `\`${key}\` has drifted — the CLI names values this app does not serve`).toEqual(served[key])
    }
  })

  // The exclusion list is load-bearing, so it cannot be allowed to name a
  // vocabulary that no longer exists: a stale entry silently exempts nothing
  // while reading as a deliberate decision.
  it('every exclusion is about a vocabulary that exists', () => {
    for (const [key, reason] of Object.entries(NOT_IN_THE_CLI)) {
      expect(VOCABULARY, `NOT_IN_THE_CLI names \`${key}\`, which /api/meta no longer serves`).toHaveProperty(key)
      expect(reason.length, `the exclusion for \`${key}\` has no reason`).toBeGreaterThan(20)
    }
  })
})
