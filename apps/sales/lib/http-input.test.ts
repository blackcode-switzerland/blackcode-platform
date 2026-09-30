// `requirePhone` / `requireEmail` — the validators that make migration 0014's one
// exclusion safe (sales #60).
//
// `prospects.phone` and `prospects.email` carry NO `platform.blob_references`
// trigger, on the argument that no uploaded-file URL can reach them. That
// argument lives here: if either validator ever accepts a value shaped like a
// blob URL, the migration's header is a false claim and a file somebody still
// uses can be read as an orphan. So the cases below are the URL shapes, not the
// happy paths — though the happy paths are asserted too, because a validator
// that refuses everything passes every refusal case (CLAUDE.md, finding #16).

import { describe, expect, it } from 'vitest'
import { requireEmail, requirePhone, repeated } from './http-input'

const accepts = (fn: (v: string) => void, v: string) => expect(() => fn(v)).not.toThrow()
const refuses = (fn: (v: string) => void, v: string) => expect(() => fn(v)).toThrow()

describe('requirePhone', () => {
  it.each(['021 312 80 91', '+41 21 312 80 91', '021/312 80 91', '(021) 312.80.91', '0213128091'])(
    'accepts %s',
    (v) => accepts(requirePhone, v)
  )

  it.each([
    'https://abc.public.blob.vercel-storage.com/sales/acme/deck.pdf',
    'abc.public.blob.vercel-storage.com',
    'ask for Daniel',
    '021 312 80 91 ext. 4',
    '12',
    '',
  ])('refuses %j', (v) => refuses(requirePhone, v))
})

describe('requireEmail', () => {
  it.each(['info@acme.ch', 'a.b+tag@sub.example.co.uk'])('accepts %s', (v) =>
    accepts(requireEmail, v)
  )

  it.each([
    'https://abc.public.blob.vercel-storage.com/x@y.z',
    'info@acme.ch/deck.pdf',
    'mailto:info@acme.ch',
    'info@acme',
    'two words@acme.ch',
    'a@b.ch, c@d.ch',
    '',
  ])('refuses %j', (v) => refuses(requireEmail, v))
})

describe('repeated', () => {
  it('reads each occurrence as one literal value and does not split on commas', () => {
    const q = new URLSearchParams()
    q.append('city', 'Lausanne')
    q.append('city', 'Biel/Bienne, BE')
    q.append('city', '  ')
    expect(repeated(q, 'city')).toEqual(['Lausanne', 'Biel/Bienne, BE'])
    expect(repeated(q, 'sector')).toEqual([])
  })
})
