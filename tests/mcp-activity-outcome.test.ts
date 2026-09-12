import { describe, expect, it } from 'vitest'
import { classifyMcpActivityResult } from '../src/main/mcp/server.js'

const base = {
  readOnly: false,
  dispatched: true,
  cancelled: false,
  timedOut: false,
  threw: false,
  isError: false
}

describe('privacy-safe MCP activity outcomes', () => {
  it('distinguishes cancellation, policy blocking, interruption, and unknown effects', () => {
    expect(classifyMcpActivityResult({ ...base, cancelled: true })).toEqual({
      outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', dispatch: 'dispatched',
      effects: 'possible', evidenceSource: 'hronaut-observed'
    })
    expect(classifyMcpActivityResult({ ...base, dispatched: false, isError: true, status: 'POLICY_REJECTED' })).toMatchObject({
      outcome: 'blocked', reasonCode: 'POLICY_REJECTED', dispatch: 'not-dispatched', effects: 'none'
    })
    expect(classifyMcpActivityResult({ ...base, readOnly: true, isError: true, status: 'STALE_OBSERVATION' })).toMatchObject({
      outcome: 'interrupted', reasonCode: 'CONTEXT_CHANGED', effects: 'none'
    })
    expect(classifyMcpActivityResult({ ...base, isError: true, status: 'OUTCOME_UNKNOWN' })).toMatchObject({
      outcome: 'outcome-unknown', reasonCode: 'CONTEXT_CHANGED', effects: 'possible'
    })
  })

  it('distinguishes a bounded timeout without retaining its error text', () => {
    expect(classifyMcpActivityResult({ ...base, timedOut: true, threw: true })).toEqual({
      outcome: 'timed-out', reasonCode: 'TIMEOUT', dispatch: 'dispatched',
      effects: 'possible', evidenceSource: 'hronaut-observed'
    })
  })

  it('claims confirmed effects only when a write postcondition was verified', () => {
    expect(classifyMcpActivityResult(base)).toMatchObject({
      outcome: 'succeeded', reasonCode: 'COMPLETED', effects: 'possible'
    })
    expect(classifyMcpActivityResult({ ...base, verificationStatus: 'verified' })).toMatchObject({
      outcome: 'succeeded', reasonCode: 'POSTCONDITION_VERIFIED', effects: 'confirmed'
    })
    expect(classifyMcpActivityResult({ ...base, verificationStatus: 'unknown' })).toMatchObject({
      outcome: 'outcome-unknown', reasonCode: 'POSTCONDITION_NOT_VERIFIED', effects: 'possible'
    })
  })

  it('keeps thrown and returned errors in fixed reason categories', () => {
    expect(classifyMcpActivityResult({ ...base, dispatched: false, threw: true })).toMatchObject({
      outcome: 'failed', reasonCode: 'COMMAND_FAILED', dispatch: 'not-dispatched', effects: 'none'
    })
    expect(classifyMcpActivityResult({ ...base, isError: true })).toMatchObject({
      outcome: 'failed', reasonCode: 'RESULT_ERROR', dispatch: 'dispatched', effects: 'possible'
    })
  })
})
