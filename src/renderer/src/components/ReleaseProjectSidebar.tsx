import { ChevronDown, ChevronRight, ListTree, Search } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type {
  ReleaseSidebarFolds,
  ReleaseSidebarGroup,
  ReleaseSidebarProject
} from '../lib/releaseSidebar'

const GROUPS: ReadonlyArray<{ group: ReleaseSidebarGroup; label: string }> = [
  { group: 'needs-you', label: 'Needs you' },
  { group: 'in-flight', label: 'In flight' },
  { group: 'nothing-declared', label: 'Nothing declared' }
]

export interface ProjectSidebarRow<Group extends string> {
  project: string
  app: string
  group: Group
  meta?: string
  emptyMeta?: string
  quiet?: boolean
  markerLabel?: string
}

export interface ProjectSidebarGroupDefinition<Group extends string> {
  group: Group
  label: string
}

export function ProjectSidebar<Group extends string>({
  ariaLabel,
  searchAriaLabel,
  groups,
  projects,
  selectedProject,
  query,
  folds,
  searchRef,
  footer,
  action,
  onQueryChange,
  onSelect,
  onToggleGroup
}: {
  ariaLabel: string
  searchAriaLabel: string
  groups: readonly ProjectSidebarGroupDefinition<Group>[]
  projects: readonly ProjectSidebarRow<Group>[]
  selectedProject: string
  query: string
  folds: Record<Group, boolean>
  searchRef: RefObject<HTMLInputElement | null>
  footer: string
  action?: { label: string; icon: ReactNode; onClick: () => void }
  onQueryChange: (query: string) => void
  onSelect: (project: string) => void
  onToggleGroup: (group: Group) => void
}): React.JSX.Element {
  const needle = query.trim().toLocaleLowerCase()
  const visible = projects.filter(
    (project) =>
      !needle ||
      project.app.toLocaleLowerCase().includes(needle) ||
      project.project.toLocaleLowerCase().includes(needle)
  )

  return (
    <aside className="release-project-sidebar" aria-label={ariaLabel}>
      <label className="release-project-search">
        <Search aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Find a project…"
          aria-label={searchAriaLabel}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div className="release-project-list">
        {groups.map(({ group, label }) => {
          const allInGroup = projects.filter((project) => project.group === group)
          const shownInGroup = visible.filter((project) => project.group === group)
          const open = folds[group]
          return (
            <section key={group}>
              <button
                type="button"
                className="release-project-group"
                aria-expanded={open}
                onClick={() => onToggleGroup(group)}
              >
                {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                {label} · {allInGroup.length}
              </button>
              {open &&
                shownInGroup.map((project) => (
                  <button
                    type="button"
                    className={`release-project-row${project.project === selectedProject ? ' on' : ''}${project.quiet ? ' quiet' : ''}`}
                    aria-pressed={project.project === selectedProject}
                    key={project.project}
                    onClick={() => onSelect(project.project)}
                  >
                    {project.markerLabel && (
                      <span className="release-project-you" aria-label={project.markerLabel} />
                    )}
                    <span>{project.app}</span>
                    {project.meta ? (
                      <strong>{project.meta}</strong>
                    ) : (
                      <small>{project.emptyMeta}</small>
                    )}
                  </button>
                ))}
            </section>
          )
        })}
      </div>
      {action && (
        <button type="button" className="release-project-board" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </button>
      )}
      <footer>{footer}</footer>
    </aside>
  )
}

export function ReleaseProjectSidebar({
  projects,
  selectedProject,
  query,
  folds,
  searchRef,
  onQueryChange,
  onSelect,
  onToggleGroup,
  onShowBoard
}: {
  projects: readonly ReleaseSidebarProject[]
  selectedProject: string
  query: string
  folds: ReleaseSidebarFolds
  searchRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  onSelect: (project: string) => void
  onToggleGroup: (group: ReleaseSidebarGroup) => void
  onShowBoard: () => void
}): React.JSX.Element {
  const releaseCount = projects.filter((project) => project.group !== 'nothing-declared').length

  return (
    <ProjectSidebar
      ariaLabel="Release projects"
      searchAriaLabel="Find a release project"
      groups={GROUPS}
      projects={projects.map((project) => ({
        project: project.project,
        app: project.app,
        group: project.group,
        ...(project.version ? { meta: project.version } : { emptyMeta: 'No release' }),
        quiet: project.group === 'nothing-declared',
        ...(project.group === 'needs-you' ? { markerLabel: 'Needs you' } : {})
      }))}
      selectedProject={selectedProject}
      query={query}
      folds={folds}
      searchRef={searchRef}
      footer={`${projects.length} projects · ${releaseCount} with a release`}
      action={{
        label: 'All-apps board',
        icon: <ListTree aria-hidden="true" />,
        onClick: onShowBoard
      }}
      onQueryChange={onQueryChange}
      onSelect={onSelect}
      onToggleGroup={onToggleGroup}
    />
  )
}
