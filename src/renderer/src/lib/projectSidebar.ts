export interface RendererStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

/**
 * Retired by ADR-0016 § 1: Releases, Roadmap and Handoffs each kept their own
 * project in browser storage, which is how three surfaces came to disagree with
 * each other. They are deleted rather than migrated — the window scope is the
 * only answer to "which project" — and the values are cleared so a stale one
 * can never be read back by anything.
 */
export const RETIRED_PROJECT_SELECTION_KEYS = [
  'dtc.releases.selected-project.v1',
  'dtc.roadmap.selected-project.v1',
  'dtc.handoffs.project.v1'
] as const

export function forgetRetiredProjectSelections(storage: RendererStorage = rendererStorage()): void {
  for (const key of RETIRED_PROJECT_SELECTION_KEYS) {
    try {
      storage.removeItem?.(key)
    } catch {
      // A blocked local store simply keeps a value nothing reads any more.
    }
  }
}

export function readStoredFolds<Group extends string>(
  key: string,
  defaults: Record<Group, boolean>,
  storage: RendererStorage = rendererStorage()
): Record<Group, boolean> {
  const stored = readStoredRecord(storage, key, isBoolean)
  return Object.fromEntries(
    Object.entries(defaults).map(([group, open]) => [group, stored[group] ?? open])
  ) as Record<Group, boolean>
}

export function writeStoredFolds<Group extends string>(
  key: string,
  folds: Record<Group, boolean>,
  storage: RendererStorage = rendererStorage()
): void {
  writeStoredRecord(storage, key, folds)
}

export function readStoredRecord<T>(
  storage: RendererStorage,
  key: string,
  accepts: (value: unknown) => value is T
): Record<string, T> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, T] => accepts(entry[1]))
    )
  } catch {
    return {}
  }
}

export function writeStoredRecord<T>(
  storage: RendererStorage,
  key: string,
  value: Record<string, T>
): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // A blocked local store leaves the preference session-local; the surface remains usable.
  }
}

export function displayProjectName(project: string): string {
  return project
    .split('-')
    .filter(Boolean)
    .map((word) => `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

function rendererStorage(): RendererStorage {
  return localStorage
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}
