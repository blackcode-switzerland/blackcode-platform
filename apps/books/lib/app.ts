// This app's identity, in one place.
//
// The slug is the single string that must agree in six places, and the checklist
// in docs/adding-an-app.md exists because forgetting any one of them fails late:
//
//   1. this constant
//   2. the directory name          apps/books/
//   3. the Postgres schema         CREATE SCHEMA books
//   4. the row in platform.apps    slug = 'books'
//   5. the CLI namespace           bk books …
//   6. the guide topics directory  cli/internal/guide/topics/books/
//
// Renaming the app means changing all six together. Nothing derives it from
// anything else on purpose: a slug inferred from `process.cwd()` or a directory
// listing would be a slug that changes when someone moves a folder.
export const APP_SLUG = 'books'

// ── THE SLUG COLLISION CHECK, RECORDED ───────────────────────────────────────
// `grep -rw books` over the repo before committing to this name returned exactly
// one hit: the English verb in prose in cli/internal/guide/topics/sales/
// 01-logging.md ("books a meeting"). No entity, no variable, no directory.
//
// That check is not ceremony. The scaffold's slug used to be `template`, which
// was also a sales ENTITY, a Go local, and a word every migration uses in prose;
// three guards mis-fired on the collision in a single phase and every one of
// them looked correct. An app slug is matched against text by guards you did not
// write, so it has to mean one thing.
//
// `bbooks` was the collision-free alternative and was rejected for consistency:
// the platform's apps are `issues` and `sales`, not `bissues` and `bsales`. One
// prose hit in a markdown guide trips nothing.

/**
 * The name a human reads, and the one every non-UI surface has to agree with.
 *
 * Added 2026-08-19 with this app's email binding: `EmailIdentity.name` is the
 * From line and the wordmark inside the message, and `packages/platform-email`
 * asks apps to read it from here so the mail and the screen cannot drift apart.
 *
 * ── ENVIRONMENT SINCE 2026-09-23 (ticket #756), THE SAME SHAPE AS b/billing ──
 * A copy of this app can run under another company's name. What varies there is
 * what a PERSON reads — this name, the contact address, the family name in "your
 * blackcode account" — and none of it is the slug (see above).
 *
 * ── THESE VALUES ARE INLINED AT BUILD TIME, NOT READ AT REQUEST TIME ────────
 * `lib/dictionary/index.ts` substitutes them into the dictionary, and the
 * dictionary is imported by a CLIENT module (`lib/i18n.tsx`), so the browser
 * bundle needs them too. A plain `process.env.X` is `undefined` in a browser
 * bundle unless it is `NEXT_PUBLIC_` — which would rename every variable — or
 * listed under `env` in `next.config.js`, which is what this app does. The
 * consequence: changing one of these on a deployment needs a REBUILD, not a
 * restart. `bk meta` and the routes read the same inlined value, so the two
 * front doors cannot disagree.
 */
export const APP_NAME = process.env.BOOKS_DISPLAY_NAME ?? 'b/books'

/** Where a human replies to mail this app sends, and the footer's address. */
export const CONTACT_EMAIL = process.env.BOOKS_CONTACT_EMAIL ?? 'contact@blackcode.ch'

/**
 * The FAMILY name — the word in "your blackcode account is the same one across
 * every blackcode app". It is not the product name: b/books is one app of the
 * family, and the sentences that use this word are about the account every app
 * shares. A rebranded deployment sets it to its own company.
 */
export const PLATFORM_NAME = process.env.BOOKS_PLATFORM_NAME ?? 'blackcode'

/**
 * `you@<the contact address's domain>` — the login form's placeholder, derived
 * rather than a fourth variable: a placeholder on another company's domain is
 * the kind of leak nobody sets a variable for.
 */
export const EMAIL_PLACEHOLDER = `you@${CONTACT_EMAIL.slice(CONTACT_EMAIL.indexOf('@') + 1)}`

/** The word beside the mark: `b/books` → `books`, because the mark already says `b/`. */
export function wordmark(appName: string): string {
  return appName.replace(/^b\//, '')
}

/**
 * The button fill in this app's email templates — **not `--primary`.**
 *
 * `EmailIdentity.accent` always carries WHITE text (the templates say so, and an
 * email cannot ship a second token for the label the way `globals.css` does with
 * `--primary-foreground`). This app's fill is `#e8b84b`, and white on that is
 * **1.84:1** — the exact failure `app/globals.css` measures and names as the one
 * mistake this palette invites.
 *
 * So the accent is `--primary-strong`'s light value, `#8a6410`: white on it is
 * **5.38:1**, which passes AA. It is still unmistakably this app's amber — the
 * point of the field is that a b/books code arrives in b/books' colour rather
 * than in the issues blue — and it is the same hex the light theme already uses
 * for amber-as-text, so there is one amber-that-carries-text in this app rather
 * than two.
 *
 * Computed 2026-08-17 (globals.css) and 2026-08-19 (white-on-accent), by the
 * WCAG relative-luminance formula rather than by eye.
 */
export const EMAIL_ACCENT = '#8a6410'
