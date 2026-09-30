/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type --
   A CommonJS fixture run directly by `node`, never bundled: require() is its
   module system and it carries no TypeScript annotations to return. */
/*
 * Ticket 13. Dominik's installed build put a fixed 252px rail inside an 860px
 * window beside the Dashboard — the landing surface, and the only one with its
 * own right-hand panel — and request titles wrapped one word per line.
 *
 * jsdom has no layout engine, so this measures the real thing: the app's own
 * stylesheets, in the app's own order, in headless Chrome, at the app's own
 * window widths. Chrome is launched ONCE PER WIDTH because main.css's
 * Dashboard reflow is a VIEWPORT media query — measuring several widths in one
 * page would evaluate every one of them at the same viewport, which is exactly
 * the blindness that let the defect through.
 */
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
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

if (chromeMissingReason()) throw new Error(chromeMissingReason())

/*
 * 460 and 860 are the app's own presets (NARROW_WIDTH, WIDE_WIDTH in
 * src/main/windowLayout.ts); 1440 is a genuinely wide window. The `rail: true`
 * case at 860 is the shipped defect itself, kept so the floors in the test
 * beside this are provably able to fail rather than merely passing.
 *
 * `viewport` exists because headless Chrome refuses a window narrower than
 * 500px: at `--window-size=460` it silently reports a 500px viewport, so a
 * "460px" measurement taken that way would be a 500px one wearing a label. The
 * narrow case therefore runs at the 500px floor and constrains the app shell to
 * 460px with a wrapper. That is only sound because 460 and 500 fall in the
 * same buckets of every media query in the app (they agree on max-width 500,
 * 520, 600 and 760, and on min-width 720), so the constrained frame gets the
 * same rules a real 460px window would.
 */
const cases = [
  { mode: 'dashboard', width: 460, viewport: 500, rail: false, label: 'narrow preset' },
  { mode: 'dashboard', width: 860, viewport: 860, rail: false, label: 'wide preset' },
  {
    mode: 'dashboard',
    width: 860,
    viewport: 860,
    rail: true,
    label: 'wide preset with the rail forced on (the shipped defect)'
  },
  { mode: 'dashboard', width: 1440, viewport: 1440, rail: true, label: 'genuinely wide' },

  /*
   * Ticket 04. Below the threshold the same list is the whole window, so the
   * question changes from "what is left for the surface beside it" to "is the
   * list itself legible, does it scroll, and does the footer stay put". Both of
   * the app's own presets are below the threshold, so both are front pages.
   *
   * `front page, fixed rail width` is the defect these floors are measured
   * against: the list left at the rail's drawn 252px inside the window instead
   * of filling it. It is kept permanently, as ticket 13 kept the shipped
   * defect, so the floors beside it are known to be able to fail.
   */
  {
    mode: 'front-page',
    width: 460,
    viewport: 500,
    rail: false,
    label: 'front page, narrow preset'
  },
  { mode: 'front-page', width: 860, viewport: 860, rail: false, label: 'front page, wide preset' },
  {
    mode: 'front-page',
    width: 460,
    viewport: 500,
    rail: true,
    label: 'front page, fixed rail width (the defect)'
  },

  /*
   * Pushed into a project: the titlebar carries the way back out beside the
   * scope indicator, and the tab bar returns. The surface beside them is
   * measured by the `dashboard` cases above — at both presets no rail renders,
   * so `wide preset` IS the pushed-in surface at his working width.
   */
  { mode: 'pushed-in', width: 460, viewport: 500, rail: false, label: 'pushed in, narrow preset' },
  { mode: 'pushed-in', width: 860, viewport: 860, rail: false, label: 'pushed in, wide preset' },

  /*
   * Ticket 14, the titlebar. It must hold at every width the app runs at, so
   * the third width is a genuinely wide window: there the rail is beside the
   * surface, so no way back is drawn and the bar carries the most slack it ever
   * has. The bar is the same component in every case, so this measures it at
   * 460, 860 and 1440 with the same assertions.
   */
  {
    mode: 'pushed-in',
    width: 1440,
    viewport: 1440,
    rail: false,
    back: false,
    label: 'titlebar, genuinely wide window'
  },

  /*
   * The reported defect, kept permanently: the same 460px bar with the centred
   * app name reinstated. Dominik's screenshot of 0.21.0-alpha.2 showed it
   * wrapped to three lines against the build marker with the pin off the frame.
   * Without this case the zero-overflow assertions beside it would be unfalsified.
   */
  {
    mode: 'pushed-in',
    width: 460,
    viewport: 500,
    rail: false,
    appName: true,
    label: 'pushed in, narrow preset, app name reinstated (the reported defect)'
  },
  {
    mode: 'front-page',
    width: 460,
    viewport: 500,
    rail: false,
    appName: true,
    label: 'front page, narrow preset, app name reinstated (the reported defect)'
  },

  /*
   * The same 460px bar with a two-letter project name. Its only purpose is to be
   * compared with `pushed in, narrow preset`: if the build marker and the last
   * control sit at the same pixel in both, the length of the project name
   * provably moves nothing, which is the invariant ticket 14 asks for.
   */
  {
    mode: 'pushed-in',
    width: 460,
    viewport: 500,
    rail: false,
    scopeName: 'Pi',
    label: 'pushed in, narrow preset, short project name'
  },
  {
    mode: 'pushed-in',
    width: 860,
    viewport: 860,
    rail: false,
    scopeName: 'Pi',
    label: 'pushed in, wide preset, short project name'
  }
]

