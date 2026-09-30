import { describe, expect, it } from 'vitest'
import {
  SEARCH_TERMS_MAX,
  decodeEntities,
  escapeLike,
  searchNumber,
  searchTerms,
} from './search-types'

describe('searchTerms', () => {
  it('splits on whitespace, drops a leading #, collapses duplicates, keeps order', () => {
    expect(searchTerms('  login   #482 Login timeout ')).toEqual(['login', '482', 'Login', 'timeout'])
    expect(searchTerms('auth auth')).toEqual(['auth'])
  })

  it('caps the term count so a pasted paragraph cannot build a 200-predicate query', () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    expect(searchTerms(many)).toHaveLength(SEARCH_TERMS_MAX)
  })

  it('returns nothing for a query that is only #', () => {
    expect(searchTerms(' # ')).toEqual([])
  })
})

describe('searchNumber', () => {
  it('reads a bare or #-prefixed number, and nothing else', () => {
    expect(searchNumber('482')).toBe(482)
    expect(searchNumber(' #482 ')).toBe(482)
    expect(searchNumber('482 login')).toBeNull()
    expect(searchNumber('v2')).toBeNull()
    expect(searchNumber('12345678901')).toBeNull()
  })
})

describe('escapeLike', () => {
  it('makes %, _ and \\ literal', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b')
  })
})

describe('decodeEntities', () => {
  it('decodes what the sanitizer emits, amp last so &amp;lt; stays &lt;', () => {
    expect(decodeEntities('a&nbsp;b &lt;i&gt; &quot;x&quot; it&#39;s R&amp;D')).toBe('a b <i> "x" it\'s R&D')
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })
})
