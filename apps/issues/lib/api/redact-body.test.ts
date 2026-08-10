// D-19 item 2: an app may withhold request-derived payload from what the shared
// handler writes to `platform.error_events.context`.
//
// ---------------------------------------------------------------------------
// WHY THIS TEST IS SHAPED THE WAY IT IS
// ---------------------------------------------------------------------------
// docs/sales-app-plan.md §12 asks for "a test that posts a body containing a
// fake email and greps the recorded error row for it — a redaction nobody has
// watched fail is not a redaction". Two deliberate departures from that literal
// shape, both in the direction of a test that runs:
//
//   1. It captures the INSERT instead of querying Postgres afterwards. A
//      `*.integration.test.ts` here would be guarded on TEST_DATABASE_URL, which
//      is unset in this repo — so it would skip, and a skipped check reports
//      success (CLAUDE.md, first corollary). This one runs on every `npm test`
//      and greps the actual statement the handler would send, parameters and
//      all. It is the same evidence, one layer earlier.
//
//   2. It asserts the PREMISE as loudly as the conclusion. "The email is absent
//      when redacting" passes just as well when the email never reached the
//      insert for some unrelated reason — a wrong route, a 4xx that is not
//      logged, a typo in the fixture. So the same request is run with redaction
//      OFF first, and the email must be THERE. A redaction test that would pass
//      either way is not a test.
//
// It lives in this app because `packages/*` has no test runner at all today.
// Nothing about it is issues-specific: it builds its own AppContext.
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createApiHandler,
  errorLogContext,
  Errors,
  type AppContext,
} from '@blackcode/platform-api'

/** A recognisable value of the kind a CRM route would have in its request body. */
const PROSPECT_EMAIL = 'julien.vasey@example-prospect.test'

/**
 * A database that records what it was asked to run instead of running it.
 *
 * `execute()` is the whole of the interface the handler's error path uses — it
 * writes error_events with an interpolated `sql` statement, not the query
 * builder — so this is a complete stand-in for THAT path rather than a partial
 * mock. There is no second branch a real database would take.
 *
 * The cast is the price of `AppContext.db` being a full Drizzle client so that
 * shared routes can use the query builder. Implementing that interface for a
 * test would be implementing Drizzle. The cast weakens the test's typing, never
 * its assertion: what is asserted is the statement this code actually produced.
 */
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

/**
 * Every string anywhere inside a value, however deeply nested.
 *
 * Drizzle's `SQL` object keeps the interpolated values as `Param` instances
 * inside `queryChunks`, so a bound parameter is not visible in any rendered
 * string — walking the object graph is what makes "is this value in the
 * statement?" answerable without a database to send it to.
 */
function allStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  return Object.values(value as Record<string, unknown>).flatMap((v) => allStrings(v, seen))
}

/**
 * `AppContext.workspaces` became required on 2026-08-10 (an app must say where
 * its workspaces live — packages/platform-api/src/workspace-source.ts).
 *
 * These fixtures never resolve a workspace: the handler under test throws before
 * any route body runs. So every method THROWS rather than returning an empty
 * answer — a stub that quietly returns `null` would let this test keep passing
 * if the handler one day started resolving a workspace, which is exactly the
 * kind of silently-retargeted assertion CLAUDE.md finding #10 is about.
 */
const unusedUploads = new Proxy({} as AppContext['uploads'], {
  get(_t, prop) {
    return () => {
      throw new Error(
        `AppContext.uploads.${String(prop)}() was called by a fixture that must never reach it`
      )
    }
  },
})

const unusedWorkspaces = new Proxy({} as AppContext['workspaces'], {
  get(_t, prop) {
    return () => {
      throw new Error(
        `AppContext.workspaces.${String(prop)}() was called by a fixture that must never reach it`
      )
    }
  },
})

/** Run one request through the shared handler and return the captured INSERT. */
async function runFailingRequest(redactBody: boolean): Promise<string[]> {
  const db = capturingDb()
  const ctx: AppContext = {
    appSlug: 'test-app',
    db: db as unknown as AppContext['db'],
    workspaces: unusedWorkspaces,
    uploads: unusedUploads,
    async resolveUser() {
      return null
    },
    redactBody,
  }
  const apiHandler = createApiHandler(ctx)

  // A 5xx — the class the handler records. `details` is where a route attaches
  // structured context from the request, and the only request-derived value that
  // reaches error_events.context.
  const GET = apiHandler(async () => {
    throw Errors.internal('could not save prospect', {
      contact_email: PROSPECT_EMAIL,
      call_notes: `spoke to Julien at ${PROSPECT_EMAIL}, wants a quote`,
    })
  })

  const res = await GET(new NextRequest('https://sales.blackcode.test/api/x'), undefined)
  expect(res.status, 'the fixture must produce a 5xx, or nothing is logged at all').toBe(500)
  expect(db.statements, 'a 5xx must write exactly one error_events row').toHaveLength(1)

  return allStrings(db.statements[0])
}

describe('error_events context redaction (D-19 item 2)', () => {
  it('THE PREMISE: without redaction, the request payload reaches the insert', async () => {
    const strings = await runFailingRequest(false)
    expect(
      strings.some((s) => s.includes(PROSPECT_EMAIL)),
      'the fake email did NOT reach the recorded error even with redaction off — so the ' +
        'redaction assertion below would pass for the wrong reason. Fix this fixture first.'
    ).toBe(true)
  })

  it('with redactBody, the request payload does not reach the insert', async () => {
    const strings = await runFailingRequest(true)
    expect(
      strings.filter((s) => s.includes(PROSPECT_EMAIL)),
      'redactBody is set and the request payload was still recorded'
    ).toEqual([])
    expect(
      strings.some((s) => s.includes('redacted')),
      'nothing was withheld, or the withholding left no marker — a reader cannot tell ' +
        '"this app redacts" from "this error had no context"'
    ).toBe(true)
  })

  // The two callers of errorLogContext, at the boundary each cares about.
  describe('errorLogContext', () => {
    it('keeps today\'s behaviour when redactBody is absent', () => {
      expect(errorLogContext({ details: { a: 1 } }, {})).toEqual({ details: { a: 1 } })
      expect(errorLogContext({ name: 'TypeError' }, {})).toEqual({ name: 'TypeError' })
      // Truthiness, matching the pre-extraction handler exactly.
      expect(errorLogContext({ details: undefined }, {})).toBeNull()
      expect(errorLogContext({ details: '' }, {})).toBeNull()
    })

    it('still sanitises credentials when NOT redacting', () => {
      expect(errorLogContext({ details: { password: 'hunter2' } }, {})).toEqual({
        details: { password: '[REDACTED]' },
      })
    })

    it('withholds details, and only details, when redacting', () => {
      expect(errorLogContext({ details: { a: 1 } }, { redactBody: true })).toEqual({
        redacted: 'body',
      })
      // The error's class name is not request data, so redaction has nothing to
      // do on the unexpected-throw path — and claiming otherwise would suggest
      // a protection that is not there.
      expect(errorLogContext({ name: 'TypeError' }, { redactBody: true })).toEqual({
        name: 'TypeError',
      })
      // Nothing to withhold means no marker: a redaction that did not happen
      // must not be advertised as one.
      expect(errorLogContext({ details: undefined }, { redactBody: true })).toBeNull()
    })
  })
})