/* The longest project name in his fleet. A bar proved only against a short name
   has not been proved. */
const SCOPE_NAME = 'Dev Traffic Control'

/* The two rules ticket 14 deleted from main.css, restored for the defect case
   alone. Copied verbatim from `.titlebar .app` and `.titlebar .scopechip` as
   0.21.0-alpha.2 shipped them. */
const SHIPPED_TITLEBAR_CSS = `<style>
  .titlebar.shipped-alpha2 .app {
    flex: 1;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .titlebar.shipped-alpha2 .scopechip {
    flex: none;
    min-width: auto;
    overflow: visible;
  }
  /* The shipped bar's controls were ordinary shrinkable flex items too. */
  .titlebar.shipped-alpha2 .iconbtn {
    flex: 0 1 auto;
  }
  /* …and it did not tighten itself at the narrow preset. Restoring this makes
     the case reproduce the overflow Dominik photographed, to the pixel. */
  .titlebar.shipped-alpha2 {
    gap: 6px;
    padding-right: 14px;
  }
  .titlebar.shipped-alpha2 .scopechip {
    gap: 7px;
    padding: 0 9px;
  }
  .titlebar.shipped-alpha2 .scopechip .ic.hint {
    display: inline;
  }
</style>`

// A real request title from the record repo — long enough to wrap, ordinary
// enough that wrapping it more than twice is a defect rather than an outlier.
const TITLE = 'Project scope, deep links and the date vocabulary'

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'dtc-dashboard-layout-'))
try {
  const measurements = cases.map((testCase) => measureCase(testCase))
  process.stdout.write(`${JSON.stringify({ stylesheets: appStylesheets, measurements })}\n`)
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true })
}

