import { expect, it } from 'vitest'
import { McpActivityHistory } from '../src/main/mcp/activity-history.js'

it('retains forty recent completions while preserving aggregate counts and ignoring duplicate settlement', () => {
  const history = new McpActivityHistory()
  for (let index = 0; index < 45; index += 1) {
    const event = { activityId: String(index), tabId: 'tab', toolName: 'browser_click', occurredAt: index * 100 }
    history.track({ ...event, phase: 'started' })
    const completed = { ...event, occurredAt: event.occurredAt + 10, phase: 'failed' as const }
    history.track(completed)
    history.track(completed)
  }
  const snapshot = history.snapshot()
  expect(snapshot.completedToolCalls).toBe(45)
  expect(snapshot.recentActivity).toHaveLength(40)
  expect(snapshot.recentActivity[0]?.activityId).toBe('44')
  expect(snapshot.recentActivity.at(-1)?.activityId).toBe('5')
  expect(snapshot.toolMetrics).toMatchObject([{ count: 45, failures: 45, totalDurationMs: 450 }])
  expect(snapshot.outcomeTotals).toEqual({ failed: 45 })
  snapshot.recentActivity[0]!.toolName = 'mutated'
  snapshot.toolMetrics[0]!.count = 0
  expect(history.snapshot().recentActivity[0]?.toolName).toBe('browser_click')
  expect(history.snapshot().toolMetrics[0]?.count).toBe(45)
})

it('retains bounded outcome classifications and aggregates beyond recent history', () => {
  const history = new McpActivityHistory()
  const outcomes = ['succeeded', 'cancelled', 'blocked', 'interrupted', 'outcome-unknown'] as const
  for (let index = 0; index < 45; index += 1) {
    const event = { activityId: String(index), tabId: 'tab', toolName: 'browser_click', occurredAt: index * 100 }
    history.track({ ...event, phase: 'started' })
    const outcome = outcomes[index % outcomes.length]!
    history.track({
      ...event,
      occurredAt: event.occurredAt + 10,
      phase: outcome === 'succeeded' ? 'finished' : 'failed',
      result: {
        outcome,
        reasonCode: outcome === 'succeeded' ? 'COMPLETED' : outcome === 'cancelled' ? 'REQUEST_CANCELLED'
          : outcome === 'blocked' ? 'POLICY_REJECTED' : outcome === 'interrupted' ? 'CONTEXT_CHANGED' : 'POSTCONDITION_NOT_VERIFIED',
        dispatch: outcome === 'blocked' ? 'not-dispatched' : 'dispatched',
        effects: outcome === 'succeeded' ? 'confirmed' : outcome === 'blocked' ? 'none' : 'possible',
        evidenceSource: 'hronaut-observed'
      }
    })
  }
  const snapshot = history.snapshot()
  expect(snapshot.recentActivity).toHaveLength(40)
  expect(snapshot.outcomeTotals).toEqual({ succeeded: 9, cancelled: 9, blocked: 9, interrupted: 9, 'outcome-unknown': 9 })
  expect(snapshot.toolMetrics[0]?.outcomes).toEqual(snapshot.outcomeTotals)
  expect(snapshot.recentActivity.every(activity => !JSON.stringify(activity.result).includes('private'))).toBe(true)
})
