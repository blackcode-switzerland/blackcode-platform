// Reading the locale where there is no React: server components, layouts, route
// handlers, and one day an email template.
//
// ===========================================================================
// THIS IS THE HALF THAT PREVENTS THE FLASH
// ===========================================================================
// The locale is on the session user, so the SERVER already knows it before it
// renders a byte. A page can therefore be correct on its first paint — which is
// strictly easier than the theme, which needs a blocking script because
// `localStorage` is unreachable from the server.
//
// **Do not solve it with a `useEffect` that swaps the language after mount.** A
// page that renders English and flips to French is worse than one that never
// offered the choice: it looks broken, it moves layout under the reader's eyes,
// and it announces the wrong language to a screen reader first.

import { cookies, headers } from 'next/headers'
import { createTranslator, type Dictionary, type Translate } from './dictionary'
import { LOCALE_COOKIE, resolveLocale, type Locale } from './locale'

/**
 * The request's locale.
 *
 * The app passes the one source this package cannot reach — the signed-in
 * person's `platform.users.locale` — and the two it can (the cookie and
 * `Accept-Language`) are read from the request here, because every Next app has
 * them in the same place. Nothing about the signature is app-shaped: an app
 * with no session at all passes `null` and gets the cookie/header/default
 * chain.
 *
 * `stored` is `string | null` and not `Locale | null` on purpose — it comes
 * straight out of a varchar column, and narrowing it is `parseLocale`'s job
 * inside `resolveLocale`, where an unrecognised value falls through instead of
 * ending the chain.
 */
export async function getLocale(stored: string | null | undefined): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  return resolveLocale({
    user: stored,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerList.get('accept-language'),
  })
}

/**
 * `t()` for a server component, given the app's dictionary.
 *
 * A plain function rather than a hook, because the callers are `async` server
 * components and route handlers where hooks do not exist. The client half is
 * `./client`.
 */
export function serverTranslator<K extends string>(
  dictionary: Dictionary<K>,
  locale: Locale
): Translate<K> {
  return createTranslator(dictionary, locale)
}
