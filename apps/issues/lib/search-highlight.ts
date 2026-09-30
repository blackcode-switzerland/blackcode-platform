// Where a search matched inside a piece of text, for the popup to mark.
//
// Pure, and built on the same `searchTerms` the server matches with — so the
// words the popup highlights are the words the query actually required, not a
// second opinion about what "a term" is.

import { searchTerms } from './search-types'

export interface Segment {
  text: string
  hit: boolean
}

/**
 * Split `text` into alternating plain / matched segments. Case-insensitive,
 * longest term first (so `roll` inside `rollout` does not split it twice), and
 * always covers the whole string: joining the segments gives `text` back.
 */
export function highlightSegments(text: string, query: string): Segment[] {
  const terms = searchTerms(query)
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length)
  if (!text || terms.length === 0) return [{ text, hit: false }]

  // Regex escaping, not `escapeLike`'s SQL-LIKE escaping — different alphabets.
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), hit: false })
    out.push({ text: m[0], hit: true })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out.length ? out : [{ text, hit: false }]
}
