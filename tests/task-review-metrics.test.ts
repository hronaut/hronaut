import { describe, expect, it } from 'vitest'
import { HumanWaitingStore } from '../src/main/mcp/human-waiting-store.js'
import { taskReviewMetrics } from '../src/main/mcp/task-review-metrics.js'
import { TaskRunStore } from '../src/main/mcp/task-run-store.js'

const WORKSPACE_ID = '018f4d10-7b4a-7000-8000-000000000001'
const TAB_ID = '018f4d10-7b4a-7000-8000-000000000002'

describe('task review metrics', () => {
  it('separates human decisions, system-caught errors, ambiguous outcomes, and unrelated runs', () => {
    let wall = 1_800_000_000_000
    let monotonic = 1_000
    const taskRuns = new TaskRunStore({ wallNow: () => wall, monotonicNow: () => monotonic })
    const waiting = new HumanWaitingStore({ wallNow: () => wall, monotonicNow: () => monotonic })
    const checks = [{ id: 'page', type: 'page-settled' as const, tabId: TAB_ID }]
    const succeeded = taskRuns.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks })
    const rejectedByVerifier = taskRuns.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks })
    const ambiguous = taskRuns.create({ workspaceId: WORKSPACE_ID, deadlineMs: 60_000, heartbeatTimeoutMs: 10_000, checks: [] })
    const review = {
      toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'unknown' as const,
      representation: 'bounded-description' as const, description: 'Submit the visible form',
      expectedPostcondition: 'A confirmation appears', artifactHash: 'a'.repeat(64), sessionBinding: 'b'.repeat(64),
      workspaceName: 'Metrics QA', profileName: 'Restricted QA', tabId: TAB_ID,
      origin: 'https://example.com', navigationGeneration: 1, humanInputGeneration: 0
    }
    const input = (runId: string) => ({
      workspaceId: WORKSPACE_ID, runId, decision: 'approve-action' as const,
      owner: 'local-operator', fallbackOwner: 'local-operator', timeoutMs: 60_000,
      priorOutcome: 'OUTCOME_UNKNOWN' as const, review
    })

    const proposed = waiting.create(input(succeeded.id))
    wall += 400; monotonic += 400
    const approved = waiting.resolve(proposed.id, proposed.revision)
    const attempted = waiting.beginReviewAttempt(approved.id, approved.revision, review).record
    waiting.finishReviewAttempt(attempted.id, attempted.revision, 'verified')
    const verifying = taskRuns.complete(succeeded.id, succeeded.revision, 'SUCCEEDED', [{ id: 'page', status: 'PASS' }])
    taskRuns.confirmSuccess(verifying.id, verifying.revision)

    wall += 100; monotonic += 100
    const second = waiting.create(input(rejectedByVerifier.id))
    wall += 250; monotonic += 250
    waiting.reject(second.id, second.revision)
    taskRuns.complete(rejectedByVerifier.id, rejectedByVerifier.revision, 'SUCCEEDED', [{ id: 'page', status: 'FAIL' }])

    wall += 100; monotonic += 100
    const third = waiting.create(input(ambiguous.id))
    wall += 300; monotonic += 300
    const thirdApproved = waiting.resolve(third.id, third.revision)
    waiting.beginReviewAttempt(thirdApproved.id, thirdApproved.revision, { ...review, artifactHash: 'c'.repeat(64) })
    taskRuns.complete(ambiguous.id, ambiguous.revision, 'OUTCOME_UNKNOWN', [])

    const unrelated = waiting.create(input('018f4d10-7b4a-7000-8000-000000000099'))
    waiting.reject(unrelated.id, unrelated.revision)

    expect(taskReviewMetrics(WORKSPACE_ID, taskRuns.list(WORKSPACE_ID), waiting.list(WORKSPACE_ID))).toEqual({
      workspaceId: WORKSPACE_ID,
      totals: {
        taskCount: 3, completedTasks: 3, interruptedTasks: 3, interruptionsPerCompletedTask: 1, interruptions: 3,
        approvals: 2, rejections: 1, errorsCaught: 2, ambiguousOutcomes: 1,
        decidedReviews: 3, totalDecisionTimeMs: 950, averageDecisionTimeMs: 317
      },
      tasks: [
        expect.objectContaining({ taskRunId: succeeded.id, outcome: 'succeeded', completed: true, interruptions: 1, approvals: 1, rejections: 0, errorsCaught: 0, ambiguousOutcomes: 0, averageDecisionTimeMs: 400 }),
        expect.objectContaining({ taskRunId: rejectedByVerifier.id, outcome: 'verifier-rejected', completed: true, interruptions: 1, approvals: 0, rejections: 1, errorsCaught: 1, ambiguousOutcomes: 0, averageDecisionTimeMs: 250 }),
        expect.objectContaining({ taskRunId: ambiguous.id, outcome: 'outcome-unknown', completed: true, interruptions: 1, approvals: 1, rejections: 0, errorsCaught: 1, ambiguousOutcomes: 1, averageDecisionTimeMs: 300 })
      ]
    })
  })

  it('returns a zero report before the first retained task', () => {
    expect(taskReviewMetrics(WORKSPACE_ID, [], [])).toEqual({
      workspaceId: WORKSPACE_ID,
      totals: {
        taskCount: 0, completedTasks: 0, interruptedTasks: 0, interruptionsPerCompletedTask: null, interruptions: 0,
        approvals: 0, rejections: 0, errorsCaught: 0, ambiguousOutcomes: 0,
        decidedReviews: 0, totalDecisionTimeMs: 0, averageDecisionTimeMs: null
      },
      tasks: []
    })
  })
})
