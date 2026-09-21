// `checkImportRows`: the import's write door, without a database.
//
// The positive case is the mockup's own fourteen rows — every source, a USD row,
// flags in both languages, two rows with no PDF — and it comes FIRST: a checker
// that refused everything would pass every refusal below (CLAUDE.md finding
// #16), so the refusals only mean something next to a batch it ACCEPTS.
//
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md

import { describe, expect, it } from 'vitest'
import { checkImportRows, describeProblems } from './history'
import { mockupHistoryRows } from '@/lib/mockup'
import type { ImportHistoryRow } from '@/types'

const NOW = new Date('2026-09-18T10:00:00Z')
const rows = () => mockupHistoryRows((id) => (id === 1 ? 'blackcode' : 'aurora'))
const one = (patch: Record<string, unknown>): unknown[] => [{ ...rows()[0], ...patch }]
const problemsOf = (raw: unknown[]) => checkImportRows(raw, NOW).problems

describe('checkImportRows', () => {
  it('accepts the mockup’s fourteen rows, unchanged', () => {
    const input = rows()
    expect(input).toHaveLength(14)
    const { rows: out, problems } = checkImportRows(input, NOW)
    expect(problems).toEqual([])
    expect(out).toEqual(input)
  })

  it('keeps a padded source_ref byte for byte — it is never trimmed', () => {
    const padded = '  ZB-000178 \t'
    const { rows: out, problems } = checkImportRows(one({ source_ref: padded }), NOW)
    expect(problems).toEqual([])
    expect((out[0] as ImportHistoryRow).source_ref).toBe(padded)
  })

  it('refuses a total sent as a JSON number, and says to send a string', () => {
    const p = problemsOf(one({ total: 3240 }))
    expect(p).toEqual([expect.objectContaining({ index: 0, field: 'total' })])
    expect(p[0].reason).toMatch(/JSON number.*"3240\.00"/)
  })

  it('refuses a key the row shape does not have, rather than dropping it', () => {
    const p = problemsOf(one({ sourceRef: 'ZB-1' }))
    expect(p).toEqual([expect.objectContaining({ field: 'sourceRef', reason: expect.stringMatching(/not a field/) })])
  })

  it('refuses a flag in one language only', () => {
    const p = problemsOf(one({ import_flag: { en: 'Possible duplicate.' } }))
    expect(p).toEqual([expect.objectContaining({ field: 'import_flag.fr' })])
  })

  it('refuses a drive_path on the blob store, in any case', () => {
    const p = problemsOf(one({ drive_path: 'https://abc.public.BLOB.vercel-storage.com/x.pdf' }))
    expect(p).toEqual([expect.objectContaining({ field: 'drive_path', reason: expect.stringMatching(/blob store/) })])
  })

  it('refuses a future issue date and a date that does not exist', () => {
    expect(problemsOf(one({ issue_date: '2026-09-19' }))).toEqual([expect.objectContaining({ field: 'issue_date' })])
    expect(problemsOf(one({ issue_date: '2025-02-30' }))).toEqual([expect.objectContaining({ field: 'issue_date' })])
  })

  it('refuses the same source id twice in one batch, naming the first', () => {
    const [a] = rows()
    const p = problemsOf([a, { ...a, number: 'other' }])
    expect(p).toEqual([expect.objectContaining({ index: 1, field: 'source_ref', reason: expect.stringMatching(/row 0/) })])
  })

  it('accepts the same source id from the OTHER source', () => {
    const [a] = rows()
    expect(problemsOf([a, { ...a, source: a.source === 'zoho' ? 'invoicely' : 'zoho' }])).toEqual([])
  })

  it('refuses unknown vocabulary, lowercase currencies and blank text', () => {
    const p = problemsOf(one({ source: 'quickbooks', status: 'sent', currency: 'chf', client_name: '   ' }))
    expect(p.map((x) => x.field).sort()).toEqual(['client_name', 'currency', 'source', 'status'])
  })

  it('reports EVERY problem in the batch, not the first', () => {
    const p = problemsOf([
      { ...rows()[0], total: 1 },
      { ...rows()[1], currency: 'eur' },
      { ...rows()[2], status: 'overdue', drive_path: '' },
    ])
    expect(p.map((x) => `${x.index}:${x.field}`)).toEqual(['0:total', '1:currency', '2:status', '2:drive_path'])
  })

  it('describes problems with their row and field, capped', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ index: i, field: 'total', reason: 'is bad' }))
    const s = describeProblems(many)
    expect(s).toMatch(/^row 0: total is bad; row 1: total is bad/)
    expect(s).toMatch(/and 3 more$/)
  })
})
