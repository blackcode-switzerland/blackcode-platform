// @blackcode/platform-i18n — the interface-language mechanism.
//
// The package holds the vocabulary, the resolution order, the typed dictionary
// lookup and the two readers. **Every string belongs to an app.** See README.md
// beside this directory for how a second app adopts it.
//
// ── THE BARREL IS PURE, AND THAT IS LOAD-BEARING ───────────────────────────
// Only `./locale` and `./dictionary` come through here. Neither `./server` nor
// `./client` does, and neither may:
//
//   `./server` imports `next/headers`, which THROWS in a client component;
//   `./client` carries `'use client'`, which drags a client boundary into any
//   server component that only wanted `resolveLocale`.
//
// A client module importing `Locale` from the barrel is the ordinary case, so
// the barrel has to be safe there. Import the two readers by their own
// subpaths: `@blackcode/platform-i18n/server`, `@blackcode/platform-i18n/client`.

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  parseAcceptLanguage,
  parseLocale,
  resolveLocale,
  type Locale,
} from './locale'

export {
  createTranslator,
  type Dictionary,
  type Translate,
  type TranslateVars,
} from './dictionary'
