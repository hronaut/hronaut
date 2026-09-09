import { describe, expect, it } from 'vitest'
import { compareWorkspaceContinuity, type WorkspaceContinuityEvidence } from '../src/main/mcp/workspace-continuity.js'

const checkpoint: WorkspaceContinuityEvidence = {
  epoch: 'process-1', workspaceId: 'workspace-1', tabId: 'tab-1', originDigest: 'keyed-origin',
  policyDigest: 'keyed-policy', navigationGeneration: 3, humanInteractionGeneration: 2
}
const compare = (current: WorkspaceContinuityEvidence | null) => compareWorkspaceContinuity({ checkpoint, current, priorOutcome: 'NONE', pageSettled: true })

describe('workspace continuity comparison', () => {
  it('requires fresh dispatch checks even when the checkpoint matches', () => {
    expect(compare({ ...checkpoint })).toEqual({ status: 'PASS', reasons: [], priorOutcome: 'NONE', nextAction: 'RECHECK_BEFORE_DISPATCH' })
  })
  it.each([
    ['epoch', 'another-process', 'RUNTIME_CHANGED'], ['workspaceId', 'other-workspace', 'WORKSPACE_CHANGED'],
    ['tabId', 'other-tab', 'TAB_CHANGED'], ['originDigest', 'other-origin', 'ORIGIN_CHANGED'],
    ['policyDigest', 'other-policy', 'POLICY_CHANGED'], ['navigationGeneration', 4, 'NAVIGATION_CHANGED'],
    ['humanInteractionGeneration', 3, 'HUMAN_INPUT_CHANGED'], ['markerDigest', 'new-marker', 'MARKER_CHANGED']
  ] as const)('blocks changed %s', (field, value, reason) => {
    expect(compare({ ...checkpoint, [field]: value })).toMatchObject({ status: 'BLOCKED', reasons: [reason] })
  })
  it('does not treat matching counters after restart as continuity', () => {
    expect(compare({ ...checkpoint, epoch: 'restarted' }).status).toBe('BLOCKED')
  })
  it.each([null, { ...checkpoint, navigationGeneration: NaN }, { ...checkpoint, humanInteractionGeneration: -1 }, { ...checkpoint, policyDigest: '' }])('blocks unavailable evidence', current => {
    expect(compare(current)).toMatchObject({ status: 'BLOCKED', reasons: ['EVIDENCE_UNAVAILABLE'] })
  })
  it('blocks missing checkpoints instead of manufacturing a baseline', () => {
    expect(compareWorkspaceContinuity({ checkpoint: null, current: checkpoint, priorOutcome: 'NONE', pageSettled: true })).toMatchObject({ status: 'BLOCKED', reasons: ['CHECKPOINT_UNAVAILABLE'] })
  })
  it('blocks a missing opted-in marker', () => {
    expect(compareWorkspaceContinuity({ checkpoint: { ...checkpoint, markerDigest: 'marker' }, current: checkpoint, priorOutcome: 'NONE', pageSettled: true })).toMatchObject({ status: 'BLOCKED', reasons: ['MARKER_CHANGED'] })
  })
  it('cannot resolve unknown side effects from matching browser state', () => {
    expect(compareWorkspaceContinuity({ checkpoint, current: checkpoint, priorOutcome: 'OUTCOME_UNKNOWN', pageSettled: true })).toMatchObject({ status: 'BLOCKED', priorOutcome: 'OUTCOME_UNKNOWN', reasons: ['PRIOR_WRITE_OUTCOME_UNKNOWN'] })
  })
  it('requires fresh observation after interrupted reads and while loading', () => {
    expect(compareWorkspaceContinuity({ checkpoint, current: checkpoint, priorOutcome: 'STALE_OBSERVATION', pageSettled: false })).toMatchObject({ status: 'WARN', reasons: ['PRIOR_OBSERVATION_STALE', 'PAGE_NOT_SETTLED'] })
  })
  it('never echoes supplied evidence into the report', () => {
    const result = compare({ ...checkpoint, workspaceId: 'sensitive-value', originDigest: 'another-sensitive-value' })
    expect(JSON.stringify(result)).not.toContain('sensitive-value')
    expect(checkpoint.workspaceId).toBe('workspace-1')
  })
})
