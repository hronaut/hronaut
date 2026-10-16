import { onScopeDispose, ref, watchEffect, type Ref } from 'vue'
import {
  AGENT_CARD_INITIAL_LIMIT,
  AGENT_CARD_REASON_LIMIT,
  AGENT_CARD_TEXT_LIMIT,
  type AgentCardAction,
  type AgentCardButton,
  type AgentCardCloseReason,
  type AgentCardModel,
  type HronautAgentCardApi
} from '../../../shared/agent-card.js'
import type { AgentPresence } from '../../../shared/agent-presence.js'
import { isResolvedThemeName } from '../../../shared/theme.js'
import { agentStepText } from './agent-step-text.js'

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
  follow: boolean
  /** Agents' cursors are drawn on the page. */
  showCursor: boolean
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
            text: fitAgentCardText(context.attentionReason, AGENT_CARD_REASON_LIMIT),
            ...(context.attentionId ? { answers: context.attentionDecision
              ? [{ action: 'review-decision', label: t('shell.agentCard.reviewDecision'), key: context.attentionId }]
              : [
                  { action: 'hand-back', label: t('shell.agentCard.handBack'), key: context.attentionId },
                  { action: 'dismiss', label: t('shell.agentCard.dismiss'), key: context.attentionId }
                ] } : {})
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
        const text = fitAgentCardText(agentStepText(t, step.step, step.target, 'done'))
        return step.outcome === 'failed' ? { text: t('shell.agentCard.stepFailed', { step: text }), failed: true } : { text }
      })
    },
    follow: { label: t('shell.agentCard.follow'), checked: context.follow },
    cursor: { label: t('shell.agentCard.cursor'), checked: context.showCursor },
    buttons,
    closeLabel: t('shell.agentCard.close')
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
  /** A choice made on the card; an answer carries the key of what it answers, as the card showed it. */
  onAction: (clientKey: string, action: AgentCardAction, key?: string) => void
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
    const request = {
      cardId,
      anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
      theme: isResolvedThemeName(theme) ? theme : 'dark' as const,
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
      options.onAction(key, event.action, event.key)
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
