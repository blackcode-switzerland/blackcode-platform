// TVA on an entry: the rate, the amount, and whether the input tax is claimed.
//
// ===========================================================================
// THE APP SHOWED A VAT POSITION IT GAVE NOBODY A WAY TO FILL
// ===========================================================================
// `books.entry` has carried `tva_rate`, `tva_amount`, `tva_input_claimed` and
// `tva_note` since 0003, the tax snapshot serves a VAT position off them, and
// `entity.vat` records that a company is registered. Until this file, NO write
// door set any of them. Every seeded figure came from the fixture writing rows
// directly, so the VAT position was real for the three demo books and
// permanently zero for every book a person actually created.
//
// ── THE THREE RULES ─────────────────────────────────────────────────────────
//
// 1. THE RATE IS A CLOSED VOCABULARY. art. 25 LTVA fixes the rates in force:
//    8.1% standard, 3.8% hébergement, 2.6% réduit, and 0% for exempt turnover
//    that is still reported. `lib/validate/extraction.ts` already refuses a
//    receipt carrying anything else; the same list is imported here rather
//    than retyped, so a rate change is one edit in one file.
//
// 2. THE AMOUNT IS DERIVED WHEN OMITTED, AND CHECKED WHEN GIVEN. Swiss prices
//    are TTC, so the tax inside a gross of G at rate r is G × r / (100 + r).
//    A caller who passes an amount has usually copied it off the supplier's
//    invoice, and a supplier's own figure is the better record — but a figure
//    that disagrees with the arithmetic by more than a rappen is a misread, not
//    a rounding difference, and it is refused rather than stored.
//
//    A rappen of tolerance is deliberate: the legal rounding of a
//    multi-line invoice can land one centime either side of the single-line
//    computation, and refusing that would refuse correct invoices.
//
// 3. A CLAIM NEEDS FULL EVIDENCE. 0004 carries
//    `CHECK (tva_input_claimed = false OR evidence_tier = 'full')` — art. 28
//    al. 1 LTVA lets you deduct input tax you can PROVE. The check would fire
//    as a raw SQL error; this refuses first, in words, and says which door
//    fixes it.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
// It does not decide the SIGN of the tax — whether this entry is output tax on
// turnover or input tax on a cost. That follows from the accounts the entry
// touches, and `getVatPosition` already reads it that way (revenue-side rows
// are output, `tva_input_claimed` rows are input). A door that also asked
// would be a second, disagreeing source of truth.

import { VAT_RATES } from '../../validate/extraction'

export class TvaRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

export interface TvaInput {
  /** Percent, as written on the invoice: 8.1, 3.8, 2.6 or 0. */
  rate?: number | string | null
  /** The tax in CHF. Omitted means "derive it from the gross at this rate". */
  amount?: string | null
  /** art. 28 LTVA. Requires `evidence_tier: 'full'`. */
  inputClaimed?: boolean
  /** `full` | `partial` | `bare`. */
  evidenceTier?: string | null
  /** Free note, e.g. why a rate applies. */
  note?: unknown
  /**
   * Explicitly REMOVE the VAT story from an entry that has one.
   *
   * Silence leaves the row alone (#67), so there has to be a way to say the
   * other thing. `--no-tva` on the CLI. Refused on a posted entry by the same
   * rule that freezes a rate: a booked figure is corrected with a reversing
   * entry, never erased.
   */
  clear?: boolean
}

export interface TvaColumns {
  tva_rate: string | null
  tva_amount: string | null
  tva_input_claimed: boolean
  evidence_tier?: string
}

const TIERS = ['full', 'partial', 'bare'] as const

/** Round half-up to the rappen, the way a Swiss invoice rounds. */
function toRappen(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)
}

/**
 * The tax inside a TTC gross, at `rate` percent.
 *
 * Exported because the tests state the arithmetic against this function rather
 * than against a magic number in a fixture.
 */
export function tvaOnGross(gross: string, rate: number): string {
  return toRappen((Number(gross) * rate) / (100 + rate))
}

/**
 * Validate one entry's VAT intent and return the columns to store.
 *
 * `gross` is the entry's own amount, which is what the rate applies to.
 * Returns `null` when the caller said nothing about VAT at all — an entry with
 * no VAT story stores NULLs, which is different from an entry at 0%.
 */
