// The catalog: products, templates and documents — WHAT we sell, HOW we say it,
// and the ONE library both draw on (D-8).
//
// All three are projected entities with a #number and a URN, and all three are
// workspace-scoped rather than prospect-scoped: that is the whole point of a
// catalog. The many-to-many tables are what make a per-prospect "documents" view
// a FILTERED VIEW into one library rather than a silo with copies in it.

import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../client'
import {
  documentProducts,
  documentProspects,
  documents,
  products,
  prospects,
  templateDocuments,
  templates,
} from '../schema'
import type { Product, SalesDocument, Template } from '../schema'
import { allocateSeq } from './counters'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

const clampLimit = (n: number | undefined) =>
  Math.min(Math.max(n ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX)

// ---------------------------------------------------------------------------
// products
// ---------------------------------------------------------------------------

export async function listProducts(opts: {
  workspaceId: number
  category?: string
  q?: string
  includeDeleted?: boolean
  limit?: number
}): Promise<Product[]> {
  const db = getDb()
  const where: SQL[] = [eq(products.workspace_id, opts.workspaceId)]
  if (!opts.includeDeleted) where.push(isNull(products.deleted_at))
  if (opts.category) where.push(eq(products.category, opts.category))
  if (opts.q?.trim()) where.push(ilike(products.name, `%${opts.q.trim()}%`))
  return await db
    .select()
    .from(products)
    .where(and(...where))
    .orderBy(asc(products.category), asc(products.name))
    .limit(clampLimit(opts.limit))
}

export async function getProductBySeq(workspaceId: number, seq: number): Promise<Product | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.workspace_id, workspaceId), eq(products.seq, seq)))
    .limit(1)
  return row ?? null
}

export interface ProductInput {
  category?: string
  name?: string
  priceLabel?: string | null
  priceFrom?: string | null
  priceTo?: string | null
  currency?: string
  description?: string | null
  fit?: string[] | null
  pitch?: string | null
  statusLabel?: string | null
  refs?: string[] | null
}

export async function createProduct(
  workspaceId: number,
  input: ProductInput & { category: string; name: string },
  actor: Actor
): Promise<Product> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, workspaceId, 'product')
    const [row] = await tx
      .insert(products)
      .values({
        workspace_id: workspaceId,
        seq,
        category: input.category,
        name: input.name,
        price_label: input.priceLabel ?? null,
        price_from: input.priceFrom ?? null,
        price_to: input.priceTo ?? null,
        currency: input.currency ?? 'CHF',
        description: input.description ?? null,
        fit: input.fit ?? null,
        pitch: input.pitch ?? null,
        status_label: input.statusLabel ?? null,
        refs: input.refs ?? null,
      })
      .returning()
    if (!row) throw new Error('product insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'product',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name, category: row.category },
    })
    return row
  })
}

export async function updateProduct(
  workspaceId: number,
  seq: number,
  input: ProductInput,
  actor: Actor
): Promise<Product | null> {
  const db = getDb()
  const existing = await getProductBySeq(workspaceId, seq)
  if (!existing) return null
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.category !== undefined) values.category = input.category
    if (input.name !== undefined) values.name = input.name
    if (input.priceLabel !== undefined) values.price_label = input.priceLabel
    if (input.priceFrom !== undefined) values.price_from = input.priceFrom
    if (input.priceTo !== undefined) values.price_to = input.priceTo
    if (input.currency !== undefined) values.currency = input.currency
    if (input.description !== undefined) values.description = input.description
    if (input.fit !== undefined) values.fit = input.fit
    if (input.pitch !== undefined) values.pitch = input.pitch
    if (input.statusLabel !== undefined) values.status_label = input.statusLabel
    if (input.refs !== undefined) values.refs = input.refs

    const [row] = await tx
      .update(products)
      .set(values)
      .where(and(eq(products.workspace_id, workspaceId), eq(products.seq, seq)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'product',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name },
    })
    return row
  })
}

export async function softDeleteProduct(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<Product | null> {
  return await softDeleteCatalogRow('product', workspaceId, seq, actor)
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

/**
 * The `{{placeholder}}` names in a body.
 *
 * ONE parser, called on every write, and `templates.variables` is what it wrote.
 * `bk sales template render` validates against the stored column rather than
 * re-parsing, so there is exactly one implementation and the stored value can
 * never disagree with a second one. If it ever disagrees with `body`, the write
 * path is the bug — which is a thing you can go and look at.
 */
export function parseVariables(body: string | null | undefined): string[] {
  if (!body) return []
  return [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))]
}

