// The dictionary type and the lookup — and the reason a missing translation is
// a compile error rather than a blank on screen.
//
// ===========================================================================
// THE TYPED KEY SET IS THE REAL GUARDRAIL
// ===========================================================================
// A translated app decays one string at a time and nothing goes red. A text
// scan can catch a hardcoded string in a component (and this repo has one), but
// a scan's granularity is part of what it checks — finding #11 in CLAUDE.md is
// two inert versions of one scan written in a single sitting. The stronger half
// is structural:
//
//     const en = { 'nav.overview': 'Overview', … } as const
//     export type BooksKey = keyof typeof en
//     export const DICTIONARY: Dictionary<BooksKey> = { en, fr }
//
// `Record<Locale, Record<K, string>>` makes `fr` owe EVERY key `en` declares.
// Adding an English string and forgetting the French one does not render a
// blank — it fails `tsc`. That needs no scan, cannot be worded wrongly, and
// cannot go inert.
//
// Flat dot-separated keys rather than nested objects, because `keyof typeof en`
// over a nested literal is a recursive type gymnastics exercise that buys
// nothing: the dots already group.

import type { Locale } from './locale'

/**
 * Every locale's table, over one app's key set.
 *
 * `Record<Locale, …>` and not `Partial<>`: a language the platform serves but
 * an app has not translated is not a state this type allows, because the
 * alternative is a screen that is half one language. Adding a locale to
 * `LOCALES` is therefore a compile error in every app until that app has the
 * words — which is the correct amount of friction for adding a language.
 */
export type Dictionary<K extends string> = Record<Locale, Record<K, string>>

/** Values a `{placeholder}` can be filled with. */
export type TranslateVars = Record<string, string | number>

export type Translate<K extends string> = (key: K, vars?: TranslateVars) => string

/**
 * Bind a dictionary and a locale into the `t()` a surface calls.
 *
 * ── INTERPOLATION IS `{name}`, AND IT IS NOT A TEMPLATE LITERAL ────────────
 * `t('worklist.count', { n: 12 })` against `'{n} items to resolve'`. The
 * alternative — building the sentence by concatenation at the call site —
 * produces a string the hardcoded-string scan cannot see and a word order
 * French cannot change. Word order is most of what translating a sentence IS,
 * so the whole sentence has to be one entry.
 *
 * ── A MISSING KEY RENDERS THE KEY ──────────────────────────────────────────
 * Not an empty string, and not a thrown error. The key set is typed, so this
 * can only be reached by a value cast or by a dictionary loaded at runtime; in
 * both cases `nav.overview` on screen is a bug somebody reports in a sentence,
 * and a blank is a bug nobody can describe.
 */
export function createTranslator<K extends string>(
  dictionary: Dictionary<K>,
  locale: Locale
): Translate<K> {
  const table = dictionary[locale]
  return (key, vars) => {
    const raw = table?.[key]
    if (raw === undefined) return key
    if (!vars) return raw
    return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
      // An unfilled placeholder stays as written rather than becoming
      // "undefined" — same reasoning as the missing key above.
      name in vars ? String(vars[name]) : whole
    )
  }
}
