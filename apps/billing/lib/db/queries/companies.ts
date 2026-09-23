// The issuing companies: read, create, edit.
//
// Every write is ONE TRANSACTION that allocates a #number, writes, appends to
// the audit log, and returns a FRESH READ. The fresh read is not politeness — a
// caller that trusted an optimistically-constructed response would not see the
// values the database defaulted or a trigger adjusted.
//
// ===========================================================================
// WHAT THIS MODULE REFUSES, AND WHY EACH REFUSAL IS HERE RATHER THAN IN SQL
// ===========================================================================
// Three rules cannot be a CHECK constraint, because each needs a row a CHECK
// cannot see, and `docs/billing-app-plan/phase-1-companies-and-invoices.md`
// records them as write-door rules with a test rather than leaving the gap for
// somebody to notice:
//
//   1. `slug` is immutable after create. Not a legal fact — a name — but it
//      appears in URLs people have bookmarked and in every URN this app prints.
//   2. `next_seq` is never in a PATCH body. It is the gapless allocator; the
//      only statement that may touch it is in `seq.ts`. This is the ONE rule in
//      phase 1 with no database object behind it, because a column-level
//      `REVOKE UPDATE (next_seq)` would break the allocator itself.
//   3. `iban` and `qr_iban` are OWNER-ONLY. Changing an IBAN redirects real
//      money, so it is gated on `requireOwner` at the route rather than on
//      membership. Enforced there because only the route has the role.
//
// ===========================================================================
// WHAT IS REFUSED AT SAVE BECAUSE IT WOULD OTHERWISE FAIL ON EVERY INVOICE
// ===========================================================================
// Until 2026-09-23 (ticket #757) `createCompany` and `editCompany` stored
// whatever they were given. A mistyped IBAN, a country spelled `Schweiz`, an
// em dash in the legal name: each saved cleanly and then failed at PDF or send
// time — on every bill the company issued, with a refusal naming the company
// rather than the keystroke. `normaliseCompanyFields` below applies the SAME
// checks `lib/qr/validate.ts` applies at render time, to the fields that reach
// the payment part, at the moment somebody can still fix them: IBAN checksum
// (ISO 13616, CH and LI only), the QR-IID range on `qr_iban` and its absence on
// `iban`, an ISO 3166-1 alpha-2 country, one syntactically valid email, the
// Swiss QR character set and Table 8's widths on the legal name and address.
// A registered company must also carry its VAT number, because the document
// states VAT and the PDF prints the number it has.

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { billingCompany } from '../schema'
import { getDb } from '../client'
import { isUniqueViolation } from '../unique-violation'
import { allocateSeq } from './seq'
import { appendAudit, appendFieldChanges } from './audit'
import { checkNumberFormat } from '@/lib/derive/number'
import { ROUNDING_POLICIES } from '@/lib/vocabularies'
import { METADATA_LIMITS, externalRefProblem, validateMetadata } from '@/lib/limits'
import { charLength, findDisallowed } from '@/lib/qr/charset'
import { compactIban, isQrIban, isValidIban } from '@/lib/qr/reference'
import { ADDRESS_LIMITS } from '@/lib/qr/validate'
import type { ActorVia, Company, CreateCompanyBody, RoundingPolicy } from '@/types'

/** A refusal the route turns into a 400 or 409 with its suggestion. */
export class CompanyRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string,
    public status: 400 | 403 | 409 = 400
  ) {
    super(message)
  }
}

