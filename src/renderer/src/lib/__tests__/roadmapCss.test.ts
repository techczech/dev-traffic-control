import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

test('Recent movement metadata keeps its scoped flex layout above the generic glance-row rule', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8')

  expect(css).toMatch(
    /\.roadmap\s+\.grow2\s+\.gm\.roadmap-movement-meta\s*\{[^}]*display:\s*flex;[^}]*gap:\s*4px 7px;/s
  )
})
