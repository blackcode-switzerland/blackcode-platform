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
import {
  publicSource,
  publicPull,
  publicRunbook,
  publicManifestRow,
} from './db/queries/sources'
import { publicPiece } from './db/queries/pieces'
import type { postEntry } from './db/queries/imports'
import { bilanFor, crFor } from './derive'
import type { WorklistRow as WorklistRowWire } from './db/queries/worklist'
import type { OverviewBook as OverviewBookWire } from './db/queries/statutory'
import type { InvitationRow } from './db/queries/invitations'
import type { ExerciceRow } from './hooks'
import type { PostResult } from './mutations'
import type {
  Account,
  BilanGroupResult,
  BilanLineResult,
  BilanResult as BilanResultType,
  CrLineResult,
  CrResult as CrResultType,
  Entity,
  Entry,
  InboxPiece,
  ManifestFile,
  PatrimoineSnapshot,
  RecognitionRule,
  RiEntry,
  OverviewBook,
  OverviewResult,
  Source,
  SourceDetail,
  SourcePull,
  SourceRunbook,
  WorklistResult,
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

/**
 * The TOP-LEVEL keys of the object literal a route hands to `NextResponse.json`.
 *
 * ── WHY THIS EXISTS RATHER THAN ANOTHER `indexOf('})')` ───────────────────
 * The `resolve` case below was the first source-reading check in this file and
 * it slices to the first `})`. That is correct for a FLAT response and silently
 * wrong for a nested one: it stops inside the first nested object literal and
 * reports a SHORT key list, which is a smaller assertion that still passes.
 * Four of the seven routes this section covers nest, so depth-tracking is not a
 * tidiness preference — without it "found the whole envelope" and "found the
 * first two keys" are indistinguishable.
 *
 * A spread is reported as `...name`, and that is the point. Whether the bilan
 * route answers `{...bilan}` or `{bilan}` is exactly what decides whether a
 * screen reads `data.totalActif` or `data.bilan.totalActif`, it is invisible to
 * every other check in this repo, and it is a one-character edit.
 *
 * ── WHAT IT DOES NOT ASK ──────────────────────────────────────────────────
 * It reads ONE file as text. It cannot see a live response, it does not know
 * what the spread expands to, and a route that computes its payload elsewhere
 * and returns a variable would report a single `...x` and nothing else. Where
 * the expansion matters, the case beside it CALLS the shaping path instead —
 * `bilanFor`, `crFor` and the `publicSource` composition below are real calls
 * against the real functions, which is strictly better than a source read and
 * is why those three are not written this way.
 */
function envelopeKeys(src: string, opts: { after?: string; label: string }): string[] {
  const from = opts.after ? src.indexOf(opts.after) : 0
  if (from < 0) throw new Error(`${opts.label}: "${opts.after}" is not in this file any more`)

  // ── THE **LAST** RESPONSE AFTER THE ANCHOR, NOT THE FIRST ────────────────
  // This took the first `NextResponse.json(` it found. A route that returns
  // early — a refusal, an empty case, a 304 — puts a DIFFERENT object literal
  // between the anchor and the one being pinned, and the reader then walked the
  // wrong one: the case went red naming keys nobody had touched, which is worse
  // than not firing, because it sends the reader to the wrong file.
  //
  // The success response is the last one in a handler, so that is what is read,
  // and how many were skipped is reported when it matters. Found in the cleanup
  // audit, 2026-08-18.
  // Bounded by the NEXT handler, so an anchored read never crosses into one it
  // was not asked about — `invitations/route.ts` holds a GET and a POST, and an
  // unbounded "last" walked the POST's object while claiming to pin the GET's.
  const nextHandler = opts.after ? src.indexOf('export const ', from + 1) : -1
  const until = nextHandler < 0 ? src.length : nextHandler

  const calls: number[] = []
  for (let at = src.indexOf('NextResponse.json(', from); at >= 0 && at < until; at = src.indexOf('NextResponse.json(', at + 1)) {
    calls.push(at)
  }
  if (calls.length === 0) throw new Error(`${opts.label}: no NextResponse.json( — this case is stale`)
  const call = calls[calls.length - 1]
  const open = src.indexOf('{', call)
  if (open < 0) throw new Error(`${opts.label}: NextResponse.json was not given an object literal`)

  const keys: string[] = []
  let depth = 0
  let expectKey = false
  let quote: string | null = null

  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl < 0) break; i = nl; continue }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i); if (end < 0) break; i = end + 1; continue }
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth === 1) expectKey = true; continue }
    if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) break; continue }
    if (depth !== 1) continue
    if (c === ',') { expectKey = true; continue }
    if (!expectKey || /\s/.test(c)) continue

    const rest = src.slice(i)
    const spread = /^\.\.\.(\w+)/.exec(rest)
    const named = /^(\w+)\s*:/.exec(rest)
    const shorthand = /^(\w+)\s*[,}]/.exec(rest)
    if (spread) keys.push(`...${spread[1]}`)
    else if (named) keys.push(named[1])
    else if (shorthand) keys.push(shorthand[1])
    expectKey = false
    const eaten = spread ?? named ?? shorthand
    if (eaten) i += eaten[1].length - 1 + (spread ? 3 : 0)
  }
  return keys
}

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
  // 2026-08-19: seq is workspace-wide; these two say WHOSE écriture it is.
  'entity',
  'exercice',
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
  // 0011: the original-currency story, {original, rate, source} | null.
  'fx',
  // 0014: the Devil's Advocate's flag, null until an agent pass writes one.
  'verdict',
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
      publicSource,
      publicPull,
      publicRunbook,
      publicManifestRow,
      publicPiece,
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

  // HISTORY: until 2026-08-19 this case pinned the OPPOSITE — the wire carried
  // the mockup's `{fr, enSuffix}` and `en()` rendered the French on an English
  // screen (phase-1 handoff finding). The backend now normalizes at the door:
  // storage keeps the mockup's shape, the wire honours phase-0-contract.md.
  it('an account label is {fr, en} on the wire, whatever storage spells it', () => {
    const out = publicAccount(row({ no: '1020', class: '1', label: { fr: 'Banque', enSuffix: 'Bank' } }))
    expect(out.label).toEqual({ fr: 'Banque', en: 'Bank' })
  })

  // Mutation watched: dropped `reverses_entry_id` from `publicEntry`. Red.
  it('publicEntry serves exactly these fields', () => {
    const out = publicEntry({ entry: row({ seq: 1 }), lines: [] }, { entity: 'blackcode', exercice: 2026 })
    expect(Object.keys(out).sort()).toEqual([...ENTRY_KEYS].sort())
  })

  // Mutation watched: `tva: e.tva_rate ? {…} : null`. Red.
  //
  // `tva` is built unconditionally, so there is no `tva: null` on the wire and a
  // null check on the BLOCK can never fire. `lib/types.ts` declared `Vat | null`
  // and every screen would have written the check that does nothing instead of
  // the per-field ones that matter.
  it('publicEntry always serves a tva BLOCK, whose fields may be null', () => {
    const out = publicEntry({ entry: row({ seq: 1, tva_rate: null }), lines: [] }, { entity: 'blackcode', exercice: 2026 })
    expect(out.tva, 'tva became nullable — every screen writes the wrong null check').not.toBeNull()
    expect(Object.keys(out.tva).sort()).toEqual(['amount', 'input_claimed', 'note', 'rate'])
  })

  // HISTORY: until 2026-08-19 this pinned the OPPOSITE — the payload said
  // nothing about its book or year, the transaction screen inferred both from
  // the URL filter, and switching the book selector relabelled an unchanged
  // écriture (ticket #53, 16:03). The backend now serves both BY NAME (slug
  // and year, never ids), resolved from the row itself, so the screen states
  // whose écriture it is instead of guessing.
  it('an entry payload names its book and its exercice, truthfully', () => {
    const out = publicEntry({ entry: row({ seq: 1 }), lines: [] }, { entity: 'blackcode', exercice: 2026 })
    expect(out.entity).toBe('blackcode')
    expect(out.exercice).toBe(2026)
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

  // HISTORY: until 2026-08-19 this pinned the OPPOSITE — the items crossed the
  // wire as JSON numbers, the only amount in the app that was not a `numeric`
  // string, and `usePatrimoine` converted at the boundary. The backend now
  // formats at the door (the phase-1 handoff's ask), the hooks conversion is
  // deleted, and this case holds the fixed shape.
  it('patrimoine item amounts are numeric strings, like every other amount', () => {
    const out = publicPatrimoine(row({ seq: 1, items: [{ label: {}, amount: 8200 }] }))
    expect(out.items[0].amount).toBe('8200.00')
    expect(typeof out.total).toBe('string')
  })

  // Mutation watched: dropped `status` from `publicExercice`. Red.
  it('publicExercice serves the year, its bounds and its status', () => {
    const out = publicExercice(row({ year: 2026, status: 'open' }))
    expect(Object.keys(out).sort()).toEqual(['ends_on', 'starts_on', 'status', 'year'])
  })

  it('publicRiEntry serves the simplified book its own shape', () => {
    const out = publicRiEntry(row({ seq: 1 }), { entity: 'ri', exercice: 2026 })
    expect(Object.keys(out).sort()).toEqual(
      [
        'number',
        // 2026-08-19: same two fields as the grand livre's.
        'entity',
        'exercice',
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
        // 0011: same story, same shape, on the RI journal.
        'fx',
        // 0014: the Devil's Advocate reaches both journals.
        'verdict',
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

  // ===========================================================================
  // PHASE 3 — the sources register and the pièces inbox
  // ===========================================================================

  // Mutation watched (2026-08-18): deleted `windows` from `publicSource`. Red,
  // naming it. Then renamed `status` to `computed_status` (the mockup's own
  // spelling, which is the rename somebody will make). Red on both keys.
  //
  // `status` and `windows` are the two fields that exist ONLY on the wire —
  // neither is a column, both are computed per request from `expected` against
  // `last_import`. A screen that lost them silently would have nothing to draw
  // the register's entire point from.
  it('publicSource serves exactly these fields, including the two computed ones', () => {
    const out = publicSource(
      row({ seq: 1, name: 'WIR Bank', type: 'bank', expected: 'weekly', last_import: '2026-08-07', retired: false, ledger_accounts: ['1020'] }),
      '2026-08-18',
      'blackcode'
    )
    expect(Object.keys(out).sort()).toEqual(
      [
        'number',
        'name',
        'type',
        'layer',
        'entity',
        'method',
        'expected',
        'last_import',
        'retired',
        'ledger_accounts',
        'status',
        'windows',
        'notes_freeform',
      ].sort()
    )
    expect(Object.keys(out.windows).sort()).toEqual(['gap_after_days', 'stale_after_days'])
  })

  // ── THE MOCKUP DRAWS THREE THINGS THIS PAYLOAD DOES NOT CARRY ────────────
  // `draws_from` is a real COLUMN on `books.source` and is not served, so the
  // mockup's card→bank CHAIN cannot be drawn — only each source's own `layer`.
  // A screen written from the mockup would read `source.draws_from` as
  // `undefined` and render the chain as absent rather than as unavailable,
  // which is a different claim. `drive` and a per-source book balance were
  // never columns at all.
  //
  // Mutation watched: added `draws_from: s.draws_from` to `publicSource`. Red —
  // which is the right way round: the day it IS served, this case is what says
  // so, and the register grows its chain.
  it('a source payload carries no draws_from, no drive block and no balance', () => {
    const out = publicSource(row({ seq: 1, draws_from: 7, ledger_accounts: [] }), '2026-08-18', null)
    expect('draws_from' in out, 'the layer chain is on the wire now — draw it').toBe(false)
    expect('drive' in out).toBe(false)
    expect('balance' in out).toBe(false)
  })

  // `retired` beats every cadence. Seeded source #4 last imported 31.01.2026 —
  // months past every window — and is `retired`, not `gap`.
  //
  // Mutation watched: dropped the `retired` branch from `sourceStatus`. Red,
  // reporting `gap`.
  it('a retired source is retired whatever its cadence says', () => {
    const out = publicSource(
      row({ seq: 4, retired: true, expected: 'none', last_import: '2026-01-31', ledger_accounts: [] }),
      '2026-08-18',
      'blackcode'
    )
    expect(out.status).toBe('retired')
  })

  // Mutation watched: dropped `drive_ref` from `publicPull`. Red.
  it('publicPull serves exactly these fields', () => {
    const out = publicPull(row({ file: 'x.csv' }))
    expect(Object.keys(out).sort()).toEqual(
      ['file', 'period', 'format', 'hash', 'drive_ref', 'pulled'].sort()
    )
  })

  // Mutation watched: renamed `credential_ref` to `credentials`. Red, naming
  // both. The field is a VAULT REFERENCE and the screen labels it as one; a
  // rename that slipped through would leave the screen calling something else a
  // reference, which is the one label on this payload that must not be wrong.
  it('publicRunbook serves exactly these fields, credential_ref among them', () => {
    const out = publicRunbook(row({ version: '0.9', steps: [] }))
    expect(Object.keys(out).sort()).toEqual(
      ['version', 'updated', 'login_url', 'credential_ref', 'steps', 'output'].sort()
    )
  })

  // Mutation watched: dropped `archived` from `publicManifestRow`. Red.
  it('publicManifestRow serves exactly these fields', () => {
    const out = publicManifestRow(row({ file_id: 'abc', state: 'discovered' }), 5)
    expect(Object.keys(out).sort()).toEqual(
      ['file_id', 'name', 'mime_type', 'created_time', 'fetched', 'state', 'archived', 'archive_ref', 'piece'].sort()
    )
    expect(out.piece, 'the pièce #number, not the serial id').toBe(5)
  })

  // ── THE ONE DATE IN THIS APP THAT IS NOT A POSTGRES `date` ───────────────
  // `drive_manifest.drive_created_time` and `piece_inbox.drive_created_time`
  // are `timestamp with time zone`, so the column type is a `Date` and the WIRE
  // carries `"2026-08-13T13:46:00.000Z"` — ten characters of date and then a
  // time. Every other date in this app arrives as `"2026-08-13"`.
  //
  // `format.date()` slices the first ten characters and never parses, so it is
  // correct for both. That is luck the app earned on purpose (see
  // `<DateText>`'s header) and it is pinned here rather than assumed: if this
  // ever becomes a `date` column, `lib/types.ts` should drop the timestamp note.
  //
  // Mutation watched: changed the field to `m.fetched` (a real `date`). Red —
  // the assertion below stopped seeing a `Date`.
  it('a manifest created_time is a timestamp, unlike every other date here', () => {
    const out = publicManifestRow(row({ file_id: 'a', state: 'discovered', drive_created_time: new Date('2026-08-13T13:46:00Z') }), null)
    expect(out.created_time instanceof Date, 'created_time stopped being a timestamp').toBe(true)
    expect(out.piece, 'no piece resolved means null, never a serial id').toBe(null)
  })

  // Mutation watched: dropped `needs_review` from `publicPiece`. Red. Then
  // renamed `validation` to `server_validation`. Red on both keys.
  //
  // `duplicate_of` is declared `number | null` HERE and filled by the route,
  // not by this function — `publicPiece` always returns null for it. That is
  // why the key must be present: a route that stopped spreading its own value
  // would leave a piece looking un-flagged rather than looking broken.
  it('publicPiece serves exactly these fields', () => {
    const out = publicPiece(
      row({ seq: 1, status: 'staged', received: '2026-08-13', extraction: { tx: { total: 79.05, date: '2026-08-05' }, merchant: { name: 'X' }, document_type: 'receipt' }, validation: { passed: true } }),
      'blackcode',
      null
    )
    expect(Object.keys(out).sort()).toEqual(
      [
        'number',
        'entity',
        'status',
        'received',
        'pipeline',
        'source',
        'document_type',
        'merchant',
        'total',
        'date',
        'validation',
        'needs_review',
        'duplicate_of',
        'matched_entry',
        'matched_journal',
        'extraction',
        'note',
      ].sort()
    )
    expect(Object.keys(out.source).sort()).toEqual(
      ['file_id', 'file_name', 'mime_type', 'md5_checksum', 'created_time', 'web_view_link'].sort()
    )
  })

  // ── THE SEED SPELLS IT `tx`; THE SCHEMA SAYS `transaction` ──────────────
  // `lib/validate/extraction.ts` records that `ingestPiece` accepts either and
  // does NOT normalise what it stores, so the column carries whichever the
  // writer used. Seeded pièce #1 has only `tx`. `publicPiece` reads both for
  // the fields it lifts out, and `transactionOf()` in `lib/hooks.ts` is what
  // keeps a detail panel from rendering an empty card over a full document.
  //
  // Mutation watched: removed the `?? x.tx` fallback from `publicPiece`. Red on
  // both — `total` became null and `date` became null, which is exactly what
  // the inbox would have rendered for every seeded row.
  it('publicPiece reads the total and the date under EITHER spelling', () => {
    const asTx = publicPiece(row({ seq: 1, extraction: { tx: { total: 79.05, date: '2026-08-05' } }, validation: {} }), null, null)
    expect(asTx.total).toBe('79.05')
    expect(asTx.date).toBe('2026-08-05')
    const asTransaction = publicPiece(row({ seq: 2, extraction: { transaction: { total: 30.05, date: '2026-08-05' } }, validation: {} }), null, null)
    expect(asTransaction.total).toBe('30.05')
  })

  // A TOTAL IS A STRING, like every other amount in this app. `<Money>` has no
  // numeric overload and `lib/format.ts` is float-free; the extraction's own
  // `total` is a JSON number (79.05) and `fromCentimes(toCentimes(...))` is
  // what turns it into `"79.05"` before it reaches the wire.
  //
  // Mutation watched: `total: tx ? tx.total : null`. Red, reporting a number.
  it('a pièce total crosses the wire as a string', () => {
    const out = publicPiece(row({ seq: 1, extraction: { tx: { total: 79.05 } }, validation: {} }), null, null)
    expect(typeof out.total).toBe('string')
  })

  // ── THE MANIFEST ENVELOPE IS NOT THE LIST ENVELOPE ──────────────────────
  // Same failure shape as the worklist, one route along: `{source, files}`, so
  // `apiList` would find no `data` key, substitute `[]`, and the screen would
  // render "no files on record" over a folder holding six. There is no shaping
  // function for the envelope, so this reads the route's source — a weaker
  // check than calling a function, and it is said plainly: it sees that file
  // and nothing else.
  //
  // Mutation watched (2026-08-18): replaced the `NextResponse.json({source,
  // files})` with `jsonList(rows, null)`. Red on both assertions.
  it('the manifest envelope is not the list envelope', () => {
    const route = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/sources/[number]/manifest/route.ts'),
      'utf8'
    )
    expect(route, 'the manifest route is gone — this case is stale').toContain('manifestOf')
    expect(
      route.includes('jsonList'),
      'the manifest now serves {data, next_cursor} and useManifest still reads {files} — ' +
        'it would render "no files on record" over a folder that has some'
    ).toBe(false)
    expect(
      route.replace(/\s+/g, ' '),
      'the envelope no longer answers with {source, files}'
    ).toMatch(/NextResponse\.json\(\s*\{ source: [^}]*files:/)
  })

  // ── THE MATCH RESPONSE IS BUILT INLINE, LIKE RESOLVE'S ─────────────────
  // Same class of payload as `POST /entries/{n}/resolve` above, and the same
  // weakness: there is no shaping function to call, so this reads the route's
  // SOURCE. Reading a file is weaker than calling a function — it sees that file
  // and nothing else — and it is still the difference between a rename being
  // caught and a false statement shipping. F-2 is what happens without it:
  // renaming `taught_rule` server-side left 194/194 green while the screen
  // rendered "rule # taught" for a rule nobody taught.
  //
  // `matched_journal` is the field that matters most here. `<PiecesInbox>` links
  // to `/ledger/{n}` only when it says `grand_livre`; a `recettes_depenses`
  // number in that link would open a DIFFERENT record.
  //
  // Mutation watched (2026-08-18): renamed `matched_journal` to `journal` in the
  // route. Red, naming both the missing key and the surplus one.
  it('the match route serves exactly the fields MatchResult declares', () => {
    const src = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/pieces/[number]/match/route.ts'),
      'utf8'
    )
    const body = src.slice(src.indexOf('return NextResponse.json({'))
    const served = [...body.slice(0, body.indexOf('})')).matchAll(/(\w+):/g)].map((m) => m[1])
    expect(served.length, 'found no fields — the response moved and this test is stale').toBeGreaterThan(3)
    expect([...new Set(served)].sort()).toEqual(
      ['matched_entry', 'matched_journal', 'number', 'status'].sort()
    )
  })

  // ── THE POST RESPONSE IS BUILT INLINE TOO, AND IT IS THE THIRD ─────────
  // `POST /entries/{n}/post` returns `postEntry`'s object straight through, so
  // there is no `publicPost` to call. Same weakness as resolve's and match's,
  // and the same reason it is still worth having: a rename server-side is caught
  // here or it is caught by a reader noticing a blank on the screen.
  //
  // **`already` is the field that matters most.** `<PostEntryForm>` renders
  // "already posted" — not an error — when it is true, because the route is
  // idempotent so that the Companion can retry. Losing the field would make
  // every re-post read as a fresh post, which is a false statement about the one
  // write in this product that cannot be undone.
  //
  // It reads the QUERY LAYER rather than the route file: the route says
  // `NextResponse.json(r)` with no object literal for `envelopeKeys` to find, so
  // the field list only exists at `postEntry`'s declared return type. That is
  // asserted at compile time by `_PostKeys` below; what THIS case adds is the
  // runtime half — that the route still hands the query layer's object over
  // whole rather than picking fields out of it.
  //
  // Mutation watched (2026-08-19): changed the route's `return
  // NextResponse.json(r)` to `NextResponse.json({ number: r.number })`. RED,
  // naming the spread. Restored.
  it('the post route hands the query layer\'s answer over WHOLE', () => {
    const src = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/entries/[number]/post/route.ts'),
      'utf8'
    )
    expect(src, 'the post route is gone — this case is stale').toContain('postEntry')
    expect(
      /const r = await postEntry\([\s\S]*?return NextResponse\.json\(r\)/.test(src),
      'the post route no longer answers with postEntry\'s object unchanged — ' +
        '`already` may have been dropped, and every re-post would then read as a fresh post'
    ).toBe(true)
  })

  // ── AND THE 0004 TRANSLATION THAT HAS NEVER FIRED ──────────────────────
  // The same route means to turn migration 0004's deferred guard into
  // `guard_refused`. It cannot: under drizzle-orm 0.45 a failure raised at COMMIT
  // arrives as a `DrizzleQueryError` whose `message` is `Failed query: COMMIT`,
  // and the guard's own sentence is on `.cause`. Verified 2026-08-19 by building
  // an entry with two MAPPED, UNBALANCED lines and posting it: 500
  // `internal_error` on both the web form and `bk books entry post`, while psql
  // on the same statements answers "entry 1272 does not balance: debit 77.00 <>
  // credit 99.00".
  //
  // **This asserts the DEFECT, not the fix**, because the fix is a route and
  // routes are the backend's. What it buys is that the day the route starts
  // reading `e.cause`, this case goes red and whoever is here next is told to
  // delete the workaround in `<PostEntryForm>` rather than leaving a
  // self-described stopgap in the tree forever. A stopgap nothing watches is how
  // one becomes permanent.
  it('the post route still reads `e.message` — so `guard_refused` cannot fire (backend ask)', () => {
    const src = readFileSync(
      join(APP_ROOT, 'app/api/workspaces/[ws]/entries/[number]/post/route.ts'),
      'utf8'
    )
    expect(src, 'the guard translation is gone entirely — this case is stale').toContain(
      'guard_refused'
    )
    // ── THE PATTERN IS `.cause`, NOT `e.cause`, AND THAT MATTERED ────────
    // Written as `/e\.cause/` first and watched: mutating the route to
    // `String((e as {cause?: unknown}).cause ?? e.message)` — a realistic
    // spelling of the fix, because `unknown` needs the cast — left this GREEN.
    // The character before `.cause` was `)`, not `e`. **The granularity of a
    // text scan is part of what it checks**, which is CLAUDE.md finding #11 in
    // one character. It matches the property access itself now.
    const readsCause = /\.cause\b/.test(src)
    expect(
      readsCause,
      'the post route now reads `e.cause`, so migration 0004\'s refusal may finally reach the ' +
        'client. Try it (an entry with two mapped, unbalanced lines), and if `guard_refused` ' +
        'now arrives as a 400, DELETE the `refusal.status === 500` block in ' +
        'components/post-entry-form.tsx and its header section — it exists only for this defect.'
    ).toBe(false)
  })

  // The pièces list IS a list route, and that is worth pinning for the same
  // reason in reverse: `usePieces` uses `apiList`, so a route that moved OFF
  // the shared envelope would make the inbox permanently empty.
  //
  // ── AND THIS CASE WAS INERT WHEN IT WAS FIRST WRITTEN ──────────────────
  // It asserted `route.includes('jsonList')`. Replacing the RETURN with
  // `NextResponse.json(rows)` left the suite 29/29 GREEN, because the file
  // still says `import { Errors, jsonList } from '@blackcode/platform-api'` at
  // the top and the substring was satisfied by the import. The check could see
  // that the identifier was in the file and not that anything called it —
  // CLAUDE.md finding #4's mechanism, in a guard written the same hour as this
  // comment and found by running the mutation rather than by reading it.
  //
  // It matches the RETURN now.
  //
  // Mutation watched (2026-08-18), twice: `return jsonList(` →
  // `return NextResponse.json(`. Green on the first version, RED on this one.
  it('the pièces list IS the list envelope', () => {
    const route = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/pieces/route.ts'), 'utf8')
    expect(route, 'the pièces route is gone — this case is stale').toContain('listPieces')
    expect(
      /return\s+jsonList\(/.test(route),
      'the pièces list left {data, next_cursor} and usePieces still calls apiList — ' +
        'the inbox would render empty over a workspace with documents in it'
    ).toBe(true)
  })

  // ===========================================================================
  // THE SEVEN ROUTES THAT BUILD THEIR OWN ENVELOPE — cleanup phase, 2026-08-18
  // ===========================================================================
  // `bilan`, `compte-resultat`, `overview`, `worklist`, `sources/{number}`,
  // `invitations` and `invitations/{id}` have no `public*` function to import,
  // so until now this file could not see them AT ALL. The first three are the
  // statement payloads — the most consequential JSON in this product.
  //
  // ── THIS IS NOT ONE TECHNIQUE, IT IS THREE, AND THE CHOICE IS THE POINT ──
  //   1. **Call the shaping path.** `bilanFor` and `crFor` are pure exported
  //      functions and `getBilan`/`getCr` do nothing but feed them database
  //      rows, so the statement payloads can be produced FOR REAL here. That is
  //      strictly better than reading source text and it is used wherever it is
  //      possible.
  //   2. **`Mutual` at compile time**, against the query layer's own exported
  //      interface — `derive.BilanResult`, `derive.CrResult`,
  //      `statutory.OverviewBook`, `invitations.InvitationRow`. This is the half
  //      that catches a field appearing or disappearing, and it is the half that
  //      found `worklist` on the overview (see `_OverviewKeys`).
  //   3. **`envelopeKeys` source read**, for the one fact neither of the above
  //      can reach: what the route WRAPS the result in. A payload spread flat
  //      and the same payload nested one level down are the same function, the
  //      same type and a blank screen.
  //
  // Every case below states which of the three it is and what it cannot see.

  // --- bilan ---------------------------------------------------------------
  //
  // Mutation watched (2026-08-18): deleted `ecart` from `bilanFor`'s return.
  // RED here naming it, and red at typecheck on `_BilanKeys`. Restored.
  // Then `related: !!l.related` → removed. Red on the nested line assertion.
  it('bilanFor produces exactly the bilan fields, and every statutory line is whole', () => {
    // This CALLS the real derivation — technique 1. An empty book is the right
    // input: the statutory structure is fixed by art. 959a, so the line list
    // does not depend on the data, and using no data means this case cannot
    // accidentally become a test of the seed.
    const out = bilanFor([], [], new Map())

    expect(Object.keys(out).sort()).toEqual(
      ['groups', 'totalActif', 'totalPassif', 'resultat', 'balanced', 'ecart'].sort()
    )

    // Anti-vacuous, and not only that: a zero-amount statutory line is legally
    // REQUIRED to be here (`absent !== zero`), so an empty `groups` would be
    // both a stale test and a wrong bilan.
    expect(out.groups.length, 'no statutory groups — art. 959a structure is gone').toBeGreaterThan(0)
    const lines = out.groups.flatMap((g) => g.lines)
    expect(lines.length, 'no statutory lines — see `lib/statements.ts`').toBeGreaterThan(0)

    for (const g of out.groups) expect(Object.keys(g).sort()).toEqual(['group', 'lines', 'side'])
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(['amount', 'pos', 'related'])
  })

  // Technique 3 — the one thing calling `bilanFor` cannot tell you.
  //
  // Mutation watched (2026-08-18): `...bilan` → `bilan`. Red, printing the key
  // list it found. That edit compiles, typechecks, and moves every figure on
  // the balance-sheet screen one level down; `useBilan` reads `data.groups` and
  // would render a statement with no lines in it.
  it('the bilan route SPREADS the derivation, and echoes the book and year', () => {
    const src = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/bilan/route.ts'), 'utf8')
    expect(src, 'the bilan route no longer calls getBilan — this case is stale').toContain('getBilan')
    const keys = envelopeKeys(src, { label: 'bilan' })
    expect(keys.length, 'found no envelope keys — the response moved').toBeGreaterThan(0)
    expect(keys.sort()).toEqual(['...bilan', 'entity', 'exercice'].sort())
  })

  // --- compte de résultat --------------------------------------------------
  //
  // Mutation watched (2026-08-18): dropped `accounts` from `crFor`'s `out.push`.
  // RED here naming it — and that field is the CR's whole drill-down: without
  // it every line on the income statement stops being clickable into the ledger
  // and nothing throws.
  it('crFor produces exactly the CR fields, and every line carries its accounts', () => {
    const out = crFor([], [])
    expect(Object.keys(out).sort()).toEqual(['lines', 'resultat'].sort())
    expect(out.lines.length, 'no CR lines — art. 959b structure is gone').toBeGreaterThan(0)
    for (const l of out.lines) {
      expect(Object.keys(l).sort()).toEqual(['accounts', 'amount', 'pos', 'sign'])
      expect(Array.isArray(l.accounts), '`accounts` stopped being an array').toBe(true)
    }
  })

  // Mutation watched (2026-08-18): `...cr` → `cr`. Red.
  it('the compte-resultat route SPREADS the derivation, and echoes the book and year', () => {
    const src = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/compte-resultat/route.ts'), 'utf8')
    expect(src, 'the CR route no longer calls getCr — this case is stale').toContain('getCr')
    const keys = envelopeKeys(src, { label: 'compte-resultat' })
    expect(keys.length, 'found no envelope keys — the response moved').toBeGreaterThan(0)
    expect(keys.sort()).toEqual(['...cr', 'entity', 'exercice'].sort())
  })

  // --- overview ------------------------------------------------------------
  //
  // The row shape is pinned at COMPILE time by `_OverviewKeys` below, against
  // `getOverview`'s own exported interface — and that assertion is the one that
  // found this phase's first drift: the route serves `worklist` (unrecognized
  // AND inferred, the count `bk books overview` prints under TO RESOLVE) and
  // `lib/types.ts` declared only `unrecognized`, which the rollup panel was
  // labelling "Need a human". Seeded blackcode: 2 against 3.
  //
  // Mutation watched (2026-08-18): deleted `staged` from `OverviewBook` in
  // `lib/db/queries/statutory.ts`. Red at typecheck on `_OverviewKeys`.
  it('the overview route serves {books} and nothing beside it', () => {
    const src = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/overview/route.ts'), 'utf8')
    expect(src, 'the overview route no longer calls getOverview').toContain('getOverview')
    const keys = envelopeKeys(src, { label: 'overview' })
    expect(keys.length, 'found no envelope keys — the response moved').toBeGreaterThan(0)
    // Mutation watched (2026-08-18): `NextResponse.json({ books })` →
    // `NextResponse.json({ data: books, next_cursor: null })`, i.e. the route
    // moved onto the shared list envelope. Red, printing `['data','next_cursor']`
    // against `['books']`. That is the failure worth catching: `useOverview`
    // reads `data.books`, would get `undefined`, and `rollup([])` would report a
    // workspace holding three books as having none — the phase-1 failure exactly,
    // with nothing thrown.
    expect(keys).toEqual(['books'])
  })

  // --- worklist ------------------------------------------------------------
  //
  // The envelope already had a case above (`the worklist envelope is not the
  // list envelope`), which asserts it is NOT `{data, next_cursor}` by matching
  // the return with a regex. This adds the other half: that the four keys it
  // serves are the four `WorklistResult` declares, extracted rather than
  // pattern-matched.
  //
  // ── AND IT ASSERTS THE SET, NOT THE ORDER, FOR A MEASURED REASON ────────
  // Two mutations were watched here on 2026-08-18 and the pair is the argument
  // for this case existing beside the regex one rather than instead of it:
  //
  //   deleted `count: rows.length,`   → BOTH red. The regex loses its `count:`
  //                                     and this case loses a key.
  //   REORDERED the four keys, same    → the regex case RED, this one green.
  //   payload, byte-for-byte identical
  //   response
  //
  // The second is a legitimate edit that breaks nothing, and a check that fails
  // on it is a check somebody deletes within a month — which is the README's own
  // warning about snapshots, arriving through a regex instead. So the regex case
  // keeps the job it is good at (proving the route did not move onto
  // `jsonList`) and this one carries the key set.
  it('the worklist envelope is exactly the four keys WorklistResult declares', () => {
    const src = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/worklist/route.ts'), 'utf8')
    const keys = envelopeKeys(src, { label: 'worklist' })
    expect(keys.length, 'found no envelope keys — the response moved').toBeGreaterThan(0)
    expect(keys.sort()).toEqual(['count', 'entity', 'exercice', 'rows'].sort())
  })

  // --- sources/{number} ----------------------------------------------------
  //
  // Technique 1 again, and it is available here in a way it is not for the
  // statements: the route's payload is a COMPOSITION of three pure functions
  // this file already imports, so the whole thing can be built for real.
  //
  // ── A MUTATION THAT NOTHING HERE CAUGHT, RECORDED RATHER THAN HIDDEN ────
  // Watched (2026-08-18): `runbook: runbook ? publicRunbook(runbook) : null` →
  // `runbook: publicRunbook(runbook!)`. **GREEN, 38/38** — this case, the
  // envelope case below it, and `npm run typecheck`, all three. A key-set check
  // sees `runbook` either way and the non-null assertion silences the compiler.
  //
  // It is not a hypothetical: seeded sources #4 and #9 have no runbook, so that
  // edit is a crash on two of nine rows of the sources register. What would
  // catch it is a check that calls the ROUTE, which this file cannot do, and it
  // is in the report as a backend finding rather than papered over with a text
  // match for the ternary — a guard that asserts the shape of the code rather
  // than the shape of the answer breaks on every legitimate rewrite.
  //
  // ── AND THE FIRST MUTATION TRIED FOR THIS CASE LEFT IT GREEN ────────────
  // Deleting `layer` from `publicSource` failed the `publicSource` case above
  // and left this one GREEN — correctly, and worth understanding before
  // trusting it. Both sides of the comparison here are computed from
  // `publicSource`, so they move together on purpose: this case is not a second
  // copy of that key list, it is the claim that the DETAIL is the register row
  // plus exactly `pulls` and `runbook`, whatever that row happens to be.
  //
  // Mutation that does make it red, watched (2026-08-18): added
  // `pulls: s.pulls ?? null` to `publicSource`. Red here AND on the case above
  // — and the two failures say different things. The one above says the
  // register row changed; this one says the register row now COLLIDES with what
  // the detail route spreads over it, so `GET /sources/{n}` would answer with
  // the file list under a key that also means a column, and the register and
  // the detail would disagree about the same source with nothing thrown.
  it('the source detail payload is a Source spread FLAT, plus pulls and runbook', () => {
    const detail = {
      ...publicSource(
        row({ seq: 1, name: 'WIR Bank', type: 'bank', expected: 'weekly', last_import: '2026-08-07', retired: false, ledger_accounts: ['1020'] }),
        '2026-08-18',
        'blackcode'
      ),
      pulls: [publicPull(row({ file: 'x.csv' }))],
      runbook: publicRunbook(row({ version: '1' })),
    }
    // Anti-vacuous, and the load-bearing assertion of this case: the detail is
    // the register row plus EXACTLY two keys. `publicSource` is pinned field by
    // field further up, so counting against it rather than against a literal
    // means adding a source field does not fail this case — the point is that
    // the two payloads cannot drift apart, not that either is frozen.
    const registerKeys = Object.keys(
      publicSource(row({ seq: 1, ledger_accounts: [] }), '2026-08-18', null)
    )
    expect(registerKeys.length, 'publicSource returned nothing — this case is vacuous').toBeGreaterThan(3)
    expect(Object.keys(detail).sort()).toEqual([...registerKeys, 'pulls', 'runbook'].sort())

    // And neither addition may collide with a field the register row already
    // has: a `pulls` column on `books.source` would be silently overwritten by
    // the spread order, and the register and the detail would disagree about
    // the same source with nothing thrown.
    expect(registerKeys).not.toContain('pulls')
    expect(registerKeys).not.toContain('runbook')
    // The register row is NOT nested under a `source` key. `useSource` reads
    // `data.name` and `data.status` directly, and one extra level would blank
    // the header of the screen while `pulls` kept rendering.
    expect('source' in detail, 'the source row is nested — useSource reads it flat').toBe(false)
  })

  // Mutation watched (2026-08-18): `...publicSource(...)` → `source: publicSource(...)`.
  // Red, printing `['source','pulls','runbook']` against the expected set.
  it('the source detail route spreads publicSource rather than nesting it', () => {
    const src = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/sources/[number]/route.ts'), 'utf8')
    expect(src, 'the source detail route no longer calls publicSource').toContain('publicSource')
    // Anchored to the GET since phase 4A gave this file a PATCH too: unanchored,
    // the reader walks the file's LAST response, which is now the edit
    // confirmation — the invitations case's bug, one merge later.
    const keys = envelopeKeys(src, { after: 'export const GET', label: 'sources/{number} GET' })
    expect(keys.length, 'found no envelope keys — the response moved').toBeGreaterThan(0)
    expect(keys.sort()).toEqual(['...publicSource', 'pulls', 'runbook'].sort())
  })

  // --- invitations ---------------------------------------------------------
  //
  // ── THESE TWO ROUTES HAVE NO `lib/types.ts` COUNTERPART, BY DECISION ─────
  // D-C: the word "workspace" never appears in this UI, there is no members
  // page and no invite flow, so no screen reads either route and there is
  // nothing in `lib/types.ts` to assert them against. That is the honest state
  // and it is what this case pins — including the absence, because if a screen
  // ever does appear the type has to appear with it rather than being typed
  // inline at the call site.
  //
  // What is pinned instead is the contract `bk books invite list/send/revoke`
  // reads, and the two facts about it that a screen would get wrong first: the
  // listing IS `{data, next_cursor}` (unlike the worklist), and `accept_url` is
  // part of the CREATE response because this app sends no email — a link
  // nobody can copy is not a delivery mechanism.
  //
  // Mutations watched (2026-08-18), four: deleted `next_cursor: null` from the
  // GET (red); deleted `accept_url` from the POST (red, naming it); appended
  // `export interface Invitation { id: number }` to `lib/types.ts` (red, on the
  // D-C assertion at the bottom); changed the DELETE to `{ deleted: 1 }`
  // (GREEN — a real hole, recorded below rather than patched).
  it('the invitations routes serve the envelopes bk reads, and no screen reads them', () => {
    const list = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/invitations/route.ts'), 'utf8')
    const one = readFileSync(join(APP_ROOT, 'app/api/workspaces/[ws]/invitations/[id]/route.ts'), 'utf8')
    expect(list, 'the invitations route stopped calling listInvitations').toContain('listInvitations')
    expect(one, 'the revoke route stopped calling revokeInvitation').toContain('revokeInvitation')

    const listed = envelopeKeys(list, { after: 'export const GET', label: 'invitations GET' })
    const created = envelopeKeys(list, { after: 'export const POST', label: 'invitations POST' })
    const revoked = envelopeKeys(one, { after: 'export const DELETE', label: 'invitations DELETE' })
    expect(listed.length + created.length + revoked.length, 'found no envelope keys at all').toBeGreaterThan(0)

    expect(listed.sort()).toEqual(['data', 'next_cursor'].sort())
    expect(created.sort()).toEqual(['accept_url', 'email_sent', 'invitation'].sort())
    expect(revoked).toEqual(['deleted'])

    // ── WHAT THIS CASE CANNOT ASK ──────────────────────────────────────────
    // It reads KEYS, not values, so `{ deleted: 1 }` passes. That is a real
    // hole and it is left open on purpose rather than patched with a text
    // match: the shape it would catch is checked where it belongs, by
    // `lib/cli-parity.test.ts` and by `bk books invite revoke` itself. What is
    // NOT checked anywhere is `InvitationRow`'s field list, which is why the
    // compile-time `_InvitationKeys` below exists.
    //
    // And it asserts the absence D-C decided: no screen reads these, so
    // `lib/types.ts` declares nothing for them.
    const types = readFileSync(join(APP_ROOT, 'lib/types.ts'), 'utf8')
    expect(
      /export interface Invitation\b/.test(types),
      'lib/types.ts now declares an Invitation — a screen is reading these routes, ' +
        'and D-C (no members page, no invite flow, the word "workspace" never on screen) ' +
        'says that is a decision to make deliberately, not a type to add quietly'
    ).toBe(false)
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
type SourceWire = ReturnType<typeof publicSource>
type PullWire = ReturnType<typeof publicPull>
type RunbookWire = ReturnType<typeof publicRunbook>
type ManifestWire = ReturnType<typeof publicManifestRow>
type PieceWire = ReturnType<typeof publicPiece>

/**
 * The KEY SETS, at compile time.
 *
 * This is the half that catches a field appearing or disappearing without
 * anybody running the suite — `npm run typecheck` alone is enough.
 */
type _EntityKeys = Mutual<keyof EntityWire, keyof Entity>
type _AccountKeys = Mutual<keyof AccountWire, keyof Account>
/**
 * The fiscal year.
 *
 * ── ITS TYPE DOES NOT LIVE IN `lib/types.ts`, AND THAT IS WHY IT WAS MISSED ──
 * `ExerciceRow` is declared in `lib/hooks.ts` beside the hook that reads it, so
 * it was outside every list in this file until 2026-08-18 — it had the runtime
 * key case above and no type assertion at all.
 *
 * ── AND IT IS A KEY ASSERTION ONLY, WHICH IS LESS THAN IT LOOKS ───────────
 * Mutation watched (2026-08-18), the one that mattered: widened
 * `ExerciceRow.status` from `'open' | 'closed'` to `string`. **GREEN.** It
 * cannot fire — `publicExercice` reads a `varchar`, so the wire type is already
 * `string`, and the union is a claim WE make on top of it. That is the same
 * reason the file header gives for keeping the enum-ish fields out of
 * `_Scalars`, and it means a third exercice state added server-side would still
 * fall silently into this app's `open` branch. Recorded so the next reader does
 * not mistake this for coverage it has not got.
 *
 * Mutation watched that DOES fire: deleted `ends_on` from `ExerciceRow`. Red at
 * typecheck on `_ExerciceKeys`, which is the drift this closes — the exercice
 * picker prints those bounds.
 */
type ExerciceWire = ReturnType<typeof publicExercice>
type _ExerciceKeys = Mutual<keyof ExerciceWire, keyof ExerciceRow>
type _EntryKeys = Mutual<keyof EntryWire, keyof Entry>

/**
 * The SIMPLIFIED book's journal — the second shape `GET …/entries` serves.
 *
 * ── IT HAD NO TYPE AT ALL UNTIL 2026-08-19 ────────────────────────────────
 * `publicRiEntry` has had a runtime key-set case above since the RI journal
 * existed, and `lib/types.ts` had no counterpart to be assignable to — so the
 * half that catches a TYPE change had nothing to compare. That gap was
 * survivable while no screen read the payload. Phase 4A made the ledger read it,
 * and the first thing that reading found was that the app had been rendering
 * these rows as `Entry`: `entry_no`, `status` and `lines` all `undefined`, four
 * blank cells, "This entry has no lines." over six movements, and the amount —
 * the only number an RI row carries — nowhere on the screen.
 *
 * `RiEntry` exists now and this is what holds it to the wire. Both halves
 * matter and neither subsumes the other: the runtime case sees a field appear or
 * vanish, this sees `amount` stop being a string.
 *
 * Mutation watched (2026-08-19): deleted `category` from `RiEntry`. Red at
 * typecheck on `_RiEntryKeys`, naming it. Then changed `amount: Money` to
 * `amount: number`. Red on `_RiScalars` below. Both restored.
 */
type RiEntryWire = ReturnType<typeof publicRiEntry>
type _RiEntryKeys = Mutual<keyof RiEntryWire, keyof RiEntry>

/**
 * The POST response, pinned against the query layer's declared return type.
 *
 * There is no `publicPost` — the route answers with `postEntry`'s object — so
 * the reference point is that function's signature, the same weaker-but-real
 * arrangement `_OverviewKeys` and `_BilanKeys` use. The runtime case above
 * proves the route still hands it over whole.
 *
 * **`already` is the field to watch.** `<PostEntryForm>` renders it as "already
 * posted" rather than as a failure, because the route is idempotent so that the
 * Companion can retry; a payload that lost it would make every re-post read as a
 * fresh post, on the one write that cannot be undone.
 *
 * Mutation watched (2026-08-19): dropped `already` from `PostResult`. Red at
 * typecheck, naming it. Restored.
 */
type PostWire = Awaited<ReturnType<typeof postEntry>>
type _PostKeys = Mutual<keyof PostWire, keyof PostResult>
type _PatrimoineKeys = Mutual<keyof PatrimoineWire, keyof PatrimoineSnapshot>
type _VatKeys = Mutual<keyof EntityWire['vat'], keyof Entity['vat']>
type _RuleKeys = Mutual<keyof RuleWire, keyof RecognitionRule>
// ── PHASE 3 ────────────────────────────────────────────────────────────────
type _SourceKeys = Mutual<keyof SourceWire, keyof Source>
type _WindowKeys = Mutual<keyof SourceWire['windows'], keyof Source['windows']>
type _PullKeys = Mutual<keyof PullWire, keyof SourcePull>
type _RunbookKeys = Mutual<keyof RunbookWire, keyof SourceRunbook>
type _ManifestKeys = Mutual<keyof ManifestWire, keyof ManifestFile>
type _PieceKeys = Mutual<keyof PieceWire, keyof InboxPiece>
type _PieceSourceKeys = Mutual<keyof PieceWire['source'], keyof InboxPiece['source']>
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

// ── THE SEVEN INLINE ROUTES, AT COMPILE TIME — cleanup phase, 2026-08-18 ───
// None of these has a `public*` function, so the wire type is the QUERY LAYER's
// own exported interface. That is a weaker reference point than a shaping
// function — it is a declaration rather than a value — but it is not a
// hand-written list, and `getOverview`, `bilanFor`, `crFor` and
// `listInvitations` all return it, so a field that stops being produced fails at
// its own definition rather than here.
type BilanWire = ReturnType<typeof bilanFor>
type CrWire = ReturnType<typeof crFor>
type OverviewWire = OverviewBookWire
type InvitationWire = InvitationRow

/**
 * The bilan and the CR, plus the two keys their ROUTES add.
 *
 * The envelope is written into the assertion rather than asserted separately,
 * because `entity` and `exercice` are not optional decoration: they are what the
 * server RESOLVED, and a screen that shows a statement without them cannot tell
 * a defaulted book from the one it asked for. `envelopeKeys` above proves the
 * route still adds them; this proves `lib/types.ts` still expects them.
 */
type _BilanKeys = Mutual<keyof BilanWire | 'entity' | 'exercice', keyof BilanResultType>
type _BilanGroupKeys = Mutual<keyof BilanWire['groups'][number], keyof BilanGroupResult>
type _BilanLineKeys = Mutual<keyof BilanWire['groups'][number]['lines'][number], keyof BilanLineResult>
type _CrKeys = Mutual<keyof CrWire | 'entity' | 'exercice', keyof CrResultType>
type _CrLineKeys = Mutual<keyof CrWire['lines'][number], keyof CrLineResult>

/**
 * The overview row.
 *
 * ── THIS IS THE ASSERTION THAT FOUND THE CLEANUP PHASE'S FIRST DRIFT ──────
 * `getOverview` has served `worklist` — unrecognized AND inferred, which is the
 * count `bk books overview` prints under TO RESOLVE — since phase 2, and
 * `lib/types.ts` declared only `unrecognized`, which is strictly the first of
 * the two states. So the rollup panel labelled a number "Need a human" that
 * excluded every inferred row: 2 where `bk` said 3, on the seeded blackcode
 * book, from the same database in the same second.
 *
 * Neither key set nor typecheck could see it, because the field the wire gained
 * was simply absent from our type and TypeScript does not mind a payload having
 * more than you asked for. `Mutual` minds, in both directions, which is the
 * whole reason it is written that way.
 */
type _OverviewKeys = Mutual<keyof OverviewWire, keyof OverviewBook>
type _OverviewEnvelope = Mutual<'books', keyof OverviewResult>
type _WorklistEnvelopeKeys = Mutual<'entity' | 'exercice' | 'count' | 'rows', keyof WorklistResult>
type _SourceDetailKeys = Mutual<keyof SourceWire | 'pulls' | 'runbook', keyof SourceDetail>

/**
 * `InvitationRow` — pinned with NO `lib/types.ts` counterpart, on purpose.
 *
 * D-C bars an invite flow from this UI, so there is nothing to be assignable
 * to. What this asserts is that the interface still carries the four fields the
 * route's answer is useless without — and `token` above all, which is why the
 * listing is owner-only: it is redeemable access, in the clear, by design
 * (`lib/db/queries/invitations.ts` explains why it is not hashed).
 *
 * If a screen ever reads these routes, replace this with a real `Mutual`
 * against a declared type. Leaving it as a presence check would then be the
 * vacuous half of a real difference.
 */
type _InvitationKeys = Mutual<
  'id' | 'email' | 'role' | 'token' | 'status' | 'expires_at' | 'created_at' | 'invited_by_name' | 'invited_by_email',
  keyof InvitationWire
>

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
  // ── THE NESTED `piece` FIELDS, ADDED 2026-08-18 AFTER A WHITE SCREEN ────
  // `piece` was in ENTRY_KEYS and its INSIDE was checked by nothing. Both
  // columns are nullable and `lib/types.ts` declared both non-null, which was
  // unreachable while every pièce came from the seed and became reachable the
  // moment phase 3's `match` write could attach one with a NULL checksum.
  // `<DriveLink>` called `.slice()` on it and the entry page went blank.
  //
  // Mutation watched: restored `hash: string` in `lib/types.ts`. Red at
  // typecheck, naming the field. The nested object is a different assertion
  // from its parent key, and that is the whole lesson here.
  Mutual<NonNullable<EntryWire['piece']>['drive_ref'], NonNullable<Entry['piece']>['drive_ref']>,
  Mutual<NonNullable<EntryWire['piece']>['hash'], NonNullable<Entry['piece']>['hash']>,
  Mutual<NonNullable<EntryWire['piece']>['captured'], NonNullable<Entry['piece']>['captured']>,

  // ── THE SIMPLIFIED JOURNAL, ADDED 2026-08-19 WITH ITS FIRST READER ─────
  // `amount` is the one that would bite: it is a `numeric(14,2)` and arrives as
  // a STRING, exactly like `fte_count` and `tva.rate` above, both of which were
  // declared as numbers and both of which are in this list because of it. It is
  // also the ONLY number an RI movement carries, so getting it wrong is not a
  // formatting slip — it is the whole row.
  //
  // `direction` is deliberately NOT here. The column is a `varchar`, so the wire
  // type is `string`, and `RiDirection` is a narrowing WE make on top of a CHECK
  // constraint — the same reason `recognition` and `evidence_tier` are absent.
  // `_ExerciceKeys`'s note above says what that costs: a fourth direction added
  // server-side would fall silently into whatever branch reads it, which is why
  // the ledger renders the server's word rather than switching on it.
  Mutual<RiEntryWire['number'], RiEntry['number']>,
  Mutual<RiEntryWire['date'], RiEntry['date']>,
  Mutual<RiEntryWire['amount'], RiEntry['amount']>,
  Mutual<RiEntryWire['raw_label'], RiEntry['raw_label']>,
  Mutual<RiEntryWire['counterparty'], RiEntry['counterparty']>,
  Mutual<NonNullable<RiEntryWire['piece']>['drive_ref'], NonNullable<RiEntry['piece']>['drive_ref']>,
  Mutual<NonNullable<RiEntryWire['piece']>['hash'], NonNullable<RiEntry['piece']>['hash']>,
  Mutual<NonNullable<RiEntryWire['piece']>['captured'], NonNullable<RiEntry['piece']>['captured']>,

  // ── THE POST RESPONSE ─────────────────────────────────────────────────
  // `already` is a BOOLEAN and `<PostEntryForm>` tests it as one. If it ever
  // became `boolean | undefined` the form's `already === true` would quietly
  // start reading every re-post as a fresh post.
  Mutual<PostWire['number'], PostResult['number']>,
  Mutual<PostWire['entry_no'], PostResult['entry_no']>,
  Mutual<PostWire['already'], PostResult['already']>,

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
  // Pièces only — entry #numbers this document could prove.
  Mutual<WorklistRowWire['suggested_entries'], WorklistRow['suggested_entries']>,

  // ── PHASE 3 ────────────────────────────────────────────────────────────
  Mutual<SourceWire['number'], Source['number']>,
  Mutual<SourceWire['name'], Source['name']>,
  Mutual<SourceWire['type'], Source['type']>,
  Mutual<SourceWire['layer'], Source['layer']>,
  Mutual<SourceWire['entity'], Source['entity']>,
  Mutual<SourceWire['method'], Source['method']>,
  Mutual<SourceWire['expected'], Source['expected']>,
  Mutual<SourceWire['last_import'], Source['last_import']>,
  Mutual<SourceWire['retired'], Source['retired']>,
  Mutual<SourceWire['ledger_accounts'], Source['ledger_accounts']>,
  // The two computed ones. `status` is a UNION on both sides deliberately: it
  // is what the screens decide layout from, so a state the server adds must
  // fail the build rather than fall into an `else`.
  Mutual<SourceWire['status'], Source['status']>,
  Mutual<SourceWire['windows']['stale_after_days'], Source['windows']['stale_after_days']>,
  Mutual<SourceWire['windows']['gap_after_days'], Source['windows']['gap_after_days']>,

  Mutual<PullWire['file'], SourcePull['file']>,
  Mutual<PullWire['period'], SourcePull['period']>,
  Mutual<PullWire['format'], SourcePull['format']>,
  Mutual<PullWire['hash'], SourcePull['hash']>,
  Mutual<PullWire['drive_ref'], SourcePull['drive_ref']>,
  Mutual<PullWire['pulled'], SourcePull['pulled']>,

  Mutual<RunbookWire['version'], SourceRunbook['version']>,
  Mutual<RunbookWire['updated'], SourceRunbook['updated']>,
  Mutual<RunbookWire['login_url'], SourceRunbook['login_url']>,
  // A vault reference, and a string. Never a secret; see SourceRunbook.
  Mutual<RunbookWire['credential_ref'], SourceRunbook['credential_ref']>,
  Mutual<RunbookWire['output'], SourceRunbook['output']>,

  Mutual<ManifestWire['file_id'], ManifestFile['file_id']>,
  Mutual<ManifestWire['name'], ManifestFile['name']>,
  Mutual<ManifestWire['mime_type'], ManifestFile['mime_type']>,
  Mutual<ManifestWire['fetched'], ManifestFile['fetched']>,
  Mutual<ManifestWire['state'], ManifestFile['state']>,
  Mutual<ManifestWire['archived'], ManifestFile['archived']>,
  Mutual<ManifestWire['archive_ref'], ManifestFile['archive_ref']>,
  Mutual<ManifestWire['piece'], ManifestFile['piece']>,
  // `created_time` is DELIBERATELY absent from this list and asserted against
  // `Date` instead, in the case above: the column is a timestamp, so the
  // shaping function's type is `Date` while the wire — after JSON — is a
  // string. `lib/types.ts` declares the wire form, so the two cannot match and
  // pretending they do would be the vacuous half of a real difference.

  Mutual<PieceWire['number'], InboxPiece['number']>,
  Mutual<PieceWire['entity'], InboxPiece['entity']>,
  Mutual<PieceWire['status'], InboxPiece['status']>,
  Mutual<PieceWire['received'], InboxPiece['received']>,
  Mutual<PieceWire['pipeline'], InboxPiece['pipeline']>,
  Mutual<PieceWire['document_type'], InboxPiece['document_type']>,
  Mutual<PieceWire['merchant'], InboxPiece['merchant']>,
  // A STRING, like every other amount. `<Money>` has no numeric overload.
  Mutual<PieceWire['total'], InboxPiece['total']>,
  Mutual<PieceWire['date'], InboxPiece['date']>,
  Mutual<PieceWire['needs_review'], InboxPiece['needs_review']>,
  Mutual<PieceWire['duplicate_of'], InboxPiece['duplicate_of']>,
  Mutual<PieceWire['matched_entry'], InboxPiece['matched_entry']>,
  Mutual<PieceWire['matched_journal'], InboxPiece['matched_journal']>,
  Mutual<PieceWire['source']['file_id'], InboxPiece['source']['file_id']>,
  Mutual<PieceWire['source']['file_name'], InboxPiece['source']['file_name']>,
  Mutual<PieceWire['source']['md5_checksum'], InboxPiece['source']['md5_checksum']>,
  Mutual<PieceWire['source']['web_view_link'], InboxPiece['source']['web_view_link']>,
]

// Referencing them is what turns a `never` above into an error at THIS line,
// rather than leaving an unused type alias nobody sees.
//
// ── AN OBJECT, NOT AN ARRAY, AND THAT IS THE WHOLE POINT ───────────────────
// This was a positional tuple of twenty-five bare `true`s. When one alias
// resolved to `never`, TypeScript said:
//
//     wire-parity.test.ts(1366,N): Type 'true' is not assignable to type 'never'
//
// — and N is a COLUMN OFFSET into a row of identical literals. The comment above
// claimed the failing member was named; it was not, and the only way to find it
// was to count. Four mutations in the cleanup audit hit this, four times.
//
// Keyed by name, the compiler names the property instead, so the error says
// which contract drifted. Found 2026-08-18 by the reviewer whose job was to
// break each of these and read what came back.
const _keys: {
  _EntityKeys: _EntityKeys
  _AccountKeys: _AccountKeys
  _ExerciceKeys: _ExerciceKeys
  _EntryKeys: _EntryKeys
  _RiEntryKeys: _RiEntryKeys
  _PostKeys: _PostKeys
  _PatrimoineKeys: _PatrimoineKeys
  _VatKeys: _VatKeys
  _RuleKeys: _RuleKeys
  _WorklistKeys: _WorklistKeys
  _SourceKeys: _SourceKeys
  _WindowKeys: _WindowKeys
  _PullKeys: _PullKeys
  _RunbookKeys: _RunbookKeys
  _ManifestKeys: _ManifestKeys
  _PieceKeys: _PieceKeys
  _PieceSourceKeys: _PieceSourceKeys
  _BilanKeys: _BilanKeys
  _BilanGroupKeys: _BilanGroupKeys
  _BilanLineKeys: _BilanLineKeys
  _CrKeys: _CrKeys
  _CrLineKeys: _CrLineKeys
  _OverviewKeys: _OverviewKeys
  _OverviewEnvelope: _OverviewEnvelope
  _WorklistEnvelopeKeys: _WorklistEnvelopeKeys
  _SourceDetailKeys: _SourceDetailKeys
  _InvitationKeys: _InvitationKeys
} = {
  _EntityKeys: true,
  _AccountKeys: true,
  _ExerciceKeys: true,
  _EntryKeys: true,
  _RiEntryKeys: true,
  _PostKeys: true,
  _PatrimoineKeys: true,
  _VatKeys: true,
  _RuleKeys: true,
  _WorklistKeys: true,
  _SourceKeys: true,
  _WindowKeys: true,
  _PullKeys: true,
  _RunbookKeys: true,
  _ManifestKeys: true,
  _PieceKeys: true,
  _PieceSourceKeys: true,
  _BilanKeys: true,
  _BilanGroupKeys: true,
  _BilanLineKeys: true,
  _CrKeys: true,
  _CrLineKeys: true,
  _OverviewKeys: true,
  _OverviewEnvelope: true,
  _WorklistEnvelopeKeys: true,
  _SourceDetailKeys: true,
  _InvitationKeys: true,
}

const _scalars: _Scalars = [
  true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true,
  true, true, true, true, true, true, true, true, true, true, true, true,
  // the three nested `piece` fields
  true, true, true,
  // phase 4A: the simplified journal's five scalars and its three nested
  // `piece` fields, then the post response's three
  true, true, true, true, true,
  true, true, true,
  true, true, true,
  true, true, true, true, true,
  // phase 2: five rule fields, seven worklist fields (suggested_entries is
  // phase 3's piece column, pinned beside its sibling)
  true, true, true, true, true,
  true, true, true, true, true, true, true,
  // phase 3: thirteen source fields, six pull, five runbook, eight manifest,
  // sixteen pièce
  true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true,
  true, true, true, true, true,
  true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true,
]
void [_keys, _scalars]
