// Changing a book's own facts after it exists.
//
// ===========================================================================
// THE FLAG THAT SILENTLY SWITCHED OFF THE ENTIRE VAT POSITION
// ===========================================================================
// `entity.vat_registered` defaults to FALSE, `createEntity` never set it, and
// nothing could update it. And `getTaxSnapshot` reads it as the gate:
//
//     if (entity.vat_registered) { …compute the VAT position… }
//
// So every book created through the app reported no VAT position at all, for
// ever, no matter what its entries carried. That stayed invisible while only
// the seeded books were looked at, because the seed writes the flag directly.
//
// It also means a company that CROSSES the art. 10 LTVA threshold — turnover
// over CHF 100'000, registration follows — had no way to say so. Registration
// is an event in a company's life, not a property of the day it was founded.
//
// ── WHAT MAY CHANGE, AND WHAT MAY NOT ───────────────────────────────────────
// The standing line in this app is that RECORDS are permanent and
// CONFIGURATION is editable. A book's identity is neither, quite, so it is
// split:
//
//   EDITABLE   name, seat, the VAT trio, audit status, FTE count, accent,
//              the art. 957 al. 2 regime election and its note.
//              These are facts about the company that genuinely change.
//
//   PERMANENT  slug            — every URL, every CLI call and every stored
//                                reference names the book by it
//              legal_form      — a Sàrl becoming an SA is a re-registration at
//                                the commercial register, with a new set of
//                                books, not an UPDATE
//              bookkeeping_regime — art. 957 decides it from the legal form,
//                                0004 has a CHECK, and switching it mid-life
//                                would leave a journal half in one shape
//
// Each of the three is refused in words, because "why can I not change this"
// deserves an answer and not a silently ignored field.

import { and, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { booksEntity, type BooksEntity, type StoredSpeech } from '../schema'

export class EntityEditRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

/** art. 37 LTVA: the effective method, or the net-tax-rate method (TDFN). */
const VAT_METHODS = ['effective', 'net_debt_rate'] as const
/** art. 35 LTVA reporting period. */
const VAT_FILINGS = ['monthly', 'quarterly', 'semiannual', 'annual'] as const
/** art. 727/727a CO. */
const AUDIT = ['ordinary', 'limited', 'opted_out'] as const

export interface EntityEditData {
  name?: string
  seat?: string | null
  vat_registered?: boolean
  vat_method?: string | null
  vat_filing?: string | null
  vat_note?: StoredSpeech | null
  audit_status?: string | null
  regime_election?: string | null
  fte_count?: string | null
  accent?: string | null
}

function oneOf(field: string, value: string, allowed: readonly string[], law: string): void {
  if (!allowed.includes(value)) {
    throw new EntityEditRefused(
      `bad_${field}`,
      `"${value}" is not a ${field.replace(/_/g, ' ')}`,
      `one of ${allowed.join(', ')} (${law})`
    )
  }
}

export async function updateEntity(
  workspaceId: number,
  slug: string,
  data: EntityEditData
): Promise<BooksEntity> {
  const db = getDb()
  const [entity] = await db
    .select()
    .from(booksEntity)
    .where(and(eq(booksEntity.workspace_id, workspaceId), eq(booksEntity.slug, slug)))
  if (!entity) {
    throw new EntityEditRefused('entity_not_found', `no book with slug "${slug}"`, 'bk books entity list')
  }

  const patch: Record<string, unknown> = {}

  if (data.name !== undefined) {
    const name = data.name.trim()
    if (!name) throw new EntityEditRefused('missing_name', 'a book needs a name', 'pass --name "ACME SA"')
    patch.name = name
  }
  if (data.seat !== undefined) patch.seat = data.seat?.trim() || null
  if (data.accent !== undefined) patch.accent = data.accent?.trim() || null
  if (data.vat_note !== undefined) patch.vat_note = data.vat_note
  if (data.regime_election !== undefined) patch.regime_election = data.regime_election?.trim() || null

  if (data.fte_count !== undefined) {
    if (data.fte_count === null || data.fte_count === '') patch.fte_count = null
    else {
      if (!/^\d+(\.\d{1,2})?$/.test(data.fte_count)) {
        throw new EntityEditRefused('bad_fte_count', `"${data.fte_count}" is not a headcount`, 'e.g. 2.50')
      }
      patch.fte_count = data.fte_count
    }
  }

  if (data.audit_status !== undefined) {
    if (data.audit_status === null || data.audit_status === '') patch.audit_status = null
    else {
      oneOf('audit_status', data.audit_status, AUDIT, 'art. 727 / 727a CO')
      patch.audit_status = data.audit_status
    }
  }

  // ---- the VAT trio, which travel together --------------------------------
  if (data.vat_method !== undefined) {
    if (data.vat_method === null || data.vat_method === '') patch.vat_method = null
    else {
      oneOf('vat_method', data.vat_method, VAT_METHODS, 'art. 37 LTVA')
      patch.vat_method = data.vat_method
    }
  }
  if (data.vat_filing !== undefined) {
    if (data.vat_filing === null || data.vat_filing === '') patch.vat_filing = null
    else {
      oneOf('vat_filing', data.vat_filing, VAT_FILINGS, 'art. 35 LTVA')
      patch.vat_filing = data.vat_filing
    }
  }
  if (data.vat_registered !== undefined) patch.vat_registered = data.vat_registered

  // Registering without saying how or how often leaves the tax snapshot
  // computing a position nobody can file. The method and the period are chosen
  // at registration, so this is the moment they are known.
  const willBeRegistered =
    data.vat_registered === undefined ? entity.vat_registered : data.vat_registered
  if (willBeRegistered) {
    const method = (patch.vat_method as string | null | undefined) ?? entity.vat_method
    const filing = (patch.vat_filing as string | null | undefined) ?? entity.vat_filing
    if (!method || !filing) {
      throw new EntityEditRefused(
        'vat_needs_method_and_filing',
        'a VAT-registered company reports by a chosen method and on a chosen period',
        'pass --vat-method effective --vat-filing quarterly (art. 37 and art. 35 LTVA)'
      )
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new EntityEditRefused(
      'nothing_to_change',
      'no editable field was given',
      'bk books entity edit --help lists them; slug, legal form and regime are permanent'
    )
  }

  patch.updated_at = new Date()
  const [row] = await db
    .update(booksEntity)
    .set(patch)
    .where(eq(booksEntity.id, entity.id))
    .returning()
  return row
}

/**
 * The three fields that are not editable, refused by name.
 *
 * Called from the route so the refusal happens before anything else is
 * validated: somebody asking to change a legal form wants to hear about the
 * legal form, not about a VAT filing period they also passed.
 */
export function refusePermanentFields(body: Record<string, unknown>): void {
  if (typeof body.slug === 'string') {
    throw new EntityEditRefused(
      'slug_is_permanent',
      'a book\'s slug is how every URL, command and stored reference names it',
      'the display name is editable: pass --name instead'
    )
  }
  if (typeof body.legal_form === 'string') {
    throw new EntityEditRefused(
      'legal_form_is_permanent',
      'changing legal form is a re-registration at the commercial register, not an edit',
      'the new company keeps new books: bk books entity create'
    )
  }
  if (typeof body.bookkeeping_regime === 'string') {
    throw new EntityEditRefused(
      'regime_is_permanent',
      'art. 957 CO decides the regime from the legal form, and 0004 holds it as a CHECK',
      'the art. 957 al. 2 election is recordable on its own: pass --regime-election'
    )
  }
}
