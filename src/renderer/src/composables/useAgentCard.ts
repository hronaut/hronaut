import { onScopeDispose, ref, watchEffect, type Ref } from 'vue'
import {
  AGENT_CARD_INITIAL_LIMIT,
  AGENT_CARD_PLAN_TEXT_LIMIT,
  AGENT_CARD_REASON_LIMIT,
  AGENT_CARD_TEXT_LIMIT,
  type AgentCardAction,
  type AgentCardButton,
  type AgentCardCloseReason,
  type AgentCardDecision,
  type AgentCardModel,
  type HronautAgentCardApi
} from '../../../shared/agent-card.js'
import type { AgentPresence } from '../../../shared/agent-presence.js'
import { isSupportedLocale } from '../../../shared/locale.js'
import { isResolvedThemeName } from '../../../shared/theme.js'
import { agentFinishedStepText, agentStepText } from '../../../shared/agent-step-text.js'
import { agentCardCompletes, type AgentDecisionAnswerState } from './useAgentDecisionAnswers.js'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** Cuts text to the card contract's limit in UTF-16 units, at a code point, with an ellipsis. */
export function fitAgentCardText(text: string, limit = AGENT_CARD_TEXT_LIMIT): string {
  if (text.length <= limit) return text
  let result = ''
  for (const character of text) {
    if (result.length + character.length > limit - 1) break
    result += character
  }
  return `${result}…`
}

/** What the shell knows around an agent, beyond its presence. */
export interface AgentCardContext {
  workspaceName: string
  /** The current request for you, shown while this agent needs you. */
  attentionReason?: string
  /** The request's id, which its answers carry back. */
  attentionId?: string
  /** The request is a human-waiting decision, answered where decisions are reviewed. */
  attentionDecision?: boolean
  /** That decision as the shell last read it, when you can answer it in the card. */
  decision?: AgentDecisionAnswerState
  follow: boolean
  /** Agents' cursors are drawn on the page. */
  showCursor: boolean
  /** The live status strip is pinned below the toolbar. */
  pinLiveStatus: boolean
  /** The tab the card acts on (the one the agent asked about or last used), while it is still open. */
  tab?: { id: string; agentPaused: boolean }
  /** The tab already in view needs no "Show its tab". */
  tabInView: boolean
  /** Agent control is locked during a protected operation; pause cannot change. */
  agentControlLocked: boolean
  color: string
  name: string
  /** The agent disconnected while its card was open; the card stays until you close it. */
  gone?: boolean
  /** The time of day in the user's language, for when you answered the agent. */
  formatTime?: (at: number) => string
  /** The shell can open all of the agent's steps, with pictures of the page. */
  allSteps?: boolean
}

/** The card's content for one agent, in the user's language. */
export function agentCardModel(agent: AgentPresence, context: AgentCardContext, t: Translate): AgentCardModel {
  // A name within the toolbar's 64 graphemes can still be long in code units; the card keeps to its contract.
  const name = fitAgentCardText(context.name, 120)
  const stateKey = context.gone ? 'gone' : agent.state === 'needs-you' ? 'needsYou' : agent.state
  const buttons: AgentCardButton[] = []
  if (context.tab && !context.tabInView) buttons.push({ action: 'show-tab', label: t('shell.agentCard.showTab') })
  if (context.tab) {
    buttons.push({
      action: context.tab.agentPaused ? 'resume' : 'pause',
      label: t(context.tab.agentPaused ? 'shell.agentCard.resume' : 'shell.agentCard.pause'),
      ...(context.agentControlLocked ? { disabled: true } : {})
    })
    buttons.push({ action: 'take-over', label: t('shell.agentCard.takeOver'), ...(context.agentControlLocked ? { disabled: true } : {}) })
  }
  return {
    label: fitAgentCardText(t('shell.agentCard.label', { name })),
    name,
    initial: agent.initial.length <= AGENT_CARD_INITIAL_LIMIT ? agent.initial : '',
    color: context.color,
    state: context.gone ? 'idle' : agent.state,
    stateLabel: t(`shell.agentCard.states.${stateKey}`),
    subtitle: fitAgentCardText(t('shell.agentCard.connected', { workspace: context.workspaceName })),
    ...(!context.gone && agent.state === 'needs-you' && context.attentionReason
      ? {
          reason: {
            heading: t('shell.agentCard.reason'),
            // A decision's request carries a fixed English line; once read, the card says it in your language.
            text: context.attentionDecision && context.decision
              ? t(`shell.agentCard.decisionReasons.${context.decision.decision}`)
              : fitAgentCardText(context.attentionReason, AGENT_CARD_REASON_LIMIT),
            ...(context.attentionId ? reasonAnswers(context.attentionId, context, t) : {})
          }
        }
      : {}),
    now: {
      heading: t('shell.agentCard.now'),
      text: context.gone
        ? t('shell.agentCard.gone')
        : agent.state === 'idle' ? t('shell.agentCard.nowIdle') : fitAgentCardText(agentStepText(t, agent.step, agent.target, 'now'))
    },
    recent: {
      heading: t('shell.agentCard.recent'),
      empty: t('shell.agentCard.noSteps'),
      steps: agent.recentSteps.map((step) => {
        // Your answer to the agent, with when you gave it, in place of the request that is no longer shown.
        if (step.answer) {
          const answer = agentFinishedStepText(t, step)
          return { text: fitAgentCardText(context.formatTime ? t('shell.agentCard.answeredAt', { answer, time: context.formatTime(step.at) }) : answer), you: true as const }
        }
        const text = fitAgentCardText(agentStepText(t, step.step, step.target, 'done'))
        return step.outcome === 'failed' ? { text: t('shell.agentCard.stepFailed', { step: text }), failed: true } : { text }
      }),
      ...(context.allSteps && !context.gone && agent.recentSteps.length ? { all: { action: 'all-steps' as const, label: t('shell.agentCard.allSteps') } } : {})
    },
    follow: { label: t('shell.agentCard.follow'), checked: context.follow },
    cursor: { label: t('shell.agentCard.cursor'), checked: context.showCursor },
    pin: { label: t('shell.agentCard.pin'), checked: context.pinLiveStatus },
    buttons,
    closeLabel: t('shell.agentCard.close')
  }
}

