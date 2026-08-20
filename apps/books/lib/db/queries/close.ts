// Closing a fiscal year: the routine that ends one year and starts the next.
//
// ===========================================================================
// CLOSING IS NOT A FLAG. IT IS THE ONLY THING THAT PRODUCES OPENINGS.
// ===========================================================================
// `books.exercice.status` has said `open | closed` since 0003, with the comment
// "Closing is what freezes the next year's openings", and until this file
// nothing could set it. The seed wrote both years and both sets of openings
// directly, so the chain that comment describes had never once been walked.
//
// What closing does, in order, refusing before it writes anything:
//
//   1. THE YEAR MUST NOT ALREADY BE CLOSED. Closing twice would carry the
//      result forward twice.
//   2. NOTHING MAY STILL BE STAGED. A staged entry is money that has arrived
//      and has not been judged. Closing over it would file a year that is
//      missing entries somebody had already been shown (art. 958c al. 1 ch. 1,
//      completeness).
//   3. THE BILAN MUST BALANCE. If it does not, the year cannot be filed and
//      certainly cannot become next year's starting point.
//   4. NEXT YEAR MUST EXIST AND BE EMPTY OF OPENINGS. Closing writes into it;
//      writing over openings somebody already has would be silent.
//
// Then, in one transaction: the carry is written into next year, and only
// afterwards is the year marked closed.
//
// ── WHAT CARRIES, AND WHAT DOES NOT ─────────────────────────────────────────
// BILAN accounts carry their closing balance. That is the whole point of a
// balance sheet: what the book owns and owes on 31 December is what it owns and
// owes on 1 January.
//
// COMPTE DE RÉSULTAT accounts do not carry, and this is not an optimisation.
// art. 958 al. 2: a fiscal year reports the result OF THAT YEAR. Carrying a
// charge account forward would make next year's compte de résultat report money
// spent in a year that is already filed.
//
// Instead the year's RESULT — one figure, the same `resultat` the bilan and the
// compte de résultat both report — is added to account 2970, `bénéfice / perte
// reporté(e)`. A profit increases it, a loss decreases it, and a loss carried
// forward is legitimately negative. This is the affectation du résultat, and
// doing it any other way would break the equality in step 3 the moment the next
// year opened.
//
// ── WHY THE RESULT IS ADDED, NOT ASSIGNED ───────────────────────────────────
// 2970 is cumulative: it holds every prior year's undistributed result. The
// closing balance of 2970 already contains the years before this one, so the
// carry is `closing balance of 2970` plus `this year's result`. Assigning would
// erase the book's history in a single write.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksEntry,
  booksEntryLine,
  booksExercice,
  booksOpeningBalance,
  type BooksExercice,
} from '../schema'
import { accountBalance, toCentimes, type PostingLine } from '../../derive'
import { getBilan, getCr, listAccounts } from './statutory'
import { listOpenings } from './openings'

/** The account the year's result is carried into. PME plan, always this one. */
const RETAINED_EARNINGS = '2970'

export class CloseRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface CloseResult {
  year: number
  resultat: string
  /** The year the openings were written into. */
  carriedInto: number
  /** How many opening balances were written. */
  carried: number
  retainedEarnings: string
  closedAt: string
}

