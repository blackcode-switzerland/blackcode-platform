// "One company's invoices under another's name is the worst bug this app can
// ship" (ticket #79). `lib/query-keys.ts`'s header already states the rule —
// every key starts `[...root(ws), ...]` and every company-scoped resource
// takes `company` as part of its filters (or, for `overview`, as an explicit
// second argument) — but nothing asserted it. This file does, against the
// exported `keys` object itself: `lib/query-keys.ts` already has the one
// place the shape is spelled (`root(ws)`, and every resource function built
// on it), so nothing was added to it — see the ticket for why a new helper
// would have been redundant here.
//
// Modelled on `apps/books/lib/query-keys.test.ts`'s first `describe` block
// (the unit half). That file's own header calls its unit tests "the weak
// half" and its module-graph scanner "the point" — the graph half does not
// apply here: books' scanner exists because MANY hooks in `lib/hooks.ts` each
// build a key by hand and could drift from `booksKey`, where billing's every
// read already goes through the one `keys.*` object in `lib/queries.ts` (no
// hook in this app builds a `queryKey:` any other way — checked by hand while
// writing this file, 2026-09-28). What is actually load-bearing here is that
// `keys.*` itself keeps workspace and company apart, which is what these
// cases assert.
//
// ── WATCHED FAIL, TWO WAYS, EACH RESTORED (2026-09-28) ──────────────────────
//   A. `root = (ws: string) => ['billing'] as const` (dropped `ws`) → RED on
//      "two different workspaces never produce the same key", the case named
//      in the ticket verbatim.
//   B. `overview: (ws, company) => [...root(ws), 'overview']` (dropped the
//      `company` element) → RED on "two companies in the same workspace never
//      share the overview slot".
// See the ticket #79 report for the exact diffs and failure output.

import { describe, it, expect } from 'vitest'
import { keys } from './query-keys'

describe('keys are stable', () => {
  it('the same question asked twice is the same key', () => {
    expect(keys.invoices('acme-sa', { status: 'sent' })).toEqual(
      keys.invoices('acme-sa', { status: 'sent' })
    )
    expect(keys.invoice('acme-sa', 42)).toEqual(keys.invoice('acme-sa', 42))
    expect(keys.overview('acme-sa', 'issuer-1')).toEqual(keys.overview('acme-sa', 'issuer-1'))
  })

  it('a #number and its string spelling are the same key', () => {
    // `invoice()` casts the ref with `String(ref)` — a page reading by #number
    // and one reading by the printed number must land in the same cache slot.
    expect(keys.invoice('acme-sa', 42)).toEqual(keys.invoice('acme-sa', '42'))
  })
})

describe('keys are scoped per workspace', () => {
  // THE ONE THE TICKET NAMES. Every resource is checked, not just one, because
  // a helper that separates workspaces for `invoices` and not for `overview`
  // is exactly the kind of thing a single spot-check would miss.
  it('two different workspaces never produce the same key', () => {
    expect(keys.workspace('acme-sa')).not.toEqual(keys.workspace('other-sa'))
    expect(keys.companiesAll('acme-sa')).not.toEqual(keys.companiesAll('other-sa'))
    expect(keys.invoicesAll('acme-sa')).not.toEqual(keys.invoicesAll('other-sa'))
    expect(keys.invoices('acme-sa', {})).not.toEqual(keys.invoices('other-sa', {}))
    expect(keys.invoice('acme-sa', 42)).not.toEqual(keys.invoice('other-sa', 42))
    expect(keys.recurrencesAll('acme-sa')).not.toEqual(keys.recurrencesAll('other-sa'))
    expect(keys.historyAll('acme-sa')).not.toEqual(keys.historyAll('other-sa'))
    expect(keys.overview('acme-sa', null)).not.toEqual(keys.overview('other-sa', null))
    expect(keys.auditAll('acme-sa')).not.toEqual(keys.auditAll('other-sa'))
  })

  it('a nuclear invalidation for one workspace is not a prefix collision with another', () => {
    expect(keys.workspace('acme-sa')).not.toEqual(keys.workspace('acme-sa-2'))
  })
})

describe('company-scoped resources are also scoped per company', () => {
  // The overview route takes `company` as its own parameter, not a filter —
  // checked explicitly because it is the one function shaped differently from
  // the rest.
  it('two companies in the same workspace never share the overview slot', () => {
    expect(keys.overview('acme-sa', 'issuer-1')).not.toEqual(keys.overview('acme-sa', 'issuer-2'))
  })

  it('"every company" and one specific company are different overview slots', () => {
    expect(keys.overview('acme-sa', null)).not.toEqual(keys.overview('acme-sa', 'issuer-1'))
  })

  it('two companies never share an invoice list slot', () => {
    expect(keys.invoices('acme-sa', { company: 'issuer-1' })).not.toEqual(
      keys.invoices('acme-sa', { company: 'issuer-2' })
    )
  })

  it('"every company" and one company are different invoice list slots', () => {
    expect(keys.invoices('acme-sa', {})).not.toEqual(keys.invoices('acme-sa', { company: 'issuer-1' }))
  })

  it('two companies never share a recurrences list slot', () => {
    expect(keys.recurrences('acme-sa', { company: 'issuer-1' })).not.toEqual(
      keys.recurrences('acme-sa', { company: 'issuer-2' })
    )
  })

  it('two companies never share a history list slot', () => {
    expect(keys.history('acme-sa', { company: 'issuer-1' })).not.toEqual(
      keys.history('acme-sa', { company: 'issuer-2' })
    )
  })

  // THE CASE THE TICKET'S OWN WORDS ARE ABOUT: not just "company A differs from
  // company B", but "the same company slug in a DIFFERENT workspace" — the
  // shape where copy-pasting a filter object across a workspace switch would
  // otherwise read from the wrong tenant's cache slot.
  it('the same company slug in two different workspaces never shares a slot', () => {
    expect(keys.invoices('acme-sa', { company: 'issuer-1' })).not.toEqual(
      keys.invoices('other-sa', { company: 'issuer-1' })
    )
    expect(keys.overview('acme-sa', 'issuer-1')).not.toEqual(keys.overview('other-sa', 'issuer-1'))
    expect(keys.company('acme-sa', 'issuer-1')).not.toEqual(keys.company('other-sa', 'issuer-1'))
  })
})

describe('filters are part of the key, not decoration', () => {
  it('two resources in the same workspace never share a slot', () => {
    expect(keys.invoicesAll('acme-sa')).not.toEqual(keys.recurrencesAll('acme-sa'))
  })

  it('a different filter value is a different key', () => {
    expect(keys.invoices('acme-sa', { status: 'draft' })).not.toEqual(
      keys.invoices('acme-sa', { status: 'sent' })
    )
  })
})
