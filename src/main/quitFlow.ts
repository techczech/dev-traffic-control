interface QuitApp {
  quit(): void
}

export function createWindowAllClosedHandler(platform: NodeJS.Platform, app: QuitApp): () => void {
  return (): void => {
    if (platform !== 'darwin') app.quit()
  }
}

interface QuitResources {
  stop(): Promise<void>
  flush?(): Promise<void>
}

interface QuitEvent {
  preventDefault(): void
}

interface QuitLogger {
  error(message: string, error?: unknown): void
}

export function createWillQuitHandler(
  app: QuitApp,
  resources: QuitResources,
  options: { timeoutMs?: number; logger?: QuitLogger } = {}
): (event: QuitEvent) => void {
  const timeoutMs = options.timeoutMs ?? 5_000
  const logger = options.logger ?? console
  let quitting = false

  return (event): void => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        let stop: Promise<void>
        let flush: Promise<void>
        try {
          stop = resources.stop()
        } catch (error) {
          stop = Promise.reject(error)
        }
        try {
          flush = resources.flush?.() ?? Promise.resolve()
        } catch (error) {
          flush = Promise.reject(error)
        }
        const shutdown = Promise.allSettled([stop, flush]).then(([serviceResult, flushResult]) => {
          if (serviceResult.status === 'rejected') {
            logger.error('Record service could not finish shutdown cleanly', serviceResult.reason)
          }
          if (flushResult.status === 'rejected') {
            logger.error('App state could not finish saving before quit', flushResult.reason)
          }
        })
        await Promise.race([
          shutdown,
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              logger.error(`Shutdown timed out after ${timeoutMs} ms; quitting anyway`)
              resolve()
            }, timeoutMs)
          })
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
        app.quit()
      }
    })()
  }
}
