import { defineConfig } from 'vitest/config'

// `test/`, not `src/`, for the reason `packages/platform-api/vitest.config.ts`
// gives: `packages/platform-testing`'s isolation scanner reads
// `packages/platform-*/src`, and a fixture there would trip it.
//
// The first test here (2026-09-17) guards the attachment path. Before documents
// existed this package had no tests at all, because the two templates it sent
// were disposable — a bounced reset code gets requested again. An invoice PDF is
// not disposable, and a refactor that dropped `attachments` from the one Resend
// call would still send a perfectly formed email saying "attached".
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
