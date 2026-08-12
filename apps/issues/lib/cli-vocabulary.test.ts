// THE GUARD THAT MAKES THE CLI'S ENUMERATED HELP ALLOWED.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A SECOND COPY AT ALL
// ---------------------------------------------------------------------------
// `bk issues` flag descriptions name their values — `--status backlog | todo |
// in_progress | done | cancelled` — instead of only saying "run `bk meta`".
//
// Enumerating collides with the standing rule that a DYNAMIC value lives on the
// server and never in the binary: the web app and the CLI ship separately, so a
// status added here is silently wrong in a released `bk` until the next CLI
// release. The rule exists to prevent SILENT drift, not duplication as such,
// and this file is what makes the drift loud. It is the same trade
// `apps/sales/lib/cli-vocabulary.test.ts` already takes, and the same one
// `lib/db/label-default-color.test.ts` takes against a migration literal: the
// second copy is unavoidable because Go cannot import TypeScript, and the test
// is what stops it drifting.
//
// ---------------------------------------------------------------------------
// THE PRIORITY MAPPING IS THE REASON THIS FILE EXISTS AT ALL
// ---------------------------------------------------------------------------
// The rest is ordinary enum drift. The priority table is different, and worse:
// `bk issues issue create --priority` writes an INTEGER (1-5) and
// `bk issues project create --priority` writes a STRING (P0-P4), and since
// 2026-08-12 both accept one shared set of NAMES. "urgent = 1 = P0" is a claim
// about this app that lives nowhere in this app.
//
// Until that date `project create --priority` had a vocabulary of its own
// invention — its help said `urgent/high/medium/low/none` and it passed the word
// through verbatim to a `varchar(10)` with no route validation and no CHECK
// constraint. `--priority urgent` wrote the literal string "urgent" into a
// column every reader treats as P0..P4, so the project rendered as "No priority"
// in the listing, the detail page and `bk meta`. Verified against a running
// route (project #153). Nothing anywhere would have said so; there was no guard
// that could have.
//
// So the Go table carries a `Label` column whose only job is to be checkable,
// and the test below holds it against BOTH priority lists on the same row.
//
// ---------------------------------------------------------------------------
// IT HAS TO GO RED IN BOTH DIRECTIONS
// ---------------------------------------------------------------------------
// A guard that only catches "somebody deleted a value from the Go list" is half
// a guard: the drift the rule is written for is a value added HERE and never
// carried over. Both directions were watched failing before this file was
// trusted — see the report for the mutations.
//
// ---------------------------------------------------------------------------
// READING `cli/` FROM AN APP IS NOT A BOUNDARY VIOLATION
// ---------------------------------------------------------------------------
// `cli/` is shared by every app, and `lib/cli-parity.test.ts` already reads
// `cli/routes.json` for exactly this reason. What is forbidden is an app
// reaching into ANOTHER APP (`lib/app-isolation.test.ts`), and nothing here
// does. It reads `cli/internal/commands/issues/vocab.go` — this app's own
// command package — as TEXT, never as a module.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_UPDATE_STATUSES,
} from './work-items'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const VOCAB_GO = join(REPO_ROOT, 'cli', 'internal', 'commands', 'issues', 'vocab.go')

/**
 * What GET /api/meta serves as `vocabulary`, keyed exactly as the route keys it.
 * The route builds this object from these same imports (app/api/meta/route.ts →
 * APP_VOCABULARY), so this is the served surface, not a paraphrase of it.
 *
 * `issue_priorities` are numbers on the wire; the Go side stores every
 * vocabulary as strings, so they are compared as strings.
 */
const SERVED: Record<string, string[]> = {
  issue_statuses: ISSUE_STATUSES.map((o) => o.value),
  issue_priorities: ISSUE_PRIORITIES.map((o) => String(o.value)),
  project_statuses: PROJECT_STATUSES.map((o) => o.value),
  project_priorities: PROJECT_PRIORITIES.map((o) => o.value),
  project_update_health: PROJECT_UPDATE_STATUSES.map((o) => o.value),
}

