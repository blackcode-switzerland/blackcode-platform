// GET /api/meta — the bootstrap call, and the ONLY authority on this app's
// dynamic values.
//
// ---------------------------------------------------------------------------
// CLASS C (D-20): PER-APP BY DESIGN, NOT BY OVERSIGHT
// ---------------------------------------------------------------------------
// Every other shared route became a factory over `AppContext`. This one did not,
// and the reason is the whole point of it: `/api/meta` exists to say what THIS
// app's vocabulary is. That is not a contribution to a shared route, it is the
// route's purpose — and `docs/platform-architecture.md` §7.4 is explicit that two
// apps' vocabularies must never be merged, so an agent is structurally unable to
// send a sales stage to the issue tracker.
//
// `platformMetaBlock` supplies the half that genuinely is identical everywhere:
// who you are, which workspaces you can reach, which apps you can reach, the
// link vocabulary, the CLI versions.
//
// ---------------------------------------------------------------------------
// NOTHING HERE IS HAND-TYPED
// ---------------------------------------------------------------------------
// The vocabulary is `VOCABULARY` from `lib/pipeline.ts` — assembled THERE so
// that adding a vocabulary adds it to `bk meta` with no second edit, and so this
// route cannot serve a stale subset. The limits are `LENGTH_LIMITS` from
// `lib/limits.ts`, which the routes import to enforce. The entity types are
// `ENTITY_TYPES` from `lib/entity-address.ts`, which the projection uses.
//
// That is the contract the embedded `bk guide` depends on: a guide topic never
// restates a value that can change without a CLI release, because this route
// carries it live. `cli/internal/guide/guide_test.go` fails the build on a topic
// that breaks it.
//
// There are DELIBERATELY no deprecated top-level `vocabulary`/`limits`/`media`
// keys here. `apps/issues` serves them because it had agents parsing that shape
// before the nested one existed; this app has never had a caller, so shipping
// the deprecated spelling would be creating something to remove.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, contractVersion, platformMetaBlock } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { listLabels } from '@/lib/db/queries/labels'
import { publicLabel } from '@/lib/views'
import { VOCABULARY } from '@/lib/pipeline'
import { LENGTH_LIMITS } from '@/lib/limits'
import { ENTITY_TYPES } from '@/lib/entity-address'
import { SEARCH_TYPES } from '@/lib/db/queries/search'
import { RETENTION_DAYS, TRASH_TYPES } from '@/lib/db/queries/trash'

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await appContext.resolveUser(request)
  if (!user) throw Errors.unauthorized()

  // What this app contributes to its own entry in `apps.sales`. Every field is
  // imported from the module that owns it — see the header.
  const currentApp = {
    vocabulary: VOCABULARY,
    limits: LENGTH_LIMITS,
    /** The types with a #number and a URN — what `bk search` and `bk link` address. */
    entity_types: ENTITY_TYPES,
    /** What `bk sales search` reaches into. WIDER than `entity_types`, on
     *  purpose: a contact and an objection are searchable and not addressable. */
    search_types: SEARCH_TYPES,
    /** What `bk sales trash` can hold, and for how long (D-19 item 1). */
    trash_types: TRASH_TYPES,
    retention_days: RETENTION_DAYS,
  }

  /**
   * One value an agent can poll instead of re-reading this whole block (#31).
   *
   * DERIVED from `currentApp`, never typed: a hand-bumped integer is a second
   * copy of a fact, and the failure of a second copy here is the worst one
   * available — it says "nothing changed" while something did, and an agent
   * that trusts it skips the re-read it would otherwise have done.
   *
   * It is computed AFTER `currentApp` and over exactly that object, so a
   * vocabulary or limit added to the module that owns it moves this with no
   * second edit. **Nothing per-user or per-deploy may be folded in** — see
   * `contractVersion`'s header for why that would look like it was working
   * while being useless.
   */
  const contract_version = contractVersion(currentApp)

  const { meta, workspace } = await platformMetaBlock(appContext, request, user, {
    currentApp: { ...currentApp, contract_version },
  })

  // The one app-scoped list worth grounding an agent on before its first write.
  // Prospects are NOT listed here: a workspace can hold thousands and `bk sales
  // prospect list` is the paginated answer, while a bootstrap call that returned
  // the first fifty would teach an agent that that is all of them.
  const labels = workspace ? await listLabels(workspace.id) : []

  return NextResponse.json({
    user: meta.user,
    active_workspace: meta.active_workspace,
    workspaces: meta.workspaces,
    current_app: meta.current_app,
    apps: meta.apps,
    links: meta.links,
    cli: meta.cli,
    conventions: {
      // This app's own convention first, then the platform ones.
      id: 'Every prospect, meeting, communication, product, template and document is addressed by its workspace #number (the #N in `bk sales … list`), unique per workspace. Contacts, journey steps, objections and matches have no #number — they are reached through their prospect, by the id shown in their own listing. The internal database id of a numbered record is never exposed.',
      money: 'Amounts are plain decimal strings with the currency in a separate field. Never send a formatted amount ("CHF 15\'000") and never do arithmetic on one in a client.',
      dates: 'Resolve a relative phrase ("this week") to a real date before sending it. Where the phrase itself matters, the record keeps it verbatim beside the date and never parses it back.',
      ...(meta.conventions as Record<string, string>),
    },
    labels: labels.map(publicLabel),
    members: meta.members,
  })
})
