import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useAgentDecisionAnswers, type AgentDecisionBrowser, type AgentDecisionTarget } from '../../src/renderer/src/composables/useAgentDecisionAnswers.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'
import type { WorkspaceContinuityReport } from '../../src/shared/workspace-continuity.js'

function record(overrides: Partial<HumanWaitingRecord> = {}): HumanWaitingRecord {
  return {
    id: 'decision-1', revision: 'revision-1', workspaceId: 'workspace-1', runId: 'run-1', decision: 'review-page', owner: 'local-user', fallbackOwner: 'local-user',
    priorOutcome: 'OUTCOME_UNKNOWN', state: 'WAITING_FOR_HUMAN', createdAt: 1, deadlineAt: 2, notificationAttempts: 1, notificationStatus: 'delivered',
    nextAction: 'REVIEW_CURRENT_STATE', ...overrides
  }
}

function report(overrides: Partial<WorkspaceContinuityReport> = {}): WorkspaceContinuityReport {
  return {
    status: 'BLOCKED', reasons: ['CHECKPOINT_UNAVAILABLE', 'PRIOR_WRITE_OUTCOME_UNKNOWN'], priorOutcome: 'OUTCOME_UNKNOWN', nextAction: 'INSPECT_AND_RECONCILE',
    checkpointId: 'checkpoint-1', reviewId: 'review-1', suspended: true, priorOutcomeAcknowledged: false, ...overrides
  }
}

function setup(records: HumanWaitingRecord[] = [record()], reports: WorkspaceContinuityReport[] = [report()]) {
  const calls: string[] = []
  let reviews = 0
  const browser = {
    listHumanWaiting: vi.fn(async (workspaceId: string) => { calls.push(`list ${workspaceId}`); return records }),
    reviewWorkspaceContinuity: vi.fn(async (workspaceId: string) => {
      calls.push(`review ${workspaceId}`)
      return reports[Math.min(reviews++, reports.length - 1)]
    }),
    reconcileWorkspaceContinuity: vi.fn(async (workspaceId: string, reviewId: string, acknowledge: boolean) => {
      calls.push(`reconcile ${workspaceId} ${reviewId} ${acknowledge}`)
      return report({ suspended: false, status: 'WARN', reviewId: null, priorOutcomeAcknowledged: true })
    }),
    changeHumanWaiting: vi.fn(async (workspaceId: string, id: string, revision: string, action: string, confirmation?: unknown, note?: string) => {
      calls.push(`change ${workspaceId} ${id} ${revision} ${action} ${String(confirmation)} ${note ?? '-'}`)
      return record({ id, revision: 'revision-2', state: action === 'resolve' ? 'RESOLVED' : 'REJECTED' })
    })
  } satisfies AgentDecisionBrowser
  const target = ref<AgentDecisionTarget | undefined>({ workspaceId: 'workspace-1', decisionId: 'decision-1', requestId: 'attention-1' })
  const active = ref(true)
  const scope = effectScope()
  const answers = scope.run(() => useAgentDecisionAnswers({ browser: () => browser, target: () => target.value, active: () => active.value }))!
  return { browser, calls, target, active, scope, answers }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
  await nextTick()
}

