import type { AgentWatchClaim } from '../main/qa/types'

export function isLiveLocalWatch(
  claim: AgentWatchClaim | undefined,
  now: Date,
  localMachine: string
): boolean {
  if (!claim || claim.machine !== localMachine) return false
  const heartbeat = Date.parse(claim.heartbeatAt)
  return !Number.isNaN(heartbeat) && now.getTime() - heartbeat <= 90_000
}
