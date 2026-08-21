// The SEEDED DATABASE matches the mockup — totals to the rappen, and the
// exercice split accounted for line by line.
//
// ===========================================================================
// WHY THIS EXISTS WHEN parity.test.ts ALREADY DOES
// ===========================================================================
// `lib/derive/parity.test.ts` is PURE: fixture in, functions out. It proves the
// arithmetic and never touches Postgres, so nothing pinned the numbers the
// seeded database actually serves — that check was done by hand on 2026-08-17
// and a hand check does not survive the next change.
//
// This file reads through the real query layer, exactly as the routes do.
//
// ===========================================================================
// THE SPLIT, AND WHAT IS INVARIANT ACROSS IT
// ===========================================================================
// The seed puts blackcode's two 2025 entries in a CLOSED exercice 2025 and
// computes 2026's openings as that year's close (the reprise — seed.ts header).
// The mockup computed one statement over both years. So against the mockup's
// float reference, recomputed here:
//
//   INVARIANT   2026 bilan totals, every non-equity line, AIOS entirely, the RI
//   SHIFTED     résultat de l'exercice and résultat reporté, by exactly the
//               2025 result; the CR excludes the 2025 charges
//
// Every expectation below is DERIVED from the fixture, never hardcoded — except
// the three headline totals, pinned literally so drift in the fixture itself is
// loud too.
//
// Skips loudly without a database OR without the seeded workspace: "not seeded"
// and "verified" must never look the same.

import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fixture from '../../fixtures/mockup.json'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/seed-parity.test.ts SKIPPED: no DATABASE_URL. The seeded statements were NOT verified.\n')
}

// ---------------------------------------------------------------------------
// The reference, in floats, over the whole period — as the mockup computed it
// ---------------------------------------------------------------------------
interface FxTx { entity_id: number; date: string; status: string; lines: { account: string | null; debit: number; credit: number }[] }
interface FxAccount { no: string; class: number; statement: string; statement_position: string }

const FX = fixture as unknown as {
  ENTITIES: { id: number; slug: string; legal_form: string }[]
  ACCOUNTS: FxAccount[]
  TX: FxTx[]
  OPENING: Record<string, Record<string, number>>
  RI_ENTRIES: { direction: string; amount: number }[]
}

/** Debit-positive movement over the given transactions, posted only. */
function mov(tx: FxTx[], accountNo: string): number {
  let s = 0
  for (const t of tx) {
    if (t.status !== 'posted') continue
    for (const l of t.lines) if (l.account === accountNo) s += (l.debit || 0) - (l.credit || 0)
  }
  return s
}

/**
 * CR result over the given transactions: produits minus charges.
 *
 * No produit/charge branch, and that is arithmetic rather than an oversight: a
 * produit's amount is −movement (credit balance) and a charge's is +movement, so
 * résultat = Σ(−m, produits) − Σ(+m, charges) = −Σ movement over EVERY CR
 * account. One sign, applied uniformly.
 */
function crResult(tx: FxTx[]): number {
  let r = 0
  for (const a of FX.ACCOUNTS) {
    if (a.statement !== 'cr') continue
    r += -mov(tx, a.no)
  }
  return r
}

