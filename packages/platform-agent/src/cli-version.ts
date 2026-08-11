// Source of truth for the bk CLI versions the API advertises. Every API
// response carries these as headers (set in lib/api/handler.ts):
//
//   X-BK-CLI-Latest  — newest published CLI; the CLI prints a soft "update
//                      available" notice when the user is behind it.
//   X-BK-CLI-Min     — minimum CLI the API still supports; the CLI refuses to
//                      run (hard upgrade) when the user is below it.
//
// Bump these on each CLI release. Raise CLI_MIN_VERSION whenever a server change
// is incompatible with older CLIs (e.g. the milestone→task / key-removal rename),
// so stale clients get a clear "please upgrade" instead of cryptic 404s.
// Both are overridable via env without a redeploy.
//
// ORDER MATTERS. Publish the new CLI to npm and verify a clean install BEFORE
// raising CLI_MIN_VERSION. Raising the floor first locks out every user with no
// working version to move to. Because both values read from env, the floor can
// also be rolled back instantly without a redeploy.
//
// Current state (2026-08-04): 1.10.0 namespaces app commands behind their app
// name — `bk issues issue create`, not `bk issue create`. Every pre-1.10.0
// spelling still runs as a deprecated alias that prints one stderr line, and
// those aliases are pruned in 1.12.0.
//
// The floor stays at 1.9.1 deliberately, and that is the whole point of the
// deprecation window: a 1.9.x client still works against this server, it just
// uses the old spellings. Raising the floor now would break the callers the
// aliases exist to protect. **The floor moves in Phase 8** of
// docs/2026-08-platform-migration.md, once 1.10.0 adoption is visible — by setting
// BK_CLI_MIN, no redeploy needed.
//
// NOTE (2026-08-04): production is currently serving X-BK-CLI-Latest 1.9.3, not
// 1.10.0. The release commit that bumped this constant landed AFTER the web
// deploy — an unavoidable consequence of deploying the server before publishing
// the CLI, which was the right order (the new server is backwards compatible
// with 1.9.x clients; a 1.10.0 client against the old server would have got an
// unfiltered feed from `bk changelog --app`). Effect: 1.9.x users get no soft
// "update available" nudge yet. Fix with either a redeploy or BK_CLI_LATEST=1.10.0
// in Vercel — the env override exists for exactly this.

export const CLI_LATEST_VERSION = process.env.BK_CLI_LATEST ?? '2.2.0'
export const CLI_MIN_VERSION = process.env.BK_CLI_MIN ?? '2.0.0'