function measureCase({
  mode,
  width,
  viewport,
  rail,
  label,
  back = mode === 'pushed-in',
  appName = false,
  scopeName = SCOPE_NAME
}) {
  const fixturePath = join(
    fixtureDirectory,
    `${mode}-${width}-${rail ? 'rail' : 'norail'}${back ? '-back' : ''}${appName ? '-appname' : ''}-${scopeName.length}.html`
  )
  writeFileSync(fixturePath, fixtureHtml(mode, rail, width, back, appName, scopeName))
  const browser = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      `--window-size=${viewport},900`,
      '--dump-dom',
      `file://${fixturePath}`
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (browser.status !== 0) {
    throw new Error(browser.error?.message || browser.stderr || 'Chrome geometry fixture failed')
  }
  const encoded = browser.stdout.match(/<title>([^<]+)<\/title>/)?.[1]
  if (!encoded) throw new Error(`Chrome returned no measurement at ${width}px`)
  return {
    mode,
    width,
    requestedViewport: viewport,
    rail,
    label,
    ...JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  }
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

function railMarkup() {
  return `<nav class="project-rail" aria-label="Projects">
    <div class="railtop"><div class="search"><input value="" aria-label="Filter projects" placeholder="Filter projects"></div></div>
    <div class="railscroll">
      <button class="allrow on"><span class="nm">All projects</span><span class="ct">7 waiting</span></button>
      <div class="rsection">
        <div class="rgrp">Needs you</div>
        <button class="prow needs on"><span class="dot"></span><span class="pbody"><span class="nm"><span>WordForge</span></span><span class="sub">0.21.0 · <span class="owes">2 waiting on you</span></span></span></button>
        <button class="prow needs"><span class="dot"></span><span class="pbody"><span class="nm"><span>RedForge</span></span><span class="sub">0.8.0 · <span class="owes">handoff ready</span></span></span></button>
      </div>
    </div>
    <div class="railfoot"><span>Synced 5h</span><span class="rcount">12 projects</span></div>
  </nav>`
}

function rowMarkup(title) {
  return `<button class="drow2">
    <span class="spine"></span>
    <span class="body">
      <span class="ti">${title}</span>
      <span class="ctx">The row's supporting line, which shares the same column as the title.</span>
    </span>
    <span class="cproj"><span>dev-traffic-control</span></span>
    <span class="cform"><span class="chip">Test</span></span>
    <span class="cage"><span class="aged">11 Sep</span></span>
  </button>`
}

/*
 * Ticket 04's front page. The markup transcribes components/ProjectRail.tsx —
 * the same rows in the same order, since the point of the ticket is that there
 * is one list. `frontpage` is the modifier the component adds below the
 * threshold; omitting it is the defect case, where the list keeps the rail's
 * drawn 252px inside a window that has nothing to put beside it.
 *
 * The fleet is 40 projects so the list is taller than any window it runs in:
 * that is the only way to ask whether it scrolls and whether the footer stays.
 */
function fleet() {
  return [
    ['Dev Traffic Control', '0.21.0', '2 waiting on you · 4 decisions · 3 handoffs ready', 'needs'],
    ['WordForge', '0.21.0', '2 waiting on you', 'needs'],
    ['RedForge', '0.8.0', 'handoff ready', 'needs'],
    ['TallyBoard', '0.31.0', '4 decisions', 'needs'],
    ['TideWatch', 'no release', '3 waiting on you', 'needs'],
    ['Harbour Lens', '0.3.1 shipped · 12m', '', 'flight'],
    ['AtlasCompass', '2 threads · 11 Sep', '', ''],
    ['RootSync', '1 thread · 8 Sep', '', '']
  ]
}

function frontPageMarkup(frontPage) {
  const FLEET = fleet()
  const rows = []
  for (let index = 0; index < 40; index += 1) {
    const [name, lead, owes, tone] = FLEET[index % FLEET.length]
    rows.push(projectRowMarkup(index === 0 ? name : `${name} ${index + 1}`, lead, owes, tone))
  }
  return `<nav class="project-rail${frontPage ? ' frontpage' : ''}" aria-label="Projects">
    <div class="railtop"><div class="search"><input value="" aria-label="Filter projects" placeholder="Filter projects"></div></div>
    <div class="railscroll" data-list-scroll>
      <button class="allrow on"><span class="nm">All projects</span><span class="ct">7 waiting</span></button>
      <div class="rsection"><div class="rgrp">Needs you</div>${rows.join('')}</div>
    </div>
    <div class="railfoot" data-list-foot><span>Synced 5h</span><span class="rcount">40 projects</span></div>
  </nav>`
}

function projectRowMarkup(name, lead, owes, tone) {
  const sub = owes ? `${lead} · <span class="owes">${owes}</span>` : lead
  return `<button class="prow${tone ? ` ${tone}` : ''}" data-rail-row>
    <span class="dot"></span>
    <span class="pbody">
      <span class="nm"><span>${name}</span></span>
      <span class="sub">${sub}</span>
    </span>
  </button>`
}

/* The titlebar as Chrome.tsx renders it (ticket 14): the way back out when the
 * window is pushed into a project, the project chip, one empty spacer carrying
 * all the slack, the build marker and the five controls. No app name.
 *
 * `appName` reinstates the bar exactly as 0.21.0-alpha.2 shipped it: the centred
 * `<span class="app">` AND the non-shrinking `flex: none` chip that went with
 * it. Both are restored locally, because ticket 14 deleted both rules from
 * main.css and a "defect" reproduced with only half of it would not be the
 * defect. It is kept permanently — as ticket 13 kept the shipped rail and
 * ticket 04 the fixed-width list — so the overflow and wrapping assertions
 * beside it are known to be able to fail rather than merely passing.
 *
 * The project name here is the longest in his fleet, not a short one: a bar
 * that only holds for short names has not been proved to hold.
 */
function titlebarMarkup({ back, appName = false, scopeName = SCOPE_NAME }) {
  const backControl = back
    ? '<button class="scopeback" data-back><svg class="ic"></svg><span>Projects</span></button>'
    : ''
  return `${appName ? SHIPPED_TITLEBAR_CSS : ''}<header class="titlebar${appName ? ' shipped-alpha2' : ''}" data-titlebar>
    ${backControl}
    <button class="scopechip" data-scope><svg class="ic"></svg><span class="scopename" data-scope-name>${scopeName}</span><svg class="ic hint"></svg></button>
    ${appName ? '<span class="app">Dev Traffic Control</span>' : '<span class="tbspace"></span>'}
    <span class="buildtag" data-buildtag>v0.21.0-alpha.2</span>
    <button class="iconbtn"><svg class="ic"></svg></button>
    <button class="iconbtn"><svg class="ic"></svg></button>
    <button class="iconbtn"><svg class="ic"></svg></button>
    <button class="iconbtn"><svg class="ic"></svg></button>
    <button class="iconbtn" data-last-control><svg class="ic"></svg></button>
  </header>`
}

function tabsMarkup() {
  return `<nav class="surface-tabs" data-tabs><button class="on">Dashboard</button><button>Inbox</button><button>Specs</button><button>Releases</button><button>Roadmap</button><button>Handoffs</button></nav>`
}

function fixtureHtml(mode, rail, frameWidth, back, appName, scopeName) {
  if (mode === 'front-page') return frontPageHtml(!rail, frameWidth, appName, scopeName)
  if (mode === 'pushed-in') return pushedInHtml(frameWidth, back, appName, scopeName)
  return dashboardHtml(rail, frameWidth)
}

function frontPageHtml(frontPage, frameWidth, appName, scopeName) {
  return shellHtml(
    frameWidth,
    `${titlebarMarkup({ back: false, appName, scopeName })}
     <div class="surface-row" data-measure-root>${frontPageMarkup(frontPage)}</div>`
  )
}

function pushedInHtml(frameWidth, back, appName, scopeName) {
  return shellHtml(
    frameWidth,
    `${titlebarMarkup({ back, appName, scopeName })}
     ${tabsMarkup()}
     <div class="surface-row" data-measure-root><main class="viewroot"><div class="view"></div></main></div>`
  )
}

function shellHtml(frameWidth, shell) {
  return `<!doctype html>
    <html>
      <head><title>pending</title><style>${appCss}</style></head>
      <body>
        <div id="root" style="width:${frameWidth}px">
          <div class="app-shell">${shell}</div>
        </div>
        <script>
          document.title = btoa(JSON.stringify((${measure.toString()})(document.querySelector('[data-measure-root]'))))
        </script>
      </body>
    </html>`
}

function dashboardHtml(rail, frameWidth) {
  return `<!doctype html>
    <html>
      <head>
        <title>pending</title>
        <style>
          ${appCss}
        </style>
      </head>
      <body>
        <div id="root" style="width:${frameWidth}px">
          <div class="app-shell">
            <nav class="surface-tabs"><button class="on">Dashboard</button><button>Inbox</button></nav>
            <div class="surface-row" data-measure-root>
              ${rail ? railMarkup() : ''}
              <main class="viewroot">
                <div class="view roadmap">
                  <div class="modebar"><h1 class="scope">Dashboard</h1></div>
                  <div class="dash split">
                    <div class="col-deep">
                      <section class="sect primary status-section-waiting">
                        <header class="sh"><span class="pt">Waiting on you</span><span class="ct">3</span></header>
                        <div class="grouphd">wordforge <span class="ct">2</span></div>
                        ${rowMarkup(TITLE)}
                        ${rowMarkup(TITLE)}
                      </section>
                      <section class="sect">
                        <header class="sh"><span class="pt">Project vitals</span><span class="ct">2</span><span class="grow"></span><span class="hint">owed · last moved</span></header>
                        <button class="vrow"><span class="nm">dev-traffic-control</span><span class="owed"><span class="you">2 you</span></span><span class="bar off"></span><span class="out muted">—</span><span class="aged">11 Sep</span></button>
                      </section>
                    </div>
                    <div class="col-glance">
                      <section class="sect status-section-ready">
                        <header class="sh"><span class="pt">Ready to dispatch</span><span class="ct">2</span></header>
                        <button class="grow2"><span class="gb"><span class="gt">Sweep triage shell</span><span class="gm">tidewatch</span></span></button>
                      </section>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        </div>
        <script>
          document.title = btoa(JSON.stringify((${measure.toString()})(document.querySelector('[data-measure-root]'))))
        </script>
      </body>
    </html>`
}

function measure(root) {
  const box = (element) => {
    if (!element || getComputedStyle(element).display === 'none') return null
    const bounds = element.getBoundingClientRect()
    return {
      left: Math.round(bounds.left * 100) / 100,
      right: Math.round(bounds.right * 100) / 100,
      top: Math.round(bounds.top * 100) / 100,
      bottom: Math.round(bounds.bottom * 100) / 100,
      width: Math.round(bounds.width * 100) / 100,
      height: Math.round(bounds.height * 100) / 100
    }
  }

  // Per-line character counts for a single text node, measured by ranges —
  // the only honest way to ask "does this title wrap one word per line".
  const lines = (element) => {
    const node = element && element.firstChild
    if (!node) return []
    const perLine = new Map()
    for (let index = 0; index < node.textContent.length; index += 1) {
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + 1)
      const bounds = range.getBoundingClientRect()
      if (bounds.width === 0 && bounds.height === 0) continue
      const line = Math.round(bounds.top)
      perLine.set(line, (perLine.get(line) || 0) + 1)
    }
    return [...perLine.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count)
  }

  const row = root.querySelector('.drow2')
  const list = root.querySelector('.project-rail')
  const frame = root.parentElement
  const shell = frame.getBoundingClientRect()

  // ----- the project list, when the list is what is on screen (ticket 04) ---
  // "Legible" for a list row means not cut off: the name and the standing line
  // are single-line and ellipsised, so a row too narrow for them loses its
  // right-hand end silently. Clipping is therefore the measurement, and it is
  // counted across every row rather than sampled.
  const clipped = (element) => !!element && element.scrollWidth > element.clientWidth + 0.5
  const listRows = list ? [...list.querySelectorAll('.prow')] : []
  const listBox = box(list)
  const scroller = list && list.querySelector('[data-list-scroll]')
  const foot = box(list && list.querySelector('[data-list-foot]'))

  // ----- the titlebar, when it carries the way back out (mockup state 4) ----
  const titlebar = root.parentElement.querySelector('[data-titlebar]')
  const titlebarBox = box(titlebar)
  const titlebarItems = titlebar ? [...titlebar.children].map(box).filter(Boolean) : []
  // Every element in the bar that carries its own text, whatever its depth.
  const titlebarTexts = titlebar
    ? [...titlebar.querySelectorAll('*')].filter(
        (element) =>
          element.firstChild &&
          element.firstChild.nodeType === 3 &&
          element.firstChild.textContent.trim().length > 0
      )
    : []
  const backBox = box(titlebar && titlebar.querySelector('[data-back]'))
  const scopeBox = box(titlebar && titlebar.querySelector('[data-scope]'))
  const tabs = root.parentElement.querySelector('[data-tabs]')

  const titleElement = row && row.querySelector('.ti')
  const titleLines = titleElement ? lines(titleElement) : []
  const children = row ? [...row.children].map(box).filter(Boolean) : []
  // Do any two row columns sit on the same text line and overlap horizontally?
  let overlaps = 0
  for (let a = 0; a < children.length; a += 1) {
    for (let b = a + 1; b < children.length; b += 1) {
      const left = children[a]
      const right = children[b]
      const verticallyShared = left.top < right.bottom - 0.5 && right.top < left.bottom - 0.5
      const horizontallyShared = left.left < right.right - 0.5 && right.left < left.right - 0.5
      if (verticallyShared && horizontallyShared) overlaps += 1
    }
  }

  const sectionHeader = box(root.querySelector('.sect.primary .sh'))
  const groupHeading = box(root.querySelector('.grouphd'))
  const firstRow = box(row)
  const viewroot = box(root.querySelector('.viewroot'))

  return {
    viewportWidth: window.innerWidth,
    frameWidth: shell.width,
    railShown: !!box(root.querySelector('.project-rail:not(.frontpage)')),
    railWidth: box(root.querySelector('.project-rail:not(.frontpage)'))?.width ?? 0,
    surfaceWidth: viewroot?.width ?? 0,
    deepColumnWidth: box(root.querySelector('.col-deep'))?.width ?? 0,
    glanceColumnWidth: box(root.querySelector('.col-glance'))?.width ?? 0,
    titleColumnWidth: row ? box(row.querySelector('.body')).width : 0,
    titleLineCount: titleLines.length,
    minCharactersPerLine: titleLines.length ? Math.min(...titleLines) : 0,
    medianCharactersPerLine: titleLines.length
      ? [...titleLines].sort((a, b) => a - b)[Math.floor(titleLines.length / 2)]
      : 0,
    rowColumnOverlaps: overlaps,
    headingClearsTheRowBeneathIt:
      !!sectionHeader &&
      !!groupHeading &&
      !!firstRow &&
      sectionHeader.bottom <= groupHeading.top + 0.5 &&
      groupHeading.bottom <= firstRow.top + 0.5,

    // The list as the window
    listShown: !!listBox,
    listWidth: listBox?.width ?? 0,
    listRowCount: listRows.length,
    // Rows whose name or standing line is cut off by the width they were given.
    clippedRowNames: listRows.filter((prow) => clipped(prow.querySelector('.nm span'))).length,
    clippedRowSubs: listRows.filter((prow) => clipped(prow.querySelector('.sub'))).length,
    narrowestRowNameWidth: listRows.length
      ? Math.min(...listRows.map((prow) => box(prow.querySelector('.pbody')).width))
      : 0,
    // Rows must lie inside the list they belong to, not spill past its edge.
    rowsOutsideTheList: listBox
      ? listRows.filter((prow) => box(prow).right > listBox.right + 0.5).length
      : 0,
    listScrolls: !!scroller && scroller.scrollHeight > scroller.clientHeight + 0.5,
    listOverflowsTheWindow: !!listBox && listBox.bottom > shell.bottom + 0.5,
    // The sync line is pinned against the bottom of the window; only the rows
    // between the filter and it move.
    footerPinnedToTheWindow: !!foot && Math.abs(foot.bottom - shell.bottom) <= 0.5,
    footerBelowTheRows:
      !!foot && !!scroller && foot.top >= scroller.getBoundingClientRect().bottom - 0.5,

    // The titlebar, pushed into a project
    titlebarShown: !!titlebarBox,
    backControlShown: !!backBox,
    backControlWidth: backBox?.width ?? 0,
    // The way back sits BESIDE the scope indicator, to its left, and both fit.
    backControlBesideTheScope: !!backBox && !!scopeBox && backBox.right <= scopeBox.left + 0.5,
    scopeNameClipped: clipped(titlebar && titlebar.querySelector('.scopename')),
    titlebarOverflows: !!titlebar && titlebar.scrollWidth > titlebar.clientWidth + 0.5,
    titlebarOverflowPx: titlebar ? Math.max(0, titlebar.scrollWidth - titlebar.clientWidth) : 0,
    // The rightmost control in the titlebar — the pin — must still be reachable.
    lastTitlebarControlInsideFrame: titlebar
      ? box(titlebar.lastElementChild).right <= shell.right + 0.5
      : false,
    // Ticket 14. Not just the last one: every item in the bar, counted, so a
    // control that has been pushed off either edge cannot hide behind a
    // neighbour that happens to fit.
    titlebarItemsOutsideFrame: titlebarItems.filter(
      (item) => item.right > shell.right + 0.5 || item.left < shell.left - 0.5
    ).length,
    titlebarItemCount: titlebarItems.length,
    // Wrapping is the other half of the reported defect: the app name became
    // three stacked lines rather than one long one. Counted by measuring the
    // distinct line boxes of every text node in the bar, since an element that
    // wraps inside a fixed-height bar does not change the bar's height.
    titlebarElementsWrappingToASecondLine: titlebarTexts.filter(
      (element) => lines(element).length > 1
    ).length,
    // The build marker and the last control are the two things a long project
    // name must not be able to move. Their right edges are reported so the same
    // bar with a short name can be compared against this one, pixel for pixel.
    buildTagRight: box(titlebar && titlebar.querySelector('[data-buildtag]'))?.right ?? 0,
    buildTagWidth: box(titlebar && titlebar.querySelector('[data-buildtag]'))?.width ?? 0,
    lastTitlebarControlRight:
      box(titlebar && titlebar.querySelector('[data-last-control]'))?.right ?? 0,
    scopeChipWidth: scopeBox?.width ?? 0,
    // How much of the project's name the chip actually draws. A chip squeezed to
    // its icons names nothing, which is the same failure as printing the name
    // twice: the header would say the project zero times.
    scopeNameWidth: box(titlebar && titlebar.querySelector('[data-scope-name]'))?.width ?? 0,
    tabsOverflow: !!tabs && tabs.scrollWidth > tabs.clientWidth + 0.5,
    tabCount: tabs ? tabs.children.length : 0
  }
}
