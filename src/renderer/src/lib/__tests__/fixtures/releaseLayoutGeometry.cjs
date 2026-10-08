const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = resolve(__dirname, '../../../../../..')
const rendererEntry = resolve(repoRoot, 'src/renderer/src/main.tsx')
// The guard is only worth its runtime if it loads what the app loads, in the app's
// order — a subset proves something about the fixture, not about the app. Derive the
// list from the renderer entry so a stylesheet added later cannot fall out silently.
const appStylesheets = rendererEntryStylesheets()
const appCss = appStylesheets
  .map((path) => `/* ${path} */\n${readFileSync(resolve(repoRoot, path), 'utf8')}`)
  .join('\n')
const { chromeBinary, chromeMissingReason } = require('./chromeLayoutEngine.cjs')
const chrome = chromeBinary()
const releaseCases = [420, 460, 620, 900].flatMap((width) =>
  ['pills', 'rail'].map((versionLayout) => ({ width, versionLayout }))
)
const roadmapCases = [420, 460, 620, 900].flatMap((width) =>
  ['projects', 'pool'].map((navigation) => ({ width, navigation }))
)

if (chromeMissingReason()) throw new Error(chromeMissingReason())

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'dtc-release-layout-'))
const fixturePath = join(fixtureDirectory, 'release-layout.html')

try {
  writeFileSync(fixturePath, fixtureHtml())
  const browser = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--window-size=1000,700',
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
  const measurements = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
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
  if (stylesheets.length === 0) {
    throw new Error(`No stylesheet imports found in ${rendererEntry}`)
  }
  for (const path of stylesheets) {
    if (!existsSync(resolve(repoRoot, path))) throw new Error(`Stylesheet not found: ${path}`)
  }
  return stylesheets
}

function fixtureHtml() {
  return `<!doctype html>
    <html>
      <head>
        <title>pending</title>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; }
          body { font-family: Arial, sans-serif; }
          .release-project-layout, .roadmap-project-layout { height: 560px; }
          ${appCss}
        </style>
      </head>
      <body>
        ${releaseCases.map(({ width, versionLayout }) => releaseFixtureCase(width, versionLayout)).join('')}
        ${roadmapCases.map(({ width, navigation }) => roadmapFixtureCase(width, navigation)).join('')}
        <script>
          document.title = btoa(JSON.stringify([...document.querySelectorAll('[data-layout-case]')].map((root) => (${measure.toString()})(root))))
        </script>
      </body>
    </html>`
}

function releaseFixtureCase(width, versionLayout) {
  const narrowNavigation = versionLayout === 'rail' ? 'versions' : 'projects'
  const rail =
    versionLayout === 'rail'
      ? '<aside class="release-version-rail" aria-label="Versions"><h2>Versions</h2><button class="release-version-row on">0.17.0</button><button class="release-version-row">0.16.0</button></aside>'
      : ''

  return `<main
      class="view releases-view release-project-layout release-narrow-navigation-${narrowNavigation}"
      data-layout-case
      data-surface="release"
      data-width="${width}"
      data-version-layout="${versionLayout}"
      style="width:${width}px"
    >
      <aside class="release-project-sidebar" aria-label="Release projects">
        <div class="release-project-list">Project list</div>
      </aside>
      <div class="release-project-detail">
        <div class="release-app-view">
          <div class="release-app-modebar">
            <button class="release-project-list-return">Projects</button>
            <h1>Dev Traffic Control</h1>
          </div>
          <div class="release-version-toolbar"><span>Versions</span></div>
          <div class="release-app-split release-app-split-${versionLayout}">
            ${rail}
            <section class="release-version-detail">
              <header class="release-detail-header"><div><h2>Dev Traffic Control</h2><span>0.17.0</span></div></header>
              <div class="release-detail-scroll">
                <article class="release-frozen-notes">
                  <p class="detail-prose">No frozen notes were recorded for this release because the release record is still being prepared for review.</p>
                </article>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>`
}

