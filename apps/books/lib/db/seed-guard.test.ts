// The seed refuses a database it has no business rebuilding.
//
// ===========================================================================
// WHAT THIS GUARD IS PROTECTING AGAINST, CONCRETELY
// ===========================================================================
// `seed()` deletes the workspace slugged `blackcode` with all six protective
// triggers disabled, then rebuilds it from the mockup. That is correct on a
// development machine and it is the destruction of Andrea's books anywhere else,
// and the only thing between the two is which database `DATABASE_URL` names.
//
// Nothing about the failure is loud. The seed would print `seeded workspace #1`
// and exit 0.
//
// ===========================================================================
// NO DATABASE, AND THAT IS THE POINT
// ===========================================================================
// The other tests in this app skip without `DATABASE_URL` and say so, because "no
// database" and "verified" must never look the same. This one runs everywhere:
// `seedRefusal` is pure, taking the URL and the environment as arguments, so the
// gate can be tested without a connection and without mutating `process.env` —
// which would leak into the files vitest runs in parallel.
//
// A guard that could only be tested by pointing it at production is a guard that
// never gets tested.

import { describe, it, expect } from 'vitest'
import { seedRefusal, assertSeedable, ALLOW_REMOTE_ENV } from './seed'

const LOCAL = 'postgres://user:pw@localhost:5432/blackcode_dev'
const REMOTE = 'postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/blackcode'

describe('seedRefusal', () => {
  it('allows a local database', () => {
    expect(seedRefusal(LOCAL, { NODE_ENV: 'development' })).toBeNull()
    expect(seedRefusal('postgres://user@127.0.0.1:5432/db', {})).toBeNull()
    expect(seedRefusal('postgres://user@[::1]:5432/db', {})).toBeNull()
  })

  it('allows a unix socket, which has no host at all', () => {
    expect(seedRefusal('postgres:///blackcode_dev', {})).toBeNull()
  })

  it('refuses a remote host and names it', () => {
    const r = seedRefusal(REMOTE, {})
    expect(r).not.toBeNull()
    // The message has to say WHERE, or the reader's first move is to run it again.
    expect(r).toContain('ep-cool-name-123.eu-central-1.aws.neon.tech')
    expect(r, 'must say what it would have destroyed').toContain('blackcode')
    expect(r, 'must say how to proceed if the host really is a dev database').toContain(ALLOW_REMOTE_ENV)
  })

  it('refuses production even when the host is local', () => {
    expect(seedRefusal(LOCAL, { NODE_ENV: 'production' })).toContain('production')
    expect(seedRefusal(LOCAL, { VERCEL_ENV: 'production' })).toContain('production')
  })

  it('refuses a missing URL rather than guessing', () => {
    expect(seedRefusal(undefined, {})).toContain('not set')
    expect(seedRefusal('', {})).toContain('not set')
  })

  it('refuses a URL it cannot parse', () => {
    // Fail closed. An unknown target is not a local one.
    expect(seedRefusal('this is not a url', {})).toContain('could not be parsed')
  })

  it('lets the override waive the host check', () => {
    expect(seedRefusal(REMOTE, { [ALLOW_REMOTE_ENV]: '1' })).toBeNull()
  })

  it('does NOT let the override waive production', () => {
    // The layering is the whole design: "my dev database is elsewhere" must never
    // be usable as "this is production". If this test fails, the override moved
    // above the production gate and the strongest check became optional.
    const r = seedRefusal(REMOTE, { [ALLOW_REMOTE_ENV]: '1', NODE_ENV: 'production' })
    expect(r).toContain('production')
  })

  it('treats only the exact value 1 as the override', () => {
    // `BOOKS_SEED_ALLOW_REMOTE_HOST=` from an empty shell variable must not count.
    for (const v of ['', '0', 'true', 'yes', 'TRUE']) {
      expect(seedRefusal(REMOTE, { [ALLOW_REMOTE_ENV]: v }), `value "${v}" waived the check`).not.toBeNull()
    }
  })
})

describe('assertSeedable', () => {
  it('throws with the reason, so the operator reads it instead of a stack trace', () => {
    expect(() => assertSeedable({ DATABASE_URL: REMOTE })).toThrow(/refusing to seed/)
    expect(() => assertSeedable({ DATABASE_URL: REMOTE })).toThrow(/neon\.tech/)
  })

  it('passes for a local database', () => {
    expect(() => assertSeedable({ DATABASE_URL: LOCAL })).not.toThrow()
  })

  it('accepts the database this machine is actually configured to use', () => {
    // Non-vacuous in the other direction: a guard that refused the developer's own
    // database would be discovered by everybody breaking it, and removed. Skipped
    // rather than failed where there is no configured database, because CI has none.
    if (!process.env.DATABASE_URL) return
    expect(
      () => assertSeedable({ DATABASE_URL: process.env.DATABASE_URL }),
      'the configured DATABASE_URL is refused by the guard, so `npm run db:seed:books` is broken'
    ).not.toThrow()
  })
})
