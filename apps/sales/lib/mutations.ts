'use client'

// Every write to a sales RECORD that the web app can make. All of them.
//
// ===========================================================================
// THE PROPERTY THIS MODULE EXISTS TO KEEP CHECKABLE
// ===========================================================================
// Before Phase 9 this app exported one request function, `apiGet`, and had no
// mutation verb anywhere. "The web is read-only" was therefore a fact about the
// module graph that anybody could confirm with grep — not an intention.
//
// Adding writes as `fetch` calls inside components would have turned it back
// into an intention. So the arrangement is:
//
//   lib/client.ts     the ONLY `fetch(` in the app. `apiGet` + `apiSend`.
//                     Transport. Consults nothing.
//   lib/mutations.ts  the ONLY module that sends `apiSend` at an
//                     `/api/workspaces/…` path. Every hook here is built on
//                     `useRecordMutation`, which reads `useCanWrite()`.
//   components/**     render `useCanWrite()` and call these hooks. No fetch,
//                     no apiSend, no method strings.
//
// `lib/read-only.test.ts` asserts all three, and asserts the inputs before
// trusting them. That is what a reviewer checks instead of reading every
// component: not "did agent7 remember", but "can a component do this at all".
//
// ===========================================================================
// AND IT IS STILL NOT A PERMISSION (D-7)
// ===========================================================================
// `useRecordMutation` refuses in `read_only`, and that refusal is worth exactly
// nothing as a security control — it is client-side, the user owns the client,
// and they can flip the preference themselves from Settings. It is here for a
// different reason: **so that a component which forgets to hide its button
// fails loudly rather than writing.** The failure is a visible error, not a
// silent success, which is what makes a missed affordance findable.
//
// The real control is `platform.app_access` and the workspace role, on the
// server, which refuse a write the UI allowed exactly as readily as one it did
// not. Verified rather than assumed — see agent7's report and
// `apps/sales/docs/frontend.md`.

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiSend, query, wsPath } from '@/lib/client'
import { useCanWrite } from '@/lib/ui-mode'

/** Thrown when a component asks for a write that read-only mode has hidden. */
export class ReadOnlyModeError extends Error {
  constructor() {
    super(
      'This browser is in read-only mode. Switch to full mode in Settings → ' +
        'Preferences, or write with `bk sales`.'
    )
    this.name = 'ReadOnlyModeError'
  }
}

interface RecordMutationOptions<TVars> {
  /** The request, in terms of `ws` and the caller's variables. */
  send: (vars: TVars) => Promise<unknown>
  /** Query keys to invalidate on success. The record's page, its listings. */
  invalidate: (vars: TVars) => QueryKey[]
  /** What the toast says. A write nobody can see land is a write nobody trusts. */
  success: (vars: TVars) => string
}

/**
 * The one `useMutation` in this app.
 *
 * Everything below composes it, which is what makes "every record write is
 * gated" a property of one function rather than a promise repeated N times.
 * `lib/read-only.test.ts` counts the `useMutation(` occurrences in this file and
 * fails on a second one — not because a second would necessarily be ungated, but
 * because the moment there are two nobody can tell by looking.
 */
function useRecordMutation<TVars>(ws: string, opts: RecordMutationOptions<TVars>) {
  const canWrite = useCanWrite(ws)
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!canWrite) throw new ReadOnlyModeError()
      return opts.send(vars)
    },
    onSuccess: (_data, vars) => {
      for (const key of opts.invalidate(vars)) qc.invalidateQueries({ queryKey: key })
      toast.success(opts.success(vars))
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

const prospectKeys = (ws: string, n: number): QueryKey[] => [
  ['prospect', ws, n],
  ['prospects', ws],
  ['today', ws],
  ['pipeline', ws],
  ['metrics', ws],
]

export interface ProspectPatch {
  name?: string
  city?: string | null
  sector?: string | null
  value?: string | null
  currency?: string
  owner?: string | null
  source?: string | null
  summary?: string | null
}

export function useEditProspect(ws: string, n: number) {
  return useRecordMutation<ProspectPatch>(ws, {
    send: (patch) => apiSend('PATCH', wsPath(ws, `/prospects/${n}`), patch),
    invalidate: () => prospectKeys(ws, n),
    success: () => 'Prospect updated',
  })
}

/**
 * Move a deal.
 *
 * A separate route from the PATCH above, and the split is a contract rather than
 * a layout: a stage change writes a `stage_entries` row and may set `closed_at`,
 * and the PATCH refuses `stage` outright with a 400 naming this one. The form
 * must not "helpfully" send it the other way.
 */
export function useSetStage(ws: string, n: number) {
  return useRecordMutation<{ stage: string; note?: string; reason?: string }>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, `/prospects/${n}/stage`), vars),
    invalidate: () => prospectKeys(ws, n),
    success: () => 'Deal moved',
  })
}

