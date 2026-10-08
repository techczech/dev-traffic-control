import { AppProvider, useApp } from './state/app'
import { Chrome } from './components/Chrome'
import { KeyHintBar } from './components/KeyHintBar'
import { windowTitle } from './lib/windowTitle'
import { CheatSheet } from './components/CheatSheet'
import { Inbox } from './views/Inbox'
import { Dashboard, ThreadView } from './views/Dashboard'
import { Specs } from './views/Specs'
import { Releases } from './views/Releases'
import { RoadmapSwitch } from './views/RoadmapSwitch'
import { Handoffs } from './views/Handoffs'
import { FeatureRequests } from './views/FeatureRequests'
import { Runner } from './views/Runner'
import { NoteEditor } from './views/NoteEditor'
import { Settings } from './views/Settings'
import { Onboarding } from './views/Onboarding'
import { GetStarted } from './views/GetStarted'
import { Switcher } from './components/Switcher'
import { CommandPalette } from './components/CommandPalette'
import { FindBar } from './components/FindBar'
import { Inspector } from './components/Inspector'
import { SearchEverything } from './components/SearchEverything'
import { SearchLanding } from './components/SearchLanding'
import { useCommandScope } from './commands/provider'
import { useEffect, useState } from 'react'
import { readingTextSizeClass, stepReadingTextSize } from '../../shared/ipc'
import { SurfaceTabs as UnsafeSurfaceTabs } from './components/SurfaceTabs'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProjectRail } from './components/ProjectRail'
import { LinkArrivalBanner, LinkArrivalTakeover } from './components/LinkArrival'
import { useProjectListPresentation } from './lib/railVisibility'
import { shellLayout } from './lib/shellLayout'
import { ScopeIndicator } from './components/ScopeIndicator'
import { TOP_LEVEL_SURFACES, surfaceApplies } from './state/app'
import { NotInScope } from './views/NotInScope'
import { ALL_PROJECTS } from '../../shared/windowScope'
import { projectLink } from '../../shared/deepLink'
import { projectDisplayName } from './lib/projectStanding'

function isTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

