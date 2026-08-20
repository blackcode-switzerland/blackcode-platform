// Recognition: the one place judgment lives, reduced to a pure function.
//
// ===========================================================================
// THE MATCH KEY IS THE PAIR. NEVER THE MERCHANT NAME ALONE.
// ===========================================================================
// The same merchant can appear on a card this workspace tracks and a card it
// does not. Matching on the name alone would file money from an untracked
// source as if it were understood, and the completeness signal — "everything
// on this screen is explained" — would be quietly lying. So a rule matches
// only when the SOURCE matches too (phase-2-recognition.md, Notes).
//
// The seeded data proves the point: entry 1009 (UBS, "no identifiable
// counterparty") sits one landlord away from rule 101, and matches nothing,
// because 101 is keyed to the WIR account. That is the pair working.
//
// ===========================================================================
// `matched_rule_id` HAS TWO PROVENANCES, AND THE MATCHER COVERS ONE
// ===========================================================================
// An entry is linked to a rule either because the matcher fired, or because a
// HUMAN resolved the entry and the resolution TAUGHT the rule
// (`rule.created_from_entry_id` points back). Seeded entry 1001 is the second
// kind: it arrived unrecognized through the frozen UBS account, Andrea said
// "that's the rent", and rule 101 was born keyed to the WIR account where rent
// is paid from NOW. 1001 does not satisfy `matchesRule` against 101 and never
// will. `recognition.test.ts` encodes exactly this: matched entries satisfy
// the matcher OR taught their rule, nothing else.
//
// ===========================================================================
// WHERE MATCHING RUNS, THIS PHASE AND NEXT
// ===========================================================================
// Phase 2 has no ingest: entries arrive by seed, and phase 3 brings the
// endpoint. So "the next match applies automatically" means: the WORKLIST
// computes candidate matches live for every unrecognized row (`suggestFor`),
// and resolve can accept one. Phase 3's ingest reuses `matchesRule` verbatim
// at arrival time — same function, earlier moment.
//
// Everything here is pure: rows in, verdicts out, no database. Amounts arrive
// as the fixed-2 strings `numeric(14,2)` produces and are compared in
// centimes, because a tolerance check through floats would wobble at exactly
// the rappen this app promises not to lose.

import { toCentimes } from './index'
import type { Money } from '../types'

/** The slice of an entry the matcher reads. */
export interface MatchableEntry {
  source_id: number | null
  raw_label: string
  /** Sum of debit lines, the movement a bank line describes. */
  lines: { debit: Money | number; credit: Money | number }[]
}

/** The slice of a rule the matcher reads. `pattern` is the jsonb column. */
export interface MatchableRule {
  source_id: number | null
  active: boolean
  pattern: {
    counterparty?: string | null
    amount_chf?: number | null
    tolerance_chf?: number | null
    /** Documented cadence (monthly, quarterly, weekly). NOT matched on — see below. */
    interval?: string | null
  } | null
}

/** Total debit movement of an entry, in centimes. */
export function entryAmount(entry: Pick<MatchableEntry, 'lines'>): bigint {
  let total = 0n
  for (const l of entry.lines) total += toCentimes(typeof l.debit === 'number' ? l.debit : l.debit)
  return total
}

/**
 * Does this rule explain this entry?
 *
 * Three tests, all required (phase-2-recognition.md, Build):
 *
 *   1. SOURCE PAIR EQUALITY. Strict: `null` equals `null`, which is what lets
 *      the RI's rule 107 (no source register yet) match its sourceless
 *      entries, and nothing else.
 *   2. COUNTERPARTY SUBSTRING on the raw label, case-insensitive, because bank
 *      labels are uppercase noise and the pattern is a human-typed fragment.
 *   3. AMOUNT WITHIN TOLERANCE, only when the pattern sets an amount. A null
 *      amount means "any" (rule 104, Stripe payouts, varies weekly). A null
 *      tolerance with a set amount means exact.
 *
 * `interval` is deliberately NOT matched. It documents the expected cadence
 * for a human and for phase 4's "expected but missing" analysis; refusing a
 * rent payment because it arrived twice in one month would hide exactly the
 * anomaly a bookkeeper needs to see.
 */
export function matchesRule(entry: MatchableEntry, rule: MatchableRule): boolean {
  if (!rule.active) return false
  if (entry.source_id !== rule.source_id) return false

  const cp = rule.pattern?.counterparty
  if (!cp) return false // a rule with no counterparty fragment explains nothing
  if (!entry.raw_label.toUpperCase().includes(cp.toUpperCase())) return false

  const amount = rule.pattern?.amount_chf
  if (amount !== null && amount !== undefined) {
    const tolerance = rule.pattern?.tolerance_chf ?? 0
    const diff = entryAmount(entry) - toCentimes(amount)
    const abs = diff < 0n ? -diff : diff
    if (abs > toCentimes(tolerance)) return false
  }

  return true
}

/**
 * The rules that would explain this entry, for the worklist's suggestion
 * column. Order preserved from the caller (rule #number order), because when
 * two rules both match, the human resolving picks — the machine never does.
 */
export function suggestFor<R extends MatchableRule>(entry: MatchableEntry, rules: R[]): R[] {
  return rules.filter((r) => matchesRule(entry, r))
}

/** The recognition states that belong on the worklist. */
export const WORKLIST_STATES = ['unrecognized', 'inferred'] as const

/**
 * Does this row need a human? Everything unrecognized or inferred.
 *
 * `inferred` is on the list ON PURPOSE: an inference is a guess the system
 * wrote down, and a guess that never meets a human hardens into a fact nobody
 * ever confirmed. Seeded entry 1011 (Notion, staged, no rule) is the case.
 */
export function needsHuman(row: { recognition: string }): boolean {
  return (WORKLIST_STATES as readonly string[]).includes(row.recognition)
}
