// Which files may touch `platform.labels` at all? (D-14, migration 0043)
//
// ---------------------------------------------------------------------------
// THE QUESTION THIS ANSWERS
// ---------------------------------------------------------------------------
// `labels.app-scope.integration.test.ts` proves the app lens works on every
// function `labels.ts` exports. It cannot prove the harder half: that those are
// ALL the reads. A label read added tomorrow in a file nobody thought to check
// would return another app's labels and no behavioural test would notice,
// because no behavioural test knows to call it.
//
// So this file pins the boundary instead of the behaviour. Four modules name the
// table today; a fifth is a deliberate decision, and this test is the moment it
// gets made. Adding one is two lines here — plus, in return, having read the
// header of `labels.ts` about what "read path" means.
//
// It runs with no database, so it runs on every `npm test` rather than only when
// someone remembers `TEST_DATABASE_URL`.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
// It does not try to decide whether each individual statement carries the lens.
// Matching "the predicate is somewhere near the query" needs a window, and a
// window wide enough to span a drizzle chain is wide enough to see the NEXT
// query's predicate and call it a pass — an inert guard that reads like a strict
// one. Inside these four files the checks are the integration tests and review;
// what is mechanised here is the thing review is worst at, which is noticing a
// file that was not in the diff you were looking at.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

/** Every source file under `apps/issues`, excluding build output and tests. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.turbo') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      sources(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

// A reference to the labels TABLE — the drizzle symbol in a query position, or
// the raw-SQL interpolation. `labels` as a plain identifier is not enough: it is
// also a local variable, a JSON key and a column alias all over the app.
const TABLE_REF =
  /\$\{labels\}|\.(from|update|delete|insert)\(labels\)|(?:inner|left)Join\(labels/

// The four modules that legitimately read or write `platform.labels`.
//
//   labels.ts     the label query module itself
//   issues.ts     the label array on a listed issue, and label ids at create
//   analytics.ts  the by-label distribution
//   move.ts       remapping labels by name into another workspace
//
// A file outside this set touching the table is not necessarily wrong — it is
// unreviewed. Add it here in the same commit that adds the read, having given
// that read the `app IS NULL OR app = <this app>` lens.
const ALLOWED = [
  'lib/db/queries/labels.ts',
  'lib/db/queries/issues.ts',
  'lib/db/queries/analytics.ts',
  'lib/db/queries/move.ts',
  // Workspace search (2026-09-30). One read, in `labelArm`, behind
  // `visibleToThisApp('l')`; its integration test puts a label scoped to another
  // app in the fixture and asserts it never comes back.
  'lib/db/queries/workspace-search.ts',
]

describe('platform.labels is only reached from the reviewed modules', () => {
  const hits = sources(ROOT)
    .filter((p) => TABLE_REF.test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'))
    .sort()

  // Assert the input. A regex that stopped matching — a drizzle upgrade, a
  // rename, a bad path — would otherwise make this suite pass by finding
  // nothing, which is the failure mode `bk __routes` shipped with for months.
  it('finds the label reads at all', () => {
    expect(hits.length).toBeGreaterThanOrEqual(ALLOWED.length)
  })

  it('and finds them nowhere else', () => {
    expect(hits).toEqual([...ALLOWED].sort())
  })

  // The lens has to be reachable from every one of them, which is a weaker claim
  // than "every statement uses it" but a strictly checkable one: a module that
  // touches the table without so much as importing the predicate cannot be
  // applying it anywhere.
  it('every one of them imports the lens', () => {
    const missing = ALLOWED.filter((rel) => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      return !/VISIBLE_TO_THIS_APP|visibleToThisApp/.test(src)
    })
    expect(missing).toEqual([])
  })
})
