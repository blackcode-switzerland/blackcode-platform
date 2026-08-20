// The analyses journal's guards, and the two things this app must never do to a
// filed record: read a malformed row as a good one, and recompute a stored
// figure.
//
// **Every case below was watched fail before it was kept**, and the mutation
// that made it fail is recorded beside it — CLAUDE.md's standing rule. Several
// of these functions are a single `if` away from being wrong in a way only a
// browser could see, which is why they are functions at all: `lib/analysis.ts`'s
// header records the phase-4B `accountsLabel` bug, where loosening a type and
// dropping a JSX null check left typecheck and 372 tests green while
// white-screening a book.

import { describe, it, expect } from 'vitest'
import { analysisRows, bookHasSomethingToSay, bookToday, hasSnapshot } from './analysis'
import { en, speech } from './label'

const label = { fr: 'Trésorerie', en: 'Cash' }

describe('analysisRows — the jsonb guard', () => {
  // Mutation watched: replaced the `Array.isArray` test with `if (!value)`.
  // Red on the object and the string cases — both are truthy and neither is
  // iterable, so the loop threw where the screen would have white-screened.
  it('a column that is not an array yields nothing, and does not throw', () => {
    for (const bad of [null, undefined, {}, 'nope', 42, true]) {
      expect(analysisRows(bad)).toEqual({ rows: [], dropped: 0 })
    }
  })

  it('reads a complete row whole, href included', () => {
    expect(
      analysisRows([{ label, value: "CHF 1'806.67", href: 'app-ledger.html?entity=blackcode' }])
    ).toEqual({
      rows: [{ label, value: "CHF 1'806.67", href: 'app-ledger.html?entity=blackcode' }],
      dropped: 0,
    })
  })

  // ── THE VALUE IS NEVER PARSED, NEVER REFORMATTED, NEVER ROUNDED ─────────
  // This is the route's own rule — *"NEVER recomputed"* — asserted rather than
  // trusted. Four seeded shapes, none of which is a `numeric(14,2)` string, all
  // of which come back character for character.
  //
  // Mutation watched: made `figureOf` return `money(o.value)`. Red on all four,
  // and three of them became an em dash — which is what the screen would have
  // shown in place of the agent's own words.
  it('hands a filed value back byte for byte, whatever shape it is', () => {
    const filed = [
      "CHF 5'175.00",
      '−5’281.20 → −10’456.20',
      '13.7 → 6.9 mois',
      "15% → 4'500 × 1.15 = 5'175",
      '≈ CHF 97’100',
    ]
    const { rows } = analysisRows(filed.map((value) => ({ label, value })))
    expect(rows.map((r) => r.value)).toEqual(filed)
  })

  // The FIRST real agent filing (analysis #3, 2026-08-19) used bare-string
  // labels — legal at the door, `speaks()` accepts them — and this screen
  // dropped all thirteen rows of a valid record. A bare string is a label.
  it('reads a bare-string label: the shape the door accepts and real agents file', () => {
    const out = analysisRows([
      { label: 'runway now (months)', value: '49.2' },
      { label: 'cash (tresorerie) 2026-08', value: '72189.43' },
    ])
    expect(out.dropped).toBe(0)
    expect(out.rows.map((r) => en(r.label))).toEqual(['runway now (months)', 'cash (tresorerie) 2026-08'])
    expect(out.rows.map((r) => r.value)).toEqual(['49.2', '72189.43'])
  })

  // The list rendered analyses #3–#6 as EMPTY headlines: `en()` on a filed
  // bare-string question finds no `.en` and answers ''. `speech()` is the
  // reader for verbatim record fields; `en()` stays for statement labels.
  it('speech() reads a filed question whichever way the agent said it', () => {
    expect(speech('Can we afford the raise?')).toBe('Can we afford the raise?')
    expect(speech({ fr: 'Question', en: 'Question' })).toBe('Question')
    expect(speech({ fr: 'Sans bureau' })).toBe('Sans bureau')
    expect(speech(null)).toBe('')
    expect(en({ fr: 'x', en: '' }), 'en() on a statement label still works').toBe('x')
  })

  it('a blank string is still not a label', () => {
    const out = analysisRows([{ label: '   ', value: 'x' }])
    expect(out).toEqual({ rows: [], dropped: 1 })
  })

  // Mutation watched: relaxed the label test to `!!o.label`. Red — `{}` and
  // `{fr: ''}` both passed, and `en()` renders each as an empty cell, which is a
  // provenance row the reader cannot identify.
  it('drops a row with no label, and counts it', () => {
    const out = analysisRows([
      { label, value: 'kept' },
      { value: 'no label' },
      { label: {}, value: 'empty label' },
      { label: { fr: '   ', en: '' }, value: 'blank label' },
    ])
    expect(out.rows.map((r) => r.value)).toEqual(['kept'])
    expect(out.dropped).toBe(3)
  })

  // Mutation watched: relaxed the value test to `o.value !== undefined`. Red on
  // the null, the number and the whitespace cases.
  it('drops a row whose value is not text a person can read', () => {
    const out = analysisRows([
      { label, value: 'kept' },
      { label },
      { label, value: null },
      { label, value: 1806.67 },
      { label, value: '   ' },
    ])
    expect(out.rows.map((r) => r.value)).toEqual(['kept'])
    expect(out.dropped).toBe(4)
  })

  // An href is optional and a blank one is not an href. Mutation watched:
  // returned `o.href as string` unconditionally — red, because `''` then
  // rendered as an empty monospace line under the label.
  it('normalises a missing or blank href to null', () => {
    const { rows } = analysisRows([
      { label, value: 'a' },
      { label, value: 'b', href: '' },
      { label, value: 'c', href: 42 },
    ])
    expect(rows.map((r) => r.href)).toEqual([null, null, null])
  })
})