export async function closeExercice(
  workspaceId: number,
  entityId: number,
  exercice: BooksExercice
): Promise<CloseResult> {
  const db = getDb()

  // ---- 1. not already closed ----------------------------------------------
  if (exercice.status === 'closed') {
    throw new CloseRefused(
      'already_closed',
      `exercice ${exercice.year} is already closed`,
      'closing twice would carry the result forward twice; there is no reopen, on purpose'
    )
  }

  // ---- 1b. the year has to be OVER ----------------------------------------
  // Found 2026-08-20 by closing a 1 Jan – 31 Dec 2026 exercice on 20 August:
  // accepted, and it filed eight months of a twelve-month year as the year's
  // result. Every other guard here asks whether the books are TIDY; none asked
  // whether the period had ended, so the one irreversible act in the app was
  // reachable four months early and looked exactly like a correct close.
  //
  // art. 958 al. 1 CO ties the accounts to the end of the financial year, and
  // 958f keeps them for ten years as filed. There is no reopen (see
  // `already_closed`), so an early close is not a mistake anyone can take back
  // — the correction would be a reversing entry in a year that should never
  // have started.
  //
  // ── A SHORTENED YEAR IS NOT AN EXCEPTION ───────────────────────────────────
  // A company changing its year end has a SHORT exercice, and its `ends_on` is
  // the new, earlier date. This guard reads that column rather than assuming
  // twelve months, so the shortened year closes the day after it truly ends and
  // needs no override. Nothing here has to know why the year is the length it
  // is — only that it is finished.
  const today = new Date().toISOString().slice(0, 10)
  if (exercice.ends_on > today) {
    throw new CloseRefused(
      'exercice_not_over',
      `exercice ${exercice.year} runs to ${exercice.ends_on} and today is ${today} — it has not ended yet`,
      'a close files the year as its final result and there is no reopen (art. 958f CO). For a figure before year end, read it instead: `bk books cr` for the result so far, or `bk books cr --by-month`. If this book really changes its year end, shorten the exercice first — the close follows the dates, not the calendar'
    )
  }

  // ---- 2. nothing still staged --------------------------------------------
  const staged = await db
    .select({ seq: booksEntry.seq })
    .from(booksEntry)
    .where(
      and(
        eq(booksEntry.exercice_id, exercice.id),
        inArray(booksEntry.status, ['staged'])
      )
    )
  if (staged.length > 0) {
    const shown = staged.slice(0, 8).map((s) => `#${s.seq}`).join(', ')
    throw new CloseRefused(
      'staged_entries',
      `${staged.length} ${staged.length === 1 ? 'entry is' : 'entries are'} still staged: ${shown}${staged.length > 8 ? ', …' : ''}`,
      'work the list to the end first: bk books worklist, then bk books entry post'
    )
  }

  // ---- 3. the bilan must balance ------------------------------------------
  const [bilan, cr, accounts, openings] = await Promise.all([
    getBilan(entityId, exercice.id),
    getCr(entityId, exercice.id),
    listAccounts(entityId),
    listOpenings(entityId, exercice.id),
  ])
  if (!bilan.balanced) {
    throw new CloseRefused(
      'bilan_unbalanced',
      `the bilan for ${exercice.year} is out by ${bilan.ecart}`,
      'a year that does not balance cannot be filed; check for an entry posted to an account this book\'s chart does not carry'
    )
  }

  // ---- 4. next year exists and holds no openings yet ----------------------
  const [next] = await db
    .select()
    .from(booksExercice)
    .where(and(eq(booksExercice.entity_id, entityId), eq(booksExercice.year, exercice.year + 1)))
  if (!next) {
    throw new CloseRefused(
      'no_next_exercice',
      `there is no exercice ${exercice.year + 1} to carry the balances into`,
      `open it first: bk books exercice create --year ${exercice.year + 1}`
    )
  }
  const existing = await listOpenings(entityId, next.id)
  if (existing.length > 0) {
    throw new CloseRefused(
      'openings_exist',
      `exercice ${next.year} already holds ${existing.length} opening balance${existing.length === 1 ? '' : 's'}`,
      'closing writes them; clear them first or close a year that has not been carried yet'
    )
  }

  // ---- the carry -----------------------------------------------------------
  const lines = await postingLinesOf(entityId, exercice.id)
  const openingMap = new Map(openings.map((o) => [o.account_no, toCentimes(o.amount)]))

  const carried: { account_no: string; amount: string }[] = []
  let retained = 0n
  for (const a of accounts) {
    const cls = Number(a.class)
    if (cls !== 1 && cls !== 2) continue // art. 958 al. 2: the result is a year's own
    const bal = accountBalance(
      lines,
      { no: a.no, class: cls, statement: a.statement, statement_position: a.statement_position },
      openingMap.get(a.no) ?? 0n
    )
    if (a.no === RETAINED_EARNINGS) {
      // Cumulative: what is already carried, plus this year's result.
      retained = bal + toCentimes(cr.resultat)
      continue
    }
    if (bal === 0n) continue // a zero opening is the same as no row; see `openingMap`
    carried.push({ account_no: a.no, amount: fromCentimes(bal) })
  }

  const hasRetained = accounts.some((a) => a.no === RETAINED_EARNINGS)
  if (!hasRetained) {
    throw new CloseRefused(
      'no_retained_earnings',
      `this book's chart has no account ${RETAINED_EARNINGS} to carry the result into`,
      `add it: bk books account create --no ${RETAINED_EARNINGS} --class 2 --position resultat_reporte`
    )
  }
  carried.push({ account_no: RETAINED_EARNINGS, amount: fromCentimes(retained) })

  const closedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await tx.insert(booksOpeningBalance).values(
      carried.map((c) => ({
        workspace_id: workspaceId,
        entity_id: entityId,
        exercice_id: next.id,
        account_no: c.account_no,
        amount: c.amount,
      }))
    )
    // Marked closed LAST: if the carry fails, the year is still open and the
    // person may try again. A closed year with no carry would need a door that
    // does not exist to fix.
    await tx
      .update(booksExercice)
      .set({ status: 'closed', closed_at: new Date(closedAt) })
      .where(eq(booksExercice.id, exercice.id))
  })

  return {
    year: exercice.year,
    resultat: cr.resultat,
    carriedInto: next.year,
    carried: carried.length,
    retainedEarnings: fromCentimes(retained),
    closedAt,
  }
}

/** Centimes back to the `numeric(14,2)` string the column holds. */
function fromCentimes(c: bigint): string {
  const neg = c < 0n
  const abs = neg ? -c : c
  const s = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
  return neg ? `-${s}` : s
}

/** The same shape `statutory.ts` builds for the derivations, for one year. */
async function postingLinesOf(entityId: number, exerciceId: number): Promise<PostingLine[]> {
  return getDb()
    .select({
      account_no: booksEntryLine.account_no,
      debit: booksEntryLine.debit,
      credit: booksEntryLine.credit,
      status: booksEntry.status,
    })
    .from(booksEntryLine)
    .innerJoin(booksEntry, eq(booksEntry.id, booksEntryLine.entry_id))
    .where(
      and(
        eq(booksEntry.entity_id, entityId),
        eq(booksEntry.exercice_id, exerciceId),
        isNull(booksEntry.deleted_at)
      )
    )
}
