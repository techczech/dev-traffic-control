/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import type {
  DockPlaceId,
  InboxState,
  ArchiveOldInput,
  ArchiveOldResult,
  QaSnapshot,
  SerializableRun,
  Settings,
  ViewState
} from '../../../shared/ipc'
import { CommandProvider } from '../commands/provider'
import type { InspectorTarget } from '../components/Inspector'
import type { Housekeeping } from '../lib/projectStanding'
import type { ListMode } from '../lib/shellLayout'
import { panelForSurface, setPanelForSurface, togglePanelForSurface } from '../lib/rightPanelState'
import type { RightPanel } from '../lib/rightPanelState'
import { ALL_PROJECTS, sameScope, type WindowScope } from '../../../shared/windowScope'
import type { DeepLinkLanding, DeepLinkView } from '../../../shared/deepLink'

/** The six persistent surfaces in their command-bar order. */
export const TOP_LEVEL_SURFACES = [
  'dashboard',
  'inbox',
  'specs',
  'releases',
  'roadmap',
  'handoffs'
] as const
export type TopLevelSurface = (typeof TOP_LEVEL_SURFACES)[number]

export function isTopLevelSurface(kind: string): kind is TopLevelSurface {
  return (TOP_LEVEL_SURFACES as readonly string[]).includes(kind)
}

/**
 * The four surfaces that only mean something inside one project. Under *All
 * projects* they are drawn as not applicable (mockup states 16 and 17) rather
 * than showing some project's content or an arbitrary merge.
 */
export const PROJECT_ONLY_SURFACES = ['specs', 'releases', 'roadmap', 'handoffs'] as const
export type ProjectOnlySurface = (typeof PROJECT_ONLY_SURFACES)[number]

export function surfaceApplies(kind: string, scope: WindowScope): boolean {
  return scope.kind === 'project' || !(PROJECT_ONLY_SURFACES as readonly string[]).includes(kind)
}

/** Where a window lands when it enters a project it has not been in before. */
const DEFAULT_PROJECT_SURFACE: TopLevelSurface = 'dashboard'

/** How long the opened-arrival banner lingers before standing itself down. */
const OPENED_ARRIVAL_MS = 20_000

export type View =
  | { kind: 'dashboard' }
  | { kind: 'inbox' }
  | { kind: 'specs'; mode?: 'documents' | 'questions'; questionKey?: string }
  /** A link can open a release at one version and feature (2026-09-26). */
  | { kind: 'releases'; version?: string; feature?: string }
  | { kind: 'roadmap'; idea?: string }
  | { kind: 'handoffs'; path?: string }
  | { kind: 'thread'; project: string; thread: string; search?: SearchLanding }
  | { kind: 'runner'; path: string; detailed?: boolean; search?: SearchLanding }
  | { kind: 'settings' }
  /** Ticket 34: how to connect agents, and the example project. */
  | { kind: 'get-started' }
  | { kind: 'note'; path: string; search?: SearchLanding }
  | { kind: 'note'; newIn: string; linkedRun?: string; fromRun?: string }

export type ViewHistoryAction =
  { type: 'navigate'; view: View } | { type: 'land'; history: View[] } | { type: 'back' }

/** The history reducer is the single transition seam for every surface and detail view. */
export function viewHistoryReducer(history: View[], action: ViewHistoryAction): View[] {
  if (action.type === 'navigate') return [...history, action.view]
  // A link-born window is born with its whole history at once: the record on
  // top and its project home beneath it. No sequence of pushes builds that
  // starting state, so it arrives as one whole.
  if (action.type === 'land') return action.history
  return history.length > 1 ? history.slice(0, -1) : history
}

export function currentView(history: readonly View[]): View {
  return history[history.length - 1] ?? { kind: 'dashboard' }
}

/**
 * The whole history a link-born window starts with (ADR-0016 § 5). Overview
 * sits beneath a record, so Back returns to the linked project's home. Main
 * already scoped the window to that project; no slug is carried here.
 */
export function landingHistory(target: DeepLinkView): View[] {
  if (target.kind === 'project') return [{ kind: 'dashboard' }]
  const record: View =
    target.kind === 'runner'
      ? { kind: 'runner', path: target.path }
      : target.kind === 'note'
        ? { kind: 'note', path: target.path }
        : target.kind === 'release'
          ? {
              kind: 'releases',
              version: target.version,
              ...(target.feature ? { feature: target.feature } : {})
            }
          : target.kind === 'roadmap'
            ? { kind: 'roadmap', idea: target.idea }
            : target.kind === 'handoff'
              ? { kind: 'handoffs', path: target.path }
              : { kind: 'thread', project: target.project, thread: target.thread }
  return [{ kind: 'dashboard' }, record]
}

