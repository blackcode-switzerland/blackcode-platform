// `platform.error_events.app` — that the shared handler actually writes it, and
// that what it writes is the SERVING app rather than a constant.
//
// ---------------------------------------------------------------------------
// WHY THIS TEST EXISTS AT ALL
// ---------------------------------------------------------------------------
// Of the three writers of this column, two are held by `tsc`:
// `insertErrorEvent` requires `app` in its parameter type, so the telemetry
// beacon and this app's wrapper cannot omit it (both watched to fail — see
// multiAppFinalRefactor/agent2/agent-2026-08-10-1.txt §4).
//
// The third writer is `safeLog` in `packages/platform-api/src/handler.ts`, and
// it is BOTH the one that writes almost every row and the one with no
// compile-time guard at all: it builds an interpolated `sql` INSERT with a
// hand-written column list, which no type sees.
//
// And it swallows its own failure. `safeLog` catches everything and logs to
// stderr, because an error while recording an error must never break the
// response. So a column list that does not match its VALUES list does not throw
// and does not fail a request — the error log simply stops gaining rows, in
// production, silently. There is no louder symptom to wait for.
//
// The refactor's Phase 5 then runs `ALTER COLUMN app SET NOT NULL` on the
// strength of "both apps have been writing it". This file is what makes that
// sentence checkable.
//
// ---------------------------------------------------------------------------
// WHY IT ASSERTS THE SLUG **VARIES**
// ---------------------------------------------------------------------------
// "the recorded row contains 'issues'" would pass against a hardcoded literal,
// against a stray default, and against the 0044 backfill value appearing for
// any unrelated reason — the column's entire purpose is to distinguish two
// deployments, so a test that only ever sees one app cannot tell a working
// attribution from a constant. Each case below runs the SAME failing request
// under two different AppContexts and requires the recorded value to follow.
//
// The mock and the string-walk are borrowed from `redact-body.test.ts`; its
// header explains why capturing the statement beats querying Postgres here.
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { createApiHandler, Errors, type AppContext } from '@blackcode/platform-api'

/**
 * Two slugs that are not this app's, not each other's, and not a substring of
 * anything else in a generated INSERT. Using 'issues' here would collide with
 * the value 0044 backfills and with the word in half the identifiers.
 */
const SLUG_A = 'zzz-app-alpha'
const SLUG_B = 'zzz-app-beta'

function capturingDb() {
  const statements: unknown[] = []
  return {
    statements,
    async execute(query: unknown) {
      statements.push(query)
      return { rows: [] as Record<string, unknown>[] }
    },
  }
}

/** Every string anywhere inside a value — see redact-body.test.ts. */
function allStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  return Object.values(value as Record<string, unknown>).flatMap((v) => allStrings(v, seen))
}

/** Run one failing request through the shared handler as `appSlug`. */
async function loggedErrorFor(appSlug: string): Promise<string[]> {
  const db = capturingDb()
  const ctx: AppContext = {
    appSlug,
    db: db as unknown as AppContext['db'],
    async resolveUser() {
      return null
    },
  }
  const GET = createApiHandler(ctx)(async () => {
    throw Errors.internal('boom')
  })

  const res = await GET(new NextRequest('https://example.test/api/x'), undefined)
  expect(res.status, 'the fixture must produce a 5xx, or nothing is logged at all').toBe(500)
  expect(db.statements, 'a 5xx must write exactly one error_events row').toHaveLength(1)
  return allStrings(db.statements[0])
}

