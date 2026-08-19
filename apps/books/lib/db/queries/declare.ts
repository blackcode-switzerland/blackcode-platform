// Entry declare — the write path for money that never crosses a bank line.
//
// A cash coffee, a private payment for the business (P7's CHF 20 note): no
// feed will ever deliver it, so a human declares it. Unlike the bank door,
// the declarer IS the explanation: the entry arrives `known_one_off` with
// its explanation attached, because "I paid this in cash" is the resolution.
//
// It still arrives STAGED. Declared money follows the same posting gate as
// imported money — review, then post, then immutable. For a double-entry
// book both accounts must be given ("no caisse" is the doctrine: cash
// business expenses settle against the owner's compte courant, and the
// declarer says which). For an RI book: direction and amount, nothing else
// to map.
//
// Provenance is the first history event: declared, by whom, when. bank_ref
// and source stay NULL — honestly, nobody's feed delivered this.

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { booksEntity, booksEntry, booksEntryLine, booksExercice, booksRiEntry, type StoredSpeech } from '../schema'
import { nextSeq } from './imports'
import { accountsNotInChart, ADD_ACCOUNT_HINT } from './chart-guard'
import { tvaColumns, type TvaInput } from './tva'

export class DeclareRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface DeclareData {
  entitySlug: string
  date: string
  amount: string
  label: string
  explanation: StoredSpeech
  counterparty?: string | null
  /** RI books: which side of the book. */
  direction?: 'recette' | 'depense' | 'neutral'
  /** Double-entry books: the charge (or product) account. */
  account?: string
  /** Double-entry books: the settling account (e.g. the owner's compte courant). */
  contra?: string
  /**
   * Double-entry books, more than two sides.
   *
   * `account`/`contra` is the two-line shorthand and stays the common case. A
   * SALARY is not that shape and never was — the mockup's own January payroll
   * is three lines, 5000 salaires and 5700 charges sociales against 1020 —
   * and until this field existed the door could not express it. An agent
   * running a company with employees met that every month.
   *
   * Given together with `account`/`contra` is a refusal, not a merge: the
   * declarer must be able to read back what they declared.
   */
  lines?: { account: string; debit?: string; credit?: string }[]
  /** The VAT story, if the declarer has one. See `queries/tva.ts`. */
  tva?: TvaInput
  declaredBy: string
}

/**
 * Validate an explicit line set and return it in storage order.
 *
 * The rules are the ones art. 957a al. 2 assumes and 0004 enforces at COMMIT:
 * every line names an account, carries exactly one side, and the two sides
 * total the same. Checked here so the refusal has words and a suggestion —
 * the deferred trigger can only say the entry does not balance.
 */
function checkedLines(
  lines: { account: string; debit?: string; credit?: string }[]
): { account_no: string; debit: string; credit: string; position: number }[] {
  if (lines.length < 2) {
    throw new DeclareRefused(
      'too_few_lines',
      'an écriture has at least two sides',
      'pass --debit and --credit, e.g. --debit 5000=11600.00 --credit 1020=11600.00'
    )
  }

  const out: { account_no: string; debit: string; credit: string; position: number }[] = []
  let debits = 0
  let credits = 0

  lines.forEach((l, i) => {
    const account = (l.account ?? '').trim()
    if (!account) {
      throw new DeclareRefused(
        'line_without_account',
        `line ${i + 1} names no account`,
        'every posting line names an account; a line with none is what an import produces, not a declaration'
      )
    }
    const debit = (l.debit ?? '').trim()
    const credit = (l.credit ?? '').trim()
    const hasD = debit !== '' && Number(debit) !== 0
    const hasC = credit !== '' && Number(credit) !== 0
    if (hasD === hasC) {
      throw new DeclareRefused(
        'line_needs_one_side',
        `line ${i + 1} (${account}) must be a debit or a credit, not ${hasD ? 'both' : 'neither'}`,
        'one amount per line; a line that is both is two lines'
      )
    }
    const value = hasD ? debit : credit
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
      throw new DeclareRefused(
        'bad_amount',
        `"${value}" on line ${i + 1} (${account}) is not a positive amount`,
        'e.g. 11600.00 — the side says the direction, the amount is never negative'
      )
    }
    if (hasD) debits += Number(value)
    else credits += Number(value)
    out.push({
      account_no: account,
      debit: hasD ? Number(value).toFixed(2) : '0',
      credit: hasC ? Number(value).toFixed(2) : '0',
      position: i + 1,
    })
  })

  const ecart = Math.round((debits - credits) * 100) / 100
  if (ecart !== 0) {
    throw new DeclareRefused(
      'lines_unbalanced',
      `debits ${debits.toFixed(2)} do not equal credits ${credits.toFixed(2)} — out by ${ecart.toFixed(2)}`,
      'an écriture balances; 0004 refuses it at COMMIT anyway, and this says which way it is out'
    )
  }
  return out
}

