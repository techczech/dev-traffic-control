import {
  ChevronLeft,
  ChevronsLeftRight,
  ChevronsRightLeft,
  House,
  List,
  Pin,
  Search,
  Settings
} from 'lucide-react'
import type { ShellLayout } from '../lib/shellLayout'
import { useApp } from '../state/app'
import { displayChord } from '../commands/keymap'
import { useCommands } from '../commands/provider'
import { ScopeIndicator } from './ScopeIndicator'
import { GetStartedButton } from './GetStartedButton'
import { DockButton } from './DockButton'
import { DTC_DASH, isOnDtcDash } from '../lib/dashLabel'
import { useProjectListPresentation } from '../lib/railVisibility'

/**
 * The titlebar: the traffic-light gap, the scope indicator (the way back out and
 * the project chip), a drag spacer, the build marker and the controls.
 *
 * It does NOT print the app's own name. A person inside the app knows which app
 * they are in, the window's own title already carries it for the window manager,
 * and the centred span that used to sit here wrapped to three lines at the 460px
 * narrow preset and collided with the build marker (ticket 14).
 *
 * Nothing here may be pushed out of place by its content: every element except
 * the project chip is `flex: none`, the spacer absorbs the slack, and the chip
 * is the only thing that gives — it ellipsises rather than displacing the build
 * marker or a control. Measured in lib/__tests__/dashboardLayout.test.ts.
 */
export function Chrome({
  layout,
  tabs
}: {
  /** Ticket 23: where the project name and tabs go, and whether the list button exists. */
  layout?: ShellLayout
  /** The tab row, drawn in the title bar in wide focus mode. */
  tabs?: React.ReactNode
}): React.JSX.Element {
  const {
    pinned,
    view,
    settings,
    back,
    canGoBack,
    listMode,
    setListMode,
    goHome,
    scope,
    onFrontPage
  } = useApp()
  const header = layout?.header ?? 'titlebar-row'

  const inSettings = view.kind === 'settings'
  const commands = useCommands()
  const wide = settings?.widthPreset === 'wide'
  const onProjectList = useProjectListPresentation(onFrontPage) === 'front-page'
  const onDash = isOnDtcDash({ scope, viewKind: view.kind, onProjectList })

  return (
    <header className={`titlebar${header === 'titlebar' ? ' with-tabs' : ''}`}>
      {/* Back is in the title bar in every mode (ticket 23). */}
      <button
        className="iconbtn tb-back"
        aria-label="Back"
        title="Back"
        disabled={!canGoBack}
        onClick={back}
      >
        <ChevronLeft className="ic" strokeWidth={2} />
      </button>
      {/* DTC Dash (was Home): always All projects, focus mode, the fleet table.
          On the left, where he looks first (2026-09-26). Icon only and neutral
          (alpha.28: the teal labelled chip read as the active project; teal now
          means only the scope chip). Pressed, like Settings, while it shows. */}
      <button
        className={`iconbtn homebtn${onDash ? ' on' : ''}`}
        aria-label={DTC_DASH}
        aria-pressed={onDash}
        title={`${DTC_DASH}: every project at a glance`}
        onClick={goHome}
      >
        <House className="ic" strokeWidth={2} />
      </button>
      {/* Browse: the project list, on the left beside DTC Dash, named (2026-09-26). */}
      {layout?.listToggle && (
        <button
          className={`browsebtn${listMode === 'browse' ? ' on' : ''}`}
          aria-pressed={listMode === 'browse'}
          title={
            listMode === 'browse'
              ? 'Hide the project list and focus this project'
              : 'Show the project list to browse projects'
          }
          onClick={() => setListMode(listMode === 'browse' ? 'focus' : 'browse')}
        >
          <List className="ic" strokeWidth={2} />
          <span>Browse</span>
        </button>
      )}
      {header !== 'pane' && <ScopeIndicator />}
      {header === 'titlebar' && tabs}
      {/* The slack lives here, not in any named element, so the build marker and
          the controls keep their place whatever the project is called. It is
          also the part of the bar left free to drag the window by. */}
      <span className="tbspace" aria-hidden="true" />
      {/* Ticket 36: Get started, then Remove example, then gone. */}
      <GetStartedButton />
      <button
        className="iconbtn"
        aria-label="Switch project, run or note"
        title={`Switch project, run or note (${displayChord(commands.binding('app.navigation-switcher'))})`}
        onClick={() => commands.run('app.navigation-switcher')}
      >
        <Search className="ic" strokeWidth={2} />
      </button>
      <button
        className="iconbtn"
        aria-label={wide ? 'Narrow the window' : 'Widen the window'}
        aria-pressed={wide}
        title={wide ? 'Narrow the window' : 'Widen the window for reading'}
        onClick={() => commands.run('window.toggle-width')}
      >
        {wide ? (
          <ChevronsRightLeft className="ic" strokeWidth={2} />
        ) : (
          <ChevronsLeftRight className="ic" strokeWidth={2} />
        )}
      </button>
      <button
        className={`iconbtn${inSettings ? ' on' : ''}`}
        aria-label="Settings"
        aria-pressed={inSettings}
        title="Settings (⌘,)"
        onClick={() => commands.run('app.settings')}
      >
        <Settings className="ic" strokeWidth={2} />
      </button>
      {/* Ticket 27: Dock is where the window goes, beside the pin, which only
          says whether it stays on top. */}
      <DockButton />
      <button
        className={`iconbtn${pinned ? ' on' : ''}`}
        aria-pressed={pinned}
        aria-label="Pin beside the app under test"
        title={
          pinned
            ? `Pinned beside the app under test (${displayChord(commands.binding('window.toggle-pin'))})`
            : `Pin beside the app under test (${displayChord(commands.binding('window.toggle-pin'))})`
        }
        onClick={() => commands.run('window.toggle-pin')}
      >
        <Pin className="ic" strokeWidth={2} />
      </button>
    </header>
  )
}
