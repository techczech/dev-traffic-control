/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type --
   A CommonJS helper shared by the geometry fixtures (run directly by `node`)
   and the layout tests that spawn them; it carries no TypeScript annotations. */
// The layout guards measure the app's stylesheets in Playwright's chrome-headless-shell, never the
// user's Google Chrome (launching that headless quits their open Chrome).
// One place says where the browser is, so a fixture and its test never disagree.
const { existsSync, readdirSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

/** The newest installed Playwright chrome-headless-shell, or undefined when none is installed. */
function newestHeadlessShell() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'Library', 'Caches', 'ms-playwright')
  let dirs = []
  try {
    dirs = readdirSync(base)
  } catch {
    return undefined
  }
  const found = dirs
    .map((name) => ({ name, n: Number(/^chromium_headless_shell-(\d+)$/.exec(name)?.[1]) }))
    .filter((d) => Number.isFinite(d.n))
    .sort((a, b) => b.n - a.n)
  for (const { name } of found) {
    const dir = join(base, name)
    for (const sub of readdirSync(dir).filter((s) => s.startsWith('chrome-headless-shell-'))) {
      const binary = join(dir, sub, 'chrome-headless-shell')
      if (existsSync(binary)) return binary
    }
  }
  return undefined
}

/** The browser the geometry fixtures launch: `CHROME_BIN`, `CHROME_PATH` or `PUPPETEER_EXECUTABLE_PATH`, else the newest headless shell. */
function chromeBinary() {
  return (
    process.env.CHROME_BIN ||
    process.env.CHROME_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    newestHeadlessShell() ||
    join(homedir(), 'Library', 'Caches', 'ms-playwright', 'chrome-headless-shell-missing')
  )
}

/** Why the layout guards cannot run here, or undefined when Chrome is present. */
function chromeMissingReason() {
  const binary = chromeBinary()
  if (existsSync(binary)) return undefined
  return `chrome-headless-shell not found at ${binary}; the layout guards need it (run \`npx playwright install chromium-headless-shell\` or set CHROME_BIN)`
}

module.exports = { chromeBinary, chromeMissingReason }
