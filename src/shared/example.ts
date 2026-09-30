/** Shared by main, preload and renderer: the example project's fixed names and result shapes (ticket 34). */

export const EXAMPLE_SLUG = 'example-app'
export const EXAMPLE_MARKER = '.dtc-example.json'

export type ExampleOpenRefusal = 'no-root' | 'folder-exists' | 'no-source' | 'write-failed'
export type ExampleRemoveRefusal = 'no-root' | 'absent' | 'not-example' | 'remove-failed'

export type ExampleOpenResult =
  | { kind: 'installed'; slug: string }
  | { kind: 'present'; slug: string }
  | { kind: 'refused'; reason: ExampleOpenRefusal }

export type ExampleRemoveResult =
  | { kind: 'removed' }
  | { kind: 'refused'; reason: ExampleRemoveRefusal }
