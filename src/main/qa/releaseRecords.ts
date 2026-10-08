import { stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  isConfinementError,
  listConfined,
  readConfinedText,
  recordTarget,
  writeConfinedAtomic,
  type RecordTarget
} from '../confinedFs'
import { salvageFrontmatter } from './parseRequest'
import { slugify, uniqueId } from './slug'
import { compareReleaseVersions } from '../../shared/releaseVersionOrder'

export { compareReleaseVersions } from '../../shared/releaseVersionOrder'

export type DeclaredReleaseState = 'notstarted' | 'building' | 'built' | 'you'
export type ReleaseFeatureStatus = DeclaredReleaseState | 'done'
export type ReleaseVerdict = 'works' | 'off'

export interface ReleaseAnswer {
  id: string
  verdict: ReleaseVerdict
  comment: string
  at: string
  /**
   * Pictures the reviewer attached to the verdict, relative to the project
   * folder: `releases/<version>.shots/<feature-id>-<n>.png`. Absent on an
   * answer without pictures, and on answers written by a version without verdict pictures.
   */
  screenshots?: string[]
  removed?: boolean
}

export interface ReleaseAnswers {
  app: string
  release: string
  answers: ReleaseAnswer[]
}

export interface ReleaseFeature {
  id: string
  title: string
  kind: 'feature' | 'groundwork'
  declaredState?: DeclaredReleaseState
  status?: ReleaseFeatureStatus
  prose?: string
  howToCheck?: string
  unlocks?: string
  /** `since: YYYY-MM-DD` — the day the feature reached its declared state. */
  since?: string
  answer?: ReleaseAnswer
}

export interface ReleaseRecord {
  path: string
  version: string
  app?: string
  release?: string
  repo?: string
  handoff?: string
  updated?: string
  /**
   * The prose between the frontmatter and the first `##` feature heading, when
   * there is any. Absent when the ledger opens straight onto its features.
   */
  intro?: string
  features: ReleaseFeature[]
  answers: ReleaseAnswer[]
  degraded: boolean
  fmSalvaged?: boolean
}

export interface ReleaseShipment {
  app: string
  release: string
  notes: string
  shippedAt: string
  returnedFeatureIds: string[]
  fixesTo?: string
}

export interface ReleaseVersion {
  version: string
  record: ReleaseRecord
  shipment?: ReleaseShipment
}

export type ProjectRelease =
  | {
      kind: 'recorded'
      project: string
      record: ReleaseRecord
      versions: ReleaseVersion[]
      inFlightVersion?: string
      shippedVersions?: string[]
    }
  | { kind: 'nothing-recorded'; project: string }

const DECLARED_STATES = new Set<DeclaredReleaseState>(['notstarted', 'building', 'built', 'you'])
const answerWrites = new Map<string, Promise<unknown>>()

export function parseReleaseRecord(
  raw: string,
  filePath: string,
  answers?: ReleaseAnswers
): ReleaseRecord {
  const version = path.basename(filePath, '.md')
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  let meta: Record<string, unknown> = {}
  let degraded = false
  let fmSalvaged = false

  if (frontmatter) {
    try {
      const parsed: unknown = parseYaml(frontmatter[1]) ?? {}
      if (!isRecord(parsed)) throw new Error('frontmatter is not a map')
      meta = parsed
    } catch {
      meta = salvageFrontmatter(frontmatter[1])
      degraded = true
      fmSalvaged = true
    }
  } else {
    degraded = true
  }

  const app = scalar(meta.app)
  const release = scalar(meta.release)
  const repo = scalar(meta.repo)
  const handoff = scalar(meta.handoff)
  const updated = scalar(meta.updated)
  if (!app || !release || !repo) degraded = true

  const answerList = answers?.answers ?? []
  const answerById = new Map(answerList.map((answer) => [answer.id, answer]))
  const parsedFeatures = parseFeatures(
    frontmatter ? raw.slice(frontmatter[0].length) : raw,
    answerById
  )
  if (parsedFeatures.degraded) degraded = true

  return {
    path: filePath,
    version,
    app,
    release,
    repo,
    handoff,
    updated,
    ...(parsedFeatures.intro ? { intro: parsedFeatures.intro } : {}),
    features: parsedFeatures.features,
    answers: answerList,
    degraded,
    ...(fmSalvaged ? { fmSalvaged: true } : {})
  }
}