export function useSetNextAction(ws: string, n: number) {
  return useRecordMutation<{
    type?: string | null
    due?: string | null
    due_label?: string | null
    note?: string | null
    owner?: string | null
  }>(ws, {
    send: (vars) => apiSend('PATCH', wsPath(ws, `/prospects/${n}/next-action`), vars),
    invalidate: () => prospectKeys(ws, n),
    success: () => 'Next action updated',
  })
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactInput {
  name?: string
  role?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  is_primary?: boolean
}

export function useAddContact(ws: string, n: number) {
  return useRecordMutation<ContactInput>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, `/prospects/${n}/contacts`), vars),
    invalidate: () => [['contacts', ws, n]],
    success: (vars) => `${vars.name ?? 'Contact'} added`,
  })
}

export function useEditContact(ws: string, n: number) {
  return useRecordMutation<{ id: number; patch: ContactInput }>(ws, {
    send: ({ id, patch }) => apiSend('PATCH', wsPath(ws, `/prospects/${n}/contacts/${id}`), patch),
    invalidate: () => [['contacts', ws, n]],
    success: () => 'Contact updated',
  })
}

export function useRemoveContact(ws: string, n: number) {
  return useRecordMutation<{ id: number; name: string }>(ws, {
    send: ({ id }) => apiSend('DELETE', wsPath(ws, `/prospects/${n}/contacts/${id}`)),
    invalidate: () => [['contacts', ws, n]],
    success: ({ name }) => `${name} removed`,
  })
}

// ---------------------------------------------------------------------------
// Objections — three fields, kept as three
// ---------------------------------------------------------------------------

export interface ObjectionInput {
  type?: string
  raised_by?: string | null
  spoken?: string | null
  real_fear?: string | null
  counter?: string | null
  status?: string
}

export function useRaiseObjection(ws: string, n: number) {
  return useRecordMutation<ObjectionInput>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, `/prospects/${n}/objections`), vars),
    invalidate: () => [['objections', ws, n]],
    success: () => 'Objection recorded',
  })
}

export function useEditObjection(ws: string, n: number) {
  return useRecordMutation<{ id: number; patch: ObjectionInput }>(ws, {
    send: ({ id, patch }) =>
      apiSend('PATCH', wsPath(ws, `/prospects/${n}/objections/${id}`), patch),
    invalidate: () => [['objections', ws, n]],
    success: () => 'Objection updated',
  })
}

/**
 * Bin an objection.
 *
 * `?confirm=<type>` is the SERVER's requirement, not this form's politeness: the
 * route refuses without it, because `Confirm()` in the CLI auto-approves under
 * `BK_NO_PROMPT=1` and the guard that survives an agent is the caller repeating
 * the target back. The web has to satisfy the same check, which is exactly what
 * "enforced on the server so it cannot be skipped" means.
 */
export function useRemoveObjection(ws: string, n: number) {
  return useRecordMutation<{ id: number; confirm: string }>(ws, {
    send: ({ id, confirm }) =>
      apiSend('DELETE', wsPath(ws, `/prospects/${n}/objections/${id}`) + query({ confirm })),
    invalidate: () => [['objections', ws, n]],
    success: () => 'Objection removed',
  })
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

const ledgerKeys = (ws: string): QueryKey[] => [
  ['meetings', ws],
  ['communications', ws],
  ['today', ws],
  ['metrics', ws],
]

export interface MeetingInput {
  prospect?: number
  title?: string
  type?: string
  at?: string
  duration_min?: number | null
  attendees?: string[]
  agenda?: string | null
  outcome?: string | null
  status?: string
}

export function useScheduleMeeting(ws: string) {
  return useRecordMutation<MeetingInput>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, '/meetings'), vars),
    invalidate: () => ledgerKeys(ws),
    success: () => 'Meeting recorded',
  })
}

