export const MAX_NETWORK_RELATIONSHIPS_PER_KIND = 12

export interface NetworkRequestRelationshipRecord {
  id: string
  cdpRequestId?: string
  initiatorRequestCdpId?: string
  startedAt: string
  startedMonotonicSeconds?: number
}

export interface DerivedNetworkRequestRelationships<T extends NetworkRequestRelationshipRecord> {
  triggeredBy?: T
  redirectChain: T[]
  dependents: T[]
  truncated: boolean
}

function relationshipTarget<T extends NetworkRequestRelationshipRecord>(
  requests: T[],
  cdpRequestId: string | undefined,
  child: T
): T | undefined {
  if (!cdpRequestId) return undefined
  const candidates = requests.filter((candidate) => (
    candidate.id !== child.id && candidate.cdpRequestId === cdpRequestId
  ))
  if (!candidates.length) return undefined
  if (child.startedMonotonicSeconds !== undefined) {
    const preceding = candidates.filter((candidate) => (
      candidate.startedMonotonicSeconds !== undefined
      && candidate.startedMonotonicSeconds <= (child.startedMonotonicSeconds as number)
    ))
    if (preceding.length) return preceding.at(-1)
  }
  const childStartedAt = Date.parse(child.startedAt)
  if (Number.isFinite(childStartedAt)) {
    const preceding = candidates.filter((candidate) => Date.parse(candidate.startedAt) <= childStartedAt)
    if (preceding.length) return preceding.at(-1)
  }
  return candidates.at(-1)
}

export function deriveNetworkRequestRelationships<T extends NetworkRequestRelationshipRecord>(
  requests: T[],
  request: T,
  maxPerKind = MAX_NETWORK_RELATIONSHIPS_PER_KIND
): DerivedNetworkRequestRelationships<T> | undefined {
  const boundedMax = Math.max(1, Math.floor(maxPerKind))
  const redirectCandidates = request.cdpRequestId
    ? requests.filter((candidate) => candidate.cdpRequestId === request.cdpRequestId)
    : []
  const hasRedirectChain = redirectCandidates.length > 1
  const redirectIndex = redirectCandidates.findIndex((candidate) => candidate.id === request.id)
  const redirectWindowStart = redirectCandidates.length > boundedMax
    ? Math.max(0, Math.min(
      redirectIndex - Math.floor(boundedMax / 2),
      redirectCandidates.length - boundedMax
    ))
    : 0
  const redirectChain = hasRedirectChain
    ? redirectCandidates.slice(redirectWindowStart, redirectWindowStart + boundedMax)
    : []
  const triggeredBy = relationshipTarget(requests, request.initiatorRequestCdpId, request)
  const dependentCandidates = request.cdpRequestId
    ? requests.filter((candidate) => (
      candidate.id !== request.id
      && candidate.initiatorRequestCdpId === request.cdpRequestId
      && relationshipTarget(requests, candidate.initiatorRequestCdpId, candidate)?.id === request.id
    ))
    : []
  if (!triggeredBy && !redirectChain.length && !dependentCandidates.length) return undefined
  return {
    ...(triggeredBy ? { triggeredBy } : {}),
    redirectChain,
    dependents: dependentCandidates.slice(0, boundedMax),
    truncated: (hasRedirectChain && redirectCandidates.length > redirectChain.length)
      || dependentCandidates.length > boundedMax
  }
}
