export type RightPanel = 'closed' | 'inspector' | 'ledger'
export type RightPanelBySurface = Record<string, RightPanel>

export function panelForSurface(state: RightPanelBySurface, surface: string): RightPanel {
  return state[surface] ?? 'closed'
}

export function setPanelForSurface(
  state: RightPanelBySurface,
  surface: string,
  panel: RightPanel
): RightPanelBySurface {
  if (state[surface] === panel) return state
  return { ...state, [surface]: panel }
}

export function togglePanelForSurface(
  state: RightPanelBySurface,
  surface: string,
  panel: Exclude<RightPanel, 'closed'>
): RightPanelBySurface {
  return setPanelForSurface(state, surface, state[surface] === panel ? 'closed' : panel)
}
