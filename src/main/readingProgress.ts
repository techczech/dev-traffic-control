import { readFileSync } from 'node:fs'
import type { ReadingProgress, ReadingProgressState } from '../shared/ipc'
import { atomicWrite } from './qa/atomicWrite'

type ReadingProgressInput = Omit<ReadingProgress, 'updatedAt'>

export class ReadingProgressStore {
  private readonly filePath: string
  private readonly now: () => string
  private state: ReadingProgressState
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    this.filePath = filePath
    this.now = now
    this.state = load(filePath)
  }

  getAll(): ReadingProgressState {
    return structuredClone(this.state)
  }

  get(requestPath: string): ReadingProgress | null {
    const progress = this.state[requestPath]
    return progress ? { ...progress } : null
  }

  set(requestPath: string, progress: ReadingProgressInput): void {
    this.state = {
      ...this.state,
      [requestPath]: { ...progress, updatedAt: this.now() }
    }
    const payload = `${JSON.stringify(this.state, null, 2)}\n`
    this.pendingWrite = this.pendingWrite
      .catch(() => {})
      .then(() => atomicWrite(this.filePath, payload))
  }

  flush(): Promise<void> {
    return this.pendingWrite
  }
}

function load(filePath: string): ReadingProgressState {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const state: ReadingProgressState = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isReadingProgress(value)) state[key] = value
    }
    return state
  } catch {
    return {}
  }
}

function isReadingProgress(value: unknown): value is ReadingProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const progress = value as Record<string, unknown>
  return (
    typeof progress.sectionSlug === 'string' &&
    Number.isInteger(progress.sectionIndex) &&
    (progress.sectionIndex as number) >= 0 &&
    Number.isInteger(progress.sectionCount) &&
    (progress.sectionCount as number) >= 0 &&
    typeof progress.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(progress.updatedAt))
  )
}
