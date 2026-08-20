// Which half of a `{fr, en}` pair a surface shows — and the answer is not the
// same everywhere, which is why this is four functions and not one.
//
// ===========================================================================
// D-A WAS REWRITTEN ON 2026-08-20. THIS FILE IS WHERE IT LANDS.
// ===========================================================================
// The old D-A said: English chrome, no i18n system, no language toggle, French
// surviving only in the statutory line labels. b/books now has a real language
// switch on the shared `platform.users.locale` column, so the first half of that
// is gone and **the second half is unchanged and is the reason this file still
// has more than one function.**
//
// Three kinds of text arrive as `{fr, en}` and they are not the same problem:
//
//   `pick(locale, l)`  CHROME. Account names, explanations, notes, evidence
//                      text. Follows the reader's language.
//   `legal(l)`         THE STATUTE'S OWN WORDING. Returns the French in BOTH
//                      languages, deliberately — art. 959a and 959b fix these
//                      strings and the filed document reproduces them. A
//                      translated bilan is not the bilan that gets filed.
//   `en(l)`            THE ENGLISH SIDE, specifically. One caller:
//                      `<StatementTable>`'s gloss under a statutory line, for a
//                      reader who does not read French. Not "the interface
//                      language" — see below.
//   `speech(v)`        A record's own words, verbatim as filed.
//
// ── `en()` DID NOT BECOME LOCALE-AWARE, AND THAT IS DELIBERATE ─────────────
// The obvious change was to make `en()` return the reader's language and be
// done. It was rejected for two reasons, and the second is the one that matters:
//
//   1. `en()` genuinely means "the English side" at its one remaining call site
//      — the gloss beside a French statutory line. Widening it there would
//      produce a French line glossed with the same French words.
//   2. **`lib/analysis.test.ts` asserts on `en()`.** Redefining a function under
//      an assertion that keeps passing is CLAUDE.md finding #10 — a correct
//      change silently retargeting a guard, which then keeps passing and stops
//      guarding. The test still checks what it was written to check because the
//      function still means what it meant.
//
// So this is a WIDENING and not a rename: `pick()` is new, `en()` is untouched,
// and the call sites that meant "the interface language" moved to `useLabel()`
// in `lib/use-label.ts`.
//
// ── ANYTHING EXPORTED OR FILED IS FRENCH, WHATEVER THE READER CHOSE ────────
// There is no export or PDF today. When there is, it takes `legal()` for the
// line list and the FRENCH document name, and it does not consult the locale at
// all. The reader's setting is about reading; a filing is about filing. Written
// here as well as in `DECISIONS.md` because this is the file an export would
// import.

import type { Locale } from '@blackcode/platform-i18n'
import type { StatementLabel } from './statements'

/**
 * The reader's language, with the other side as the fallback.
 *
 * A missing side must not render as an empty cell: an untranslated label is
 * still the label, and a blank is a row the reader cannot identify. That rule
 * predates the language switch and is why `en()` has always fallen back to the
 * French; `pick()` inherits it in both directions.
 *
 * Takes the locale rather than calling a hook, so it is usable from a server
 * component, from a `useMemo`, and from a test. `useLabel()` is the hook wrapper
 * a component actually calls.
 */
export function pick(locale: Locale, label: StatementLabel | null | undefined): string {
  if (!label) return ''
  return (locale === 'fr' ? label.fr || label.en : label.en || label.fr) || ''
}

/**
 * The English side, specifically — **not "the interface language"**.
 *
 * One caller since 2026-08-20: `<StatementTable>`'s gloss under a French
 * statutory line, which exists for a reader who does not read French and is
 * therefore not rendered at all for one who does. `pick()` is what a surface
 * showing chrome wants.
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
 *
 * **The language switch does not reach this function**, and that is the whole
 * of what survives of D-A. A French reader sees the same string an English
 * reader sees, because it is not English or French to them — it is the wording
 * of the article.
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
