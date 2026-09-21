// The seed refuses a database it does not recognise.
//
// This is the only automated protection between `npm run db:seed:billing` and a
// production database full of invoices, so it is tested rather than trusted.
// `apps/books` has the same guard for the same reason; the difference here is
// that migration 0006 revokes DELETE on `invoice`, `company` and `audit`, so a
// seed run against production would fail PART WAY THROUGH and leave a workspace
// in pieces rather than failing cleanly.

import { describe, it, expect } from 'vitest'
import { assertLocalDatabase } from './seed-guard'

describe('the seed will only touch a local database', () => {
  it('accepts the hosts a developer actually uses', () => {
    // The positive case FIRST. A guard built only on refusals cannot tell a
    // working check from one that refuses everything — CLAUDE.md finding #16,
    // and #21 is what happens when the positive case is written carelessly.
    // This one asserts the OUTCOME: the call returns without throwing.
    expect(() =>
      assertLocalDatabase('postgres://blackcode:pw@localhost:5434/blackcode_issues')
    ).not.toThrow()
    expect(() => assertLocalDatabase('postgres://u:p@127.0.0.1:5432/db')).not.toThrow()
    expect(() => assertLocalDatabase('postgres://u:p@host.docker.internal:5432/db')).not.toThrow()
  })

  it('refuses a Neon host, naming it', () => {
    expect(() =>
      assertLocalDatabase('postgres://neondb_owner:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb')
    ).toThrow(/refusing to seed ep-cool-name-123/)
  })

  it('refuses an unrecognised host rather than allowing it', () => {
    // The direction of failure that matters. A blocklist would have allowed
    // this; an allowlist refuses it and costs one message.
    expect(() => assertLocalDatabase('postgres://u:p@db.internal.example/billing')).toThrow(
      /refusing to seed db.internal.example/
    )
  })

  it('refuses a missing URL rather than proceeding with a default', () => {
    expect(() => assertLocalDatabase(undefined)).toThrow(/DATABASE_URL is not set/)
    expect(() => assertLocalDatabase('')).toThrow(/DATABASE_URL is not set/)
  })

  it('refuses a URL it cannot parse, rather than guessing at the host', () => {
    expect(() => assertLocalDatabase('not a url at all')).toThrow(/not a parseable URL/)
  })

  it('says what would be destroyed, not just that it refused', () => {
    // A refusal that does not say what it protected is a refusal somebody
    // works around. The message has to name the consequence.
    let message = ''
    try {
      assertLocalDatabase('postgres://u:p@prod.example/billing')
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    expect(message).toMatch(/DELETES/)
    expect(message).toMatch(/invoices/)
    expect(message).toMatch(/allowlist rather than a blocklist/)
  })
})
