import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InboxState, QaSnapshot, Settings } from '../../../../shared/ipc'
import {
  AppProvider,
  TOP_LEVEL_SURFACES,
  currentView,
  deriveLivePinState,
  landingHistory,
  projectEntryView,
  useApp,
  viewHistoryReducer
} from '../app'
import type { TopLevelSurface, View } from '../app'
import type { WindowScopeState } from '../../../../shared/windowScope'
import type { DeepLinkLanding } from '../../../../shared/deepLink'

const SNAPSHOT: QaSnapshot = {
  root: '/qa',
  rootMissing: false,
  runs: [],
  notes: [],
  entries: [],
  threads: [],
  handoffs: [],
  releases: [],
  pools: [],
  projects: [],
  scannedAt: ''
}

const SETTINGS: Settings = {
  qaRepoPath: '/qa',
  appearance: 'light',
  readingTextSize: 'normal',
  pinBehaviour: 'remember',
  pinned: false,
  dockBadge: true,
  runnerMode: 'focus',
  widthPreset: 'narrow',
  windowMode: 'free',
  verdictLayout: 'one',
  reviewMargin: 'auto',
  keymap: {},
  getStartedRetired: false
}

let windowScope: WindowScopeState = { lastSurfaceByProject: {} }
let pushInboxState: ((state: InboxState) => void) | null = null
let pushSettingsFailure: ((failure: { key: keyof Settings; message: string }) => void) | null = null
let claimedDeepLink: DeepLinkLanding | null = null
let pushWindowSettings: ((settings: Settings) => void) | null = null

const OPENED_LINK: DeepLinkLanding = {
  kind: 'opened',
  url: 'dtc://open/windmill/2026-07-27-review.md',
  project: 'windmill',
  view: { kind: 'runner', path: '/qa/windmill/2026-07-27-review.md' },
  coldLaunch: false
}

function SeenProbe(): React.JSX.Element {
  const { seen, seenLoaded } = useApp()
  return (
    <output>
      {seenLoaded === false
        ? 'unknown'
        : seenLoaded === true
          ? `known:${[...seen].join(',')}`
          : 'missing'}
    </output>
  )
}

function ScopeProbe(): React.JSX.Element {
  const { scope, setScope, navigate, back, view } = useApp()
  return (
    <div>
      <output>{`${scope.kind === 'project' ? scope.slug : 'all'}|${view.kind}`}</output>
      <button type="button" onClick={() => setScope({ kind: 'project', slug: 'windmill' })}>
        scope windmill
      </button>
      <button type="button" onClick={() => navigate({ kind: 'handoffs' })}>
        go handoffs
      </button>
      <button type="button" onClick={back}>
        back
      </button>
    </div>
  )
}

/**
 * The narrow front page is a place the window is in, beside the
 * scope and outside the view history — so it is asserted at the provider, where
 * all three meet, rather than through a rendered width.
 */
function FrontPageProbe(): React.JSX.Element {
  const { scope, view, onFrontPage, setScope, returnToFrontPage, navigate, back } = useApp()
  return (
    <div>
      <output>
        {`${onFrontPage ? 'list' : 'in'}|${scope.kind === 'project' ? scope.slug : 'all'}|${view.kind}`}
      </output>
      <button type="button" onClick={() => setScope({ kind: 'project', slug: 'windmill' })}>
        pick windmill
      </button>
      <button type="button" onClick={() => setScope({ kind: 'all' })}>
        pick all projects
      </button>
      <button type="button" onClick={() => navigate({ kind: 'handoffs' })}>
        go handoffs
      </button>
      <button type="button" onClick={returnToFrontPage}>
        back to projects
      </button>
      <button type="button" onClick={back}>
        history back
      </button>
    </div>
  )
}

function SettingsFailureProbe(): React.JSX.Element {
  const { settings, toast } = useApp()
  return <output>{`${settings?.qaRepoPath ?? 'loading'}|${toast ?? 'quiet'}`}</output>
}

function PinProbe(): React.JSX.Element {
  const app = useApp()
  return <span>{app.pinned ? 'pinned' : 'unpinned'}</span>
}

