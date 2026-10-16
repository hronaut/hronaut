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
  /** The token names this reading; you confirm it by ticking, and a new reading needs a new tick. */
  | { status: 'confirm'; reasons: WorkspaceContinuityReason[]; unknownOutcome: boolean; token: string }
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
  /** Sending; sent; not sent because sending failed, or the page changed or your confirmation expired. */
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

let lastToken = 0

function checkOf(report: WorkspaceContinuityReport): AgentDecisionCheck {
  const reasons = [...report.reasons]
  // The test main applies before it completes a decision: nothing for you to confirm.
  if (!report.suspended && report.status !== 'BLOCKED' && report.checkpointId
    && (report.priorOutcome !== 'OUTCOME_UNKNOWN' || report.priorOutcomeAcknowledged)) return { status: 'clear', reasons }
  // A suspended guard with a fresh reading of a settled page: you confirm the page as it is.
  if (report.suspended && report.reviewId) {
    return { status: 'confirm', reasons, unknownOutcome: report.priorOutcome === 'OUTCOME_UNKNOWN', token: `check-${++lastToken}` }
  }
  return { status: 'unavailable', reasons }
}

/** Whether two readings say the same, whatever their tokens. */
function sameReading(left: AgentDecisionCheck | undefined, right: AgentDecisionCheck): boolean {
  const plain = (check: AgentDecisionCheck | undefined) => check && JSON.stringify({ ...check, token: undefined })
  return plain(left) === plain(right)
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
   * Answers the decision the card showed, named by its key. When the page needed confirming, completing
   * it first confirms the reading taken when you ticked, as the editor's Confirm does with the state it
   * read; otherwise it reads the page again and sends nothing when that differs from what the card showed.
   */
  answer: (key: string, action: 'resolve' | 'reject', note?: string) => Promise<void>
  /**
   * You ticked the box confirming the page. Hronaut reads the page at that moment; completing confirms
   * that reading, which main refuses if the page changed since or 30 seconds have passed.
   */
  confirm: (key: string) => void
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
  // The reading you confirmed by ticking: taken when you ticked, ready once main has answered.
  let confirmation: { key: string; token: string; reviewId?: string; ready: Promise<void> } | undefined

  async function load(target: AgentDecisionTarget, phase: AgentDecisionAnswerState['phase'] = 'idle'): Promise<void> {
    const browser = options.browser()
    const current = ++generation
    // After an answer did not go, a decision that cannot be read again keeps the card as it was.
    const previous = phase === 'idle' ? undefined : state.value
    confirmation = undefined
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
      // Without the decision, the card offers to review it in the workspace; after a failed answer it keeps saying so.
      if (current === generation) state.value = previous?.id === target.decisionId ? { ...previous, phase: 'failed' } : undefined
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
      confirmation = undefined
      loadedTarget = current ? options.target() : undefined
      if (loadedTarget) void load(loadedTarget)
    },
    { immediate: true }
  )

  function confirm(key: string): void {
    const current = state.value
    const target = loadedTarget
    const browser = options.browser()
    const shown = current?.check
    if (!current || !target || !browser || current.key !== key || shown?.status !== 'confirm' || current.phase === 'sending' || current.phase === 'sent') return
    const entry: { key: string; token: string; reviewId?: string; ready: Promise<void> } = { key, token: shown.token, ready: Promise.resolve() }
    confirmation = entry
    entry.ready = (async () => {
      let check: AgentDecisionCheck | undefined
      try {
        const report = await browser.reviewWorkspaceContinuity(target.workspaceId)
        check = checkOf(report)
        if (sameReading(shown, check) && report.reviewId) {
          entry.reviewId = report.reviewId
          // A new tick answers the card's request to confirm the page again.
          const now = state.value
          if (now?.key === key && now.phase === 'changed' && now.check?.status === 'confirm' && now.check.token === shown.token) state.value = { ...now, phase: 'idle' }
          return
        }
      } catch {
        check = undefined
      }
      if (confirmation === entry) confirmation = undefined
      // The page no longer reads as the card showed it: show the new reading, which needs a new tick.
      const now = state.value
      if (now?.key !== key || now.check?.status !== 'confirm' || now.check.token !== shown.token) return
      if (check) state.value = { ...now, check, phase: 'changed' }
      else void load(target, 'failed')
    })()
  }

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
    // Completing a page that needed confirming needs the tick for the reading the card shows.
    const confirmed = action === 'resolve' && shown?.status === 'confirm' ? confirmation : undefined
    if (action === 'resolve' && shown?.status === 'confirm' && (!confirmed || confirmed.key !== key || confirmed.token !== shown.token)) return
    const run = ++generation
    state.value = { ...current, phase: 'sending' }
    // Once sent, the answer goes through even if the card closes; only what the card shows waits on it being current.
    const show = (next: AgentDecisionAnswerState): void => {
      if (run === generation) state.value = next
    }
    try {
      if (confirmed) {
        await confirmed.ready
        // The page changed when you ticked; the card already shows the new reading.
        if (!confirmed.reviewId) return
        try {
          await browser.reconcileWorkspaceContinuity(target.workspaceId, confirmed.reviewId, shown?.status === 'confirm' && shown.unknownOutcome)
        } catch {
          // The page changed since you ticked, or 30 seconds passed: confirm it again.
          if (confirmation === confirmed) confirmation = undefined
          if (run === generation) void load(target, 'changed')
          return
        }
      } else if (action === 'resolve') {
        // Nothing to confirm when the card showed it; read again in case that changed.
        const check = checkOf(await browser.reviewWorkspaceContinuity(target.workspaceId))
        if (!sameReading(shown, check)) {
          show({ ...current, check, phase: 'changed' })
          return
        }
      }
      const record = await browser.changeHumanWaiting(target.workspaceId, current.id, current.revision, action, undefined, note)
      show({ ...current, phase: humanWaitingDecisionOpen(record.state) ? 'failed' : 'sent' })
    } catch {
      // Read the decision and the page again; what you typed stays in the card.
      if (run === generation) void load(target, 'failed')
    }
  }

  onScopeDispose(() => {
    generation += 1
    stop()
  })

  return { state, answer, confirm }
}
