import { readFileSync } from 'node:fs'
import { atomicWrite } from './qa/atomicWrite'
import type { Settings, ViewState } from '../shared/ipc'
import {
  normaliseRememberedSurfaces,
  normaliseWindowScope,
  rememberProjectSurface,
  scopeProject,
  type WindowScope,
  type WindowScopeState
} from '../shared/windowScope'
import type { WindowBounds } from './windowLayout'
import { isRememberedDockPlace, type RememberedDockPlace } from './dockPlaces'

export type WindowLayoutPreferences = Pick<Settings, 'pinned' | 'widthPreset' | 'windowMode'>

export interface PersistedWindowState {
  slot: string
  bounds?: WindowBounds
  layout: WindowLayoutPreferences
  rightPanels: ViewState['rightPanels']
  /** Absent while the window has never been scoped; see `shared/windowScope`. */
  scope?: WindowScope
  /** Omitted while empty so an unscoped window's record stays as it was. */
  lastSurfaceByProject?: Record<string, string>
}

const DEFAULT_LAYOUT: WindowLayoutPreferences = {
  pinned: false,
  widthPreset: 'narrow',
  windowMode: 'free'
}

export class ViewStateStore {
  private windows: PersistedWindowState[]
  private legacyPanels: ViewState['rightPanels']
  private receiptsStartAt: string | undefined
  /** The Dock button's last-used place (ticket 27), app-wide, across launches. */
  private dockPlace: RememberedDockPlace | undefined
  pendingWrite: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {
    const loaded = load(filePath)
    this.windows = loaded.windows
    this.legacyPanels = loaded.legacyPanels
    this.receiptsStartAt = loaded.receiptsStartAt
    this.dockPlace = loaded.dockPlace
  }

  getDockPlace(): RememberedDockPlace | null {
    return this.dockPlace ? { ...this.dockPlace } : null
  }

  setDockPlace(place: RememberedDockPlace): void {
    this.dockPlace = { edge: place.edge, displayId: place.displayId }
    this.persist()
  }

  getReceiptsStartAt(): string | undefined {
    return this.receiptsStartAt
  }

  ensureReceiptsStartAt(at = new Date().toISOString()): string {
    if (this.receiptsStartAt) return this.receiptsStartAt
    this.receiptsStartAt = at
    this.persist()
    return at
  }

  get(slot = 'window-1'): ViewState {
    const window = this.windows.find((candidate) => candidate.slot === slot)
    return {
      rightPanels: {
        ...(window?.rightPanels ?? (slot === 'window-1' ? this.legacyPanels : {}))
      }
    }
  }

  getWindow(slot: string): PersistedWindowState | null {
    const found = this.windows.find((candidate) => candidate.slot === slot)
    return found ? structuredClone(found) : null
  }

  listWindows(): PersistedWindowState[] {
    return structuredClone(this.windows)
  }

  ensureWindow(
    slot: string,
    layout: WindowLayoutPreferences = DEFAULT_LAYOUT,
    bounds?: WindowBounds
  ): PersistedWindowState {
    const existing = this.getWindow(slot)
    if (existing) return existing
    const created: PersistedWindowState = {
      slot,
      ...(bounds ? { bounds: { ...bounds } } : {}),
      layout: { ...layout },
      rightPanels: this.windows.length === 0 ? { ...this.legacyPanels } : {}
    }
    this.legacyPanels = {}
    this.windows.push(created)
    this.persist()
    return structuredClone(created)
  }

  setWindowBounds(slot: string, bounds: WindowBounds): PersistedWindowState {
    const window = this.mutableWindow(slot)
    window.bounds = { ...bounds }
    this.persist()
    return structuredClone(window)
  }

  setWindowLayout(slot: string, layout: WindowLayoutPreferences): PersistedWindowState {
    const window = this.mutableWindow(slot)
    window.layout = { ...layout }
    this.persist()
    return structuredClone(window)
  }

  /** The window's scope and its per-project landing surfaces, as persisted. */
  getWindowScope(slot: string): WindowScopeState {
    const window = this.windows.find((candidate) => candidate.slot === slot)
    return scopeState(window)
  }

  setWindowScope(slot: string, scope: WindowScope): WindowScopeState {
    const window = this.mutableWindow(slot)
    window.scope =
      scope.kind === 'project' ? { kind: 'project', slug: scope.slug } : { kind: 'all' }
    this.persist()
    return scopeState(window)
  }

  /**
   * Files the surface under the project the window is scoped to, so returning
   * to that project lands where he left it. A no-op under *All projects*.
   */
  rememberSurfaceInScope(slot: string, surface: string): WindowScopeState {
    const window = this.mutableWindow(slot)
    const project = scopeProject(window.scope)
    if (!project) return scopeState(window)
    window.lastSurfaceByProject = rememberProjectSurface(
      window.lastSurfaceByProject ?? {},
      project,
      surface
    )
    this.persist()
    return scopeState(window)
  }

