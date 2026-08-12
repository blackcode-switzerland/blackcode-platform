// GET /api/meta — the bootstrap call for agents (and humans).
//
// Returns, in one round-trip:
//   - user        : who you are + how you authenticated (via)
//   - active_workspace : the resolved workspace (?ws= override, else the user's
//                        active workspace; null if none / not a member)
//   - workspaces  : every workspace the caller belongs to AND may use THIS app in
//                   (id, name, slug, role, is_active) — so an agent can pick the
//                   right target BY NAME instead of guessing an opaque numeric id
//   - current_app / apps : which app this is, and the apps the caller can reach
//                   anywhere, keyed by slug (Phase 4). Grant-derived: an app the
//                   caller has no access to does not appear
//   - vocabulary  : the valid issue/project enum values (with labels + colors),
//                   straight from lib/work-items — so an agent never guesses a
//                   status/priority
//   - labels / projects / members : the active workspace's entities, to ground on
//
//   - limits      : every server-enforced cap (upload size, title/name lengths,
//                   page sizes, undo count), imported from the modules that
//                   enforce them (lib/limits.ts, lib/upload.ts)
//   - media       : how an uploaded url renders in a rich-text body, and which
//                   MIME types upload refuses
//   - cli         : the advertised bk versions (@blackcode/platform-agent)
//
// The last three exist so the embedded `bk guide` never has to restate a value
// that can change without a CLI release. Guide = static behaviour, meta =
// dynamic data. See AGENT-SURFACE-SIMPLIFICATION-PLAN.md §2.1 and lib/agent-meta.ts.
//
// Authenticated (session or bk_live_ token). For how to USE any of this, run
// `bk guide` — it is the complete usage guide for the binary in the agent's hand.

import { NextRequest, NextResponse } from 'next/server'
import { platformMetaBlock } from '@blackcode/platform-api'
import { apiHandler, Errors, publicProject, appContext } from '@/lib/api'
import { resolveAuth } from '@/lib/auth/resolve'
import { getUserById } from '@/lib/db/queries/users'
import { listProjectsInWorkspace } from '@/lib/db/queries/projects'
import { listLabelsInWorkspace } from '@/lib/db/queries/labels'
import {
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_UPDATE_STATUSES,
  TASK_PROGRESS_STATUSES,
} from '@/lib/work-items'
import { META_LIMITS, META_MEDIA } from '@/lib/agent-meta'
import { ENTITY_TYPES } from '@/lib/entity-address'

// This app's enum vocabulary, straight from the module the routes validate
// against. Named once and served twice — nested under `apps.issues` (current)
// and at the top level (deprecated, removed after two minor releases) — so the
// two spellings cannot drift apart during the overlap.
const APP_VOCABULARY = {
  issue_statuses: ISSUE_STATUSES,
  issue_priorities: ISSUE_PRIORITIES,
  project_statuses: PROJECT_STATUSES,
  project_priorities: PROJECT_PRIORITIES,
  project_update_health: PROJECT_UPDATE_STATUSES,
  // A task's status is DERIVED from its issues and cannot be written — it is
  // here because an agent still has to know what the values MEAN when it reads
  // one back, and because `bk guide` may not restate a vocabulary. See
  // lib/work-items.ts → "tasks".
  task_progress_statuses: TASK_PROGRESS_STATUSES,
} as const

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await resolveAuth(request)
  if (!auth) throw Errors.unauthorized()
  const fresh = await getUserById(auth.user.id)
  if (!fresh) throw Errors.notFound('user')

  // What THIS app contributes to its own entry in `apps.<slug>`. Built once and
  // handed to the platform helper, then spread again at the top level below —
  // the SAME object references both times, which is the whole point of building
  // them here rather than in the helper (§7.4 and the note on the deprecated
  // keys). There is no second copy that could drift.
  const currentApp = {
    vocabulary: APP_VOCABULARY,
    limits: META_LIMITS,
    media: META_MEDIA,
    // The entity types THIS app projects into platform.entities, so an agent
    // knows what `bk search --type` and the `<entity-type>` segment of a URN
    // accept here. Per-app for the same reason the vocabulary is: another app's
    // types are none of this app's business (§7.4).
    entity_types: ENTITY_TYPES,
  }

  const { meta, workspace } = await platformMetaBlock(appContext, request, fresh, { currentApp })

  // Only this app's own entities are left to fetch — the platform helper has
  // already resolved the workspace and read the members.
  const [labels, projects] = workspace
    ? await Promise.all([
        listLabelsInWorkspace(workspace.id),
        listProjectsInWorkspace(workspace.id, {}),
      ])
    : [[], []]

  // Composed key by key rather than spread, so the rendered document keeps the
  // exact shape and ORDER it had before the platform half was extracted. A
  // reader can also see at a glance which half each field comes from.
  return NextResponse.json({
    user: meta.user,
    active_workspace: meta.active_workspace,
    // Every workspace you belong to. Pick the target by `name`/`slug` — do NOT
    // rely on the numeric `id` to know which team it is. Address a workspace in
    // routes as /api/workspaces/{slug}/… (or pass ?ws=<slug> to this endpoint).
    workspaces: meta.workspaces,
    current_app: meta.current_app,
    apps: meta.apps,
    // ---------------------------------------------------------------------
    // DEPRECATED (2026-08-04): the three keys below moved into
    // `apps.<slug>`. They stay here, correct and identical, for TWO MINOR
    // RELEASES so nothing breaks in the release that introduced the nested
    // form — then they go away. Read `apps.issues.*` instead.
    //
    // Same object references as the nested copies, not clones — see
    // `currentApp` above. `lib/api/meta-shape.test.ts` asserts that identity;
    // a divergence between the two spellings during the overlap would be worse
    // than either shape alone.
    // ---------------------------------------------------------------------
    vocabulary: currentApp.vocabulary,
    limits: currentApp.limits,
    media: currentApp.media,
    links: meta.links,
    cli: meta.cli,
    conventions: {
      // This app's own convention, first — the platform ones follow. `id` names
      // projects, tasks and issues, so it could never be platform text.
      id: 'A project/task/issue is addressed by its workspace #number (the #N shown in the app), unique per workspace. References back to a work item (comment.parent_id, attachment.issue_id, project_update.project_id) are this #number too — the internal db id is never exposed.',
      ...(meta.conventions as Record<string, string>),
    },
    labels,
    projects: projects.map(publicProject),
    members: meta.members,
  })
})
