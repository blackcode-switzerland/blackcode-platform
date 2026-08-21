import { describe, it, expect } from 'vitest'
import { wholeNumber } from './query'

const HINT = 'limit is a count of entries, 1 to 500'

describe('wholeNumber', () => {
  it('takes a whole number', () => {
    expect(wholeNumber('100', 'limit', HINT)).toBe(100)
    expect(wholeNumber('0', 'cursor', HINT)).toBe(0)
  })

  it('treats absent and empty alike, rather than empty as zero', () => {
    expect(wholeNumber(null, 'limit', HINT)).toBeUndefined()
    expect(wholeNumber('', 'limit', HINT), '?limit= is a URL built from an empty variable').toBeUndefined()
    expect(wholeNumber('   ', 'limit', HINT)).toBeUndefined()
  })

  // The whole point: NaN must not travel as far as the SQL.
  it('refuses what Number() would turn into NaN, naming the parameter', () => {
    expect(() => wholeNumber('abc', 'limit', HINT)).toThrow(/limit=abc is not a whole number/)
    try {
      wholeNumber('abc', 'limit', HINT)
    } catch (e) {
      expect((e as { code: string }).code).toBe('bad_limit')
      expect((e as { status: number }).status).toBe(400)
      expect((e as { details: string }).details, 'a refusal carries what to do about it').toBe(HINT)
    }
  })

  it('refuses fractions and negatives, which a row count cannot be', () => {
    expect(() => wholeNumber('1.5', 'limit', HINT)).toThrow()
    expect(() => wholeNumber('-1', 'limit', HINT)).toThrow()
    expect(() => wholeNumber('-1', 'cursor', HINT)).toThrow(/cursor=-1/)
  })
})
