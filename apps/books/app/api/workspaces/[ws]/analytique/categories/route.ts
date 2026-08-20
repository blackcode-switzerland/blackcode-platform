// GET  /api/workspaces/{ws}/analytique/categories — `bk books category list`
// POST /api/workspaces/{ws}/analytique/categories — `bk books category create`
//
// The breakdown's buckets, per book. Seeded with the mockup's five; custom
// ones are configuration a human writes (the seventh write). Never deleted —
// a past analysis may cite a breakdown that used one — so the exit is
// `retired`, and the list serves retired rows honestly flagged.
import { NextRequest, NextResponse } from "next/server";
import { Errors, jsonList } from "@blackcode/platform-api";
import { apiHandler, resolveWorkspace } from "@/lib/api";
import { getEntityBySlug, listEntities } from "@/lib/db/queries/statutory";
import {
  createCategory,
  listCategories,
  ManagementRefused,
  publicCategory,
} from "@/lib/db/queries/management";

interface Params {
  params: Promise<{ ws: string }>;
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params;
  const ctx = await resolveWorkspace(req, ws);
  const slug = req.nextUrl.searchParams.get("entity");
  const entities = await listEntities(ctx.workspace.id);
  const entity = slug ? entities.find((e) => e.slug === slug) : entities[0];
  if (!entity) {
    throw Errors.badRequest(
      "bad_scope",
      slug ? `no book with slug "${slug}"` : "no books exist in this workspace",
      slug
        ? `known books: ${entities.map((e) => e.slug).join(", ")}`
        : "create one with `bk books entity create`",
    );
  }
  const rows = await listCategories(entity.id);
  return jsonList(
    rows.map((c) => publicCategory(c, entity.slug)),
    null,
  );
});

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params;
  const ctx = await resolveWorkspace(req, ws);

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    throw Errors.badRequest(
      "bad_json",
      "the payload is not JSON",
      "bk books category create",
    );
  const entitySlug =
    typeof body.entity === "string" && body.entity.trim()
      ? body.entity.trim()
      : null;
  if (!entitySlug)
    throw Errors.badRequest(
      "missing_field",
      "entity is required",
      "which book gets the category?",
    );

  try {
    const row = await createCategory(ctx.workspace.id, {
      entitySlug,
      key: typeof body.key === "string" ? body.key.trim() : "",
      label: body.label,
      accounts: Array.isArray(body.accounts) ? (body.accounts as string[]) : [],
    });
    const entity = await getEntityBySlug(ctx.workspace.id, entitySlug);
    return NextResponse.json(publicCategory(row, entity?.slug ?? entitySlug), {
      status: 201,
    });
  } catch (e) {
    if (e instanceof ManagementRefused) {
      if (e.code === "entity_not_found")
        throw Errors.notFound(e.code, e.message, e.suggestion);
      throw Errors.badRequest(e.code, e.message, e.suggestion);
    }
    throw e;
  }
});
