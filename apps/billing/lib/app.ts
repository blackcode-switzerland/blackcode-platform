// This app's identity, in one place.
//
// The slug is the single string that must agree in six places, and the checklist
// in docs/adding-an-app.md exists because forgetting any one of them fails late:
//
//   1. this constant
//   2. the directory name          apps/billing/
//   3. the Postgres schema         CREATE SCHEMA billing
//   4. the row in platform.apps    slug = 'billing'
//   5. the CLI namespace           bk billing …
//   6. the guide topics directory  cli/internal/guide/topics/billing/
//
// Renaming the app means changing all six together. Nothing derives it from
// anything else on purpose: a slug inferred from `process.cwd()` or a directory
// listing would be a slug that changes when someone moves a folder.
//
// ── THE SLUG IS NEVER ENVIRONMENT, AND THE NAME BELOW IS ────────────────────
// `docs/billing-app-plan/integration-surface.md` §5: this app also ships as a
// separate, rebranded product for another company. What varies there is what a
// PERSON reads — the name, the contact address, the accent. The slug is not one
// of those: it is the schema, the CLI namespace and the guide directory, and a
// slug that moved with an env var would be a schema name that moved with an env
// var. The rebrand rewrites `APP_NAME`'s default, never this line.
export const APP_SLUG = 'billing'

// ── THE SLUG COLLISION CHECK, RECORDED ───────────────────────────────────────
// `grep -rw billing` over the repo on 2026-09-16, before committing to this
// name, returned five files and every one was prose: a books seed source named
// "GitHub billing", one comment in apps/books/lib/vocabularies.ts:66, an icon
// keyword list, and two migration comments. No entity, no variable, no
// directory, no Go local.
//
// That check is not ceremony. The scaffold's slug used to be `template`, which
// was also a sales ENTITY, a Go local, and a word every migration uses in prose;
// three guards mis-fired on the collision in a single phase and every one of
// them looked correct. An app slug is matched against text by guards you did not
// write, so it has to mean one thing.

/**
 * The name a human reads, and the one every non-UI surface has to agree with.
 *
 * `EmailIdentity.name` is the From line and the wordmark inside the message, and
 * `packages/platform-email` asks apps to read it from here so the mail and the
 * screen cannot drift apart. `app/layout.tsx` reads it too, because a literal
 * title is the first thing a rebranded deployment shows wrong.
 *
 * ── WHY THIS ONE IS ENVIRONMENT AND THE SLUG IS NOT ─────────────────────────
 * A copy of this app runs as another company's invoicing product
 * (docs/billing-app-plan/standalone-deployment.md). The extraction's brand file
 * rewrites this default; the env var is what lets a deployment differ without a
 * rebuild. Neither touches `APP_SLUG`.
 */
export const APP_NAME = process.env.BILLING_DISPLAY_NAME ?? 'b/billing'

/** Where a human replies to mail this app sends. Same reasoning as `APP_NAME`. */
export const CONTACT_EMAIL = process.env.BILLING_CONTACT_EMAIL ?? 'contact@blackcode.ch'

/**
 * The FAMILY name — the word in "your blackcode account is the same one across
 * every blackcode app", "this mints one blackcode-wide token". It is not the
 * product name: those sentences are about the account every app of the family
 * shares, and `APP_NAME` in them would say "your b/billing account", which is
 * the misunderstanding they exist to prevent. A rebranded deployment sets it to
 * its own company. Ticket #756.
 */
export const PLATFORM_NAME = process.env.BILLING_PLATFORM_NAME ?? 'blackcode'

/**
 * `you@<the contact address's domain>` — the two email placeholders (login,
 * password reset). Derived rather than a fifth variable: a placeholder on
 * another company's domain is exactly the leak nobody remembers to set a
 * variable for, and the contact address already says whose domain this is.
 */
export const EMAIL_PLACEHOLDER = `you@${CONTACT_EMAIL.slice(CONTACT_EMAIL.indexOf('@') + 1)}`

// ── EVERY VALUE ABOVE IS INLINED AT BUILD TIME, AND THAT IS DELIBERATE ──────
// `components/login-form.tsx`, the settings pages and the shell are CLIENT
// components importing these constants. In a browser bundle `process.env.X` is
// `undefined` unless it is `NEXT_PUBLIC_` or listed under `env` in
// `next.config.js` — measured 2026-09-23 (ticket #756): built with
// `BILLING_DISPLAY_NAME=Zedbrand`, fourteen server chunks read the variable and
// ZERO client chunks carried the value, so every client surface of a rebranded
// deployment rendered `b/billing`. `next.config.js` now lists the four
// `BILLING_*` variables under `env`. The price: changing one needs a rebuild,
// not a restart; the gain: the routes, `bk meta`, the mail and the browser all
// read one inlined value and cannot disagree.

/**
 * The button fill in this app's email templates — **not `--primary`.**
 *
 * `EmailIdentity.accent` always carries WHITE text: the templates say so, and an
 * email cannot ship a second token for the label the way `globals.css` does with
 * `--primary-foreground`.
 *
 * ── THE MEASUREMENT, NOT AN OPINION ─────────────────────────────────────────
 * The mockup's signal green is `#3ecf8e`. Its WCAG relative luminance is
 * **0.4760**, so white on it is (1.0 + 0.05) / (0.4760 + 0.05) = **2.00:1**.
 * Unreadable: AA needs 4.5:1 for body text and 3:1 even for large text.
 *
 * `#0f6b44` has relative luminance **0.1103**, giving **6.55:1**. It passes AA
 * for body text with real margin, and it is still unmistakably this app's green
 * — the point of the field is that a b/billing message arrives in b/billing's
 * colour rather than in the issues blue.
 *
 * ── HOW THOSE TWO NUMBERS WERE OBTAINED, WHICH MATTERS ──────────────────────
 * By running the formula, on 2026-09-16. The first draft of this comment
 * carried 0.5140 and 1.86:1 for the signal green, arrived at by hand, and both
 * were wrong — the luminance by 8% and the ratio by 7%. They were wrong in the
 * SAFE direction, which is exactly why hand arithmetic is not evidence here: a
 * mistake the other way would have shipped an unreadable accent under a comment
 * claiming it had been measured.
 *
 * `apps/books/scripts/contrast.mjs` is the worked example of doing this as a
 * script that reads the stylesheet rather than restating it. If you change this
 * hex, recompute and rewrite both ratios above.
 */
export const EMAIL_ACCENT = process.env.BILLING_EMAIL_ACCENT ?? '#0f6b44'
