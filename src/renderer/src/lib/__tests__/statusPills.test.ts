import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(path.join(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')

function channel(value: number): number {
  const normalised = value / 255
  return normalised <= 0.04045 ? normalised / 12.92 : Math.pow((normalised + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((part) => channel(Number.parseInt(part, 16)))
  if (!channels || channels.length !== 3) throw new Error(`Expected six-digit colour, got ${hex}`)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`Missing solid colour token --${name}`)
  return match[1]
}

test.each(['ready', 'progress', 'waiting', 'inactive'])(
  '%s status pill has 4.5:1 text contrast',
  (tone) => {
    expect(
      contrast(token(`status-${tone}-ink`), token(`status-${tone}-bg`))
    ).toBeGreaterThanOrEqual(4.5)
  }
)

test('status labels are readable filled pills', () => {
  expect(css).toMatch(/\.status-chip\s*\{[^}]*border-radius:\s*999px/s)
  expect(css).toMatch(/\.status-chip\s*\{[^}]*font-weight:\s*(?:600|6\d\d|7\d\d)/s)
})

test('the request-header watch pill is body-sized and filled in live and inactive tones', () => {
  expect(css).toMatch(/\.agent-status\s*\{[^}]*font-size:\s*(?:14|15|16)px/s)
  expect(css).toMatch(/\.agent-status\s*\{[^}]*font-weight:\s*(?:600|6\d\d|7\d\d)/s)
  expect(css).toContain('.agent-status.status-progress')
  expect(css).toContain('.agent-status.status-inactive')
})