function WindowResetProbe(): React.JSX.Element {
  const app = useApp()
  const resetWindowPosition = (app as unknown as { resetWindowPosition?: () => void })
    .resetWindowPosition
  return (
    <button type="button" onClick={() => resetWindowPosition?.()}>
      {`${app.settings?.windowMode ?? 'loading'}:${app.settings?.widthPreset ?? 'loading'}`}
    </button>
  )
}

// The floor a link-born window stands on: its view, and whether any history
// lies beneath it at all.
function LinkFloorProbe(): React.JSX.Element {
  const { view, back, canGoBack, scope } = useApp()
  return (
    <div>
      <output>
        {`${scope.kind === 'project' ? scope.slug : 'all'}:${view.kind}|${canGoBack ? 'deep' : 'floor'}`}
      </output>
      <button type="button" onClick={back}>
        back
      </button>
    </div>
  )
}

function LinkArrivalProbe(): React.JSX.Element {
  const { linkArrival, dismissLinkArrival } = useApp()
  return (
    <div>
      <output>{linkArrival ? linkArrival.kind : 'cleared'}</output>
      <button type="button" onClick={dismissLinkArrival}>
        dismiss
      </button>
    </div>
  )
}

test('the view reducer reaches the seven top-level surfaces in Dashboard-first order', () => {
  expect(TOP_LEVEL_SURFACES).toEqual([
    'dashboard',
    'inbox',
    'specs',
    'releases',
    'roadmap',
    'requests',
    'handoffs'
  ])

  let history: View[] = [{ kind: 'dashboard' }]
  for (const kind of TOP_LEVEL_SURFACES) {
    history = viewHistoryReducer(history, { type: 'navigate', view: { kind } })
    expect(currentView(history)).toEqual({ kind })
  }

  const visited = new Set<TopLevelSurface>(
    history
      .map((view) => view.kind)
      .filter((kind): kind is TopLevelSurface =>
        TOP_LEVEL_SURFACES.includes(kind as TopLevelSurface)
      )
  )
  expect(visited).toEqual(new Set(TOP_LEVEL_SURFACES))
  expect(currentView(viewHistoryReducer(history, { type: 'back' }))).toEqual({
    kind: 'requests'
  })
})

test('every surface and nested view reaches Dashboard in one reducer transition', () => {
  const views: View[] = [
    { kind: 'dashboard' },
    { kind: 'inbox' },
    { kind: 'specs' },
    { kind: 'specs', mode: 'questions', questionKey: 'spec:question' },
    { kind: 'releases' },
    { kind: 'roadmap' },
    { kind: 'requests' },
    { kind: 'handoffs' },
    { kind: 'thread', project: 'dev-traffic-control', thread: 'tabs' },
    { kind: 'runner', path: '/dtc/light.md' },
    { kind: 'runner', path: '/dtc/review.md', detailed: true },
    { kind: 'settings' },
    { kind: 'note', path: '/dtc/note.md' },
    { kind: 'note', newIn: 'dev-traffic-control', linkedRun: '/dtc/light.md' }
  ]

  for (const view of views) {
    const history = viewHistoryReducer([view], {
      type: 'navigate',
      view: { kind: 'dashboard' }
    })
    expect(currentView(history)).toEqual({ kind: 'dashboard' })
    expect(history).toHaveLength(2)
  }
})

test('Always start pinned affects creation but a live window can then be unpinned', () => {
  expect(deriveLivePinState({ pinBehaviour: 'always', pinned: true })).toBe(true)
  expect(deriveLivePinState({ pinBehaviour: 'always', pinned: false })).toBe(false)
})