  removeWindow(slot: string): void {
    const next = this.windows.filter((window) => window.slot !== slot)
    if (next.length === this.windows.length) return
    this.windows = next
    this.persist()
  }

  /** Wait until every window-state change accepted so far has finished writing. */
  flush(): Promise<void> {
    return this.pendingWrite
  }

  setRightPanels(rightPanels: ViewState['rightPanels'], slot = 'window-1'): ViewState {
    const window = this.mutableWindow(slot)
    window.rightPanels = { ...rightPanels }
    this.persist()
    return this.get(slot)
  }

  migrateRightPanels(value: unknown): void {
    const rightPanels = normalisePanels(value)
    if (Object.keys(rightPanels).length === 0) return
    const existing = this.windows[0]
    if (existing && Object.keys(existing.rightPanels).length > 0) return
    if (!existing) {
      this.legacyPanels = rightPanels
      return
    }
    existing.rightPanels = rightPanels
    this.persist()
  }

  private mutableWindow(slot: string): PersistedWindowState {
    let window = this.windows.find((candidate) => candidate.slot === slot)
    if (!window) {
      window = {
        slot,
        layout: { ...DEFAULT_LAYOUT },
        rightPanels: this.windows.length === 0 ? { ...this.legacyPanels } : {}
      }
      this.legacyPanels = {}
      this.windows.push(window)
    }
    return window
  }

  private persist(): void {
    const payload =
      JSON.stringify(
        {
          windows: this.windows,
          ...(this.receiptsStartAt ? { receiptsStartAt: this.receiptsStartAt } : {}),
          ...(this.dockPlace ? { dockPlace: this.dockPlace } : {})
        },
        null,
        2
      ) + '\n'
    this.pendingWrite = this.pendingWrite
      .catch(() => {})
      .then(() => atomicWrite(this.filePath, payload))
  }
}

export function legacyRightPanels(settingsPath: string): unknown {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    const settings = parsed.settings
    return typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>).rightPanels
      : undefined
  } catch {
    return undefined
  }
}

function load(filePath: string): {
  windows: PersistedWindowState[]
  legacyPanels: ViewState['rightPanels']
  receiptsStartAt?: string
  dockPlace?: RememberedDockPlace
} {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    if (Array.isArray(parsed.windows)) {
      return {
        windows: parsed.windows.flatMap((value) => {
          const window = normaliseWindow(value)
          return window ? [window] : []
        }),
        legacyPanels: {},
        receiptsStartAt: isTimestamp(parsed.receiptsStartAt) ? parsed.receiptsStartAt : undefined,
        dockPlace: isRememberedDockPlace(parsed.dockPlace) ? parsed.dockPlace : undefined
      }
    }
    return {
      windows: [],
      legacyPanels: normalisePanels(parsed.rightPanels),
      receiptsStartAt: isTimestamp(parsed.receiptsStartAt) ? parsed.receiptsStartAt : undefined
    }
  } catch {
    return { windows: [], legacyPanels: {} }
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))
}

function normaliseWindow(value: unknown): PersistedWindowState | null {
  if (!isRecord(value) || typeof value.slot !== 'string' || !isRecord(value.layout)) return null
  const widthPreset = value.layout.widthPreset
  const windowMode = value.layout.windowMode
  const pinned = value.layout.pinned
  if (
    typeof pinned !== 'boolean' ||
    (widthPreset !== 'narrow' && widthPreset !== 'wide') ||
    (windowMode !== 'free' && windowMode !== 'docked')
  ) {
    return null
  }
  const bounds = normaliseBounds(value.bounds)
  const scope = normaliseWindowScope(value.scope)
  const lastSurfaceByProject = normaliseRememberedSurfaces(value.lastSurfaceByProject)
  return {
    slot: value.slot,
    ...(bounds ? { bounds } : {}),
    layout: { pinned, widthPreset, windowMode },
    rightPanels: normalisePanels(value.rightPanels),
    ...(scope ? { scope } : {}),
    ...(Object.keys(lastSurfaceByProject).length > 0 ? { lastSurfaceByProject } : {})
  }
}

function scopeState(window: PersistedWindowState | undefined): WindowScopeState {
  return {
    ...(window?.scope ? { scope: structuredClone(window.scope) } : {}),
    lastSurfaceByProject: { ...(window?.lastSurfaceByProject ?? {}) }
  }
}

function normaliseBounds(value: unknown): WindowBounds | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height } = value
  return [x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part)) &&
    (width as number) > 0 &&
    (height as number) > 0
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : undefined
}

function normalisePanels(value: unknown): ViewState['rightPanels'] {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, 'closed' | 'inspector' | 'ledger'] =>
        entry[1] === 'closed' || entry[1] === 'inspector' || entry[1] === 'ledger'
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
