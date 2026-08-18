// "`lib/types.ts` describes what the routes actually serve" — asserted, because
// every other way of knowing has already failed once.
//
// ===========================================================================
// THIS IS THE GUARD THE PHASE-1 FAILURE WOULD HAVE NEEDED
// ===========================================================================
// Phase 1 moved the books out of `/api/meta` and the overview rendered "You have
// no books yet" over a workspace holding three books and seventeen entries.
// Nothing threw, because **a wire shape that changes does not fail to compile.**
// The same fix found three more of the same kind, including every book reporting
// "VAT: Not registered" when one is registered, because `publicEntity` nests
// `vat` and the UI read it flat.
//
// Nine more were found on 2026-08-18 by reading the `public*` functions against
// `lib/types.ts` by hand. Four of them would have rendered a confident wrong
// value — French account names on an English screen among them. By hand is not a
// method, so this file is the method.
//
// ── IT ASSERTS TWO DIFFERENT THINGS, AND BOTH ARE NEEDED ──────────────────
//   1. **The KEY SET, at runtime.** A field added to or removed from a `public*`
//      function fails here and has to be looked at. This is the half that
//      catches the backend moving underneath us, which is the thing that
//      actually happens.
//   2. **ASSIGNABILITY, at compile time** (the `satisfies` blocks at the
//      bottom). A field whose TYPE changed — `fte_count` from a number to a
//      `numeric` string — keeps the same key and passes (1) while rendering
//      wrongly. `npm run typecheck` is one of the four gates, so a type-level
//      assertion in a test file is a real check rather than a comment.
//
// Neither half subsumes the other. The key set cannot see a type change; the
// type assertion cannot see a field the payload gained that nothing reads yet.
//
// ── WATCHED FAIL BEFORE BEING TRUSTED (2026-08-18) ────────────────────────
// Each case was made to go red before it was kept; the mutation is recorded
// beside it.
//
// ── WHAT THIS DOES NOT ASK ────────────────────────────────────────────────
// It reads the SHAPING FUNCTIONS, not the routes and not a live response. A
// route that wraps `publicEntity` in a different envelope, or forgets to call it
// at all, is invisible here. `jsonList()` vs a bare object is exactly that
// distinction, and it is checked by opening the page, not by this file.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The app root, for the one case here that reads a route file rather than a
 *  shaping function. See `the worklist envelope is not the list envelope`. */
const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
import {
  publicAccount,
  publicEntity,
  publicEntry,
  publicExercice,
  publicPatrimoine,
  publicRiEntry,
} from './db/queries/statutory'
import { publicRule } from './db/queries/rules'
import type { WorklistRow as WorklistRowWire } from './db/queries/worklist'
import type {
  Account,
  Entity,
  Entry,
  PatrimoineSnapshot,
  RecognitionRule,
  WorklistRow,
} from './types'

