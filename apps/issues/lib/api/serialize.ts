// Public serialization for the three work-item entities.
//
// Contract: the only id anyone outside the DB ever sees is the workspace-scoped
// number (`seq`). We expose it as `id`. The global serial primary key is never
// emitted, and cross-entity references (project_id, task_id) are translated to
// the referenced entity's workspace number too. User ids, label ids, comment
// ids, etc. are a different domain and pass through unchanged.

type Row = Record<string, unknown>

// Strip the global id + the raw seq fields, expose seq as `id`.
function base(row: Row): Row {
  const { id: _globalId, seq, ...rest } = row
  return { id: seq ?? null, ...rest }
}

export function publicProject(input: object): Row {
  // Projects have no parent work-item FK; owner_id is a user id (unchanged).
  return base(input as Row)
}

// A task's `status` on the wire is the DERIVED one (`progress_status`), never
// the vestigial `issues.tasks.status` column. Callers see one field with one
// meaning; the column is not exposed under any name. See lib/work-items.ts →
// "tasks" for why, and lib/db/queries/tasks.ts → taskProgressSql for how.
//
// The fallback exists for the one caller that can hand us a bare insert row
// (POST …/tasks, if its re-fetch returns nothing). A row with no issues joined
// is `empty`, which is what a task one statement old actually is.
export function publicTask(input: object): Row {
  const {
    project_seq,
    project_id: _g,
    progress_status,
    status: _dead,
    ...rest
  } = base(input as Row) as Row & {
    project_seq?: number | null
    progress_status?: string
  }
  return { ...rest, project_id: project_seq ?? null, status: progress_status ?? 'empty' }
}

export function publicIssue(input: object): Row {
  const {
    project_seq,
    task_seq,
    project_id: _gp,
    task_id: _gt,
    ...rest
  } = base(input as Row) as Row & { project_seq?: number | null; task_seq?: number | null }
  return { ...rest, project_id: project_seq ?? null, task_id: task_seq ?? null }
}

// --- Secondary entities (comments, attachments, project updates) ---
//
// These aren't work items, so their own `id` is a private-domain id that passes
// through unchanged (like user/label ids). But the FK that points BACK at a work
// item must be translated to that work item's #number, never the global serial.
// The caller already knows the parent's #number (it's in the request path), so
// it passes it in rather than us re-querying.

// Comments reference a polymorphic parent (issue/task/project). Expose the
// parent's #number as `parent_id`; drop the legacy internal `issue_id` mirror
// (parent_type + parent_id fully describe the parent).
export function publicComment(input: object, parentSeq: number | null): Row {
  const { issue_id: _legacy, parent_id: _internal, ...rest } = input as Row
  return { ...rest, parent_id: parentSeq ?? null }
}

// Attachments belong to an issue. Expose the issue's #number as `issue_id`.
export function publicAttachment(input: object, issueSeq: number | null): Row {
  const { issue_id: _internal, ...rest } = input as Row
  return { ...rest, issue_id: issueSeq ?? null }
}

// Project updates belong to a project. Expose the project's #number.
export function publicProjectUpdate(input: object, projectSeq: number | null): Row {
  const { project_id: _internal, ...rest } = input as Row
  return { ...rest, project_id: projectSeq ?? null }
}

// `publicEvent` lived here until 2026-08-06. It moved into the shared activity
// factory as `publicEventIds` (packages/platform-api/src/routes/activity.ts):
// the substitution rule is platform, and only the SEQ MAP it consumes is this
// app's — that map is now the Class-B contribution the route mount passes in.
// `lib/api/activity-serialization.test.ts` pins the new one against a frozen
// copy of the old, so the wire format cannot drift.
