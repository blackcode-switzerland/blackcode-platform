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
 * A record's SPEECH, verbatim as filed: a bare string or a `{fr, en}` pair
 * with either side present. The analyse door has accepted both since 4B
 * (`speaks()`), and real agents file bare strings — analyses #3 through #6
 * rendered as empty headlines on the journal until this reader existed,
 * because `en()` on a string finds no `.en` and answers ''.
 *
 * For statement labels — configuration, always `{fr, en}` — keep `en()`.
 */
export function speech(v: string | { fr?: string; en?: string } | null | undefined): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  return v.en || v.fr || ''
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
// ACCOUNT LABELS: A CLOSED CASE, KEPT FOR ITS LESSON
// ===========================================================================
// Until 2026-08-19 `publicAccount` served the mockup's `{fr, enSuffix}` and
// `en()` silently rendered the FRENCH on an English screen — two dedicated
// helpers (`accountLabelEn` / `accountLabelFr`) existed here to make the
// mismatch a compile error. The backend now normalizes account labels to
// `{fr, en}` at the wire (phase-0-contract.md's shape), so an account label
// IS a `Label`, `en()` reads it like any other, and the helpers are gone.
