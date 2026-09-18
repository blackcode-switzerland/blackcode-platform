// `integrationDescribe`'s skip notice names the variable that would have run it.
//
// A suite gated on the migration owner's credential skipped with a notice
// telling the reader to set `TEST_DATABASE_URL` — which runs every OTHER suite
// and leaves that one skipped, reporting success. The notice is the only
// instruction a skipped suite gives, so it has to be the right one.
//
// WATCHED FAILING, 2026-09-18: `TEST_DATABASE_URL` hardcoded again in place of
// `envVar` in the notice and the refusal → the two `envVar` cases red, the
// default case green; restored.

import { describe, expect, it } from 'vitest'
import { integrationDescribe } from '../src/integration-suite'

function skipNotice(opts: { envVar?: string }): string {
  let out = ''
  integrationDescribe({
    describe,
    name: 'probe',
    databaseUrl: undefined,
    warn: (m) => {
      out += m
    },
    ...opts,
  })
  return out
}

describe('integrationDescribe skip notice', () => {
  it('names TEST_DATABASE_URL by default', () => {
    const n = skipNotice({})
    expect(n).toContain('TEST_DATABASE_URL is unset')
    expect(n).toContain('TEST_DATABASE_URL=postgres://')
  })

  it('names the suite’s own variable when it has one, and not the default', () => {
    const n = skipNotice({ envVar: 'TEST_OWNER_DATABASE_URL' })
    expect(n).toContain('TEST_OWNER_DATABASE_URL is unset')
    expect(n).toContain('TEST_OWNER_DATABASE_URL=postgres://')
    expect(n).not.toMatch(/(^|[^_])TEST_DATABASE_URL/)
  })

  it('a required suite refuses to skip, naming the same variable', () => {
    expect(() =>
      integrationDescribe({ describe, name: 'probe', databaseUrl: undefined, required: '1', envVar: 'TEST_OWNER_DATABASE_URL' })
    ).toThrow(/TEST_OWNER_DATABASE_URL is unset/)
  })
})