d('the seeded database', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let q: any
  let ws = 0
  let seeded = true

  beforeAll(async () => {
    const { getDb } = await import('./client')
    const { booksWorkspaces } = await import('./schema')
    const [row] = await getDb().select().from(booksWorkspaces).where(eq(booksWorkspaces.slug, 'blackcode'))
    if (!row) {
      seeded = false
      console.warn('\n  seed-parity SKIPPED: no workspace "blackcode". Run `npm run db:seed:books` first.\n')
      return
    }
    ws = row.id
    q = await import('./queries/statutory')
  })

  const ifSeeded = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!seeded) return
      await fn()
    })

  ifSeeded('gives blackcode a closed 2025 and an open 2026, others 2026 only', async () => {
    const entities = await q.listEntities(ws)
    expect(entities.map((e: { slug: string }) => e.slug)).toEqual(['blackcode', 'aios', 'ri'])
    for (const e of entities) {
      const years = await q.listExercices(ws, e.id)
      if (e.slug === 'blackcode') {
        expect(years.map((x: { year: number; status: string }) => `${x.year}:${x.status}`)).toEqual([
          '2026:open',
          '2025:closed',
        ])
        // Clean calendar windows: the old stretched-back 2026 is gone.
        expect(years[0].starts_on).toBe('2026-01-01')
      } else {
        expect(years.map((x: { year: number }) => x.year)).toEqual([2026])
      }
    }
  })

  ifSeeded('serves the mockup totals to the rappen on the 2026 bilan', async () => {
    const [bc] = await q.listEntities(ws)
    const [x2026] = await q.listExercices(ws, bc.id)
    const bilan = await q.getBilan(bc.id, x2026.id)

    // Whole-period reference: totals are INVARIANT under the split.
    const bcTx = FX.TX.filter((t) => t.entity_id === 1)
    let actif = 0
    for (const a of FX.ACCOUNTS) {
      if (a.statement !== 'bilan' || a.class !== 1) continue
      actif += (FX.OPENING.blackcode[a.no] || 0) + mov(bcTx, a.no)
    }
    expect(bilan.totalActif).toBe(actif.toFixed(2))
    expect(bilan.totalPassif).toBe(actif.toFixed(2))
    expect(bilan.balanced).toBe(true)
    // The literal pin, so fixture drift is loud as well.
    expect(bilan.totalActif).toBe('96489.43')
  })

  ifSeeded('allocates the 2025 result to the right lines, in both years', async () => {
    const [bc] = await q.listEntities(ws)
    const [x2026, x2025] = await q.listExercices(ws, bc.id)

    const tx2025 = FX.TX.filter((t) => t.entity_id === 1 && t.date < '2026-01-01')
    const txAll = FX.TX.filter((t) => t.entity_id === 1)
    const r25 = crResult(tx2025)
    const rAll = crResult(txAll)
    expect(r25, 'the fixture no longer has a 2025 result; rewrite this test').not.toBe(0)

    // 2025 stands alone and balances.
    const b25 = await q.getBilan(bc.id, x2025.id)
    expect(b25.balanced, `écart ${b25.ecart}`).toBe(true)
    expect(b25.resultat).toBe(r25.toFixed(2))

    // 2026 carries only its own year: résultat = whole-period minus 2025's, and
    // reporté = the opening constant plus the folded 2025 result.
    const b26 = await q.getBilan(bc.id, x2026.id)
    expect(b26.resultat).toBe((rAll - r25).toFixed(2))
    const line = (b: typeof b26, pos: string) =>
      b.groups.flatMap((g: { lines: { pos: string; amount: string }[] }) => g.lines).find((l: { pos: string }) => l.pos === pos)!.amount
    expect(line(b26, 'resultat_reporte')).toBe(((FX.OPENING.blackcode['2970'] || 0) + r25).toFixed(2))
  })

  ifSeeded("hands 2026 openings that ARE 2025's closing, line for line", async () => {
    const { getDb } = await import('./client')
    const { booksOpeningBalance } = await import('./schema')
    const [bc] = await q.listEntities(ws)
    const [x2026] = await q.listExercices(ws, bc.id)

    const rows = await getDb()
      .select()
      .from(booksOpeningBalance)
      .where(eq(booksOpeningBalance.exercice_id, x2026.id))
    const byAccount = new Map<string, string>(rows.map((r: { account_no: string; amount: string }) => [r.account_no, r.amount]))

    const tx2025 = FX.TX.filter((t) => t.entity_id === 1 && t.date < '2026-01-01')
    const r25 = crResult(tx2025)
    for (const a of FX.ACCOUNTS) {
      if (a.statement !== 'bilan') continue
      const o = FX.OPENING.blackcode[a.no] || 0
      const m = mov(tx2025, a.no)
      let closing = a.class === 2 ? o - m : o + m
      if (a.statement_position === 'resultat_reporte') closing += r25
      const got = byAccount.get(a.no) ?? '0.00'
      expect(got, `2026 opening of ${a.no}`).toBe(closing.toFixed(2))
    }
  })

  ifSeeded('leaves AIOS and the RI exactly on the mockup', async () => {
    const entities = await q.listEntities(ws)
    const aios = entities.find((e: { slug: string }) => e.slug === 'aios')!
    const [xa] = await q.listExercices(ws, aios.id)
    const ba = await q.getBilan(aios.id, xa.id)
    expect(ba.balanced).toBe(true)
    expect(ba.totalActif).toBe('63662.90')

    const { riTotals } = await import('../derive')
    const ri = entities.find((e: { legal_form: string }) => e.legal_form === 'RI')!
    const [xr] = await q.listExercices(ws, ri.id)
    const rows = await q.listRiEntries(ri.id, xr.id)
    const t = riTotals(rows.map((r: { direction: string; amount: string }) => ({ direction: r.direction, amount: r.amount })))
    const rec = FX.RI_ENTRIES.filter((e) => e.direction === 'recette').reduce((s, e) => s + e.amount, 0)
    const dep = FX.RI_ENTRIES.filter((e) => e.direction === 'depense').reduce((s, e) => s + e.amount, 0)
    expect(t.resultat).toBe((rec - dep).toFixed(2))
    expect(t.resultat).toBe('6391.00')
  })

  ifSeeded('carries the management layer: five buckets per SA book, cited parameters, two filed analyses', async () => {
    const m = await import('./queries/management')
    const entities = await q.listEntities(ws)
    const sa = entities.filter((e: { legal_form: string }) => e.legal_form !== 'RI')
    expect(sa.length).toBe(2)

    for (const e of sa) {
      const cats = await m.listCategories(e.id)
      expect(cats.map((c: { key: string }) => c.key), `${e.slug}'s buckets are the fixture's five`).toEqual([
        'personnel', 'bureau', 'it_ai', 'admin', 'autres',
      ])
      const params = await m.getTaxParams(e.id)
      expect(params?.canton).toBe('VD')
      expect(params?.commune).toBe('Renens')
      // The open question stands: capital tax ships UNCONFIRMED until the
      // fiduciary answers (decided with Mustneer, 2026-08-19), whatever the
      // fixture's own flag said next to its open_question.
      expect((params?.params as { capital_tax: { confirmed: boolean } }).capital_tax.confirmed).toBe(false)
      expect((params?.params as { ifd: { confirmed: boolean } }).ifd.confirmed).toBe(true)
    }

    // The journal is append-only AND live: using the product files more rows
    // (analysis #3 arrived through `bk books analyse record` the very day an
    // exact count first broke here). The seed's two are pinned by NUMBER and
    // content — a parity test must not turn "somebody used the product" into
    // a failure, and it must never demand a row's deletion to go green.
    const analyses = await m.listAnalyses(ws)
    expect(analyses.length).toBeGreaterThanOrEqual(3)

    // The shape-coverage record: bare strings everywhere, the door's other
    // legal shape (2026-08-19 — three readers choked on it in one day, all
    // shipped green against a seed that only ever spoke {fr, en}).
    const cover = analyses.find((a) => a.analysis.scenario_label === 'shape-coverage')
    expect(cover, 'the seed serves one bare-string analysis, permanently').toBeTruthy()
    const c = m.publicAnalysis(cover!)
    expect(typeof c.question, 'a bare-string question survives the wire as a string').toBe('string')
    expect(typeof c.verdict).toBe('string')
    expect(typeof (c.figures as { label: unknown }[])[0].label).toBe('string')
    expect(typeof (c.based_on as { label: unknown }[])[0].label).toBe('string')
    const first = m.publicAnalysis(analyses.find((a) => a.analysis.seq === 1)!)
    expect(first.entity).toBe('blackcode')
    expect(first.runway_after_months).toBe(6.9)
    expect((first.based_on as { value: string }[]).map((b) => b.value)[0], 'the snapshot exactly as the fixture filed it').toBe("CHF 1'806.67")
  })

  ifSeeded('the seeded analytique buckets agree with the fixture, recomputed', async () => {
    const m = await import('./queries/management')
    const [bc] = await q.listEntities(ws)
    const [x2026] = await q.listExercices(ws, bc.id)
    const r = await m.getAnalytique(bc, x2026)

    // The reference, in floats: per category, posted 2026 lines of entity 1.
    const FXC = (fixture as unknown as { ANALYTIQUE_CATEGORIES: { key: string; accounts: string[] }[] }).ANALYTIQUE_CATEGORIES
    for (const c of FXC) {
      let want = 0
      for (const t of FX.TX) {
        if (t.entity_id !== 1 || t.status !== 'posted' || t.date < '2026-01-01') continue
        for (const l of t.lines) if (l.account && c.accounts.includes(l.account)) want += (l.debit || 0) - (l.credit || 0)
      }
      const got = r.categories.find((x: { key: string }) => x.key === c.key)!
      expect(got.amount, `bucket ${c.key}`).toBe(want.toFixed(2))
    }
  })

  ifSeeded("flags the mockup's twin pièces: the EFT slip is a duplicate suspect of the receipt", async () => {
    // 9605 is the card slip of the SAME purchase 9601 documents — the
    // mockup's own data says `duplicate_of: 9601`, by same-date-same-total
    // similarity, not by checksum (different documents, same money). The
    // seed could never show this while dedupe was checksum-only (#53).
    const { getDb } = await import('./client')
    const rows = await getDb().execute(
      (await import('drizzle-orm')).sql`
        SELECT p.file_name, p.needs_review, dup.file_name AS dup_of
        FROM books.piece_inbox p
        LEFT JOIN books.piece_inbox dup ON dup.id = p.duplicate_of_id
        WHERE p.workspace_id = ${ws} AND p.file_name = 'Scanned_20260813-1546-04.jpg'`
    )
    expect(rows.rows.length).toBe(1)
    expect(rows.rows[0].dup_of, 'the slip points at the receipt').toBe('Scanned_20260813-1357.jpg')
    expect(rows.rows[0].needs_review, 'a suspect is a human call').toBe(true)
  })

  ifSeeded('numbers each journal from 1 within its own exercice', async () => {
    const [bc] = await q.listEntities(ws)
    const [x2026, x2025] = await q.listExercices(ws, bc.id)
    // `.rows` since #69: the page states its own total and cursor now.
    const e25 = (await q.listEntries(bc.id, x2025.id)).rows
    const e26 = (await q.listEntries(bc.id, x2026.id)).rows
    expect(e25.map((r: { entry: { entry_no: number } }) => r.entry.entry_no)).toEqual([1, 2])
    expect(e26[0].entry.entry_no).toBe(1)
    // The journal is LIVE — a declare adds a row (an extourne did, 2026-08-19).
    // The fixture's rows are pinned as the gapless head of the journal, not as
    // its entire contents: the same rule as the analyses pin above — a parity
    // test must not turn "somebody used the product" into a failure.
    const seeded = FX.TX.filter((t) => t.entity_id === 1 && t.date >= '2026-01-01').length
    expect(e26.length).toBeGreaterThanOrEqual(seeded)
    expect(
      e26.map((r: { entry: { entry_no: number } }) => r.entry.entry_no),
      'entry_no is gapless from 1 within the exercice — the invariant itself'
    ).toEqual(Array.from({ length: e26.length }, (_, i) => i + 1))
    // Every 2025-dated entry sits in the 2025 exercice. The point of the split.
    for (const r of e25) expect(r.entry.date < '2026-01-01').toBe(true)
    for (const r of e26) expect(r.entry.date >= '2026-01-01').toBe(true)
  })
})
