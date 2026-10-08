import { ArrowLeft, FileText, ListFilter, PackageOpen, Plus, RotateCcw } from 'lucide-react'

type EmptySurfaceKind = 'specs' | 'releases' | 'roadmap'

/**
 * The empty-state chrome for the three surfaces whose data arrives later.
 *
 * The headings here do not break the rule against naming a thing twice. They
 * are empty-state copy, not surface labels: each is paired with a standing line
 * that says what is missing ("nothing open", "no release records", "nothing in
 * the pool"), and the roadmap's is the project's name rather than the surface's.
 * A bare <h1> that said only what the selected tab directly above it already
 * says would be a duplicate.
 */
export function EmptySurface({
  surface,
  answeredCount = 0,
  onShowAnswered,
  projectName = 'Pinboard',
  project = '',
  projects = [],
  setAsideCount = 0,
  onProjectChange,
  onShowProjects,
  onAddIdea
}: {
  surface: EmptySurfaceKind
  answeredCount?: number
  onShowAnswered?: () => void
  projectName?: string
  project?: string
  projects?: string[]
  setAsideCount?: number
  onProjectChange?: (project: string) => void
  onShowProjects?: () => void
  onAddIdea?: () => void
}): React.JSX.Element {
  if (surface === 'specs') {
    return (
      <div className="view surface-empty-view">
        <div className="surface-modebar">
          <h1>Specs</h1>
          <span>nothing open</span>
          <div className="surface-mode-tabs">
            <button type="button" className="on">
              Documents
            </button>
            <button type="button">Questions</button>
          </div>
        </div>
        <EmptyBody
          icon={<FileText />}
          title="No specifications waiting"
          description={`Agents put a PRD or a document here when they want your judgement before building. Nothing is waiting${answeredCount === 1 ? ', and the specification you have answered is still readable' : answeredCount > 1 ? `, and the ${answeredCount} you have answered are still readable` : ''}.`}
          action={
            answeredCount > 0 ? (
              <>
                <ListFilter />
                <button type="button" onClick={onShowAnswered}>
                  Show the {answeredCount} answered<kbd>⇧A</kbd>
                </button>
              </>
            ) : undefined
          }
        />
      </div>
    )
  }

  if (surface === 'releases') {
    return (
      <div className="view surface-empty-view">
        <div className="surface-modebar">
          <h1>In flight</h1>
          <span>no release records</span>
          <div className="surface-mode-tabs">
            <button type="button" className="on">
              In flight
            </button>
            <button type="button">Shipped</button>
          </div>
        </div>
        <EmptyBody
          icon={<PackageOpen />}
          title="No releases in flight"
          description="Release records appear here when an app says what it is working towards."
        />
      </div>
    )
  }

  return (
    <div className="view surface-empty-view">
      <div className="surface-modebar">
        {onShowProjects && (
          <button type="button" className="roadmap-project-list-return" onClick={onShowProjects}>
            <ArrowLeft aria-hidden="true" />
            Projects
          </button>
        )}
        {projects.length > 0 ? (
          <select
            className="surface-roadmap-project"
            aria-label="App whose pool is shown"
            value={project}
            onChange={(event) => onProjectChange?.(event.target.value)}
          >
            {projects.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate === project ? projectName : displayProject(candidate)}
              </option>
            ))}
          </select>
        ) : (
          <h1>{projectName}</h1>
        )}
        <span>
          {projects.length > 0 ? 'switch app ▾ · nothing in the pool' : 'nothing in the pool'}
        </span>
        <button type="button" className="surface-primary-action" onClick={onAddIdea}>
          <Plus />
          Add an idea
        </button>
      </div>
      <EmptyBody
        icon={<ListFilter />}
        title={`Nothing in ${projectName}'s pool yet`}
        description="Agents write an idea here the moment you mention one, so this fills itself as you talk. You can also put one in directly."
        action={
          setAsideCount > 0 ? (
            <>
              <RotateCcw />
              {setAsideCount} {setAsideCount === 1 ? 'idea was' : 'ideas were'} set aside earlier
              <kbd>⇧S</kbd>
            </>
          ) : undefined
        }
      />
    </div>
  )
}

function displayProject(project: string): string {
  return project
    .split('-')
    .filter(Boolean)
    .map((word) => `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

function EmptyBody({
  icon,
  title,
  description,
  action
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="surface-empty">
      <span className="surface-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <span className="surface-empty-action">{action}</span>}
    </div>
  )
}