export async function readProjectRelease(root: string, project: string): Promise<ProjectRelease> {
  const releaseDirectory = path.join(root, project, 'releases')
  // Every read below names its file as `<project>/releases/<file>` under the
  // records folder, so a linked project folder, `releases` folder or file is
  // refused (confinedFs) and reads as nothing recorded.
  const inReleases = (file: string): RecordTarget => ({ root, rel: `${project}/releases/${file}` })
  const files = await releaseFiles(root, project, releaseDirectory)
  if (files.length === 0) return { kind: 'nothing-recorded', project }

  files.sort((left, right) => compareReleaseVersions(right.version, left.version))
  const readVersions = await Promise.all(
    files.map(async (file): Promise<ReleaseVersion | undefined> => {
      const shipment = await readShipment(inReleases(`${file.version}.shipped.json`), file.version)
      if (!file.hasLedger) {
        if (!shipment) return undefined
        return {
          version: file.version,
          record: {
            path: file.path,
            version: file.version,
            app: shipment.app,
            release: file.version,
            features: [],
            answers: [],
            degraded: true
          },
          shipment
        }
      }
      const [raw, answers] = await Promise.all([
        readConfinedText(root, inReleases(`${file.version}.md`).rel),
        readAnswers(inReleases(`${file.version}.answers.json`))
      ])
      const record = parseReleaseRecord(raw, file.path, answers)
      if (!record.updated) record.updated = await mtimeIso(file.path)
      return {
        version: file.version,
        record,
        ...(shipment ? { shipment } : {})
      }
    })
  )
  const versions = readVersions.filter(
    (version): version is ReleaseVersion => version !== undefined
  )
  if (versions.length === 0) return { kind: 'nothing-recorded', project }
  const releasesInFlight = versions.filter((version) => !version.shipment)
  // The newest unshipped release is the one in flight. A project can hold
  // several unshipped records, because older releases are not always marked
  // shipped. Requiring exactly one would then report no release in flight at
  // all, and this view would disagree with any view that reads the newest
  // record.
  const inFlightVersion = [...releasesInFlight].sort((left, right) =>
    compareReleaseVersions(right.version, left.version)
  )[0]?.version
  const selected = versions.find((version) => version.version === inFlightVersion) ?? versions[0]
  if (selected.record.features.length === 0 && !selected.shipment) {
    return { kind: 'nothing-recorded', project }
  }
  return {
    kind: 'recorded',
    project,
    record: selected.record,
    versions,
    ...(inFlightVersion ? { inFlightVersion } : {}),
    shippedVersions: versions
      .filter((candidate) => candidate.version !== selected.version || !!candidate.shipment)
      .map((candidate) => candidate.version)
  }
}

/**
 * Writes one app-owned answer beside a release record without touching the
 * Markdown ledger. `recordRoot` is the records folder the answers file is
 * confined to (confinedFs); the IPC handler always passes it.
 */
export async function writeReleaseAnswer(
  record: ReleaseRecord,
  id: string,
  verdict: ReleaseVerdict,
  comment: string,
  at: string,
  screenshots?: readonly string[],
  recordRoot?: string
): Promise<ReleaseAnswers> {
  const feature = record.features.find((candidate) => candidate.id === id)
  if (!feature || feature.kind !== 'feature' || feature.declaredState !== 'you') {
    throw new Error('This release row cannot be answered.')
  }
  if (!record.app || !record.release) throw new Error('This release record is incomplete.')
  if (
    screenshots !== undefined &&
    !screenshots.every((shot) => verdictShotFeature(record.version, shot) === id)
  ) {
    throw new Error('A picture on this verdict is not one of its own.')
  }

  const sidecarPath = record.path.replace(/\.md$/, '.answers.json')
  const previous = answerWrites.get(sidecarPath) ?? Promise.resolve()
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      const sidecar = await recordTarget(sidecarPath, recordRoot)
      const existing = await readAnswers(sidecar, true)
      // No list given keeps the pictures the answer already has; a list
      // replaces them. The field is written only when there is a picture, so
      // an answer without one carries no `screenshots` key at all.
      const shots = [
        ...new Set(
          screenshots ??
            existing?.answers.find((candidate) => candidate.id === id)?.screenshots ??
            []
        )
      ]
      const answer: ReleaseAnswer = {
        id,
        verdict,
        comment: comment.trim(),
        at,
        ...(shots.length > 0 ? { screenshots: shots } : {})
      }
      const answers = [
        ...(existing?.answers ?? []).filter((candidate) => candidate.id !== id),
        answer
      ]
      const next: ReleaseAnswers = { app: record.app!, release: record.release!, answers }
      await writeConfinedAtomic(sidecar.root, sidecar.rel, `${JSON.stringify(next, null, 2)}\n`)
      return next
    })
  answerWrites.set(sidecarPath, queued)
  try {
    return await queued
  } finally {
    if (answerWrites.get(sidecarPath) === queued) answerWrites.delete(sidecarPath)
  }
}

