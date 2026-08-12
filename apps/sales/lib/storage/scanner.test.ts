// `SURFACES` and the migrations' triggers are ONE list. This asserts it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FILE WAS CITED BEFORE IT EXISTED
// ═══════════════════════════════════════════════════════════════════════════
// `scanner.ts` said, in the header of the constant that decides which columns
// this app accounts for:
//
//     `scanner.test.ts` asserts the migration's `CREATE TRIGGER` statements
//     match it exactly.
//
// There was no such file, and no test anywhere asserted that property. The claim
// was written in the file CLAUDE.md names as sitting on the path between a code
// change and unrecoverable data loss, where a reader deciding whether a change
// is safe would take it at face value. Found on 2026-08-07 by
// `packages/platform-testing/test/cited-tests-exist.test.ts`, which was written
// because the same thing had already happened once with
// `entities.projection.test.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE PROPERTY MATTERS
// ═══════════════════════════════════════════════════════════════════════════
// Two things must agree about which columns can hold a file URL:
//
//   THE TRIGGERS  maintain `platform.blob_references` on every write. They are
//                 what makes the index impossible for a write path to forget.
//   THE SCANNER   re-derives the same answer for `bk super-admin blob-drift`,
//                 the reconciler that decides whether the index is trustworthy.
//
// Disagreement is silent and it is asymmetric:
//
//   column triggered, NOT scanned  -> blob-drift reports references it cannot
//                                     account for. Noisy, and safe.
//   column scanned, NOT triggered  -> a file embedded there is referenced by
//                                     nobody as far as the index is concerned,
//                                     so the delete gate permits deletion, and
//                                     blob-drift reports a clean index. **The
//                                     file is gone and nothing said so.**
//
// The second direction is why this is a test and not a code review note.
//
// ── IT MATCHES TEXT (D-42) ─────────────────────────────────────────────────
// It parses SQL with a regex, which is the family of guard this repo has found
// inert five times over — the granularity of the match is part of what it
// checks. Two mitigations: the parse asserts it found a non-zero number of
// triggers before comparing anything (a regex that stops matching would
// otherwise report a perfect match over an empty set), and the comparison is
// two-way, so neither side can quietly grow an entry the other lacks.
//
// Break it before you trust it: delete a column from one side, watch this go
// red, restore.
//
// ── IT READ ONLY 0002 UNTIL 2026-08-12, AND THAT CONTRADICTED ITS OWN ADVICE ─
// The failure message below has always said:
//
//     Add the trigger in a NEW migration (0002 is already applied)
//
// and the parser then read `0002_blob_reference_index.sql` and nothing else. So
// following the instruction the guard gives you leaves the guard red: the
// trigger exists, the surface is scanned, and the file the test looks in does
// not mention either. The FIRST person to add a content column after 0002 would
// have hit it — migration 0007 (`meetings.meeting_url`) is that column.
//
// It reads the whole migrations DIRECTORY now. That is also the only version
// that can be correct going forward, because a trigger's definitive form is
// wherever it was most recently created, and `SURFACES` is one list describing
// the database as it stands rather than as 0002 left it.
//
// Two consequences worth stating, because they are what make directory-reading
// safe rather than merely wider:
//
//   - A trigger REPLACED by a later migration must not be counted twice under
//     its old columns. Later files win, keyed on (table, trigger name) — the
//     same key Postgres itself uses, since a table can hold only one trigger of
//     a given name.
//   - A migration that DROPS a trigger without recreating it removes the entry,
//     rather than leaving a phantom that keeps this test green over a column
//     nothing maintains any more.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SURFACES } from './scanner'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const MIGRATIONS_DIR = join(APP_ROOT, 'lib', 'db', 'migrations')

interface TriggerSpec {
  type: string
  mode: string
  columns: string[]
}

/** Migration files in APPLY ORDER — `0001…`, `0002…`, … Lexical is numeric here
 *  because drizzle zero-pads, and the journal applies them in the same order. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Every LIVE `blob_refs_sync` trigger across all migrations, as
 * (source_type, mode, columns).
 *
 * `platform.blob_refs_sync`'s arguments are ('<app>', '<type>',
 * '<workspace column>', '<mode>', '<column>'...) — the app and workspace column
 * are not compared, because `SURFACES` does not carry them; what this file is
 * about is the set of CONTENT COLUMNS, which is the half that can silently
 * diverge.
 *
 * Keyed on `<table>.<trigger name>`, which is what Postgres itself uniquely
 * identifies a trigger by, so a later migration replacing one supersedes it
 * instead of adding a second entry, and a bare DROP removes it.
 */
