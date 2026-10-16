import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import {
  humanWaitingDecisionOpen,
  type HumanWaitingDecision,
  type HumanWaitingReviewStep
} from '../../../shared/human-waiting.js'
import type { HronautApi } from '../../../shared/types.js'
import type { WorkspaceContinuityReason, WorkspaceContinuityReport } from '../../../shared/workspace-continuity.js'

export type AgentDecisionBrowser = Pick<HronautApi, 'listHumanWaiting' | 'changeHumanWaiting' | 'reviewWorkspaceContinuity' | 'reconcileWorkspaceContinuity'>

/**
 * What Hronaut found when it checked the workspace's page before you answer from the card. Confirm:
 * you tick a box to confirm the page as it is. Clear: there is nothing to confirm. Unavailable: the
 * page cannot be checked from here, so you answer in the workspace.
 */
export type AgentDecisionCheck =
  | { status: 'checking' }
  | { status: 'confirm'; reasons: WorkspaceContinuityReason[]; unknownOutcome: boolean }
  | { status: 'clear' | 'unavailable'; reasons: WorkspaceContinuityReason[] }

/** The decision an agent's request is about, as the card shows it, and how answering it is going. */
export interface AgentDecisionAnswerState {
  /** Names the decision and the revision shown; an answer must carry it back. */
  key: string
  id: string
  revision: string
  decision: HumanWaitingDecision
  /** What an approval would do, as the agent described each step. */
  steps?: HumanWaitingReviewStep[]
  /** For the decisions you can complete from the card. */
  check?: AgentDecisionCheck
  /** Sending; sent; not sent because sending failed or the page changed since it was checked. */
  phase: 'idle' | 'sending' | 'sent' | 'failed' | 'changed'
}

/** The decisions you can complete from the card; approvals and unknown outcomes go to the workspace. */
export function agentCardCompletes(decision: HumanWaitingDecision): boolean {
  return decision === 'review-page' || decision === 'provide-input'
}

/** The decisions you can reject from the card. */
export function agentCardRejects(decision: HumanWaitingDecision): boolean {
  return decision === 'review-page' || decision === 'approve-action'
}

function checkOf(report: WorkspaceContinuityReport): AgentDecisionCheck {
  const reasons = [...report.reasons]
  // The test main applies before it completes a decision: nothing for you to confirm.
  if (!report.suspended && report.status !== 'BLOCKED' && report.checkpointId
    && (report.priorOutcome !== 'OUTCOME_UNKNOWN' || report.priorOutcomeAcknowledged)) return { status: 'clear', reasons }
  // A suspended guard with a fresh reading of a settled page: you confirm the page as it is.
  if (report.suspended && report.reviewId) return { status: 'confirm', reasons, unknownOutcome: report.priorOutcome === 'OUTCOME_UNKNOWN' }
  return { status: 'unavailable', reasons }
}

function sameCheck(left: AgentDecisionCheck | undefined, right: AgentDecisionCheck): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export interface AgentDecisionTarget {
  workspaceId: string
  decisionId: string
  /** The request for you that asks it; a new request reads the decision again. */
  requestId: string
}

export interface AgentDecisionAnswerOptions {
  browser: () => AgentDecisionBrowser | undefined
  /** The decision the open request asks about, in the workspace in view; reactive. */
  target: () => AgentDecisionTarget | undefined
  /** A card that can show the decision is open. Hronaut reads the decision and the page only then. */
  active: () => boolean
}

export interface AgentDecisionAnswers {
  state: Readonly<Ref<AgentDecisionAnswerState | undefined>>
  /**
   * Answers the decision the card showed, named by its key. Completing it first checks the page
   * again: when that differs from what the card showed, the card shows the new check and nothing
   * is sent. Otherwise a suspended guard is confirmed as reviewed, as the editor's Confirm does.
   */
  answer: (key: string, action: 'resolve' | 'reject', note?: string) => Promise<void>
}

