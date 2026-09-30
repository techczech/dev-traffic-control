import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createNoteHandlers } from '../noteIpc'
import type { NoteDoc, QaSnapshot } from '../../shared/ipc'

const NOW = '2026-09-28T10:00:00.000Z'
const PNG = Buffer.from('fake png bytes').toString('base64')
const VICTIM = 'victim contents\n'

let parent: string
let root: string
let project: string
let round: string
let scannedNote: string
let outside: string
let victim: string

beforeEach(async () => {
  parent = realpathSync(await mkdtemp(path.join(tmpdir(), 'dtc-note-ipc-')))
  root = path.join(parent, '_REC')
  project = path.join(root, 'demo')
  round = path.join(project, 'round-1')
  outside = path.join(parent, 'elsewhere')
  scannedNote = path.join(project, '2026-09-27-note-scanned.md')
  victim = path.join(outside, '2026-09-27-note-victim.md')
  await mkdir(round, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(scannedNote, '---\ntitle: "Scanned"\n---\n\nbody\n')
  await writeFile(victim, VICTIM)
})

function handlers(notes: string[] | null = [scannedNote]): ReturnType<typeof createNoteHandlers> {
  return createNoteHandlers({
    recordRoot: () => root,
    snapshot: () =>
      notes === null
        ? null
        : ({ notes: notes.map((p) => ({ path: p })) } as unknown as Pick<QaSnapshot, 'notes'>),
    now: () => NOW
  })
}

const docAt = (p: string, body = 'written'): NoteDoc => ({
  path: p,
  title: 'T',
  body,
  shots: []
})

async function outsideUntouched(): Promise<void> {
  expect(await readdir(outside)).toEqual(['2026-09-27-note-victim.md'])
  expect(await readFile(victim, 'utf8')).toBe(VICTIM)
}

describe('note handlers work on notes inside the record root', () => {
  test('create in a project or round folder, then save, hand over, reopen and add a shot', async () => {
    const h = handlers([])
    const inProject = await h.create(project, 'From home')
    expect(inProject?.path).toBe(path.join(project, '2026-09-28-note-from-home.md'))
    const inRound = await h.create(round, 'From run')
    expect(inRound?.path).toBe(path.join(round, '2026-09-28-note-from-run.md'))

    const p = inRound!.path
    expect(await h.save(docAt(p, 'hello'))).toEqual({ savedAt: expect.any(String) })
    expect(await readFile(p, 'utf8')).toContain('hello')
    expect((await h.handOver(p))?.handedOverAt).toBe(NOW)
    expect((await h.reopen(p))?.handedOverAt).toBeUndefined()
    expect(await h.addShot(p, PNG)).toBe('2026-09-28-note-from-run.shots/note-1.png')
  })

  test('a scanned note opens and saves', async () => {
    const h = handlers()
    expect((await h.open(scannedNote))?.title).toBe('Scanned')
    expect(await h.save(docAt(scannedNote, 'edited'))).not.toBeNull()
    expect(await readFile(scannedNote, 'utf8')).toContain('edited')
  })

  test('a note found by search opens read-only until the snapshot lists it', async () => {
    const fresh = path.join(round, '2026-09-28-note-fresh.md')
    await writeFile(fresh, '---\ntitle: "Fresh"\n---\n\nbody\n')
    let notes: string[] = []
    const h = createNoteHandlers({
      recordRoot: () => root,
      snapshot: () =>
        ({ notes: notes.map((p) => ({ path: p })) }) as unknown as Pick<QaSnapshot, 'notes'>,
      now: () => NOW
    })
    expect((await h.open(fresh))?.title).toBe('Fresh')
    expect(await h.save(docAt(fresh, 'too soon'))).toBeNull()
    expect(await readFile(fresh, 'utf8')).toContain('body')

    notes = [fresh]
    expect(await h.save(docAt(fresh, 'now saved'))).not.toBeNull()
    expect(await readFile(fresh, 'utf8')).toContain('now saved')
  })

  test('a note in the threads folder is a note location, as the scanner reads it', async () => {
    await mkdir(path.join(project, 'threads'))
    const h = handlers([])
    expect(await h.create(path.join(project, 'threads'), 'Thread note')).not.toBeNull()
  })
})

describe('note handlers refuse anything outside the record root and write nothing', () => {
  test('create refuses a folder outside the root, the root itself, traversal and non-note folders', async () => {
    await mkdir(path.join(project, 'handoffs'))
    await symlink(outside, path.join(project, 'linked'))
    const h = handlers()
    for (const dir of [
      outside,
      root,
      path.join(project, '..', '..', 'elsewhere'),
      path.join(project, 'linked'),
      path.join(project, 'handoffs'),
      path.join(round, 'deeper'),
      'demo',
      42
    ]) {
      expect(await h.create(dir, 'Planted')).toBeNull()
    }
    await outsideUntouched()
    expect(await readdir(path.join(project, 'handoffs'))).toEqual([])
  })

  test('reserved folders (roadmap, releases, handoffs) and shots folders are not note locations', async () => {
    const reserved = ['roadmap', 'releases', 'handoffs', '2026-09-27-note-scanned.shots']
    for (const folder of reserved) {
      const dir = path.join(project, folder)
      await mkdir(dir)
      const idea = path.join(dir, '2026-09-28-note-idea.md')
      await writeFile(idea, 'agent-owned\n')
      const h = handlers([idea])
      expect(await h.create(dir, 'Planted')).toBeNull()
      expect(await h.open(idea)).toBeNull()
      expect(await h.save(docAt(idea))).toBeNull()
      expect(await h.handOver(idea)).toBeNull()
      expect(await readdir(dir)).toEqual(['2026-09-28-note-idea.md'])
      expect(await readFile(idea, 'utf8')).toBe('agent-owned\n')
    }
  })

  test('opening a note grants no write: an unlisted note stays unwritable after open', async () => {
    const unlisted = path.join(round, '2026-09-28-note-unlisted.md')
    await writeFile(unlisted, 'original\n')
    const h = handlers([])
    expect(await h.open(unlisted)).not.toBeNull()
    expect(await h.save(docAt(unlisted))).toBeNull()
    expect(await h.handOver(unlisted)).toBeNull()
    expect(await h.reopen(unlisted)).toBeNull()
    expect(await h.addShot(unlisted, PNG)).toBeNull()
    expect(await readFile(unlisted, 'utf8')).toBe('original\n')
  })

  test('a round folder symlinked to another folder inside the root is not a note location', async () => {
    await symlink(round, path.join(project, 'alias'))
    const h = handlers()
    expect(await h.create(path.join(project, 'alias'), 'Via alias')).toBeNull()
    expect(await readdir(round)).toEqual([])
  })

  test('open, save, hand over, reopen and add shot refuse an outside note', async () => {
    const h = handlers([victim])
    expect(await h.open(victim)).toBeNull()
    expect(await h.save(docAt(victim))).toBeNull()
    expect(await h.handOver(victim)).toBeNull()
    expect(await h.reopen(victim)).toBeNull()
    expect(await h.addShot(victim, PNG)).toBeNull()
    await outsideUntouched()
  })

  test('a note-named symlink inside the root pointing outside is refused', async () => {
    const link = path.join(project, '2026-09-28-note-link.md')
    await symlink(victim, link)
    const h = handlers([link])
    expect(await h.open(link)).toBeNull()
    expect(await h.save(docAt(link))).toBeNull()
    expect(await h.handOver(link)).toBeNull()
    await outsideUntouched()
  })

  test('save writes only to a note main recorded, not to any doc.path the renderer names', async () => {
    const other = path.join(project, '2026-09-28-note-unrecorded.md')
    await writeFile(other, 'original\n')
    const h = handlers()
    expect(await h.save(docAt(other))).toBeNull()
    expect(await h.handOver(other)).toBeNull()
    expect(await h.reopen(other)).toBeNull()
    expect(await h.addShot(other, PNG)).toBeNull()
    expect(await readFile(other, 'utf8')).toBe('original\n')
    expect(await h.save({ ...docAt(scannedNote), path: 7 })).toBeNull()
    expect(await h.save(null)).toBeNull()
  })

  test('a non-note file inside the root is not a note', async () => {
    const request = path.join(round, 'request.md')
    await writeFile(request, '# Request\n')
    const h = handlers([request])
    expect(await h.open(request)).toBeNull()
    expect(await h.save(docAt(request))).toBeNull()
    expect(await readFile(request, 'utf8')).toBe('# Request\n')
  })

  test('add shot refuses when the shots folder is a symlink, out of the root or within it', async () => {
    const shots = scannedNote.replace(/\.md$/, '.shots')
    await symlink(outside, shots)
    const h = handlers()
    expect(await h.addShot(scannedNote, PNG)).toBeNull()
    await outsideUntouched()

    await rm(shots)
    await symlink(round, shots)
    expect(await h.addShot(scannedNote, PNG)).toBeNull()
    expect(await readdir(round)).toEqual([])
  })

  test('with no snapshot a scanned-looking note cannot be written', async () => {
    const h = handlers(null)
    expect(await h.save(docAt(scannedNote))).toBeNull()
    expect(await readFile(scannedNote, 'utf8')).toContain('body')
  })
})

describe('a note reads its own screenshots', () => {
  test('a shot in the note shots folder displays, without the note being in a scan', async () => {
    const h = handlers([])
    const shotsDir = path.join(project, '2026-09-27-note-scanned.shots')
    await mkdir(shotsDir)
    await writeFile(path.join(shotsDir, 'obs-1.png'), 'png bytes')
    const url = await h.readShot(scannedNote, '2026-09-27-note-scanned.shots/obs-1.png')
    expect(url).toBe(`data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`)
  })

  test('refuses traversal, other folders, symlinks out of the root and notes outside the root', async () => {
    const h = handlers([scannedNote])
    const shotsDir = path.join(project, '2026-09-27-note-scanned.shots')
    await mkdir(shotsDir)
    await writeFile(path.join(project, 'other.png'), 'sibling')
    await writeFile(path.join(outside, 'secret.png'), 'secret')
    await symlink(path.join(outside, 'secret.png'), path.join(shotsDir, 'link.png'))
    expect(await h.readShot(scannedNote, '../elsewhere/secret.png')).toBeNull()
    expect(await h.readShot(scannedNote, 'other.png')).toBeNull()
    expect(await h.readShot(scannedNote, '2026-09-27-note-scanned.shots/link.png')).toBeNull()
    expect(await h.readShot(scannedNote, '2026-09-27-note-scanned.shots/missing.png')).toBeNull()
    expect(await h.readShot(victim, 'x.png')).toBeNull()
    expect(await h.readShot(123, 'x.png')).toBeNull()
  })
})