function liveTriggers(): TriggerSpec[] {
  const byName = new Map<string, TriggerSpec | null>()

  // A CREATE TRIGGER through to its blob_refs_sync argument list, and a DROP
  // TRIGGER on its own. Matched in source order within each file, files in
  // apply order, so the last statement about a trigger is the one that stands.
  //
  // `\sON\s` — the leading whitespace is load-bearing and was missing in the
  // first version of this parser. These are case-INSENSITIVE patterns and the
  // prospects trigger reads `... UPDATE OF summary, next_action_note,
  // closed_reason ON sales.prospects`: a lazy `ON\s+` matches the "on" that ends
  // "closed_reasON", takes the following space, and reads the table name as the
  // literal word "ON". The prospects trigger then keyed as `on.trg_blob_refs`
  // while its own DROP correctly keyed as `sales.prospects.trg_blob_refs`, so
  // the drop won and the live set silently lost a surface.
  //
  // It was caught by this file's own two-way comparison on the first run, which
  // is the argument for keeping BOTH directions: the parser is the part of a
  // text-matching guard most likely to be wrong, and only the "trigger exists,
  // SURFACES does not know" half looks at what the parser produced.
  const CREATE =
    /CREATE\s+TRIGGER\s+(\w+)[\s\S]*?\sON\s+([\w.]+)[\s\S]*?platform\.blob_refs_sync\s*\(([^)]*)\)/gi
  const DROP = /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+([\w.]+)/gi

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    // One pass over the file, statements in the order they run: a DROP followed
    // by a CREATE of the same name (0002's own idiom) must end as the CREATE.
    const events: Array<{ at: number; run: () => void }> = []

    for (const m of sql.matchAll(DROP)) {
      const key = `${m[2].toLowerCase()}.${m[1]}`
      events.push({ at: m.index!, run: () => byName.set(key, null) })
    }
    for (const m of sql.matchAll(CREATE)) {
      const key = `${m[2].toLowerCase()}.${m[1]}`
      const args = m[3]
        .split(',')
        .map((a) => a.trim().replace(/^'|'$/g, ''))
        .filter((a) => a.length > 0)
      if (args.length < 5) continue
      const [, type, , mode, ...columns] = args
      events.push({ at: m.index!, run: () => byName.set(key, { type, mode, columns }) })
    }

    for (const e of events.sort((a, b) => a.at - b.at)) e.run()
  }

  return [...byName.values()].filter((t): t is TriggerSpec => t != null)
}

const MIGRATION_FILES = migrationFiles()
const TRIGGERS = liveTriggers()

const key = (t: { type: string; mode: string; columns: readonly string[] }) =>
  `${t.type} [${t.mode}] ${[...t.columns].sort().join(',')}`

describe('the scanner and the migrations are two renderings of one list', () => {
  // Assert the input. A regex that stopped matching would leave TRIGGERS empty,
  // and an empty set compared two ways round reports one difference per surface
  // — which looks like a real failure — but a future "fix" that made the
  // comparison one-way would then pass over nothing at all.
  it('found migration files to read', () => {
    expect(
      MIGRATION_FILES.length,
      `no .sql files in ${MIGRATIONS_DIR} — the migrations moved, and a parser ` +
        'reading an empty directory finds no triggers and reports a difference ' +
        'per surface, which a future "fix" could silence by making the ' +
        'comparison one-way.'
    ).toBeGreaterThan(0)
  })

  it('parsed triggers out of the migrations', () => {
    expect(
      TRIGGERS.length,
      `no live platform.blob_refs_sync(...) triggers found across ` +
        `${MIGRATION_FILES.length} migration(s) in ${MIGRATIONS_DIR}. Either they ` +
        'moved, or these regexes stopped matching — both mean the comparison ' +
        'below is meaningless.'
    ).toBeGreaterThan(0)
  })

  it('has surfaces to compare against', () => {
    expect(SURFACES.length, 'SURFACES is empty').toBeGreaterThan(0)
  })

  it('every scanned surface has a trigger with the same columns', () => {
    const triggered = new Set(TRIGGERS.map(key))
    const missing = SURFACES.filter((s) => !triggered.has(key(s))).map(key)
    expect(
      missing,
      'these surfaces are SCANNED but have no matching trigger in 0002. This is ' +
        'the dangerous direction: a file embedded in one of these columns is ' +
        'referenced by nobody as far as platform.blob_references is concerned, so ' +
        'the delete gate permits deleting it and blob-drift reports a clean ' +
        'index.\n' +
        'Add the trigger in a NEW migration (the earlier ones are already ' +
        'applied) — this test reads every file in the migrations directory, so ' +
        'a new one counts:\n' +
        missing.join('\n')
    ).toEqual([])
  })

  it('every trigger has a scanned surface with the same columns', () => {
    const scanned = new Set(SURFACES.map(key))
    const extra = TRIGGERS.filter((t) => !scanned.has(key(t))).map(key)
    expect(
      extra,
      'the migrations install triggers for these, and SURFACES does not list ' +
        'them. Safe but wrong: blob-drift will report references it cannot ' +
        'account for, on every run, until somebody stops believing the ' +
        'reconciler.\n' + extra.join('\n')
    ).toEqual([])
  })
})
