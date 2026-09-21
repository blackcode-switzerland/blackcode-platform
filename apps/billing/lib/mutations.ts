'use client'

// Every write the web UI makes — one hook per POST / PATCH / DELETE route, and
// no component sends a method string of its own.
//
// ── SUCCESS MEANS "THE PAGE ALREADY SHOWS IT" ───────────────────────────────
// Each hook's `onSuccess` AWAITS the invalidation of every key the write can
// change, and `mutateAsync` does not resolve until that `onSuccess` has
// finished. So:
//
//     await sendInvoice.mutateAsync({ ref, body })
//     toast.success('Sent — this cannot be undone')
//
// never announces a result beside the old values. The minimal UI's first
// version said "marked sent" next to status `draft`; a Playwright walk caught
// it (docs/frontend.md). Toast in the component, after the await — the words
// are the page's, the ordering is this module's.
//
// Errors are `WebError` (lib/client.ts) carrying the server's `error`, `code`
// and `suggestion`; `toastError(e)` renders all three.
//
// Every POST carries a fresh Idempotency-Key (lib/client.ts `call`).
//
// ── ACCOUNT WRITES ARE HERE TOO, AND ARE NOT BILLING PERMISSIONS ────────────
// Profile, tokens, password, workspace creation, the active workspace. None of
// them is gated on anything a billing role could remove; `CliAuthorizeForm`
// stays where it is (docs/frontend.md says why).

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  Company,
  CreateCompanyBody,
  CreateInvoiceBody,
  CreateInvoiceLineBody,
  CreateRecurrenceBody,
  GenerateOccurrenceBody,
  GenerateOccurrenceResult,
  ImportHistoryBody,
  ImportHistoryResult,
  Invoice,
  MarkPaidBody,
  Recurrence,
  RecurrenceStatus,
  SendInvoiceBody,
  VoidInvoiceBody,
} from '@/types'
import { call, WebError, wsApi } from './client'
import { keys } from './query-keys'
import type { Invitation, Me, WorkspaceSummary } from './queries'

/** A failed write as a toast: the server's sentence, and its suggestion underneath. */
export function toastError(e: unknown, fallback = 'Something went wrong') {
  if (e instanceof WebError) {
    toast.error(e.message, {
      description: [e.suggestion, e.code ? `(${e.code})` : null].filter(Boolean).join(' '),
    })
  } else {
    toast.error(e instanceof Error ? e.message : fallback)
  }
}

/**
 * The one shape every hook below is: send, then refetch what it changed before
 * resolving. `invalidate` sees the server's answer too, for writes whose
 * response names something the request did not (a generated invoice).
 */
function useWrite<TVars, TData>(
  send: (vars: TVars) => Promise<TData>,
  invalidate: (vars: TVars, data: TData) => QueryKey[]
) {
  const qc = useQueryClient()
  return useMutation<TData, unknown, TVars>({
    mutationFn: send,
    onSuccess: async (data, vars) => {
      await Promise.all(invalidate(vars, data).map((queryKey) => qc.invalidateQueries({ queryKey })))
    },
  })
}

const enc = (v: string | number) => encodeURIComponent(String(v))
const inv = (ws: string, ref: string | number, suffix = '') => wsApi(ws, `/invoices/${enc(ref)}${suffix}`)

/** An invoice changed: its page, every list, the overview, the log, and the series that carry invoices. */
const afterInvoice = (ws: string): QueryKey[] => [
  keys.invoiceAll(ws),
  keys.invoicesAll(ws),
  keys.overviewAll(ws),
  keys.auditAll(ws),
  keys.recurrenceAll(ws),
  keys.recurrencesAll(ws),
]

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/** `POST …/companies` → 201 Company */
export function useCreateCompany(ws: string) {
  return useWrite(
    (body: CreateCompanyBody) => call<Company>(wsApi(ws, '/companies'), { method: 'POST', body }),
    () => [keys.companiesAll(ws), keys.companyAll(ws), keys.auditAll(ws)]
  )
}

/**
 * `PATCH …/companies/{slug}` — send only the fields that changed. A draft's
 * payment part is derived from the live company, so drafts are refetched too.
 */
