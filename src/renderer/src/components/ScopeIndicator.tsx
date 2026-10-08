import { ArrowLeft, ChevronDown, Folder, Layers } from 'lucide-react'
import { useApp } from '../state/app'
import { useCommands } from '../commands/provider'
import { projectDisplayName } from '../lib/projectStanding'
import { useProjectListPresentation } from '../lib/railVisibility'

/** The scope name is also the door to the searchable project switcher. */
export function ScopeIndicator(): React.JSX.Element {
  const { scope, snapshot, onFrontPage, returnToFrontPage } = useApp()
  const commands = useCommands()
  const presentation = useProjectListPresentation(onFrontPage)
  const all = scope.kind === 'all'
  const label = all ? 'All projects' : projectDisplayName(snapshot?.releases, scope.slug)

  return (
    <>
      {presentation === 'pushed-in' && (
        <button
          type="button"
          className="scopeback"
          aria-label="Back to the project list"
          title="Back to the project list"
          onClick={returnToFrontPage}
        >
          <ArrowLeft className="ic" strokeWidth={2} />
          <span>Projects</span>
        </button>
      )}
      <button
        type="button"
        className={`scopechip${all ? ' all' : ''}`}
        aria-label={`Scope: ${label}. Switch project`}
        title={`${label} — switch project`}
        onClick={() => commands.run('app.navigation-switcher')}
      >
        {all ? (
          <Layers className="ic" strokeWidth={2} />
        ) : (
          <Folder className="ic" strokeWidth={2} />
        )}
        <span className="scopename">{label}</span>
        <ChevronDown className="ic hint" strokeWidth={2} />
      </button>
    </>
  )
}
