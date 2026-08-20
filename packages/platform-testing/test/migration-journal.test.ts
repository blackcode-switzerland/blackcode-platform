// Every migration `.sql` file is listed in its app's drizzle `_journal.json`.
//
// ===========================================================================
// THIS EXISTS BECAUSE IT HAPPENED, IN PRODUCTION, ON 2026-08-17
// ===========================================================================
// Five sales migrations (0008–0012) were written by hand, applied to a local
// database with `psql`, and verified by reading `pg_trigger` and
// `pg_constraint`. Every one of them was correct.
//
// **None of them was in `meta/_journal.json`**, which is the only list
// `drizzle-kit migrate` reads. So the production build ran the migrator, the
// migrator found nothing to do, `postbuild` printed
// `✓ migrations applied.` and exited 0, and the deploy went out with new code
// against an old schema. Four routes 500'd on `column "website" does not
// exist` — prospects, products, strategies and documents, all at once.
//
// The verification was real and it was aimed at the wrong thing. `psql` applies
// a FILE; production applies the JOURNAL. Checking the SQL proved the SQL, and
// nothing at all about whether the SQL would ever run — the standing rule's
// "an absence is only evidence if you know your instrument could have seen the
// presence", one layer up from the usual place.
//
// ===========================================================================
// IT IS TWO-WAY, AND THE SECOND DIRECTION IS NOT SYMMETRIC
// ===========================================================================
//   file, not in journal   the migration NEVER RUNS. Silent, and it looks like
//                          a successful deploy — the case above.
//   journal, no file       `drizzle-kit migrate` throws at startup. Loud, and
//                          it fails the build rather than the request. Still
//                          checked, because catching it here costs nothing and
//                          a broken build at 2am costs a lot.
//
// It also asserts ORDER: drizzle applies entries by `when`, and an out-of-order
// timestamp would run a later migration before an earlier one — which for
// 0010's `prospects.strategy_id` FK means referencing a table 0010 itself
// creates. That is a foreign key error at deploy time, not at review time.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS_DIR = join(REPO, 'apps')

interface JournalEntry {
  idx: number
  when: number
  tag: string
}

/** Apps that keep drizzle migrations, discovered rather than listed. */
function appsWithMigrations(): Array<{ app: string; dir: string; journal: string }> {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      app: e.name,
      dir: join(APPS_DIR, e.name, 'lib', 'db', 'migrations'),
      journal: join(APPS_DIR, e.name, 'lib', 'db', 'migrations', 'meta', '_journal.json'),
    }))
    .filter((a) => existsSync(a.dir) && existsSync(a.journal))
}

const APPS = appsWithMigrations()

describe('the inputs — assert these first, or the checks below are theatre', () => {
  it('found at least the two production apps', () => {
    // Without this, a rename of `lib/db/migrations` would make every assertion
    // below iterate an empty list and pass. CLAUDE.md finding #5.
    const names = APPS.map((a) => a.app).sort()
    expect(names, `only found: ${names.join(', ')}`).toEqual(
      expect.arrayContaining(['issues', 'sales'])
    )
  })

  it('every journal parses and is non-empty', () => {
    for (const a of APPS) {
      const j = JSON.parse(readFileSync(a.journal, 'utf8'))
      expect(Array.isArray(j.entries), `${a.app}: _journal.json has no entries array`).toBe(true)
      expect(j.entries.length, `${a.app}: journal is empty`).toBeGreaterThan(0)
    }
  })
})

describe.each(APPS)('$app — migrations and the drizzle journal are one list', ({ app, dir, journal }) => {
  const entries: JournalEntry[] = JSON.parse(readFileSync(journal, 'utf8')).entries
  const tags = entries.map((e) => e.tag)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort()

  it('every .sql file is in the journal — an unlisted one NEVER RUNS', () => {
    const missing = files.filter((f) => !tags.includes(f))
    expect(
      missing,
      `${app}: these migrations exist on disk and are NOT in meta/_journal.json, so ` +
        '`drizzle-kit migrate` will never apply them. The build will succeed, ' +
        'postbuild will print "migrations applied", and the deploy will serve new ' +
        'code against an old schema. This is exactly what shipped on 2026-08-17.\n' +
        `  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('every journal entry has a .sql file — a missing one fails the build', () => {
    const orphans = tags.filter((t) => !files.includes(t))
    expect(
      orphans,
      `${app}: the journal names migrations with no file. \`drizzle-kit migrate\` ` +
        `throws on these:\n  ${orphans.join('\n  ')}`
    ).toEqual([])
  })

  it('journal `when` timestamps are strictly increasing', () => {
    // Drizzle applies by `when`, not by filename. An out-of-order timestamp runs
    // a later migration first — and sales' 0010 adds a foreign key to a table
    // 0010 itself creates, so the failure is a constraint error on deploy.
    const out: string[] = []
    for (let i = 1; i < entries.length; i++) {
      if (entries[i]!.when <= entries[i - 1]!.when) {
        out.push(`${entries[i]!.tag} (${entries[i]!.when}) <= ${entries[i - 1]!.tag} (${entries[i - 1]!.when})`)
      }
    }
    expect(out, `${app}: journal order does not match apply order:\n  ${out.join('\n  ')}`).toEqual([])
  })

  it('journal `idx` values are unique and sequential', () => {
    const idxs = entries.map((e) => e.idx)
    expect(new Set(idxs).size, `${app}: duplicate idx in the journal`).toBe(idxs.length)
    expect(idxs, `${app}: idx is not sequential`).toEqual(
      idxs.map((_, i) => idxs[0]! + i)
    )
  })
})
