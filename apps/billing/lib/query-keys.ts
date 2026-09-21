// Every TanStack Query key this app uses, in one place.
//
// Keys are hierarchical so invalidation can be broad on purpose:
// `['billing', ws, 'invoices']` matches every filtered variant of the invoice
// list, `['billing', ws, 'invoice']` every invoice detail — addressed by #number
// OR by printed number, which are two keys for one record, so a write
// invalidates the whole `invoice` branch rather than guessing which one a page
// used. Account-level keys (`me`, `tokens`, …) sit outside any workspace.

export interface InvoiceFilters {
  company?: string | null
  status?: string | null
  currency?: string | null
  external_ref?: string | null
  limit?: number
  cursor?: string | number | null
}

export interface RecurrenceFilters {
  company?: string | null
  status?: string | null
  due?: boolean
  limit?: number
  cursor?: string | number | null
}

export interface HistoryFilters {
  company?: string | null
  source?: string | null
  currency?: string | null
  year?: string | number | null
  flagged?: boolean
  limit?: number
  cursor?: string | number | null
}

export interface CompanyFilters {
  include_retired?: boolean
  external_ref?: string | null
}

/** `invoice:<ref>` or `recurrence:<#number>`; omitted = the workspace's whole log. */
export interface AuditFilters {
  subject?: string | null
  limit?: number
  since?: number | null
}

const root = (ws: string) => ['billing', ws] as const

export const keys = {
  /** Everything in one workspace — the nuclear invalidation. */
  workspace: (ws: string) => root(ws),

  overview: (ws: string, company?: string | null) => [...root(ws), 'overview', company ?? null] as const,
  overviewAll: (ws: string) => [...root(ws), 'overview'] as const,

  companies: (ws: string, f: CompanyFilters = {}) => [...root(ws), 'companies', f] as const,
  companiesAll: (ws: string) => [...root(ws), 'companies'] as const,
  company: (ws: string, slug: string) => [...root(ws), 'company', slug] as const,
  companyAll: (ws: string) => [...root(ws), 'company'] as const,

  invoices: (ws: string, f: InvoiceFilters = {}) => [...root(ws), 'invoices', f] as const,
  invoicesAll: (ws: string) => [...root(ws), 'invoices'] as const,
  invoice: (ws: string, ref: string | number) => [...root(ws), 'invoice', String(ref)] as const,
  invoiceQr: (ws: string, ref: string | number) => [...root(ws), 'invoice', String(ref), 'qr'] as const,
  invoiceAll: (ws: string) => [...root(ws), 'invoice'] as const,

  audit: (ws: string, f: AuditFilters = {}) => [...root(ws), 'audit', f] as const,
  auditAll: (ws: string) => [...root(ws), 'audit'] as const,

  recurrences: (ws: string, f: RecurrenceFilters = {}) => [...root(ws), 'recurrences', f] as const,
  recurrencesAll: (ws: string) => [...root(ws), 'recurrences'] as const,
  recurrence: (ws: string, seq: string | number) => [...root(ws), 'recurrence', String(seq)] as const,
  recurrenceAll: (ws: string) => [...root(ws), 'recurrence'] as const,

  history: (ws: string, f: HistoryFilters = {}) => [...root(ws), 'history', f] as const,
  historyAll: (ws: string) => [...root(ws), 'history'] as const,
  historyEntry: (ws: string, seq: string | number) => [...root(ws), 'history-entry', String(seq)] as const,

  workspaceShow: (ws: string) => [...root(ws), 'show'] as const,
  members: (ws: string) => [...root(ws), 'members'] as const,
  invitations: (ws: string) => [...root(ws), 'invitations'] as const,

  // Account-level — the same answer in every workspace.
  me: () => ['me'] as const,
  tokens: () => ['tokens'] as const,
  meta: () => ['meta'] as const,
  workspaces: () => ['workspaces'] as const,
  footprint: () => ['footprint'] as const,
}
