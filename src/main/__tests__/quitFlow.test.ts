import { beforeEach, expect, test, vi } from 'vitest'
import { createWillQuitHandler } from '../quitFlow'
import * as quitFlow from '../quitFlow'

function harness(
  stop: () => Promise<void>,
  timeoutMs = 5_000,
  flush: () => Promise<void> = async () => {}
): {
  app: { quit: ReturnType<typeof vi.fn> }
  logger: { error: ReturnType<typeof vi.fn> }
  handler: ReturnType<typeof createWillQuitHandler>
} {
  const app = { quit: vi.fn() }
  const logger = { error: vi.fn() }
  const resources = { stop, flush }
  const handler = createWillQuitHandler(app, resources, { timeoutMs, logger })
  return { app, logger, handler }
}

beforeEach(() => vi.useRealTimers())

test.each(['win32', 'linux'] as const)(
  'closing the last window starts the bounded quit flow on %s',
  (platform) => {
    const app = { quit: vi.fn() }
    const createHandler = (
      quitFlow as unknown as {
        createWindowAllClosedHandler?: (
          platform: NodeJS.Platform,
          app: { quit(): void }
        ) => () => void
      }
    ).createWindowAllClosedHandler

    createHandler?.(platform, app)()

    expect(app.quit).toHaveBeenCalledOnce()
  }
)

test('closing the last window keeps the process alive on darwin', () => {
  const app = { quit: vi.fn() }
  const createHandler = (
    quitFlow as unknown as {
      createWindowAllClosedHandler?: (
        platform: NodeJS.Platform,
        app: { quit(): void }
      ) => () => void
    }
  ).createWindowAllClosedHandler

  createHandler?.('darwin', app)()

  expect(app.quit).not.toHaveBeenCalled()
})

test('quit waits for service shutdown once and the guard prevents re-entry', async () => {
  let resolveStop!: () => void
  const stop = vi.fn(() => new Promise<void>((resolve) => (resolveStop = resolve)))
  const { app, handler } = harness(stop)
  const first = { preventDefault: vi.fn() }
  const second = { preventDefault: vi.fn() }

  handler(first)
  handler(second)
  expect(first.preventDefault).toHaveBeenCalledOnce()
  expect(second.preventDefault).not.toHaveBeenCalled()
  expect(stop).toHaveBeenCalledOnce()

  resolveStop()
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
})

test('quit waits for pending local-store flushes as well as service shutdown', async () => {
  let resolveFlush!: () => void
  const flush = vi.fn(() => new Promise<void>((resolve) => (resolveFlush = resolve)))
  const { app, handler } = harness(async () => {}, 5_000, flush)

  handler({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
  expect(app.quit).not.toHaveBeenCalled()

  resolveFlush()
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
})

test('quit proceeds after the shutdown timeout', async () => {
  vi.useFakeTimers()
  const { app, logger, handler } = harness(() => new Promise<void>(() => {}), 5_000)

  handler({ preventDefault: vi.fn() })
  await vi.advanceTimersByTimeAsync(5_000)

  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/timed out/i))
  expect(app.quit).toHaveBeenCalledOnce()
})

test('quit proceeds when service shutdown rejects', async () => {
  const failure = new Error('stop failed')
  const { app, logger, handler } = harness(async () => {
    throw failure
  })

  handler({ preventDefault: vi.fn() })

  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
  expect(logger.error).toHaveBeenCalledWith(
    'Record service could not finish shutdown cleanly',
    failure
  )
})