/**
 * Where entering a project lands, from the surface that window last used in
 * it. The slot stores a bare string, so alpha.10/11 may still name `home` or
 * the older `project` view. Both now land on Overview.
 */
export function projectEntryView(remembered: string | undefined): View {
  if (remembered && isTopLevelSurface(remembered)) return { kind: remembered }
  if (remembered === 'home' || remembered === 'project') return { kind: 'dashboard' }
  return { kind: DEFAULT_PROJECT_SURFACE }
}

/** The renderer reflects the live per-window layout; pinBehaviour is creation-only. */
export function deriveLivePinState(
  windowSettings: Pick<Settings, 'pinBehaviour' | 'pinned'> | null
): boolean {
  return windowSettings?.pinned ?? false
}

export type SwitcherMode = 'nav' | 'link'
export type CommandPaletteMode = 'all' | 'contextual'
export interface SearchLanding {
  file: string
  line: number
  query: string
}

interface AppContextValue {
  snapshot: QaSnapshot | null
  settings: Settings | null
  view: View
  navigate: (v: View) => void
  back: () => void
  canGoBack: boolean
  // The window scope (ADR-0016 § 1). It is deliberately NOT part of `view`:
  // were it a property of a view, back would pop it. A window that has never
  // been scoped reads as All projects without persisting that as a choice.
  scope: WindowScope
  setScope: (scope: WindowScope) => void
  /**
   * The one way into the project home, behind all three doors: the scope
   * indicator's menu, ⌘⇧H, and the rail row of the project already in scope.
   * Does nothing under *All projects*, and never stacks the home on itself.
   */
  openProjectHome: () => void
  /**
   * "Show me this project", from anywhere that names one: its home. A window
   * in another scope enters that project first, because the home shows only
   * the window's own project. The single route the Inbox, the dashboard, a
   * link's fallback and leaving a record all take.
   */
  openProject: (slug: string) => void
  // The narrow presentation only (ADR-0016 § 2): is this window showing the
  // project list as its front page, or has it pushed into a scope? Like the
  // scope, it lives outside the view-history reducer — the way back out to the
  // list is not the view-history back, and must not pop a view.
  onFrontPage: boolean
  /** Ticket 23: browsing projects with the list out, or focused on one. */
  listMode: ListMode
  setListMode: (mode: ListMode) => void
  /** Focus a project: its Overview, the list put away. */
  focusProject: (slug: string) => void
  /** Home: All projects, focus mode, the fleet Overview full width. */
  goHome: () => void
  /** The back control beside the scope indicator. Leaves the scope alone. */
  returnToFrontPage: () => void
  /** Pushed in: any deliberate navigation, and the wide presentation. */
  leaveFrontPage: () => void
  // Deep links (ADR-0016 § 5). The window was BORN for this link — main
  // resolved and confined it before the window existed — so nothing here parses
  // a URL or touches a path. Held outside the view history: it is a thing that
  // happened to the window, not a place in it.
  linkArrival: DeepLinkLanding | null
  /** True until the window knows whether it was opened by a link. */
  linkArrivalPending: boolean
  dismissLinkArrival: () => void
  /** Sync lag only: pull the record folder, then open the record if it landed. */
  retryLinkArrival: () => void
  linkRetryInFlight: boolean
  selectedPath: string | null
  setSelectedPath: (path: string | null) => void
  pinned: boolean
  setPinned: (value: boolean) => void
  togglePin: () => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  switcherOpen: boolean
  setSwitcherOpen: (open: boolean) => void
  // Switcher modes: 'nav' navigates on Enter; 'link' returns the chosen run to a
  // callback (the Note editor's "Link a run…") and shows runs only.
  switcherMode: SwitcherMode
  openSwitcher: () => void
  openLinkSwitcher: (onPick: (run: SerializableRun) => void) => void
  pickSwitcherLink: (run: SerializableRun) => void
  commandPaletteOpen: boolean
  commandPaletteMode: CommandPaletteMode
  openCommandPalette: (mode?: CommandPaletteMode) => void
  closeCommandPalette: () => void
  searchEverythingOpen: boolean
  openSearchEverything: () => void
  closeSearchEverything: () => void
  inspectorTarget: InspectorTarget | null
  rightPanel: RightPanel
  setRightPanel: (panel: RightPanel) => void
  toggleInspector: () => void
  toast: string | null
  showToast: (message: string) => void
  changeSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  // First-run signal (settings file absent at launch); null until resolved.
  firstRun: boolean | null
  // Re-pull settings from main (after an out-of-band change like onboarding).
  reloadSettings: () => void
  // Run session: the Runner's focus/list layout, persisted through Settings.
  runnerMode: Settings['runnerMode']
  setRunnerMode: (mode: Settings['runnerMode']) => void
  // Window feel (relief pass R1): main owns the resize/dock, so these go through
  // dedicated IPC (not setSetting) and reflect the settings main returns.
  setWidthPreset: (preset: Settings['widthPreset']) => void
  setWindowMode: (mode: Settings['windowMode']) => void
  /** Ticket 27: dock as the sidebar at a place, or at the last-used one. The pin is untouched. */
  dock: (place: DockPlaceId | 'last') => void
  resetWindowPosition: () => void
  // Inbox state (relief pass R4): NEW markers + archive, app-local.
  seen: Set<string>
  seenLoaded: boolean
  archived: Set<string>
  markSeen: (basename: string) => void
  archiveRequest: (basename: string) => void
  unarchiveRequest: (basename: string) => void
  /** Ticket 22: what he has archived, which the owed count leaves out. */
  archivedThreads: Set<string>
  housekeeping: Housekeeping
  archiveOld: (input: ArchiveOldInput) => Promise<ArchiveOldResult['archived']>
  unarchiveThread: (id: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<QaSnapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [viewState, setViewState] = useState<ViewState>({ rightPanels: {} })
  const [history, dispatchView] = useReducer(viewHistoryReducer, [{ kind: 'dashboard' }])
  const [scope, setScopeValue] = useState<WindowScope>(ALL_PROJECTS)
  // A narrow window opens on the front page — the list of projects — because
  // that is where a scope is chosen. A restored scope is not a choice made now:
  // it stays named in the scope indicator and marked in the list.
  const [onFrontPage, setOnFrontPage] = useState(true)
  const [listMode, setListMode] = useState<ListMode>('browse')
  const [linkArrival, setLinkArrival] = useState<DeepLinkLanding | null>(null)
  const [linkArrivalPending, setLinkArrivalPending] = useState(true)
  const [linkRetryInFlight, setLinkRetryInFlight] = useState(false)
  // The opened banner's stand-down timer. Held here, beside the landing it
  // belongs to, so one place owns the banner's lifetime and the banner itself
  // stays a pure view of the state.
  const linkArrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [switcherOpen, setSwitcherOpenState] = useState(false)
  const [switcherMode, setSwitcherMode] = useState<SwitcherMode>('nav')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteMode, setCommandPaletteMode] = useState<CommandPaletteMode>('all')
  const [searchEverythingOpen, setSearchEverythingOpen] = useState(false)
  const linkCallback = useRef<((run: SerializableRun) => void) | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [inboxState, setInboxState] = useState<InboxState>({ seen: [], archived: [] })
  const [seenLoaded, setSeenLoaded] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live snapshot: pull once, then subscribe to the watcher pushes.
  useEffect(() => {
    void window.qa.getSnapshot().then(setSnapshot)
    const unsubscribeSnapshot = window.qa.onSnapshot(setSnapshot)
    const acceptInboxState = (state: InboxState): void => {
      setInboxState(state)
      setSeenLoaded(true)
    }
    const unsubscribeInbox = window.qa.onInboxState(acceptInboxState)
    // Main may change this window's layout by itself: an enlargement unpins.
    const unsubscribeWindowSettings = window.qa.onWindowSettings?.(setSettings)
    void window.qa.getSettings().then(setSettings)
    void window.qa.getViewState().then(setViewState)
    // The scope is restored from the window's own slot, never from the history.
    void window.qa
      .getWindowScope?.()
      .then((state) => state.scope && setScopeValue(state.scope))
      .catch(() => {})
    void window.qa.firstRun().then(setFirstRun)
    // A failed pull remains explicitly unknown. The Inbox treats unknown rows
    // as NEW so nothing is lost; a later changed-state push can still recover.
    void window.qa
      .getInboxState()
      .then(acceptInboxState)
      .catch(() => {})
    return () => {
      unsubscribeSnapshot()
      unsubscribeInbox()
      unsubscribeWindowSettings?.()
    }
  }, [])