/**
 * Edit a meeting.
 *
 * An OUTCOME implies the meeting happened, so the route moves the status when
 * one arrives. The form does not send a status alongside it and must not: two
 * sources for one field is how a meeting ends up `upcoming` with an outcome
 * written on it.
 */
export function useEditMeeting(ws: string, n: number) {
  return useRecordMutation<MeetingInput>(ws, {
    send: (vars) => apiSend('PATCH', wsPath(ws, `/meetings/${n}`), vars),
    invalidate: () => ledgerKeys(ws),
    success: () => 'Meeting updated',
  })
}

export function useRemoveMeeting(ws: string) {
  return useRecordMutation<{ number: number; confirm: string }>(ws, {
    send: ({ number, confirm }) =>
      apiSend('DELETE', wsPath(ws, `/meetings/${number}`) + query({ confirm })),
    invalidate: () => ledgerKeys(ws),
    success: ({ number }) => `Meeting #${number} binned — restore it with \`bk sales trash\``,
  })
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export interface CommunicationInput {
  prospect?: number
  channel?: string
  direction?: string
  at?: string
  subject?: string | null
  body?: string | null
  contact?: number | string | null
}

/**
 * Log an exchange. **The app does not SEND anything** (`docs/backend.md` §1) —
 * this records that a message was sent, by whatever means it actually was.
 */
export function useLogCommunication(ws: string) {
  return useRecordMutation<CommunicationInput>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, '/communications'), vars),
    invalidate: () => ledgerKeys(ws),
    success: () => 'Logged',
  })
}

// There is no `useEditCommunication`. `PATCH …/communications/{n}` does not
// exist: an exchange is a record of something that happened at a moment, and the
// route surface agent5 built offers `log`, `show` and `rm` for that reason. A
// wrong one is binned and logged again, which leaves both facts in the feed.

export function useRemoveCommunication(ws: string) {
  return useRecordMutation<{ number: number; confirm: string }>(ws, {
    send: ({ number, confirm }) =>
      apiSend('DELETE', wsPath(ws, `/communications/${number}`) + query({ confirm })),
    invalidate: () => ledgerKeys(ws),
    success: ({ number }) => `Communication #${number} binned`,
  })
}

// ---------------------------------------------------------------------------
// The team — `sales.workspace_members` and `sales.invitations` (Phase 2)
// ---------------------------------------------------------------------------
// These are RECORD writes, not account operations, and the distinction is the
// one `lib/read-only.test.ts` draws by path: `/api/me` and `/api/tokens` are
// the platform account, `/api/workspaces/…` is this app's data. Membership moved
// from `platform.workspace_members` to `sales.workspace_members` on 2026-08-10,
// which moved it across that line — so it belongs here, behind `useCanWrite()`,
// with everything else that writes a sales row.
//
// The one that is NOT here is ACCEPTING an invitation
// (`components/accept-invitation.tsx`, `POST /api/invitations/accept`). It is
// not workspace-scoped and it must not be gateable: read-only is a browser
// display preference, and a preference that could stop somebody joining the app
// at all would be a permission over their account — D-7's misreading exactly.

const teamKeys = (ws: string): QueryKey[] => [['members', ws], ['invitations', ws]]

export function useInviteMember(ws: string) {
  return useRecordMutation<{ email: string }>(ws, {
    send: ({ email }) => apiSend('POST', wsPath(ws, '/invitations'), { email }),
    invalidate: () => teamKeys(ws),
    success: ({ email }) => `Invitation created for ${email}`,
  })
}

export function useRevokeInvitation(ws: string) {
  return useRecordMutation<{ id: number }>(ws, {
    send: ({ id }) => apiSend('DELETE', wsPath(ws, `/invitations/${id}`)),
    invalidate: () => teamKeys(ws),
    success: () => 'Invitation revoked',
  })
}

export function useRemoveMember(ws: string) {
  return useRecordMutation<{ userId: number; email: string }>(ws, {
    send: ({ userId }) => apiSend('DELETE', wsPath(ws, `/members/${userId}`)),
    invalidate: () => teamKeys(ws),
    success: ({ email }) => `${email} removed`,
  })
}
