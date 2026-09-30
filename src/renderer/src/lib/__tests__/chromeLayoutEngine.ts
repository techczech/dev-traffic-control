import { createRequire } from 'node:module'
import { beforeEach } from 'vitest'

const engine = createRequire(import.meta.url)('./fixtures/chromeLayoutEngine.cjs') as {
  chromeMissingReason: () => string | undefined
}

/**
 * Skips every test in the calling file, with the reason, when Google Chrome is
 * absent. The geometry fixtures lay the app's stylesheets out in real Chrome;
 * without it there is nothing to measure, which is a skip, not a failure.
 * Call once at the top level of a layout test file.
 */
export function skipWithoutChrome(guard: string): void {
  const reason = engine.chromeMissingReason()
  if (!reason) return
  process.stderr.write(`Skipping the ${guard}: ${reason}\n`)
  beforeEach((context) => context.skip(reason))
}