export async function listTemplates(opts: {
  workspaceId: number
  channel?: string
  category?: string
  stage?: string
  q?: string
  includeDeleted?: boolean
  limit?: number
}): Promise<Template[]> {
  const db = getDb()
  const where: SQL[] = [eq(templates.workspace_id, opts.workspaceId)]
  if (!opts.includeDeleted) where.push(isNull(templates.deleted_at))
  if (opts.channel) where.push(eq(templates.channel, opts.channel))
  if (opts.category) where.push(eq(templates.category, opts.category))
  if (opts.stage) where.push(eq(templates.stage, opts.stage))
  if (opts.q?.trim()) where.push(ilike(templates.name, `%${opts.q.trim()}%`))
  return await db
    .select()
    .from(templates)
    .where(and(...where))
    .orderBy(asc(templates.category), asc(templates.name))
    .limit(clampLimit(opts.limit))
}

export async function getTemplateBySeq(
  workspaceId: number,
  seq: number
): Promise<Template | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.workspace_id, workspaceId), eq(templates.seq, seq)))
    .limit(1)
  return row ?? null
}

export interface TemplateInput {
  channel?: string
  category?: string
  stage?: string | null
  name?: string
  subject?: string | null
  body?: string | null
}

export async function createTemplate(
  workspaceId: number,
  input: TemplateInput & { channel: string; category: string; name: string },
  actor: Actor
): Promise<Template> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, workspaceId, 'template')
    const [row] = await tx
      .insert(templates)
      .values({
        workspace_id: workspaceId,
        seq,
        channel: input.channel,
        category: input.category,
        stage: input.stage ?? null,
        name: input.name,
        subject: input.subject ?? null,
        body: input.body ?? null,
        variables: parseVariables(input.body),
        created_by: actor.userId,
      })
      .returning()
    if (!row) throw new Error('template insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'template',
      entityId: row.id,
      action: 'created',
      meta: { name: row.name, channel: row.channel },
    })
    return row
  })
}

export async function updateTemplate(
  workspaceId: number,
  seq: number,
  input: TemplateInput,
  actor: Actor
): Promise<Template | null> {
  const db = getDb()
  const existing = await getTemplateBySeq(workspaceId, seq)
  if (!existing) return null
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.channel !== undefined) values.channel = input.channel
    if (input.category !== undefined) values.category = input.category
    if (input.stage !== undefined) values.stage = input.stage
    if (input.name !== undefined) values.name = input.name
    if (input.subject !== undefined) values.subject = input.subject
    if (input.body !== undefined) {
      values.body = input.body
      // Re-parsed on every body change, never edited by hand. A `variables`
      // column that could be set independently would let `render` validate
      // against a list the body does not contain.
      values.variables = parseVariables(input.body)
    }

    const [row] = await tx
      .update(templates)
      .set(values)
      .where(and(eq(templates.workspace_id, workspaceId), eq(templates.seq, seq)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'template',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name },
    })
    return row
  })
}

export async function softDeleteTemplate(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<Template | null> {
  return await softDeleteCatalogRow('template', workspaceId, seq, actor)
}

export interface RenderResult {
  subject: string | null
  body: string
  /** Declared but not supplied. Empty means the render is complete. */
  missing: string[]
  /** Supplied but not declared — a typo in a `--var` key, usually. */
  unused: string[]
}

/**
 * Substitute `{{name}}` from `vars`.
 *
 * **Missing variables are REPORTED, not silently left in place.** A rendered
 * message containing a literal `{{first_name}}` is one an agent will happily
 * paste into an email, and the failure is visible only to the recipient. The
 * route turns a non-empty `missing` into a 400 naming each one AND the full
 * declared set — the one error worth hand-writing, per §6.3.
 */
export function renderTemplate(
  tpl: Pick<Template, 'subject' | 'body' | 'variables'>,
  vars: Record<string, string>
): RenderResult {
  const declared = tpl.variables ?? []
  const supplied = Object.keys(vars)
  const substitute = (s: string | null) =>
    s == null ? null : s.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => vars[key] ?? whole)
  return {
    subject: substitute(tpl.subject),
    body: substitute(tpl.body) ?? '',
    missing: declared.filter((d) => !(d in vars)),
    unused: supplied.filter((s) => !declared.includes(s)),
  }
}

