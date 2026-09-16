// POST /api/cli/authorize — mounted from the shared factory.
//
// `bk login --server https://billing.blackcode.ch` is a legitimate command — an
// agent naming the app it is about to work in — and a 404 here is an invisible
// failure: the terminal sits waiting for a callback that will never arrive,
// with no error at either end. b/books found that gap by hitting it.
//
// Serving it is not "b/billing has its own login". The token it mints is the
// same platform-wide `bk_live_…` credential in the same `platform.api_tokens`,
// which is exactly why this is one shared factory rather than a route each app
// could scope differently.
//
// It MINTS a token, so it resolves a BROWSER SESSION only. `lib/api.ts` supplies
// `getValidatedSessionUser`, which rejects a session issued before the account's
// last password reset.
//
// **Excluded from CLI parity, same reason as in the other three apps:** the
// binary never calls this route. It opens `/cli/authorize` in a browser and the
// PAGE posts here. A `bk` command for it would be a command that signs a browser
// in, which is `bk login`, and that goes somewhere else.

import { cliAuthorizeRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = cliAuthorizeRoute(appContext)
