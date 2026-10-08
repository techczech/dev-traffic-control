import {
  examplePresent,
  openExample,
  removeExample
} from './exampleProject'
import type { ExampleOpenResult, ExampleRemoveResult } from '../shared/example'

export interface ExampleHandlerDeps {
  recordRoot: () => string
  /** The bundled `resources/example-app/` folder. */
  sourceDir: () => string
  /** Rescan the record so the renderer sees the change before the reply. */
  refresh: () => Promise<void>
}

/**
 * The main-process boundary for the example project. The renderer
 * names nothing: the target is always `<record root>/example-app/`, so no
 * renderer-supplied path reaches the file system.
 */
export function createExampleHandlers(deps: ExampleHandlerDeps): {
  open: () => Promise<ExampleOpenResult>
  remove: () => Promise<ExampleRemoveResult>
  present: () => Promise<boolean>
} {
  return {
    async open() {
      const result = await openExample(deps.recordRoot(), deps.sourceDir())
      if (result.kind === 'installed') await deps.refresh().catch(() => undefined)
      return result
    },
    async remove() {
      const result = await removeExample(deps.recordRoot())
      if (result.kind === 'removed') await deps.refresh().catch(() => undefined)
      return result
    },
    present: () => examplePresent(deps.recordRoot())
  }
}
