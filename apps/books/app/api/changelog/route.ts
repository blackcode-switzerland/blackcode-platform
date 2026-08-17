// GET /api/changelog — `bk changelog`, and what `bk skill sync` reads.
//
// The factory takes an AppContext it does not use: the changelog is authored
// Markdown merged from docs/changelog/*.md, identical from every deployment.
// Mounted anyway, because a bare verb that 404s from the host you are homed on
// is a dead end regardless of how identical the answer would have been.
import { changelogRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = changelogRoute(appContext)