function Shell(): React.JSX.Element {
  const {
    view,
    navigate,
    back,
    helpOpen,
    setHelpOpen,
    switcherOpen,
    setSwitcherOpen,
    togglePin,
    settings,
    setWidthPreset,
    dock,
    resetWindowPosition,
    openSwitcher,
    openCommandPalette,
    closeCommandPalette,
    commandPaletteOpen,
    searchEverythingOpen,
    openSearchEverything,
    inspectorTarget,
    rightPanel,
    setRightPanel,
    toggleInspector,
    snapshot,
    selectedPath,
    firstRun,
    toast,
    showToast,
    changeSetting,
    scope,
    setScope,
    openProjectHome,
    onFrontPage,
    leaveFrontPage,
    linkArrival,
    linkArrivalPending,
    listMode
  } = useApp()
  // One value decides which presentation of the project list is on screen.
  // The rail and the front page are arms of the same switch, so
  // neither can render alongside the other.
  const presentation = useProjectListPresentation(onFrontPage)
  // The wide presentation has no front page: the list is beside the content and
  // a surface is already showing. Narrowing a window that has been reading a
  // surface must not throw away the place it was in.
  useEffect(() => {
    if (presentation === 'rail') leaveFrontPage()
  }, [presentation, leaveFrontPage])

  // Links open new windows, so windows accumulate. Electron takes the window
  // title from the document title, so naming what this window holds here is
  // what makes the Window menu and Mission Control legible.
  useEffect(() => {
    document.title = windowTitle(scope, view, snapshot, presentation === 'front-page')
  }, [scope, view, snapshot, presentation])
  const [findOpen, setFindOpen] = useState(false)
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null)
  const canFind = view.kind === 'runner' || view.kind === 'thread'

  useCommandScope({
    'app.command-palette': () => openCommandPalette('all'),
    'app.navigation-switcher': openSwitcher,
    'app.contextual-actions': () => openCommandPalette('contextual'),
    'app.inspector': { enabled: !!inspectorTarget, handler: toggleInspector },
    'app.find-document': {
      enabled: canFind,
      handler: (event) => {
        setReturnFocus(event?.target instanceof HTMLElement ? event.target : null)
        setFindOpen(true)
      }
    },
    'app.search-everything': openSearchEverything,
    'app.settings': () => (view.kind === 'settings' ? back() : navigate({ kind: 'settings' })),
    'app.new-window': () => void window.qa.newWindow(),
    'app.cheat-sheet': () => setHelpOpen(!helpOpen),
    'reading.text-size-increase': settings
      ? () => changeSetting('readingTextSize', stepReadingTextSize(settings.readingTextSize, 1))
      : { enabled: false, handler: () => {} },
    'reading.text-size-decrease': settings
      ? () => changeSetting('readingTextSize', stepReadingTextSize(settings.readingTextSize, -1))
      : { enabled: false, handler: () => {} },
    'reading.text-size-reset': settings
      ? () => changeSetting('readingTextSize', 'normal')
      : { enabled: false, handler: () => {} },
    'window.toggle-pin': togglePin,
    'window.toggle-width': settings
      ? () => setWidthPreset(settings.widthPreset === 'wide' ? 'narrow' : 'wide')
      : { enabled: false, handler: () => {} },
    'window.dock': () => dock('last'),
    'window.reset-position': resetWindowPosition,
    'app.close-back': (event) => {
      if (commandPaletteOpen) closeCommandPalette()
      else if (switcherOpen) setSwitcherOpen(false)
      else if (helpOpen) setHelpOpen(false)
      else if (isTextField(event?.target ?? null)) (event?.target as HTMLElement).blur()
      else back()
    }
  })

  // First-run onboarding pre-empts every surface while the repo is still missing
  // (a freshly installed app whose default path does not resolve yet).
  const showOnboarding = firstRun === true && snapshot?.rootMissing === true
  // A link that was refused, or names a record this Mac has not got yet,
  // replaces the surface rather than sitting above it:
  // both are drawn with no tab bar, because neither is a place in the app.
  const linkTakeover = linkArrival && linkArrival.kind !== 'opened' ? linkArrival : null
  // Narrow, with no scope picked yet: the project list IS the window. Nothing
  // else is on screen — not the surfaces, and above all not the tab bar, since
  // the six surfaces belong to a scope and none has been chosen.
  // Onboarding still pre-empts everything, and a window that was
  // opened BY a link never shows the list first: it waits the one round trip it
  // takes to learn that, rather than flashing the front page and jumping.
  const showFrontPage =
    !showOnboarding && !linkTakeover && !linkArrivalPending && presentation === 'front-page'
  const layout = shellLayout(presentation, listMode)
  const showTabs =
    !showFrontPage &&
    !linkTakeover &&
    // Setup comes before any surface (drawing first-a-onboarding: no tabs).
    !showOnboarding &&
    // Get started sits under the Dash tab (drawing empty-b-get-started).
    (view.kind === 'get-started' ||
      TOP_LEVEL_SURFACES.includes(view.kind as (typeof TOP_LEVEL_SURFACES)[number]))
  const selectedFile =
    view.kind === 'runner'
      ? view.path
      : selectedPath && snapshot?.runs.some((run) => run.request.path === selectedPath)
        ? selectedPath
        : null
  useCommandScope({
    'file.reveal-selection': {
      enabled: !!selectedFile,
      handler: () => selectedFile && void window.qa.revealPath(selectedFile)
    },
    'file.copy-path': {
      enabled: !!selectedFile,
      handler: () => selectedFile && void navigator.clipboard.writeText(selectedFile)
    },
    'nav.dashboard': () => navigate({ kind: 'dashboard' }),
    'nav.get-started': () => {
      if (view.kind !== 'get-started') navigate({ kind: 'get-started' })
    },
    'nav.copy-project-link': {
      enabled: scope.kind === 'project',
      handler: () => {
        if (scope.kind !== 'project') return
        const label = projectDisplayName(snapshot?.releases, scope.slug)
        void navigator.clipboard
          ?.writeText(projectLink(scope.slug))
          .then(() => showToast(`Link to ${label} copied`))
          .catch(() => showToast('The link could not be copied.'))
      }
    },
    'nav.inbox': () => navigate({ kind: 'inbox' }),
    // The four project surfaces are not applicable under *All projects*; their
    // shortcuts are off there, as their tabs are.
    'nav.specs': {
      enabled: surfaceApplies('specs', scope),
      handler: () => navigate({ kind: 'specs' })
    },
    'nav.releases': {
      enabled: surfaceApplies('releases', scope),
      handler: () => navigate({ kind: 'releases' })
    },
    'nav.roadmap': {
      enabled: surfaceApplies('roadmap', scope),
      handler: () => navigate({ kind: 'roadmap' })
    },
    'nav.handoffs': {
      enabled: surfaceApplies('handoffs', scope),
      handler: () => navigate({ kind: 'handoffs' })
    },
    // Feature requests list across projects, so it applies under All projects too.
    'nav.requests': () => navigate({ kind: 'requests' }),
    // The home belongs to a project; under *All projects* there is none to open.
    'nav.project-home': { enabled: scope.kind === 'project', handler: openProjectHome },
    'nav.all-projects': {
      enabled: scope.kind === 'project',
      handler: () => setScope(ALL_PROJECTS)
    }
  })

  return (
    <div className={`app-shell ${readingTextSizeClass(settings?.readingTextSize)}`}>
      <Chrome layout={layout} tabs={showTabs ? <SurfaceTabs /> : null} />
      {showTabs && layout.header === 'titlebar-row' && <SurfaceTabs />}
      <LinkArrivalBanner />
      <div className="surface-row">
        {showFrontPage ? (
          <ProjectRail presentation="front-page" />
        ) : (
          <>
            {/* Two presentations of one list,
                chosen by the window's MEASURED width in lib/railVisibility.ts. Wide:
                a rail beside the content. Narrow: the same list as the whole window.
                The gate was the `widthPreset` setting, whose `wide` is a docked
                860px strip, so a 252px rail crushed the surface beside it. */}
            {!showOnboarding && layout.rail && <ProjectRail presentation="rail" />}
            <div className="pane-col">
              {/* Browse mode: the project name and tabs belong to the pane beside
                the list, not to the window. */}
              {layout.header === 'pane' && !showOnboarding && (
                <div className="panehead">
                  <ScopeIndicator />
                  {showTabs && <SurfaceTabs />}
                </div>
              )}
              <main className="viewroot">
                <FindBar
                  open={findOpen}
                  onClose={() => setFindOpen(false)}
                  returnFocus={returnFocus}
                />
                <SearchLanding landing={'search' in view ? view.search : undefined} />
                {showOnboarding ? (
                  <Onboarding />
                ) : linkTakeover ? (
                  <LinkArrivalTakeover arrival={linkTakeover} />
                ) : (
                  <ErrorBoundary
                    key={`${view.kind}:${scope.kind === 'project' ? scope.slug : ''}`}
                    label="this view"
                  >
                    {view.kind === 'inbox' && <Inbox />}
                    {view.kind === 'requests' && <FeatureRequests />}
                    {(view.kind === 'specs' ||
                      view.kind === 'releases' ||
                      view.kind === 'roadmap' ||
                      view.kind === 'handoffs') &&
                      !surfaceApplies(view.kind, scope) && <NotInScope surface={view.kind} />}
                    {surfaceApplies(view.kind, scope) && (
                      <>
                        {view.kind === 'specs' && <Specs />}
                        {view.kind === 'releases' && <Releases />}
                        {view.kind === 'roadmap' && <RoadmapSwitch />}
                        {view.kind === 'handoffs' && <Handoffs />}
                      </>
                    )}
                    {view.kind === 'dashboard' && <Dashboard />}
                    {view.kind === 'thread' && <ThreadView threadId={view.thread} />}
                    {view.kind === 'runner' && (
                      <Runner
                        key={`${view.path}:${view.detailed ? 'detailed' : 'request'}`}
                        path={view.path}
                        detailed={view.detailed}
                      />
                    )}
                    {view.kind === 'settings' && <Settings />}
                    {view.kind === 'get-started' && <GetStarted />}
                    {view.kind === 'note' &&
                      ('path' in view ? (
                        <NoteEditor key={view.path} existingPath={view.path} />
                      ) : (
                        <NoteEditor
                          key={`new:${view.newIn}:${view.linkedRun ?? ''}`}
                          newIn={view.newIn}
                          linkedRun={view.linkedRun}
                          fromRun={view.fromRun}
                        />
                      ))}
                  </ErrorBoundary>
                )}
              </main>
            </div>
            {rightPanel === 'inspector' && inspectorTarget && snapshot && (
              <Inspector
                key={inspectorTarget.kind === 'run' ? inspectorTarget.path : inspectorTarget.id}
                target={inspectorTarget}
                root={snapshot.root}
                revision={snapshot.scannedAt}
                onClose={() => setRightPanel('closed')}
              />
            )}
          </>
        )}
      </div>
      <KeyHintBar />
      <CheatSheet />
      <Switcher />
      <CommandPalette />
      <SearchEverything open={searchEverythingOpen} />
      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

/** The tab bar reads counts from every record; a bad one drops the counts, not the window. */
function SurfaceTabs(): React.JSX.Element {
  return (
    <ErrorBoundary label="the tabs" fallback={null}>
      <UnsafeSurfaceTabs />
    </ErrorBoundary>
  )
}

export default App
