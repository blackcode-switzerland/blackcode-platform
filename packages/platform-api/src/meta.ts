// The platform half of GET /api/meta.
//
// ---------------------------------------------------------------------------
// /api/meta IS CLASS C, AND THIS IS A HELPER, NOT A FACTORY (D-20)
// ---------------------------------------------------------------------------
// Every other shared route became `factory(ctx)` or `factory(ctx, contribution)`.
// This one did not, and the difference is the point rather than an inconsistency.
//
// `/api/meta` exists to tell an agent what THIS app's vocabulary is — its
// statuses, its priorities, its limits, its entity types. That is not a
// contribution to a shared route; it is the reason the route exists. And
// docs/platform-architecture.md §7.4 is explicit that two apps' vocabularies must
// never be merged into one top-level list: an agent has to be structurally
// unable to send a sales stage to the issue tracker.
//
// So each app writes its own `/api/meta` route, and calls this for the half that
// is genuinely identical everywhere: who you are, which workspaces you can
// reach, which apps you can reach, the link vocabulary, the CLI versions.
//
// ---------------------------------------------------------------------------
// THE DEPRECATED TOP-LEVEL KEYS ARE THE CALLER'S JOB, ON PURPOSE
// ---------------------------------------------------------------------------
// `vocabulary`, `limits` and `media` are served twice — nested under
// `apps.<slug>` (current) and at the top level (deprecated 2026-08-04, removed
// after two minor releases). They MUST be the same object references, not
// copies: a divergence between the two spellings during the overlap would be
// worse than either shape alone.
//
// This helper never constructs them. It takes the app's entry as one object and
// puts it inside `apps.<slug>`; the app spreads the very same values at the top
// level. Same reference by construction, because there is only ever one object.
// If this helper built them, keeping the two in step would be a rule someone has
// to remember — which is how they drift.

import type { NextRequest } from 'next/server'
import { listAppRegistry, type User } from '@blackcode/platform-db'
import { isSuperAdmin } from '@blackcode/platform-auth'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from '@blackcode/platform-agent'
import type { AppContext } from './app-context'
import type { WorkspaceMembershipRef } from './workspace-source'

export interface PlatformMetaOptions {
  /**
   * What the CURRENT app contributes to its own entry in `apps.<slug>` — its
   * vocabulary, limits, media rules, entity types.
   *
   * Only the current app's entry gets them, and that is not an omission: this
   * server knows its own vocabulary and has no business inventing another app's.
   * An agent reads a different app's vocabulary from that app's own /api/meta,
   * which is what `base_url` is for.
   */
  currentApp?: Record<string, unknown>
}

export interface PlatformMetaResult {
  /** Spread straight into the route's response. */
  meta: Record<string, unknown>
  /** The resolved workspace, so the app can run its own scoped queries. */
  workspace: WorkspaceMembershipRef | null
  /** The freshly-read caller. */
  user: User
}

/**
 * Assemble everything in `/api/meta` that is the same for every app.
 *
 * Returns the workspace and user alongside the payload rather than making the
 * route resolve them twice — `?ws=` resolution is exactly the logic that must
 * not be reimplemented per app, since getting it wrong leaks which workspaces
 * exist.
 */
