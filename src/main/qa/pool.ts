import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { atomicWrite } from './atomicWrite'
import { createPoolIdeaFile, patchPoolIdeaFile } from './poolIdeaFile'

export type PoolTier = 'functionality' | 'quality-of-life' | 'delight'
export type PoolIdeaState = 'pool' | 'promoted' | 'setaside'
export type PoolMoveDirection = 'up' | 'down' | 'left' | 'right'

export interface PoolOrderState {
  state?: Exclude<PoolIdeaState, 'pool'>
  reason?: string
  release?: string
  specWanted?: boolean
  at?: string
}

export interface PoolReturnedEntry {
  title: string
  tier: PoolTier
  from: string
  at: string
}

export interface PoolOrder {
  positions: Record<string, number>
  states: Record<string, PoolOrderState>
  returned?: Record<string, PoolReturnedEntry>
  seenAt?: string
}

export interface PoolIdea {
  path: string
  id: string
  title: string
  tier: PoolTier
  added?: string
  bodyMarkdown: string
  position: number
  state: PoolIdeaState
  candidateRelease?: string
  specWanted?: boolean
  setAsideReason?: string
  stateAt?: string
  returnedFrom?: string
  isNew: boolean
}

export interface ProjectPool {
  project: string
  directory: string
  ideas: PoolIdea[]
  seenAt?: string
  degradedOrder: boolean
}

export interface PoolReorderResult {
  pool: ProjectPool
  changedIds: string[]
}

export interface PoolIdeaCreateInput {
  title: string
  bodyMarkdown: string
  tier: PoolTier
  addedAt: string
}

export interface ReturnedPoolIdea {
  id: string
  title: string
}

export interface PoolFeatureReturn {
  id: string
  title: string
  tier: PoolTier
  from: string
  at: string
}

interface ParsedIdea {
  path: string
  id: string
  title: string
  tier: PoolTier
  added?: string
  candidate?: string
  bodyMarkdown: string
  returnedFrom?: string
  returnedAt?: string
}

const TIER_ORDER: readonly PoolTier[] = ['functionality', 'quality-of-life', 'delight']

export async function readProjectPool(root: string, project: string): Promise<ProjectPool> {
  const directory = path.join(root, project, 'roadmap')
  const [ideaFiles, orderResult] = await Promise.all([readIdeas(directory), readOrder(directory)])
  const ideas = mergeReturnedIdeas(directory, ideaFiles, orderResult.order.returned)
  const ordered: PoolIdea[] = []

  for (const tier of TIER_ORDER) {
    const lane = ideas.filter((idea) => idea.tier === tier)
    lane.sort((left, right) => compareIdeas(left, right, orderResult.order.positions))
    lane.forEach((idea, index) => {
      const sidecarState = orderResult.order.states[idea.id]
      ordered.push({
        path: idea.path,
        id: idea.id,
        title: idea.title,
        tier: idea.tier,
        ...(idea.added ? { added: idea.added } : {}),
        bodyMarkdown: idea.bodyMarkdown,
        position: index + 1,
        state: sidecarState?.state ?? 'pool',
        ...((sidecarState?.release ?? idea.candidate)
          ? { candidateRelease: sidecarState?.release ?? idea.candidate }
          : {}),
        ...(sidecarState?.state === 'promoted' && sidecarState.specWanted !== undefined
          ? { specWanted: sidecarState.specWanted }
          : {}),
        ...(sidecarState?.state === 'setaside' && sidecarState.reason
          ? { setAsideReason: sidecarState.reason }
          : {}),
        ...(sidecarState?.at ? { stateAt: sidecarState.at } : {}),
        ...(!sidecarState?.at && idea.returnedAt ? { stateAt: idea.returnedAt } : {}),
        ...(idea.returnedFrom ? { returnedFrom: idea.returnedFrom } : {}),
        isNew: isAfter(idea.added ?? idea.returnedAt, orderResult.order.seenAt)
      })
    })
  }

  return {
    project,
    directory,
    ideas: ordered,
    ...(orderResult.order.seenAt ? { seenAt: orderResult.order.seenAt } : {}),
    degradedOrder: orderResult.degraded
  }
}

export async function writePoolOrder(
  root: string,
  project: string,
  order: PoolOrder
): Promise<void> {
  const directory = path.join(root, project, 'roadmap')
  await mkdir(directory, { recursive: true })
  await atomicWrite(path.join(directory, 'order.json'), `${JSON.stringify(order, null, 2)}\n`)
}

