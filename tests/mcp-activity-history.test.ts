import { expect, it } from 'vitest'
import { McpActivityHistory } from '../src/main/mcp/activity-history.js'

it('retains forty recent completions while preserving aggregate counts and ignoring duplicate settlement', () => {
  const history = new McpActivityHistory()
  for (let index = 0; index < 45; index += 1) {
    const event = { activityId: String(index), tabId: 'tab', toolName: 'browser_click', occurredAt: index * 100 }
    history.track({ ...event, phase: 'started' }, event.occurredAt)
    const completed = { ...event, occurredAt: event.occurredAt + 10, phase: 'failed' as const }
    history.track(completed, completed.occurredAt)
    history.track(completed, completed.occurredAt)
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
    history.track({ ...event, phase: 'started' }, event.occurredAt)
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
    }, event.occurredAt + 10)
  }
  const snapshot = history.snapshot()
  expect(snapshot.recentActivity).toHaveLength(40)
  expect(snapshot.outcomeTotals).toEqual({ succeeded: 9, cancelled: 9, blocked: 9, interrupted: 9, 'outcome-unknown': 9 })
  expect(snapshot.toolMetrics[0]?.outcomes).toEqual(snapshot.outcomeTotals)
  expect(snapshot.recentActivity.every(activity => !JSON.stringify(activity.result).includes('private'))).toBe(true)
})

it('evicts the oldest unfinished activities and settles the retained window once', () => {
  const history = new McpActivityHistory()
  const events = Array.from({ length: 100 }, (_, index) => ({
    activityId: String(index), tabId: 'tab', toolName: 'browser_click', occurredAt: index * 100
  }))
  for (const event of events) history.track({ ...event, phase: 'started' }, event.occurredAt)
  for (const event of events) {
    const completed = { ...event, occurredAt: event.occurredAt + 10, phase: 'finished' as const }
    history.track(completed, completed.occurredAt)
    history.track(completed, completed.occurredAt)
  }
  const snapshot = history.snapshot()
  expect(snapshot.completedToolCalls).toBe(40)
  expect(snapshot.recentActivity.map(activity => activity.activityId)).toEqual(
    events.slice(-40).reverse().map(event => event.activityId)
  )
  expect(snapshot.toolMetrics).toMatchObject([{ count: 40, failures: 0, totalDurationMs: 400 }])
  expect(snapshot.outcomeTotals).toEqual({ succeeded: 40 })
  const next = { activityId: 'next', tabId: 'tab', toolName: 'browser_click', occurredAt: 10_000 }
  history.track({ ...next, phase: 'started' }, next.occurredAt)
  history.track({ ...next, phase: 'finished', occurredAt: next.occurredAt + 10 }, next.occurredAt + 10)
  expect(history.snapshot().completedToolCalls).toBe(41)
})

it('measures a duration on its own clock, so setting the computer\'s clock while an activity runs does not change it', () => {
  const history = new McpActivityHistory()
  // Set back an hour while the first runs, as when a clock kept in local time is corrected, and forward while the second
  // runs; each took 250 ms.
  const back = Date.parse('2026-10-30T09:00:00.000Z')
  history.track({ activityId: 'back', tabId: 'tab', toolName: 'browser_click', phase: 'started', occurredAt: back }, 1_000)
  history.track({ activityId: 'back', tabId: 'tab', toolName: 'browser_click', phase: 'finished', occurredAt: back - 3_600_000 + 250 }, 1_250.4)
  const forward = Date.parse('2026-10-30T08:10:00.000Z')
  history.track({ activityId: 'forward', tabId: 'tab', toolName: 'browser_type', phase: 'started', occurredAt: forward }, 5_000)
  history.track({ activityId: 'forward', tabId: 'tab', toolName: 'browser_type', phase: 'failed', occurredAt: forward + 3_600_000 + 250 }, 5_249.6)
  const snapshot = history.snapshot()
  expect(snapshot.recentActivity.map(activity => [activity.activityId, activity.durationMs])).toEqual([['forward', 250], ['back', 250]])
  expect(Object.fromEntries(snapshot.toolMetrics.map(metric => [metric.toolName, metric.totalDurationMs]))).toEqual({ browser_click: 250, browser_type: 250 })
  // The times of day stay those of the computer's clock.
  expect(snapshot.recentActivity[1]).toMatchObject({ startedAt: '2026-10-30T09:00:00.000Z', completedAt: '2026-10-30T08:00:00.250Z' })
})