/**
 * Lets you answer an agent's waiting decision from its card: review a page, give the input it asked
 * for, or reject. Main still checks the decision's revision and the page before it records anything.
 */
export function useAgentDecisionAnswers(options: AgentDecisionAnswerOptions): AgentDecisionAnswers {
  const state = shallowRef<AgentDecisionAnswerState>()
  // Each reading and answer takes a generation; a later one, or the card closing, makes it stale.
  let generation = 0
  let loadedTarget: AgentDecisionTarget | undefined

  async function load(target: AgentDecisionTarget, phase: AgentDecisionAnswerState['phase'] = 'idle'): Promise<void> {
    const browser = options.browser()
    const current = ++generation
    if (!browser) {
      state.value = undefined
      return
    }
    try {
      const record = (await browser.listHumanWaiting(target.workspaceId)).find((candidate) => candidate.id === target.decisionId)
      if (current !== generation) return
      if (!record || !humanWaitingDecisionOpen(record.state)) {
        state.value = undefined
        return
      }
      const steps = record.review ? (record.review.steps ?? [record.review]) : undefined
      const base: AgentDecisionAnswerState = {
        key: `${record.id}_${record.revision}`,
        id: record.id,
        revision: record.revision,
        decision: record.decision,
        ...(steps ? { steps } : {}),
        phase
      }
      if (!agentCardCompletes(record.decision)) {
        state.value = base
        return
      }
      state.value = { ...base, check: { status: 'checking' } }
      let check: AgentDecisionCheck
      try {
        check = checkOf(await browser.reviewWorkspaceContinuity(target.workspaceId))
      } catch {
        check = { status: 'unavailable', reasons: [] }
      }
      if (current !== generation) return
      state.value = { ...base, check }
    } catch {
      // Without the decision, the card offers to review it in the workspace.
      if (current === generation) state.value = undefined
    }
  }

  const stop = watch(
    () => {
      const target = options.active() ? options.target() : undefined
      return target ? JSON.stringify([target.workspaceId, target.decisionId, target.requestId]) : ''
    },
    (current) => {
      generation += 1
      state.value = undefined
      loadedTarget = current ? options.target() : undefined
      if (loadedTarget) void load(loadedTarget)
    },
    { immediate: true }
  )

  async function answer(key: string, action: 'resolve' | 'reject', note?: string): Promise<void> {
    const current = state.value
    const target = loadedTarget
    const browser = options.browser()
    if (!current || !target || !browser || current.key !== key || current.phase === 'sending' || current.phase === 'sent') return
    const shown = current.check
    if (action === 'resolve'
      ? !agentCardCompletes(current.decision) || (current.decision === 'provide-input' && !note)
        || (shown?.status !== 'confirm' && shown?.status !== 'clear')
      : !agentCardRejects(current.decision)) return
    const run = ++generation
    state.value = { ...current, phase: 'sending' }
    try {
      if (action === 'resolve') {
        const report = await browser.reviewWorkspaceContinuity(target.workspaceId)
        if (run !== generation) return
        const check = checkOf(report)
        if (!sameCheck(shown, check)) {
          // You confirmed a page that has since changed; look again before anything is sent.
          state.value = { ...current, check, phase: 'changed' }
          return
        }
        if (check.status === 'confirm') {
          await browser.reconcileWorkspaceContinuity(target.workspaceId, report.reviewId!, check.unknownOutcome)
          if (run !== generation) return
        }
      }
      const record = await browser.changeHumanWaiting(target.workspaceId, current.id, current.revision, action, undefined, note)
      if (run !== generation) return
      state.value = humanWaitingDecisionOpen(record.state) ? { ...current, phase: 'failed' } : { ...current, phase: 'sent' }
    } catch {
      if (run !== generation) return
      // Read the decision and the page again; what you typed stays in the card.
      void load(target, 'failed')
    }
  }

  onScopeDispose(() => {
    generation += 1
    stop()
  })

  return { state, answer }
}
