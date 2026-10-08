import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(path.resolve(__dirname, '../../assets/project-rail.css'), 'utf8')

/**
 * main.css already owns a bare `.rail` as the
 * Runner's 46px spine strip. A bare word is a global claim, and a second
 * `.rail` collapses the project rail, so every selector here stays inside
 * `.project-rail`.
 */
test('no rule in the project rail claims a class outside its own root', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((match) =>
    match[2]
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean)
  )

  expect(selectors.length).toBeGreaterThan(10)
  for (const selector of selectors) {
    expect(selector, `${selector} escapes the rail`).toMatch(/^\.project-rail\b/)
  }
})

/** The filter and the sync line are pinned; only the list between them moves. */
test('the rail scrolls without the footer leaving', () => {
  expect(css).toMatch(/\.project-rail\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
  expect(css).toMatch(/\.project-rail\s+\.railtop\s*\{[^}]*flex:\s*none;/s)
  expect(css).toMatch(/\.project-rail\s+\.railscroll\s*\{[^}]*flex:\s*1;[^}]*overflow-y:\s*auto;/s)
  expect(css).toMatch(/\.project-rail\s+\.railfoot\s*\{[^}]*flex:\s*none;/s)
})
