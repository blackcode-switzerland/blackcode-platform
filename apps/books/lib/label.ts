// Which half of a `{fr, en}` pair a surface shows — and the answer is not the
// same everywhere, which is why this is two functions and not one.
//
// ===========================================================================
// DECISION D-A: ENGLISH CHROME, FRENCH LAW
// ===========================================================================
// b/books has no i18n system and no language toggle. The interface is English.
// French survives in exactly one place: **the statutory line labels of the bilan
// and the compte de résultat**, which are the wording of art. 959a and 959b CO
// and which the filed PDF has to reproduce. Those are not translated, ever.
//
// Every text field on the wire is `{fr, en}` because the backend types it that
// way, so the choice is made per SURFACE rather than per field:
//
//   `en(label)`     chrome. Account names, explanations, notes, evidence text.
//   `legal(label)`  the statutory line list. Returns the French, deliberately.
//
// The two are separate functions rather than one with a flag so that a reader of
// a component can see which claim it is making. `legal()` appearing anywhere
// outside `<StatementTable>` is a thing to question.
//
// **Adding French later is a render change, not a migration** — every pair is
// already on the wire. That is why D-A judged the cost of being wrong low.

import type { StatementLabel } from './statements'

/**
 * The English gloss — the interface language.
 *
 * Falls back to the French when there is no English side, because a missing
 * gloss must not render as an empty cell: an untranslated label is still the
 * label, and a blank is a row the reader cannot identify.
 */
export function en(label: StatementLabel | null | undefined): string {
  if (!label) return ''
  return label.en || label.fr || ''
}

/**
 * The statutory wording. **French, and that is not an oversight.**
 *
 * Only the balance sheet and income statement line and group names go through
 * here. `art. 959a` fixes them; a translated bilan is not the bilan that gets
 * filed. `<StatementTable>` shows the English gloss beside it as a subtitle so
 * an English-reading operator is not stuck, but the legal text is the line.
 */
export function legal(label: StatementLabel | null | undefined): string {
  if (!label) return ''
  return label.fr || label.en || ''
}

// ===========================================================================
// AN ACCOUNT'S LABEL IS NOT A `StatementLabel`, AND `en()` CANNOT READ ONE
// ===========================================================================
// `publicAccount` serves `{ fr, enSuffix }` — the mockup's key name, carried
// through `lib/chart.ts` unchanged. Handed one of those, `en()` above finds no
// `.en`, falls back to `.fr`, and renders **the French** on an English screen.
// Nothing throws, nothing is blank, and decision D-A is broken on every account
// name in the chart and under every income-statement line.
//
// Found 2026-08-18 by reading `GET …/accounts` rather than `lib/types.ts`, which
// declared the wrong shape. These two functions exist so the mistake is a
// compile error: `AccountLabel` is not assignable to `StatementLabel`, so a call
// site that reaches for `en()` will not build.

import type { AccountLabel } from './types'

/** The English gloss of an account name. Falls back to the French, as `en()` does. */
export function accountLabelEn(label: AccountLabel | null | undefined): string {
  if (!label) return ''
  return label.enSuffix || label.fr || ''
}

/** The account's French name, which is what the chart of accounts is written in. */
export function accountLabelFr(label: AccountLabel | null | undefined): string {
  if (!label) return ''
  return label.fr || label.enSuffix || ''
}
