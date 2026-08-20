'use client'

// The locale in the client tree: one provider, one `useLocale`, one translator.
//
// ===========================================================================
// THE PROVIDER IS SEEDED FROM THE SERVER AND THEN OWNS THE VALUE
// ===========================================================================
// `initialLocale` is what the server resolved for this request, so the first
// paint is already right and nothing swaps after mount. After that the value is
// STATE, because a person who switches language must see it change without a
// reload — and the write to `platform.users.locale` that makes it durable is
// the app's business (`lib/account.ts` in b/books), not this package's.
//
// The dictionary is a PROP rather than something this package fetches or
// registers, and the app is expected to `import` it in a client module so it is
// bundled rather than serialised across the RSC boundary. Passing it down from
// a server component would put every string of every language into the payload
// of every page.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createTranslator, type Dictionary, type Translate } from './dictionary'
import { DEFAULT_LOCALE, type Locale } from './locale'

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  // Stored as `Translate<string>`: the context cannot carry an app's key union
  // (it is one context type for every app), so the narrowing happens at the
  // hook, where the app names its own key set. See `useTranslate` below.
  t: Translate<string>
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider<K extends string>({
  initialLocale,
  dictionary,
  children,
}: {
  initialLocale: Locale
  dictionary: Dictionary<K>
  children: React.ReactNode
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale)

  // ── `<html lang>` FOLLOWS THE SWITCH, AND THIS IS NOT THE FLASH ────────────
  // The server already stamped the correct `lang` for this request, so on first
  // paint this effect writes the value that is already there. What it exists for
  // is the CLICK: a reader who switches to French without navigating leaves the
  // document announcing `lang="en"`, and a screen reader then reads French text
  // in an English voice — the half of "half translated" a sighted reviewer
  // cannot see. Measured on 2026-08-20: every visible string changed and
  // `document.documentElement.lang` did not.
  //
  // This is deliberately the ONLY effect in this package. It does not choose or
  // change the language; it copies a value React already holds onto an element
  // React does not own.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(dictionary, locale) as Translate<string>,
    }),
    [dictionary, locale]
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * The locale, and the setter that changes it for the whole tree.
 *
 * **Throws outside a provider rather than answering `DEFAULT_LOCALE`.** A
 * silent default here is a subtree that renders English inside a French page
 * and nothing goes red — the exact decay this package exists to prevent.
 */
export function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>')
  return ctx
}

export function useLocale(): Locale {
  return useLocaleContext().locale
}

/**
 * `t()`, narrowed to the calling app's key set.
 *
 * An app writes one line — `export const useT = () => useTranslate<BooksKey>()`
 * — and every component below it gets a `t()` whose argument is checked at
 * compile time. Calling this un-parameterised gives `Translate<string>`, which
 * type-checks anything and is therefore the shape to avoid.
 */
export function useTranslate<K extends string>(): Translate<K> {
  return useLocaleContext().t as Translate<K>
}

export { DEFAULT_LOCALE }