/** Reorders one in-pool idea, changing only its tier line when it crosses lanes. */
export async function reorderProjectPool(
  root: string,
  project: string,
  id: string,
  direction: PoolMoveDirection
): Promise<PoolReorderResult> {
  const pool = await readProjectPool(root, project)
  const idea = pool.ideas.find((candidate) => candidate.id === id)
  if (!idea) throw new Error('Roadmap idea not found.')
  if (idea.state !== 'pool') throw new Error('Only ideas in the pool can be reordered.')

  if (direction === 'left' || direction === 'right') {
    const tierIndex = TIER_ORDER.indexOf(idea.tier)
    const targetTier = TIER_ORDER[tierIndex + (direction === 'left' ? -1 : 1)]
    if (!targetTier) return { pool, changedIds: [] }
    if (idea.path === path.join(pool.directory, 'order.json')) {
      throw new Error('This returned idea needs an idea file before its lane can change.')
    }
    const { order } = await readOrder(pool.directory)
    const targetPosition =
      Math.max(
        0,
        ...pool.ideas
          .filter((candidate) => candidate.tier === targetTier && candidate.state === 'pool')
          .map((candidate) => candidate.position)
      ) + 1
    await patchPoolIdeaFile(idea.path, { tier: targetTier })
    await writePoolOrder(root, project, {
      ...order,
      positions: { ...order.positions, [idea.id]: targetPosition }
    })
    return {
      pool: await readProjectPool(root, project),
      changedIds: [idea.id]
    }
  }

  const lane = pool.ideas.filter(
    (candidate) => candidate.tier === idea.tier && candidate.state === 'pool'
  )
  const currentIndex = lane.findIndex((candidate) => candidate.id === id)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  const target = lane[targetIndex]
  if (!target) return { pool, changedIds: [] }

  const { order } = await readOrder(pool.directory)
  const next: PoolOrder = {
    positions: {
      ...order.positions,
      [idea.id]: target.position,
      [target.id]: idea.position
    },
    states: order.states,
    ...(order.returned ? { returned: order.returned } : {}),
    ...(order.seenAt ? { seenAt: order.seenAt } : {})
  }
  await writePoolOrder(root, project, next)
  return {
    pool: await readProjectPool(root, project),
    changedIds: [target.id, idea.id]
  }
}

/** Places one in-pool idea before another, as the row-grip interaction requests. */
export async function placeProjectPoolIdea(
  root: string,
  project: string,
  id: string,
  beforeId: string
): Promise<PoolReorderResult> {
  const pool = await readProjectPool(root, project)
  const idea = pool.ideas.find((candidate) => candidate.id === id)
  const target = pool.ideas.find((candidate) => candidate.id === beforeId)
  if (!idea || !target) throw new Error('Roadmap idea not found.')
  if (idea.state !== 'pool' || target.state !== 'pool') {
    throw new Error('Only ideas in the pool can be reordered.')
  }
  if (idea.id === target.id) return { pool, changedIds: [] }

  if (idea.tier !== target.tier) {
    if (idea.path === path.join(pool.directory, 'order.json')) {
      throw new Error('This returned idea needs an idea file before its lane can change.')
    }
    const targetLane = pool.ideas.filter(
      (candidate) => candidate.tier === target.tier && candidate.state === 'pool'
    )
    const targetIndex = targetLane.findIndex((candidate) => candidate.id === target.id)
    targetLane.splice(targetIndex, 0, idea)
    const { order } = await readOrder(pool.directory)
    const positions = { ...order.positions }
    targetLane.forEach((candidate, index) => {
      positions[candidate.id] = index + 1
    })
    await patchPoolIdeaFile(idea.path, { tier: target.tier })
    await writePoolOrder(root, project, { ...order, positions })
    return {
      pool: await readProjectPool(root, project),
      changedIds: targetLane.map((candidate) => candidate.id)
    }
  }

  const lane = pool.ideas.filter(
    (candidate) => candidate.tier === idea.tier && candidate.state === 'pool'
  )
  const reordered = lane.filter((candidate) => candidate.id !== idea.id)
  const targetIndex = reordered.findIndex((candidate) => candidate.id === target.id)
  reordered.splice(targetIndex, 0, idea)
  const changed = reordered.filter((candidate, index) => candidate.position !== index + 1)
  if (changed.length === 0) return { pool, changedIds: [] }

  const { order } = await readOrder(pool.directory)
  const positions = { ...order.positions }
  reordered.forEach((candidate, index) => {
    if (candidate.position !== index + 1) positions[candidate.id] = index + 1
  })
  await writePoolOrder(root, project, {
    positions,
    states: order.states,
    ...(order.returned ? { returned: order.returned } : {}),
    ...(order.seenAt ? { seenAt: order.seenAt } : {})
  })
  return {
    pool: await readProjectPool(root, project),
    changedIds: changed.map((candidate) => candidate.id)
  }
}

