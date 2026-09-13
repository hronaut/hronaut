import type { HumanWaitingRecord } from '../../shared/human-waiting.js'
import type { TaskRunSummary } from './task-run-store.js'

export interface TaskReviewMetric {
  taskRunId: string
  state: TaskRunSummary['state']
  outcome: TaskRunSummary['outcome']
  completed: boolean
  interruptions: number
  approvals: number
  rejections: number
  errorsCaught: number
  ambiguousOutcomes: number
  decidedReviews: number
  totalDecisionTimeMs: number
  averageDecisionTimeMs: number | null
}

export interface TaskReviewMetricsReport {
  workspaceId: string
  totals: Omit<TaskReviewMetric, 'taskRunId' | 'state' | 'outcome' | 'completed'> & {
    taskCount: number
    completedTasks: number
    interruptedTasks: number
    interruptionsPerCompletedTask: number | null
  }
  tasks: TaskReviewMetric[]
}

function decisionDuration(record: HumanWaitingRecord): number | undefined {
  const receipt = record.review?.receipts.find(({ status }) => status === 'APPROVED' || status === 'REJECTED')
  if (!receipt || receipt.at < record.createdAt || receipt.at > record.deadlineAt) return undefined
  return receipt.at - record.createdAt
}

function reviewMetric(run: TaskRunSummary, records: HumanWaitingRecord[]): TaskReviewMetric {
  const reviews = records.filter(record => record.review)
  const approvals = reviews.filter(record => record.review!.receipts.some(receipt => receipt.status === 'APPROVED')).length
  const rejections = reviews.filter(record => record.review!.receipts.some(receipt => receipt.status === 'REJECTED')).length
  const invalidations = reviews.filter(record => record.review!.status === 'EXPIRED'
    && record.review!.receipts.some(receipt => receipt.status === 'APPROVED' || receipt.status === 'ATTEMPTED')).length
  const ambiguousReviews = reviews.filter(record => record.review!.status === 'UNKNOWN').length
  const decisionTimes = reviews.map(decisionDuration).filter(value => value !== undefined)
  const totalDecisionTimeMs = decisionTimes.reduce((total, value) => total + value, 0)
  return {
    taskRunId: run.id,
    state: run.state,
    outcome: run.outcome,
    completed: run.outcome !== 'running',
    interruptions: records.length,
    approvals,
    rejections,
    errorsCaught: invalidations + (run.outcome === 'verifier-rejected' ? 1 : 0),
    ambiguousOutcomes: ambiguousReviews + (run.outcome === 'outcome-unknown' ? 1 : 0),
    decidedReviews: decisionTimes.length,
    totalDecisionTimeMs,
    averageDecisionTimeMs: decisionTimes.length ? Math.round(totalDecisionTimeMs / decisionTimes.length) : null
  }
}

/** Produces correlation-only safety metrics. Unknown run IDs are ignored so a
 * caller cannot inject metrics into another retained task by choosing a UUID.
 */
export function taskReviewMetrics(workspaceId: string, runs: TaskRunSummary[], waiting: HumanWaitingRecord[]): TaskReviewMetricsReport {
  if (runs.some(run => run.workspaceId !== workspaceId)
    || waiting.some(record => record.workspaceId !== workspaceId)) {
    throw new Error('Task review metrics require one workspace')
  }
  const recordsByRun = new Map<string, HumanWaitingRecord[]>()
  for (const record of waiting) {
    const records = recordsByRun.get(record.runId) ?? []
    records.push(record)
    recordsByRun.set(record.runId, records)
  }
  const tasks = runs.map(run => reviewMetric(run, recordsByRun.get(run.id) ?? []))
  const totals = tasks.reduce((result, task) => ({
    taskCount: result.taskCount + 1,
    completedTasks: result.completedTasks + Number(task.completed),
    interruptedTasks: result.interruptedTasks + Number(task.interruptions > 0),
    interruptionsPerCompletedTask: null,
    interruptions: result.interruptions + task.interruptions,
    approvals: result.approvals + task.approvals,
    rejections: result.rejections + task.rejections,
    errorsCaught: result.errorsCaught + task.errorsCaught,
    ambiguousOutcomes: result.ambiguousOutcomes + task.ambiguousOutcomes,
    decidedReviews: result.decidedReviews + task.decidedReviews,
    totalDecisionTimeMs: result.totalDecisionTimeMs + task.totalDecisionTimeMs,
    averageDecisionTimeMs: null
  }), {
    taskCount: 0, completedTasks: 0, interruptedTasks: 0, interruptionsPerCompletedTask: null as number | null, interruptions: 0,
    approvals: 0, rejections: 0, errorsCaught: 0, ambiguousOutcomes: 0,
    decidedReviews: 0, totalDecisionTimeMs: 0, averageDecisionTimeMs: null as number | null
  })
  totals.averageDecisionTimeMs = totals.decidedReviews
    ? Math.round(totals.totalDecisionTimeMs / totals.decidedReviews)
    : null
  totals.interruptionsPerCompletedTask = totals.completedTasks
    ? Math.round((totals.interruptions / totals.completedTasks) * 100) / 100
    : null
  return { workspaceId, totals, tasks }
}
