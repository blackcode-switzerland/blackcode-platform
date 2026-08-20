'use client'

// b/books' typed `t()`, and the two hooks every component uses.
//
// ===========================================================================
// WHY THIS ONE-LINE FILE EXISTS
// ===========================================================================
// `useTranslate<K>()` in `@blackcode/platform-i18n/client` is generic because
// the provider is one context type for every app and cannot carry a particular
// app's key union. Calling it un-parameterised gives `Translate<string>`, which
// type-checks *any* string — so `t('nav.overvieww')` would compile and render
// the key.
//
// Binding it once, here, is what makes a mistyped or deleted key a compile
// error at every call site in this app. Every component imports `useT` from
// here and never from the package.
//
// ── THE DICTIONARY IS IMPORTED, NOT SERIALISED ─────────────────────────────
// `<BooksLocaleProvider>` below imports `DICTIONARY` in a CLIENT module, so it
// is bundled. Passing it down from the server layout instead would put every
// string of every language into the RSC payload of every page — twice the copy
// for none of the benefit, since the bundle is cached and the payload is not.
// Only the resolved `locale` crosses the boundary.

import { LocaleProvider, useLocale, useTranslate } from '@blackcode/platform-i18n/client'
import type { Locale, Translate } from '@blackcode/platform-i18n'
import { DICTIONARY, type BooksKey } from './dictionary'

/** `t('nav.overview')` — the key set is this app's, checked at compile time. */
export function useT(): Translate<BooksKey> {
  return useTranslate<BooksKey>()
}

export { useLocale }
export type { Locale }

export function BooksLocaleProvider({
  locale,
  children,
}: {
  locale: Locale
  children: React.ReactNode
}) {
  return (
    <LocaleProvider initialLocale={locale} dictionary={DICTIONARY}>
      {children}
    </LocaleProvider>
  )
}
