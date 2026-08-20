// "The monthly grid does not re-derive, re-order, or add anything up" —
// asserted, because all three are things a twelve-column table invites.
//
// ===========================================================================
// EVERY CASE HERE WAS WATCHED TO GO RED (2026-08-20)
// ===========================================================================
// The mutation is recorded beside each one. An assertion nobody has seen fail is
// not an assertion — CLAUDE.md's standing rule, and twenty-one entries in the
// table under it.
//
// ── THE INPUTS ARE CHOSEN SO A FLOAT CANNOT SURVIVE THEM ──────────────────
// Several amounts below carry a THIRD decimal (`"0.145"`, `"8.005"`). No
// bookkeeping amount does — `numeric(14,2)` — and that is exactly why they are
// here: `Number("0.145").toFixed(2)` is `"0.14"` and `Number("8.005").toFixed(2)`
// is `"8.01"`, the same shape rounding in opposite directions, which is the
// measurement in `lib/format.ts`'s header. So "no `Number` was constructed" is
// asserted as an OUTCOME — the string comes back byte-identical — rather than by
// scanning the source for the word `Number`, which a comment satisfies and which
// `monthlyCrView` would fail anyway (it parses a MONTH number for a column
// label, and that is not money).

import { describe, it, expect } from 'vitest'
import { monthlyCrView } from './monthly-cr'
import type { MetaPayload } from './hooks'
import type { CrLineResult, CrResult, MonthlyCrResult } from './types'

const line = (pos: string, amount: string, sign = -1): CrLineResult => ({
  pos,
  sign,
  amount,
  accounts: [],
})

const month = (m: string, lines: CrLineResult[], resultat: string): MonthlyCrResult => ({
  month: m,
  lines,
  resultat,
})

/** Three of art. 959b's ten, in the article's order. Enough to see an order. */
const ANNUAL: CrLineResult[] = [
  line('produits_nets', '5420.00', 1),
  line('charges_personnel', '13350.00'),
  line('autres_charges_exploitation', '3063.60'),
]

const CR: CrResult & { months: MonthlyCrResult[] } = {
  entity: 'blackcode',
  exercice: 2026,
  lines: ANNUAL,
  resultat: '-10993.60',
  months: [
    month(
      '2026-01',
      [
        line('produits_nets', '0.00', 1),
        line('charges_personnel', '13350.00'),
        line('autres_charges_exploitation', '1983.60'),
      ],
      '-15333.60'
    ),
    month(
      '2026-02',
      [
        line('produits_nets', '5420.00', 1),
        line('charges_personnel', '0.00'),
        line('autres_charges_exploitation', '1080.00'),
      ],
      '4340.00'
    ),
    // A quiet month: real zero lines, not an absent column and not a short list.
    month(
      '2026-03',
      [
        line('produits_nets', '0.00', 1),
        line('charges_personnel', '0.00'),
        line('autres_charges_exploitation', '0.00'),
      ],
      '0.00'
    ),
  ],
}

/** `/api/meta`'s structure, as the route serves it: `pos` → `{fr, en}`. */
const META = {
  statements: {
    cr: [
      { pos: 'produits_nets', label: { fr: 'Produits nets', en: 'Net revenue' }, sign: 1 },
      { pos: 'charges_personnel', label: { fr: 'Charges de personnel', en: 'Personnel expense' }, sign: -1 },
      {
        pos: 'autres_charges_exploitation',
        label: { fr: "Autres charges d'exploitation", en: 'Other operating expense' },
        sign: -1,
      },
    ],
  },
} as unknown as MetaPayload