/**
 * A row, shaped enough for a pure mapping function.
 *
 * The `public*` functions read columns and never touch a database, so a plain
 * object is a faithful input. The cast is at the CALL, not on the object, so a
 * missing column shows up as a missing key in the output rather than being
 * papered over by the type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (o: Record<string, unknown>): any => o

const ENTITY_KEYS = [
  'number',
  'slug',
  'name',
  'legal_form',
  'seat',
  'bookkeeping_regime',
  'regime_election',
  'regime_note',
  'fiscal_year',
  'vat',
  'audit_status',
  'fte_count',
  'accent',
]

const ENTRY_KEYS = [
  'number',
  'entry_no',
  'date',
  'status',
  'source_id',
  'raw_label',
  'counterparty',
  'explanation',
  'lines',
  'recognition',
  'matched_rule_id',
  'evidence_tier',
  'evidence_note',
  'tva',
  'related_party',
  'piece',
  'reverses_entry_id',
  'history',
]

describe('the wire shapes are what lib/types.ts says they are', () => {
  // Guards against a vacuous pass. If the imports ever resolve to something
  // without these functions, every assertion below is trivially true.
  // CLAUDE.md finding #5 was caught by exactly such an assertion.
  it('found the shaping functions this file is about', () => {
    for (const [name, fn] of Object.entries({
      publicEntity,
      publicAccount,
      publicEntry,
      publicExercice,
      publicPatrimoine,
      publicRiEntry,
      publicRule,
    })) {
      expect(typeof fn, `${name} is not a function — this file is stale`).toBe('function')
    }
  })

  // ── THE RESPONSES BUILT INLINE IN A ROUTE, WHICH THIS FILE CANNOT REACH ────
  // Everything above reads a shaping function. `POST /entries/{n}/resolve`
  // builds its response inline in the route handler, so there is no function to
  // import and the review proved the consequence: renaming `taught_rule` to
  // `rule_taught` server-side left 194/194 green and the typecheck clean, while
  // the screen rendered "rule # taught" for an entry resolved with the box
  // unticked — `undefined !== null` is true. F-2.
  //
  // Reading the route's SOURCE is a weaker check than calling a function, and it
  // is said plainly here rather than implied: it sees that file and nothing else,
  // and it would not notice a change made anywhere but there. It is still the
  // difference between a rename being caught and a false statement shipping.
  it('the resolve route serves exactly the fields ResolveResult declares', () => {
    const src = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/entries/[number]/resolve/route.ts'),
      'utf8'
    )
    const body = src.slice(src.indexOf('return NextResponse.json({'))
    const served = [...body.slice(0, body.indexOf('})')).matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
    expect(served.length, 'found no fields — the response moved and this test is stale').toBeGreaterThan(3)
    expect(served.sort()).toEqual(
      ['explanation', 'history', 'number', 'recognition', 'taught_rule'].sort()
    )
  })

  // Mutation watched: deleted `accent` from `publicEntity`. Red, naming it.
  it('publicEntity serves exactly these fields', () => {
    const out = publicEntity(row({ seq: 1, slug: 'x', vat_registered: true }))
    expect(Object.keys(out).sort()).toEqual([...ENTITY_KEYS].sort())
  })

  // Mutation watched: flattened `vat` back to `vat_registered`. Red.
  // This is the exact fault that printed "VAT: Not registered" for a registered
  // company, so it gets its own case rather than living inside the one above.
  it('publicEntity NESTS vat rather than serving four flat columns', () => {
    const out = publicEntity(
      row({ vat_registered: true, vat_method: 'effective', vat_filing: 'quarterly' })
    )
    expect(Object.keys(out.vat).sort()).toEqual(['filing', 'method', 'note', 'registered'])
    expect(out.vat.registered).toBe(true)
    expect('vat_registered' in out, 'a flat vat column is back on the wire').toBe(false)
  })

  // Mutation watched: added `related_party: a.related_party` to `publicAccount`.
  // Red — which is the right way round: `lib/types.ts` DECLARED that field and
  // the route never served it, so every account read it as `undefined`.
  it('publicAccount serves exactly these fields, and no related_party', () => {
    const out = publicAccount(row({ no: '1020', class: '1' }))
    expect(Object.keys(out).sort()).toEqual(
      ['class', 'label', 'no', 'statement', 'statement_position'].sort()
    )
  })

  // Mutation watched: renamed `enSuffix` to `en` in `lib/chart.ts`'s type. Red
  // at compile time via the `satisfies` block below, and red here on the key.
  //
  // An account label is `{fr, enSuffix}`, NOT `{fr, en}`. Read through `en()`
  // this renders the FRENCH on an English screen, silently — see `lib/label.ts`.
  it('an account label is {fr, enSuffix} and NOT {fr, en}', () => {
    const out = publicAccount(row({ no: '1020', class: '1', label: { fr: 'Banque', enSuffix: 'Bank' } }))
    expect(Object.keys(out.label ?? {}).sort()).toEqual(['enSuffix', 'fr'])
  })

  // Mutation watched: dropped `reverses_entry_id` from `publicEntry`. Red.
  it('publicEntry serves exactly these fields', () => {
    const out = publicEntry({ entry: row({ seq: 1 }), lines: [] })
    expect(Object.keys(out).sort()).toEqual([...ENTRY_KEYS].sort())
  })

  // Mutation watched: `tva: e.tva_rate ? {…} : null`. Red.
  //
  // `tva` is built unconditionally, so there is no `tva: null` on the wire and a
  // null check on the BLOCK can never fire. `lib/types.ts` declared `Vat | null`
  // and every screen would have written the check that does nothing instead of
  // the per-field ones that matter.
  it('publicEntry always serves a tva BLOCK, whose fields may be null', () => {
    const out = publicEntry({ entry: row({ seq: 1, tva_rate: null }), lines: [] })
    expect(out.tva, 'tva became nullable — every screen writes the wrong null check').not.toBeNull()
    expect(Object.keys(out.tva).sort()).toEqual(['amount', 'input_claimed', 'note', 'rate'])
  })

  // Mutation watched: added `entity: e.entity_id` to `publicEntry`. Red.
  //
  // An entry payload says nothing about which book or year it belongs to — the
  // REQUEST does. `lib/types.ts` declared both and both read `undefined`.
  it('an entry payload does not name its book or its exercice', () => {
    const out = publicEntry({ entry: row({ seq: 1 }), lines: [] })
    expect('entity' in out).toBe(false)
    expect('exercice' in out).toBe(false)
  })

  // Mutation watched: dropped `total` from `publicPatrimoine`. Red.
  it('publicPatrimoine derives a total and serves these fields', () => {
    const out = publicPatrimoine(
      row({ seq: 1, items: [{ label: { fr: 'a', en: 'a' }, amount: 8200 }, { label: { fr: 'b', en: 'b' }, amount: 4500 } ] })
    )
    expect(Object.keys(out).sort()).toEqual(
      ['as_of', 'compiled', 'items', 'note', 'number', 'total'].sort()
    )
    expect(out.total).toBe('12700.00')
  })

  // Mutation watched: `amount: String(i.amount)` in the items map. Red.
  //
  // The wire really does carry these as JSON NUMBERS — `books.patrimoine.items`
  // is `jsonb`, served verbatim. It is the only amount in the app that is not a
  // `numeric` string, `usePatrimoine` converts it at the boundary, and the
  // report asks for it to be served as a string. **If this ever goes red because
  // the backend fixed it, delete the conversion in `lib/hooks.ts`.**
  it('patrimoine item amounts are JSON numbers, unlike every other amount', () => {
    const out = publicPatrimoine(row({ seq: 1, items: [{ label: {}, amount: 8200 }] }))
    expect(typeof out.items[0].amount).toBe('number')
    expect(typeof out.total).toBe('string')
  })

  // Mutation watched: dropped `status` from `publicExercice`. Red.
  it('publicExercice serves the year, its bounds and its status', () => {
    const out = publicExercice(row({ year: 2026, status: 'open' }))
    expect(Object.keys(out).sort()).toEqual(['ends_on', 'starts_on', 'status', 'year'])
  })

  it('publicRiEntry serves the simplified book its own shape', () => {
    const out = publicRiEntry(row({ seq: 1 }))
    expect(Object.keys(out).sort()).toEqual(
      [
        'number',
        'date',
        'direction',
        'amount',
        'category',
        'raw_label',
        'counterparty',
        'explanation',
        'recognition',
        'evidence_tier',
        'evidence_note',
        'piece',
      ].sort()
    )
  })
  // ===========================================================================
  // PHASE 2 — the recognition payloads
  // ===========================================================================

  // Mutation watched (2026-08-18): renamed `source_id` back to `source` in
  // `publicRule`. Red, naming both the missing key and the surplus one. Then
  // deleted `created_on`. Red again.
  //
  // FOUR of this payload's nine fields were wrong in `lib/types.ts` until this
  // case was written — `source`/`source_id`, `source_kind`/`learned_from`,
  // `created`/`created_on`, and a phantom `entity`. Every one would have
  // rendered `undefined` in the rules table.
  it('publicRule serves exactly these fields', () => {
    const out = publicRule(
      row({
        seq: 1,
        active: true,
        source_id: 3,
        learned_from: 'contract',
        pattern: { counterparty: 'IMMOREGIE', amount_chf: 1850, tolerance_chf: 0, interval: 'monthly' },
        explanation: { fr: 'Loyer', en: 'Rent' },
        account_no: '6000',
        created_from_entry_id: 7,
        created_on: '2026-01-06',
        note: null,
      }),
      2
    )
    expect(Object.keys(out).sort()).toEqual(
      [
        'number',
        'active',
        'source_id',
        'learned_from',
        'pattern',
        'explanation',
        'account',
        'created_from',
        'created_on',
        'note',
      ].sort()
    )
  })

  // `created_from` is the TEACHING ENTRY'S #number, resolved by `teachingSeqs`,
  // and is null when nothing taught the rule. `publicRule` takes it as an
  // argument rather than reading a column, so a caller that forgets to resolve
  // it gets null and not a serial id — which is the failure that matters, since
  // the rules table renders it as a link to `/ledger/{n}`.
  it('a rule never leaks the teaching entry\'s serial id', () => {
    const r = row({ seq: 1, created_from_entry_id: 4242, pattern: {}, account_no: null })
    expect(publicRule(r, 9).created_from, 'the #number, not the id').toBe(9)
    expect(publicRule(r).created_from, 'no seq resolved means null, never 4242').toBe(null)
  })

  // ── THE WORKLIST HAS NO SHAPING FUNCTION, SO THIS IS THE OTHER HALF ──────
  // `getWorklist` builds its rows inline and needs a database, so there is
  // nothing pure to call here. The KEY SET is pinned against the interface the
  // query layer exports instead, at compile time (`_WorklistKeys` below), and
  // this asserts the two facts a type cannot: that the interface still exists
  // with the two kinds in it, and that the ENVELOPE is not `{data, next_cursor}`.
  //
  // The envelope matters more than it looks. `apiList` would find no `data` key,
  // substitute `[]`, and the screen would say "everything is explained" over a
  // book with unexplained money in it.
  it('the worklist envelope is not the list envelope', () => {
    const route = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/worklist/route.ts'),
      'utf8'
    )
    // Anti-vacuous: if this file stops calling the query, every assertion below
    // is about something that is no longer the worklist.
    expect(route, 'the worklist route is gone — this case is stale').toContain('getWorklist')

    // ── WHAT THIS CHECK ACTUALLY ASKS ────────────────────────────────────
    // It reads the ROUTE FILE as text. It cannot tell you what a live response
    // looks like, and it would not see a change made anywhere else. What it can
    // see is the one thing that matters here: whether this route still returns
    // its bespoke object or has been moved onto the shared list envelope. If it
    // ever is, `useWorklist` must stop reading `.rows` — and the failure would
    // otherwise be an EMPTY worklist on a book with unexplained money in it,
    // which is the confident wrong answer this whole file exists to catch.
    //
    // Mutation watched (2026-08-18): replaced the `NextResponse.json({...})`
    // with `jsonList(rows, null)`. Red on both assertions.
    expect(
      route.includes('jsonList'),
      'the worklist now serves {data, next_cursor} and lib/hooks.ts still reads {rows} — ' +
        'useWorklist must switch to apiList or it will render an empty worklist'
    ).toBe(false)
    expect(
      route.replace(/\s+/g, ' '),
      'the envelope no longer answers with {entity, exercice, count, rows}'
    ).toMatch(/NextResponse\.json\(\s*\{ entity: [^}]*exercice: [^}]*count: [^}]*rows,/)
  })

})

// ===========================================================================
// THE COMPILE-TIME HALF
// ===========================================================================
// The key-set assertions above cannot see a TYPE change. `fte_count` going from
// `number` to a `numeric` string keeps its key and passes every one of them.
//
// These four assert the shaping function's return type is assignable to the
// declared one, in BOTH directions — so a field the payload gained and a field
// the type invented are both errors. They run under `npm run typecheck`, which
// is one of the four gates.
//
// Mutation watched (2026-08-18): changed `Entity.fte_count` back to
// `number | null`. `npm run typecheck` went red on the `satisfies` below,
// naming the field. Restored.

/** `A` is assignable to `B` and `B` to `A` — the same shape, not merely compatible. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

type EntityWire = ReturnType<typeof publicEntity>
type AccountWire = ReturnType<typeof publicAccount>
type EntryWire = ReturnType<typeof publicEntry>
type PatrimoineWire = ReturnType<typeof publicPatrimoine>
type RuleWire = ReturnType<typeof publicRule>

/**
 * The KEY SETS, at compile time.
 *
 * This is the half that catches a field appearing or disappearing without
 * anybody running the suite — `npm run typecheck` alone is enough.
 */
