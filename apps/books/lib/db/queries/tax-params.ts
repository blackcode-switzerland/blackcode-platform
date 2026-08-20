// Where a company is taxed, and at what rates.
//
// ===========================================================================
// `configured: false` WAS THE ONLY ANSWER A REAL BOOK COULD EVER GIVE
// ===========================================================================
// `books.tax_params` holds the canton, the commune and the four rate blocks the
// tax snapshot computes from. It was `SELECT`-only in the whole application:
// only the seed ever wrote a row. So the three demo books had a tax picture and
// every book a person created answered `tax: null, configured: false` forever.
//
// `lib/types.ts` is emphatic about why that answer must not be filled in:
// "**The canton and the commune come from that row and from nowhere else**
// (decision D-D: nothing may assume a Swiss canton, let alone VD/Renens). A
// screen that supplied a default rate would be inventing somebody's tax bill."
//
// That is exactly right, and it is the reason this door exists rather than a
// default: somebody has to say where the company is taxed, and it has to be
// somebody who knows.
//
// ── THE FOUR BLOCKS ─────────────────────────────────────────────────────────
// `lib/derive/management.ts` computes from exactly these, and refusing a
// partial set here is what stops a snapshot built on three of the four:
//
//   ifd.rate_pct              federal profit tax (art. 68 LIFD, 8.5%)
//   cantonal.base_rate_pct    the canton's base rate on profit
//   cantonal.coefficient_pct  the canton's multiplier
//   communal.coefficient_pct  the commune's multiplier
//   capital_tax.base_rate_permille   on equity, per mille, imputed against the
//                                    cantonal+communal profit tax
//
// ── IT IS CONFIGURATION, SO IT IS EDITABLE ──────────────────────────────────
// A coefficient is voted and changes. This is an upsert, keyed on the entity
// (`tax_params.entity_id` is UNIQUE), and it is not a record: nothing is filed
// on it and no history is kept. That is the app's standing line — records are
// permanent, configuration is editable — and rates are configuration.
//
// A snapshot already taken is unaffected, because a snapshot is derived at
// request time and stored nowhere (ring 3). An analysis that CITED one keeps
// its own `based_on` verbatim, which is what that field is for.

import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { booksTaxParams, type BooksEntity, type BooksTaxParams } from '../schema'

/** The 26 cantons. A two-letter string that is not one of these is a typo. */
const CANTONS = new Set([
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
])

export class TaxParamsRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface TaxParamsInput {
  canton: string
  commune: string
  ifd_rate_pct: number
  cantonal_base_rate_pct: number
  cantonal_coefficient_pct: number
  communal_coefficient_pct: number
  capital_tax_base_rate_permille: number
}

/**
 * One rate, range-checked and PLAUSIBILITY-checked.
 *
 * ── WHY A FLOOR, AND WHY IT IS NOT PEDANTRY ────────────────────────────────
 * Measured 2026-08-20, from an agent asked to record "8.5%":
 *
 *   ifd.rate_pct              0.085   (meant 8.5)
 *   cantonal.base_rate_pct    0.04    (meant 4.0)
 *   cantonal.coefficient_pct  1.2     (meant 120)
 *   communal.coefficient_pct  1.25    (meant 125)
 *   capital_tax.base_rate_permille  0.0025  (meant 0.25)
 *
 * Every one a fraction, into a field named `_pct`. All five were accepted,
 * because `0 <= n <= max` is true of a fraction and of the percentage it was
 * meant to be. `derive/management.ts` then divides each by 100 (or 1000) — so
 * the whole tax picture came out at a HUNDREDTH of the real bill, silently, and
 * the only thing that hid it was a book with no profit yet.
 *
 * This is the shape of defect this codebase keeps meeting: a value the schema
 * accepts, a statement that is quietly wrong, and nothing anywhere that says
 * so. The chart-account check (0016) was the same, and the answer is the same —
 * refuse at the door, with the correction in the message.
 *
 * ── THE FLOORS ARE STATUTORY, NOT TASTE ────────────────────────────────────
 * `min` is the value below which a NON-ZERO figure cannot be what the caller
 * meant:
 *
 *   the federal rate   art. 68 LIFD fixes it at 8.5% and it is the same in
 *                      every canton — there is no Swiss federal profit tax
 *                      below 1%
 *   a coefficient      cantonal and communal multipliers run roughly 50–250
 *                      (percent of the base rate); none is below 10
 *   a base rate        cantonal profit-tax base rates run ~1.5–10%
 *
 * The capital-tax per mille keeps a very permissive floor: real cantonal rates
 * span roughly 0.01‰ to 5‰ and the low end is genuinely tiny, so this field
 * cannot carry a confident floor. Four of the five above are caught, which
 * refuses the submission — the set is written in one transaction or not at all.
 *
 * ZERO IS ALWAYS ALLOWED. A canton that levies no capital tax says 0, and that
 * is a declaration, not a unit error — the same reasoning `imports.ts` applies
 * to a VAT rate of 0.
 */
