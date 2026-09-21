'use client'

// Every read the web UI makes, one `useQuery` hook per GET route.
//
// Nothing here computes what the server derives — totals, references, the next
// period, the payment-part problems are read from the response as they are
// (apps/billing/docs/frontend.md). A hook returns the route's answer, and a
// paginated list returns its whole `{ data, next_cursor }` envelope so a page
// can offer "load more" without a second hook.

import { useQuery } from '@tanstack/react-query'
import type { Term } from '@/lib/vocabularies'
import type {
  AuditEntry,
  Company,
  HistoryEntry,
  Invoice,
  Overview,
  Recurrence,
} from '@/types'
import { call, list, qs, text, wsApi, type Page } from './client'
import {
  keys,
  type AuditFilters,
  type CompanyFilters,
  type HistoryFilters,
  type InvoiceFilters,
  type RecurrenceFilters,
} from './query-keys'

/** Options every hook accepts. `enabled: false` defers the request (e.g. the QR payload until asked). */
export interface QueryOpts {
  enabled?: boolean
}

// ---------------------------------------------------------------------------
// Wire types for the platform routes. Dates arrive as ISO strings.
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  id: number
  name: string
  slug: string
  owner_id: number
  updated_at: string
  member_role: 'owner' | 'member'
}

export interface Member {
  id: number
  workspace_id: number
  user_id: number
  role: string
  joined_at: string
  email: string
  name: string | null
  avatar_url: string | null
  deleted_at: string | null
}

export interface WorkspaceShow {
  workspace: Omit<WorkspaceSummary, 'member_role'>
  role: 'owner' | 'member'
  members: Member[]
}

export interface Invitation {
  id: number
  email: string
  role: string
  /** Redeemable. Owner-only listing, and the link is on every row. */
  token: string
  status: string
  expires_at: string
  created_at: string
  invited_by_name: string | null
  invited_by_email: string
}

/** `GET …/invite-candidates` row — people you already share a workspace with. */
export interface InviteCandidate {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
  already_member: boolean
  invited: boolean
  shared_workspaces: string[]
  /** Here only because the caller is a super admin — render apart. */
  from_platform: boolean
}

export interface Me {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  active_workspace_id: number | null
  created_at: string
  connected_google: boolean
  avatar_editable: boolean
  /** Null means "never chosen" — not English. */
  locale: string | null
  via: 'session' | 'token'
  is_super_admin: boolean
}

export interface TokenSummary {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface Footprint {
  app: string
  footprint: {
    known: boolean
    /** `reason: 'retention'` = holds records kept for ten years; absent/'members' = other people are in it. */
    blocked_by: Array<{ workspace_id: number; name: string; member_count: number; reason?: 'members' | 'retention'; detail?: string }>
    will_delete: Array<{ workspace_id: number; name: string }>
    [k: string]: unknown
  }
}

/** `GET /api/meta` — the vocabularies and limits a form needs. Never copy a number from here into code. */
export interface BillingMeta {
  app: string
  contract_version: string
  vocabulary: Record<string, Term[]>
  limits: {
    workspace_name_max: number
    payment_message_max: number
    page_size_default: number
    page_size_max: number
    metadata: { max_keys: number; max_key_length: number; max_value_length: number }
    delivery: { subject_max: number; body_max: number; cc_max: number; void_reason_max: number }
    reference: { qrr_body_length: number; scor_body_max: number }
    history: Record<string, number>
    recurrence: { occurrences_max: number; label_max: number }
  }
  [k: string]: unknown
}

// ---------------------------------------------------------------------------
// Workspace-scoped reads
// ---------------------------------------------------------------------------

/** `GET …/overview[?company=]` — per-currency totals, never summed across currencies. */
export function useOverview(ws: string, company?: string | null, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.overview(ws, company),
    queryFn: () => call<Overview>(wsApi(ws, `/overview${qs({ company })}`)),
    ...opts,
  })
}

/** `GET …/companies` — a small list, returned as rows. */
export function useCompanies(ws: string, f: CompanyFilters = {}, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.companies(ws, f),
    queryFn: () =>
      list<Company>(wsApi(ws, `/companies${qs({ include_retired: f.include_retired, external_ref: f.external_ref })}`)),
    ...opts,
  })
}

/** `GET …/companies/{slug}` */
export function useCompany(ws: string, slug: string | null | undefined, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.company(ws, slug ?? ''),
    queryFn: () => call<Company>(wsApi(ws, `/companies/${encodeURIComponent(slug!)}`)),
    ...opts,
    enabled: !!slug && (opts.enabled ?? true),
  })
}

/** `GET …/invoices` with filters. Envelope, for "load more" via `cursor`. */
export function useInvoices(ws: string, f: InvoiceFilters = {}, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.invoices(ws, f),
    queryFn: () => call<Page<Invoice>>(wsApi(ws, `/invoices${qs({ ...f })}`)),
    ...opts,
  })
}

/** `GET …/invoices/{ref}` — `ref` is the #number or the printed number. */
export function useInvoice(ws: string, ref: string | number, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.invoice(ws, ref),
    queryFn: () => call<Invoice>(wsApi(ws, `/invoices/${encodeURIComponent(String(ref))}`)),
    ...opts,
  })
}

