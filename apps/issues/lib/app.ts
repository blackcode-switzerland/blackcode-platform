// Who this app is, in the platform's terms.
//
// `APP_SLUG` is the identity this app presents to `platform.apps`,
// `platform.workspace_apps` and `platform.app_access`. It matches the row that
// migration 0034 inserts, the directory name under `apps/`, and — from Phase 5 —
// the CLI namespace (`bk issues …`) and the guide folder (`topics/issues/`).
//
// It lives in the app, never in packages/platform-*: a platform package that
// knew the slug would be a platform package that knew about one app. Every access
// check takes the slug as an argument for exactly that reason.

/** This app's slug in `platform.apps`. Must match migration 0034. */
export const APP_SLUG = 'issues'

/**
 * Human name, for UI and for the denial messages an agent reads.
 *
 * `b/issues` since 2026-08-11, and the rename is not cosmetic. This app had been
 * `Blackcode Issues` while `apps/sales` called itself `b/sales`, and the two
 * spellings met in a place a reader can compare them: the From line of the mail
 * both apps send from the same domain, through the same Resend account, about
 * the same shared account. One product family that cannot agree on how to write
 * its own name reads as two vendors.
 *
 * WHAT THIS CONSTANT ACTUALLY REACHES, MEASURED rather than assumed: exactly one
 * call site, `lib/email/send.ts`. `app/dashboard/layout.tsx` imported it and
 * never used it — the sidebar brand is written out in
 * `components/dashboard-layout.tsx`, which is why changing this alone did not
 * change the UI, and why that file was edited in the same commit.
 */
export const APP_NAME = 'b/issues'
