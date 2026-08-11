// This app's identity, in one place.
//
// The slug is the single string that must agree in five places, and the checklist
// in docs/adding-an-app.md exists because forgetting any one of them fails late:
//
//   1. this constant
//   2. the directory name          apps/<slug>/
//   3. the Postgres schema         CREATE SCHEMA <slug>
//   4. the row in platform.apps    slug = '<slug>'
//   5. the CLI namespace           bk <slug> …   and the guide topics directory
//
// Renaming the app means changing all five together. Nothing derives it from
// anything else on purpose: a slug inferred from `process.cwd()` or a directory
// listing would be a slug that changes when someone moves a folder.
export const APP_SLUG = 'sales'

/**
 * Human name — for UI, for denial messages an agent reads, and for the From
 * line of every email this app sends (`b/sales <admin@blackcode.ch>`).
 *
 * `apps/issues` has carried the same constant since Phase 5. This app gained
 * one on 2026-08-11 when it started sending its own mail: the alternative was
 * the display name living in `lib/email/send.ts`, which is a second place for
 * the app's name to be written down and therefore a second place for it to go
 * stale.
 */
export const APP_NAME = 'b/sales'
