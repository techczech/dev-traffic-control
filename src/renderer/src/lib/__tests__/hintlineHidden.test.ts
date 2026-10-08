import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Guards one class of bug: a class rule that sets `display:` silently defeats
 * the `[hidden]` attribute, so the first-use hint
 * ("Select a line and press Q") would never disappear after the first quote.
 * The Reading surface drives the hint with `hidden={...}`, which only works
 * while main.css keeps an explicit `.hintline[hidden] { display: none }`
 * override AFTER the `.hintline { display: flex }` base rule.
 */
test('.hintline[hidden] display:none survives in main.css, after the display:flex base', () => {
  const css = readFileSync(path.resolve(__dirname, '../../assets/main.css'), 'utf8')

  const base = css.match(/\.hintline\s*\{[^}]*\}/)
  expect(base, 'the .hintline base rule exists').toBeTruthy()
  expect(base![0]).toMatch(/display:\s*flex/)

  const override = css.match(/\.hintline\[hidden\]\s*\{[^}]*\}/)
  expect(override, 'the [hidden] override exists — without it the hint never hides').toBeTruthy()
  expect(override![0]).toMatch(/display:\s*none/)

  // Order matters at equal-or-lower specificity: the override must come later.
  expect(css.indexOf(override![0])).toBeGreaterThan(css.indexOf(base![0]))
})
