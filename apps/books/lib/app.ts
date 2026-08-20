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
 */
export const APP_NAME = 'b/books'

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