/**
 * The feature id a verdict picture path names, or `null` when the path is not
 * exactly `releases/<version>.shots/<feature-id>-<n>.png` (relative to the
 * project folder, forward slashes). The one grammar for a verdict picture:
 * the answer write and the picture read both go through it.
 */
export function verdictShotFeature(version: string, relPath: unknown): string | null {
  if (typeof relPath !== 'string') return null
  const prefix = `releases/${version}.shots/`
  if (!relPath.startsWith(prefix)) return null
  const match = relPath.slice(prefix.length).match(/^([a-z0-9-]+)-\d+\.png$/)
  return match ? match[1] : null
}

async function releaseFiles(
  root: string,
  project: string,
  directory: string
): Promise<Array<{ path: string; version: string; hasLedger: boolean }>> {
  try {
    if (!project || project.startsWith('.') || /[/\\]/.test(project)) return []
    const entries = await listConfined(root, `${project}/releases`)
    const ledgerVersions = new Set(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name.slice(0, -'.md'.length))
    )
    const shippedVersions = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.shipped.json'))
      .map((entry) => entry.name.slice(0, -'.shipped.json'.length))
    return [...new Set([...ledgerVersions, ...shippedVersions])]
      .filter((version) => /^\d+(?:\.\d+)*(?:[-+].*)?$/.test(version))
      .map((version) => ({
        path: path.join(directory, `${version}.md`),
        version,
        hasLedger: ledgerVersions.has(version)
      }))
  } catch {
    return []
  }
}

/**
 * The answers file, or nothing when it is missing or unreadable. Before a
 * write (`forWrite`) a file the confinement rule refuses is an error instead,
 * so the answers already given are never rebuilt from nothing.
 */
async function readAnswers(
  file: RecordTarget,
  forWrite = false
): Promise<ReleaseAnswers | undefined> {
  let raw: string
  try {
    raw = await readConfinedText(file.root, file.rel)
  } catch (error) {
    if (forWrite && isConfinementError(error)) throw error
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return undefined
    const app = scalar(parsed.app)
    const release = scalar(parsed.release)
    if (!app || !release) return undefined
    const answers = parsed.answers.flatMap((candidate): ReleaseAnswer[] => {
      if (!isRecord(candidate)) return []
      const id = scalar(candidate.id)
      const verdict = scalar(candidate.verdict)
      if (!id || (verdict !== 'works' && verdict !== 'off')) return []
      return [
        {
          id,
          verdict,
          comment: scalar(candidate.comment) ?? '',
          at: scalar(candidate.at) ?? '',
          ...answerShots(candidate.screenshots),
          ...(candidate.removed === true ? { removed: true } : {})
        }
      ]
    })
    return { app, release, answers }
  } catch {
    return undefined
  }
}

function answerShots(value: unknown): { screenshots?: string[] } {
  if (!Array.isArray(value)) return {}
  const shots = value.filter((shot): shot is string => typeof shot === 'string' && shot !== '')
  return shots.length > 0 ? { screenshots: shots } : {}
}

async function readShipment(
  file: RecordTarget,
  expectedVersion: string
): Promise<ReleaseShipment | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readConfinedText(file.root, file.rel))
    if (!isRecord(parsed)) return undefined
    const app = scalar(parsed.app)
    const release = scalar(parsed.release)
    const shippedAt = scalar(parsed.shippedAt)
    if (!app || release !== expectedVersion || !shippedAt) return undefined
    const returnedFeatureIds = Array.isArray(parsed.returnedFeatureIds)
      ? parsed.returnedFeatureIds.flatMap((candidate) => {
          const id = scalar(candidate)
          return id ? [id] : []
        })
      : []
    const fixesTo = scalar(parsed.fixesTo)
    return {
      app,
      release,
      notes: scalar(parsed.notes) ?? '',
      shippedAt,
      returnedFeatureIds,
      ...(fixesTo ? { fixesTo } : {})
    }
  } catch {
    return undefined
  }
}

