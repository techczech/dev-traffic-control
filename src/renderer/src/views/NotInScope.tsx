import { Layers } from 'lucide-react'
import { useApp } from '../state/app'
import type { ProjectOnlySurface } from '../state/app'

const WHAT: Record<ProjectOnlySurface, string> = {
  specs: 'specs',
  releases: 'releases',
  roadmap: 'roadmap',
  handoffs: 'handoffs'
}

/**
 * A project-only surface reached under *All projects* — by Back, or by moving
 * the window to *All projects* while it showed one. It says so, and offers the
 * scope's own home, instead of showing one project's content or a merge of
 * every project's (ADR-0016 § 1).
 */
export function NotInScope({ surface }: { surface: ProjectOnlySurface }): React.JSX.Element {
  const { navigate, openSwitcher } = useApp()
  return (
    <div className="view fleet">
      <div className="fleet-na" role="status">
        <Layers className="ic" strokeWidth={2} />
        <h2>Pick a project to see its {WHAT[surface]}</h2>
        <div className="fleet-na-actions">
          <button type="button" className="secbtn" onClick={() => openSwitcher()}>
            Switch project<kbd>⌘⇧K</kbd>
          </button>
          <button type="button" className="secbtn" onClick={() => navigate({ kind: 'dashboard' })}>
            Go to Overview
          </button>
        </div>
      </div>
    </div>
  )
}