// A link-born window is born with its whole history: the record on top and its
// project home beneath it, so the first Back lands among the record's siblings.
test('a landing on a record backs onto Overview', () => {
  const history = viewHistoryReducer([{ kind: 'dashboard' }], {
    type: 'land',
    history: landingHistory({ kind: 'runner', path: '/qa/windmill/2026-07-27-review.md' })
  })
  expect(currentView(history)).toEqual({
    kind: 'runner',
    path: '/qa/windmill/2026-07-27-review.md'
  })
  expect(viewHistoryReducer(history, { type: 'back' })).toEqual([{ kind: 'dashboard' }])
  expect(landingHistory({ kind: 'note', path: '/qa/windmill/n.md' })[0]).toEqual({
    kind: 'dashboard'
  })
  expect(landingHistory({ kind: 'thread', project: 'windmill', thread: 't' })[0]).toEqual({
    kind: 'dashboard'
  })
})

test('a link to a project lands on Overview with no duplicate entry beneath it', () => {
  const history = viewHistoryReducer([{ kind: 'dashboard' }], {
    type: 'land',
    history: landingHistory({ kind: 'project', slug: 'windmill' })
  })
  expect(history).toEqual([{ kind: 'dashboard' }])
  // The floor holds: back at the bottom stays where it is.
  expect(currentView(viewHistoryReducer(history, { type: 'back' }))).toEqual({ kind: 'dashboard' })
})

// The slot stores the last surface as a bare string, so a window
// from an older build may hold anything. The retired project view's kind means
// the project home; it must not fall through to the dashboard.
test('entering a project lands on its remembered surface, and a retired kind on the home', () => {
  expect(projectEntryView('releases')).toEqual({ kind: 'releases' })
  expect(projectEntryView('project')).toEqual({ kind: 'dashboard' })
  expect(projectEntryView('home')).toEqual({ kind: 'dashboard' })
  expect(projectEntryView(undefined)).toEqual({ kind: 'dashboard' })
  expect(projectEntryView('app-view')).toEqual({ kind: 'dashboard' })
})

test('Remember last keeps following the live window pin state in both directions', () => {
  expect(deriveLivePinState({ pinBehaviour: 'remember', pinned: false })).toBe(false)
  expect(deriveLivePinState({ pinBehaviour: 'remember', pinned: true })).toBe(true)
})

beforeEach(() => {
  windowScope = { lastSurfaceByProject: {} }
  pushInboxState = null
  pushSettingsFailure = null
  claimedDeepLink = null
  const bridge = {
    getSnapshot: vi.fn(async () => SNAPSHOT),
    onSnapshot: vi.fn(() => vi.fn()),
    getSettings: vi.fn(async () => SETTINGS),
    takeDeepLink: vi.fn(async () => claimedDeepLink),
    resetWindowPosition: vi.fn(async () => SETTINGS),
    getViewState: vi.fn(async () => ({ rightPanels: {} })),
    getWindowScope: vi.fn(async () => windowScope),
    setWindowScope: vi.fn(async (scope) => {
      windowScope = { ...windowScope, scope }
      return windowScope
    }),
    rememberProjectSurface: vi.fn(async (surface: string) => {
      if (windowScope.scope?.kind === 'project') {
        windowScope = {
          ...windowScope,
          lastSurfaceByProject: {
            ...windowScope.lastSurfaceByProject,
            [windowScope.scope.slug]: surface
          }
        }
      }
      return windowScope
    }),
    setRightPanels: vi.fn(async (rightPanels) => ({ rightPanels })),
    firstRun: vi.fn(async () => false),
    getInboxState: vi.fn(async () => {
      throw new Error('inbox state unavailable')
    }),
    onInboxState: vi.fn((listener: (state: InboxState) => void) => {
      pushInboxState = listener
      return vi.fn()
    }),
    onWindowSettings: vi.fn((listener: (settings: Settings) => void) => {
      pushWindowSettings = listener
      return vi.fn()
    }),
    onSettingsWriteFailed: vi.fn(
      (listener: (failure: { key: keyof Settings; message: string }) => void) => {
        pushSettingsFailure = listener
        return vi.fn()
      }
    )
  } as unknown as Window['qa']
  Object.defineProperty(window, 'qa', { configurable: true, writable: true, value: bridge })
})

afterEach(cleanup)