// ---------------------------------------------------------------------------
// documents — the one library (D-8)
// ---------------------------------------------------------------------------

export type DocumentRow = SalesDocument & {
  /** Prospect and product #numbers this document is linked to. */
  prospect_numbers: number[]
  product_numbers: number[]
}

export async function listDocuments(opts: {
  workspaceId: number
  kind?: string
  /** Only documents linked to this prospect #number. */
  prospectSeq?: number
  q?: string
  includeDeleted?: boolean
  limit?: number
}): Promise<DocumentRow[]> {
  const db = getDb()
  const where: SQL[] = [eq(documents.workspace_id, opts.workspaceId)]
  if (!opts.includeDeleted) where.push(isNull(documents.deleted_at))
  if (opts.kind) where.push(eq(documents.kind, opts.kind))
  if (opts.q?.trim()) where.push(ilike(documents.title, `%${opts.q.trim()}%`))
  if (opts.prospectSeq != null) {
    where.push(sql`EXISTS (
      SELECT 1 FROM ${documentProspects} dp
      JOIN ${prospects} p ON p.id = dp.prospect_id
      WHERE dp.document_id = ${documents.id} AND p.seq = ${opts.prospectSeq}
        AND p.workspace_id = ${opts.workspaceId})`)
  }
  const rows = await db
    .select()
    .from(documents)
    .where(and(...where))
    .orderBy(desc(documents.created_at))
    .limit(clampLimit(opts.limit))
  return await decorateDocuments(rows)
}

export async function getDocumentBySeq(
  workspaceId: number,
  seq: number
): Promise<DocumentRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspace_id, workspaceId), eq(documents.seq, seq)))
    .limit(1)
  if (!row) return null
  return (await decorateDocuments([row]))[0] ?? null
}

/** Attach the link sets in two queries for the whole page, never two per row. */
async function decorateDocuments(rows: SalesDocument[]): Promise<DocumentRow[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)

  const pros = await db
    .select({ document_id: documentProspects.document_id, seq: prospects.seq })
    .from(documentProspects)
    .innerJoin(prospects, eq(prospects.id, documentProspects.prospect_id))
    .where(inArray(documentProspects.document_id, ids))
  const prods = await db
    .select({ document_id: documentProducts.document_id, seq: products.seq })
    .from(documentProducts)
    .innerJoin(products, eq(products.id, documentProducts.product_id))
    .where(inArray(documentProducts.document_id, ids))

  const byDoc = (list: Array<{ document_id: number; seq: number }>) => {
    const m = new Map<number, number[]>()
    for (const r of list) m.set(r.document_id, [...(m.get(r.document_id) ?? []), r.seq])
    return m
  }
  const pMap = byDoc(pros)
  const dMap = byDoc(prods)
  return rows.map((r) => ({
    ...r,
    prospect_numbers: (pMap.get(r.id) ?? []).sort((a, b) => a - b),
    product_numbers: (dMap.get(r.id) ?? []).sort((a, b) => a - b),
  }))
}

export interface DocumentInput {
  title?: string
  kind?: string
  uploadUrl?: string | null
  externalUrl?: string | null
  sizeBytes?: number | null
  mimeType?: string | null
  description?: string | null
  tags?: string[] | null
}

export async function addDocument(
  workspaceId: number,
  input: DocumentInput & { title: string; kind: string },
  actor: Actor
): Promise<SalesDocument> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, workspaceId, 'document')
    const [row] = await tx
      .insert(documents)
      .values({
        workspace_id: workspaceId,
        seq,
        title: input.title,
        kind: input.kind,
        upload_url: input.uploadUrl ?? null,
        external_url: input.externalUrl ?? null,
        size_bytes: input.sizeBytes ?? null,
        mime_type: input.mimeType ?? null,
        description: input.description ?? null,
        tags: input.tags ?? null,
        added_by_user_id: actor.userId,
        added_by_label: actor.label,
      })
      .returning()
    if (!row) throw new Error('document insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'document',
      entityId: row.id,
      action: 'created',
      meta: { title: row.title, kind: row.kind },
    })
    return row
  })
}

