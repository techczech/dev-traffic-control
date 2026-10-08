import type { Handoff } from '../../../main/qa/handoffs'

export type HandoffMoveFilter = 'all' | 'agent' | 'me' | 'superseded'
export type HandoffGrouping = 'flat' | 'project'

export interface HandoffSelectionOptions {
  grouping: HandoffGrouping
  project: string | null
  move: HandoffMoveFilter
  query: string
}

export interface HandoffSection {
  project: string | null
  handoffs: Handoff[]
}

export interface HandoffSelection {
  visible: Handoff[]
  sections: HandoffSection[]
  counts: Record<HandoffMoveFilter, number>
  projects: Array<{ project: string; count: number }>
}

interface RendererStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export const HANDOFF_GROUPING_STORAGE_KEY = 'dtc.handoffs.grouping.v1'

export function selectHandoffs(
  handoffs: readonly Handoff[],
  options: HandoffSelectionOptions
): HandoffSelection {
  const sorted = [...handoffs].sort(
    (left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime()
  )
  const projects = projectOptions(sorted)
  const inProject = options.project
    ? sorted.filter((handoff) => handoff.project === options.project)
    : sorted
  const counts = moveCounts(inProject)
  const needle = options.query.trim().toLocaleLowerCase()
  const visible = inProject.filter(
    (handoff) => matchesMove(handoff, options.move) && matchesQuery(handoff, needle)
  )

  return {
    visible,
    sections:
      options.grouping === 'project'
        ? groupByProject(visible)
        : [{ project: null, handoffs: visible }],
    counts,
    projects
  }
}

export function readHandoffGrouping(storage = rendererStorage()): HandoffGrouping {
  try {
    return storage.getItem(HANDOFF_GROUPING_STORAGE_KEY) === 'project' ? 'project' : 'flat'
  } catch {
    return 'flat'
  }
}

export function writeHandoffGrouping(grouping: HandoffGrouping, storage = rendererStorage()): void {
  try {
    storage.setItem(HANDOFF_GROUPING_STORAGE_KEY, grouping)
  } catch {
    // A blocked local store leaves the grouping choice session-local.
  }
}

function groupByProject(handoffs: Handoff[]): HandoffSection[] {
  const groups = new Map<string, Handoff[]>()
  for (const handoff of handoffs) {
    const group = groups.get(handoff.project)
    if (group) group.push(handoff)
    else groups.set(handoff.project, [handoff])
  }
  return [...groups].map(([project, grouped]) => ({ project, handoffs: grouped }))
}

function projectOptions(handoffs: readonly Handoff[]): Array<{ project: string; count: number }> {
  const counts = new Map<string, number>()
  for (const handoff of handoffs) {
    counts.set(handoff.project, (counts.get(handoff.project) ?? 0) + 1)
  }
  return [...counts]
    .map(([project, count]) => ({ project, count }))
    .sort((left, right) => left.project.localeCompare(right.project))
}

function moveCounts(handoffs: readonly Handoff[]): Record<HandoffMoveFilter, number> {
  return {
    all: handoffs.length,
    agent: handoffs.filter((handoff) => isLiveMove(handoff, 'agent')).length,
    me: handoffs.filter((handoff) => isLiveMove(handoff, 'me')).length,
    superseded: handoffs.filter((handoff) => handoff.state === 'superseded').length
  }
}

function matchesMove(handoff: Handoff, filter: HandoffMoveFilter): boolean {
  return (
    filter === 'all' ||
    (filter === 'agent' && isLiveMove(handoff, 'agent')) ||
    (filter === 'me' && isLiveMove(handoff, 'me')) ||
    (filter === 'superseded' && handoff.state === 'superseded')
  )
}

function matchesQuery(handoff: Handoff, needle: string): boolean {
  if (!needle) return true
  return [handoff.title, handoff.project, handoff.resume, handoff.raw]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(needle))
}

function isLiveMove(handoff: Handoff, move: 'agent' | 'me'): boolean {
  return (
    handoff.move === move &&
    handoff.history.kind !== 'archived' &&
    handoff.state !== 'superseded' &&
    handoff.state !== 'done'
  )
}

function rendererStorage(): RendererStorage {
  return localStorage
}
