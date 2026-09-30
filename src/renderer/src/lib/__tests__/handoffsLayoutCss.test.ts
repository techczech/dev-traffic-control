import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

test('narrow handoff filters wrap without a clipping scroll container', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/handoffs.css'), 'utf8')
  const narrow =
    css.match(/@media \(max-width: 720px\)\s*\{(?<body>[\s\S]*)\}\s*$/)?.groups?.body ?? ''
  const filters = narrow.match(/\.ho-filters\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''

  expect(filters).toMatch(/flex-wrap:\s*wrap/)
  expect(filters).not.toMatch(/max-height/)
  expect(filters).not.toMatch(/overflow/)
})