export async function updateDocument(
  workspaceId: number,
  seq: number,
  input: DocumentInput,
  actor: Actor
): Promise<SalesDocument | null> {
  const db = getDb()
  const existing = await getDocumentBySeq(workspaceId, seq)
  if (!existing) return null
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.title !== undefined) values.title = input.title
    if (input.kind !== undefined) values.kind = input.kind
    if (input.description !== undefined) values.description = input.description
    if (input.tags !== undefined) values.tags = input.tags
    // The two URL columns are NOT patchable, and that is deliberate. A CHECK
    // requires exactly one of them, so a partial update can violate it in a way
    // the caller cannot see coming — and moving a document from an upload to a
    // link is a different document. Delete and re-add.

    const [row] = await tx
      .update(documents)
      .set(values)
      .where(and(eq(documents.workspace_id, workspaceId), eq(documents.seq, seq)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'document',
      entityId: row.id,
      action: 'updated',
      meta: { title: row.title },
    })
    return row
  })
}

export async function softDeleteDocument(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<SalesDocument | null> {
  return await softDeleteCatalogRow('document', workspaceId, seq, actor)
}

/** Link or unlink a document to a prospect / product / template. */
export async function setDocumentLink(
  workspaceId: number,
  documentId: number,
  target: { kind: 'prospect' | 'product' | 'template'; id: number },
  attach: boolean,
  actor: Actor
): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const table =
      target.kind === 'prospect'
        ? documentProspects
        : target.kind === 'product'
          ? documentProducts
          : templateDocuments
    if (attach) {
      // ON CONFLICT DO NOTHING: attaching twice is the same state, not an error.
      // A 409 here would make an agent's retry a failure.
      if (target.kind === 'prospect') {
        await tx
          .insert(documentProspects)
          .values({ document_id: documentId, prospect_id: target.id })
          .onConflictDoNothing()
      } else if (target.kind === 'product') {
        await tx
          .insert(documentProducts)
          .values({ document_id: documentId, product_id: target.id })
          .onConflictDoNothing()
      } else {
        await tx
          .insert(templateDocuments)
          .values({ document_id: documentId, template_id: target.id })
          .onConflictDoNothing()
      }
    } else if (target.kind === 'prospect') {
      await tx
        .delete(documentProspects)
        .where(
          and(
            eq(documentProspects.document_id, documentId),
            eq(documentProspects.prospect_id, target.id)
          )
        )
    } else if (target.kind === 'product') {
      await tx
        .delete(documentProducts)
        .where(
          and(
            eq(documentProducts.document_id, documentId),
            eq(documentProducts.product_id, target.id)
          )
        )
    } else {
      await tx
        .delete(templateDocuments)
        .where(
          and(
            eq(templateDocuments.document_id, documentId),
            eq(templateDocuments.template_id, target.id)
          )
        )
    }
    void table
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'document',
      entityId: documentId,
      action: attach ? 'labeled' : 'unlabeled',
      meta: { link: target.kind, target_id: target.id },
    })
  })
}

// ---------------------------------------------------------------------------
// the shared soft delete
// ---------------------------------------------------------------------------

/**
 * Bin a catalog row: `deleted_at`, an event, and the projection marked deleted.
 *
 * One implementation for all three because the three tables differ in nothing
 * that matters here — same #number, same `deleted_at`, same projection. Written
 * once rather than three times so that the day a fourth catalog entity arrives,
 * the delete is not the thing that gets it subtly wrong.
 */
async function softDeleteCatalogRow<T extends 'product' | 'template' | 'document'>(
  type: T,
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<(T extends 'product' ? Product : T extends 'template' ? Template : SalesDocument) | null> {
  const db = getDb()
  const table = type === 'product' ? products : type === 'template' ? templates : documents
  const label = (row: Record<string, unknown>) => String(row.name ?? row.title ?? '')

  const out = await db.transaction(async (tx) => {
    const now = new Date()
    const rows = await tx
      .update(table)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(table.workspace_id, workspaceId), eq(table.seq, seq), isNull(table.deleted_at)))
      .returning()
    const row = rows[0]
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: type,
      entityId: row.id,
      action: 'deleted',
      meta: { name: label(row as Record<string, unknown>), number: row.seq },
    })
    return row
  })
  // Already binned is not an error — report what is there, as the prospect path
  // does, so a retry reads the same as the first call.
  if (out) return out as never
  const existing =
    type === 'product'
      ? await getProductBySeq(workspaceId, seq)
      : type === 'template'
        ? await getTemplateBySeq(workspaceId, seq)
        : await getDocumentBySeq(workspaceId, seq)
  return (existing as never) ?? null
}