describe('error_events.app is written by the shared handler', () => {
  // -------------------------------------------------------------------------
  // A TRAP WORTH NAMING, because it cost this file two rewrites.
  //
  // `${errorEvents}` interpolates the Drizzle TABLE OBJECT, and `allStrings`
  // walks it — so the bare string `'app'` is present in every captured
  // statement whether or not the INSERT names the column, purely because the
  // schema has a column of that name. `expect(strings).toContain('app')` is
  // therefore a check that cannot fail. Everything below anchors on the raw
  // column-list FRAGMENT and on POSITION instead.
  // -------------------------------------------------------------------------

  /** The one raw fragment carrying the column list, and its index. */
  function columnListOf(strings: string[]): { text: string; index: number } {
    const index = strings.findIndex((s) => /\(\s*app,[\s\S]*\)\s*VALUES/.test(s))
    expect(
      index,
      'no `(app, …) VALUES` fragment in the captured statement. Either safeLog no longer ' +
        'reaches this path — in which case every assertion here passes vacuously — or its ' +
        'column list was reordered. Rewrite this helper; do not delete it.'
    ).toBeGreaterThanOrEqual(0)
    return { text: strings[index], index }
  }

  it('THE PREMISE: the INSERT names `app` first, and binds it in that position', async () => {
    const strings = await loggedErrorFor(SLUG_A)
    const { text, index } = columnListOf(strings)

    expect(text).toMatch(/^\s*\(app,/)
    // Positional, not "appears somewhere": the value bound immediately after
    // the column list is the FIRST value, and the first column is `app`. This
    // is what distinguishes "the slug reached the statement" from "the slug is
    // assigned to this column" — a slug bound into `code` would satisfy a
    // `toContain` and be wrong.
    expect(
      strings[index + 1],
      'the first bound value is not the app slug — `app` leads the column list but ' +
        'something else leads the VALUES list, so every row would be misattributed'
    ).toBe(SLUG_A)
  })

  it('THE PREMISE: the column list and the VALUES list are the same length', async () => {
    const strings = await loggedErrorFor(SLUG_A)
    const { text, index } = columnListOf(strings)

    const columnCount = text.match(/\(([\s\S]*?)\)\s*VALUES/)![1].split(',').length
    // Values are separated by a raw `,` fragment; the last one is followed by
    // the closing `::jsonb )` fragment instead. So separators + 1 = values.
    const separators = strings.slice(index + 1).filter((s) => /^,\s*$/.test(s))
    const valueCount = separators.length + 1

    // A mismatch here is the silent-outage failure this file exists for:
    // Postgres rejects the INSERT, safeLog catches the rejection, and error
    // logging stops with no symptom at all.
    expect(
      valueCount,
      `the INSERT names ${columnCount} columns but binds ${valueCount} values — Postgres ` +
        'would reject this and safeLog would swallow the rejection, so the error log ' +
        'would silently stop gaining rows'
    ).toBe(columnCount)
  })

  it('records the serving app, and a DIFFERENT one for a different deployment', async () => {
    const fromA = await loggedErrorFor(SLUG_A)
    const fromB = await loggedErrorFor(SLUG_B)

    expect(fromA[columnListOf(fromA).index + 1], `${SLUG_A} was not the recorded app`).toBe(SLUG_A)
    expect(fromB[columnListOf(fromB).index + 1], `${SLUG_B} was not the recorded app`).toBe(SLUG_B)

    // The half a hardcoded literal fails. If safeLog wrote a constant, both
    // runs would carry the same value and both assertions above could still
    // pass — the column exists precisely to tell two deployments apart, so a
    // test that only ever sees one app checks nothing.
    expect(
      fromA,
      "the row recorded for one app carries the OTHER app's slug — the value is not " +
        'coming from the AppContext'
    ).not.toContain(SLUG_B)
    expect(fromB).not.toContain(SLUG_A)
  })

  it('truncates a slug that would overflow varchar(40) rather than failing the insert', async () => {
    // 40 is the column width. An over-long slug is not a realistic app name, but
    // an untruncated bind is a `value too long` error that safeLog swallows —
    // the same silent stop as a column mismatch, reached a different way.
    const long = 'z'.repeat(60)
    const strings = await loggedErrorFor(long)
    expect(strings, 'the over-long slug was bound in full').not.toContain(long)
    expect(strings).toContain('z'.repeat(40))
  })
})
