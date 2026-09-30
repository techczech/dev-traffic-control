import { TOP_LEVEL_SURFACES, surfaceApplies, useApp } from '../state/app'
import type { TopLevelSurface } from '../state/app'
import { needsSpecCount, specRows } from '../lib/specs'
import { dashLabel } from '../lib/dashLabel'
import { surfaceCounts } from '../lib/surfaceCounts'

const LABELS: Record<Exclude<TopLevelSurface, 'dashboard'>, string> = {
  inbox: 'Inbox',
  specs: 'Specs',
  releases: 'Releases',
  roadmap: 'Roadmap',
  handoffs: 'Handoffs'
}

/** The single top-level navigation interface shared by all six surfaces. */
export function SurfaceTabs(): React.JSX.Element {
  const { view, navigate, snapshot, scope, seen, archived, housekeeping } = useApp()
  // The badge counts what the Specs tab would actually show, so it agrees with
  // the window's scope rather than with the whole record.
  const specsCount = snapshot ? needsSpecCount(specRows(snapshot, scope, {})) : 0
  const counts = snapshot
    ? surfaceCounts(snapshot, scope, seen ?? new Set(), archived ?? new Set(), housekeeping)
    : {}
  const label = (kind: TopLevelSurface): string =>
    kind === 'dashboard' ? dashLabel(scope) : LABELS[kind]
  // Get started is reached from the Dash and drawn under its tab (ticket 34).
  const current = view.kind === 'get-started' ? 'dashboard' : view.kind

  return (
    <nav className="surface-tabs" aria-label="App surfaces">
      {TOP_LEVEL_SURFACES.map((kind) => {
        // Under *All projects* the four project surfaces are visibly not
        // applicable — drawn dimmed and inert — never a silent stand-in.
        const applies = surfaceApplies(kind, scope)
        return (
          <button
            key={kind}
            type="button"
            className={[current === kind ? 'on' : '', applies ? '' : 'off'].join(' ').trim()}
            aria-current={current === kind ? 'page' : undefined}
            disabled={!applies}
            title={
              !applies
                ? `Pick a project to open ${label(kind)}`
                : kind !== 'dashboard' && kind !== 'specs' && counts[kind] !== undefined
                  ? counts[kind] === 0
                    ? `${label(kind)} — empty`
                    : `${label(kind)} — ${counts[kind]}`
                  : undefined
            }
            onClick={() => navigate({ kind })}
          >
            {label(kind)}
            {kind === 'specs' && applies && specsCount > 0 && (
              <span className="surface-tab-count">{specsCount}</span>
            )}
            {/* How much each tab holds, and plainly when it holds nothing (ticket 19). */}
            {kind !== 'dashboard' && kind !== 'specs' && applies && counts[kind] !== undefined && (
              <span
                className={`surface-tab-n${counts[kind] === 0 ? ' empty' : ''}`}
                aria-hidden="true"
              >
                {counts[kind] === 0 ? '0' : counts[kind]}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