/** The columns every read projects. Never `SELECT *`. */
const COLS = {
  id: billingCompany.id,
  seq: billingCompany.seq,
  slug: billingCompany.slug,
  name: billingCompany.name,
  legal_name: billingCompany.legal_name,
  street: billingCompany.street,
  building: billingCompany.building,
  postal_code: billingCompany.postal_code,
  city: billingCompany.city,
  country: billingCompany.country,
  email: billingCompany.email,
  logo_initials: billingCompany.logo_initials,
  logo_color: billingCompany.logo_color,
  iban: billingCompany.iban,
  qr_iban: billingCompany.qr_iban,
  vat_registered: billingCompany.vat_registered,
  uid: billingCompany.uid,
  vat_number: billingCompany.vat_number,
  default_currency: billingCompany.default_currency,
  default_language: billingCompany.default_language,
  default_ref_type: billingCompany.default_ref_type,
  default_vat_rate: billingCompany.default_vat_rate,
  default_prices_include_vat: billingCompany.default_prices_include_vat,
  payment_terms_days: billingCompany.payment_terms_days,
  rounding: billingCompany.rounding,
  number_format: billingCompany.number_format,
  next_seq: billingCompany.next_seq,
  footer_fr: billingCompany.footer_fr,
  footer_en: billingCompany.footer_en,
  retired_at: billingCompany.retired_at,
  external_ref: billingCompany.external_ref,
  metadata: billingCompany.metadata,
} as const

/** Row → wire shape. The one place the two are related. */
function shape(r: Record<string, unknown>): Company {
  return {
    seq: Number(r.seq),
    slug: String(r.slug),
    name: String(r.name),
    legal_name: String(r.legal_name),
    address: {
      name: String(r.legal_name),
      street: (r.street as string) ?? null,
      building: (r.building as string) ?? null,
      postal_code: (r.postal_code as string) ?? null,
      city: (r.city as string) ?? null,
      country: (r.country as string) ?? null,
    },
    email: (r.email as string) ?? null,
    logo_initials: (r.logo_initials as string) ?? null,
    logo_color: (r.logo_color as string) ?? null,
    iban: (r.iban as string) ?? null,
    qr_iban: (r.qr_iban as string) ?? null,
    vat_registered: Boolean(r.vat_registered),
    uid: (r.uid as string) ?? null,
    vat_number: (r.vat_number as string) ?? null,
    defaults: {
      currency: String(r.default_currency),
      language: r.default_language as Company['defaults']['language'],
      ref_type: r.default_ref_type as Company['defaults']['ref_type'],
      // `numeric` arrives as a string from Drizzle, which is the point — see
      // types/index.ts. Passed through untouched rather than normalised.
      vat_rate: (r.default_vat_rate as string) ?? null,
      prices_include_vat: Boolean(r.default_prices_include_vat),
      payment_terms_days: Number(r.payment_terms_days),
    },
    rounding: r.rounding as RoundingPolicy,
    number_format: String(r.number_format),
    next_seq: Number(r.next_seq),
    footer_fr: (r.footer_fr as string) ?? null,
    footer_en: (r.footer_en as string) ?? null,
    retired_at: r.retired_at ? (r.retired_at as Date).toISOString() : null,
    external_ref: (r.external_ref as string) ?? null,
    metadata: (r.metadata as Record<string, string>) ?? {},
  }
}

export async function listCompanies(
  workspaceId: number,
  opts: { includeRetired?: boolean; externalRef?: string } = {}
): Promise<Company[]> {
  const where = [eq(billingCompany.workspace_id, workspaceId)]
  if (!opts.includeRetired) where.push(isNull(billingCompany.retired_at))
  if (opts.externalRef) where.push(eq(billingCompany.external_ref, opts.externalRef))
  const rows = await getDb()
    .select(COLS)
    .from(billingCompany)
    .where(and(...where))
    .orderBy(asc(billingCompany.seq))
  return rows.map(shape)
}

/**
 * One company by slug or `#seq`, scoped to the workspace.
 *
 * A retired company is still returned: past invoices reference it and have to
 * render. `retired_at` is what a surface reads to stop OFFERING it for new
 * invoices, which is a different question.
 */
export async function getCompany(workspaceId: number, slugOrSeq: string): Promise<Company | null> {
  const row = await getCompanyRow(workspaceId, slugOrSeq)
  return row ? shape(row) : null
}

