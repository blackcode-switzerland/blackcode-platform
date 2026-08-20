# `@blackcode/platform-i18n`

The interface-language mechanism. **This package holds no product copy.**

Written for b/books on 2026-08-20, which is the first app on this platform to
need a language switch — but the preference lives on `platform.users`, one row
per person across every app, so a colleague who chooses French in books gets
French in sales the day sales adopts this.

## What it owns, and nothing more

| Thing | Where |
|---|---|
| The vocabulary — `Locale`, `LOCALES`, `DEFAULT_LOCALE` | `src/locale.ts` |
| The resolution order, written once | `src/locale.ts` → `resolveLocale` |
| The dictionary type and the typed lookup | `src/dictionary.ts` |
| Server reader — layouts, route handlers, email | `src/server.ts` |
| Client provider and hooks | `src/client.tsx` |

**Each app supplies its own dictionary.** Books' words are not sales' words, and
a shared dictionary is a place where two products' vocabularies collide. That is
the same split `platform-email` uses (identity from the app, templates shared),
and it is the repo's standing rule: *if you have to add a parameter to make it
generic, leave it in the app.* A books-shaped option appearing in `src/` is the
signal that the thing being written belongs in `apps/books/lib/`.

## The resolution order

```
user record  →  cookie  →  Accept-Language  →  default
```

`platform.users.locale` is **nullable, and null means "never chosen"** — not
"chose English". That is what keeps the `Accept-Language` step reachable; a
`NOT NULL DEFAULT 'en'` backfill would have answered step 1 for every account
that already exists and made steps 2 and 3 dead code on the day they shipped.
The reasoning is in `apps/issues/lib/db/migrations/0048_users_locale.sql`.

An unrecognised stored value (`'de'`) **falls through** rather than ending the
chain — `parseLocale` answers `null`, not the default. That is why the column
carries no CHECK constraint.

## How a second app adopts it

Five steps. b/books is the worked example; read its files beside this list.

1. **Add the dependency** — `"@blackcode/platform-i18n": "*"` in the app's
   `package.json`, then `npm install`.

2. **Write the dictionary**, English first, in the app's own `lib/`.
   `apps/books/lib/dictionary.ts`:

   ```ts
   const en = { 'nav.overview': 'Overview' } as const
   export type BooksKey = keyof typeof en
   const fr: Record<BooksKey, string> = { 'nav.overview': 'Vue d\'ensemble' }
   export const DICTIONARY: Dictionary<BooksKey> = { en, fr }
   ```

   `Dictionary<K>` is `Record<Locale, Record<K, string>>`, so **a key present in
   English and missing in French is a `tsc` error**, not a blank on screen. This
   is the strong half of the guard and it cannot go inert.

3. **Resolve on the server, in the root layout**, and pass it down. The locale is
   on the session user, so the first paint is already correct:

   ```tsx
   const locale = await getLocale(user?.locale ?? null)
   return <html lang={locale}>…<Providers locale={locale}>…</Providers></html>
   ```

   **Never a `useEffect` that swaps the language after mount.** A page that
   renders English and flips to French is worse than one that never offered the
   choice.

4. **Mount `<LocaleProvider>`** inside the app's client provider stack, importing
   the dictionary in a client module so it is bundled rather than serialised into
   every page's RSC payload. Export the app's typed hook beside it:

   ```ts
   export const useT = () => useTranslate<BooksKey>()
   ```

5. **Write the preference** through `PATCH /api/me { locale }`, from the app's
   single account-write module, and set the `bk_locale` cookie in the same place
   so signed-out pages agree. `apps/books/lib/account.ts` → `useSetLocale`.

## What is deliberately not here

- **No route or middleware locale segment** (`/fr/…`). The preference is on the
  account; the URL is where the *data* lives. A locale in the path would make
  every shared link carry one person's language.
- **No string extraction tooling.** Two languages and one app; a script that
  writes the dictionary is a thing to build when there is a translator, not a
  developer, doing the writing.
- **No formatting helpers.** `apps/books/lib/format.ts` has strong, tested
  opinions about money and dates that are *statutory*, not linguistic (the ASCII
  apostrophe for thousands is fixed by the mockup's acceptance test). Putting a
  locale-aware number formatter in here would invite an app to reach for it.