/**
 * What the entry ALREADY holds, when this is not the first call about it.
 *
 * ── #67: A SECOND RESOLVE WAS TREATED AS IF THE ENTRY HAD NO VAT STORY ─────
 * The workflow `bk guide books/entries` describes is: resolve when the money
 * arrives, claim the input tax when the pièce turns up. That second call is one
 * flag — `--tva-input-claimed` — and it was refused with "input tax cannot be
 * claimed without a VAT rate on the entry" while the rate sat on the row,
 * written by the first call.
 *
 * The cause was that `said` read `input.rate` alone: this function never saw
 * the row, so it could not tell "no rate anywhere" from "no rate IN THIS CALL".
 * Those are different facts and only one of them is a refusal.
 */
export interface StoredTva {
  rate: string | null
  amount: string | null
}

export function tvaColumns(
  input: TvaInput | undefined,
  gross: string,
  stored?: StoredTva
): Partial<TvaColumns> | null {
  if (!input) return null

  // An explicit clear: the entry had a VAT story and no longer should. Distinct
  // from silence, which leaves the row alone — the same distinction
  // `tvaFromBody` already draws for a fresh declaration.
  if (input.clear === true) {
    return { tva_rate: null, tva_amount: null, tva_input_claimed: false }
  }

  const saidHere = input.rate !== undefined && input.rate !== null && input.rate !== ''
  const onRow = stored?.rate !== undefined && stored?.rate !== null && stored?.rate !== ''
  const said = saidHere || onRow
  const claiming = input.inputClaimed === true
  const tier = input.evidenceTier ?? null

  if (tier !== null && !(TIERS as readonly string[]).includes(tier)) {
    throw new TvaRefused(
      'bad_evidence_tier',
      `"${tier}" is not an evidence tier`,
      `one of ${TIERS.join(', ')} — full means the pièce is on file`
    )
  }

  // A claim with no rate claims nothing: art. 28 deducts a FIGURE. "No rate"
  // now means neither this call nor the row has one.
  if (claiming && !said) {
    throw new TvaRefused(
      'claim_without_rate',
      'input tax cannot be claimed: neither this call nor the entry carries a VAT rate',
      'pass --tva-rate as well, or drop --tva-input-claimed'
    )
  }

  if (!said) {
    if (tier === null) return null
    return { tva_rate: null, tva_amount: null, tva_input_claimed: false, evidence_tier: tier }
  }

  // The rate is on the ROW and this call did not restate it. Touch only what
  // the call is actually about — the claim and the tier — and leave the booked
  // figures exactly as they are. Recomputing them from `gross` would be this
  // function quietly rewriting a number nobody asked it to.
  if (!saidHere) {
    return {
      tva_input_claimed: claiming,
      ...(tier === null ? {} : { evidence_tier: tier }),
    }
  }

  const rate = Number(input.rate)
  if (!Number.isFinite(rate) || !(VAT_RATES as readonly number[]).includes(rate)) {
    throw new TvaRefused(
      'bad_tva_rate',
      `${input.rate}% is not a Swiss VAT rate`,
      `one of ${VAT_RATES.join(', ')} (art. 25 LTVA)`
    )
  }

  const derived = tvaOnGross(gross, rate)
  let amount = derived
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    if (!/^\d+(\.\d{1,2})?$/.test(input.amount)) {
      throw new TvaRefused('bad_tva_amount', `"${input.amount}" is not an amount`, 'e.g. 6.74')
    }
    // The supplier's own figure wins, unless it cannot be right.
    if (Math.abs(Number(input.amount) - Number(derived)) > 0.01) {
      throw new TvaRefused(
        'tva_amount_mismatch',
        `${input.amount} is not ${rate}% of a TTC gross of ${gross} — that would be ${derived}`,
        'check the rate and the amount against the invoice; a difference over one rappen is a misread, not rounding'
      )
    }
    amount = Number(input.amount).toFixed(2)
  }

  if (claiming && tier !== 'full') {
    throw new TvaRefused(
      'claim_needs_full_evidence',
      'input tax may only be claimed on an entry whose evidence is complete (art. 28 al. 1 LTVA)',
      'pass --evidence-tier full once the pièce is on file, or attach it with `bk books piece match` and claim afterwards'
    )
  }

  return {
    tva_rate: rate.toFixed(2),
    tva_amount: amount,
    tva_input_claimed: claiming,
    ...(tier !== null ? { evidence_tier: tier } : {}),
  }
}
