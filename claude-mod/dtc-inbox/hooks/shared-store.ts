/**
 * Every read this mod makes of its shared values in `$.store` (who filed which record, which
 * sessions are open, which release verdicts an agent has read), in the two ways they are read.
 * The store is shared by every session and can fail, so a value is one of three things: absent
 * (nobody wrote it), readable, or unreadable (the store failed, or what came back is not an
 * object). All three values are used for display only.
 *
 * - `held`: for a read–modify–write. Rejects when the store fails or the value is not an object,
 *   so a failed read never becomes an empty value that is then written back over the real one.
 *   Entries that are not well formed are dropped.
 * - `shown`: for display (the band, the pane). Never rejects: a value that cannot be read shows as
 *   empty. Nothing is written from it.
 */

import type { Registry } from './inbox'
import type { Sessions } from './presence'
import { heldAs, readRegistry, readSeen, readSessions } from './store'
import type { Seen } from './store'

/** The part of `$.store` this mod reads through. */
export type StoreReads = { get: (key: string) => Promise<unknown> }

type Reads = { registry: () => Promise<Registry>; sessions: () => Promise<Sessions>; seen: () => Promise<Seen> }
export type SharedState = { held: Reads; shown: Reads }

export function sharedStateOver(store: StoreReads): SharedState {
  /** Rejects when the store does. */
  const raw = async (key: string): Promise<unknown> => store.get(key)
  const shown = async <T>(key: string, read: (raw: unknown) => T): Promise<T> => {
    try {
      return read(await raw(key))
    } catch {
      return read(undefined)
    }
  }
  return {
    held: {
      registry: async () => heldAs('The registry', await raw('registry'), readRegistry),
      sessions: async () => heldAs('The presence records', await raw('sessions'), readSessions),
      seen: async () => heldAs('The seen marks', await raw('seen'), readSeen),
    },
    shown: {
      registry: () => shown('registry', readRegistry),
      sessions: () => shown('sessions', readSessions),
      seen: () => shown('seen', readSeen),
    },
  }
}