/** Advances the app-owned last-look timestamp without touching an idea file. */
export async function markProjectPoolSeen(
  root: string,
  project: string,
  seenAt: string
): Promise<ProjectPool> {
  if (!validTimestamp(seenAt)) throw new Error('The Roadmap seen time is invalid.')
  const directory = path.join(root, project, 'roadmap')
  const { order } = await readOrder(directory)
  await writePoolOrder(root, project, { ...order, seenAt })
  return readProjectPool(root, project)
}

/** Edits the app-writable fields of one real idea file and returns the reader merge. */
export async function editProjectPoolIdea(
  root: string,
  project: string,
  id: string,
  changes: { title?: string; bodyMarkdown?: string }
): Promise<ProjectPool> {
  const pool = await readProjectPool(root, project)
  const idea = pool.ideas.find((candidate) => candidate.id === id)
  if (!idea) throw new Error('Roadmap idea not found.')
  if (idea.path === path.join(pool.directory, 'order.json')) {
    throw new Error('This returned idea needs an idea file before it can be edited.')
  }
  const title = changes.title?.trim()
  if (changes.title !== undefined && (!title || !oneLine(title))) {
    throw new Error('An idea title must be one non-empty line.')
  }
  if (changes.title === undefined && changes.bodyMarkdown === undefined) return pool
  await patchPoolIdeaFile(idea.path, {
    ...(title ? { title } : {}),
    ...(changes.bodyMarkdown !== undefined ? { bodyMarkdown: changes.bodyMarkdown } : {})
  })
  return readProjectPool(root, project)
}

/** Adds one agent-shaped idea file and places it at the end of the chosen lane. */
export async function addProjectPoolIdea(
  root: string,
  project: string,
  input: PoolIdeaCreateInput
): Promise<{ pool: ProjectPool; id: string }> {
  const title = input.title.trim()
  if (!oneLine(title)) throw new Error('An idea title must be one non-empty line.')
  const directory = path.join(root, project, 'roadmap')
  const pool = await readProjectPool(root, project)
  const { id } = await createPoolIdeaFile(directory, { ...input, title })
  const { order } = await readOrder(directory)
  const position =
    Math.max(
      0,
      ...pool.ideas
        .filter((idea) => idea.tier === input.tier && idea.state === 'pool')
        .map((idea) => idea.position)
    ) + 1
  await writePoolOrder(root, project, {
    ...order,
    positions: { ...order.positions, [id]: position }
  })
  return { pool: await readProjectPool(root, project), id }
}

/** Moves one idea from the pool into a release without touching its Markdown file. */
export async function promoteProjectPoolIdea(
  root: string,
  project: string,
  id: string,
  release: string,
  specWanted: boolean,
  at: string
): Promise<ProjectPool> {
  const releaseName = release.trim()
  if (!oneLine(releaseName)) throw new Error('A release is required to promote an idea.')
  if (!validTimestamp(at)) throw new Error('The promotion time is invalid.')
  return transitionProjectPoolIdea(root, project, id, 'pool', async (_pool, order) => ({
    ...order,
    states: {
      ...order.states,
      [id]: { state: 'promoted', release: releaseName, specWanted, at }
    }
  }))
}

/** Keeps one idea and its reason in the app-owned sidecar, outside the ranked lanes. */
export async function setAsideProjectPoolIdea(
  root: string,
  project: string,
  id: string,
  reason: string,
  at: string
): Promise<ProjectPool> {
  const oneLineReason = reason.trim()
  if (!oneLine(oneLineReason)) {
    throw new Error('A one-line reason is required to set an idea aside.')
  }
  if (!validTimestamp(at)) throw new Error('The set-aside time is invalid.')
  return transitionProjectPoolIdea(root, project, id, 'pool', async (_pool, order) => {
    const existing = order.states[id]
    return {
      ...order,
      states: {
        ...order.states,
        [id]: {
          state: 'setaside',
          reason: oneLineReason,
          ...(existing?.release ? { release: existing.release } : {}),
          at
        }
      }
    }
  })
}

/** Returns a set-aside idea to the end of its original agent-owned tier. */
export async function restoreProjectPoolIdea(
  root: string,
  project: string,
  id: string
): Promise<ProjectPool> {
  return transitionProjectPoolIdea(root, project, id, 'setaside', async (pool, order) => {
    const idea = pool.ideas.find((candidate) => candidate.id === id)!
    const laneEnd = Math.max(
      0,
      ...pool.ideas
        .filter((candidate) => candidate.tier === idea.tier && candidate.state === 'pool')
        .map((candidate) => candidate.position)
    )
    const states = { ...order.states }
    const release = states[id]?.release
    if (release) states[id] = { release }
    else delete states[id]
    return {
      ...order,
      positions: { ...order.positions, [id]: laneEnd + 1 },
      states
    }
  })
}

