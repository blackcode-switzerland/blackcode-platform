// Vocabulary validation for projects.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE
// ---------------------------------------------------------------------------
// `queries/projects.ts` imports the database client at module scope, so
// importing it requires DATABASE_URL and a reachable Postgres. That would make
// the guard for this rule either an integration test (slow, and it would write
// rows into a dev database to prove a rejection) or absent. A pure function in
// a module with no db import is unit-testable, and the wiring — that
// createProject/updateProject actually CALL it — is asserted separately against
// a real database.
//
// ---------------------------------------------------------------------------
// WHY IT LIVES IN THE QUERY LAYER AT ALL, RATHER THAN THE ROUTE
// ---------------------------------------------------------------------------
// `issues.projects.priority` is a varchar(10) with no CHECK, and until
// 2026-08-12 the route passed `body.priority` straight through: `--priority
// urgent` — which the CLI's own help instructed, in every version that has ever
// shipped — wrote the literal string. `projectPriorityLabel` has no entry for
// it and falls through to "No priority", so the project read as unprioritised
// in the listing, the detail page, `bk meta` and analytics, with no error
// anywhere. One such row exists in local dev (verified 2026-08-12).
//
// It belongs here because `issues` already does it here — createIssue and
// updateIssue throw 'invalid_status'/'invalid_priority' and the route maps them
// to a 400. One pattern, not a second one alongside it. Putting it in the route
// would also leave every other caller of createProject unguarded.
//
// See lib/api/project-vocabulary.ts for the 400 these become.

import { PROJECT_PRIORITY_VALUES, PROJECT_STATUS_VALUES } from '@/lib/work-items'

export function assertProjectVocabulary(input: { status?: string; priority?: string }): void {
  if (input.status !== undefined && !PROJECT_STATUS_VALUES.includes(input.status)) {
    throw new Error('invalid_status')
  }
  if (input.priority !== undefined && !PROJECT_PRIORITY_VALUES.includes(input.priority)) {
    throw new Error('invalid_priority')
  }
}
