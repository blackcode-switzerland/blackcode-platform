// The server half of b/books' i18n, bound to this app's dictionary.
//
// A separate module from `lib/i18n.tsx` because that one carries `'use client'`:
// importing anything from it inside a server layout would drag a client
// boundary in, and importing `next/headers` from it would throw. The split is
// the package's own (`@blackcode/platform-i18n/server` vs `/client`), reflected
// here so no caller has to remember which is which.
//
// There are few callers by design — b/books' screens are client components and
// use `useT()`. What is here is the chrome a SERVER layout renders before any of
// them mount: the `<html lang>`, and the titles a layout hands to `<BooksShell>`
// for a subtree the nav table cannot name.

import { getLocale, serverTranslator } from '@blackcode/platform-i18n/server'
import type { Translate } from '@blackcode/platform-i18n'
import { getValidatedSessionUser } from './auth/session'
import { DICTIONARY, type BooksKey } from './dictionary'

/** The request's locale, from the session row first. See the package's README. */
export async function booksLocale() {
  const user = await getValidatedSessionUser()
  return getLocale(user?.locale ?? null)
}

/** `t()` for a server component. Resolves the locale itself. */
export async function serverT(): Promise<Translate<BooksKey>> {
  return serverTranslator(DICTIONARY, await booksLocale())
}