/** Parse the `vocabularies` map out of vocab.go. Text, not a module. */
function goVocabularies(): Record<string, string[]> {
  const src = readFileSync(VOCAB_GO, 'utf8')
  const start = src.indexOf('var vocabularies = map[string][]string{')
  expect(
    start,
    'vocab.go no longer declares `var vocabularies = map[string][]string{` — this parser is ' +
      'stale, and a stale parser that finds nothing is a guard that passes on everything',
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

interface PriorityAlias {
  name: string
  label: string
  issue: number
  project: string
}

/** Parse the `priorityAliases` table out of vocab.go. */
function goPriorityAliases(): PriorityAlias[] {
  const src = readFileSync(VOCAB_GO, 'utf8')
  const start = src.indexOf('var priorityAliases = []priorityAlias{')
  expect(
    start,
    'vocab.go no longer declares `var priorityAliases = []priorityAlias{` — this parser is stale',
  ).toBeGreaterThan(-1)
  const body = src.slice(start)
  const end = body.indexOf('\n}')
  expect(end, 'the priorityAliases table is not closed by a `}` at column 0').toBeGreaterThan(-1)

  const out: PriorityAlias[] = []
  const row = /\{Name:\s*"([^"]*)",\s*Label:\s*"([^"]*)",\s*Issue:\s*(\d+),\s*Project:\s*"([^"]*)"\}/g
  for (const m of body.slice(0, end).matchAll(row)) {
    out.push({ name: m[1], label: m[2], issue: Number(m[3]), project: m[4] })
  }
  return out
}

describe('the CLI enumerates this app’s vocabularies, and cannot drift from them', () => {
  const go = goVocabularies()
  const aliases = goPriorityAliases()

  // ASSERT THE INPUT. Two regexes that matched nothing would make every
  // expectation below vacuous — CLAUDE.md finding #5 is a guard that found
  // nothing and passed.
  it('found both sides', () => {
    expect(
      Object.keys(go).length,
      `parsed ${Object.keys(go).length} lists out of vocab.go`,
    ).toBe(Object.keys(SERVED).length)
    for (const [key, values] of Object.entries(go)) {
      expect(values.length, `vocab.go's ${key} parsed as an empty list`).toBeGreaterThan(0)
    }
    expect(
      aliases.length,
      `parsed ${aliases.length} rows out of vocab.go's priorityAliases table — if this is 0 the ` +
        `row regex is stale and the mapping assertions below check nothing`,
    ).toBe(ISSUE_PRIORITIES.length)
  })

  // Direction 1 — the one the standing rule exists for. A value added to
  // work-items.ts and not carried into the CLI is exactly the silent drift that
  // makes a hardcoded list wrong, and it is invisible to every other check.
  it('every value this app serves is named by the CLI', () => {
    for (const [key, values] of Object.entries(SERVED)) {
      expect(
        go[key],
        `\`${key}\` is served by GET /api/meta and cli/internal/commands/issues/vocab.go has no ` +
          `list for it. Add it there, and enumerate it on the flag that takes it.`,
      ).toBeDefined()
      expect(
        go[key],
        `\`${key}\` has drifted: this app serves it and the CLI's --help names something else. ` +
          `Update cli/internal/commands/issues/vocab.go in this change — a released \`bk\` would ` +
          `otherwise print a stale list with nothing to say so.`,
      ).toEqual(values)
    }
  })

  // Direction 2 — a value in the CLI that this app does not serve. The help
  // would be teaching a caller to fail, or (for projects, where nothing
  // validates) to write a value no reader understands.
  it('the CLI names nothing this app does not serve', () => {
    for (const [key, values] of Object.entries(go)) {
      expect(
        SERVED[key],
        `cli/internal/commands/issues/vocab.go has \`${key}\` and this app serves no such ` +
          `vocabulary. A flag enumerating it is teaching callers values nothing here understands.`,
      ).toBeDefined()
      expect(values, `\`${key}\` has drifted — the CLI names values this app does not serve`).toEqual(
        SERVED[key],
      )
    }
  })

  // THE MAPPING. Every alias row must name a priority this app has, on BOTH
  // sides, with the LABEL this app gives it — that is what makes "urgent = 1 =
  // P0" a checked fact rather than a guess sitting between a caller and a write.
  it('every priority name is this app’s own name for that priority, on both sides', () => {
    for (const a of aliases) {
      const issue = ISSUE_PRIORITIES.find((p) => p.value === a.issue)
      expect(
        issue,
        `the CLI maps --priority ${a.name} to issue priority ${a.issue}, which ISSUE_PRIORITIES ` +
          `does not contain`,
      ).toBeDefined()
      expect(
        issue!.label,
        `the CLI calls issue priority ${a.issue} "${a.name}"; this app calls it ` +
          `"${issue!.label}". One of them is wrong, and the CLI is the one a caller reads first.`,
      ).toBe(a.label)

      const project = PROJECT_PRIORITIES.find((p) => p.value === a.project)
      expect(
        project,
        `the CLI maps --priority ${a.name} to project priority ${a.project}, which ` +
          `PROJECT_PRIORITIES does not contain — a write of it renders as "No priority"`,
      ).toBeDefined()
      expect(
        project!.label,
        `the CLI maps "${a.name}" to issue ${a.issue} and project ${a.project}, but this app ` +
          `calls those "${issue!.label}" and "${project!.label}" — the two sides of one name ` +
          `point at different priorities`,
      ).toBe(a.label)
    }
  })

  // Every served priority needs a name, not just every name a priority. A sixth
  // priority added server-side with no CLI name leaves `--priority` enumerating
  // five of six, which reads as a complete list.
  it('every priority this app serves has a CLI name', () => {
    for (const p of ISSUE_PRIORITIES) {
      expect(
        aliases.find((a) => a.issue === p.value),
        `issue priority ${p.value} ("${p.label}") has no name in the CLI's priorityAliases table, ` +
          `so --priority enumerates a partial list that reads as a complete one`,
      ).toBeDefined()
    }
    for (const p of PROJECT_PRIORITIES) {
      expect(
        aliases.find((a) => a.project === p.value),
        `project priority ${p.value} ("${p.label}") has no name in the CLI's priorityAliases table`,
      ).toBeDefined()
    }
  })
})
