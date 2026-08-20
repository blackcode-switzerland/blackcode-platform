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

interface RecordMutationOptions<TVars, TData = unknown> {
  /** The request, in terms of `ws` and the caller's variables. */
  send: (vars: TVars) => Promise<TData>
  /** Query keys to invalidate on success. The record's page, its listings. */
  invalidate: (vars: TVars) => QueryKey[]
  /**
   * What the toast says. A write nobody can see land is a write nobody trusts.
   *
   * ── THE SECOND PARAMETER IS THE SERVER'S ANSWER, AND IT IS OPTIONAL ───────
   * `success` took only `vars` — what the client SENT — so every toast in this
   * app could report the request and never the result. That is fine for
   * "Prospect updated" and it was wrong for exactly one call site: sending an
   * invitation, where the server returns `email_sent` saying whether the email
   * actually went out, and the UI said "Invitation created for x@y.ch" whether
   * it had or not. The route's own comment calls that out — "a client that
   * cannot tell 'sent' from 'not attempted' will assume the first one" — and
   * the web app was that client.
   *
   * Widened as an OPTIONAL second parameter rather than a required one, so the
   * dozen `success: () => 'Contact updated'` call sites keep working untouched.
   * A required parameter would have meant editing every one of them to ignore
   * a value they have no use for.
   *
   * ── RETURNING `{ message, ok: false }` MAKES IT A WARNING, NOT A TICK ─────
   * A write can succeed and still have a half that did not, and the invitation
   * is the case: the row is written, the email bounced. Rendering that through
   * `toast.success` would put a green checkmark next to the sentence "the email
   * could not be sent", which is a success message pretending — the reader
   * takes the icon and not the words. So a caller that knows better can say so,
   * and the plain string stays the shorthand for "it worked".
   */
  success: (vars: TVars, data: TData) => string | { message: string; ok: boolean }
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
function useRecordMutation<TVars, TData = unknown>(
  ws: string,
  opts: RecordMutationOptions<TVars, TData>
) {
  const canWrite = useCanWrite(ws)
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (vars: TVars) => {
      if (!canWrite) throw new ReadOnlyModeError()
      return opts.send(vars)
    },
    onSuccess: (data, vars) => {
      for (const key of opts.invalidate(vars)) qc.invalidateQueries({ queryKey: key })
      // `data` was `_data` — named as unused while carrying the server's
      // answer. See `RecordMutationOptions.success`.
      const result = opts.success(vars, data)
      if (typeof result === 'string') toast.success(result)
      else if (result.ok) toast.success(result.message)
      // `toast.warning`, not `toast.error`: the write DID land, and an error
      // toast would tell the reader to try again when there is nothing to
      // retry. The longer duration is because this one asks them to do
      // something — the default four seconds is not enough to read a sentence
      // and act on it.
      else toast.warning(result.message, { duration: 10_000 })
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
  /** Migration 0008 — the identity card (#34). */
  website?: string | null
  address?: string | null
  /** Migration 0010. The segment's #NUMBER (#37) and this prospect's own angle
   *  on top of it (#35). `null` unlinks the segment. */
  strategy?: number | null
  game_plan?: string | null
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
// Strategies — the reusable segment reasoning (#37)
// ---------------------------------------------------------------------------

export interface StrategyInput {
  name?: string
  vertical?: string | null
  area?: string | null
  rationale?: string | null
  case_studies?: string | null
  /** Product #numbers. Omitted leaves the set alone; `[]` clears it. The route
   *  REPLACES rather than merges — see its header. */
  products?: number[]
}

export function useCreateStrategy(ws: string) {
  return useRecordMutation<StrategyInput>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, '/strategies'), vars),
    invalidate: () => [['strategies', ws]],
    success: (vars) => `${vars.name ?? 'Strategy'} created`,
  })
}

export function useEditStrategy(ws: string) {
  return useRecordMutation<{ number: number; patch: StrategyInput }>(ws, {
    send: ({ number, patch }) => apiSend('PATCH', wsPath(ws, `/strategies/${number}`), patch),
    invalidate: () => [['strategies', ws]],
    success: () => 'Strategy updated',
  })
}

