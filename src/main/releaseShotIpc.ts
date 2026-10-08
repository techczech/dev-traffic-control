import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { listConfined, readConfined, recordRelative } from './confinedFs'
import { confinedSegments, shotsFolderIsConfined } from './confinement'
import { verdictShotFeature, type ReleaseRecord } from './qa/releaseRecords'
import { nextShotPath, saveShot, shotsDirFor } from './qa/shots'
import type { QaSnapshot } from '../shared/ipc'

export interface ReleaseShotDeps {
  recordRoot: () => string
  snapshot: () => Pick<QaSnapshot, 'releases'> | null
}

export interface ReleaseShotHandlers {
  /** Stores one PNG for a verdict; the project-relative path, or `null` when refused. */
  add: (input: unknown) => Promise<string | null>
  /** One verdict picture as a `data:` URL, or `null` when refused or missing. */
  read: (input: unknown) => Promise<string | null>
}

/**
 * The main-process boundary for verdict pictures. A picture is
 * written only to `<project>/releases/<version>.shots/<feature-id>-<n>.png`:
 * the project and the release version must be a release record in the current
 * snapshot, the feature id one of that release's features waiting on the reviewer's
 * verdict, the `releases/` folder a real folder inside the record root and the
 * shots folder absent or a real folder below it, and the file itself is
 * created exclusively (`saveShot`'s `wx`). Reading a picture is confined the
 * same way: the path must follow the verdict-picture grammar, name a feature
 * of that release, and resolve inside the root through no symlink. A refused
 * call returns `null` and reads and writes nothing.
 */
export function createReleaseShotHandlers(deps: ReleaseShotDeps): ReleaseShotHandlers {
  const releaseRecord = (project: unknown, version: unknown): ReleaseRecord | null => {
    if (typeof project !== 'string' || typeof version !== 'string') return null
    const release = deps
      .snapshot()
      ?.releases.find((candidate) => candidate.kind === 'recorded' && candidate.project === project)
    if (!release || release.kind !== 'recorded') return null
    const record =
      release.versions.find((candidate) => candidate.version === version)?.record ??
      (release.record.version === version ? release.record : undefined)
    return record && record.version === version ? record : null
  }

  // The record's own `releases/` folder, a real folder at `<project>/releases`.
  const releasesFolder = async (project: string, record: ReleaseRecord): Promise<string | null> => {
    const folder = path.dirname(record.path)
    const segments = await confinedSegments(deps.recordRoot(), folder)
    if (!segments || segments.length !== 2) return null
    if (segments[0] !== project || segments[1] !== 'releases') return null
    try {
      return (await lstat(folder)).isDirectory() ? folder : null
    } catch {
      return null
    }
  }

  return {
    async add(input) {
      if (typeof input !== 'object' || input === null) return null
      const { project, version, id, pngBase64 } = input as Record<string, unknown>
      const record = releaseRecord(project, version)
      if (!record || typeof id !== 'string' || typeof pngBase64 !== 'string') return null
      const feature = record.features.find((candidate) => candidate.id === id)
      if (!feature || feature.kind !== 'feature' || feature.declaredState !== 'you') return null
      const folder = await releasesFolder(project as string, record)
      if (!folder) return null
      const png = Buffer.from(pngBase64, 'base64')
      if (png.length === 0) return null
      const dir = shotsDirFor(path.join(folder, record.version))
      if (!(await shotsFolderIsConfined(deps.recordRoot(), dir))) return null
      const root = deps.recordRoot()
      let existing: string[] = []
      try {
        existing = (await listConfined(root, await recordRelative(root, dir))).map(
          (entry) => entry.name
        )
      } catch (error) {
        // The first picture creates the folder; anything else is a refusal.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      }
      const written = await saveShot(nextShotPath(dir, id, existing), png, root)
      return `releases/${path.basename(dir)}/${path.basename(written)}`
    },

    async read(input) {
      if (typeof input !== 'object' || input === null) return null
      const { project, version, rel } = input as Record<string, unknown>
      const record = releaseRecord(project, version)
      if (!record) return null
      const id = verdictShotFeature(record.version, rel)
      if (!id || !record.features.some((f) => f.id === id && f.kind === 'feature')) return null
      const folder = await releasesFolder(project as string, record)
      if (!folder) return null
      const file = path.join(path.dirname(folder), ...(rel as string).split('/'))
      if (!(await confinedSegments(deps.recordRoot(), file))) return null
      try {
        const root = deps.recordRoot()
        const data = await readConfined(root, await recordRelative(root, file))
        return `data:image/png;base64,${data.toString('base64')}`
      } catch {
        return null
      }
    }
  }
}