/** Returns unfinished features without creating or editing an agent-owned idea file. */
export async function returnProjectPoolFeatures(
  root: string,
  project: string,
  features: readonly PoolFeatureReturn[]
): Promise<{ pool: ProjectPool; returnedIdeas: ReturnedPoolIdea[] }> {
  const uniqueFeatures = [...new Map(features.map((feature) => [feature.id, feature])).values()]
  for (const feature of uniqueFeatures) {
    if (
      !oneLine(feature.id) ||
      !oneLine(feature.title) ||
      !isTier(feature.tier) ||
      !oneLine(feature.from) ||
      !validTimestamp(feature.at)
    ) {
      throw new Error('The unfinished feature return is incomplete.')
    }
  }
  const pool = await readProjectPool(root, project)
  if (uniqueFeatures.length === 0) return { pool, returnedIdeas: [] }
  const ideasById = new Map(pool.ideas.map((idea) => [idea.id, idea]))
  const setAside = uniqueFeatures.find((feature) => ideasById.get(feature.id)?.state === 'setaside')
  if (setAside) {
    throw new Error(`The unfinished feature “${setAside.title}” is set aside.`)
  }

  const { order } = await readOrder(pool.directory)
  const positions = { ...order.positions }
  const states = { ...order.states }
  const returned = { ...(order.returned ?? {}) }
  const laneEnds = new Map<PoolTier, number>()
  for (const tier of TIER_ORDER) {
    laneEnds.set(
      tier,
      Math.max(
        0,
        ...pool.ideas
          .filter((idea) => idea.tier === tier && idea.state === 'pool')
          .map((idea) => idea.position)
      )
    )
  }
  for (const feature of uniqueFeatures) {
    const idea = ideasById.get(feature.id)
    const tier = idea?.tier ?? feature.tier
    const nextPosition = (laneEnds.get(tier) ?? 0) + 1
    laneEnds.set(tier, nextPosition)
    positions[feature.id] = nextPosition
    delete states[feature.id]
    returned[feature.id] = {
      title: feature.title,
      tier,
      from: feature.from,
      at: feature.at
    }
  }
  await writePoolOrder(root, project, {
    positions,
    states,
    returned,
    ...(order.seenAt ? { seenAt: order.seenAt } : {})
  })
  const updated = await readProjectPool(root, project)
  return {
    pool: updated,
    returnedIdeas: uniqueFeatures.map((feature) => {
      const idea = updated.ideas.find((candidate) => candidate.id === feature.id)!
      return { id: idea.id, title: idea.title }
    })
  }
}

async function transitionProjectPoolIdea(
  root: string,
  project: string,
  id: string,
  expectedState: PoolIdeaState,
  transition: (pool: ProjectPool, order: PoolOrder) => Promise<PoolOrder>
): Promise<ProjectPool> {
  const pool = await readProjectPool(root, project)
  const idea = pool.ideas.find((candidate) => candidate.id === id)
  if (!idea) throw new Error('Roadmap idea not found.')
  if (idea.state !== expectedState) {
    throw new Error(
      `Only ${expectedState === 'pool' ? 'ideas in the pool' : 'set-aside ideas'} can make this change.`
    )
  }
  const { order } = await readOrder(pool.directory)
  await writePoolOrder(root, project, await transition(pool, order))
  return readProjectPool(root, project)
}

async function readIdeas(directory: string): Promise<ParsedIdea[]> {
  let files: string[]
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }

  const ideas = await Promise.all(
    files.map(async (file): Promise<ParsedIdea | undefined> => {
      const filePath = path.join(directory, file)
      try {
        return parseIdea(await readFile(filePath, 'utf8'), filePath)
      } catch {
        return undefined
      }
    })
  )
  return ideas.filter((idea): idea is ParsedIdea => idea !== undefined)
}

