// Opening balances: the one figure a person types, and only once.
//
// ===========================================================================
// THE QUESTION THIS FILE ANSWERS
// ===========================================================================
// Are openings TYPED, or are they PRODUCED by closing the year before? Both,
// and the split is the whole design:
//
//   THE FIRST YEAR OF A BOOK IS TYPED. A real client arrives with a balance
//   sheet their fiduciary drew up under the old system. Nothing in this app
//   produced those figures and nothing in this app can derive them. Somebody
//   copies them in. That is a migration, and it happens once per book.
//
//   EVERY LATER YEAR IS PRODUCED. `closeExercice` computes them from the year
//   it is closing. Typing them would mean a balance sheet whose opening does
//   not follow from any closing — the exact break in the chain that art. 958c
//   al. 1 ch. 2 CO (clarity, and the audit trail) exists to prevent.
//
// So this door refuses on any year that is not the book's earliest. The
// refusal names the close door, because that is the real answer to "why can I
// not type these".
//
// ── WHOLE SET, NEVER ONE LINE ───────────────────────────────────────────────
// `set` replaces every opening for the year in one transaction. A balance
// sheet is not a list of edits, it is a statement that must balance, and a
// per-line door could only ever check the line in front of it. Because the set
// is whole, this door can and does refuse an unbalanced one:
//
//     actif = passif + capitaux propres
//
// which is the same equality `bilan.balanced` reports and the reason a typo in
// a migration is caught on the day it is typed rather than at the first close.
//
// ── SIGNS ───────────────────────────────────────────────────────────────────
// Amounts are in the account's NATURAL direction, matching what `openingMap`
// feeds the derivation: a class 1 asset is positive when the book owns
// something, a class 2 liability is positive when the book owes something.
// Account 2970 `bénéfice / perte reporté(e)` is the one that routinely goes
// negative, because a carried-forward loss is below zero.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { booksExercice, booksOpeningBalance, type BooksOpeningBalance } from '../schema'
import { accountsNotInChart, ADD_ACCOUNT_HINT } from './chart-guard'
import { listAccounts } from './statutory'

export class OpeningRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface OpeningLine {
  account: string
  /** CHF, two decimals, may be negative. */
  amount: string
}

export async function listOpenings(
  entityId: number,
  exerciceId: number
): Promise<BooksOpeningBalance[]> {
  return getDb()
    .select()
    .from(booksOpeningBalance)
    .where(
      and(
        eq(booksOpeningBalance.entity_id, entityId),
        eq(booksOpeningBalance.exercice_id, exerciceId)
      )
    )
}

/** The book's earliest fiscal year — the only one whose openings may be typed. */
export async function earliestExerciceYear(entityId: number): Promise<number | null> {
  const rows = await getDb()
    .select({ year: booksExercice.year })
    .from(booksExercice)
    .where(eq(booksExercice.entity_id, entityId))
  if (rows.length === 0) return null
  return Math.min(...rows.map((r) => r.year))
}

/**
 * Replace the opening balances of one fiscal year.
 *
 * Returns what was written, plus the two totals, so a caller can print the
 * balance it just proved rather than asking for it again.
 */
export async function setOpenings(
  workspaceId: number,
  entityId: number,
  exercice: { id: number; year: number; status: string },
  lines: OpeningLine[]
): Promise<{ written: number; totalActif: string; totalPassif: string }> {
  if (exercice.status === 'closed') {
    throw new OpeningRefused(
      'exercice_closed',
      `exercice ${exercice.year} is closed`,
      'a closed year is a filed year; its opening balances are part of what was filed'
    )
  }

  const earliest = await earliestExerciceYear(entityId)
  if (earliest !== null && exercice.year !== earliest) {
    throw new OpeningRefused(
      'not_first_exercice',
      `${exercice.year} is not this book's first fiscal year (${earliest} is)`,
      `openings after the first year are produced by closing the year before: bk books exercice close --year ${exercice.year - 1}`
    )
  }

  for (const l of lines) {
    if (!/^-?\d+(\.\d{1,2})?$/.test(l.amount)) {
      throw new OpeningRefused(
        'bad_amount',
        `"${l.amount}" on account ${l.account} is not an amount`,
        'e.g. 15000.00, or -4850.00 for a carried-forward loss'
      )
    }
  }

  const dupes = lines.map((l) => l.account).filter((a, i, all) => all.indexOf(a) !== i)
  if (dupes.length > 0) {
    throw new OpeningRefused(
      'duplicate_account',
      `account ${[...new Set(dupes)].join(', ')} appears more than once`,
      'one opening balance per account: add the figures together'
    )
  }

  const db = getDb()
  const ghosts = await accountsNotInChart(db, entityId, lines.map((l) => l.account))
  if (ghosts.length > 0) {
    throw new OpeningRefused(
      'unknown_account',
      `this book's chart has no account ${ghosts.join(', ')}`,
      ADD_ACCOUNT_HINT
    )
  }

  // ---- the balance sheet must balance ------------------------------------
  const chart = new Map((await listAccounts(entityId)).map((a) => [a.no, Number(a.class)]))
  let actif = 0
  let passif = 0
  const wrongClass: string[] = []
  for (const l of lines) {
    const cls = chart.get(l.account)
    if (cls === 1) actif += Number(l.amount)
    else if (cls === 2) passif += Number(l.amount)
    else wrongClass.push(l.account)
  }
  if (wrongClass.length > 0) {
    throw new OpeningRefused(
      'not_a_bilan_account',
      `account ${wrongClass.join(', ')} is a compte de résultat account`,
      'only classes 1 and 2 carry an opening balance — a year of trading starts at zero by definition (art. 958 al. 2)'
    )
  }
  const ecart = Math.round((actif - passif) * 100) / 100
  if (ecart !== 0) {
    throw new OpeningRefused(
      'openings_unbalanced',
      `actif ${actif.toFixed(2)} does not equal passif ${passif.toFixed(2)} — out by ${ecart.toFixed(2)}`,
      'a balance sheet balances; the difference usually belongs on 2970 (bénéfice / perte reporté(e))'
    )
  }

  const written = await db.transaction(async (tx) => {
    // Whole-set replace, inside the transaction, so a failed write cannot
    // leave the year holding half of one balance sheet and half of another.
    await tx
      .delete(booksOpeningBalance)
      .where(
        and(
          eq(booksOpeningBalance.entity_id, entityId),
          eq(booksOpeningBalance.exercice_id, exercice.id)
        )
      )
    if (lines.length === 0) return 0
    await tx.insert(booksOpeningBalance).values(
      lines.map((l) => ({
        workspace_id: workspaceId,
        entity_id: entityId,
        exercice_id: exercice.id,
        account_no: l.account,
        amount: l.amount,
      }))
    )
    return lines.length
  })

  return { written, totalActif: actif.toFixed(2), totalPassif: passif.toFixed(2) }
}
