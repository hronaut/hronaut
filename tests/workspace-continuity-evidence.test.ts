import { describe, expect, it } from 'vitest'
import { WorkspaceContinuityEvidenceFactory } from '../src/main/mcp/workspace-continuity-evidence.js'
const input = { workspaceId: 'workspace', tab: { id: 'tab', url: 'https://example.com/private?token=secret', navigationGeneration: 1, humanInteractionGeneration: 0 }, policy: { mode: 'restricted' as const, rules: ['https://example.com', 'https://other.example'] } }

describe('private continuity evidence', () => {
  it('retains only keyed origin/policy/marker fingerprints', () => {
    const evidence = new WorkspaceContinuityEvidenceFactory().capture({ ...input, marker: { requested: true, value: 'private marker' } })
    expect(evidence).not.toBeNull()
    expect(JSON.stringify(evidence)).not.toMatch(/example|private|secret/)
  })
  it('ignores URL paths but preserves navigation generations and origin changes', () => {
    const factory = new WorkspaceContinuityEvidenceFactory()
    const baseline = factory.capture(input)
    expect(factory.capture({ ...input, tab: { ...input.tab, url: 'https://example.com/another#fragment' } })).toEqual(baseline)
    expect(factory.capture({ ...input, tab: { ...input.tab, navigationGeneration: 2 } })?.navigationGeneration).toBe(2)
    expect(factory.capture({ ...input, tab: { ...input.tab, url: 'https://other.example/' } })?.originDigest).not.toBe(baseline?.originDigest)
  })
  it('normalizes rule ordering but detects policy changes', () => {
    const factory = new WorkspaceContinuityEvidenceFactory()
    const baseline = factory.capture(input)
    expect(factory.capture({ ...input, policy: { ...input.policy, rules: [...input.policy.rules].reverse() } })).toEqual(baseline)
    expect(factory.capture({ ...input, policy: { mode: 'unrestricted', rules: [] } })?.policyDigest).not.toBe(baseline?.policyDigest)
  })
  it('cannot reuse fingerprints across runtime epochs', () => {
    const first = new WorkspaceContinuityEvidenceFactory().capture(input)
    const second = new WorkspaceContinuityEvidenceFactory().capture(input)
    expect(first?.epoch).not.toBe(second?.epoch)
    expect(first?.originDigest).not.toBe(second?.originDigest)
  })
  it.each(['file:///private/path', 'about:blank', 'https://user:secret@example.com', 'invalid'])('rejects unavailable web origin %s', url => {
    expect(new WorkspaceContinuityEvidenceFactory().capture({ ...input, tab: { ...input.tab, url } })).toBeNull()
  })
  it('does not invent absent human-interaction evidence', () => {
    expect(new WorkspaceContinuityEvidenceFactory().capture({ ...input, tab: { ...input.tab, humanInteractionGeneration: undefined } })).toBeNull()
  })
  it('bounds opt-in marker bytes and treats unavailable markers conservatively', () => {
    const factory = new WorkspaceContinuityEvidenceFactory()
    expect(factory.capture({ ...input, marker: { requested: true, value: 'é'.repeat(256) } })).not.toBeNull()
    expect(factory.capture({ ...input, marker: { requested: true, value: 'é'.repeat(257) } })).toBeNull()
    expect(factory.capture({ ...input, marker: { requested: true, value: null } })).toBeNull()
  })
})
