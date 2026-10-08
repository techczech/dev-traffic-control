import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function sourceFiles(root: string): string[] {
  const glob = import.meta.glob('../../**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default'
  })
  return Object.keys(glob)
    .map((path) => join(dirname(fileURLToPath(import.meta.url)), path))
    .filter((path) => !path.includes('/commands/'))
    .filter((path) => !path.includes('/__tests__/'))
    .map((path) => relative(root, path))
}

test('renderer keydown handling exists only in command infrastructure', () => {
  const offenders = sourceFiles(rendererRoot).filter((path) => {
    const source = readFileSync(join(rendererRoot, path), 'utf8')
    return /addEventListener\(['"]keydown|onKeyDown\s*=/.test(source)
  })
  expect(offenders).toEqual([])
})
