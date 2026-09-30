import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite } from './qa/atomicWrite'
import type { Settings, SettingsChange, SettingsWriteFailure } from '../shared/ipc'

export function defaultSettings(): Settings {
  return {
    qaRepoPath: join(homedir(), 'Documents', 'Dev Traffic Control'),
    appearance: 'light',
    readingTextSize: 'normal',
    pinBehaviour: 'remember',
    pinned: false,
    dockBadge: true,
    runnerMode: 'focus',
    widthPreset: 'narrow',
    windowMode: 'free',
    verdictLayout: 'one',
    reviewMargin: 'auto',
    keymap: {}
  }
}

interface StoreFile {
  settings: StoredSettings
  changelog: SettingsChange[]
}

type StoredSettings = Settings & Record<string, unknown>

interface PendingSet {
  id: number
  key: keyof Settings
  value: Settings[keyof Settings]
}

const SETTING_NAMES: Record<keyof Settings, string> = {
  qaRepoPath: 'Record folder',
  appearance: 'Appearance',
  readingTextSize: 'Request text size',
  pinBehaviour: 'Pin behaviour',
  pinned: 'Pin state',
  dockBadge: 'Dock badge',
  runnerMode: 'Runner layout',
  widthPreset: 'Window width',
  windowMode: 'Window placement',
  verdictLayout: 'Verdict sheet layout',
  reviewMargin: 'Review margin',
  keymap: 'Keyboard shortcuts'
}

/**
 * The only write path for {@link Settings}. Every change is appended to the
 * changelog and flushed atomically to the same JSON file, so the M5 settings
 * UI can render an honest, complete history from the first write.
 */
export class SettingsStore {
  private readonly filePath: string
  private readonly now: () => string
  private committedSettings: StoredSettings
  private committedChangelog: SettingsChange[]
  private settings: StoredSettings
  private changelog: SettingsChange[]
  private pendingSets: PendingSet[] = []
  private nextPendingSetId = 1
  private readonly freshlyCreated: boolean
  private readonly onWriteFailure: (failure: SettingsWriteFailure) => void
  /** Resolves once the most recent {@link set} has hit disk. */
  pendingWrite: Promise<void> = Promise.resolve()

