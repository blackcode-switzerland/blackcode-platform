// The resolution order, and the three ways it has been got wrong on paper.
//
// `@blackcode/platform-i18n` is a MECHANISM package: it holds no product copy,
// so there is nothing in it to review by reading. What there is, is one ordering
// decision that two apps must not disagree about —
//
//     user record → cookie → Accept-Language → default
//
// — and three rules that make that ordering mean anything. All four are here
// rather than in an app, because an app adopting this package inherits them and
// should not have to re-derive them.
//
// ── WHY THIS FILE IS IN platform-testing ──────────────────────────────────
// `platform-i18n` has no test runner of its own, the same way `platform-db` and
// `platform-auth` do not. `packages/platform-testing` is where the repo puts a
// package-level guard (see `package-isolation.test.ts`), and it already runs in
// `npm test`.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  createTranslator,
  parseAcceptLanguage,
  parseLocale,
  resolveLocale,
} from '@blackcode/platform-i18n'

describe('the vocabulary', () => {
  it('is not empty and every member has a name in its own language', () => {
    // The input assertion. An empty `LOCALES` makes every case below vacuous,
    // and `LOCALE_NAMES` missing a member renders a blank option in a picker.
    expect(LOCALES.length).toBeGreaterThan(1)
    for (const loc of LOCALES) {
      expect(LOCALE_NAMES[loc], `${loc} has no name`).toBeTruthy()
    }
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })

  it('names each language IN ITSELF', () => {
    // A picker that says "French" to somebody who does not read English is a
    // picker they cannot use. This is the one property of `LOCALE_NAMES` worth
    // asserting, and it is asserted by example rather than by a rule, because
    // the rule ("in its own language") is not machine-checkable.
    expect(LOCALE_NAMES.fr).toBe('Français')
    expect(LOCALE_NAMES.en).toBe('English')
  })
})

describe('parseLocale — an unknown value FALLS THROUGH, it does not default', () => {
  it('narrows what it knows', () => {
    expect(parseLocale('fr')).toBe('fr')
    expect(parseLocale('EN')).toBe('en')
    expect(parseLocale('fr-CH')).toBe('fr')
    expect(parseLocale('fr_CH')).toBe('fr')
  })

  it('answers null — NOT the default — for anything else', () => {
    // This is the property `platform.users.locale` has no CHECK constraint
    // because of. A row holding 'de' has to reach the reader's COOKIE, not
    // English: answering `DEFAULT_LOCALE` here would end the chain at step one
    // and make a stale stored value indistinguishable from a chosen one.
    for (const value of ['de', 'it', '', '   ', null, undefined, 'english']) {
      expect(parseLocale(value), `parseLocale(${JSON.stringify(value)})`).toBeNull()
    }
  })
})

describe('parseAcceptLanguage', () => {
  it('is quality-ordered, not document-ordered', () => {
    // `en` appears first and French wins, because q says so. A naive reader that
    // took the first tag it recognised would answer English here — and this
    // header is what a French-speaking colleague's browser actually sends.
    expect(parseAcceptLanguage('en;q=0.8, fr;q=0.9')).toBe('fr')
    expect(parseAcceptLanguage('fr-CH,fr;q=0.9,en;q=0.8')).toBe('fr')
  })

  it('treats a range with no q as q=1, per the spec', () => {
    expect(parseAcceptLanguage('fr, en;q=0.9')).toBe('fr')
    expect(parseAcceptLanguage('en, fr;q=0.9')).toBe('en')
  })

  it('ignores q=0, which means "not this one"', () => {
    expect(parseAcceptLanguage('fr;q=0, en;q=0.5')).toBe('en')
  })

  it('answers null for a header naming nothing we serve', () => {
    expect(parseAcceptLanguage('de-CH, it;q=0.9')).toBeNull()
    expect(parseAcceptLanguage('')).toBeNull()
    expect(parseAcceptLanguage(null)).toBeNull()
  })
})

describe('resolveLocale — the order, asserted one step at a time', () => {
  it('the user record beats everything', () => {
    // A colleague signing in on a borrowed laptop must not inherit its owner's
    // language, and must not be handed the browser's either.
    expect(
      resolveLocale({ user: 'fr', cookie: 'en', acceptLanguage: 'en' })
    ).toBe('fr')
  })

  it('the cookie beats Accept-Language', () => {
    // The cookie is still a CHOICE — made in this product, while signed out.
    // `Accept-Language` is a browser setting nobody may ever have looked at.
    expect(resolveLocale({ user: null, cookie: 'fr', acceptLanguage: 'en' })).toBe('fr')
  })

  it('Accept-Language is reachable, which is the whole point of the nullable column', () => {
    // THE CASE THE COLUMN'S NULLABILITY EXISTS FOR. If `platform.users.locale`
    // had been `NOT NULL DEFAULT 'en'`, step one would answer for every account
    // that already exists and this line could never be reached in production.
    // Migration 0048's header is the other half of this assertion.
    expect(
      resolveLocale({ user: null, cookie: null, acceptLanguage: 'fr-CH,fr;q=0.9' })
    ).toBe('fr')
  })

  it('falls to the default only when nothing answered', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ user: null, cookie: null, acceptLanguage: null })).toBe(DEFAULT_LOCALE)
  })

  it('a stored value nobody recognises degrades to the next source, never to the default', () => {
    // The composition of the two rules above, and the one that is easy to get
    // wrong: a row holding 'de' must reach the cookie.
    expect(resolveLocale({ user: 'de', cookie: 'fr' })).toBe('fr')
    expect(resolveLocale({ user: 'de', cookie: 'de', acceptLanguage: 'fr' })).toBe('fr')
    expect(resolveLocale({ user: 'de', cookie: 'de', acceptLanguage: 'de' })).toBe(DEFAULT_LOCALE)
  })
})

describe('createTranslator', () => {
  const dict = {
    en: { greeting: 'Hello {name}', plain: 'Plain' },
    fr: { greeting: 'Bonjour {name}', plain: 'Simple' },
  }

  it('resolves from the locale it was bound to', () => {
    expect(createTranslator(dict, 'fr')('plain')).toBe('Simple')
    expect(createTranslator(dict, 'en')('plain')).toBe('Plain')
  })

  it('interpolates {name}', () => {
    expect(createTranslator(dict, 'fr')('greeting', { name: 'Bala' })).toBe('Bonjour Bala')
    expect(createTranslator(dict, 'en')('greeting', { name: 12 })).toBe('Hello 12')
  })

  it('renders the KEY for a key it does not have, never a blank', () => {
    // A blank is a bug nobody can describe; `nav.overview` on screen is a bug
    // somebody reports in a sentence. Only reachable through a cast or a
    // runtime-loaded dictionary — the key set is a union type — which is
    // exactly why the failure mode has to be legible.
    const t = createTranslator(dict, 'en') as (k: string) => string
    expect(t('missing.key')).toBe('missing.key')
  })

  it('leaves an unfilled placeholder as written, never as "undefined"', () => {
    expect(createTranslator(dict, 'en')('greeting', {})).toBe('Hello {name}')
    expect(createTranslator(dict, 'en')('greeting')).toBe('Hello {name}')
  })
})