function mergeReturnedIdeas(
  directory: string,
  ideaFiles: readonly ParsedIdea[],
  returned: Readonly<Record<string, PoolReturnedEntry>> | undefined
): ParsedIdea[] {
  const merged = new Map<string, ParsedIdea>()
  for (const [id, entry] of Object.entries(returned ?? {})) {
    merged.set(id, {
      path: path.join(directory, 'order.json'),
      id,
      title: entry.title,
      tier: entry.tier,
      bodyMarkdown: '',
      returnedFrom: entry.from,
      returnedAt: entry.at
    })
  }
  for (const idea of ideaFiles) {
    const returnedIdea = merged.get(idea.id)
    merged.set(idea.id, {
      ...returnedIdea,
      ...idea,
      ...(returnedIdea?.returnedFrom ? { returnedFrom: returnedIdea.returnedFrom } : {}),
      ...(returnedIdea?.returnedAt ? { returnedAt: returnedIdea.returnedAt } : {})
    })
  }
  return [...merged.values()]
}

function parseIdea(raw: string, filePath: string): ParsedIdea | undefined {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!frontmatter) return undefined

  const parsed: unknown = parseYaml(frontmatter[1]) ?? {}
  if (!isRecord(parsed)) return undefined
  const fileId = path.basename(filePath, '.md')
  const id = scalar(parsed.id)
  const title = scalar(parsed.title)
  const tier = scalar(parsed.tier)
  if (id !== fileId || !title || !isTier(tier)) return undefined

  return {
    path: filePath,
    id,
    title,
    tier,
    ...(scalar(parsed.added) ? { added: scalar(parsed.added) } : {}),
    ...(scalar(parsed.candidate) ? { candidate: scalar(parsed.candidate) } : {}),
    bodyMarkdown: raw.slice(frontmatter[0].length).trim()
  }
}

async function readOrder(directory: string): Promise<{ order: PoolOrder; degraded: boolean }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(directory, 'order.json'), 'utf8'))
    if (!isPoolOrder(parsed)) throw new Error('invalid roadmap order')
    return { order: parsed, degraded: false }
  } catch {
    return { order: { positions: {}, states: {} }, degraded: true }
  }
}

function compareIdeas(
  left: ParsedIdea,
  right: ParsedIdea,
  positions: Readonly<Record<string, number>>
): number {
  const leftPosition = positions[left.id]
  const rightPosition = positions[right.id]
  if (leftPosition !== undefined && rightPosition !== undefined) {
    const difference = leftPosition - rightPosition
    if (difference !== 0) return difference
  } else if (leftPosition !== undefined) {
    return -1
  } else if (rightPosition !== undefined) {
    return 1
  }
  return compareAddedThenId(left, right)
}

function compareAddedThenId(left: ParsedIdea, right: ParsedIdea): number {
  if (left.added && right.added) {
    const difference = left.added.localeCompare(right.added)
    if (difference !== 0) return difference
  } else if (left.added) {
    return -1
  } else if (right.added) {
    return 1
  }
  return left.id.localeCompare(right.id)
}

function isPoolOrder(value: unknown): value is PoolOrder {
  if (!isRecord(value) || !isRecord(value.positions) || !isRecord(value.states)) return false
  if (
    !Object.values(value.positions).every(
      (position) => typeof position === 'number' && Number.isFinite(position) && position >= 1
    )
  ) {
    return false
  }
  if (!Object.values(value.states).every(isPoolOrderState)) return false
  if (
    value.returned !== undefined &&
    (!isRecord(value.returned) || !Object.values(value.returned).every(isPoolReturnedEntry))
  ) {
    return false
  }
  return value.seenAt === undefined || validTimestamp(value.seenAt)
}

function isPoolReturnedEntry(value: unknown): value is PoolReturnedEntry {
  return (
    isRecord(value) &&
    requiredString(value.title) &&
    isTier(scalar(value.tier)) &&
    requiredString(value.from) &&
    validTimestamp(value.at)
  )
}

function isPoolOrderState(value: unknown): value is PoolOrderState {
  if (!isRecord(value)) return false
  if (value.state !== undefined && value.state !== 'promoted' && value.state !== 'setaside') {
    return false
  }
  if (
    !optionalString(value.reason) ||
    !optionalString(value.release) ||
    (value.specWanted !== undefined && typeof value.specWanted !== 'boolean') ||
    (value.at !== undefined && !validTimestamp(value.at))
  ) {
    return false
  }
  if (value.state === 'setaside') return requiredString(value.reason)
  return requiredString(value.release)
}

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0)
}

function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function oneLine(value: string): boolean {
  return value.length > 0 && !/[\r\n]/.test(value)
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isAfter(added: string | undefined, seenAt: string | undefined): boolean {
  if (!added || !seenAt) return false
  const addedTime = Date.parse(added)
  const seenTime = Date.parse(seenAt)
  return !Number.isNaN(addedTime) && !Number.isNaN(seenTime) && addedTime > seenTime
}

function isTier(value: string | undefined): value is PoolTier {
  return value !== undefined && TIER_ORDER.includes(value as PoolTier)
}

function scalar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
