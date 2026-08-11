import { defineConfig } from 'vitest/config'

// The tests in this repo that are about the BOUNDARY between packages and apps,
// rather than about one app.
//
// It was "the one test about shared code" until 2026-08-11, when
// `packages/platform-api` grew its own `test/` for `account-census.test.ts` —
// unit tests of one package's logic belong with that package. What stays here
// is what no single package owns.
//
// It lives here because platform-testing owns the boundary harness and is
// app-agnostic: a check on `packages/*` that an app owned would be duplicated
// per app and would drift. See `test/package-isolation.test.ts` for what it
// guards and why nothing guarded it before 2026-08-06.
//
// `test/`, not `src/`: the scan is pointed at `packages/platform-*/src`, and the
// test injects a literal app-schema reference as a fixture. A scanner that
// flagged its own test is a scanner people learn to switch off.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
