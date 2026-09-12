import type { McpActivityOutcome, McpActivityResult, McpTabActivity } from '../../shared/types.js'

export interface McpToolActivity {
  activityId: string
  tabId: string
  toolName: string
  startedAt: string
  completedAt: string
  durationMs: number
  /** Legacy broad outcome retained for existing dashboard consumers. */
  outcome: 'finished' | 'failed'
  result: McpActivityResult
}

export interface McpToolMetric {
  toolName: string
  count: number
  failures: number
  outcomes?: Partial<Record<McpActivityOutcome, number>>
  totalDurationMs: number
  lastUsedAt: string
}

/** Bounded in-memory activity metadata shared across endpoint replacements.
 * No command arguments, page contents, or results are retained.
 */
export class McpActivityHistory {
  private completedToolCalls = 0
  private readonly activityStarts = new Map<string, McpTabActivity>()
  private readonly recentActivity: McpToolActivity[] = []
  private readonly toolMetrics = new Map<string, McpToolMetric>()
  private readonly outcomeTotals: Partial<Record<McpActivityOutcome, number>> = {}

  snapshot(): { completedToolCalls: number; recentActivity: McpToolActivity[]; toolMetrics: McpToolMetric[]; outcomeTotals: Partial<Record<McpActivityOutcome, number>> } {
    return {
      completedToolCalls: this.completedToolCalls,
      recentActivity: this.recentActivity.map(activity => ({ ...activity, result: { ...activity.result } })),
      outcomeTotals: { ...this.outcomeTotals },
      toolMetrics: [...this.toolMetrics.values()]
        .sort((left, right) => right.count - left.count || right.lastUsedAt.localeCompare(left.lastUsedAt))
        .map(metric => ({ ...metric, outcomes: { ...metric.outcomes } }))
    }
  }

  track(activity: McpTabActivity): void {
    if (activity.phase === 'started') {
      this.activityStarts.set(activity.activityId, activity)
      return
    }
    const started = this.activityStarts.get(activity.activityId)
    if (!started) return
    this.activityStarts.delete(activity.activityId)
    const completedAt = new Date(activity.occurredAt).toISOString()
    const durationMs = Math.max(0, activity.occurredAt - started.occurredAt)
    const result: McpActivityResult = activity.result ?? {
      outcome: activity.phase === 'finished' ? 'succeeded' : 'failed',
      reasonCode: activity.phase === 'finished' ? 'COMPLETED' : 'COMMAND_FAILED',
      dispatch: 'dispatched',
      effects: 'possible',
      evidenceSource: 'hronaut-observed'
    }
    const completed: McpToolActivity = {
      activityId: activity.activityId,
      tabId: activity.tabId,
      toolName: activity.toolName,
      startedAt: new Date(started.occurredAt).toISOString(),
      completedAt,
      durationMs,
      outcome: activity.phase,
      result: { ...result }
    }
    this.completedToolCalls += 1
    this.recentActivity.unshift(completed)
    if (this.recentActivity.length > 40) this.recentActivity.length = 40
    const metric = this.toolMetrics.get(activity.toolName) ?? {
      toolName: activity.toolName,
      count: 0,
      failures: 0,
      outcomes: {},
      totalDurationMs: 0,
      lastUsedAt: completedAt
    }
    metric.count += 1
    if (activity.phase === 'failed') metric.failures += 1
    metric.outcomes ??= {}
    metric.outcomes[result.outcome] = (metric.outcomes[result.outcome] ?? 0) + 1
    this.outcomeTotals[result.outcome] = (this.outcomeTotals[result.outcome] ?? 0) + 1
    metric.totalDurationMs += durationMs
    metric.lastUsedAt = completedAt
    this.toolMetrics.set(activity.toolName, metric)
  }
}
