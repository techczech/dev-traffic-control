import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { archiveHandoff, readHandoffSidecar, unarchiveHandoff } from '../handoffs'

// An archived handoff comes back without deleting its sidecar by hand.
test('restoring an archived handoff sets archivedAt back to null and keeps pickedUpAt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dtc-handoff-'))
  // A handoff sits at <records folder>/<project>/handoffs/<file>.
  const dir = path.join(root, 'example-app', 'handoffs')
  await mkdir(dir, { recursive: true })
  const doc = path.join(dir, '2026-08-01-example-resume-handoff.md')
  await writeFile(doc, '---\ntitle: Sample\n---\n\n# Sample\n')
  await archiveHandoff(doc, () => '2026-09-23T22:00:00.000Z')
  expect((await readHandoffSidecar(doc)).archivedAt).toBe('2026-09-23T22:00:00.000Z')

  const restored = await unarchiveHandoff(doc)
  expect(restored).toEqual({ pickedUpAt: null, archivedAt: null })
  expect(await readFile(doc, 'utf8')).toContain('# Sample')
})
