// ⌘K and `/dashboard/{ws}/search` answer with the SAME rows, and this is why.
//
// ===========================================================================
// THE PROPERTY, AND WHY IT IS ASSERTED ABOUT THE TREE AND NOT ABOUT RESULTS
// ===========================================================================
// The obvious test — "run both over the same term and compare" — needs a
// database, a seeded workspace and a rendered React tree, and it would still
// only prove they agreed for THAT term on THAT data. What actually has to be
// true is structural: **there is one call site for `…/sales-search` in this app,
// and both surfaces go through it.** Then they cannot rank differently, cannot
// hit different endpoints, and cannot drift when one is edited.
//
// So this file asserts the shape of the module graph. It is the same kind of
// check as `lib/app-isolation.test.ts`, for the same reason: a property you can
// grep for is a property that stays true after everyone who agreed to it has
// left.
//
// ===========================================================================
// AND THE OTHER HALF: THIS APP DOES NOT SERVE THE CROSS-APP SEARCH
// ===========================================================================
// `…/sales-search` reads `sales.*` full text and is this app's. `…/search`
// reads `platform.entities` across every app, scoped by a workspace id — and
// since Phase 2 this app's workspace ids come from a DIFFERENT tenancy that
// shares ids with the platform one. Mounting it therefore serves another app's
// rows to this app's members; the last case asserts the route file does not
// exist, with the measurement, so mounting it becomes a deliberate act with a
// failing test attached rather than a three-line accident.
//
// Watched fail 2026-08-07, three ways:
//   - `wsPath(ws, '/sales-search')` pasted back into `command-palette.tsx`
//     → RED naming the file
//   - the same in `components/search/search-page.tsx` → RED
//   - `useSalesSearch` renamed in `lib/hooks.ts` and left uncalled → the INPUT
//     assertion fires, not the others. That is the case worth having: without
//     it, deleting the hook would make every "no component names the path"
//     assertion pass by there being no search at all.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Every `.ts`/`.tsx` under a directory, recursively. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

const SOURCES = [...walk(join(APP_ROOT, 'app')), ...walk(join(APP_ROOT, 'components')), ...walk(join(APP_ROOT, 'lib'))]

const rel = (p: string) => p.slice(APP_ROOT.length + 1)

/**
 * The one module allowed to name the endpoint. `lib/hooks.ts` builds the
 * request; `app/api/**` is the SERVER side and is not a call site at all.
 */
const ENDPOINT_OWNER = 'lib/hooks.ts'

/**
 * The endpoint as CODE, not as prose — D-38, and finding #4 the other way round.
 *
 * The first version of this check was `src.includes('sales-search')`, and it
 * failed on both files it was written to protect: each one's header EXPLAINS
 * which endpoint it goes through, in a sentence containing the word. A detector
 * that fires on the documentation of its own rule is the shape of CLAUDE.md's
 * finding #4, and the outcome there is that somebody weakens or deletes it
 * (D-37).
 *
 * The needle is therefore the value inside a single- or double-quoted string —
 * `'/sales-search'` — which is how the path is written when it is BUILT, and
 * never how it is written in prose. Backticks are excluded deliberately: every
 * mention in a comment in this app uses them for `…/sales-search`, and a
 * template literal that assembled the path would still have to open a quote for
 * the segment before it.
 */