// An approval's steps the card shows; the workspace shows them all.
const PLAN_SHOWN = 4

/** How you answer the request in the card: plain requests directly; decisions as their kind allows. */
function reasonAnswers(requestId: string, context: AgentCardContext, t: Translate): { answers: AgentCardButton[]; decision?: AgentCardDecision } {
  if (!context.attentionDecision) {
    return {
      answers: [
        { action: 'hand-back', label: t('shell.agentCard.handBack'), key: requestId },
        { action: 'dismiss', label: t('shell.agentCard.dismiss'), key: requestId }
      ]
    }
  }
  const decision = context.decision
  if (!decision || decision.decision === 'resolve-unknown') {
    return { answers: [{ action: 'review-decision', label: t('shell.agentCard.reviewDecision'), key: requestId }] }
  }
  const key = decision.key
  const busy = decision.phase === 'sending' || decision.phase === 'sent'
  const check = decision.check
  // Completing needs a page you can confirm or one with nothing to confirm.
  const completes = agentCardCompletes(decision.decision) && (check?.status === 'confirm' || check?.status === 'clear')
  const needsCheck = check?.status === 'confirm'
  const status = decision.phase === 'sending' ? { text: t('shell.agentCard.answerSending') }
    : decision.phase === 'sent' ? { text: t('shell.agentCard.answerSent') }
      : decision.phase === 'failed' ? { text: t('shell.agentCard.answerFailed'), alert: true }
        // Nothing was sent because the page changed: confirm it again, open it in the workspace, or try again.
        : decision.phase === 'changed' ? {
          text: t(check?.status === 'confirm' ? 'shell.agentCard.answerChanged'
            : check?.status === 'unavailable' ? 'shell.agentCard.checkUnavailable' : 'shell.agentCard.answerFailed'),
          alert: true
        }
          : check?.status === 'checking' ? { text: t('shell.agentCard.checking') }
            : check?.status === 'unavailable' ? { text: t('shell.agentCard.checkUnavailable') }
              : undefined
  const result: AgentCardDecision = {
    id: decision.id,
    key,
    ...(check?.status === 'confirm' ? {
      check: {
        id: check.token,
        text: fitAgentCardText(check.reasons.length
          ? t('shell.agentCard.checked', { reasons: check.reasons.map((reason) => t(`workspaceContinuity.reasons.${reason}`)).join(' · ') })
          : t('shell.agentCard.checkedPage')),
        confirm: t(check.unknownOutcome ? 'workspaceContinuity.ack' : 'shell.agentCard.confirmPage')
      }
    } : {}),
    ...(status ? { status } : {}),
    ...(busy ? { busy: true } : {})
  }
  const inWorkspace: AgentCardButton = { action: 'review-decision', label: t('shell.agentCard.openDecision'), key: requestId }
  if (decision.decision === 'review-page') {
    return {
      answers: [
        ...(completes ? [{ action: 'answer-resolve' as const, label: t('shell.agentCard.looksGood'), key, ...(needsCheck ? { needsCheck: true } : {}) }] : []),
        inWorkspace
      ],
      decision: {
        ...result,
        field: {
          label: t('shell.agentCard.whatToFix'),
          required: false,
          toggle: t('shell.agentCard.somethingWrong'),
          send: { action: 'answer-reject', label: t('shell.agentCard.sendBack'), key }
        }
      }
    }
  }
  if (decision.decision === 'provide-input') {
    // While the page is read again the field stays, so what you typed stays in view; Send waits for the reading.
    const checking = check?.status === 'checking'
    return {
      answers: [inWorkspace],
      decision: {
        ...result,
        ...(completes || checking ? {
          field: {
            label: t('humanWaiting.answerLabel'),
            required: true,
            send: { action: 'answer-resolve', label: t('shell.agentCard.send'), key, ...(needsCheck ? { needsCheck: true } : {}), ...(checking ? { disabled: true } : {}) }
          }
        } : {})
      }
    }
  }
  // An approval is made in the workspace, where its exact details are; the card shows what it would do and can reject it.
  const planned = decision.steps ?? []
  const steps = planned.slice(0, PLAN_SHOWN).map((step) => {
    const reversibility = t(`humanWaiting.review.reversibilities.${step.reversibility}`)
    return {
      text: fitAgentCardText(step.representation === 'bounded-description' && step.description ? step.description : t('humanWaiting.review.visibleOnly'), AGENT_CARD_PLAN_TEXT_LIMIT),
      detail: fitAgentCardText(step.origin ? t('shell.agentCard.stepDetail', { reversibility, origin: step.origin }) : reversibility)
    }
  })
  return {
    answers: [{ action: 'review-decision', label: t('shell.agentCard.reviewAndApprove'), key: requestId }],
    decision: {
      ...result,
      ...(steps.length ? {
        plan: {
          heading: t('shell.agentCard.whatItWillDo'),
          steps,
          ...(planned.length > PLAN_SHOWN ? { more: t('shell.agentCard.moreSteps', { count: planned.length - PLAN_SHOWN }) } : {})
        }
      } : {}),
      field: {
        label: t('shell.agentCard.rejectReason'),
        required: false,
        toggle: t('shell.agentCard.rejectToggle'),
        send: { action: 'answer-reject', label: t('shell.agentCard.reject'), key }
      }
    }
  }
}

