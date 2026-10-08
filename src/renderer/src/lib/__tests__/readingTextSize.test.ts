import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import * as shared from '../../../../shared/ipc'

test('request reading text size steps through three levels and clamps at both ends', () => {
  const step = (shared as unknown as Record<string, unknown>).stepReadingTextSize
  expect(typeof step).toBe('function')
  if (typeof step !== 'function') return

  const change = step as (current: string, direction: -1 | 1) => string
  expect(change('normal', -1)).toBe('normal')
  expect(change('normal', 1)).toBe('large')
  expect(change('large', 1)).toBe('extra-large')
  expect(change('extra-large', 1)).toBe('extra-large')
  expect(change('extra-large', -1)).toBe('large')
  expect(change('large', -1)).toBe('normal')
})

test('request reading surfaces have scoped type sizes instead of scaling chrome', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8')

  for (const level of ['normal', 'large', 'extra-large']) {
    expect(css).toContain(`.reading-text-${level}`)
  }
  expect(css).toMatch(/\.lightrun\.reading-text-[^{\s]+\s+\.lr-intro/)
  expect(css).toMatch(/\.lightrun\.reading-text-[^{\s]+\s+\.lr-check-text/)
  expect(css).toMatch(/\.runwrap\.reading-text-[^{\s]+\s+\.context/)
  expect(css).toMatch(/\.readwrap\.reading-text-[^{\s]+\s+\.doc\s+:is\(p,\s*li\)/)
  expect(css).not.toMatch(/\.reading-text-[^{\s]+\s+(?:button|\.chip|\.lr-title|\.itemtitle)/)
})