const ENDPOINT_LITERAL = /(['"])\/?sales-search\1/

describe('search: one endpoint, one call site (D-9)', () => {
  it('found something to check', () => {
    // Without this, a walk that returned nothing would make every assertion
    // below pass while checking no files at all — CLAUDE.md's finding #5.
    expect(SOURCES.length, `no sources found under ${APP_ROOT}`).toBeGreaterThan(20)
    expect(
      SOURCES.some((f) => rel(f) === ENDPOINT_OWNER),
      `${ENDPOINT_OWNER} was not walked — the paths in this file are wrong`
    ).toBe(true)
  })

  it('the shared hook exists and both surfaces import it', () => {
    const hooks = readFileSync(join(APP_ROOT, ENDPOINT_OWNER), 'utf8')
    // `\b` on the END of the name, not `toContain`. The first version of this
    // line was `toContain('export function useSalesSearch')`, and renaming the
    // hook to `useSalesSearchRENAMED` left it GREEN — the old name is a prefix
    // of the new one. Found on 2026-08-07 by running exactly that regression
    // (D-26 step 3) and watching the suite pass 4/4. Same failure as CLAUDE.md's
    // finding #9: a substring match is not a match.
    expect(hooks, `${ENDPOINT_OWNER} no longer exports useSalesSearch`).toMatch(
      /export function useSalesSearch\b/
    )

    for (const f of ['components/command-palette.tsx', 'components/search/search-page.tsx']) {
      const src = readFileSync(join(APP_ROOT, f), 'utf8')
      expect(src, `${f} does not use useSalesSearch — it is searching by some other means`).toMatch(
        /\buseSalesSearch\b/
      )
    }
  })

  it('no component names the sales-search path', () => {
    const offenders = SOURCES.filter((f) => {
      const r = rel(f)
      if (r === ENDPOINT_OWNER || r.startsWith('app/api/')) return false
      return ENDPOINT_LITERAL.test(readFileSync(f, 'utf8'))
    }).map(rel)

    expect(
      offenders,
      'these files reach the search endpoint directly instead of through ' +
        `useSalesSearch in ${ENDPOINT_OWNER}. Two call sites can rank, paginate ` +
        'and fail differently for the same term, with nothing to say which is ' +
        `right:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  // -------------------------------------------------------------------------
  // REVERSED AGAIN, 2026-08-10 (Phase 3). THIS APP MUST NOT MOUNT `…/search`.
  // -------------------------------------------------------------------------
  // The history matters, because this case has now argued both ways and only
  // one of the three arguments was made from a measurement.
  //
  //  1. Originally: "do not mount it — serving both from one host makes which
  //     search an agent gets depend on which deployment it is pointed at."
  //     That was design reasoning, and it was WRONG: the verb decides, not the
  //     deployment (`bk search` vs `bk sales search`).
  //  2. 2026-08-07: "mount it — `bk search` is a north-star step and it 404s
  //     for anyone homed on sales." True, and it was the right call while the
  //     two apps shared `platform.workspaces`.
  //  3. Today: **mounting it is a cross-tenant read**, and this one was
  //     measured rather than reasoned about.
  //
  // `searchRoute` resolves the workspace through `AppContext.workspaces` — this
  // app's tenancy, `sales.workspaces` — and then queries `platform.entities` by
  // that workspace's ID. Phase 2 MIRRORED ids, so a sales workspace id is very
  // often an issues workspace id as well, and the two are no longer the same
  // set of people: sales membership is `sales.workspace_members` and issues
  // membership is `platform.workspace_members`.
  //
  // Observed on 2026-08-10, local, against the real route: a user who is a
  // member of sales workspace 1 and NOT a member of platform workspace 1 asked
  // this deployment to search, and got issues' issue titles and dashboard URLs
  // back — `bc:issues:balathanusan-1-2/issue/5`, "SSO for Northstar SA —
  // blocks CHF 18k deal". Nothing in the route is wrong; its premise stopped
  // being true underneath it.
  //
  // The same was true of `…/links`, which this app also stopped mounting.
  // `linksRoute` itself was DELETED on 2026-08-12 — it had been mounted by
  // nobody for a fortnight — so the check below now guards against a
  // hand-written mount rather than against re-mounting a factory. That is a
  // weaker thing to guard and it is still worth guarding: the path is the part
  // an agent or a copy-paste would recreate.
  //
  // WHAT THIS COSTS, STATED RATHER THAN GLOSSED: `bk search` and `bk link`
  // answer 404 from a sales-homed CLI. That is PLAN.md §3's deliberate loss —
  // `bk link` retires and cross-app search comes back in Phase 6 as a CLI
  // fan-out that asks both servers — arriving one phase early because the leak
  // cannot ship. Phase 4 re-tiers the verbs; until it does, the recovery is
  // `bk search --app-server issues`.

  it('this app serves its OWN search and not the cross-app one (D-9, Phase 3)', () => {
    const platformSearch = join(APP_ROOT, 'app/api/workspaces/[ws]/search/route.ts')
    const salesSearch = join(APP_ROOT, 'app/api/workspaces/[ws]/sales-search/route.ts')

    // The POSITIVE case first, and it is not a formality (finding #16): an app
    // that serves NO search at all satisfies the absence below perfectly.
    expect(
      existsSync(salesSearch),
      "app/api/workspaces/[ws]/sales-search/route.ts is gone. That is this app's " +
        'OWN full-text search over sales.*, and ⌘K and the search page both go ' +
        'through it.'
    ).toBe(true)

    expect(
      existsSync(platformSearch),
      'app/api/workspaces/[ws]/search/route.ts is back. That route reads ' +
        '`platform.entities` scoped by a workspace id resolved from ' +
        '`sales.workspaces` — two different tenancies that share ids by ' +
        'construction (Phase 2 mirrored them), so it serves another app\'s rows ' +
        'to this app\'s members. Measured, not theorised: see the note above. ' +
        'Cross-app search comes back as a CLI fan-out (PLAN.md Phase 6), never ' +
        'as this mount.'
    ).toBe(false)

    // The same failure, one path over: `bk link`'s storage is the cross-app
    // index too, and the feature is retired outright.
    expect(
      existsSync(join(APP_ROOT, 'app/api/workspaces/[ws]/links/route.ts')),
      'app/api/workspaces/[ws]/links/route.ts is back. Any implementation of it ' +
        'resolves URNs through `platform.entities` and returns the far end\'s ' +
        'title — the same cross-tenant read as the search route. Cross-app ' +
        'references are not supported (2026-08-12); the far end\'s URN goes in ' +
        "the record's own text."
    ).toBe(false)
  })
})