export async function declareEntry(
  workspaceId: number,
  data: DeclareData
): Promise<{ number: number; journal: 'grand_livre' | 'recettes_depenses'; entry_no: number | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    throw new DeclareRefused('bad_date', `"${data.date}" is not a date`, 'YYYY-MM-DD')
  }
  // With explicit lines the entry's own amount is the sum of one side, so it
  // is derived rather than asked for — asking would invite a total that
  // disagrees with the lines it totals.
  const explicit = data.lines && data.lines.length > 0 ? checkedLines(data.lines) : null
  if (explicit && (data.account || data.contra)) {
    throw new DeclareRefused(
      'lines_and_shorthand',
      'pass either the two-line shorthand (--account/--contra) or explicit lines, not both',
      'the shorthand IS two lines; mixing them would make the entry unreadable back'
    )
  }
  const amount = explicit
    ? explicit.reduce((s, l) => s + Number(l.debit), 0).toFixed(2)
    : data.amount
  if (!explicit && (!/^\d+(\.\d{1,2})?$/.test(data.amount) || Number(data.amount) <= 0)) {
    throw new DeclareRefused('bad_amount', `"${data.amount}" is not a positive amount`, 'e.g. 45.00')
  }

  const db = getDb()
  return db.transaction(async (tx) => {
    const [entity] = await tx
      .select()
      .from(booksEntity)
      .where(eq(booksEntity.workspace_id, workspaceId))
      .then((rows) => rows.filter((e) => e.slug === data.entitySlug))
    if (!entity) throw new DeclareRefused('bad_entity', `no book with slug "${data.entitySlug}"`, 'bk books entity list')

    const year = Number(data.date.slice(0, 4))
    const [exercice] = await tx
      .select()
      .from(booksExercice)
      .where(eq(booksExercice.entity_id, entity.id))
      .then((rows) => rows.filter((x) => x.year === year))
    if (!exercice) {
      throw new DeclareRefused('no_exercice', `the book has no exercice ${year}`, 'bk books exercice create first')
    }
    if (exercice.status === 'closed') {
      throw new DeclareRefused('exercice_closed', `exercice ${year} is closed`, 'a closed year takes no new entries')
    }

    const provenance = [
      {
        at: new Date().toISOString(),
        event: 'declared',
        by: data.declaredBy,
        note: 'no bank line: declared directly, not imported',
      },
    ]

    if (entity.bookkeeping_regime === 'simplified') {
      // `books.ri_entry` has no VAT columns and that is the design, not an
      // omission: a recettes-dépenses journal records money in and money out.
      // Silently dropping the flags would let somebody believe they had
      // recorded a rate that is nowhere in the book.
      if (data.tva && (data.tva.rate ?? null) !== null) {
        throw new DeclareRefused(
          'tva_not_on_ri',
          'a recettes-dépenses journal records no VAT rate per entry',
          'drop --tva-rate; art. 957 al. 2 bookkeeping reports VAT outside the journal'
        )
      }
      if (!data.direction) {
        throw new DeclareRefused('missing_direction', 'an RI declaration needs a direction', 'pass --direction recette|depense|neutral')
      }
      const seq = await nextSeq(tx, workspaceId, 'ri_entry')
      await tx.insert(booksRiEntry).values({
        workspace_id: workspaceId,
        entity_id: entity.id,
        exercice_id: exercice.id,
        seq,
        date: data.date,
        direction: data.direction,
        amount: amount,
        raw_label: data.label,
        counterparty: data.counterparty ?? null,
        explanation: data.explanation,
        recognition: 'known_one_off',
        evidence_tier: 'bare',
        history: provenance,
      })
      return { number: seq, journal: 'recettes_depenses' as const, entry_no: null }
    }

    if (!explicit && (!data.account || !data.contra)) {
      throw new DeclareRefused(
        'missing_accounts',
        'a double-entry declaration needs both sides',
        'pass --account (the charge) and --contra (what settles it, e.g. the compte courant) — there is no caisse, on purpose. More than two sides: --debit/--credit'
      )
    }

    // The shorthand, expanded into the same shape the explicit path produces,
    // so exactly one set of lines is written below.
    const lines =
      explicit ??
      [
        { account_no: data.account!, debit: amount, credit: '0', position: 1 },
        { account_no: data.contra!, debit: '0', credit: amount, position: 2 },
      ]

    // Every side must be a word in THIS book's chart. `chart-guard.ts` carries
    // the balance sheet this refusal stopped going out of true.
    const ghosts = await accountsNotInChart(tx, entity.id, lines.map((l) => l.account_no))
    if (ghosts.length > 0) {
      throw new DeclareRefused(
        'unknown_account',
        `this book's chart has no account ${ghosts.join(', ')}`,
        ADD_ACCOUNT_HINT
      )
    }

    const tva = tvaColumns(data.tva, amount)

    const seq = await nextSeq(tx, workspaceId, 'entry')
    // gapless per (book, year), inside this transaction
    const entryNoRow = await tx.execute(sql`
      SELECT COALESCE(MAX(entry_no), 0) + 1 AS n FROM books.entry WHERE exercice_id = ${exercice.id}`)
    const entryNo = Number((entryNoRow.rows[0] as { n: number }).n)

    const [e] = await tx
      .insert(booksEntry)
      .values({
        workspace_id: workspaceId,
        entity_id: entity.id,
        exercice_id: exercice.id,
        seq,
        entry_no: entryNo,
        date: data.date,
        status: 'staged',
        raw_label: data.label,
        counterparty: data.counterparty ?? null,
        explanation: data.explanation,
        recognition: 'known_one_off',
        evidence_tier: 'bare',
        history: provenance,
        ...(tva ?? {}),
      })
      .returning({ id: booksEntry.id })

    await tx.insert(booksEntryLine).values(lines.map((l) => ({ entry_id: e.id, ...l })))

    return { number: seq, journal: 'grand_livre' as const, entry_no: entryNo }
  })
}