test('keeps seen state unknown after a failed pull, then learns a main-process push', async () => {
  render(
    <AppProvider>
      <SeenProbe />
    </AppProvider>
  )

  expect(screen.getByText('unknown')).toBeTruthy()
  await waitFor(() => expect(window.qa.getInboxState).toHaveBeenCalledTimes(1))
  expect(screen.getByText('unknown')).toBeTruthy()

  await act(async () => {
    pushInboxState?.({ seen: ['2026-07-27-opened'], archived: [] })
  })
  expect(screen.getByText('known:2026-07-27-opened')).toBeTruthy()
})

test('a settings-write failure is visible and reloads committed settings from main', async () => {
  const restored = { ...SETTINGS, qaRepoPath: '/qa/committed' }
  window.qa.getSettings = vi.fn().mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce(restored)
  render(
    <AppProvider>
      <SettingsFailureProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('/qa|quiet')).toBeTruthy())

  await act(async () => {
    pushSettingsFailure?.({
      key: 'qaRepoPath',
      message: 'Could not save Record folder. The previous value is still in use.'
    })
  })

  await waitFor(() =>
    expect(
      screen.getByText(
        '/qa/committed|Could not save Record folder. The previous value is still in use.'
      )
    ).toBeTruthy()
  )
  expect(window.qa.getSettings).toHaveBeenCalledTimes(2)
})

// Main unpins a window it saw enlarged; the pin control follows.
test('the pin control follows a layout change main pushes for this window', async () => {
  window.qa.getSettings = vi.fn(async () => ({ ...SETTINGS, pinned: true }))
  render(
    <AppProvider>
      <PinProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('pinned')).toBeTruthy())

  await act(async () => {
    pushWindowSettings?.({ ...SETTINGS, pinned: false })
  })
  expect(screen.getByText('unpinned')).toBeTruthy()
})

test('reset window position replaces stale renderer window settings with the main result', async () => {
  const docked = { ...SETTINGS, widthPreset: 'wide', windowMode: 'docked' } as const
  const reset = { ...SETTINGS, widthPreset: 'narrow', windowMode: 'free' } as const
  window.qa.getSettings = vi.fn(async () => docked)
  window.qa.resetWindowPosition = vi.fn(async () => reset)

  render(
    <AppProvider>
      <WindowResetProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('docked:wide')).toBeTruthy())

  screen.getByRole('button').click()

  await waitFor(() => expect(screen.getByText('free:narrow')).toBeTruthy())
})

// The scope belongs to the window, beside the history, never
// inside it. Asserted at the reducer seam — if the scope ever became a property
// of a view, back would pop it.
test('neither the view union nor the history reducer can carry a scope', () => {
  const source = readFileSync(path.resolve(__dirname, '../app.tsx'), 'utf8')
  const union = source.slice(
    source.indexOf('export type View ='),
    source.indexOf('export type ViewHistoryAction')
  )
  const reducer = source.slice(
    source.indexOf('export function viewHistoryReducer'),
    source.indexOf('export function currentView')
  )

  expect(union.length).toBeGreaterThan(0)
  expect(union).not.toMatch(/scope/i)
  expect(reducer.length).toBeGreaterThan(0)
  expect(reducer).not.toMatch(/scope/i)

  // Back is a slice of the history and nothing else: no other input, no other output.
  const history: View[] = [{ kind: 'dashboard' }, { kind: 'releases' }, { kind: 'roadmap' }]
  expect(viewHistoryReducer(history, { type: 'back' })).toEqual(history.slice(0, -1))
})

test('back moves through the history and leaves the window scope alone', async () => {
  render(
    <AppProvider>
      <ScopeProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('scope windmill').click()
  })
  await waitFor(() => expect(screen.getByText('windmill|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('go handoffs').click()
  })
  await waitFor(() => expect(screen.getByText('windmill|handoffs')).toBeTruthy())

  await act(async () => {
    screen.getByText('back').click()
  })
  await waitFor(() => expect(screen.getByText('windmill|dashboard')).toBeTruthy())

  // Back again pops the surface the scope change landed on; the scope stays put.
  await act(async () => {
    screen.getByText('back').click()
  })
  await waitFor(() => expect(screen.getByText('windmill|dashboard')).toBeTruthy())
  expect(window.qa.setWindowScope).toHaveBeenCalledTimes(1)
})

