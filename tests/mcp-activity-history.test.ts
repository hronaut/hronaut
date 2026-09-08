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
  snapshot.recentActivity[0]!.toolName = 'mutated'
  snapshot.toolMetrics[0]!.count = 0
  expect(history.snapshot().recentActivity[0]?.toolName).toBe('browser_click')
  expect(history.snapshot().toolMetrics[0]?.count).toBe(45)
})
