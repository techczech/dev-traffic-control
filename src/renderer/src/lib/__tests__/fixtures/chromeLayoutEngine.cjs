/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type --
   A CommonJS helper shared by the geometry fixtures (run directly by `node`)
   and the layout tests that spawn them; it carries no TypeScript annotations. */
// The layout guards measure the app's stylesheets in headless Google Chrome.
// One place says where Chrome is, so a fixture and its test never disagree.
const { existsSync } = require('node:fs')

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** The Chrome binary the geometry fixtures launch: `CHROME_BIN`, else the macOS default. */
function chromeBinary() {
  return process.env.CHROME_BIN || DEFAULT_CHROME
}

/** Why the layout guards cannot run here, or undefined when Chrome is present. */
function chromeMissingReason() {
  const binary = chromeBinary()
  if (existsSync(binary)) return undefined
  return `Google Chrome not found at ${binary}; the layout guards need it (set CHROME_BIN to another Chrome binary)`
}

module.exports = { chromeBinary, chromeMissingReason }