describe('the monthly compte de résultat, arranged for a grid', () => {
  // Anti-vacuous. Every case below is a `for` over one of these two, and a view
  // that came back empty would satisfy all of them in silence — which is the
  // assertion `lib/query-keys.test.ts` and `read-only.test.ts` both open with,
  // and the one CLAUDE.md finding #5 was caught by.
  it('found something to check', () => {
    const view = monthlyCrView(CR, META)
    expect(view.rows.length, 'no rows — the annual body produced nothing').toBe(3)
    expect(view.columns.length, 'no columns — the months produced nothing').toBe(3)
  })

  // Mutation watched: `cr.lines.map(...)` → `[...cr.lines].sort((a, b) =>
  // a.pos.localeCompare(b.pos)).map(...)`, i.e. the rows alphabetised. RED,
  // naming the order it found. That is the single thing ticket #64 asks the
  // screen not to do: art. 959b's order is the document.
  it('the row order is the ANNUAL body\'s order, unsorted and unre-derived', () => {
    const view = monthlyCrView(CR, META)
    expect(view.rows.map((r) => r.pos)).toEqual(CR.lines.map((l) => l.pos))
  })

  // Mutation watched: the columns sorted newest-first
  // (`[...cr.months].sort((a, b) => b.month.localeCompare(a.month))`). RED here,
  // and red on the two cases below as well — the cells are asserted BY COLUMN
  // LOOKUP rather than by a hardcoded index, so moving the columns moves them
  // too. A grid whose columns are not in time order is a grid nobody can read a
  // trend off.
  it('the columns are the months, in the payload\'s order, with a readable heading', () => {
    const view = monthlyCrView(CR, META)
    expect(view.columns.map((c) => c.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(view.columns.map((c) => c.short)).toEqual(['01', '02', '03'])
    expect(view.columns[2].full).toBe('March 2026')
  })

  // Mutation watched: `cells: amounts.map(...)` → `cells: amounts.map(...)
  // .reverse()` — the columns stay put and the CELLS slide under them, which is
  // the version of this bug nothing about the headings can see. RED here and on
  // the quiet-month case; every other case stayed green.
  it('every cell sits under its own month', () => {
    const view = monthlyCrView(CR, META)
    const personnel = view.rows.find((r) => r.pos === 'charges_personnel')!
    const at = (m: string) => personnel.cells[view.columns.findIndex((c) => c.month === m)]
    expect(at('2026-01')).toBe('13350.00')
    expect(at('2026-02')).toBe('0.00')
    expect(at('2026-03')).toBe('0.00')
  })

  // ── THE ONE THAT SEPARATES "NO TRADING" FROM "NO DATA" ───────────────────
  //
  // Mutation watched: `m.get(line.pos) ?? null` → `m.get(line.pos) ?? '0.00'`.
  // RED on the second half. That edit is the tempting one — it removes an em
  // dash from a grid and looks like tidying — and it turns "this month's payload
  // did not carry this statutory line" into "this month earned nothing", which
  // is a different claim about somebody's books.
  it('a quiet month is zeroes; a month MISSING a line is an em dash, and they are not the same', () => {
    const view = monthlyCrView(CR, META)
    const march = view.columns.findIndex((c) => c.month === '2026-03')

    // Quiet: the route emits a full set of real zero lines. They print as zero.
    for (const row of view.rows) expect(row.cells[march], `${row.pos} in March`).toBe('0.00')

    // Missing: a month whose payload does not carry the line at all. The route
    // says this cannot happen; if it ever does, it must be VISIBLE.
    const gapped = monthlyCrView(
      { ...CR, months: [month('2026-01', [line('produits_nets', '0.00', 1)], '0.00')] },
      META
    )
    expect(gapped.rows.find((r) => r.pos === 'produits_nets')!.cells[0]).toBe('0.00')
    expect(gapped.rows.find((r) => r.pos === 'charges_personnel')!.cells[0]).toBeNull()
  })

  // ── THE TOTAL COMES OFF THE WIRE ────────────────────────────────────────
  //
  // Mutation watched: `total: line.amount` → the sum of the row's own cells,
  // i.e. the grid adding its columns up. Against `CR` alone this case stayed
  // **GREEN** — and that is the finding worth writing down. `CR`'s months sum to
  // its year exactly, because a correct payload does, so an assertion built only
  // on a correct payload cannot tell "read the total off the wire" from
  // "recompute it and get the same answer". Only the third-decimal case below
  // caught it, and by luck of the input rather than by design.
  //
  // So the second half exists: a payload whose months deliberately DO NOT sum.
  // That is not a hypothetical — it is precisely what a screen holds when the
  // annual body and the months were fetched at two different moments, which is
  // the failure the route serves them together to prevent, and it is the only
  // input on which the two implementations differ. With it, the summing mutation
  // is RED here as well as below.
  it('the year column is the annual body, string for string — even if the months do not sum', () => {
    const view = monthlyCrView(CR, META)
    for (const row of view.rows) {
      expect(row.total, `${row.pos}`).toBe(CR.lines.find((l) => l.pos === row.pos)!.amount)
    }
    expect(view.resultat.total).toBe(CR.resultat)

    // Two moments of one statement. The annual body wins, unaltered, because it
    // is what the server said the year was.
    const disagreeing = monthlyCrView(
      {
        ...CR,
        months: CR.months.map((m) => ({
          ...m,
          lines: m.lines.map((l) => ({ ...l, amount: '1.00' })),
          resultat: '1.00',
        })),
      },
      META
    )
    for (const row of disagreeing.rows) {
      expect(row.total, `${row.pos} was recomputed from the columns`).toBe(
        CR.lines.find((l) => l.pos === row.pos)!.amount
      )
    }
    expect(disagreeing.resultat.total, 'the year was recomputed from the columns').toBe(CR.resultat)
  })

  // Mutation watched: `cells: cr.months.map((m) => m.resultat)` → the sum of the
  // month's own line amounts. RED. A résultat is not the sum of a column of
  // magnitudes — the sign of each line is fixed by the article — so that edit
  // is wrong even before it is a float.
  it('each month\'s résultat is the server\'s, not the sum of its column', () => {
    const view = monthlyCrView(CR, META)
    expect(view.resultat.cells).toEqual(['-15333.60', '4340.00', '0.00'])
  })

  // ── NO `Number` IS CONSTRUCTED ON THE MONEY PATH ────────────────────────
  //
  // Asserted as an outcome, not by scanning for the word — see this file's
  // header. `"0.145"` and `"8.005"` cannot survive a float round-trip: they come
  // back `"0.14"` and `"8.01"`, rounding in OPPOSITE directions.
  //
  // Mutation watched: `total: line.amount` → `total: Number(line.amount)
  // .toFixed(2)`. RED, printing `"0.14"` against `"0.145"`. Also watched: the
  // year's `resultat` recomputed as `cr.months.reduce(... Number ...)`. RED.
  it('a third decimal survives untouched, which no float path can do', () => {
    const odd: CrResult & { months: MonthlyCrResult[] } = {
      entity: 'blackcode',
      exercice: 2026,
      lines: [line('produits_nets', '0.145', 1), line('charges_personnel', '8.005')],
      resultat: '1e3',
      months: [month('2026-01', [line('produits_nets', '0.145', 1)], '8.005')],
    }
    const view = monthlyCrView(odd, META)
    expect(view.rows[0].total).toBe('0.145')
    expect(view.rows[1].total).toBe('8.005')
    expect(view.rows[0].cells[0]).toBe('0.145')
    expect(view.resultat.cells[0]).toBe('8.005')
    // `"1e3"` is not a bookkeeping amount and `<Money>` renders it as an em
    // dash. What matters here is that this module hands it on unchanged rather
    // than quietly turning it into `1000.00`, which is what `Number()` does and
    // which `lib/format.ts` refuses for the same reason.
    expect(view.resultat.total).toBe('1e3')
  })

  // ── THE LINE NAMES COME FROM /api/meta, NOT FROM THE BUNDLE ─────────────
  //
  // Mutation watched: `names.get(line.pos) ?? fallbackLabel(line.pos)` →
  // `names.get(line.pos)!`, then rendering with no meta. RED on the fallback
  // case with a `TypeError`, which is the point: a `pos` the served structure
  // does not know must still RENDER — legibly and obviously un-glossed — because
  // dropping the row removes money from a statutory statement.
  it('joins the names on `pos` from the served structure, and keeps an unknown line', () => {
    const view = monthlyCrView(CR, META)
    expect(view.rows[0].fr).toBe('Produits nets')
    expect(view.rows[0].en).toBe('Net revenue')

    const noMeta = monthlyCrView(CR, undefined)
    expect(noMeta.rows.map((r) => r.pos)).toEqual(CR.lines.map((l) => l.pos))
    expect(noMeta.rows[0].fr, 'an unglossed line must still name itself').toBe('produits_nets')
  })
})