function roadmapFixtureCase(width, navigation) {
  return `<main
      class="view roadmap-pool-view roadmap-project-layout roadmap-narrow-navigation-${navigation}"
      data-layout-case
      data-surface="roadmap"
      data-width="${width}"
      data-navigation="${navigation}"
      style="width:${width}px"
    >
      <aside class="release-project-sidebar" aria-label="Roadmap projects">
        <label class="release-project-search"><input value="" aria-label="Find a Roadmap project"></label>
        <div class="release-project-list">
          <section><button class="release-project-group">With ideas · 2</button></section>
          <button class="release-project-row on"><span>Dev Traffic Control</span><strong>4 ideas</strong></button>
          <button class="release-project-row"><span>Windmill</span><strong>2 ideas</strong></button>
        </div>
        <footer>4 projects · 2 with ideas</footer>
      </aside>
      <div class="roadmap-project-detail">
        <div class="roadmap-pool-modebar">
          <button class="roadmap-project-list-return">Projects</button>
          <h1 class="roadmap-pool-project">Dev Traffic Control</h1>
          <span>4 ideas · 1 new since your last look</span>
        </div>
        <div class="roadmap-pool-filters"><button class="roadmap-pool-filter on">In the pool</button></div>
        <div class="roadmap-pool-scroll">
          <section class="roadmap-lane functionality">
            <button class="roadmap-lane-header"><strong>Functionality</strong><span>2 ideas</span></button>
            <article class="roadmap-idea-row">
              <span class="roadmap-idea-rank">1</span>
              <div class="roadmap-idea-body">
                <strong>Keep the selected project visible after restarting the app</strong>
                <p class="roadmap-detail-prose">The Roadmap lane keeps enough room for a useful idea title and its explanatory text at every supported window width.</p>
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>`
}

function measure(root) {
  const rect = (selector) => {
    const element = root.querySelector(selector)
    if (!element || getComputedStyle(element).display === 'none') return null
    const bounds = element.getBoundingClientRect()
    return { left: bounds.left, right: bounds.right, width: bounds.width }
  }
  const charactersPerLine = (selector) => {
    const element = root.querySelector(selector)
    if (!element || getComputedStyle(element).display === 'none') return 0
    const node = element.firstChild
    const lines = new Map()
    for (let index = 0; index < node.textContent.length; index += 1) {
      if (/\s/.test(node.textContent[index])) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      const bounds = range.getBoundingClientRect()
      const line = Math.round(bounds.top)
      lines.set(line, (lines.get(line) || 0) + 1)
    }
    const counts = [...lines.values()]
    const nonFinal = counts.length > 1 ? counts.slice(0, -1) : counts
    const sorted = nonFinal.toSorted((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] || 0
  }

  const containerBounds = root.getBoundingClientRect()
  const container = {
    left: containerBounds.left,
    right: containerBounds.right,
    width: containerBounds.width
  }
  const projectSidebar = rect('.release-project-sidebar')
  const versionRail = rect('.release-version-rail')
  const surface = root.dataset.surface
  const detail = rect(surface === 'roadmap' ? '.roadmap-project-detail' : '.release-version-detail')
  const visibleColumnWidth = [projectSidebar, versionRail, detail].reduce(
    (sum, column) => sum + (column ? column.width : 0),
    0
  )
  const railStyle = versionRail
    ? getComputedStyle(root.querySelector('.release-version-rail'))
    : null
  const returnButton = root.querySelector('.roadmap-project-list-return')
  const split = root.querySelector('.release-app-split')

  return {
    splitClassNames: split ? [...split.classList] : null,
    surface,
    width: Number(root.dataset.width),
    versionLayout: root.dataset.versionLayout,
    navigation: root.dataset.navigation,
    containerWidth: container.width,
    projectSidebar,
    versionRail,
    detail,
    visibleColumnWidth,
    medianCharactersPerLine: charactersPerLine(
      surface === 'roadmap' ? '.roadmap-detail-prose' : '.detail-prose'
    ),
    railPosition: railStyle ? railStyle.position : null,
    railFlowsBeforeDetail: !versionRail || !detail || versionRail.right <= detail.left + 0.5,
    projectReturnVisible: !!returnButton && getComputedStyle(returnButton).display !== 'none'
  }
}
