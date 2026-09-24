// The one fact `idempotency.ts` copies from somewhere else: the route timeout.
//
// `PENDING_ABANDONED_MS` means "no process can still be running this claim",
// and that is only true while it exceeds the platform's function limit. The
// limit lives in `vercel.json`; the module cannot import JSON at runtime for
// one integer, so it types the number and this test holds the two together.
// A copy of a fact with no guard is how CLAUDE.md finding #23 happened.
//
// The takeover itself needs a real unique index and a real clock and is proved
// in `lib/db/queries/write-paths.integration.test.ts`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PENDING_ABANDONED_MS, ROUTE_MAX_DURATION_S } from './idempotency'

describe('the abandoned-claim window', () => {
  it('is longer than the longest an API route may run', () => {
    expect(PENDING_ABANDONED_MS).toBeGreaterThan(ROUTE_MAX_DURATION_S * 1000)
  })

  it('reads the same route limit vercel.json enforces', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as {
      functions?: Record<string, { maxDuration?: number }>
    }
    const apiRoutes = vercel.functions?.['app/api/**/*.ts']
    // Assert the input: a vercel.json with no API limit would make this pass
    // vacuously against `undefined`.
    expect(apiRoutes?.maxDuration, 'vercel.json declares maxDuration for app/api/**/*.ts').toBeTypeOf('number')
    expect(ROUTE_MAX_DURATION_S).toBe(apiRoutes!.maxDuration)
  })
})
