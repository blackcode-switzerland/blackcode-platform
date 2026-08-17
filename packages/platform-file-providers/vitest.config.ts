import { defineConfig } from 'vitest/config'

// Unit tests for this package's own logic.
//
// `test/`, not `src/`: `packages/platform-testing`'s isolation scanner reads
// `packages/platform-*/src`, and a test that injects a fixture into `src` would
// trip the scanner on itself — the same reason platform-testing puts its own
// tests in `test/`.
//
// What belongs here: shared behaviour whose failure mode is worse than its
// staging cost. `test/account-census.test.ts` is the first, and its subject is
// the one operation in this package that destroys data in another deployment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
