import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './atomicWrite'
import { readProjectPool, returnProjectPoolFeatures } from './pool'
import type { ReleaseRecord, ReleaseShipment } from './releaseRecords'

export interface ReturnedReleaseFeature {
  id: string
  title: string
}

export interface ShipReleaseInput {
  root: string
  project: string
  record: ReleaseRecord
  notes: string
  shippedAt: string
  fixesTo?: string
}

export interface ShipReleaseResult {
  shipment: ReleaseShipment
  returnedFeatures: ReturnedReleaseFeature[]
}

export async function shipRelease(input: ShipReleaseInput): Promise<ShipReleaseResult> {
  const app = input.record.app?.trim()
  const version = input.record.version.trim()
  if (!app || !version || input.record.release?.trim() !== version) {
    throw new Error('This release record is incomplete.')
  }
  if (Number.isNaN(Date.parse(input.shippedAt))) throw new Error('The shipment time is invalid.')
  const fixesTo = input.fixesTo?.trim()
  if (fixesTo === version) throw new Error('A fixes release cannot patch itself.')

  const sidecarPath = path.join(input.root, input.project, 'releases', `${version}.shipped.json`)
  if (await exists(sidecarPath)) {
    throw new Error(`${app} ${version} has already shipped. Frozen notes cannot be overwritten.`)
  }

  const pool = await readProjectPool(input.root, input.project)
  const releaseNames = new Set(
    [input.record.version, input.record.release].filter(
      (candidate): candidate is string => !!candidate?.trim()
    )
  )
  const promotedIdeas = pool.ideas.filter(
    (idea) =>
      idea.state === 'promoted' &&
      !!idea.candidateRelease &&
      releaseNames.has(idea.candidateRelease)
  )
  const returns = new Map(
    promotedIdeas.map((idea) => [
      idea.id,
      {
        id: idea.id,
        title: idea.title,
        tier: idea.tier,
        from: version,
        at: input.shippedAt
      }
    ])
  )
  for (const feature of input.record.features) {
    if (feature.kind !== 'feature' || feature.status !== 'notstarted') continue
    const poolIdea = pool.ideas.find((idea) => idea.id === feature.id)
    returns.set(feature.id, {
      id: feature.id,
      title: feature.title,
      tier: poolIdea?.tier ?? 'functionality',
      from: version,
      at: input.shippedAt
    })
  }

  const returned = await returnProjectPoolFeatures(input.root, input.project, [...returns.values()])
  const shipment: ReleaseShipment = {
    app,
    release: version,
    notes: input.notes,
    shippedAt: input.shippedAt,
    returnedFeatureIds: returned.returnedIdeas.map((feature) => feature.id),
    ...(fixesTo ? { fixesTo } : {})
  }
  await atomicWrite(sidecarPath, `${JSON.stringify(shipment, null, 2)}\n`)
  return { shipment, returnedFeatures: returned.returnedIdeas }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    return !isMissingFile(error)
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
