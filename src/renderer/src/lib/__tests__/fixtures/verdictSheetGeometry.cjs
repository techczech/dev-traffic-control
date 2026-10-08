// The verdict sheet must never cover the title bar. This
// lays out the title bar and an open verdict sheet with every stylesheet the
// renderer loads, in its order, in real Chrome at the sidebar and full widths,
// and hit-tests the centre of each title-bar control with elementFromPoint.
// An element covered by the sheet still has its box; only a hit-test sees it.
const { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = resolve(__dirname, '../../../../../..')
const rendererEntry = resolve(repoRoot, 'src/renderer/src/main.tsx')
const appStylesheets = rendererEntryStylesheets()
const appCss = appStylesheets
  .map((path) => `/* ${path} */\n${readFileSync(resolve(repoRoot, path), 'utf8')}`)
  .join('\n')
const { chromeBinary, chromeMissingReason } = require('./chromeLayoutEngine.cjs')
const chrome = chromeBinary()
// The sidebar runs at 460px, but headless Chrome will not make a window narrower
// than 500px (see dashboardLayoutGeometry.cjs). The sheet is fixed to the
// viewport, so no wrapper can narrow it; 500 falls in the same bucket of every
// media query in the app as 460, so it stands in for the sidebar.
const WIDTHS = [500, 1280]

if (chromeMissingReason()) throw new Error(chromeMissingReason())

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'dtc-verdict-sheet-'))
const fixturePath = join(fixtureDirectory, 'verdict-sheet.html')

try {
  writeFileSync(fixturePath, fixtureHtml())
  const measurements = WIDTHS.flatMap((width) => {
    const browser = spawnSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-sandbox',
        `--window-size=${width},800`,
        '--dump-dom',
        `file://${fixturePath}`
      ],
      { encoding: 'utf8' }
    )
    if (browser.status !== 0) {
      throw new Error(browser.error?.message || browser.stderr || 'Chrome geometry fixture failed')
    }
    const encoded = browser.stdout.match(/<title>([^<]+)<\/title>/)?.[1]
    if (!encoded) throw new Error('Chrome geometry fixture returned no measurement')
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  })
  process.stdout.write(`${JSON.stringify({ stylesheets: appStylesheets, measurements })}\n`)
} finally {
  unlinkSync(fixturePath)
  rmdirSync(fixtureDirectory)
}

function rendererEntryStylesheets() {
  const entry = readFileSync(rendererEntry, 'utf8')
  const stylesheets = []
  for (const match of entry.matchAll(/^import\s+'([^']+\.css)'/gm)) {
    stylesheets.push(resolve(repoRoot, 'src/renderer/src', match[1]).slice(`${repoRoot}/`.length))
  }
  if (stylesheets.length === 0) throw new Error(`No stylesheet imports found in ${rendererEntry}`)
  return stylesheets
}

// The shell as App.tsx and Chrome.tsx draw it, with ProjectHome's sheet open.
function fixtureHtml() {
  return `<!doctype html>
    <html>
      <head>
        <title>pending</title>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; height: 100%; }
          ${appCss}
        </style>
      </head>
      <body>
        <div class="app-shell">
          <header class="titlebar">
            <button class="iconbtn tb-back">‹</button>
            <span class="tbspace"></span>
            <button class="iconbtn" data-control="expand">E</button>
            <button class="iconbtn" data-control="settings">S</button>
            <span class="dockbtn" role="group">
              <button class="iconbtn dockbtn-main" data-control="dock">D</button>
              <button class="iconbtn dockbtn-more" data-control="dock-menu">▾</button>
            </span>
            <button class="iconbtn" data-control="pin">P</button>
          </header>
          <div class="surface-row">
            <div class="pane-col">
              <div class="view phome">
                <div class="verdict-sheet one-at-a-time" role="dialog">
                  <div class="verdict-sheet-bar"><button class="verdict-back">Back</button></div>
                  <div class="verdict-sheet-body"><h2 class="verdict-title">A feature</h2></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <script>
          const measure = (layout) => {
            const sheet = document.querySelector('.verdict-sheet')
            sheet.className = 'verdict-sheet ' + layout
            const titlebar = document.querySelector('.titlebar').getBoundingClientRect()
            const box = sheet.getBoundingClientRect()
            const hits = {}
            for (const control of document.querySelectorAll('[data-control]')) {
              const r = control.getBoundingClientRect()
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              hits[control.dataset.control] = hit?.closest('[data-control]')?.dataset.control ?? (hit?.className || null)
            }
            return {
              width: window.innerWidth,
              layout,
              titlebarBottom: titlebar.bottom,
              sheetTop: box.top,
              sheetBottom: box.bottom,
              viewportHeight: window.innerHeight,
              hits
            }
          }
          document.title = btoa(JSON.stringify(['one-at-a-time', 'all-at-once'].map(measure)))
        </script>
      </body>
    </html>`
}