  const reloadSettings = useCallback(() => {
    void window.qa.getSettings().then(setSettings)
  }, [])

  // Going anywhere at all pushes off the front page: the front page is the
  // choosing of a scope, and a window that has been sent to a surface, a run or
  // the settings has chosen. `back` deliberately does not reinstate it — the
  // view history and the front page are different journeys.
  const navigate = useCallback((v: View) => {
    setOnFrontPage(false)
    dispatchView({ type: 'navigate', view: v })
  }, [])

  const back = useCallback(() => {
    dispatchView({ type: 'back' })
  }, [])

  const returnToFrontPage = useCallback(() => setOnFrontPage(true), [])
  const leaveFrontPage = useCallback(() => setOnFrontPage(false), [])

  // Applying a landing is navigation, never parsing: main has already decided
  // the verb, confined the path and picked the record out of the scanned
  // snapshot, and the scope is already persisted against this window's slot.
  const applyLanding = useCallback((landing: DeepLinkLanding) => {
    // The opened banner is news for seconds, not for the window's lifetime: it
    // stands itself down. `behind` and `refused` are unresolved states he has
    // to act on, so neither times out — a self-clearing refusal would silently
    // read as success.
    if (linkArrivalTimer.current) clearTimeout(linkArrivalTimer.current)
    if (landing.kind === 'opened') {
      linkArrivalTimer.current = setTimeout(() => {
        linkArrivalTimer.current = null
        // Only the landing this timer was armed for; a later landing stands
        // or falls on its own timer.
        setLinkArrival((current) => (current === landing ? null : current))
      }, OPENED_ARRIVAL_MS)
    }
    setLinkArrival(landing)
    // A window that exists because of a link is not sitting on the front page,
    // whichever of the three states the link ended in.
    setOnFrontPage(false)
    // Links always open in focus mode (Dominik 2026-09-26): the record, not
    // the project list.
    setListMode('focus')
    if (landing.kind === 'refused') return
    // Main scoped this window to the link's project before it existed
    // (`scopeForArrival`); mirroring that here means the home beneath the
    // landing never waits on the slot's reply to know whose home it is.
    const linked: WindowScope = { kind: 'project', slug: landing.project }
    setScopeValue((current) => (sameScope(current, linked) ? current : linked))
    if (landing.kind !== 'opened') return
    dispatchView({ type: 'land', history: landingHistory(landing.view) })
  }, [])