// One counter for every card, so a card opened after a remount never reuses the id of one still open.
let lastCardId = 0

export interface AgentCardOptions {
  api?: HronautAgentCardApi
  /** The card for this agent, or undefined once it has left; reactive. */
  model: (clientKey: string) => AgentCardModel | undefined
  /** The avatar the card opens under. */
  anchor: (clientKey: string) => HTMLElement | null
  /** A choice made on the card; an answer carries the key of what it answers, as the card showed it, and any note you wrote. */
  onAction: (clientKey: string, action: AgentCardAction, key?: string, note?: string) => void
  onClosed?: (clientKey: string, reason: AgentCardCloseReason) => void
}

export interface AgentCardController {
  /** The agent whose card is open. */
  openKey: Readonly<Ref<string | null>>
  open: (clientKey: string) => void
  close: () => void
}

/**
 * Opens one agent card at a time under its avatar and keeps it current while it is open. Main
 * draws it above the page; the card's choices come back here as actions for the shell to run.
 */
export function useAgentCard(options: AgentCardOptions): AgentCardController {
  const api = options.api ?? window.hronautAgentCard
  const openKey = ref<string | null>(null)
  let cardId = 0
  // What the open card last showed; an update that changes nothing is not sent again.
  let shown = ''

  function close(): void {
    if (!openKey.value) return
    openKey.value = null
    api.hide(cardId)
  }

  function open(clientKey: string): void {
    if (openKey.value === clientKey) return
    cardId = ++lastCardId
    openKey.value = clientKey
  }

  const stop = watchEffect(() => {
    const key = openKey.value
    if (!key) return
    const model = options.model(key)
    const anchor = options.anchor(key)
    if (!model || !anchor?.isConnected) {
      // The agent left, or its avatar did; the card goes with it.
      close()
      return
    }
    const box = anchor.getBoundingClientRect()
    const theme = document.documentElement.dataset.theme
    const locale = document.documentElement.lang
    const request = {
      cardId,
      anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
      theme: isResolvedThemeName(theme) ? theme : 'dark' as const,
      locale: isSupportedLocale(locale) ? locale : 'en-US' as const,
      model
    }
    const serialized = JSON.stringify(request)
    if (serialized === shown) return
    shown = serialized
    api.show(request)
  }, { flush: 'post' })

  const unsubscribe = api.onEvent((event) => {
    const key = openKey.value
    // Events of a card that has since closed or been replaced are stale.
    if (!key || event.cardId !== cardId) return
    if (event.kind === 'action') {
      options.onAction(key, event.action, event.key, event.note)
      return
    }
    openKey.value = null
    options.onClosed?.(key, event.reason)
  })

  onScopeDispose(() => {
    stop()
    unsubscribe()
    close()
  })

  return { openKey, open, close }
}
