// Whether an integration suite RUNS, and what it says when it does not.
//
// ---------------------------------------------------------------------------
// THE RULING THIS FILE IS (2026-08-07, Phase 11)
// ---------------------------------------------------------------------------
// Agent4 verified four database properties by hand — the blob delete gate in
// four states, the trigger end to end, the projection rollback, and two
// concurrent creates — and escalated rather than committing them as tests:
//
//     "they need a live database, the repo's pattern for that is a suite that
//      skips when TEST_DATABASE_URL is unset, and a skipped check reports
//      success. That is agent8's call, not mine to make quietly."
//
// Correct escalation, and the premise is right. The three options were: (a) add
// them and accept the skip, (b) add them and FAIL rather than skip where the
// variable should be set, (c) leave them as evidence in the reports.
//
// **The ruling is (a) plus the missing half of (b), and the reason is that (b)
// as stated cannot be built honestly today.** "An environment that should have
// it" is not a thing this repo can currently detect: there is no integration
// job, no CI step that provisions a database, nothing to key off. A test that
// guessed — "fail if CI=1" — would fail every existing CI run for a database
// nobody has provisioned, and would be deleted within a day. D-37: a guard that
// fires on correct behaviour gets deleted, and then the real one is gone too.
//
// So:
//
//   1. The skip is LOUD. `describe.skip` prints a dimmed ↓ among thirty other
//      lines; in `apps/issues` it currently hides EIGHTY-FIVE skipped tests
//      behind one such line, which is silent in every sense that matters.
//      CLAUDE.md's own corollary: "If a check cannot run yet, make it skip
//      LOUDLY, never silently."
//   2. The (b) behaviour EXISTS and is one variable away —
//      `REQUIRE_INTEGRATION_TESTS=1` turns the skip into a hard failure. The
//      day someone provisions a database for CI, they set that and the option
//      is taken, with no test file edited.
//
// (c) was rejected outright. Evidence was in a .txt file under `salesImplementation/`,
// archived out of the repo on 2026-08-10 (~/Documents/BAK/blackcode-platform-backups/)
// is evidence in a directory whose own README says it is deleted when the
// project ships.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A `describe` WRAPPER THAT SILENTLY DOES THE RIGHT THING
// ---------------------------------------------------------------------------
// It returns the `describe` to use and requires the caller to name the suite.
// A helper that read the env var and decided for you would put the decision one
// import away from the person reading the test file, and the whole failure this
// file exists to prevent is a reader who believes a check ran.

/** What the caller passes: vitest's `describe`, and its `.skip`. */
export interface DescribeLike {
  (name: string, fn: () => void): void
  skip: (name: string, fn: () => void) => void
}

export interface IntegrationSuiteOptions {
  /** `describe` from vitest. */
  describe: DescribeLike
  /** The suite's name, used in the skip notice so it names itself. */
  name: string
  /** `process.env.TEST_DATABASE_URL`, passed in rather than read here. */
  databaseUrl: string | undefined
  /**
   * `process.env.REQUIRE_INTEGRATION_TESTS`. When `'1'`, a missing database is
   * a THROWN error rather than a skip — option (b), available the moment an
   * environment exists that can honour it.
   */
  required?: string | undefined
  /**
   * Where to announce a skip. Defaults to a RAW `process.stderr.write`.
   *
   * **Not `console.warn`, and that is the whole point of this field existing.**
   * The first version of this helper used `console.warn` and produced output
   * indistinguishable from `describe.skip` — vitest intercepts `console.*` from
   * a test file and, at collection time for a skipped suite, drops it. A notice
   * nobody sees is the thing this helper was written to replace, reintroduced
   * inside the replacement. Watched, on 2026-08-07, by running the suite and
   * seeing "6 skipped" and nothing else.
   */
  warn?: (message: string) => void
}

/**
 * The `describe` an integration suite should use, and a loud notice when it is
 * not going to run.
 *
 *     const run = integrationDescribe({
 *       describe, name: 'sales entity projection',
 *       databaseUrl: process.env.TEST_DATABASE_URL,
 *       required: process.env.REQUIRE_INTEGRATION_TESTS,
 *     })
 *     run('sales entity projection (integration)', () => { … })
 *
 * Throws — before any test is collected, so the file cannot report green — when
 * `REQUIRE_INTEGRATION_TESTS=1` and there is no database.
 */
export function integrationDescribe(opts: IntegrationSuiteOptions): DescribeLike['skip'] | DescribeLike {
  const {
    describe,
    name,
    databaseUrl,
    required,
    // Raw stderr, deliberately — see the field's doc comment.
    warn = (m: string) => process.stderr.write(m),
  } = opts
  if (databaseUrl) return describe

  if (required === '1') {
    throw new Error(
      `REQUIRE_INTEGRATION_TESTS=1 but TEST_DATABASE_URL is unset — refusing to skip "${name}". ` +
        'This environment declared that its integration suites must run; a skipped suite reports success.'
    )
  }

  warn(
    `\n  ⚠ SKIPPING INTEGRATION SUITE "${name}" — TEST_DATABASE_URL is unset.\n` +
      '    Nothing below this line was checked. A skipped check reports success.\n' +
      '    To run it:   TEST_DATABASE_URL=postgres://… npm test\n' +
      '    To make a missing database an ERROR here: REQUIRE_INTEGRATION_TESTS=1\n'
  )
  return describe.skip
}