  // The renderer PULLS its link once it has mounted. Main cannot push one: a
  // send to a renderer that has not mounted is dropped silently, and on a cold
  // launch that is every time (mechanism.md § 2).
  useEffect(() => {
    let cancelled = false
    const claim = window.qa.takeDeepLink?.()
    if (!claim) {
      setLinkArrivalPending(false)
      return
    }
    void claim
      .then((landing) => {
        if (!cancelled && landing) applyLanding(landing)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLinkArrivalPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyLanding])

  // The stand-down timer never outlives the window that armed it.
  useEffect(
    () => () => {
      if (linkArrivalTimer.current) clearTimeout(linkArrivalTimer.current)
    },
    []
  )

  const dismissLinkArrival = useCallback(() => {
    // A manual dismiss also cancels the timer: once he has stood the banner
    // down himself it must never fire again.
    if (linkArrivalTimer.current) {
      clearTimeout(linkArrivalTimer.current)
      linkArrivalTimer.current = null
    }
    setLinkArrival(null)
  }, [])

  // Changing scope is its own transition, never a view. Entering a project
  // lands on the surface last used in that project, so the return trip resumes
  // rather than restarting.
  const setScope = useCallback((next: WindowScope) => {
    setScopeValue((current) => (sameScope(current, next) ? current : next))
    // Picking from the front page pushes into what was picked — including
    // *All projects*, which is a scope of its own and lands on its own surface
    // rather than on the list it was picked from. Set here and not in the
    // reply below, which only runs for a project.
    setOnFrontPage(false)
    void window.qa
      .setWindowScope?.(next)
      .then((state) => {
        if (next.kind !== 'project') return
        dispatchView({
          type: 'navigate',
          view: projectEntryView(state.lastSurfaceByProject[next.slug])
        })
      })
      .catch(() => {})
  }, [])

  const homeReachable = scope.kind === 'project'
  const onHome = currentView(history).kind === 'dashboard'
  const openProjectHome = useCallback(() => {
    if (!homeReachable) return
    setOnFrontPage(false)
    if (!onHome) dispatchView({ type: 'navigate', view: { kind: 'dashboard' } })
  }, [homeReachable, onHome])

  const scopeSlug = scope.kind === 'project' ? scope.slug : null
  const openProject = useCallback(
    (slug: string) => {
      setOnFrontPage(false)
      if (scopeSlug !== slug) {
        // Asking to see a project selects its scope and Overview together.
        const next: WindowScope = { kind: 'project', slug }
        setScopeValue(next)
        void window.qa.setWindowScope?.(next)?.catch(() => {})
        dispatchView({ type: 'navigate', view: { kind: 'dashboard' } })
        return
      }
      if (!onHome) dispatchView({ type: 'navigate', view: { kind: 'dashboard' } })
    },
    [scopeSlug, onHome]
  )

  const focusProject = useCallback(
    (slug: string) => {
      openProject(slug)
      setListMode('focus')
    },
    [openProject]
  )
  const goHome = useCallback(() => {
    setOnFrontPage(false)
    setListMode('focus')
    if (scopeSlug !== null) {
      setScopeValue(ALL_PROJECTS)
      void window.qa.setWindowScope?.(ALL_PROJECTS)?.catch(() => {})
    }
    dispatchView({ type: 'navigate', view: { kind: 'dashboard' } })
  }, [scopeSlug])

  const changeSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    void window.qa
      .setSetting(key, value)
      .then(setSettings)
      .catch(() => {})
  }, [])

