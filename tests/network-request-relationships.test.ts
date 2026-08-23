import { describe, expect, it } from 'vitest'
import {
  deriveNetworkRequestRelationships,
  type NetworkRequestRelationshipRecord
} from '../src/shared/network-request-relationships.js'

function request(
  id: string,
  monotonic: number,
  relationship: Partial<NetworkRequestRelationshipRecord> = {}
): NetworkRequestRelationshipRecord {
  return {
    id,
    startedAt: new Date(1_700_000_000_000 + monotonic * 1_000).toISOString(),
    startedMonotonicSeconds: monotonic,
    ...relationship
  }
}

describe('network request relationships', () => {
  it('uses the latest preceding redirect hop as the reported parent', () => {
    const first = request('first', 1, { cdpRequestId: 'parent' })
    const final = request('final', 2, { cdpRequestId: 'parent' })
    const child = request('child', 3, {
      cdpRequestId: 'child',
      initiatorRequestCdpId: 'parent'
    })
    const requests = [first, final, child]

    expect(deriveNetworkRequestRelationships(requests, child)).toMatchObject({
      triggeredBy: { id: 'final' },
      redirectChain: [],
      dependents: [],
      truncated: false
    })
    expect(deriveNetworkRequestRelationships(requests, first)?.dependents).toEqual([])
    expect(deriveNetworkRequestRelationships(requests, final)?.dependents).toEqual([
      expect.objectContaining({ id: 'child' })
    ])
  })

  it('returns a chronological redirect window that includes the selected request', () => {
    const requests = Array.from({ length: 20 }, (_, index) => request(`hop-${index}`, index, {
      cdpRequestId: 'redirect-chain'
    }))
    const relationships = deriveNetworkRequestRelationships(requests, requests[10]!, 6)

    expect(relationships?.redirectChain.map(({ id }) => id)).toEqual([
      'hop-7', 'hop-8', 'hop-9', 'hop-10', 'hop-11', 'hop-12'
    ])
    expect(relationships?.truncated).toBe(true)
  })

  it('bounds direct dependents and omits unrelated requests', () => {
    const parent = request('parent', 1, { cdpRequestId: 'parent-cdp' })
    const dependents = Array.from({ length: 5 }, (_, index) => request(`child-${index}`, index + 2, {
      cdpRequestId: `child-cdp-${index}`,
      initiatorRequestCdpId: 'parent-cdp'
    }))
    const unrelated = request('unrelated', 9, { cdpRequestId: 'unrelated-cdp' })
    const relationships = deriveNetworkRequestRelationships([parent, ...dependents, unrelated], parent, 3)

    expect(relationships?.dependents.map(({ id }) => id)).toEqual(['child-0', 'child-1', 'child-2'])
    expect(relationships?.truncated).toBe(true)
    expect(deriveNetworkRequestRelationships([unrelated], unrelated)).toBeUndefined()
  })
})