/**
 * `GET …/invoices/{ref}/qr` — the payload string, byte for byte. Draw the
 * matrix from THIS, never from a re-serialisation. Pass `{ enabled: false }`
 * and `refetch()` to load it on demand.
 */
export function useInvoiceQr(ws: string, ref: string | number, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.invoiceQr(ws, ref),
    queryFn: () => text(wsApi(ws, `/invoices/${encodeURIComponent(String(ref))}/qr`)),
    ...opts,
  })
}

/**
 * `GET …/invoices/{ref}/pdf` is opened, not fetched: this is its URL. The route
 * answers `inline`, so Preview is `target="_blank"` and Download is an `<a
 * download>` on the same URL — there is no download query parameter.
 */
export const invoicePdfUrl = (ws: string, ref: string | number) =>
  wsApi(ws, `/invoices/${encodeURIComponent(String(ref))}/pdf`)

/** `GET …/audit[?subject=invoice:<ref>|recurrence:<seq>]` — newest first. */
export function useAudit(ws: string, f: AuditFilters = {}, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.audit(ws, f),
    queryFn: () => call<Page<AuditEntry>>(wsApi(ws, `/audit${qs({ ...f })}`)),
    ...opts,
  })
}

/** `GET …/recurrences` — `due: true` lists the series whose next date has arrived. */
export function useRecurrences(ws: string, f: RecurrenceFilters = {}, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.recurrences(ws, f),
    queryFn: () => call<Page<Recurrence>>(wsApi(ws, `/recurrences${qs({ ...f })}`)),
    ...opts,
  })
}

/** `GET …/recurrences/{seq}` — the card, with `invoices[]`. */
export function useRecurrence(ws: string, seq: string | number | null | undefined, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.recurrence(ws, seq ?? ''),
    queryFn: () => call<Recurrence>(wsApi(ws, `/recurrences/${encodeURIComponent(String(seq))}`)),
    ...opts,
    enabled: seq !== null && seq !== undefined && seq !== '' && (opts.enabled ?? true),
  })
}

/** `GET …/history` — imported bills. Never summed into the overview. */
export function useHistory(ws: string, f: HistoryFilters = {}, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.history(ws, f),
    queryFn: () => call<Page<HistoryEntry>>(wsApi(ws, `/history${qs({ ...f })}`)),
    ...opts,
  })
}

/** `GET …/history/{seq}` */
export function useHistoryEntry(ws: string, seq: string | number, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.historyEntry(ws, seq),
    queryFn: () => call<HistoryEntry>(wsApi(ws, `/history/${encodeURIComponent(String(seq))}`)),
    ...opts,
  })
}

/** `GET /api/workspaces/{ws}` — the workspace, your role, its members. */
export function useWorkspace(ws: string, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.workspaceShow(ws),
    queryFn: () => call<WorkspaceShow>(wsApi(ws)),
    ...opts,
  })
}

/** `GET …/members` */
export function useMembers(ws: string, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.members(ws),
    queryFn: () => list<Member>(wsApi(ws, '/members')),
    ...opts,
  })
}

/** `GET …/invitations` — OWNER ONLY; a member gets a 403, so pass `enabled: isOwner`. */
export function useInvitations(ws: string, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.invitations(ws),
    queryFn: () => list<Invitation>(wsApi(ws, '/invitations')),
    ...opts,
  })
}

/** `GET …/invite-candidates` — OWNER ONLY, like the invitations list. */
export function useInviteCandidates(ws: string, opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.inviteCandidates(ws),
    queryFn: () => list<InviteCandidate>(wsApi(ws, '/invite-candidates')),
    ...opts,
  })
}

// ---------------------------------------------------------------------------
// Account-level reads
// ---------------------------------------------------------------------------

/** `GET /api/me` — the live row; the session's copy is minted at sign-in and never refreshed. */
export function useMe(opts: QueryOpts = {}) {
  return useQuery({ queryKey: keys.me(), queryFn: () => call<Me>('/api/me'), ...opts })
}

/** `GET /api/tokens` — a bare array (not an envelope). */
export function useTokens(opts: QueryOpts = {}) {
  return useQuery({ queryKey: keys.tokens(), queryFn: () => call<TokenSummary[]>('/api/tokens'), ...opts })
}

/** `GET /api/meta` — vocabularies and limits. Rarely changes. */
export function useMeta(opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.meta(),
    queryFn: () => call<BillingMeta>('/api/meta'),
    staleTime: 1000 * 60 * 10,
    ...opts,
  })
}

/** `GET /api/workspaces` — this app's memberships. */
export function useWorkspaces(opts: QueryOpts = {}) {
  return useQuery({
    queryKey: keys.workspaces(),
    queryFn: () => list<WorkspaceSummary>('/api/workspaces'),
    ...opts,
  })
}

/** `GET /api/me/footprint` — what deleting your data in THIS app would remove. */
export function useFootprint(opts: QueryOpts = {}) {
  return useQuery({ queryKey: keys.footprint(), queryFn: () => call<Footprint>('/api/me/footprint'), ...opts })
}
