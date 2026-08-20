// Resolving `--strategy <n>` on a prospect write (#37).
//
// A shared helper rather than two copies, for `lib/http-input.ts`'s reason: the
// POST and the PATCH ask the identical question, and a validator copied is a
// validator that gets fixed in one place.
//
// It exists at all because of the rule `lib/views.ts` opens with: **`number`,
// never `id`.** The wire carries a strategy's workspace #number; the column is a
// serial. Something has to swap one for the other, and doing it here means the
// serial never reaches a route body, a CLI struct or a response.

import { Errors } from '@blackcode/platform-api'
import { getStrategyBySeq } from '@/lib/db/queries/strategies'

/**
 * A strategy's #number → its row id.
 *
 * `undefined` in, `undefined` out: the caller did not name one, which is not an
 * error. A number that names nothing in this workspace is a 404 rather than a
 * silent null — linking a prospect to a segment that does not exist would
 * succeed, store nothing, and read as "the link did not save".
 */
export async function resolveStrategy(
  workspaceId: number,
  seq: number | undefined
): Promise<number | undefined> {
  if (seq === undefined) return undefined
  const row = await getStrategyBySeq(workspaceId, seq)
  if (!row) {
    throw Errors.notFound(
      'strategy_not_found',
      `no strategy #${seq} in this workspace`,
      'run `bk sales strategy list` for the numbers'
    )
  }
  return row.id
}
