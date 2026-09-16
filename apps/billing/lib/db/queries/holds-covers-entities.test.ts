// Every person-facing table in this app's schema is named in the account
// footprint's `holds` — or is explicitly exempt, with a reason.
//
// ===========================================================================
// WHY THIS GUARD EXISTS AND WHAT IT IS ACTUALLY FOR
// ===========================================================================
// `AppContext.footprint` is what stops a whole-account close from STRANDING an
// app's data: soft-deleting `platform.users` while this app's rows survive,
// owned by an account that can no longer sign in. Not lost — invisible to its
// owner and unrecoverable by them. The field is required for that reason
// (`packages/platform-api/src/account-footprint.ts`).
//
// Required is only half of it. An app can satisfy the type and still under-report:
// `holds: []` compiles, returns 200, and tells the census this app is empty. In
// phase 0 that answer is TRUE — this app has tenancy and a counter and no
// entities. From phase 1 it is a lie, and nothing about the shape of the code
// changes when it becomes one.
//
// So the obligation "add a table, add a line" is guarded rather than remembered.
// `docs/billing-app-plan/phase-1-companies-and-invoices.md` states it in prose;
// prose is not a guard, and CLAUDE.md finding #23 is what a prose copy of a fact
// the code owns is worth.
//
// ===========================================================================
// WHAT IT CHECKS, AND WHAT IT CANNOT
// ===========================================================================
// It reads the table list out of `lib/db/schema.ts` — the declarations, not a
// hand-written list — and asserts each one is either named in
// `footprint.ts`'s `countIn` or present in `NOT_PERSON_FACING` below.
//
// It is a TEXT scan over two files, and the granularity is part of what it
// checks (finding #11). It cannot tell whether a `count` is CORRECT, only
// whether the table is mentioned at all. That is the cheap half of the trade and
// it is the half that was missing: the expensive failure is a table nobody
// thought about, not a table counted slightly wrong.
//
// **It will go red in phase 1**, on `company` and `invoice`, which is the point.
// The fix is two lines in `countIn`, not an entry here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SCHEMA = readFileSync(join(HERE, '..', 'schema.ts'), 'utf8')
const FOOTPRINT = readFileSync(join(HERE, 'footprint.ts'), 'utf8')

/**
 * Tables a person does not "lose" in the sense the confirmation screen means.
 *
 * Every entry needs a reason, and the reason has to be about the PERSON rather
 * than about convenience — an exemption granted because a count was awkward to
 * write is how this guard's coverage rots.
 */
const NOT_PERSON_FACING = new Map<string, string>([
  [
    'workspaces',
    'the workspace IS the unit the footprint reports (`will_delete` / `blocked_by`), ' +
      'so counting it inside `holds` would be reporting the container as its own contents',
  ],
  [
    'workspace_members',
    'membership of a workspace that is about to be deleted. `blocked_by` already ' +
      'reports the case that matters — other people still in it — and it refuses the ' +
      'purge rather than counting it',
  ],
  [
    'invitations',
    'a pending invitation is an offer, not a record of this person. It dies with the ' +
      'workspace and nobody would describe losing one as losing their data',
  ],
  [
    'counters',
    'the #number allocator: one row per (workspace, entity type) holding an integer. ' +
      'It has no meaning without the entities it numbers, and those are counted on ' +
      'their own lines',
  ],
])

/** Tables declared on this app's schema, read from the declarations. */
function declaredTables(): string[] {
  return [...SCHEMA.matchAll(/billingSchema\.table\(\s*'([a-z_]+)'/g)].map((m) => m[1])
}

describe('the account footprint covers every person-facing table', () => {
  const tables = declaredTables()

  // Both halves of this guard read a file by path, so "found nothing" is a real
  // failure mode and an empty list makes the assertion below pass while checking
  // nothing. Assert the inputs before trusting the conclusion — every such
  // assertion in this repo exists because a guard that found nothing passed.
  it('found the schema and its tables (guards against a vacuous pass)', () => {
    expect(
      SCHEMA.length,
      'lib/db/schema.ts read as empty — has it moved?'
    ).toBeGreaterThan(0)
    expect(
      tables.length,
      'no `billingSchema.table(...)` declarations found. Either the schema moved or the ' +
        'declaration spelling changed, and this guard has been passing without a subject'
    ).toBeGreaterThan(0)
  })

  it('names every table in `countIn`, or exempts it with a reason', () => {
    const unaccounted = tables.filter(
      (t) => !NOT_PERSON_FACING.has(t) && !FOOTPRINT.includes(t)
    )
    expect(
      unaccounted,
      'these tables are in `billing.*` and are neither counted in `countIn` nor exempt ' +
        'in NOT_PERSON_FACING:\n' +
        unaccounted.map((t) => `  billing.${t}`).join('\n') +
        '\n\nAdd a line to `countIn` in lib/db/queries/footprint.ts. An app that ' +
        'under-reports its footprint is an app the whole-account close silently SKIPS, ' +
        'which is the bug `AppContext.footprint` exists to prevent.'
    ).toEqual([])
  })

  // An exemption outliving its table is coverage quietly dropped, and it is the
  // failure nobody looks for: the entry keeps working, so nothing draws attention
  // to it. Same reasoning as `cli-parity.test.ts`' stale-exclusion check.
  it('every exemption names a table this app still has', () => {
    const stale = [...NOT_PERSON_FACING.keys()].filter((t) => !tables.includes(t))
    expect(
      stale,
      `these exemptions name tables that no longer exist — delete them:\n${stale.join('\n')}`
    ).toEqual([])
  })
})