  constructor(
    filePath: string,
    defaults: Settings,
    now: () => string = () => new Date().toISOString(),
    onWriteFailure: (failure: SettingsWriteFailure) => void = () => {}
  ) {
    this.filePath = filePath
    this.now = now
    this.onWriteFailure = onWriteFailure
    // Absent-at-construct is the honest first-run signal — onboarding hangs off it.
    this.freshlyCreated = !existsSync(filePath)
    const loaded = load(filePath, defaults)
    this.committedSettings = loaded.settings
    this.committedChangelog = loaded.changelog
    this.settings = { ...loaded.settings }
    this.changelog = [...loaded.changelog]
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  /** True only when no settings file existed when this store was constructed. */
  wasFreshlyCreated(): boolean {
    return this.freshlyCreated
  }

  log(): SettingsChange[] {
    return [...this.changelog]
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
    if (this.settings[key] === value) return this.get()
    const pending: PendingSet = {
      id: this.nextPendingSetId++,
      key,
      value
    }
    this.pendingSets.push(pending)
    this.refreshProjectedState()
    // Serialised on the previous write, so two un-awaited set() calls land in
    // call order rather than racing on the rename (same latent bug the M8
    // TicksStore fix closed).
    const commit = this.enqueueSet(key, value, pending.id)
    this.pendingWrite = commit.then(
      () => undefined,
      () => undefined
    )
    return this.get()
  }

  async setTransactional<K extends keyof Settings>(key: K, value: Settings[K]): Promise<Settings> {
    // Always join the ordered chain. A matching projected value may belong to
    // an earlier plain set whose disk write can still fail.
    const commit = this.enqueueSet(key, value)
    this.pendingWrite = commit.then(
      () => undefined,
      () => undefined
    )
    return commit
  }

  /** Wait until every settings change accepted so far has finished writing. */
  flush(): Promise<void> {
    return this.pendingWrite
  }

  private enqueueSet<K extends keyof Settings>(
    key: K,
    value: Settings[K],
    pendingId?: number
  ): Promise<Settings> {
    return this.pendingWrite.then(async () => {
      if (this.committedSettings[key] === value) {
        if (pendingId !== undefined) this.removePendingSet(pendingId)
        else this.refreshProjectedState()
        return this.get()
      }
      const change: SettingsChange = {
        key,
        from: this.committedSettings[key],
        to: value,
        at: this.now()
      }
      const settings = { ...this.committedSettings, [key]: value }
      const changelog = [...this.committedChangelog, change]
      try {
        await atomicWrite(this.filePath, serialise(settings, changelog))
        this.committedSettings = settings
        this.committedChangelog = changelog
      } catch (error) {
        if (pendingId !== undefined) this.removePendingSet(pendingId)
        else this.refreshProjectedState()
        this.reportWriteFailure(key)
        throw error
      }
      if (pendingId !== undefined) this.removePendingSet(pendingId)
      else this.refreshProjectedState()
      return this.get()
    })
  }

  private reportWriteFailure(key: keyof Settings): void {
    try {
      this.onWriteFailure({
        key,
        message: `Could not save ${SETTING_NAMES[key]}. The previous value is still in use.`
      })
    } catch (error) {
      console.error('Could not report a settings write failure', error)
    }
  }

  private removePendingSet(id: number): void {
    this.pendingSets = this.pendingSets.filter((pending) => pending.id !== id)
    this.refreshProjectedState()
  }

  private refreshProjectedState(): void {
    const settings = { ...this.committedSettings }
    const changelog = [...this.committedChangelog]
    for (const pending of this.pendingSets) {
      if (settings[pending.key] === pending.value) continue
      Object.assign(settings, { [pending.key]: pending.value })
    }
    this.settings = settings
    this.changelog = changelog
  }
}

function load(filePath: string, defaults: Settings): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoreFile>
    const stored = isRecord(parsed.settings) ? parsed.settings : {}
    const settings = { ...stored, ...defaults } as StoredSettings
    for (const key of Object.keys(defaults) as Array<keyof Settings>) {
      Object.assign(settings, { [key]: normaliseSetting(key, stored[key], defaults[key]) })
    }
    return {
      settings,
      changelog: Array.isArray(parsed.changelog) ? parsed.changelog.filter(isSettingsChange) : []
    }
  } catch {
    return { settings: { ...defaults }, changelog: [] }
  }
}

function normaliseSetting<K extends keyof Settings>(
  key: K,
  value: unknown,
  fallback: Settings[K]
): Settings[K] {
  const choices: Partial<Record<keyof Settings, readonly unknown[]>> = {
    appearance: ['light', 'dark', 'system'],
    readingTextSize: ['normal', 'large', 'extra-large'],
    pinBehaviour: ['remember', 'always'],
    runnerMode: ['focus', 'list'],
    widthPreset: ['narrow', 'wide'],
    windowMode: ['free', 'docked'],
    verdictLayout: ['one', 'all'],
    reviewMargin: ['auto', 'open', 'collapsed']
  }
  if (choices[key]) return (choices[key]!.includes(value) ? value : fallback) as Settings[K]
  if (key === 'qaRepoPath') return (typeof value === 'string' ? value : fallback) as Settings[K]
  if (key === 'pinned' || key === 'dockBadge') {
    return (typeof value === 'boolean' ? value : fallback) as Settings[K]
  }
  if (key === 'keymap') {
    if (!isRecord(value)) return fallback
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    ) as Settings[K]
  }
  return fallback
}

function serialise(settings: StoredSettings, changelog: SettingsChange[]): string {
  return JSON.stringify({ settings, changelog }, null, 2) + '\n'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSettingsChange(value: unknown): value is SettingsChange {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'from') &&
    Object.prototype.hasOwnProperty.call(value, 'to') &&
    typeof value.at === 'string'
  )
}
