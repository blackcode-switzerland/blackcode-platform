import { describe, expect, it } from 'vitest'
import { highlightSegments } from './search-highlight'
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  type KeyValueStore,
} from './recent-searches'

describe('highlightSegments', () => {
  const join = (q: string, t: string) => highlightSegments(t, q).map((s) => s.text).join('')

  it('marks every term, case-insensitively, and always reassembles the text', () => {
    const segs = highlightSegments('Fix Login timeout on login', 'login')
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['Login', 'login'])
    expect(join('login', 'Fix Login timeout on login')).toBe('Fix Login timeout on login')
  })

  it('treats regex metacharacters in the query as text', () => {
    expect(highlightSegments('cost (est.) 100%', '(est.)').filter((s) => s.hit).map((s) => s.text)).toEqual(['(est.)'])
    expect(() => highlightSegments('x', '[')).not.toThrow()
    expect(join('.*', 'a.*b')).toBe('a.*b')
  })

  it('a leading # is not part of the term, and a longer term wins over its own prefix', () => {
    expect(highlightSegments('issue 482', '#482').filter((s) => s.hit).map((s) => s.text)).toEqual(['482'])
    expect(highlightSegments('rollout', 'roll rollout').filter((s) => s.hit).map((s) => s.text)).toEqual(['rollout'])
  })

  it('returns the text untouched when there is nothing to mark', () => {
    expect(highlightSegments('abc', '  ')).toEqual([{ text: 'abc', hit: false }])
    expect(highlightSegments('', 'a')).toEqual([{ text: '', hit: false }])
  })
})

describe('recent searches', () => {
  const fake = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  }

  it('remembers most-recent-first, de-duplicates case-insensitively and caps the list', () => {
    const s = fake()
    for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) pushRecentSearch('ws', q, s)
    expect(readRecentSearches('ws', s)).toEqual(['g', 'f', 'e', 'd', 'c', 'b'])
    pushRecentSearch('ws', 'D', s)
    expect(readRecentSearches('ws', s)).toEqual(['D', 'g', 'f', 'e', 'c', 'b'])
  })

  it('is per workspace, ignores blanks, and clears', () => {
    const s = fake()
    pushRecentSearch('one', 'alpha', s)
    pushRecentSearch('two', '   ', s)
    expect(readRecentSearches('two', s)).toEqual([])
    clearRecentSearches('one', s)
    expect(readRecentSearches('one', s)).toEqual([])
  })

  it('survives storage that throws or holds garbage', () => {
    const boom: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(readRecentSearches('ws', boom)).toEqual([])
    expect(() => pushRecentSearch('ws', 'x', boom)).not.toThrow()
    const junk = fake()
    junk.data.set('bc-issues:recent-searches:ws', '{"not":"a list"}')
    expect(readRecentSearches('ws', junk)).toEqual([])
    expect(readRecentSearches('ws', null)).toEqual([])
  })
})