function parseFeatures(
  body: string,
  answerById: ReadonlyMap<string, ReleaseAnswer>
): { features: ReleaseFeature[]; degraded: boolean; intro?: string } {
  const sections: Array<{ heading: string; lines: string[] }> = []
  const introLines: string[] = []
  let current: { heading: string; lines: string[] } | null = null
  let inFence = false

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      if (current) current.lines.push(line)
      else introLines.push(line)
      continue
    }
    const heading = !inFence ? line.match(/^##\s+(.+?)\s*$/) : null
    if (heading) {
      current = { heading: heading[1], lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      introLines.push(line)
    }
  }
  const intro = introLines.join('\n').trim()

  const taken = new Set<string>()
  const features: ReleaseFeature[] = []
  let degraded = false

  for (const section of sections) {
    let title = section.heading
    let id: string | undefined
    const explicit = title.match(/\{#([a-z0-9-]+)\}\s*$/i)
    if (explicit) {
      id = explicit[1].toLowerCase()
      title = title.slice(0, explicit.index).trim()
    }
    id = uniqueId(id ?? slugify(title), taken)
    taken.add(id)

    const { fields, proseLines } = splitFields(section.lines)
    const kind = fields.kind?.trim().toLowerCase() === 'groundwork' ? 'groundwork' : 'feature'
    const rawState = fields.state?.trim().toLowerCase()
    let declaredState: DeclaredReleaseState | undefined
    if (rawState) {
      if (DECLARED_STATES.has(rawState as DeclaredReleaseState)) {
        declaredState = rawState as DeclaredReleaseState
      } else {
        degraded = true
      }
    }
    if (kind === 'groundwork') declaredState = undefined

    const since = fields.since?.trim()
    const content = splitHowToCheck(proseLines)
    const answer = kind === 'feature' ? answerById.get(id) : undefined
    const status =
      kind === 'groundwork'
        ? undefined
        : answer?.verdict === 'works'
          ? 'done'
          : answer?.verdict === 'off'
            ? 'building'
            : declaredState

    features.push({
      id,
      title,
      kind,
      declaredState,
      status,
      ...(content.prose ? { prose: content.prose } : {}),
      ...(content.howToCheck ? { howToCheck: content.howToCheck } : {}),
      ...(fields.unlocks?.trim() ? { unlocks: fields.unlocks.trim() } : {}),
      ...(kind === 'feature' && since && isCalendarDay(since) ? { since } : {}),
      ...(answer ? { answer } : {})
    })
  }

  return { features, degraded, ...(intro ? { intro } : {}) }
}

/** `YYYY-MM-DD` naming a real day; anything else is ignored, never guessed. */
function isCalendarDay(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function splitFields(lines: string[]): {
  fields: Record<string, string>
  proseLines: string[]
} {
  const fields: Record<string, string> = {}
  let index = 0
  for (; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) break
    fields[field[1].toLowerCase()] = field[2]
  }
  return { fields, proseLines: lines.slice(index) }
}

function splitHowToCheck(lines: string[]): { prose?: string; howToCheck?: string } {
  const labelIndex = lines.findIndex((line) => /^\*\*How to check\*\*(?:\s+.*)?$/i.test(line))
  if (labelIndex === -1) return optionalText(lines, [])

  const inline = lines[labelIndex].replace(/^\*\*How to check\*\*\s*/i, '')
  return optionalText(lines.slice(0, labelIndex), [inline, ...lines.slice(labelIndex + 1)])
}

function optionalText(
  proseLines: string[],
  checkLines: string[]
): { prose?: string; howToCheck?: string } {
  const prose = proseLines.join('\n').trim()
  const howToCheck = checkLines.join('\n').trim()
  return {
    ...(prose ? { prose } : {}),
    ...(howToCheck ? { howToCheck } : {})
  }
}

function scalar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function mtimeIso(filePath: string): Promise<string | undefined> {
  try {
    return (await stat(filePath)).mtime.toISOString()
  } catch {
    return undefined
  }
}
