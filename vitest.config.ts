import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Runs before each test file is imported — see src/test-setup.ts. Without
    // it the suite writes to the production database.
    setupFiles: ['src/test-setup.ts'],
  },
})