test('returning to a project lands on the surface last used in that project', async () => {
  windowScope = {
    scope: { kind: 'all' },
    lastSurfaceByProject: { windmill: 'releases' }
  }
  render(
    <AppProvider>
      <ScopeProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('scope windmill').click()
  })

  await waitFor(() => expect(screen.getByText('windmill|releases')).toBeTruthy())
  await waitFor(() => expect(window.qa.rememberProjectSurface).toHaveBeenCalledWith('releases'))
})

test.each(['project', 'home'])(
  'a saved %s landing from an older build migrates to Overview',
  async (saved) => {
    windowScope = { scope: { kind: 'all' }, lastSurfaceByProject: { windmill: saved } }
    render(
      <AppProvider>
        <ScopeProbe />
      </AppProvider>
    )
    await waitFor(() => expect(screen.getByText('all|dashboard')).toBeTruthy())
    await act(async () => {
      screen.getByText('scope windmill').click()
    })
    await waitFor(() => expect(screen.getByText('windmill|dashboard')).toBeTruthy())
  }
)

function OpenProjectProbe(): React.JSX.Element {
  const { scope, view, openProject, canGoBack } = useApp()
  return (
    <div>
      <output>{`${scope.kind === 'project' ? scope.slug : 'all'}|${view.kind}|${canGoBack ? 'deep' : 'floor'}`}</output>
      <button type="button" onClick={() => openProject('windmill')}>
        show windmill
      </button>
    </div>
  )
}

// "Show me this project" has one answer. From a window in another
// scope it enters the project and lands on the home — not on the surface last
// used there, because the home is what was asked for.
test('showing a project from another scope enters it and lands on Overview', async () => {
  windowScope = { scope: { kind: 'all' }, lastSurfaceByProject: { windmill: 'releases' } }
  render(
    <AppProvider>
      <OpenProjectProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('all|dashboard|floor')).toBeTruthy())
  await act(async () => {
    screen.getByText('show windmill').click()
  })
  await waitFor(() => expect(screen.getByText('windmill|dashboard|deep')).toBeTruthy())
  expect(window.qa.setWindowScope).toHaveBeenCalledWith({ kind: 'project', slug: 'windmill' })

  // Asked again from the home itself, it stacks nothing and persists nothing.
  await act(async () => {
    screen.getByText('show windmill').click()
  })
  expect(screen.getByText('windmill|dashboard|deep')).toBeTruthy()
  expect(window.qa.setWindowScope).toHaveBeenCalledTimes(1)
})

