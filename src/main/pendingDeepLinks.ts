import type { DeepLinkArrival } from './deepLinkResolve'

/** A link that has been through both gates and is waiting for a renderer. */
export interface HeldDeepLink {
  url: string
  arrival: DeepLinkArrival
  /** The app was not running when the link arrived (mockup state 20). */
  coldLaunch: boolean
}

/**
 * Where a link waits between arriving and being applied.
 *
 * There is no way around holding it. A `webContents.send` into a renderer that
 * has not mounted is dropped **silently**, and on a cold launch `open-url`
 * fires before `app.whenReady()` — so a pushed link would fail exactly one time
 * in one and look like a race (mechanism.md § 2). The renderer therefore pulls:
 * main holds the link against the window's slot, and the first renderer to
 * mount in that slot claims it.
 *
 * Two holding places, because a link can arrive before there is a slot to hold
 * it against:
 *
 * - `holdUntilReady` — the app is not ready, so no window and no slot exists.
 * - `holdForSlot` — a window is being created for this link.
 *
 * A claim clears. A link is applied once, never re-applied by a reload.
 */
export class PendingDeepLinks {
  private readonly beforeReady: string[] = []
  private readonly bySlot = new Map<string, HeldDeepLink>()

  /** A URL that arrived before `app.whenReady()` — the cold-launch case. */
  holdUntilReady(url: string): void {
    this.beforeReady.push(url)
  }

  /** Every URL held before the app was ready, in arrival order. Clears. */
  takeHeldUntilReady(): string[] {
    return this.beforeReady.splice(0, this.beforeReady.length)
  }

  hasHeldUntilReady(): boolean {
    return this.beforeReady.length > 0
  }

  holdForSlot(slot: string, held: HeldDeepLink): void {
    this.bySlot.set(slot, held)
  }

  /** The link this slot's window was born for. Clears, so it applies once. */
  claim(slot: string): HeldDeepLink | null {
    const held = this.bySlot.get(slot) ?? null
    this.bySlot.delete(slot)
    return held
  }

  /** The window went away before its renderer ever asked. */
  forget(slot: string): void {
    this.bySlot.delete(slot)
  }
}

/**
 * The window rule, settled by Dominik on 2026-09-11 and stated once here.
 *
 * **Running ⇒ a NEW window. Not running ⇒ the main window.** A link never
 * touches a window that already exists: no scope change, no navigation, no
 * focus taken away from what it was showing. So there is no "which window"
 * question to answer and no way for a link to cost him the place he was in.
 */
export type DeepLinkRoute = 'new-window' | 'reopened-window'

export function deepLinkRoute(liveWindowCount: number): DeepLinkRoute {
  return liveWindowCount > 0 ? 'new-window' : 'reopened-window'
}
