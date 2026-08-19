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
/**
 * `note` states whether a source of this type is expected to feed a ledger
 * account — SERVED so clients render the true sentence per type instead of
 * inventing one. The phase-3 review caught PostFinance (a bank) being told
 * that having no ledger account "is normal for a card, a processor or a
 * Drive folder": for a bank it is a gap worth explaining, never a normal
 * state, and only the vocabulary can say which is which.
 */
export const SOURCE_TYPES: Term[] = [
  { value: 'bank', label: 'Bank', icon: 'landmark', note: 'Holds the money and feeds a ledger account. A bank source with no ledger account is a gap to explain, not a normal state.' },
  { value: 'card', label: 'Card', icon: 'credit-card', note: 'Draws on a bank and settles there; it may carry no ledger account of its own.' },
  { value: 'processor', label: 'Payment processor', icon: 'repeat', note: 'Sits in front of a bank and settles into it; it may carry no ledger account of its own.' },
  { value: 'saas', label: 'SaaS spend', icon: 'app-window', note: 'A routing layer that documents spend; it settles elsewhere and carries no ledger account.' },
  { value: 'drive_folder', label: 'Drive folder', icon: 'folder', note: 'A document feed. No money moves here, so no ledger account, ever.' },
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

/**
 * The Devil's Advocate's verdict vocabulary (0014). `blocked` is the only one
 * the server acts on: it refuses to post. Warned entries post and stay
 * visible; nothing is silently accepted (compliance/DEVILS-ADVOCATE-AGENT.md).
 */
export const VERDICT_STATES: Term[] = [
  { value: 'accepted', label: 'Accepted', color: '#3fb27f' },
  { value: 'accepted_with_warning', label: 'Accepted with warning', color: '#f0b66b' },
  { value: 'blocked', label: 'Blocked', color: '#ef6f6f' },
]

/** A rule's review lifecycle. Rules are BORN draft; review never goes back. */
export const RULE_REVIEW_STATES: Term[] = [
  { value: 'draft', label: 'Draft — not fiduciary-reviewed', color: '#f0b66b' },
  { value: 'approved', label: 'Approved', color: '#3fb27f' },
  { value: 'edited', label: 'Edited — corrected wording applies', color: '#3fb27f' },
  { value: 'rejected', label: 'Rejected', color: '#ef6f6f' },
]

/** Where a rule's legal claim comes from, and how far to trust it unreviewed. */
export const RULE_CONFIDENCE: Term[] = [
  { value: 'verified_fedlex', label: 'Verified against Fedlex', color: '#3fb27f' },
  { value: 'doctrine_inferred', label: 'Inferred from doctrine', color: '#f0b66b' },
  { value: 'needs_fiduciary_check', label: 'Needs a fiduciary check', color: '#ef6f6f' },
]
