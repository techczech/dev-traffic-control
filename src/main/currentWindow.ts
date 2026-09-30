export interface LiveWindow {
  isDestroyed: () => boolean
}

/** Resolve every live window for every push; never retain a window snapshot. */
export function createAllWindowsSender<Window extends LiveWindow, Payload>(
  getWindows: () => Iterable<Window>,
  send: (window: Window, payload: Payload) => void
): (payload: Payload) => void {
  return (payload) => {
    let firstUnexpectedError: unknown
    for (const window of getWindows()) {
      if (window.isDestroyed()) continue
      try {
        send(window, payload)
      } catch (error) {
        if (!window.isDestroyed() && firstUnexpectedError === undefined) {
          firstUnexpectedError = error
        }
      }
    }
    if (firstUnexpectedError !== undefined) throw firstUnexpectedError
  }
}
