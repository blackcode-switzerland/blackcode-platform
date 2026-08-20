// GET /api/workspaces/{ws}/bilan — `bk books bilan`
//
// The balance sheet, art. 959a, in statutory order.
//
// Every legal line is returned INCLUDING the zero ones. A zero-balance statutory
// line still legally exists; collapsing it is a view decision and dropping it from
// the payload is not this route's to make.
//
// `balanced` and `ecart` are returned rather than asserted. If a bilan does not
// balance the caller must be able to SEE that, and by how much, instead of getting
// a 500 that hides which book is broken.
import { NextRequest, NextResponse } from "next/server";
import { Errors } from "@blackcode/platform-api";
import { apiHandler, resolveWorkspace } from "@/lib/api";
import { getBilan, resolveScope } from "@/lib/db/queries/statutory";

interface Params {
  params: Promise<{ ws: string }>;
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params;
  const ctx = await resolveWorkspace(req, ws);
  const q = req.nextUrl.searchParams;
  const scope = await resolveScope(
    ctx.workspace.id,
    q.get("entity"),
    q.get("exercice") ? Number(q.get("exercice")) : null,
  );
  if ("error" in scope)
    throw Errors.badRequest("bad_scope", scope.error, scope.suggestion);

  // A sole proprietorship has no balance sheet, ever (art. 957 al. 2). Saying so
  // is more useful than returning an empty one that looks like missing data.
  if (scope.entity.bookkeeping_regime === "simplified") {
    throw Errors.badRequest(
      "no_bilan_for_simplified",
      `"${scope.entity.slug}" keeps simplified books (art. 957 al. 2 CO) and has no bilan`,
      // "the patrimoine route" named no command a caller can run. The hint
      // is the whole recovery path for an app whose web surface writes
      // nothing, so it names the verb.
      "use `bk books overview` for its recettes/dépenses totals, or `bk books patrimoine --entity <book>` for net worth",
    );
  }

  const bilan = await getBilan(scope.entity.id, scope.exercice.id);
  return NextResponse.json({
    entity: scope.entity.slug,
    exercice: scope.exercice.year,
    ...bilan,
  });
});
