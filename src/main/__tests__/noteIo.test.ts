import { expect, test } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  addNoteShot,
  createNote,
  handOverNote,
  linkNoteToReport,
  openNote,
  reopenNote,
  saveNote
} from '../noteIo'
import { reportPathFor } from '../qa/report'

const NOW = () => '2026-07-18T12:00:00.000Z'
const LATER = () => '2026-07-18T13:30:00.000Z'

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'qa-noteio-'))
}

test('createNote writes frontmatter title and returns a slugged path', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Sidebar colour', NOW)
  expect(doc.path).toBe(path.join(dir, '2026-07-18-note-sidebar-colour.md'))
  expect(doc.title).toBe('Sidebar colour')
  const raw = await readFile(doc.path, 'utf8')
  expect(raw).toContain('title: "Sidebar colour"')
})

test('a second note with the same title gets a -2 slug', async () => {
  const dir = await tempDir()
  await createNote(dir, 'Sidebar colour', NOW)
  const second = await createNote(dir, 'Sidebar colour', NOW)
  expect(second.path).toBe(path.join(dir, '2026-07-18-note-sidebar-colour-2.md'))
})

test('openNote round-trips body, shots and linkedRun', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Title ideas', NOW)
  const edited = {
    ...doc,
    body: 'The sidebar could carry the deck logo.',
    linkedRun: '2026-07-18-title-spacing-0.4.2.md',
    shots: ['2026-07-18-note-title-ideas.shots/note-1.png']
  }
  await saveNote(edited)
  const reopened = await openNote(doc.path)
  expect(reopened.body).toContain('deck logo')
  expect(reopened.linkedRun).toBe('2026-07-18-title-spacing-0.4.2.md')
  expect(reopened.shots).toEqual(['2026-07-18-note-title-ideas.shots/note-1.png'])
})

test('saveNote is atomic and preserves handedOverAt', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Handed', NOW)
  const handed = await handOverNote(doc.path, NOW)
  // A later draft-style save carrying the stamp must not drop it.
  await saveNote({ ...handed, body: 'more thoughts' })
  const onDisk = await readFile(doc.path, 'utf8')
  expect(onDisk).toContain('handedOverAt: "2026-07-18T12:00:00.000Z"')
  expect(onDisk).toContain('more thoughts')
})

test('handOverNote stamps with the injected now and persists', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Note', NOW)
  const handed = await handOverNote(doc.path, LATER)
  expect(handed.handedOverAt).toBe(LATER())
  const onDisk = await readFile(doc.path, 'utf8')
  expect(onDisk).toContain('handedOverAt: "2026-07-18T13:30:00.000Z"')
})

test('reopenNote clears the stamp and persists', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Note', NOW)
  await handOverNote(doc.path, LATER)
  const cleared = await reopenNote(doc.path)
  expect(cleared.handedOverAt).toBeUndefined()
  const onDisk = await readFile(doc.path, 'utf8')
  expect(onDisk).not.toContain('handedOverAt')
})

test('addNoteShot names note-1.png then note-2.png and creates the shots dir', async () => {
  const dir = await tempDir()
  const doc = await createNote(dir, 'Shots', NOW)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const rel1 = await addNoteShot(doc.path, png)
  const rel2 = await addNoteShot(doc.path, png)
  const shotsDir = '2026-07-18-note-shots.shots'
  expect(rel1).toBe(path.join(shotsDir, 'note-1.png'))
  expect(rel2).toBe(path.join(shotsDir, 'note-2.png'))
  expect((await readdir(path.join(dir, shotsDir))).sort()).toEqual(['note-1.png', 'note-2.png'])
})

test('linkNoteToReport appends once (idempotent) and preserves report items', async () => {
  const dir = await tempDir()
  const reqPath = path.join(dir, '2026-07-18-run.md')
  await writeFile(reqPath, '# stub')
  const reportPath = reportPathFor(reqPath)
  await writeFile(
    reportPath,
    JSON.stringify({
      id: 'r',
      title: 'Run',
      startedAt: NOW(),
      noteFiles: [],
      items: [
        {
          id: 'a',
          title: 'A',
          status: 'pass',
          comment: '',
          flagged: [],
          quotes: [],
          screenshots: []
        },
        {
          id: 'b',
          title: 'B',
          status: 'fail',
          comment: '',
          flagged: [],
          quotes: [],
          screenshots: []
        }
      ]
    })
  )
  await linkNoteToReport(reqPath, '2026-07-18-note-x.md')
  await linkNoteToReport(reqPath, '2026-07-18-note-x.md')
  const after = JSON.parse(await readFile(reportPath, 'utf8'))
  expect(after.noteFiles).toEqual(['2026-07-18-note-x.md'])
  expect(after.items).toHaveLength(2) // items never clobbered (guard)
})

test('linkNoteToReport never resurrects a report that does not exist', async () => {
  const dir = await tempDir()
  const reqPath = path.join(dir, '2026-07-18-run.md')
  await writeFile(reqPath, '# stub')
  await linkNoteToReport(reqPath, '2026-07-18-note-x.md')
  await expect(readFile(reportPathFor(reqPath), 'utf8')).rejects.toThrow()
})
