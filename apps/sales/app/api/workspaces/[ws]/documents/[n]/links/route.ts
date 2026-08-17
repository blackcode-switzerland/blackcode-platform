// POST   /api/workspaces/{ws}/documents/{n}/links — attach to a prospect/product/template
// DELETE /api/workspaces/{ws}/documents/{n}/links — detach
//
// These links are what make the library ONE library. A document attached to
// three prospects is one row with three links, never three copies — which is
// why a "documents" tab on a prospect is a filtered view and why deleting a
// document from one prospect must not delete it from the others.
//
// Attaching twice is the same state, not an error: an agent's retry must not
// fail. Detaching something not attached is likewise reported rather than 404'd.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  getDocumentBySeq,
  getProductBySeq,
  getTemplateBySeq,
  setDocumentLink,
} from '@/lib/db/queries/catalog'
import { prospectIdBySeq } from '@/lib/db/queries/prospect-children'
import { getStrategyBySeq } from '@/lib/db/queries/strategies'
import { publicDocument } from '@/lib/views'
import { numberOr, requireNumberParam } from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

type TargetKind = 'prospect' | 'product' | 'template' | 'strategy'
type Target = { kind: TargetKind; id: number; number: number }

/**
 * Exactly one of --prospect / --product / --template / --strategy, resolved to
 * a row id.
 *
 * `strategy` joined the list in migration 0012 (#40 asks for "a prospect, a
 * product, a strategy doc, a template"); the other three have worked since 0001.
 */
async function resolveTarget(
  workspaceId: number,
  values: { prospect?: number; product?: number; template?: number; strategy?: number }
): Promise<Target> {
  const given = Object.entries(values).filter(([, v]) => v != null)
  if (given.length !== 1) {
    throw Errors.badRequest(
      'one_target_required',
      'link exactly one of prospect, product, template or strategy',
      'e.g. `bk sales doc link 4 --prospect 12`'
    )
  }
  const [kind, number] = given[0] as [TargetKind, number]

  if (kind === 'prospect') {
    const id = await prospectIdBySeq(workspaceId, number)
    if (id == null) {
      throw Errors.notFound(
        'prospect_not_found',
        `no prospect #${number} in this workspace`,
        'run `bk sales prospect list` for the numbers'
      )
    }
    return { kind, id, number }
  }
  const row =
    kind === 'product'
      ? await getProductBySeq(workspaceId, number)
      : kind === 'strategy'
        ? await getStrategyBySeq(workspaceId, number)
        : await getTemplateBySeq(workspaceId, number)
  if (!row) {
    throw Errors.notFound(
      `${kind}_not_found`,
      `no ${kind} #${number} in this workspace`,
      // The noun IS the command here — `product`, `template` and `strategy` are
      // all spelled the same way in `bk sales <noun> list`.
      `run \`bk sales ${kind} list\` for the numbers`
    )
  }
  return { kind, id: row.id, number }
}

async function handle(req: NextRequest, params: Params['params'], attach: boolean) {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'document')
  const doc = await getDocumentBySeq(ctx.workspace.id, seq)
  if (!doc) {
    throw Errors.notFound(
      'document_not_found',
      `no document #${seq} in this workspace`,
      'run `bk sales doc list` for the numbers'
    )
  }

  // POST takes a body; DELETE takes query parameters, because a DELETE with a
  // body is legal and widely mishandled by proxies and clients.
  const source = attach
    ? ((await req.json().catch(() => null)) as Record<string, unknown> | null)
    : Object.fromEntries(req.nextUrl.searchParams.entries())
  const target = await resolveTarget(ctx.workspace.id, {
    prospect: numberOr(source?.prospect == null ? null : String(source.prospect)),
    product: numberOr(source?.product == null ? null : String(source.product)),
    template: numberOr(source?.template == null ? null : String(source.template)),
    strategy: numberOr(source?.strategy == null ? null : String(source.strategy)),
  })

  const actor = await resolveActor(getDb(), req, ctx.user)
  await setDocumentLink(ctx.workspace.id, doc.id, { kind: target.kind, id: target.id }, attach, actor)

  const full = await getDocumentBySeq(ctx.workspace.id, seq)
  return NextResponse.json({
    ...publicDocument(full!, ctx.workspace.slug),
    linked: attach,
    target: { type: target.kind, number: target.number },
  })
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => handle(req, params, true))
export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => handle(req, params, false))
