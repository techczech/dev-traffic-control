import type { ReadingProgress, ReadingProgressState } from '../shared/ipc'

type ReadingProgressInput = Omit<ReadingProgress, 'updatedAt'>

export interface ReadingProgressStoreLike {
  getAll: () => ReadingProgressState
  set: (requestPath: string, progress: ReadingProgressInput) => void
}

/** The narrow main-process boundary for app-local document reading position. */
export function createReadingProgressHandlers(store: ReadingProgressStoreLike): {
  get: () => ReadingProgressState
  set: (requestPath: string, progress: ReadingProgressInput) => ReadingProgress
} {
  return {
    get: () => store.getAll(),
    set(requestPath, progress) {
      store.set(requestPath, progress)
      return store.getAll()[requestPath]
    }
  }
}
