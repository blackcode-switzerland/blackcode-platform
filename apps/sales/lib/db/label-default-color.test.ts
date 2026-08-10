// `sales.labels.color`'s default exists in two places and cannot exist in one.
//
// `lib/pipeline.ts` owns every colour in this app (D-4, enforced by
// `lib/palette.test.ts`), and `lib/db/schema.ts` imports the constant. Migration
// 0003 cannot: SQL has no way to read a TypeScript value, so the hex is written
// out a second time there.
//
// Two hand-maintained copies of one fact is this codebase's recurring silent
// drift bug (D-27 trap 2), and `lib/storage/scanner.test.ts` is the existing
// answer to the same problem — a test that holds a TS list against the migration
// that must agree with it. This is that, for one value.
//
// The drift is silent in the direction that matters: change the constant alone
// and every label created through the app gets the new colour while every label
// created by a direct INSERT — a seed, a fixture, a repair script — gets the old
// one, and nothing anywhere goes red.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LABEL_COLOR } from '@/lib/pipeline'

const MIGRATION = join(__dirname, 'migrations', '0003_sales_own_foundations.sql')

describe('sales.labels.color default (D-4)', () => {
  it('THE PREMISE: the migration declares a default for labels.color', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    // Assert the input. If this regex stops matching — the column renamed, the
    // default dropped, the table moved to another migration — the equality
    // below would compare `undefined` to `undefined` and pass while checking
    // nothing at all.
    const match = sql.match(/^\s*color\s+varchar\(7\)\s+DEFAULT\s+'(#[0-9a-f]{6})'/im)
    expect(
      match,
      `no \`color varchar(7) DEFAULT '#…'\` in ${MIGRATION}. Either the column changed ` +
        'or this table moved to a later migration — repoint this test, do not delete it.'
    ).not.toBeNull()
  })

  it('the migration and lib/pipeline.ts agree', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const declared = sql.match(/^\s*color\s+varchar\(7\)\s+DEFAULT\s+'(#[0-9a-f]{6})'/im)?.[1]
    expect(
      declared,
      `migration 0003 defaults labels.color to ${declared}, lib/pipeline.ts says ` +
        `${DEFAULT_LABEL_COLOR}. A row inserted through the app and a row inserted by ` +
        'SQL would get different colours and nothing else would report it.'
    ).toBe(DEFAULT_LABEL_COLOR)
  })

  it('is NOT the platform table\'s grey — that is the whole point of D-4', () => {
    // `platform.labels` defaults to issues' cool `#6b7280`. Copying it over was
    // the actual mistake `lib/palette.test.ts` caught when this table was
    // written, so it is worth pinning rather than trusting nobody repeats it.
    expect(DEFAULT_LABEL_COLOR).not.toBe('#6b7280')
  })
})
