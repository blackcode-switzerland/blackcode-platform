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

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { billingCompany } from '../schema'
import { getDb } from '../client'
import { allocateSeq } from './seq'
import { appendAudit, appendFieldChanges } from './audit'
import { checkNumberFormat } from '@/lib/derive/number'
import { ROUNDING_POLICIES } from '@/lib/vocabularies'
import { METADATA_LIMITS, validateMetadata } from '@/lib/limits'
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

  return await getDb().transaction(async (tx) => {
    const seq = await allocateSeq(tx, ctx.workspaceId, 'company')
    const addr = body.address ?? {}
    const [inserted] = await tx
      .insert(billingCompany)
      .values({
        workspace_id: ctx.workspaceId,
        seq,
        slug,
        name,
        legal_name: legal,
        street: addr.street ?? null,
        building: addr.building ?? null,
        postal_code: addr.postal_code ?? null,
        city: addr.city ?? null,
        country: addr.country ?? null,
        email: body.email ?? null,
        iban: body.iban ?? null,
        qr_iban: body.qr_iban ?? null,
        vat_registered: body.vat_registered ?? false,
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
        external_ref: body.external_ref ?? null,
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
