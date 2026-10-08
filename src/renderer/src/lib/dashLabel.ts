import type { WindowScope } from '../../../shared/windowScope'

/**
 * The first tab's name says which dashboard it is. Under All projects
 * it is the same place Home goes, so it carries Home's name: DTC Dash.
 */
export const DTC_DASH = 'DTC Dash'
export const PROJECT_DASH = 'Project Dash'

export function dashLabel(scope: WindowScope | null | undefined): string {
  return scope?.kind === 'project' ? PROJECT_DASH : DTC_DASH
}

/**
 * Whether the DTC Dash is the view on screen: All projects, the dashboard
 * surface, and not the narrow front page (the project list) standing in front
 * of it. The title bar's home button shows its pressed state from this, the way
 * Settings does while settings is showing.
 */
export function isOnDtcDash({
  scope,
  viewKind,
  onProjectList
}: {
  scope: WindowScope | null | undefined
  viewKind: string
  onProjectList: boolean
}): boolean {
  return scope?.kind !== 'project' && viewKind === 'dashboard' && !onProjectList
}
