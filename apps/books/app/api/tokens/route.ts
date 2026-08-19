// GET/POST /api/tokens — mounted from the shared factory.
//
// One login and one token across every blackcode app, so this lists and mints
// the same `platform.api_tokens` rows b/issues does. It is served here for two
// reasons, neither of which is "b/books has tokens of its own": `bk login
// --server <books>` authorizes at this origin, and the page that revokes a token
// has to be able to reach one from the origin it is served on.
//
// Session-only, and the factory enforces it at mount time — it throws if this
// app's `AppContext` supplies no `resolveSessionUser`, and it does not fall back
// to `resolveUser`. A bearer token that can mint another is privilege
// escalation: revoking the first would not revoke what it created.
//
// One `export const` per method, NOT `export const { GET, POST } = …`. The
// destructured form serves traffic identically and matches none of the patterns
// `lib/cli-parity.test.ts` reads, so the route would work while silently
// dropping out of the coverage check.

import { tokensRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = tokensRoute(appContext)

export const GET = handlers.GET
export const POST = handlers.POST
