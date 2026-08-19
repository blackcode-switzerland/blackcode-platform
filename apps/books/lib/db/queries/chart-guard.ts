// The chart is the vocabulary. A posting line may only name a word in it.
//
// ===========================================================================
// WHY THIS FILE EXISTS: A TYPO USED TO UNBALANCE A BALANCE SHEET
// ===========================================================================
// `books.entry_line.account_no` is a varchar, not a foreign key, because a
// line's account is scoped to the ENTITY and Postgres cannot express "exists in
// books.account for this entry's entity" as a simple FK. Nothing else checked
// it, so `declareEntry` inserted whatever string it was handed.
//
// Found on 2026-08-19 by cloning a workspace: the source books carry two
// treasury accounts (`1021` UBS gelée, `1022` Yapeal) that the PME template
// deliberately does not — `lib/chart.test.ts` pins that delta on purpose. The
// clone therefore posted CHF 43.70 to account `1022` in a book whose chart has
// no `1022`, and the derivation, which walks the CHART and looks movements up
// by account, never saw the credit side.
//
// The result was a POSTED, BALANCED-BY-THE-TRIGGER entry that produced
// `balanced: false` on the bilan: actif 2400.10 against passif 2356.40, adrift
// by exactly that 43.70. The 0004 balance trigger cannot catch this — debits
// equal credits perfectly. Only the chart knows the account is a ghost.
//
// A balance sheet that does not balance is not a bug report, it is a document
// nobody may file (art. 958c al. 1 ch. 3 CO: bookkeeping must be complete and
// verifiable). So the door refuses first.
//
// ── WHY THIS IS NOT A CHECK CONSTRAINT ──────────────────────────────────────
// It could be a trigger, and a trigger would be stronger. It is here instead
// because the refusal has to carry a SUGGESTION — an unknown account is nearly
// always either a typo or a real account the book has not got yet, and the
// person needs to be told which door adds one. A SQL exception can say what is
// wrong and cannot say what to do about it. 0016 still adds the trigger as the
// backstop for anything that reaches the table by another path.

import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../client'
import { booksAccount } from '../schema'

/** The transaction handle, spelled the way `queries/imports.ts` spells it. */
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * Which of `accounts` are NOT in this book's chart, in the order given.
 *
 * Empty strings are skipped rather than reported: a staged bank line with no
 * account yet is the normal arrival state from `source import`, and the whole
 * point of the worklist is that somebody comes along and names it.
 */
export async function accountsNotInChart(
  tx: Tx | ReturnType<typeof getDb>,
  entityId: number,
  accounts: (string | null | undefined)[]
): Promise<string[]> {
  const wanted = [...new Set(accounts.filter((a): a is string => typeof a === 'string' && a !== ''))]
  if (wanted.length === 0) return []

  const rows = await tx
    .select({ no: booksAccount.no })
    .from(booksAccount)
    .where(and(eq(booksAccount.entity_id, entityId), inArray(booksAccount.no, wanted)))

  const known = new Set(rows.map((r) => r.no))
  return wanted.filter((a) => !known.has(a))
}

/** The suggestion every unknown-account refusal carries. One wording, one place. */
export const ADD_ACCOUNT_HINT =
  'check the number against `bk books account list`, or add it with `bk books account create` if this book really keeps it'