type _EntityKeys = Mutual<keyof EntityWire, keyof Entity>
type _AccountKeys = Mutual<keyof AccountWire, keyof Account>
type _EntryKeys = Mutual<keyof EntryWire, keyof Entry>
type _PatrimoineKeys = Mutual<keyof PatrimoineWire, keyof PatrimoineSnapshot>
type _VatKeys = Mutual<keyof EntityWire['vat'], keyof Entity['vat']>
type _RuleKeys = Mutual<keyof RuleWire, keyof RecognitionRule>
/**
 * The worklist row, pinned against the query layer's own interface.
 *
 * There is no `publicWorklistRow` to call, so this is the whole check for that
 * payload's key set — and it is the one that would have caught `status`, which
 * is `string | null` on the wire because every `ri_entry` row hardcodes null,
 * and which a screen typing as `EntryStatus` would render as a `staged` chip on
 * a book that has no staging step.
 */
type _WorklistKeys = Mutual<keyof WorklistRowWire, keyof WorklistRow>

/**
 * The SCALAR TYPES, field by field, for every field where the wire type is not
 * deliberately narrowed by us.
 *
 * ── WHY THIS IS A LIST AND NOT ONE `satisfies` ────────────────────────────
 * A whole-object assertion was tried first and is too strict to be useful. The
 * database layer types a `jsonb` column as `unknown` and a `varchar` as `string`,
 * so `label`, `explanation`, `note` and the four enum-ish fields
 * (`bookkeeping_regime`, `status`, `recognition`, `evidence_tier`) can never
 * match a declared `Label` or a union — those narrowings are claims WE make,
 * backed by CHECK constraints in migration 0004, and they are the point of
 * declaring them.
 *
 * So the assertion is made where it can be exact: on every field whose wire type
 * is a plain scalar. That is exactly the set where a silent type change is
 * possible — `fte_count` and `tva.rate` are both `numeric` columns that arrive
 * as STRINGS and were both declared as `number`.
 *
 * A field missing from this list is not checked for its type, only for its
 * presence. Adding a scalar field to a payload means adding a line here.
 */
