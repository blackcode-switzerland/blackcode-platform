// The vocabulary, and the order in which four sources are consulted.
//
// ===========================================================================
// THIS PACKAGE HOLDS THE MECHANISM. THE APP HOLDS THE STRINGS.
// ===========================================================================
// Nothing in here knows a word of any product's copy. `packages/platform-email`
// draws the same line — the app supplies its identity, the package supplies the
// machinery — and it is the line docs/platform-architecture.md §7.6 states as a
// rule: *if you have to add a parameter to make it generic, leave it in the
// app.* A books-shaped option appearing in this file is the signal that the
// thing being written belongs in `apps/books/lib/`.
//
// It is deliberately NOT inside `platform-ui`. That package is React components;
// the locale is needed by server components, by route handlers, and eventually
// by email templates, and a dictionary that can only be read from a client
// component is a dictionary half the platform cannot use.

/** Every language the platform serves. Adding one is adding a member here. */
export const LOCALES = ['en', 'fr'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * What a reader gets when nothing else answers.
 *
 * English, because the platform's other two apps are English-only and the
 * shared chrome (`bk`, the changelog, every guide topic) is English by decision.
 */
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * The cookie the browser carries between the choice and the next request.
 *
 * Not the source of truth — `platform.users.locale` is — but the source that
 * works on the pages where there is no user: the login screen, the marketing
 * page, the password-reset flow. Somebody who switches to French, signs out and
 * lands on `/login` should not be greeted in English by a product that knows
 * better.
 */
export const LOCALE_COOKIE = 'bk_locale'

/** A year. It is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * The language's name IN ITSELF — "Français", never "French".
 *
 * A language picker that names a language in a language the reader does not
 * read is a picker they cannot use, which is the one thing it must not be.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
}

/**
 * A stored, cookied or negotiated string, narrowed — or `null`.
 *
 * **`null` rather than the default**, and that is the whole point of this
 * function. Every caller is a link in the resolution chain below, and a step
 * that answers `DEFAULT_LOCALE` for an unrecognised value has ENDED the chain:
 * a person whose row holds `'de'` would get English and never reach their
 * cookie or their `Accept-Language`. Returning null makes an unknown value a
 * *degradation* — it falls through to the next source — which is why
 * `platform.users.locale` needs no CHECK constraint (migration 0048's header).
 *
 * Case- and region-tolerant: `FR`, `fr-CH` and `fr_CH` are all French. The
 * column is varchar(5) so a region subtag can be stored one day; nothing writes
 * one today, and the base tag is what selects a dictionary either way.
 */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : null
}

/**
 * Pick a locale out of an `Accept-Language` header.
 *
 * Quality-ordered, as the header specifies: `fr;q=0.9, en;q=0.8` is French even
 * though English is a language we serve and appears later. A header we cannot
 * satisfy at all answers null and the chain continues.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      // A range with no `q` is q=1 by the spec, not q=0.
      const weight = q ? Number(q.slice(2)) : 1
      return { tag, weight: Number.isFinite(weight) ? weight : 0 }
    })
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
  for (const { tag } of ranked) {
    const hit = parseLocale(tag)
    if (hit) return hit
  }
  return null
}

/**
 * The four sources, in the one order the whole platform uses.
 *
 * ===========================================================================
 * user record → cookie → Accept-Language → default
 * ===========================================================================
 * Written once, here, so two apps cannot disagree about it — which they would,
 * because each of the three steps is individually defensible as the first one
 * and nobody would notice the products differing until somebody used both.
 *
 * **Why the record beats the cookie.** The record is the choice a person made
 * on purpose and expects to follow them; the cookie is per browser. A colleague
 * signing in on a borrowed laptop must not inherit its owner's language.
 *
 * **Why the cookie beats `Accept-Language`.** The cookie is still a choice —
 * made in this product, by this person, before they signed in (or while signed
 * out). `Accept-Language` is a browser setting they may never have looked at.
 *
 * **Why `Accept-Language` exists at all.** Because `user.locale` is NULLABLE and
 * means "never chosen" (migration 0048). Had that column been backfilled to
 * `'en'`, this step would be unreachable for every account that already exists,
 * and a French-speaking colleague opening the product for the first time would
 * be told English was their preference by a migration. The nullable column and
 * this step are one decision, not two.
 */
export function resolveLocale(sources: {
  /** `platform.users.locale`. Null means never chosen — not "chose English". */
  user?: string | null
  /** The `bk_locale` cookie value, if the request carried one. */
  cookie?: string | null
  /** The raw `Accept-Language` request header. */
  acceptLanguage?: string | null
}): Locale {
  return (
    parseLocale(sources.user) ??
    parseLocale(sources.cookie) ??
    parseAcceptLanguage(sources.acceptLanguage) ??
    DEFAULT_LOCALE
  )
}
