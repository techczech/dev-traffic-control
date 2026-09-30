import type { AgentWatchClaim, CollectionReceipt } from '../../../main/qa/types'
import { isLiveLocalWatch } from '../../../shared/agentSignals'
import { agentName } from './agentStatus'
import { formatFullAge } from './dateVocabulary'

export interface CollectionDisplay {
  message: string
  note?: string
  tone: 'status-ready' | 'status-progress' | 'status-inactive'
}

export function finishedCollectionDisplay({
  completedAt,
  receiptsStartAt,
  watch,
  collection,
  localMachine,
  now
}: {
  completedAt: string
  receiptsStartAt: string | undefined
  watch: AgentWatchClaim | undefined
  collection: CollectionReceipt | undefined
  localMachine: string
  now: Date
}): CollectionDisplay | null {
  if (
    !receiptsStartAt ||
    !Number.isFinite(Date.parse(completedAt)) ||
    !Number.isFinite(Date.parse(receiptsStartAt)) ||
    Date.parse(completedAt) <= Date.parse(receiptsStartAt)
  ) {
    return null
  }

  if (collection) {
    return {
      message: `Collected by ${agentName(collection.agent)} — ${formatFullAge(collection.collectedAt, now)}`,
      ...(collection.note?.trim() ? { note: collection.note.trim() } : {}),
      tone: 'status-ready'
    }
  }

  if (isLiveLocalWatch(watch, now, localMachine)) {
    return {
      message: `${agentName(watch?.agent ?? '')} is watching — waiting to be picked up`,
      tone: 'status-progress'
    }
  }

  return {
    message: 'Nothing is watching this — copy the collect prompt to start an agent',
    tone: 'status-inactive'
  }
}