function rate(name: string, v: unknown, max: number, min = 0): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new TaxParamsRefused(
      'bad_rate',
      `${name} is "${v}", which is not a percentage between 0 and ${max}`,
      'rates are written as numbers, e.g. --ifd-rate 8.5'
    )
  }
  if (n > 0 && n < min) {
    const asWritten = Number((n * 100).toPrecision(10))
    throw new TaxParamsRefused(
      'rate_looks_like_fraction',
      `${name} is "${v}", which is below any real Swiss rate — this looks like a fraction where a percentage is meant`,
      `write the rate the way it is quoted, not divided by 100: ${asWritten} rather than ${n}. Every figure here is divided by 100 when the tax is computed, so a fraction produces a bill a hundredth of the true one and nothing later says so. If ${n} is genuinely what this commune levies, there is no way to say it — tell a human`
    )
  }
  return n
}

export async function setTaxParams(
  workspaceId: number,
  entity: BooksEntity,
  input: TaxParamsInput
): Promise<BooksTaxParams> {
  // A sole proprietorship's result is taxed as its owner's personal income,
  // which this app does not model — `getTaxSnapshot` refuses one outright, so
  // storing rates for it would be storing something nothing can ever read.
  if (entity.bookkeeping_regime === 'simplified') {
    throw new TaxParamsRefused(
      'no_tax_params_for_simplified',
      `"${entity.slug}" keeps recettes-dépenses: its result is taxed as its owner's personal income`,
      'income tax belongs to the fiduciary; there is no company tax snapshot to configure'
    )
  }

  const canton = (input.canton ?? '').trim().toUpperCase()
  if (!CANTONS.has(canton)) {
    throw new TaxParamsRefused(
      'bad_canton',
      `"${input.canton}" is not a Swiss canton`,
      'the two-letter code, e.g. VD, ZH, GE'
    )
  }
  const commune = (input.commune ?? '').trim()
  if (!commune) {
    throw new TaxParamsRefused(
      'missing_commune',
      'the commune is required: the communal coefficient is a commune\'s own',
      'pass --commune Renens'
    )
  }

  const params = {
    ifd: { rate_pct: rate('the federal rate', input.ifd_rate_pct, 100, 1) },
    cantonal: {
      base_rate_pct: rate('the cantonal base rate', input.cantonal_base_rate_pct, 100, 0.5),
      coefficient_pct: rate('the cantonal coefficient', input.cantonal_coefficient_pct, 1000, 10),
    },
    communal: {
      coefficient_pct: rate('the communal coefficient', input.communal_coefficient_pct, 1000, 10),
    },
    capital_tax: {
      base_rate_permille: rate('the capital tax rate', input.capital_tax_base_rate_permille, 100, 0.001),
    },
  }

  const db = getDb()
  const [existing] = await db
    .select()
    .from(booksTaxParams)
    .where(eq(booksTaxParams.entity_id, entity.id))
    .limit(1)

  if (existing) {
    const [row] = await db
      .update(booksTaxParams)
      .set({ canton, commune, params, updated_at: new Date() })
      .where(eq(booksTaxParams.id, existing.id))
      .returning()
    return row
  }

  const [row] = await db
    .insert(booksTaxParams)
    .values({ workspace_id: workspaceId, entity_id: entity.id, canton, commune, params })
    .returning()
  return row
}
