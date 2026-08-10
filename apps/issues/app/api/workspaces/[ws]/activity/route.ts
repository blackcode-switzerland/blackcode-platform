// GET /api/workspaces/{ws}/activity — mounted from the shared Class-B factory.
//
// Class B (D-22): the feed query itself is platform, but an event's `entity_id`
// is an INTERNAL ROW ID, and for this app's own entities it must be swapped for
// the workspace #number before it leaves the server. That means reading `issues.*`, which a platform package
// cannot do. So the app-specific half arrives as a named second argument rather
// than as a callback bolted onto AppContext.
//
// The two vocabularies below are THIS APP's, added to the platform ones the
// factory already knows (workspace, membership, invitations, app access). Do not
// list another app's nouns here; the point of the split is that each app
// validates its own filters.

import { activityRoute } from '@blackcode/platform-api/routes'
import { platformEventSource } from '@blackcode/platform-api'
import { appContext } from '@/lib/api'
import { db } from '@/lib/db/client'
import { resolveEventEntitySeqs } from '@/lib/db/queries/events'

export const GET = activityRoute(appContext, {
  // THIS APP'S EVENTS ARE `platform.events`, AND STAY THERE (Phase 3, 2026-08-10).
  // `platformEventSource` is a binding of the `listEvents` call this route
  // already made, same arguments — unchanged by construction. What changed is
  // that `apps/sales` stopped sharing the table, so the mount has to say.
  events: platformEventSource(db),
  entityTypes: ['project', 'task', 'issue', 'comment', 'attachment', 'label'],
  actions: [
    'commented',
    'assigned',
    'unassigned',
    'status_changed',
    'priority_changed',
    'task_changed',
    'project_changed',
    'labeled',
    'unlabeled',
    'attached',
    'unattached',
    'mentioned',
    'due_date_changed',
    'restored',
    'purged',
  ],
  // The three whose `entity_id` is a serial that must never be exposed. A
  // comment or label keeps its own-domain id, which is why they are in
  // `entityTypes` above but not here.
  numberedEntityTypes: ['issue', 'task', 'project'],
  resolveEntitySeqs: resolveEventEntitySeqs,
})
