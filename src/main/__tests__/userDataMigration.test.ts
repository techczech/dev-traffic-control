import { readFileSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { migrateLegacyUserData } from '../userDataMigration'

const FILENAMES = [
  'settings.json',
  'ticks.json',
  'inbox-state.json',
  'reading-progress.json'
] as const

const LEGACY_BYTES: Record<(typeof FILENAMES)[number], Buffer> = {
  'settings.json': Buffer.from('{"settings":{"pinned":true},"changelog":[{"at":"old"}]}\r\n'),
  'ticks.json': Buffer.from('{\n  "run-one": [0, 2]\n}\n'),
  'inbox-state.json': Buffer.from('{"seen":["one"],"opened":["two"]}\n'),
  'reading-progress.json': Buffer.from(
    '{"redforge/review.md":{"sectionSlug":"journey-2","sectionIndex":1,"sectionCount":4,"updatedAt":"2026-08-07T01:45:00.000Z"}}\n'
  )
}

const temporaryParents: string[] = []

async function locations(): Promise<{
  parent: string
  oldDir: string
  newDir: string
}> {
  const parent = await mkdtemp(path.join(tmpdir(), 'dtc-user-data-'))
  temporaryParents.push(parent)
  return {
    parent,
    oldDir: path.join(parent, 'qa-probe'),
    newDir: path.join(parent, 'dev-traffic-control')
  }
}

async function writeLegacyFiles(oldDir: string): Promise<void> {
  await mkdir(oldDir, { recursive: true })
  await Promise.all(
    FILENAMES.map((filename) => writeFile(path.join(oldDir, filename), LEGACY_BYTES[filename]))
  )
}

async function checksums(dir: string): Promise<Record<(typeof FILENAMES)[number], string>> {
  return Object.fromEntries(
    await Promise.all(
      FILENAMES.map(async (filename) => {
        const bytes = await readFile(path.join(dir, filename))
        return [filename, createHash('sha256').update(bytes).digest('hex')]
      })
    )
  ) as Record<(typeof FILENAMES)[number], string>
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((parent) => rm(parent, { recursive: true, force: true }))
  )
})

describe('migrateLegacyUserData', () => {
  test('a fresh install migrates every app-local state file byte-identically', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)

    migrateLegacyUserData(newDir)

    for (const filename of FILENAMES) {
      expect(await readFile(path.join(newDir, filename))).toEqual(LEGACY_BYTES[filename])
    }
  })

  test('removes a stale temporary before publishing a complete final file', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    await mkdir(newDir, { recursive: true })
    const finalFile = path.join(newDir, 'settings.json')
    const temporaryFile = `${finalFile}.migrate-tmp-stale-process`
    await writeFile(temporaryFile, 'truncated')

    migrateLegacyUserData(newDir)

    expect(await readFile(finalFile)).toEqual(LEGACY_BYTES['settings.json'])
    await expect(stat(temporaryFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test("never removes an atomic writer's in-flight temporary", async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    await mkdir(newDir, { recursive: true })
    const writerTemporary = path.join(newDir, `ticks.json.tmp-${process.pid}`)
    const inFlightBytes = Buffer.from('in-flight tick write')
    await writeFile(writerTemporary, inFlightBytes)

    migrateLegacyUserData(newDir)

    expect(await readFile(writerTemporary)).toEqual(inFlightBytes)
    expect(await readFile(path.join(newDir, 'ticks.json'))).toEqual(LEGACY_BYTES['ticks.json'])
  })

  test('removes its stale temporary even after the legacy source has gone', async () => {
    const { newDir } = await locations()
    await mkdir(newDir, { recursive: true })
    const temporaryFile = path.join(newDir, 'settings.json.migrate-tmp-stale-process')
    await writeFile(temporaryFile, 'truncated')

    migrateLegacyUserData(newDir)

    await expect(stat(temporaryFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(newDir, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('never publishes a partial final file when copying is interrupted', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    const finalFile = path.join(newDir, 'settings.json')

    migrateLegacyUserData(
      newDir,
      () => {},
      (source, destination) => {
        const sourceBytes = readFileSync(source)
        writeFileSync(destination, sourceBytes.subarray(0, Math.floor(sourceBytes.length / 2)))
        throw new Error('simulated interrupted copy')
      }
    )

    await expect(stat(finalFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('leaves every legacy file byte-for-byte untouched', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    const before = await checksums(oldDir)

    migrateLegacyUserData(newDir)

    expect(await checksums(oldDir)).toEqual(before)
  })

  test('an existing new-location file is never overwritten', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    await mkdir(newDir, { recursive: true })
    const existing = Buffer.from('{"settings":{"appearance":"dark"},"changelog":[]}\n')
    await writeFile(path.join(newDir, 'settings.json'), existing)

    migrateLegacyUserData(newDir)

    expect(await readFile(path.join(newDir, 'settings.json'))).toEqual(existing)
    expect(await readFile(path.join(newDir, 'ticks.json'))).toEqual(LEGACY_BYTES['ticks.json'])
  })

  test('a second run changes nothing', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    migrateLegacyUserData(newDir)
    const firstCopies = await Promise.all(
      FILENAMES.map((filename) => readFile(path.join(newDir, filename)))
    )

    await Promise.all(
      FILENAMES.map((filename) => writeFile(path.join(oldDir, filename), Buffer.from('changed')))
    )
    migrateLegacyUserData(newDir)

    const secondCopies = await Promise.all(
      FILENAMES.map((filename) => readFile(path.join(newDir, filename)))
    )
    expect(secondCopies).toEqual(firstCopies)
  })

  test('a missing old directory is a silent no-op', async () => {
    const { newDir } = await locations()

    expect(() => migrateLegacyUserData(newDir)).not.toThrow()
    await expect(stat(newDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('an unreadable old directory does not throw out of the migration', async () => {
    const { oldDir, newDir } = await locations()
    await writeLegacyFiles(oldDir)
    await chmod(oldDir, 0o000)

    try {
      expect(() => migrateLegacyUserData(newDir)).not.toThrow()
    } finally {
      await chmod(oldDir, 0o700)
    }
  })
})