type _Scalars = [
  Mutual<EntityWire['number'], Entity['number']>,
  Mutual<EntityWire['slug'], Entity['slug']>,
  Mutual<EntityWire['name'], Entity['name']>,
  Mutual<EntityWire['legal_form'], Entity['legal_form']>,
  Mutual<EntityWire['seat'], Entity['seat']>,
  Mutual<EntityWire['regime_election'], Entity['regime_election']>,
  Mutual<EntityWire['fiscal_year'], Entity['fiscal_year']>,
  Mutual<EntityWire['audit_status'], Entity['audit_status']>,
  // The `numeric(6,2)` that was declared as a `number`. This is the line that
  // would have caught it.
  Mutual<EntityWire['fte_count'], Entity['fte_count']>,
  Mutual<EntityWire['accent'], Entity['accent']>,
  Mutual<EntityWire['vat']['registered'], Entity['vat']['registered']>,
  Mutual<EntityWire['vat']['method'], Entity['vat']['method']>,
  Mutual<EntityWire['vat']['filing'], Entity['vat']['filing']>,

  Mutual<AccountWire['no'], Account['no']>,
  Mutual<AccountWire['class'], Account['class']>,
  Mutual<AccountWire['statement_position'], Account['statement_position']>,

  Mutual<EntryWire['number'], Entry['number']>,
  // `integer NOT NULL`. Declared `number | null` until 2026-08-18, which put an
  // unreachable branch on the detail screen.
  Mutual<EntryWire['entry_no'], Entry['entry_no']>,
  Mutual<EntryWire['date'], Entry['date']>,
  Mutual<EntryWire['source_id'], Entry['source_id']>,
  Mutual<EntryWire['raw_label'], Entry['raw_label']>,
  Mutual<EntryWire['counterparty'], Entry['counterparty']>,
  Mutual<EntryWire['matched_rule_id'], Entry['matched_rule_id']>,
  Mutual<EntryWire['reverses_entry_id'], Entry['reverses_entry_id']>,
  Mutual<EntryWire['lines'], Entry['lines']>,
  // The other `numeric` that arrives as a string. `percent()` takes it as one.
  Mutual<EntryWire['tva']['rate'], Entry['tva']['rate']>,
  Mutual<EntryWire['tva']['amount'], Entry['tva']['amount']>,
  Mutual<EntryWire['tva']['input_claimed'], Entry['tva']['input_claimed']>,

  Mutual<PatrimoineWire['number'], PatrimoineSnapshot['number']>,
  Mutual<PatrimoineWire['as_of'], PatrimoineSnapshot['as_of']>,
  Mutual<PatrimoineWire['compiled'], PatrimoineSnapshot['compiled']>,
  Mutual<PatrimoineWire['total'], PatrimoineSnapshot['total']>,
  // A JSON number, and the only one in the app. See `PatrimoineItem`.
  Mutual<PatrimoineWire['items'][number]['amount'], PatrimoineSnapshot['items'][number]['amount']>,

  // ── PHASE 2 ────────────────────────────────────────────────────────────
  Mutual<RuleWire['number'], RecognitionRule['number']>,
  Mutual<RuleWire['active'], RecognitionRule['active']>,
  // The half of the match key that was declared as `source`. Blank on every row.
  Mutual<RuleWire['source_id'], RecognitionRule['source_id']>,
  Mutual<RuleWire['account'], RecognitionRule['account']>,
  Mutual<RuleWire['created_from'], RecognitionRule['created_from']>,

  Mutual<WorklistRowWire['number'], WorklistRow['number']>,
  Mutual<WorklistRowWire['date'], WorklistRow['date']>,
  Mutual<WorklistRowWire['raw_label'], WorklistRow['raw_label']>,
  Mutual<WorklistRowWire['counterparty'], WorklistRow['counterparty']>,
  // `numeric(14,2)` for an RI row, `fromCentimes(...)` for an entry. A STRING
  // either way, and it must stay one — `<Money>` has no numeric overload.
  Mutual<WorklistRowWire['amount'], WorklistRow['amount']>,
  Mutual<WorklistRowWire['suggested_rules'], WorklistRow['suggested_rules']>,
]

// Referencing them is what turns a `never` above into an error at THIS line,
// with the failing member named, rather than an unused type alias nobody sees.
const _keys: [
  _EntityKeys,
  _AccountKeys,
  _EntryKeys,
  _PatrimoineKeys,
  _VatKeys,
  _RuleKeys,
  _WorklistKeys,
] = [true, true, true, true, true, true, true]
const _scalars: _Scalars = [
  true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true,
  true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true,
  // phase 2: five rule fields, six worklist fields
  true, true, true, true, true,
  true, true, true, true, true, true,
]
void [_keys, _scalars]