/** The raw row, including `id`, for callers that need to write against it. */
export async function getCompanyRow(
  workspaceId: number,
  slugOrSeq: string
): Promise<Record<string, unknown> | null> {
  const numeric = /^\d+$/.test(slugOrSeq) ? Number(slugOrSeq) : null
  const rows = await getDb()
    .select(COLS)
    .from(billingCompany)
    .where(
      and(
        eq(billingCompany.workspace_id, workspaceId),
        numeric === null
          ? eq(billingCompany.slug, slugOrSeq)
          : eq(billingCompany.seq, numeric)
      )
    )
    .limit(1)
  return (rows[0] as Record<string, unknown>) ?? null
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

// ---------------------------------------------------------------------------
// The field checks — pure, exported, and called by BOTH write paths
// ---------------------------------------------------------------------------

/** The payment-part fields, and the Table 8 width each one is held to. */
const QR_TEXT_FIELDS: Readonly<Record<string, keyof typeof ADDRESS_LIMITS>> = {
  legal_name: 'name',
  street: 'street',
  building: 'building',
  postal_code: 'postalCode',
  city: 'town',
}

/** One address, no list, no display name — what a `reply-to` header can carry. */
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/**
 * Check every field of a company write that reaches the payment part or an
 * email header, and return the copy the write should store.
 *
 * Takes the FLAT spelling (`street`, not `address.street`) — the PATCH body's,
 * which `createCompany` flattens its nested `address` into. Only keys that are
 * present are checked, so an edit of the name never re-judges an address that
 * was seeded before these rules existed.
 *
 * ── WHAT IS NORMALISED, AND WHAT IS ONLY REFUSED ───────────────────────────
 * Three forms are canonicalised because the standard defines them as such: an
 * IBAN loses its spaces and is uppercased (`compactIban`, §4.2.2's electronic
 * form), a country code is uppercased (ISO 3166-1 is case-insensitive), and an
 * empty string becomes `null` (both front doors send an empty field to mean
 * "none"). Nothing else is rewritten — an em dash in a legal name is refused,
 * never turned into a hyphen, because the name must match the account holder
 * and a silently altered name is a name nobody approved (lib/qr/charset.ts).
 */
export function normaliseCompanyFields<T extends Record<string, unknown>>(fields: T): T {
  const out: Record<string, unknown> = { ...fields }

  for (const [field, limitKey] of Object.entries(QR_TEXT_FIELDS)) {
    const v = out[field]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') throw new CompanyRefused(`invalid_${field}`, `${field} is text`, 'send a string')
    if (v.trim() === '') {
      if (field === 'legal_name') {
        throw new CompanyRefused(
          'invalid_legal_name',
          'legal_name cannot be empty: it is the creditor name on the payment part',
          'omit it to keep the current one, or send the registered name'
        )
      }
      out[field] = null
      continue
    }
    const bad = findDisallowed(v)
    if (bad) {
      const shown = bad.codepoint === 'U+000A' || bad.codepoint === 'U+000D' ? 'a line break' : JSON.stringify(bad.character)
      throw new CompanyRefused(
        'character_not_allowed',
        `${field} contains ${shown} (${bad.codepoint}) at character ${bad.position}, which a Swiss QR Code cannot carry`,
        'replace it (an em dash becomes "-"); it is not substituted for you, because the legal name must match the account holder'
      )
    }
    const max = ADDRESS_LIMITS[limitKey]
    if (charLength(v) > max) {
      throw new CompanyRefused(
        'field_too_long',
        `${field} is ${charLength(v)} characters; the QR-bill payment part allows ${max}`,
        'shorten it; the limit is the payment part’s, and a longer value is not truncated for you'
      )
    }
  }

  if (out.country !== undefined && out.country !== null) {
    const raw = String(out.country).trim()
    if (raw === '') {
      out.country = null
    } else {
      const upper = raw.toUpperCase()
      if (!/^[A-Z]{2}$/.test(upper)) {
        throw new CompanyRefused(
          'invalid_country',
          `${JSON.stringify(raw)} is not an ISO 3166-1 alpha-2 country code`,
          'two letters, e.g. CH — the payment part carries the code, not the name'
        )
      }
      out.country = upper
    }
  }

  if (out.email !== undefined && out.email !== null) {
    const raw = String(out.email).trim()
    if (raw === '') {
      out.email = null
    } else {
      if (!EMAIL_RE.test(raw)) {
        throw new CompanyRefused(
          'invalid_email',
          `${JSON.stringify(raw)} is not one email address`,
          'one address, e.g. billing@example.ch — it becomes the reply-to of every invoice this company sends'
        )
      }
      out.email = raw
    }
  }

  for (const field of ['iban', 'qr_iban'] as const) {
    const v = out[field]
    if (v === undefined || v === null) continue
    const compact = compactIban(String(v))
    if (compact === '') {
      out[field] = null
      continue
    }
    if (!/^(CH|LI)/.test(compact)) {
      throw new CompanyRefused(
        'iban_country_not_allowed',
        `${field} ${JSON.stringify(compact)} is not a Swiss or Liechtenstein account; a QR-bill pays into CH or LI only`,
        'use the company’s CH or LI account'
      )
    }
    if (!isValidIban(compact)) {
      throw new CompanyRefused(
        'invalid_iban',
        `${field} ${JSON.stringify(compact)} is not a valid IBAN: 21 characters and correct check digits (ISO 13616)`,
        'copy it again from the bank statement; one wrong digit fails the check, which is what the check is for'
      )
    }
    const qr = isQrIban(compact)
    if (field === 'qr_iban' && !qr) {
      throw new CompanyRefused(
        'qr_iban_not_qr_iban',
        `qr_iban ${JSON.stringify(compact)} is an ordinary IBAN; a QR-IBAN has institution id 30000–31999 at positions 5–9`,
        'put an ordinary IBAN in iban; the bank issues the QR-IBAN separately, for QR references'
      )
    }
    if (field === 'iban' && qr) {
      throw new CompanyRefused(
        'iban_is_qr_iban',
        `iban ${JSON.stringify(compact)} is a QR-IBAN (institution id 30000–31999), which only accepts QR references`,
        'put it in qr_iban; iban is the ordinary account SCOR and NON bills pay into'
      )
    }
    out[field] = compact
  }

  if (out.external_ref !== undefined && out.external_ref !== null) {
    if (out.external_ref === '') {
      out.external_ref = null
    } else {
      const p = externalRefProblem(out.external_ref)
      if (p) throw new CompanyRefused('invalid_external_ref', p, 'your own identifier for this company, such as a branch id')
    }
  }

  return out as T
}

/**
 * A registered company states VAT on every bill, and the PDF prints the number
 * it has — so a company registered without a number issues documents that
 * silently omit it (`lib/pdf/invoice.ts`). Checked on the MERGED state at edit,
 * so clearing the number on a registered company is refused too.
 */
export function assertVatNumberIfRegistered(vatRegistered: boolean, vatNumber: string | null | undefined): void {
  if (vatRegistered && !(typeof vatNumber === 'string' && vatNumber.trim() !== '')) {
    throw new CompanyRefused(
      'vat_number_required',
      'a company registered for VAT must carry its VAT number; every bill it issues states it',
      'set vat_number (e.g. "CHE-123.456.789 TVA"), or leave vat_registered false'
    )
  }
}

/** The existing holder of an `external_ref`, for a 409 that names it. */
async function externalRefHolder(workspaceId: number, externalRef: string): Promise<CompanyRefused> {
  const [holder] = await listCompanies(workspaceId, { includeRetired: true, externalRef })
  return new CompanyRefused(
    'external_ref_taken',
    holder
      ? `company #${holder.seq} (${holder.slug}) already carries external_ref ${JSON.stringify(externalRef)}`
      : `another company in this workspace already carries external_ref ${JSON.stringify(externalRef)}`,
    holder
      ? `bk billing company show ${holder.slug} — if that is the record you meant, use it rather than creating another`
      : 'bk billing company list --external-ref <ref>',
    409
  )
}

export interface WriteCtx {
  workspaceId: number
  actorUserId: number
  via: ActorVia
  /** True when the caller is the workspace owner. Gates the bank fields. */
  isOwner: boolean
}

export async function createCompany(ctx: WriteCtx, body: CreateCompanyBody): Promise<Company> {
  const slug = (body.slug ?? '').trim().toLowerCase()
  if (!SLUG_RE.test(slug)) {
    throw new CompanyRefused(
      'invalid_slug',
      'a slug is lower-case letters, digits and hyphens, starting with a letter or digit, max 40',
      'bk billing company create --slug acme-sa --name "Acme SA"'
    )
  }
  const name = (body.name ?? '').trim()
  if (!name) {
    throw new CompanyRefused('invalid_name', 'name is required', 'add --name')
  }
  // `legal_name` defaults to `name`, because most companies have one name and
  // asking for it twice is how the payment part ends up with a blank.
  const legal = (body.legal_name ?? name).trim()

  if ((body.iban || body.qr_iban) && !ctx.isOwner) {
    throw new CompanyRefused(
      'owner_only_bank_fields',
      'only the workspace owner may set an IBAN',
      'ask the owner, or create the company without bank details and have them add them',
      403
    )
  }

  const rounding = body.rounding ?? 'line_0_05'
  assertRounding(rounding)
  const numberFormat = body.number_format ?? 'BC-{YYYY}-{SEQ4}'
  const formatProblem = checkNumberFormat(numberFormat)
  if (formatProblem) {
    throw new CompanyRefused('invalid_number_format', formatProblem, 'e.g. --number-format "BC-{YYYY}-{SEQ4}"')
  }
  const metaProblem = validateMetadata(body.metadata)
  if (metaProblem) {
    throw new CompanyRefused('invalid_metadata', metaProblem, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
  }

  // The POST takes a nested `address`; the checks take the PATCH's flat
  // spelling, so the two doors run one function rather than two.
  const addr = body.address ?? {}
  const fields = normaliseCompanyFields({
    legal_name: legal,
    street: addr.street ?? null,
    building: addr.building ?? null,
    postal_code: addr.postal_code ?? null,
    city: addr.city ?? null,
    country: addr.country ?? null,
    email: body.email ?? null,
    iban: body.iban ?? null,
    qr_iban: body.qr_iban ?? null,
    external_ref: body.external_ref ?? null,
  })
  const vatRegistered = body.vat_registered ?? false
  assertVatNumberIfRegistered(vatRegistered, body.vat_number)

  return await getDb().transaction(async (tx) => {
    const seq = await allocateSeq(tx, ctx.workspaceId, 'company')
    const [inserted] = await tx
      .insert(billingCompany)
      .values({
        workspace_id: ctx.workspaceId,
        seq,
        slug,
        name,
        legal_name: fields.legal_name,
        street: fields.street,
        building: fields.building,
        postal_code: fields.postal_code,
        city: fields.city,
        country: fields.country,
        email: fields.email,
        iban: fields.iban,
        qr_iban: fields.qr_iban,
        vat_registered: vatRegistered,
        uid: body.uid ?? null,
        vat_number: body.vat_number ?? null,
        default_currency: body.defaults?.currency ?? 'CHF',
        default_language: body.defaults?.language ?? 'fr',
        default_ref_type: body.defaults?.ref_type ?? 'NON',
        default_vat_rate: body.defaults?.vat_rate ?? null,
        default_prices_include_vat: body.defaults?.prices_include_vat ?? false,
        payment_terms_days: body.defaults?.payment_terms_days ?? 30,
        rounding,
        number_format: numberFormat,
        footer_fr: body.footer_fr ?? null,
        footer_en: body.footer_en ?? null,
        external_ref: fields.external_ref,
        metadata: body.metadata ?? {},
        created_by: ctx.actorUserId,
      })
      .returning({ id: billingCompany.id })

    await appendAudit(tx, {
      workspaceId: ctx.workspaceId,
      subjectType: 'company',
      subjectId: inserted.id,
      subjectSeq: seq,
      actorUserId: ctx.actorUserId,
      via: ctx.via,
      action: 'created',
      detailEn: `Company ${name} created`,
      detailFr: `Entreprise ${name} créée`,
    })

    return slug
  })
    // A duplicate `external_ref` surfaces as the partial unique index, after
    // the rollback. Mapped here — not left to `apiHandler`'s generic 409
    // `already_exists` — so the refusal names the company that HOLDS the
    // reference, which is how an integration adopts a record it created and
    // never heard back about.
    .catch(async (e: unknown) => {
      if (fields.external_ref && isUniqueViolation(e, 'uq_company_ws_external_ref')) {
        throw await externalRefHolder(ctx.workspaceId, fields.external_ref)
      }
      throw e
    })
    // AFTER the commit. The read inside the transaction used `getDb()`, a
    // different connection, where the uncommitted row is invisible — see the
    // note at the top of lib/db/queries/invoices.ts, which is where this was
    // found by a real HTTP call rather than by any test.
    .then(async (createdSlug) => {
      const fresh = await getCompany(ctx.workspaceId, createdSlug)
      if (!fresh) throw new Error(`company ${createdSlug} not readable after commit`)
      return fresh
    })
}

/** Fields a PATCH may touch, and the audit path each one logs under. */
const EDITABLE: Record<string, string> = {
  name: 'name',
  legal_name: 'legal_name',
  street: 'address.street',
  building: 'address.building',
  postal_code: 'address.postal_code',
  city: 'address.city',
  country: 'address.country',
  email: 'email',
  logo_initials: 'logo_initials',
  logo_color: 'logo_color',
  vat_registered: 'vat_registered',
  uid: 'uid',
  vat_number: 'vat_number',
  default_currency: 'defaults.currency',
  default_language: 'defaults.language',
  default_ref_type: 'defaults.ref_type',
  default_vat_rate: 'defaults.vat_rate',
  default_prices_include_vat: 'defaults.prices_include_vat',
  payment_terms_days: 'defaults.payment_terms_days',
  rounding: 'rounding',
  number_format: 'number_format',
  footer_fr: 'footer_fr',
  footer_en: 'footer_en',
  external_ref: 'external_ref',
  metadata: 'metadata',
  // Retiring is an ordinary field change and is audited like one. It is NOT a
  // delete: 0006 revokes DELETE and 0005 has a trigger, because past invoices
  // reference this row and a statement for a past year has to render.
  retired_at: 'retired_at',
}

/** Owner-only, because changing one redirects real money. */
const OWNER_ONLY = new Set(['iban', 'qr_iban'])

/** Refused outright: see the module header for why each is here and not in SQL. */
const NEVER_EDITABLE: Record<string, string> = {
  slug: 'a slug appears in URLs and in every URN this app prints; create a new company instead',
  next_seq:
    'the gapless allocator is only ever moved by lib/db/queries/seq.ts, inside an invoice insert',
  seq: 'the #number is this company’s address',
}

export async function editCompany(
  ctx: WriteCtx,
  slugOrSeq: string,
  patch: Record<string, unknown>
): Promise<Company> {
  const row = await getCompanyRow(ctx.workspaceId, slugOrSeq)
  if (!row) {
    throw new CompanyRefused(
      'not_found',
      `no company ${slugOrSeq} in this workspace`,
      'bk billing company list',
      409
    )
  }

  for (const key of Object.keys(patch)) {
    if (NEVER_EDITABLE[key]) {
      throw new CompanyRefused('field_not_editable', `${key} cannot be changed: ${NEVER_EDITABLE[key]}`, 'omit it')
    }
    if (OWNER_ONLY.has(key) && !ctx.isOwner) {
      throw new CompanyRefused(
        'owner_only_bank_fields',
        `only the workspace owner may change ${key}`,
        'changing an IBAN redirects real money, so it is the owner’s call',
        403
      )
    }
    if (!EDITABLE[key] && !OWNER_ONLY.has(key)) {
      throw new CompanyRefused('unknown_field', `${key} is not a field of a company`, 'bk billing company show')
    }
  }

  if (patch.rounding !== undefined) assertRounding(patch.rounding as string)
  if (patch.number_format !== undefined) {
    const p = checkNumberFormat(String(patch.number_format))
    if (p) throw new CompanyRefused('invalid_number_format', p, 'e.g. "BC-{YYYY}-{SEQ4}"')
  }
  if (patch.metadata !== undefined) {
    const p = validateMetadata(patch.metadata as Record<string, string>)
    if (p) throw new CompanyRefused('invalid_metadata', p, `at most ${METADATA_LIMITS.max_keys} flat string keys`)
  }

  // The checked, canonical copy is what gets diffed AND stored, so the audit
  // row records the IBAN as it was saved (no spaces), not as it was typed.
  patch = normaliseCompanyFields(patch)
  assertVatNumberIfRegistered(
    patch.vat_registered !== undefined ? Boolean(patch.vat_registered) : Boolean(row.vat_registered),
    patch.vat_number !== undefined ? (patch.vat_number as string | null) : (row.vat_number as string | null)
  )

  return await getDb().transaction(async (tx) => {
    const changes: Array<{ field: string; from: unknown; to: unknown }> = []
    for (const [key, to] of Object.entries(patch)) {
      const from = row[key]
      // `!=` on purpose for the null/undefined pair, then a strict compare on
      // the stringified forms so `30` and `"30"` from a JSON body do not log a
      // change that did not happen.
      if (String(from ?? '') !== String(to ?? '')) {
        changes.push({ field: EDITABLE[key] ?? key, from, to })
      }
    }

    if (changes.length > 0) {
      await tx
        .update(billingCompany)
        .set({ ...patch, updated_at: new Date() })
        .where(eq(billingCompany.id, Number(row.id)))

      await appendFieldChanges(
        tx,
        {
          workspaceId: ctx.workspaceId,
          subjectType: 'company',
          subjectId: Number(row.id),
          subjectSeq: Number(row.seq),
          actorUserId: ctx.actorUserId,
          via: ctx.via,
        },
        changes
      )
    }

    return String(row.slug)
  })
    .catch(async (e: unknown) => {
      if (typeof patch.external_ref === 'string' && isUniqueViolation(e, 'uq_company_ws_external_ref')) {
        throw await externalRefHolder(ctx.workspaceId, patch.external_ref)
      }
      throw e
    })
    .then(async (slug) => {
      const fresh = await getCompany(ctx.workspaceId, slug)
      if (!fresh) throw new Error(`company ${slug} not readable after commit`)
      return fresh
    })
}

/**
 * Retire a company: it issues no new invoices and still renders its old ones.
 *
 * **Not a delete.** 0006 revokes DELETE and 0005 has a trigger, because past
 * invoices reference this row and a statement for a past year has to render.
 */
export async function retireCompany(ctx: WriteCtx, slugOrSeq: string): Promise<Company> {
  const row = await getCompanyRow(ctx.workspaceId, slugOrSeq)
  if (!row) {
    throw new CompanyRefused(
      'not_found',
      `no company ${slugOrSeq} in this workspace`,
      'bk billing company list',
      409
    )
  }
  if (row.retired_at) {
    throw new CompanyRefused(
      'already_retired',
      `company ${row.slug} was retired on ${(row.retired_at as Date).toISOString().slice(0, 10)}`,
      'it still renders its old invoices; nothing further is needed',
      409
    )
  }
  return editCompany(ctx, slugOrSeq, { retired_at: new Date() })
}

function assertRounding(v: string): void {
  if (!ROUNDING_POLICIES.some((p) => p.value === v)) {
    throw new CompanyRefused(
      'invalid_rounding',
      `${v} is not a rounding policy`,
      `one of ${ROUNDING_POLICIES.map((p) => p.value).join(', ')} — run \`bk meta --app-server billing\``
    )
  }
}