test('a window opens on the dash, not the project list, and the list is one click away', async () => {
  render(
    <AppProvider>
      <FrontPageProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())
  // The list stays reachable (scope indicator / Browse).
  await act(async () => {
    screen.getByText('back to projects').click()
  })
  await waitFor(() => expect(screen.getByText('list|all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('pick windmill').click()
  })
  await waitFor(() => expect(screen.getByText('in|windmill|dashboard')).toBeTruthy())
})

// The way back out of a project is not the view-history back: it returns to the
// list, pops no view, and above all leaves the scope alone. A back press must
// never lose the project.
test('the way back returns to the list without clearing the scope or popping a view', async () => {
  render(
    <AppProvider>
      <FrontPageProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())
  await act(async () => {
    screen.getByText('back to projects').click()
  })
  await waitFor(() => expect(screen.getByText('list|all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('pick windmill').click()
  })
  await act(async () => {
    screen.getByText('go handoffs').click()
  })
  await waitFor(() => expect(screen.getByText('in|windmill|handoffs')).toBeTruthy())

  await act(async () => {
    screen.getByText('back to projects').click()
  })
  await waitFor(() => expect(screen.getByText('list|windmill|handoffs')).toBeTruthy())
  expect(window.qa.setWindowScope).toHaveBeenCalledTimes(1)
})

// *All projects* is a scope of its own, not a fallback: picking it from the
// front page pushes into it exactly as a project does, even though the window
// was already on it and the scope value therefore does not change.
test('picking All projects from the list pushes in as well', async () => {
  render(
    <AppProvider>
      <FrontPageProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())
  await act(async () => {
    screen.getByText('back to projects').click()
  })
  await waitFor(() => expect(screen.getByText('list|all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('pick all projects').click()
  })
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())
})

test('the view-history back does not put the window back on the list', async () => {
  render(
    <AppProvider>
      <FrontPageProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())

  await act(async () => {
    screen.getByText('go handoffs').click()
  })
  await waitFor(() => expect(screen.getByText('in|all|handoffs')).toBeTruthy())

  await act(async () => {
    screen.getByText('history back').click()
  })
  await waitFor(() => expect(screen.getByText('in|all|dashboard')).toBeTruthy())
})

// A `dtc://` link opens a NEW window born with that project as its
// scope. Its history must start from that fact — the record on top, the
// record's project home beneath it — so the first Back lands among the
// record's siblings instead of on the dashboard of everything.
test('a window born from a link backs onto the record\u2019s project home, not the dashboard', async () => {
  claimedDeepLink = OPENED_LINK
  render(
    <AppProvider>
      <LinkFloorProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('windmill:runner|deep')).toBeTruthy())

  await act(async () => {
    screen.getByText('back').click()
  })
  await waitFor(() => expect(screen.getByText('windmill:dashboard|floor')).toBeTruthy())

  // The floor holds: no dashboard of everything lies beneath the project home.
  await act(async () => {
    screen.getByText('back').click()
  })
  await waitFor(() => expect(screen.getByText('windmill:dashboard|floor')).toBeTruthy())
})

test('a link to a project starts on Overview with no duplicate entry beneath it', async () => {
  claimedDeepLink = {
    kind: 'opened',
    url: 'dtc://project/windmill',
    project: 'windmill',
    view: { kind: 'project', slug: 'windmill' },
    coldLaunch: true
  }
  render(
    <AppProvider>
      <LinkFloorProbe />
    </AppProvider>
  )
  await waitFor(() => expect(screen.getByText('windmill:dashboard|floor')).toBeTruthy())
})

// The opened banner is news for seconds, not for the window's lifetime: it
// stands itself down. `behind` and `refused` are unresolved states the reviewer has to
// act on, so neither ever times out.
test('the opened banner stands itself down twenty seconds after it appears', async () => {
  vi.useFakeTimers()
  try {
    claimedDeepLink = OPENED_LINK
    render(
      <AppProvider>
        <LinkArrivalProbe />
      </AppProvider>
    )
    await act(async () => {})
    expect(screen.getByText('opened')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(19_999)
    })
    expect(screen.getByText('opened')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('cleared')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

test('a manual dismiss cancels the stand-down, and the banner never returns', async () => {
  vi.useFakeTimers()
  try {
    claimedDeepLink = OPENED_LINK
    render(
      <AppProvider>
        <LinkArrivalProbe />
      </AppProvider>
    )
    await act(async () => {})
    expect(screen.getByText('opened')).toBeTruthy()

    await act(async () => {
      screen.getByText('dismiss').click()
    })
    expect(screen.getByText('cleared')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('cleared')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

test('the behind and refused banners never time out', async () => {
  vi.useFakeTimers()
  try {
    claimedDeepLink = {
      kind: 'behind',
      url: 'dtc://open/windmill/2026-07-27-review.md',
      project: 'windmill',
      coldLaunch: false
    }
    render(
      <AppProvider>
        <LinkArrivalProbe />
      </AppProvider>
    )
    await act(async () => {})
    expect(screen.getByText('behind')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('behind')).toBeTruthy()
  } finally {
    cleanup()
    vi.useRealTimers()
  }

  vi.useFakeTimers()
  try {
    claimedDeepLink = { kind: 'refused', coldLaunch: false }
    render(
      <AppProvider>
        <LinkArrivalProbe />
      </AppProvider>
    )
    await act(async () => {})
    expect(screen.getByText('refused')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('refused')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})
