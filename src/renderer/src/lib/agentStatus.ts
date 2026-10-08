import type { AgentWatchClaim } from '../../../main/qa/types'
import { isLiveLocalWatch } from '../../../shared/agentSignals'
import { formatFullAge } from './dateVocabulary'

export function agentName(agent: string): string {
  return agent ? agent[0].toUpperCase() + agent.slice(1) : 'An agent'
}

export interface AgentStatusDisplay {
  sentence: string
  live: boolean
  tone: 'status-progress' | 'status-inactive'
}

export function agentStatusDisplay(
  claim: AgentWatchClaim | undefined,
  now: Date,
  localMachine: string
): AgentStatusDisplay {
  const live = isLiveLocalWatch(claim, now, localMachine)
  return {
    sentence: agentStatusSentence(claim, now, localMachine),
    live,
    tone: live ? 'status-progress' : 'status-inactive'
  }
}

export function agentStatusSentence(
  claim: AgentWatchClaim | undefined,
  now: Date,
  localMachine: string
): string {
  if (!claim) return 'Nothing is watching this right now'
  if (claim.machine !== localMachine) return `An agent on ${claim.machine} is watching this`
  if (isLiveLocalWatch(claim, now, localMachine)) {
    return `${agentName(claim.agent)} is watching this — last seen ${formatFullAge(claim.heartbeatAt, now)}`
  }
  return `Nothing is watching this right now — last seen ${formatFullAge(claim.heartbeatAt, now)}`
}