export function useRemoveStrategy(ws: string) {
  return useRecordMutation<{ number: number; name: string }>(ws, {
    send: ({ number }) => apiSend('DELETE', wsPath(ws, `/strategies/${number}`)),
    // Prospects carry `strategy`, so binning one changes what a prospect page
    // shows — invalidate both or the link lingers on screen until a reload.
    invalidate: () => [['strategies', ws], ['prospects', ws]],
    success: ({ name }) => `${name} binned — restore from Trash`,
  })
}

// ---------------------------------------------------------------------------
// Research log — APPEND and DESTROY. There is deliberately no edit hook
// ---------------------------------------------------------------------------
// The log is append-only (see the route header). A `useEditProspectNote` here
// would have no route to call, and adding one would undo the table: an editable
// log answers "what do we think now", which `--summary` already answers.

export function useAddProspectNote(ws: string, n: number) {
  return useRecordMutation<{ body: string; kind?: string | null }>(ws, {
    send: (vars) => apiSend('POST', wsPath(ws, `/prospects/${n}/notes`), vars),
    invalidate: () => [['prospect-notes', ws, n]],
    success: () => 'Note added',
  })
}

export function useRemoveProspectNote(ws: string, n: number) {
  return useRecordMutation<{ id: number }>(ws, {
    // `?confirm=<id>` is what the route requires, and it is sent from HERE
    // rather than typed by the user: a web click is already an explicit,
    // interactive act, and the confirmation exists to stop a NON-interactive
    // caller auto-approving. The dialog is the human-facing half.
    send: ({ id }) => apiSend('DELETE', wsPath(ws, `/prospects/${n}/notes/${id}?confirm=${id}`)),
    invalidate: () => [['prospect-notes', ws, n]],
    success: () => 'Note destroyed',
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
  /** `null` clears the link; omitting the key leaves it alone. */
  meeting_url?: string | null
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

// `invite-candidates` joined this list on 2026-08-11, when the members page
// started RENDERING that query (the super admin's shortcut). Every one of these
// three mutations changes an answer it gives — invite sets `invited`, revoke
// clears it, remove clears `already_member` — so leaving it out would have left
// a row showing "Invite" for somebody just invited until the next reload. The
// route has existed since Phase 2; it is being read for the first time.
const teamKeys = (ws: string): QueryKey[] => [
  ['members', ws],
  ['invitations', ws],
  ['invite-candidates', ws],
]

/** What `POST …/invitations` answers with. `email_sent` is the half that matters. */
interface InvitationCreated {
  invitee_has_account?: boolean
  email_sent?: boolean
  accept_url?: string
}

/**
 * Invite somebody, and SAY WHETHER THE EMAIL WENT.
 *
 * ---------------------------------------------------------------------------
 * THE FALSE BRANCH IS THE POINT
 * ---------------------------------------------------------------------------
 * This said `Invitation created for x@y.ch` unconditionally. The invitation is
 * always created — that part was true — and it said nothing at all about
 * delivery, so the person inviting had no way to know whether they also needed
 * to send the link by hand. The server has always answered the question:
 * `email_sent` is the real result of `sendInvitationEmail`, and the route's own
 * comment says it is reported rather than omitted precisely because "a client
 * that cannot tell 'sent' from 'not attempted' will assume the first one".
 *
 * Email here is BEST-EFFORT BY DESIGN. A bounce does not fail the request,
 * because the invitation is written and valid either way — so a toast that
 * always claims the email was sent is a claim larger than the check that
 * produced it, which is the defect this project keeps finding written down in
 * CLAUDE.md. If it did not send, say so, and point at the copy-link affordance
 * the members page already has.
 *
 * `email_sent === false` and a MISSING `email_sent` are deliberately the same
 * branch: an older deployment that does not return the field cannot be claimed
 * to have sent anything. The only sentence that promises delivery is the one
 * behind an explicit `true`.
 */
export function useInviteMember(ws: string) {
  return useRecordMutation<{ email: string }, InvitationCreated>(ws, {
    send: ({ email }) =>
      apiSend('POST', wsPath(ws, '/invitations'), { email }) as Promise<InvitationCreated>,
    invalidate: () => teamKeys(ws),
    success: ({ email }, data) =>
      data?.email_sent === true
        ? { ok: true, message: `Invited ${email} — invitation email sent` }
        : {
            ok: false,
            message: `Invited ${email} — but the email could not be sent. Copy the invite link and send it yourself.`,
          },
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