describe('hasSnapshot — two different absences', () => {
  // The distinction the screen turns on: an answer filed with NO snapshot is an
  // answer whose inputs nobody wrote down; a snapshot this app could not read is
  // a different problem with a different owner. One sentence for both would have
  // to be vague about which.
  //
  // Mutation watched: made it `analysisRows(v).rows.length > 0`. Red on the
  // malformed-rows case, which is precisely the pair that would then collapse.
  it('is true for a non-empty array even when every row is unreadable', () => {
    expect(hasSnapshot([{ nonsense: true }])).toBe(true)
    expect(analysisRows([{ nonsense: true }]).rows).toEqual([])
  })

  it('is false for an empty array, a null, and anything that is not one', () => {
    for (const empty of [[], null, undefined, {}, 'x']) expect(hasSnapshot(empty)).toBe(false)
  })
})

describe('bookToday — and what the check actually asks', () => {
  const asked = '2026-08-11T07:10:00.000Z'
  const rows = [
    { date: '2026-01-05', status: 'posted' },
    { date: '2026-03-12', status: 'staged' },
    { date: '2026-08-11', status: 'posted' },
    { date: '2026-09-01', status: 'staged' },
  ]

  // ── ON OR AFTER, INCLUSIVE, AND COMPARED AS STRINGS ────────────────────
  // Mutation watched: changed `>=` to `>`. Red — the entry dated exactly on the
  // filing day stopped counting, and "the books moved the same day the answer
  // was given" is the case the reader most needs.
  it('counts an entry dated on the filing day, and every one after it', () => {
    expect(bookToday(asked, rows).datedOnOrAfter).toBe(2)
  })

  // ── NO `Date` IS CONSTRUCTED, WHICH IS `<DateText>`'S RULE ─────────────
  // A Postgres `date` parsed as a Date is midnight UTC and renders a day early
  // west of Greenwich; here it would move an entry across the filing boundary.
  // Mutation watched: reimplemented the comparison as
  // `new Date(e.date) >= new Date(askedIso)`. Red on this case under
  // `TZ=America/Los_Angeles`, and green under `TZ=Europe/Zurich` — which is the
  // shape of bug that ships.
  it('compares the day only, so the time of day on the filing stamp is inert', () => {
    const lateInTheDay = '2026-08-11T23:59:59.000Z'
    expect(bookToday(lateInTheDay, rows).datedOnOrAfter).toBe(2)
    const earlyInTheDay = '2026-08-11T00:00:00.000Z'
    expect(bookToday(earlyInTheDay, rows).datedOnOrAfter).toBe(2)
  })

  // ── POSITIVE, AGAINST THE VALUE THE VOCABULARY SERVES ─────────────────
  // Mutation watched: changed the staged test to `e.status !== 'posted'`. Red —
  // the `declared` row counted as staged, which is a claim about what is
  // excluded from the statements that this app was never told.
  it('counts staged positively, so a third status is not swept into it', () => {
    const withThird = [...rows, { date: '2026-02-01', status: 'declared' }]
    expect(bookToday(asked, withThird).staged).toBe(2)
    expect(bookToday(asked, withThird).examined).toBe(5)
  })

  // ── AN UNREADABLE FILING DATE ASKS NOTHING RATHER THAN MATCHING ALL ────
  // `'' <= anything` is true for every string, so a missing `asked` would
  // otherwise report every entry in the book as dated after the answer.
  // Mutation watched: dropped the `day.length === 10` test. Red, at 4 of 4.
  it('a filing date it cannot read counts nothing, rather than everything', () => {
    for (const bad of [null, undefined, '', 'not-a-date']) {
      const t = bookToday(bad, rows)
      expect(t.datedOnOrAfter).toBe(0)
      // and the OTHER half still runs — the two facts are independent
      expect(t.staged).toBe(2)
    }
  })

  it('an empty book is examined: 0, which the screen reports as "could not look"', () => {
    expect(bookToday(asked, [])).toEqual({ examined: 0, datedOnOrAfter: 0, staged: 0 })
  })
})

describe('bookHasSomethingToSay', () => {
  // ── `examined === 0` IS NOT "NOTHING MOVED" ───────────────────────────
  // An absence is only evidence if the instrument could have seen the presence.
  // Mutation watched: dropped the `examined > 0` clause. Red — a book that
  // served no entries at all then reported a clean check, which is the confident
  // wrong answer this whole screen is built against.
  it('is false when the check looked at nothing', () => {
    expect(bookHasSomethingToSay({ examined: 0, datedOnOrAfter: 0, staged: 0 })).toBe(false)
  })

  it('is true when either half found something', () => {
    expect(bookHasSomethingToSay({ examined: 3, datedOnOrAfter: 1, staged: 0 })).toBe(true)
    expect(bookHasSomethingToSay({ examined: 3, datedOnOrAfter: 0, staged: 2 })).toBe(true)
  })

  it('is false when the book was read and neither half found anything', () => {
    expect(bookHasSomethingToSay({ examined: 3, datedOnOrAfter: 0, staged: 0 })).toBe(false)
  })
})
