import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('light-request additions stay prefixed and scoped in the shared stylesheet', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8')

  expect(css).toMatch(/\.view\s+\.lr-run-empty-chips\s*\{/)
  expect(css).not.toMatch(/(^|\n)\.run-empty-chips\s*\{/)

  expect(css).toMatch(/\.view\s+\.outbtn:disabled\s*,\s*\.runwrap\s+\.stampseg:disabled\s*\{/)
  expect(css).toMatch(
    /\.view\s+\.outbtn:disabled:hover\s*,\s*\.runwrap\s+\.stampseg:disabled:hover\s*\{/
  )
})

test('the light problem note expands without resize or scrollbox chrome', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8')
  const rule = css.match(/\.lightrun\s+\.lr-note\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''

  expect(rule).toMatch(/resize:\s*none/)
  expect(rule).toMatch(/min-height:\s*\d/)
  expect(rule).toMatch(/overflow:\s*hidden/)
  expect(rule).not.toMatch(/white-space:\s*nowrap/)
})
