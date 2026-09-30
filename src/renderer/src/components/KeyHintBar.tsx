import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { COMMANDS } from '../commands/registry'
import { displayChord } from '../commands/keymap'
import { useCommands } from '../commands/provider'
import { selectRunnerSurface } from '../lib/lightRun'
import { useApp } from '../state/app'
import { shortVersion } from '../lib/windowTitle'

/** The permanent key-hint chrome, filtered from the same command registry. */
export function KeyHintBar(): React.JSX.Element {
  const { view, snapshot, setHelpOpen } = useApp()
  // The build marker: reference, so it sits in the footer rather than the
  // titlebar, where it was being pushed about by a long project name.
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.qa
      .getVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])
  const commands = useCommands()
  const currentRun =
    view.kind === 'runner'
      ? snapshot?.runs.find((run) => run.request.path === view.path)
      : undefined
  const surface = currentRun
    ? selectRunnerSurface(currentRun.request, !!(view.kind === 'runner' && view.detailed))
    : null
  const context =
    view.kind === 'runner'
      ? surface === 'review'
        ? 'review'
        : surface === 'light'
          ? currentRun?.request.items.some((item) => item.steps.length || item.expected.length)
            ? 'light-run-detail'
            : 'light-run'
          : 'run'
      : view.kind

  const hints = COMMANDS.filter(
    (command) => command.hintContexts?.includes(context) && commands.canRun(command.id)
  )

  return (
    <div className={`keybar${surface === 'light' ? ' lr-keybar' : ''}`}>
      {hints.map((command) => {
        const binding = commands.binding(command.id)
        if (!binding) return null
        return (
          <span className="grp" key={command.id}>
            <kbd>{displayChord(binding)}</kbd> {command.shortTitle ?? command.title}
          </span>
        )
      })}
      <span className="grow" />
      {/* The build marker lives here rather than in the titlebar: it is
          reference, not chrome, and in the header it pushed the controls
          around (Dominik, 2026-09-13). */}
      {version && <span className="buildmark">{shortVersion(version)}</span>}
      <button className="helpbtn" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}>
        <HelpCircle className="ic s" strokeWidth={2} />
      </button>
    </div>
  )
}
