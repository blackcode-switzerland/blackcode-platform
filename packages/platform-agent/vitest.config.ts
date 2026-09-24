import { defineConfig } from 'vitest/config'

// Unit tests for this package's own logic. `test/`, not `src/`, for the same
// reason as packages/platform-api: the isolation scanner reads
// `packages/platform-*/src`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
