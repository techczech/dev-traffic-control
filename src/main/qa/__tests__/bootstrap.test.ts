import { afterEach, expect, test } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureProject, ensureQaRepo, refreshContract } from '../bootstrap'
import { ROOT_AGENTS_MD, ROOT_TEMPLATE_VERSION, templateVersion } from '../templates'

const temporaryParents: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'qa-boot-'))
  temporaryParents.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((parent) => rm(parent, { recursive: true, force: true }))
  )
})

test('creates root contract files; re-run leaves a current-version file alone', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await ensureQaRepo(root)
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
  expect(agents).toContain('report.json')
  expect(agents).toContain('completedAt')
  expect(await readFile(path.join(root, 'CLAUDE.md'), 'utf8')).toContain('@./AGENTS.md')

  const marked = `<!-- dev-traffic-control template v${ROOT_TEMPLATE_VERSION} -->\nCUSTOMISED`
  await writeFile(path.join(root, 'AGENTS.md'), marked)
  await ensureQaRepo(root)
  expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(marked)
})

test('an unmarked hand-written contract survives under a custom root name', async () => {
  const root = path.join(await temporaryDirectory(), 'qa-records')
  await ensureQaRepo(root)
  const handWritten = '# Hand-written record contract\n\nKeep this text.\n'
  await writeFile(path.join(root, 'AGENTS.md'), handWritten)
  await ensureQaRepo(root)
  await refreshContract(root)
  expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(handWritten)
})

test('record bootstrap and refresh preserve user ignore lines and idempotently ignore sentinels', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await writeFile(path.join(root, '.gitignore'), 'user-cache/\n')

  await ensureQaRepo(root)
  await refreshContract(root)

  expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
    'user-cache/\n.dtc-watch-ready-*.state.json\n*.watch.json\n'
  )
})

test('sentinel maintenance preserves the dominant CRLF line ending', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await writeFile(path.join(root, '.gitignore'), 'user-cache/\r\nbuild/\r\n')

  await ensureQaRepo(root)

  expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
    'user-cache/\r\nbuild/\r\n.dtc-watch-ready-*.state.json\r\n*.watch.json\r\n'
  )
})

test('a readable chosen root remains usable when sentinel hygiene cannot be written', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await writeFile(path.join(root, 'AGENTS.md'), ROOT_AGENTS_MD)
  await writeFile(path.join(root, 'CLAUDE.md'), '@./AGENTS.md\n')
  await chmod(root, 0o500)

  try {
    await expect(ensureQaRepo(root)).resolves.toBeUndefined()
  } finally {
    await chmod(root, 0o700)
  }
})

test('a readable but untraversable chosen root is rejected', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await chmod(root, 0o400)

  try {
    await expect(ensureQaRepo(root)).rejects.toMatchObject({ code: 'EACCES' })
  } finally {
    await chmod(root, 0o700)
  }
})

test('a readable and traversable chosen root is accepted', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await chmod(root, 0o500)

  try {
    await expect(ensureQaRepo(root)).resolves.toBeUndefined()
  } finally {
    await chmod(root, 0o700)
  }
})

test('launch refresh and chosen-root bootstrap serialise sentinel maintenance', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await writeFile(path.join(root, 'AGENTS.md'), ROOT_AGENTS_MD)
  await writeFile(path.join(root, 'CLAUDE.md'), '@./AGENTS.md\n')

  await expect(Promise.all([refreshContract(root), ensureQaRepo(root)])).resolves.toBeDefined()
  expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
    '.dtc-watch-ready-*.state.json\n*.watch.json\n'
  )
})

test('CLAUDE.md sidecar keeps the absent-only write — never clobbered', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await ensureQaRepo(root)
  await writeFile(path.join(root, 'CLAUDE.md'), 'CUSTOMISED')
  await ensureQaRepo(root)
  expect(await readFile(path.join(root, 'CLAUDE.md'), 'utf8')).toBe('CUSTOMISED')
})

test('refreshContract updates an app-marked older contract', async () => {
  const root = path.join(await temporaryDirectory(), 'qa-records')
  await ensureQaRepo(root)
  const legacy = '<!-- dev-traffic-control template v8 -->\n# old contract'
  expect(templateVersion(legacy)).toBe(8)
  await writeFile(path.join(root, 'AGENTS.md'), legacy)
  await refreshContract(root)
  expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(ROOT_AGENTS_MD)
})

test('refreshContract recognises and upgrades a two-digit v10 template marker', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await mkdir(root)
  await writeFile(
    path.join(root, 'AGENTS.md'),
    '<!-- dev-traffic-control template v9 -->\n# v9 contract'
  )

  await refreshContract(root)

  const refreshed = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
  expect(templateVersion(refreshed)).toBe(ROOT_TEMPLATE_VERSION)
  expect(refreshed).toBe(ROOT_AGENTS_MD)
})

test('refreshContract never resurrects a missing root', async () => {
  const parent = await temporaryDirectory()
  const root = path.join(parent, '_REC') // never created
  await refreshContract(root)
  await expect(stat(root)).rejects.toThrow() // still honestly missing
})

test('ensureProject creates dir + pointer files', async () => {
  const root = path.join(await temporaryDirectory(), '_REC')
  await ensureQaRepo(root)
  await ensureProject(root, 'tallyboard')
  const ptr = await readFile(path.join(root, 'tallyboard/AGENTS.md'), 'utf8')
  expect(ptr).toContain('tallyboard')
  expect(ptr).toContain('../AGENTS.md')
})
