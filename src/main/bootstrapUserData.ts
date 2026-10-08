import { join } from 'node:path'
import { InboxStateStore } from './inboxState'
import { ReadingProgressStore } from './readingProgress'
import { SettingsStore, defaultSettings } from './settings'
import { TicksStore } from './ticks'
import { legacyRightPanels, ViewStateStore } from './viewState'
import type { SettingsWriteFailure } from '../shared/ipc'

export interface UserDataStores {
  store: SettingsStore
  ticksStore: TicksStore
  inboxStore: InboxStateStore
  readingProgressStore: ReadingProgressStore
  viewStateStore: ViewStateStore
}

export function resolveUserDataOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['DTC_USER_DATA'] || undefined
}

export function bootstrapUserData(
  userDataDir: string,
  onSettingsWriteFailure: (failure: SettingsWriteFailure) => void = () => {}
): UserDataStores {
  const settingsPath = join(userDataDir, 'settings.json')
  const oldRightPanels = legacyRightPanels(settingsPath)
  const store = new SettingsStore(
    settingsPath,
    defaultSettings(),
    () => new Date().toISOString(),
    onSettingsWriteFailure
  )
  const ticksStore = new TicksStore(join(userDataDir, 'ticks.json'))
  const inboxStore = new InboxStateStore(join(userDataDir, 'inbox-state.json'))
  const readingProgressStore = new ReadingProgressStore(join(userDataDir, 'reading-progress.json'))
  const viewStateStore = new ViewStateStore(join(userDataDir, 'view-state.json'))
  viewStateStore.migrateRightPanels(oldRightPanels)
  return { store, ticksStore, inboxStore, readingProgressStore, viewStateStore }
}
