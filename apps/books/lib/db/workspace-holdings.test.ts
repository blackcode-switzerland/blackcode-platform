// Every books table that carries a `workspace_id` is classified for delete.
//
// `deleteWorkspace` (lib/db/queries/workspaces.ts) refuses to delete a workspace
// that has held anything, and it decides that by counting rows in
// `HELD_TABLES`. The database does not back it up: only `books.entry` and
// `books.ri_entry` refuse a delete, so a cascade from `books.workspaces` empties
// every other table silently. A table added later and left out of `HELD_TABLES`
// is therefore one a workspace delete would wipe without asking.
//
// So this reads `schema.ts` — every `booksSchema.table('<name>', { … })` whose
// body declares `workspace_id` — and requires each to be in exactly one of
// `HELD_TABLES` or `TENANCY_TABLES`. It cannot see a table created by raw SQL
// and never declared in `schema.ts`; `schema-parity.test.ts` is what keeps the
// two in step.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELD_TABLES, TENANCY_TABLES } from './queries/workspaces'

const SCHEMA = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'schema.ts'), 'utf8')

/** Tables whose drizzle definition declares a `workspace_id` column. */
function tablesWithWorkspaceId(src: string): string[] {
  const out: string[] = []
  const re = /booksSchema\.table\(\s*'([a-z_]+)'\s*,\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    // The column block ends at the first `}` that closes the object literal at
    // depth zero; walk braces rather than guessing with a regex.
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    if (/\bworkspace_id\s*:/.test(src.slice(re.lastIndex, i))) out.push(m[1])
  }
  return out
}

describe('workspace delete: every workspace-scoped table is classified', () => {
  const found = tablesWithWorkspaceId(SCHEMA)
  const held = new Set<string>(HELD_TABLES)
  const tenancy = new Set<string>(TENANCY_TABLES)

  it('found the workspace-scoped tables (guards against a vacuous pass)', () => {
    expect(found.length).toBeGreaterThanOrEqual(15)
    expect(found).toContain('entity')
    expect(found).toContain('workspace_members')
  })

  it('each is either HELD (blocks delete) or TENANCY — never neither', () => {
    const unclassified = found.filter((t) => !held.has(t) && !tenancy.has(t))
    expect(
      unclassified,
      `add these to HELD_TABLES (or, only if a row says nothing about the books, TENANCY_TABLES) ` +
        `in lib/db/queries/workspaces.ts — otherwise deleting a workspace empties them without asking`
    ).toEqual([])
  })

  it('no table is in both lists, and every listed table exists', () => {
    expect([...held].filter((t) => tenancy.has(t))).toEqual([])
    const all = new Set(found)
    expect([...held, ...tenancy].filter((t) => !all.has(t))).toEqual([])
  })
})