export async function platformMetaBlock(
  app: AppContext,
  req: NextRequest,
  user: User,
  opts: PlatformMetaOptions = {}
): Promise<PlatformMetaResult> {
  // Workspace: explicit ?ws=<slug|id> override, else this app's default for the
  // caller. Both go through `app.workspaces`, which returns null if it doesn't
  // exist or the caller isn't a member (no existence leak).
  //
  // `user.active_workspace_id` is NOT read here any more, and that is a fix
  // rather than a refactor: it is one column shared by every app, so after the
  // split it names a different team depending on which app last wrote it. The
  // app's own source answers "what should I default to" — for issues that IS
  // the column, for an app with one workspace per person it is that workspace.
  const wsParam = req.nextUrl.searchParams.get('ws')
  const workspace = wsParam
    ? await app.workspaces.getForUser(wsParam, user.id)
    : await app.workspaces.getDefaultForUser(user.id)

  // Every workspace the caller belongs to in THIS app — the disambiguation list
  // an agent needs to target the right tenant by (human-readable) name/slug.
  // There is no narrower and wider list any more: a workspace this app's own
  // source reports IS one the caller can write to here.
  const [myWorkspaces, registry] = await Promise.all([
    app.workspaces.listForUser(user.id),
    listAppRegistry(app.db),
  ])

  const members = workspace ? await app.workspaces.listMembers(workspace.id) : []

  const meta: Record<string, unknown> = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      via: authVia(req),
      is_super_admin: isSuperAdmin(user.email),
    },
    active_workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: workspace.member_role,
        }
      : null,
    // Pick the target by `name`/`slug` — do NOT rely on the numeric `id` to know
    // which team it is.
    workspaces: myWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: w.member_role,
      is_active: workspace ? w.id === workspace.id : false,
    })),
    current_app: app.appSlug,
    // ── THE ADDRESS BOOK, NOT A GRANT LIST (changed 2026-08-10, Phase 5) ──────
    // Every enabled row in `platform.apps`: which apps exist and where they are
    // deployed, so the CLI can route `bk <app> …` without anyone typing a URL.
    //
    // It USED to be derived from `platform.app_access` — the apps this token
    // holds a grant for — under docs/platform-architecture.md §4.5, "an agent
    // must not discover an app its user cannot reach". Phase 5 retired that rule
    // rather than weakening it, for two measured reasons:
    //
    //   1. IT CANNOT BE DERIVED ANY MORE. Reachability now lives in each app's
    //      own membership table, and no deployment holds a Postgres grant on
    //      another app's schema (§4.3). This server can answer for itself and
    //      for nobody else.
    //   2. IT WAS ALREADY ANSWERING FALSELY. The grants named `platform.workspaces`
    //      ids for an app whose workspaces had moved to its own schema, so a
    //      brand-new issues signup was told `apps.sales.workspaces` contained
    //      their platform workspace — a workspace `apps/sales` itself 404s.
    //
    // So `workspaces` is listed ONLY for the app answering the request. An entry
    // for another app carries its address and nothing else, because its address
    // is genuinely all this server knows. Ask that app's own `/api/meta` — which
    // is what `base_url` is for, and what a CLI fan-out does.
    //
    // AN OBJECT, NOT AN ARRAY, on purpose: each app's vocabulary and limits live
    // INSIDE its entry here (§7.4). Keyed means adding one is additive; an array
    // would have to be replaced, and replacing a field agents already parse is
    // the breakage this whole sequence exists to avoid.
    apps: Object.fromEntries(
      registry.map((a) => {
        const isCurrent = a.slug === app.appSlug
        return [
          a.slug,
          {
            slug: a.slug,
            name: a.name,
            base_url: a.base_url,
            is_current: isCurrent,
            // Only ever this app's own. An empty array for another app means
            // "not known here", NOT "you have none there" — the two were
            // indistinguishable while this was grant-derived, and conflating
            // them is what produced the false claim above.
            workspaces: isCurrent ? myWorkspaces.map((w) => w.slug) : [],
            ...(isCurrent ? (opts.currentApp ?? {}) : {}),
          },
        ]
      })
    ),
    // How to address an entity in any app. A URN is built from an app's OWN
    // workspace slug and #number, so every app can print and resolve one — that
    // survived the split untouched.
    //
    // `relations` went with `bk link` on 2026-08-10: the link table is no longer
    // written by any app and `linksRoute` is unmounted everywhere, so a relation
    // vocabulary described a command that does not exist. The URN format stays
    // because putting the other end's URN in the record's own text is the
    // documented replacement for a link.
    links: {
      urn_format: 'bc:<app>:<workspace-slug>/<entity-type>/<number>',
      urn_example: `bc:${app.appSlug}:${workspace?.slug ?? '<workspace>'}/issue/1`,
    },
    // The bk versions this server advertises (also sent as X-BK-CLI-* headers).
    // Platform, not per-app: there is ONE binary and one npm package for the
    // whole platform, so an app that published its own package name here would
    // be advertising an install that does not exist.
    cli: {
      package: '@blackcode_sa/bc-issues',
      latest_version: CLI_LATEST_VERSION,
      /** Below this the CLI hard-blocks with exit 8. */
      min_version: CLI_MIN_VERSION,
      install: 'npm install -g @blackcode_sa/bc-issues',
      update: 'npm install -g @blackcode_sa/bc-issues@latest',
    },
    // Pointers only — the behaviour itself lives in `bk guide`, which ships
    // inside the binary and therefore always describes the binary in your hand.
    conventions: {
      interface:
        'This product is operated through the bk CLI. Run `bk guide` for the complete, current usage guide for your installed binary; `bk <group> <command> --help` for flags.',
      workspace_selection:
        "Before creating anything, confirm which workspace you are writing to. The `workspaces` array above lists every workspace you belong to; match the user's intent by `name`/`slug`, never by the numeric `id` (ids are opaque and easy to confuse). `active_workspace` is only a default — it is NOT necessarily where the user means to write. Set it with `bk workspace use <slug>`, or target one command with `bk --ws <slug> …`.",
      staying_current:
        'If a command that used to work now fails, run `bk skill sync` (updates your agent skill, and tells you when the binary itself is behind), then `bk changelog` for the dated record.',
    },
    members,
  }

  return { meta, workspace, user }
}

/** Which credential the caller used. Same test the app's own resolver makes. */
function authVia(req: NextRequest): 'session' | 'token' {
  const header = req.headers.get('authorization')
  return header && /^Bearer\s+/i.test(header) ? 'token' : 'session'
}
