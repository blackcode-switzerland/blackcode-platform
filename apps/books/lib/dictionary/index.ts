// b/books' words. **Every user-facing string in this app is in this directory.**
//
// ===========================================================================
// THE MECHANISM IS SHARED; THE STRINGS ARE OURS
// ===========================================================================
// `@blackcode/platform-i18n` holds the vocabulary, the resolution order and the
// lookup. It holds no product copy, and it never will: books' words are not
// sales' words, and a shared dictionary is a place where two products'
// vocabularies collide. Same split as `platform-email` (identity from the app,
// templates shared).
//
// ===========================================================================
// TWO GUARDS, AND THE STRONG ONE IS THE TYPE
// ===========================================================================
// A translated app decays one hardcoded string at a time and nothing goes red.
// Two things stop that here, and they catch different halves:
//
//   **The type** — `Dictionary<BooksKey>` is `Record<Locale, Record<K, string>>`,
//   so every area file's `fr` owes every key its `en` declares. An English
//   string added without its French does not render a blank; it fails `tsc`.
//   This cannot be worded wrongly and cannot go inert. It is the half to prefer
//   wherever it reaches.
//
//   **`lib/hardcoded-strings.test.ts`** — a text scan over `components/**` and
//   `app/**` for literals that never went through `t()`. It catches what the
//   type cannot: a string that was never added to the dictionary at all. Being
//   a text scan, its granularity is part of what it checks (CLAUDE.md finding
//   #11) and it states what it cannot see, in its own header.
//
// ── ONE FILE PER AREA ──────────────────────────────────────────────────────
// A single 600-key object is a file nobody reviews. Each area file owes both
// languages on its own, so the compile error lands next to the string that
// caused it. The spread below is what makes them one dictionary; a key defined
// in two areas is a silent overwrite, so
// `lib/hardcoded-strings.test.ts` asserts there are none.

import type { Dictionary } from '@blackcode/platform-i18n'

import { APP_NAME, CONTACT_EMAIL, PLATFORM_NAME } from '@/lib/app'

import * as analyses from './analyses'
import * as chrome from './chrome'
import * as compliance from './compliance'
import * as documents from './documents'
import * as ledger from './ledger'
import * as marketing from './marketing'
import * as nav from './nav'
import * as overview from './overview'
import * as recognition from './recognition'
import * as settings from './settings'
import * as sources from './sources'
import * as statements from './statements'
import * as taxes from './taxes'

/** Every area, in one list, so nothing below can name a subset by accident. */
const AREAS = [
  analyses,
  chrome,
  compliance,
  documents,
  ledger,
  marketing,
  nav,
  overview,
  recognition,
  settings,
  sources,
  statements,
  taxes,
] as const

const EN = {
  ...analyses.en,
  ...chrome.en,
  ...compliance.en,
  ...documents.en,
  ...ledger.en,
  ...marketing.en,
  ...nav.en,
  ...overview.en,
  ...recognition.en,
  ...settings.en,
  ...sources.en,
  ...statements.en,
  ...taxes.en,
}

/**
 * Every key this app can render.
 *
 * `t()` takes this union, so a typo in a key is a compile error and a key that
 * was deleted from the dictionary is a compile error at every call site. That
 * is the property the whole arrangement exists for.
 */
export type BooksKey = keyof typeof EN

// ── THE BRAND IS SUBSTITUTED HERE, ONCE, NOT AT EVERY CALL SITE ─────────────
// Ticket #756 (2026-09-23): a copy of this app runs under another company's
// name, so no area file may spell `b/books`, `blackcode` or `blackcode.ch`.
// They write `{app}`, `{platform}` and `{contactDomain}` instead, and this is
// where those three become `lib/app.ts`'s values — which are environment-driven
// and inlined at build time (`next.config.js` `env`, because this module is
// imported by a CLIENT module). Substituting here rather than in `t()` keeps
// every call site and the key type unchanged, and keeps `t()`'s own `{name}`
// placeholders (`{year}`, `{bk}`, …) for the caller, which is what they are for.
// `lib/no-brand-literal.test.ts` is what refuses a literal in an area file.
const BRAND: Record<string, string> = {
  app: APP_NAME,
  platform: PLATFORM_NAME,
  contactDomain: CONTACT_EMAIL.slice(CONTACT_EMAIL.indexOf('@') + 1),
}

function branded<K extends string>(table: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>
  for (const key of Object.keys(table) as K[]) {
    out[key] = table[key].replace(/\{(app|platform|contactDomain)\}/g, (_, name: string) => BRAND[name])
  }
  return out
}

export const DICTIONARY: Dictionary<BooksKey> = {
  en: branded(EN),
  fr: branded({
    ...analyses.fr,
    ...chrome.fr,
    ...compliance.fr,
    ...documents.fr,
    ...ledger.fr,
    ...marketing.fr,
    ...nav.fr,
    ...overview.fr,
    ...recognition.fr,
    ...settings.fr,
    ...sources.fr,
    ...statements.fr,
    ...taxes.fr,
  }),
}

/**
 * The areas, for the test beside this file.
 *
 * Exported rather than re-derived there, so a new area file that is imported
 * above but forgotten in the spread — or the reverse — is visible to the
 * assertion. A test that rebuilt this list from the filesystem would be checking
 * the filesystem; a test reading this list is checking what actually ships.
 */
export const DICTIONARY_AREAS: ReadonlyArray<{
  en: Record<string, string>
  fr: Record<string, string>
}> = AREAS