export function usePatchCompany(ws: string) {
  return useWrite(
    ({ slug, patch }: { slug: string; patch: Partial<CreateCompanyBody> & Record<string, unknown> }) =>
      call<Company>(wsApi(ws, `/companies/${enc(slug)}`), { method: 'PATCH', body: patch }),
    () => [keys.companiesAll(ws), keys.companyAll(ws), ...afterInvoice(ws)]
  )
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** `POST …/invoices` → 201 Invoice (a draft) */
export function useCreateInvoice(ws: string) {
  return useWrite(
    (body: CreateInvoiceBody) => call<Invoice>(wsApi(ws, '/invoices'), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

/**
 * `PATCH …/invoices/{ref}` with FIELDS. After send only `due_date`, `message`,
 * `external_ref`, `metadata` are open; a frozen field answers 409
 * `document_frozen` — render those read-only before the request.
 */
export function usePatchInvoice(ws: string) {
  return useWrite(
    ({ ref, patch }: { ref: string | number; patch: Record<string, unknown> }) =>
      call<Invoice>(inv(ws, ref), { method: 'PATCH', body: patch }),
    () => afterInvoice(ws)
  )
}

/** `PATCH …/invoices/{ref}` with `items` ALONE — replaces every line (the route refuses items + fields together). */
export function useSetInvoiceLines(ws: string) {
  return useWrite(
    ({ ref, items }: { ref: string | number; items: CreateInvoiceLineBody[] }) =>
      call<Invoice>(inv(ws, ref), { method: 'PATCH', body: { items } }),
    () => afterInvoice(ws)
  )
}

/** `POST …/invoices/{ref}/send` — emails the PDF. 503 `email_not_configured`, 422 `payment_part_invalid`. Not undoable. */
export function useSendInvoice(ws: string) {
  return useWrite(
    ({ ref, body }: { ref: string | number; body: SendInvoiceBody }) =>
      call<Invoice>(inv(ws, ref, '/send'), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

/** `POST …/invoices/{ref}/mark-sent` — delivered outside the app. No body. Not undoable. */
export function useMarkSent(ws: string) {
  return useWrite(
    ({ ref }: { ref: string | number }) => call<Invoice>(inv(ws, ref, '/mark-sent'), { method: 'POST', body: {} }),
    () => afterInvoice(ws)
  )
}

/** `POST …/invoices/{ref}/paid` — `paid_date` YYYY-MM-DD, not in the future. Not undoable. */
export function useMarkPaid(ws: string) {
  return useWrite(
    ({ ref, ...body }: { ref: string | number } & MarkPaidBody) =>
      call<Invoice>(inv(ws, ref, '/paid'), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

/**
 * `POST …/invoices/{ref}/void` — a reason (one language is enough) and
 * `confirm` equal to the printed number (409 `confirm_mismatch` otherwise).
 * Collect the reason with `useConfirm`'s prompt variant. Not undoable.
 */
export function useVoidInvoice(ws: string) {
  return useWrite(
    ({ ref, body }: { ref: string | number; body: VoidInvoiceBody }) =>
      call<Invoice>(inv(ws, ref, '/void'), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

// ---------------------------------------------------------------------------
// Recurring series
// ---------------------------------------------------------------------------

/** `POST …/recurrences` — "Make recurring…". `occurrences_total` is required. */
export function useCreateRecurrence(ws: string) {
  return useWrite(
    (body: CreateRecurrenceBody) => call<Recurrence>(wsApi(ws, '/recurrences'), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

export interface RecurrencePatch {
  /** Pause/resume. `completed` is never sent. */
  status?: Exclude<RecurrenceStatus, 'completed'>
  occurrences_total?: number
  label_fr?: string | null
  label_en?: string | null
  /** A new template invoice (#number or printed number). */
  template?: string
  external_ref?: string | null
  metadata?: Record<string, string>
}

/** `PATCH …/recurrences/{seq}` */
export function usePatchRecurrence(ws: string) {
  return useWrite(
    ({ seq, patch }: { seq: string | number; patch: RecurrencePatch }) =>
      call<Recurrence>(wsApi(ws, `/recurrences/${enc(seq)}`), { method: 'PATCH', body: patch }),
    () => [keys.recurrenceAll(ws), keys.recurrencesAll(ws), keys.auditAll(ws), keys.overviewAll(ws)]
  )
}

/**
 * `POST …/recurrences/{seq}/generate` → 201 `{ invoice, recurrence, replacement }`.
 * Send the `next_period` the page DISPLAYS, never one computed here;
 * 409 `already_generated` names the existing invoice.
 */
export function useGenerateOccurrence(ws: string) {
  return useWrite(
    ({ seq, body }: { seq: string | number; body: GenerateOccurrenceBody }) =>
      call<GenerateOccurrenceResult>(wsApi(ws, `/recurrences/${enc(seq)}/generate`), { method: 'POST', body }),
    () => afterInvoice(ws)
  )
}

// ---------------------------------------------------------------------------
// Imported history
// ---------------------------------------------------------------------------

/** `POST …/history` — all rows or none. → 201 ImportHistoryResult */
export function useImportHistory(ws: string) {
  return useWrite(
    (body: ImportHistoryBody) => call<ImportHistoryResult>(wsApi(ws, '/history'), { method: 'POST', body }),
    () => [keys.historyAll(ws), [...keys.workspace(ws), 'history-entry'], keys.auditAll(ws)]
  )
}

// ---------------------------------------------------------------------------
// Team (owner only)
// ---------------------------------------------------------------------------

export interface InvitationCreated {
  invitation: Invitation
  /** Always false today: this app sends no invitation email. Say so. */
  email_sent: boolean
  accept_url: string
}

/** `POST …/invitations` — 409 `already_member`. */
export function useCreateInvitation(ws: string) {
  return useWrite(
    (body: { email: string }) => call<InvitationCreated>(wsApi(ws, '/invitations'), { method: 'POST', body }),
    () => [keys.invitations(ws)]
  )
}

/** `DELETE …/invitations/{id}` */
export function useRevokeInvitation(ws: string) {
  return useWrite(
    ({ id }: { id: number }) => call<{ deleted: true }>(wsApi(ws, `/invitations/${enc(id)}`), { method: 'DELETE' }),
    () => [keys.invitations(ws)]
  )
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface MePatch {
  name?: string | null
  tagline?: string | null
  avatar_url?: string | null
  /** null = follow the browser. */
  locale?: string | null
}

/** `PATCH /api/me` */
export function usePatchMe() {
  return useWrite(
    (patch: MePatch) => call<Partial<Me>>('/api/me', { method: 'PATCH', body: patch }),
    () => [keys.me()]
  )
}

export interface MintedToken {
  id: number
  /** Shown ONCE. Never stored, never recoverable. */
  plaintext: string
  prefix: string
  name: string
  scopes: string[]
  expires_at: string | null
  created_at: string | null
}

/** `POST /api/tokens` — `expires_at` ISO 8601, in the future, or omitted. */
export function useCreateToken() {
  return useWrite(
    (body: { name: string; expires_at?: string | null }) => call<MintedToken>('/api/tokens', { method: 'POST', body }),
    () => [keys.tokens()]
  )
}

/** `DELETE /api/tokens/{id}` */
export function useDeleteToken() {
  return useWrite(
    ({ id }: { id: number }) => call<{ deleted: true }>(`/api/tokens/${enc(id)}`, { method: 'DELETE' }),
    () => [keys.tokens()]
  )
}

/** `POST /api/me/password/request-otp` → `{ ok, email }` (masked). 503 `email_not_configured`. */
export function useRequestPasswordOtp() {
  return useWrite(
    () => call<{ ok: true; email: string }>('/api/me/password/request-otp', { method: 'POST', body: {} }),
    () => []
  )
}

/** `POST /api/me/password/confirm` — signs every session out, everywhere. */
export function useConfirmPassword() {
  return useWrite(
    (body: { otp: string; new_password: string }) =>
      call<{ ok: true }>('/api/me/password/confirm', { method: 'POST', body }),
    () => []
  )
}

/**
 * `POST /api/workspaces` → 201 workspace. The shell's switcher list is loaded
 * server-side, so follow with `router.push('/dashboard/<slug>')` +
 * `router.refresh()`.
 */
export function useCreateWorkspace() {
  return useWrite(
    (body: { name: string }) => call<WorkspaceSummary>('/api/workspaces', { method: 'POST', body }),
    () => [keys.workspaces(), keys.meta()]
  )
}

/** `POST /api/me/active-workspace` — what `bk billing workspace use` writes; the next `/dashboard` opens there. */
export function useSetActiveWorkspace() {
  return useWrite(
    (body: { slug: string }) =>
      call<{ active_workspace_id: number; slug: string }>('/api/me/active-workspace', { method: 'POST', body }),
    () => [keys.me(), keys.meta()]
  )
}

/** `DELETE /api/me/footprint` — your data in THIS app only; 409 `owner_with_members`. */
export function useDeleteFootprint() {
  return useWrite(
    () => call<{ deleted: true; app: string; remaining: unknown }>('/api/me/footprint', { method: 'DELETE' }),
    () => [keys.footprint(), keys.workspaces(), keys.me()]
  )
}
