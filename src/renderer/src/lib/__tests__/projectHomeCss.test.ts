import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(path.resolve(__dirname, '../../assets/project-home.css'), 'utf8')

/**
 * main.css already owns `.card` and `.empty`. A bare word is a global
 * claim, so every selector in the home's stylesheet stays inside `.phome`.
 */
test('no rule in the project home claims a class outside its own root', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...rules.matchAll(/(^|\})\s*([^{}@]+)\{/g)].flatMap((match) =>
    match[2]
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean)
  )

  expect(selectors.length).toBeGreaterThan(20)
  for (const selector of selectors) {
    // `\b` would let `.phome-btn` pass as if it were `.phome …`.
    expect(selector, `${selector} escapes the home`).toMatch(/^\.phome(?![\w-])/)
  }
})

test('each waiting release question is a white card with its own coloured edge', () => {
  expect(css).toMatch(
    /\.phome \.phome-hero \{[^}]*background: #fff;[^}]*box-shadow: inset 7px 0 0 var\(--hero-edge\)/s
  )
  const edges = [
    ...css.matchAll(
      /\.phome \.phome-hero:nth-child\(4n \+ \d\)\s*\{\s*--hero-edge: (#[0-9a-f]{6})/g
    )
  ].map((m) => m[1])
  expect(new Set(['#c99441', ...edges]).size).toBe(4)
})
