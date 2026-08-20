// Adding an account to a book's chart.
//
// ===========================================================================
// THE TEMPLATE IS A STARTING POINT, AND UNTIL NOW IT WAS ALSO THE CEILING
// ===========================================================================
// `lib/chart.ts` says it in its own header: "A CHART IS A STARTING POINT. It
// belongs to the book once applied: two books may keep different accounts."
// `lib/chart.test.ts` pins the proof — the seeded books carry `1021` (UBS
// gelée) and `1022` (Yapeal) which the 24-account template deliberately does
// not, and the test calls them "a book customization, not template material".
//
// There was no door to make one. Every book created through the app had
// exactly the template's 24 accounts forever, while the demo books showed 26.
// A real company has its own banks, and its second bank account was
// unreachable.
//
// ── WHY THIS DOOR EXISTS TODAY IN PARTICULAR ────────────────────────────────
// `chart-guard.ts` now refuses a posting to an account the chart does not
// carry, which is right and which would have been a trap on its own: the
// refusal would have been the last word, with no way to answer it. The check
// and this door are one change.
//
// ── WHAT MAY BE ADDED, AND WHAT MAY NOT ─────────────────────────────────────
// The number, the class, the label and the statutory position. The position is
// a FOREIGN KEY into `books.statement_position` (0003), which is the legal line
// list from art. 959a/959b, so an account cannot be mapped to a line that does
// not exist in law. The class and the statement must agree with it: class 1 and
// 2 are the bilan, everything above is the compte de résultat, and a mismatch
// would put an account on a statement its own class contradicts.
//
// There is NO edit and NO delete. An account that has carried a posting is part
// of the audit trail (art. 958f), and renumbering one would rewrite history
// that entries already point at by number.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksAccount,
  booksStatementPosition,
  type BooksAccount,
  type StoredAccountLabel,
} from '../schema'

export class AccountRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface CreateAccountData {
  no: string
  class: number
  label: StoredAccountLabel
  statement_position: string
}

/** art. 959a (bilan) and 959b (compte de résultat): which statement a class is on. */
function statementForClass(cls: number): 'bilan' | 'cr' {
  return cls === 1 || cls === 2 ? 'bilan' : 'cr'
}

export async function createAccount(
  workspaceId: number,
  entityId: number,
  data: CreateAccountData
): Promise<BooksAccount> {
  if (!/^\d{4,10}$/.test(data.no)) {
    throw new AccountRefused(
      'bad_account_no',
      `"${data.no}" is not an account number`,
      'four digits or more, e.g. 1021 — the PME plan numbers, not a name'
    )
  }
  if (!Number.isInteger(data.class) || data.class < 1 || data.class > 9) {
    throw new AccountRefused(
      'bad_class',
      `class ${data.class} does not exist`,
      '1 actif, 2 passif, 3 produits, 4-6 charges, 7-9 hors exploitation'
    )
  }
  if (!data.label?.fr) {
    throw new AccountRefused(
      'missing_label',
      'an account needs a French label',
      'pass --label-fr "Banque Yapeal" — the statutory wording is the French one'
    )
  }

  const db = getDb()

  const [existing] = await db
    .select({ no: booksAccount.no })
    .from(booksAccount)
    .where(and(eq(booksAccount.entity_id, entityId), eq(booksAccount.no, data.no)))
  if (existing) {
    throw new AccountRefused(
      'account_exists',
      `this book already has account ${data.no}`,
      'an account is never renumbered or relabelled: entries point at it by number (art. 958f)'
    )
  }

  const [position] = await db
    .select()
    .from(booksStatementPosition)
    .where(eq(booksStatementPosition.pos, data.statement_position))
  if (!position) {
    throw new AccountRefused(
      'unknown_position',
      `"${data.statement_position}" is not a statutory statement line`,
      'the legal line list comes from art. 959a/959b; `bk books account list` shows the positions the chart already uses'
    )
  }

  const statement = statementForClass(data.class)
  if (position.statement !== statement) {
    throw new AccountRefused(
      'class_position_mismatch',
      `class ${data.class} belongs on the ${statement}, but "${data.statement_position}" is a ${position.statement} line`,
      'classes 1 and 2 are the bilan (art. 959a); 3 and above are the compte de résultat (art. 959b)'
    )
  }

  const [row] = await db
    .insert(booksAccount)
    .values({
      workspace_id: workspaceId,
      entity_id: entityId,
      no: data.no,
      class: data.class,
      label: data.label,
      statement,
      statement_position: data.statement_position,
    })
    .returning()
  return row
}
