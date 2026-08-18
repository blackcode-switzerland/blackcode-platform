// The vocabularies: every closed set of values a b/books surface renders as a
// chip.
//
// ===========================================================================
// WHY THESE ARE SERVED AND NOT HARDCODED IN THE FRONTEND
// ===========================================================================
// They are DYNAMIC in this platform's sense: they can change without a release
// of the `bk` binary, so the rule is that no help text and no guide topic
// restates them — a reader runs `bk meta` instead. The same argument applies to
// the web: a component that hardcodes the four recognition states needs a deploy
// to gain a fifth.
//
// So the colour travels WITH the value. That is how the mockup does it, and it is
// worth keeping: the chip's appearance is a property of the vocabulary, not of a
// stylesheet that has to be kept in sync with it.
//
// ── EVIDENCE TIERS CARRY A LEGAL CONSEQUENCE, NOT A DESCRIPTION ────────────
// Their `note` is the reason the tier exists, and the two halves of it are
// independent: what happens for profit tax, and what happens for input VAT. Do
// not shorten these into a single sentence — a bank record can support a
// deduction and never supports a VAT claim, and collapsing that is how the
// system starts claiming input tax it is not entitled to.
//
// Text taken from the mockup (`fixtures/mockup.json`), English only for the
// interface. The French statutory wording that must survive is in
// lib/statements.ts, not here.

import type { Term } from './types'

/** Can the system explain this entry? The legibility core. */
export const RECOGNITION: Term[] = [
  { value: 'known_recurring', label: 'Known recurring', color: '#3fb27f' },
  { value: 'known_one_off', label: 'Known one-off', color: '#3fb27f' },
  { value: 'inferred', label: 'Inferred', color: '#f0b66b' },
  { value: 'unrecognized', label: 'Unrecognized', color: '#ef6f6f' },
]

/** Two independent legal consequences per tier, never merged. */
export const EVIDENCE_TIERS: Term[] = [
  {
    value: 'full',
    label: 'Full',
    color: '#3fb27f',
    note: 'Art. 26 LTVA-compliant document — deduction and input VAT safe.',
  },
  {
    value: 'partial',
    label: 'Partial',
    color: '#f0b66b',
    note: 'Bank record plus reconstructed plausibility — deduction likely (fiduciary sign-off needed), input VAT LOST.',
  },
  {
    value: 'bare',
    label: 'Bare',
    color: '#ef6f6f',
    note: 'Bank record only — reprise risk; input VAT lost; disguised-distribution risk if the counterparty is related.',
  },
]

/** `staged` never touches a balance; `posted` is immutable. */
export const ENTRY_STATUS: Term[] = [
  { value: 'posted', label: 'Posted', color: '#3fb27f' },
  { value: 'staged', label: 'Staged', color: '#f0b66b' },
]

/** Spend-side channels only. Income is b/billing's job. */
export const SOURCE_TYPES: Term[] = [
  { value: 'bank', label: 'Bank', icon: 'landmark' },
  { value: 'card', label: 'Card', icon: 'credit-card' },
  { value: 'processor', label: 'Payment processor', icon: 'repeat' },
  { value: 'saas', label: 'SaaS spend', icon: 'app-window' },
  { value: 'drive_folder', label: 'Drive folder', icon: 'folder' },
]

/**
 * Money reality has three layers, not a flat list: a bank holds the money, a card
 * draws on a bank, a routing app sits on top of a card and knows who the spend
 * was really for. Document feeds are layer-less.
 */
export const SOURCE_LAYERS: Term[] = [
  { value: 'bank', label: 'Layer 1 · Bank' },
  { value: 'card', label: 'Layer 2 · Card' },
  { value: 'routing_app', label: 'Layer 3 · Routing' },
]

/**
 * COMPUTED from cadence against the last import, never stored and never
 * hand-set. `retired` is the one exception, because it is a lifecycle fact
 * rather than a freshness judgement.
 */
export const SOURCE_STATUS: Term[] = [
  { value: 'current', label: 'Current', color: '#3fb27f' },
  { value: 'stale', label: 'Stale', color: '#f0b66b' },
  { value: 'gap', label: 'Gap detected', color: '#ef6f6f' },
  { value: 'never_connected', label: 'Never connected', color: '#7a8595' },
  { value: 'retired', label: 'Retired', color: '#7a8595' },
]

/** The document pipeline's state machine, in order. */
export const MANIFEST_STATES: Term[] = [
  { value: 'discovered', label: 'Discovered', color: '#7a8595' },
  { value: 'downloaded', label: 'Downloaded', color: '#7a8595' },
  { value: 'extracted', label: 'Extracted', color: '#f0b66b' },
  { value: 'validated_staged', label: 'Validated · staged', color: '#f0b66b' },
  { value: 'needs_review', label: 'Needs review', color: '#ef6f6f' },
  { value: 'ingested', label: 'Ingested', color: '#3fb27f' },
]

/**
 * Swiss VAT rates since 01.01.2024: 8.1% standard, 2.6% reduced, 3.8% lodging,
 * and 0 for exempt or out-of-scope.
 *
 * This is also the WHITELIST the document ingest endpoint validates against, and
 * that validation is re-run server-side rather than trusted from the extraction
 * worker. A rate outside this set means the extraction is wrong, not that a new
 * rate exists.
 */
export const TVA_RATES: number[] = [8.1, 2.6, 3.8, 0]
