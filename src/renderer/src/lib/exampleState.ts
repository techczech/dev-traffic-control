import { useEffect, useSyncExternalStore } from 'react'

/**
 * Whether the example project's marker is on disk. Main is the only
 * judge: the renderer never infers it from the snapshot, because a not-yet-scanned
 * or empty example is still an example. `null` means main has not answered yet.
 *
 * Asked on mount, on window focus (the folder can change outside the app), and
 * by whoever just opened or removed the example.
 */
let present: boolean | null = null
const listeners = new Set<() => void>()

function publish(next: boolean | null): void {
  if (next === present) return
  present = next
  listeners.forEach((listener) => listener())
}

let latest = 0

/** Ask main now. A failed ask counts as "not present" so the button never lies about a marker. */
export async function refreshExample(): Promise<boolean> {
  const ticket = ++latest
  let value = false
  try {
    value = await window.qa.examplePresent()
  } catch {
    value = false
  }
  if (ticket === latest) publish(value)
  return value
}

/** Tests only. */
export function resetExampleState(): void {
  latest++
  publish(null)
}

/** The marker's presence, kept fresh on mount and on window focus. */
export function useExamplePresent(): boolean | null {
  useEffect(() => {
    void refreshExample()
    const onFocus = (): void => void refreshExample()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => present
  )
}

export type GetStartedButtonState = 'get-started' | 'remove-example' | 'hidden'

/**
 * The title-bar button's three states. Hidden until settings and main have both
 * answered, so an install that has the example never flashes "Get started".
 */
export function getStartedButtonState(
  retired: boolean | undefined,
  examplePresent: boolean | null
): GetStartedButtonState {
  if (retired === undefined || retired || examplePresent === null) return 'hidden'
  return examplePresent ? 'remove-example' : 'get-started'
}
