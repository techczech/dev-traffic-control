/**
 * Stands in for the host's test kit (`claude-code/testing`) when the tests run under vitest.
 * `describe` and `expect` are vitest's. `test` is vitest's too, except that a test asking for the
 * host is skipped: one whose function takes parameters (`$`, `on`), or one given host options
 * (`{ options: … }`). Those run only under `claude plugin test`.
 */

import { describe, expect, test as vitestTest } from 'vitest'

type TestFn = (...args: never[]) => unknown

export const HOST_ONLY = 'needs the Claude Code host: run `claude plugin test`'

function test(name: string, ...rest: unknown[]): void {
  const fn = rest[rest.length - 1] as TestFn
  const needsHost = rest.length > 1 || typeof fn !== 'function' || fn.length > 0
  if (needsHost) vitestTest.skip(`${name} (${HOST_ONLY})`, () => undefined)
  else vitestTest(name, fn as () => unknown)
}

const hostOnly = (): never => {
  throw new Error(HOST_ONLY)
}

/** The host's mocks exist only in the host. */
const mock = { clock: hostOnly, store: hostOnly, env: hostOnly, session: hostOnly }

/** The host's test tiers mean nothing here. */
const tier = (): void => undefined

export { describe, expect, mock, test, tier }