describe('answering an agent decision from its card', () => {
  it('reads the decision and checks the page only while its card is open', async () => {
    const { browser, calls, active, answers, scope } = setup()
    active.value = false
    await settle()
    expect(answers.state.value).toBeUndefined()
    calls.length = 0
    browser.listHumanWaiting.mockClear()
    active.value = true
    await settle()
    expect(calls).toEqual(['list workspace-1', 'review workspace-1'])
    expect(answers.state.value).toEqual({
      key: 'decision-1_revision-1', id: 'decision-1', revision: 'revision-1', decision: 'review-page', phase: 'idle',
      check: { status: 'confirm', reasons: ['CHECKPOINT_UNAVAILABLE', 'PRIOR_WRITE_OUTCOME_UNKNOWN'], unknownOutcome: true }
    })
    active.value = false
    await settle()
    expect(answers.state.value).toBeUndefined()
    scope.stop()
  })

  it('confirms the page as reviewed, then completes the decision with what you wrote', async () => {
    const { calls, answers, scope } = setup([record({ decision: 'provide-input' })])
    await settle()
    calls.length = 0
    await answers.answer('decision-1_revision-1', 'resolve', 'Use the second address')
    expect(calls).toEqual([
      'review workspace-1',
      'reconcile workspace-1 review-1 true',
      'change workspace-1 decision-1 revision-1 resolve undefined Use the second address'
    ])
    expect(answers.state.value?.phase).toBe('sent')
    scope.stop()
  })

  it('sends nothing when the page changed since the card showed its check', async () => {
    const { browser, calls, answers, scope } = setup(undefined, [report(), report({ reasons: ['ORIGIN_CHANGED', 'PRIOR_WRITE_OUTCOME_UNKNOWN'] })])
    await settle()
    calls.length = 0
    await answers.answer('decision-1_revision-1', 'resolve')
    expect(calls).toEqual(['review workspace-1'])
    expect(browser.reconcileWorkspaceContinuity).not.toHaveBeenCalled()
    expect(browser.changeHumanWaiting).not.toHaveBeenCalled()
    expect(answers.state.value).toMatchObject({ phase: 'changed', check: { status: 'confirm', reasons: ['ORIGIN_CHANGED', 'PRIOR_WRITE_OUTCOME_UNKNOWN'] } })
    scope.stop()
  })

  it('completes without a confirmation when there is nothing to confirm, and rejects without a check', async () => {
    const clear = report({ status: 'PASS', reasons: [], priorOutcome: 'NONE', suspended: false, reviewId: null })
    const first = setup(undefined, [clear])
    await settle()
    first.calls.length = 0
    await first.answers.answer('decision-1_revision-1', 'resolve')
    expect(first.calls).toEqual(['review workspace-1', 'change workspace-1 decision-1 revision-1 resolve undefined -'])
    first.scope.stop()

    const second = setup([record({ decision: 'approve-action' })])
    await settle()
    expect(second.calls).toEqual(['list workspace-1'])
    second.calls.length = 0
    await second.answers.answer('decision-1_revision-1', 'reject', 'Wrong account')
    expect(second.calls).toEqual(['change workspace-1 decision-1 revision-1 reject undefined Wrong account'])
    second.scope.stop()
  })

  it('refuses an answer for another revision, one the decision does not allow, and a second click while sending', async () => {
    const review = setup()
    await settle()
    review.calls.length = 0
    await review.answers.answer('decision-1_revision-0', 'resolve')
    expect(review.calls).toEqual([])
    const pending = review.answers.answer('decision-1_revision-1', 'reject', 'Fix it')
    await review.answers.answer('decision-1_revision-1', 'reject', 'Fix it')
    await pending
    expect(review.browser.changeHumanWaiting).toHaveBeenCalledTimes(1)
    review.scope.stop()

    // An approval is never completed from the card; input needs an answer; an unknown outcome is left alone.
    for (const [decision, action, note] of [['approve-action', 'resolve', undefined], ['provide-input', 'resolve', undefined], ['provide-input', 'reject', 'No'], ['resolve-unknown', 'reject', undefined]] as const) {
      const other = setup([record({ decision })])
      await settle()
      await other.answers.answer('decision-1_revision-1', action, note)
      expect(other.browser.changeHumanWaiting, `${decision} ${action}`).not.toHaveBeenCalled()
      other.scope.stop()
    }

    // A page that cannot be checked here is answered in the workspace.
    const unavailable = setup(undefined, [report({ reviewId: null })])
    await settle()
    expect(unavailable.answers.state.value?.check).toEqual({ status: 'unavailable', reasons: ['CHECKPOINT_UNAVAILABLE', 'PRIOR_WRITE_OUTCOME_UNKNOWN'] })
    await unavailable.answers.answer('decision-1_revision-1', 'resolve')
    expect(unavailable.browser.changeHumanWaiting).not.toHaveBeenCalled()
    unavailable.scope.stop()
  })

  it('reads the decision again after a failure, keeping the card on the newest revision', async () => {
    const { browser, answers, scope } = setup()
    await settle()
    browser.changeHumanWaiting.mockRejectedValueOnce(new Error('Waiting decision unavailable or stale'))
    browser.listHumanWaiting.mockResolvedValueOnce([record({ revision: 'revision-3' })])
    await answers.answer('decision-1_revision-1', 'reject')
    await settle()
    expect(answers.state.value).toMatchObject({ key: 'decision-1_revision-3', phase: 'failed' })
    scope.stop()
  })

  it('ignores what arrives after the card closed or the request changed', async () => {
    const { browser, target, active, answers, scope } = setup()
    let finishList!: (records: HumanWaitingRecord[]) => void
    browser.listHumanWaiting.mockImplementationOnce(() => new Promise((resolve) => { finishList = resolve }))
    target.value = { workspaceId: 'workspace-1', decisionId: 'decision-1', requestId: 'attention-2' }
    await settle()
    active.value = false
    await settle()
    finishList([record()])
    await settle()
    expect(answers.state.value).toBeUndefined()

    active.value = true
    await settle()
    let finishChange!: (value: HumanWaitingRecord) => void
    browser.changeHumanWaiting.mockImplementationOnce(() => new Promise((resolve) => { finishChange = resolve }))
    const sending = answers.answer('decision-1_revision-1', 'reject')
    await settle()
    expect(answers.state.value?.phase).toBe('sending')
    target.value = undefined
    await settle()
    finishChange(record({ state: 'REJECTED' }))
    await sending
    expect(answers.state.value).toBeUndefined()
    scope.stop()
  })

  it('leaves the card to the workspace when the decision is answered or unreadable', async () => {
    const answered = setup([record({ state: 'RESOLVED' })])
    await settle()
    expect(answered.answers.state.value).toBeUndefined()
    answered.scope.stop()
    const failing = setup()
    failing.browser.listHumanWaiting.mockRejectedValue(new Error('Human waiting history is unavailable'))
    failing.target.value = { workspaceId: 'workspace-1', decisionId: 'decision-1', requestId: 'attention-3' }
    await settle()
    expect(failing.answers.state.value).toBeUndefined()
    failing.scope.stop()
  })
})
