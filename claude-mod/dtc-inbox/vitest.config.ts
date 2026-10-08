import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// The mod's own tests, run without the Claude Code host. `claude-code/testing` (the host's test kit)
// is answered by a small shim over vitest; a test that asks for the host (`$`, `on`) is skipped
// here and runs under `claude plugin test`. `node-tests/` holds the tests that need a real file
// system and a real process, which the host's test sandbox does not give.
export default defineConfig({
  resolve: {
    alias: { 'claude-code/testing': fileURLToPath(new URL('./dev/testing-shim.ts', import.meta.url)) },
  },
  test: {
    include: ['hooks/**/*.test.ts', 'node-tests/**/*.spec.ts'],
    environment: 'node',
  },
})