  const pinned = deriveLivePinState(settings)

  const setPinned = useCallback((value: boolean) => {
    void window.qa.setPinned(value).then(setSettings)
  }, [])

  const togglePin = useCallback(() => setPinned(!pinned), [pinned, setPinned])

  // Closing always returns the switcher to plain navigation and drops any
  // pending link callback, so a later ⌘K never leaks into link mode.
  const setSwitcherOpen = useCallback((open: boolean) => {
    if (open) {
      setSwitcherMode('nav')
      linkCallback.current = null
    } else {
      setSwitcherMode('nav')
      linkCallback.current = null
    }
    setSwitcherOpenState(open)
  }, [])

  const openSwitcher = useCallback(() => {
    setSwitcherMode('nav')
    linkCallback.current = null
    setSwitcherOpenState(true)
  }, [])

  const openLinkSwitcher = useCallback((onPick: (run: SerializableRun) => void) => {
    linkCallback.current = onPick
    setSwitcherMode('link')
    setSwitcherOpenState(true)
  }, [])

  const pickSwitcherLink = useCallback((run: SerializableRun) => {
    const cb = linkCallback.current
    linkCallback.current = null
    setSwitcherMode('nav')
    setSwitcherOpenState(false)
    cb?.(run)
  }, [])

  const openCommandPalette = useCallback((mode: CommandPaletteMode = 'all') => {
    setCommandPaletteMode(mode)
    setCommandPaletteOpen(true)
  }, [])
  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
    setCommandPaletteMode('all')
  }, [])
  const openSearchEverything = useCallback(() => setSearchEverythingOpen(true), [])
  const closeSearchEverything = useCallback(() => setSearchEverythingOpen(false), [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  // Sync lag, not refusal (mockup state 21 against 22). The retry goes back to
  // main with the URL and main re-parses and re-confines it from scratch — the
  // renderer is never the thing that decides a path is safe the second time.
  const retryLinkArrival = useCallback(() => {
    setLinkArrival((current) => {
      if (!current || current.kind !== 'behind') return current
      setLinkRetryInFlight(true)
      void window.qa
        .retryDeepLink(current.url)
        .then((result) => {
          if (result.pullFailed) showToast(result.pullFailed)
          applyLanding(result.landing)
        })
        .catch(() => showToast('The record folder could not be pulled.'))
        .finally(() => setLinkRetryInFlight(false))
      return current
    })
  }, [applyLanding, showToast])

  useEffect(() => {
    return (
      window.qa.onSettingsWriteFailed?.((failure) => {
        showToast(failure.message)
        void window.qa
          .getSettings()
          .then(setSettings)
          .catch(() => {})
      }) ?? (() => {})
    )
  }, [showToast])

  useEffect(() => window.qa.onRefreshStale?.(showToast) ?? (() => {}), [showToast])

  const view = currentView(history)

  // Filed against the slug, not the scope object, so main's reply cannot feed
  // this effect back into itself.
  const scopedProject = scope.kind === 'project' ? scope.slug : null
  useEffect(() => {
    if (!scopedProject || !isTopLevelSurface(view.kind)) return
    void window.qa.rememberProjectSurface?.(view.kind).catch(() => {})
  }, [scopedProject, view.kind])

  const inspectorTarget = useMemo<InspectorTarget | null>(() => {
    if (view.kind === 'runner') return { kind: 'run', path: view.path }
    if (view.kind !== 'thread' || !snapshot) return null
    const thread = snapshot.threads.find((candidate) => candidate.id === view.thread)
    return thread
      ? { kind: 'thread', id: thread.id, files: thread.entries.map((entry) => entry.path) }
      : null
  }, [view, snapshot])
  const surfaceKey =
    inspectorTarget?.kind === 'run'
      ? `run:${inspectorTarget.path}`
      : inspectorTarget
        ? `thread:${inspectorTarget.id}`
        : null
  const runIsReview =
    inspectorTarget?.kind === 'run' &&
    snapshot?.runs.find((run) => run.request.path === inspectorTarget.path)?.request.mode ===
      'doc-review'
  const rightPanel = surfaceKey
    ? Object.prototype.hasOwnProperty.call(viewState.rightPanels, surfaceKey)
      ? panelForSurface(viewState.rightPanels, surfaceKey)
      : runIsReview
        ? 'ledger'
        : 'closed'
    : 'closed'
  const setRightPanel = useCallback(
    (panel: RightPanel) => {
      if (!surfaceKey) return
      const rightPanels = setPanelForSurface(viewState.rightPanels, surfaceKey, panel)
      setViewState({ rightPanels })
      void window.qa.setRightPanels(rightPanels).then(setViewState)
    },
    [surfaceKey, viewState.rightPanels]
  )
  const toggleInspector = useCallback(() => {
    if (!surfaceKey) return
    const rightPanels = togglePanelForSurface(viewState.rightPanels, surfaceKey, 'inspector')
    setViewState({ rightPanels })
    void window.qa.setRightPanels(rightPanels).then(setViewState)
  }, [surfaceKey, viewState.rightPanels])

  const runnerMode = settings?.runnerMode ?? 'focus'
  const setRunnerMode = useCallback(
    (mode: Settings['runnerMode']) => changeSetting('runnerMode', mode),
    [changeSetting]
  )

  const setWidthPreset = useCallback((preset: Settings['widthPreset']) => {
    void window.qa.setWidthPreset(preset).then(setSettings)
  }, [])
  const setWindowMode = useCallback((mode: Settings['windowMode']) => {
    void window.qa.setWindowMode(mode).then(setSettings)
  }, [])
  const dock = useCallback((place: DockPlaceId | 'last') => {
    void window.qa.dock(place).then(setSettings)
  }, [])
  const resetWindowPosition = useCallback(() => {
    void window.qa.resetWindowPosition().then(setSettings)
  }, [])

  const seen = useMemo(() => new Set(inboxState.seen), [inboxState.seen])
  const archived = useMemo(() => new Set(inboxState.archived), [inboxState.archived])
  const archivedThreads = useMemo(
    () => new Set(inboxState.archivedThreads ?? []),
    [inboxState.archivedThreads]
  )
  const snapshotRoot = snapshot?.root ?? ''
  const housekeeping = useMemo<Housekeeping>(
    () => ({ root: snapshotRoot, requests: archived, threads: archivedThreads }),
    [snapshotRoot, archived, archivedThreads]
  )
  const archiveOld = useCallback(async (input: ArchiveOldInput) => {
    const result = await window.qa.archiveOld(input)
    setInboxState(result.inbox)
    return result.archived
  }, [])
  const unarchiveThread = useCallback((id: string) => {
    setInboxState((s) => ({
      ...s,
      archivedThreads: (s.archivedThreads ?? []).filter((value) => value !== id)
    }))
    void window.qa
      .unarchiveThread(id)
      .then(setInboxState)
      .catch(() => {})
  }, [])
  // Optimistic: reflect the change at once, then reconcile with main's return.
  const markSeen = useCallback((basename: string) => {
    setInboxState((s) => (s.seen.includes(basename) ? s : { ...s, seen: [...s.seen, basename] }))
    void window.qa
      .markSeen(basename)
      .then((state) => {
        setInboxState(state)
        setSeenLoaded(true)
      })
      .catch(() => {})
  }, [])
  const archiveRequest = useCallback((basename: string) => {
    setInboxState((s) =>
      s.archived.includes(basename) ? s : { ...s, archived: [...s.archived, basename] }
    )
    void window.qa
      .archiveRequest(basename)
      .then((state) => {
        setInboxState(state)
        setSeenLoaded(true)
      })
      .catch(() => {})
  }, [])
  const unarchiveRequest = useCallback((basename: string) => {
    setInboxState((s) => ({ ...s, archived: s.archived.filter((b) => b !== basename) }))
    void window.qa
      .unarchiveRequest(basename)
      .then((state) => {
        setInboxState(state)
        setSeenLoaded(true)
      })
      .catch(() => {})
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      snapshot,
      settings,
      view,
      navigate,
      back,
      canGoBack: history.length > 1,
      scope,
      setScope,
      openProjectHome,
      openProject,
      onFrontPage,
      returnToFrontPage,
      listMode,
      setListMode,
      focusProject,
      goHome,
      leaveFrontPage,
      linkArrival,
      linkArrivalPending,
      dismissLinkArrival,
      retryLinkArrival,
      linkRetryInFlight,
      selectedPath,
      setSelectedPath,
      pinned,
      setPinned,
      togglePin,
      helpOpen,
      setHelpOpen,
      switcherOpen,
      setSwitcherOpen,
      switcherMode,
      openSwitcher,
      openLinkSwitcher,
      pickSwitcherLink,
      commandPaletteOpen,
      commandPaletteMode,
      openCommandPalette,
      closeCommandPalette,
      searchEverythingOpen,
      openSearchEverything,
      closeSearchEverything,
      inspectorTarget,
      rightPanel,
      setRightPanel,
      toggleInspector,
      toast,
      showToast,
      changeSetting,
      firstRun,
      reloadSettings,
      runnerMode,
      setRunnerMode,
      setWidthPreset,
      setWindowMode,
      dock,
      resetWindowPosition,
      seen,
      seenLoaded,
      archived,
      markSeen,
      archiveRequest,
      unarchiveRequest,
      archivedThreads,
      housekeeping,
      archiveOld,
      unarchiveThread
    }),
    [
      snapshot,
      settings,
      view,
      navigate,
      back,
      history.length,
      scope,
      setScope,
      openProjectHome,
      openProject,
      onFrontPage,
      returnToFrontPage,
      listMode,
      setListMode,
      focusProject,
      goHome,
      leaveFrontPage,
      linkArrival,
      linkArrivalPending,
      dismissLinkArrival,
      retryLinkArrival,
      linkRetryInFlight,
      selectedPath,
      pinned,
      setPinned,
      togglePin,
      helpOpen,
      switcherOpen,
      setSwitcherOpen,
      switcherMode,
      openSwitcher,
      openLinkSwitcher,
      pickSwitcherLink,
      commandPaletteOpen,
      commandPaletteMode,
      openCommandPalette,
      closeCommandPalette,
      searchEverythingOpen,
      openSearchEverything,
      closeSearchEverything,
      inspectorTarget,
      rightPanel,
      setRightPanel,
      toggleInspector,
      toast,
      showToast,
      changeSetting,
      firstRun,
      reloadSettings,
      runnerMode,
      setRunnerMode,
      setWidthPreset,
      setWindowMode,
      dock,
      resetWindowPosition,
      seen,
      seenLoaded,
      archived,
      markSeen,
      archiveRequest,
      unarchiveRequest,
      archivedThreads,
      housekeeping,
      archiveOld,
      unarchiveThread
    ]
  )

  return (
    <AppContext.Provider value={value}>
      <CommandProvider
        overrides={settings?.keymap ?? {}}
        onOverridesChange={(keymap) => changeSetting('keymap', keymap)}
      >
        {children}
      </CommandProvider>
    </AppContext.Provider>
  )
}
