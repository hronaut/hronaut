<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBackHand from '~icons/material-symbols/back-hand-rounded'
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded'
import IconSmartToy from '~icons/material-symbols/smart-toy-outline-rounded'
import type { AgentCardAction, HronautAgentCardApi } from '../../../shared/agent-card.js'
import { formatTime } from '../../../shared/format.js'
import { isSupportedLocale } from '../../../shared/locale.js'
import {
  AGENT_AVATAR_VISIBLE_LIMIT,
  agentAvatarColorHex,
  type AgentPresence,
  type HronautAgentPresenceApi
} from '../../../shared/agent-presence.js'
import { agentStepText } from '../../../shared/agent-step-text.js'
import { agentCardModel, useAgentCard } from '../composables/useAgentCard.js'
import { useAgentDecisionAnswers, type AgentDecisionBrowser } from '../composables/useAgentDecisionAnswers.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = withDefaults(defineProps<{
  /** The workspace of the page in view; no avatars without one. */
  workspaceId?: string
  workspaceName?: string
  activeTabId?: string
  /** The reason of the current request for you, shown for the agent that made it. */
  attentionReason?: string
  /** That request's id, which an answer from the card must match. */
  attentionId?: string
  /** That request is a human-waiting decision. */
  attentionDecision?: boolean
  /** The decision it asks about and its workspace, for answering it in the card. */
  attentionDecisionId?: string
  attentionWorkspaceId?: string
  /** Reads and answers decisions; without it, decisions are answered in the workspace. */
  browser?: AgentDecisionBrowser
  /** The open tabs, to find the one an agent acts on and whether agents are paused there. */
  tabs?: readonly { id: string; agentPaused?: boolean }[]
  follow?: boolean
  /** Agents' cursors are drawn on the page; on unless the shell says otherwise. */
  showCursor?: boolean
  /** The live status strip is pinned below the toolbar. */
  pinLiveStatus?: boolean
  /** The shell can show all of an agent's steps; the card then offers "All steps". */
  allSteps?: boolean
  agentControlLocked?: boolean
  /** The agent you can take over from, or whose tab you have, when the toolbar has no room to say so. */
  takeOverBadge?: { clientKey: string; kind: 'offer' | 'control' }
  api?: HronautAgentPresenceApi
  cardApi?: HronautAgentCardApi
}>(), { showCursor: true })

const emit = defineEmits<{
  select: [tabId: string]
  /** Pause or resume agents on this tab. */
  setPaused: [tabId: string, paused: boolean]
  /** Pause agents on this tab and show it, for you to carry on. */
  takeOver: [tabId: string]
  setFollow: [follow: boolean]
  /** Draw agents' cursors on the page, or stop. */
  setShowCursor: [show: boolean]
  /** Pin the live status strip below the toolbar, or unpin it. */
  setPinLiveStatus: [pin: boolean]
  /** Answer the open request for you: done and handed back, or dismissed. */
  answerAttention: [id: string, answer: 'resolved' | 'dismissed']
  /** Open the workspace where its waiting decisions are reviewed. */
  reviewDecision: [workspaceId: string]
  /** Show all of this agent's steps in this workspace. */
  showSteps: [clientKey: string, workspaceId: string]
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const presence = useAgentPresence(props.api)
onBeforeUnmount(presence.dispose)

const liveAgents = computed(() => (props.workspaceId && presence.snapshot.value.workspaces[props.workspaceId]) || [])
// The agent whose card is open, as last seen. It keeps a visible avatar until the card closes, so
// the card stays under it: one that disconnects stays, dimmed, and one that other agents would push
// into +N keeps the last visible place.
const cardAgent = shallowRef<{ agent: AgentPresence; index: number }>()
const agents = computed(() => {
  const live = liveAgents.value
  const kept = cardAgent.value
  if (!kept) return live
  const liveIndex = live.findIndex((agent) => agent.clientKey === kept.agent.clientKey)
  if (liveIndex >= 0 && liveIndex < AGENT_AVATAR_VISIBLE_LIMIT) return live
  const others = liveIndex >= 0 ? live.filter((_agent, index) => index !== liveIndex) : live
  const index = Math.min(kept.index, others.length, AGENT_AVATAR_VISIBLE_LIMIT - 1)
  return [...others.slice(0, index), liveIndex >= 0 ? live[liveIndex] : kept.agent, ...others.slice(index)]
})
const shown = computed(() => agents.value.slice(0, AGENT_AVATAR_VISIBLE_LIMIT))
const more = computed(() => agents.value.slice(AGENT_AVATAR_VISIBLE_LIMIT))
const moreLabel = computed(() => t('shell.agents.more', { names: more.value.map(displayName).join(', ') }))

function displayName(agent: AgentPresence): string {
  return agent.name || t('shell.agents.unnamed')
}

function stateKey(agent: AgentPresence): 'idle' | 'working' | 'needsYou' {
  return agent.state === 'needs-you' ? 'needsYou' : agent.state
}

function gone(agent: AgentPresence): boolean {
  return !liveAgents.value.some((candidate) => candidate.clientKey === agent.clientKey)
}

function label(agent: AgentPresence): string {
  const state = t(`shell.agents.states.${gone(agent) ? 'gone' : stateKey(agent)}`)
  return t('shell.agents.avatarLabel', { name: displayName(agent), state })
}

function takeOverBadgeFor(agent: AgentPresence): 'offer' | 'control' | undefined {
  return props.takeOverBadge?.clientKey === agent.clientKey && !gone(agent) && agent.state !== 'needs-you' ? props.takeOverBadge.kind : undefined
}

function tooltip(agent: AgentPresence): string {
  const name = displayName(agent)
  if (gone(agent)) return t('shell.agents.gone', { name })
  const takeOver = takeOverBadgeFor(agent)
  if (takeOver) return t(takeOver === 'offer' ? 'shell.takeOver.avatarOffer' : 'shell.takeOver.avatarControl', { name })
  if (agent.state === 'needs-you') {
    return props.attentionReason
      ? t('shell.agents.needsYouReason', { name, reason: props.attentionReason })
      : t('shell.agents.needsYou', { name })
  }
  if (agent.state === 'idle') return t('shell.agents.idle', { name })
  return t('shell.agents.tooltip', { name, step: agentStepText(t, agent.step, agent.target, 'now') })
}

function color(agent: AgentPresence): string {
  return agentAvatarColorHex(agent.colorIndex)
}

function target(agent: AgentPresence): string | undefined {
  return agent.attentionTabId ?? agent.lastTabId
}

function openTab(tabId: string | undefined): { id: string; agentPaused: boolean } | undefined {
  const tab = tabId ? props.tabs?.find((candidate) => candidate.id === tabId) : undefined
  return tab && { id: tab.id, agentPaused: tab.agentPaused === true }
}

function agentByKey(clientKey: string): AgentPresence | undefined {
  return shown.value.find((agent) => agent.clientKey === clientKey)
}

// The state can change between the press and the click, such as a request for you ending. The
// card keeps the tab the avatar showed when pressed. Pressing an avatar also
// moves focus out of its open card, which closes it; that click must not open it again.
let pressed: { clientKey: string; tabId?: string; cardOpen: boolean } | undefined
// The tab the open card acts on, chosen when it opened.
let cardTabId: string | undefined
// The card that focus leaving closed, and when the shell heard it. The press that moved focus can
// arrive after that news; it happened before it, which its event time shows.
let blurClosed: { clientKey: string; at: number } | undefined

function closedByThisPress(clientKey: string, event: Event | undefined): boolean {
  return event !== undefined && blurClosed?.clientKey === clientKey && event.timeStamp <= blurClosed.at
}

function press(agent: AgentPresence, event?: Event): void {
  pressed = { clientKey: agent.clientKey, tabId: target(agent), cardOpen: card.openKey.value === agent.clientKey || closedByThisPress(agent.clientKey, event) }
}

function release(): void {
  pressed = undefined
}

const root = ref<HTMLElement | null>(null)

function avatarElement(clientKey: string): HTMLElement | null {
  return [...(root.value?.querySelectorAll<HTMLElement>('.agent-avatar') ?? [])].find((avatar) => avatar.dataset.clientKey === clientKey) ?? null
}

// Hronaut reads the decision and checks the page only while a card for an agent that needs you is open.
const decisionCardOpen = ref(false)
const decisionAnswers = useAgentDecisionAnswers({
  browser: () => props.browser,
  target: () => props.attentionDecisionId && props.attentionId && props.workspaceId && props.attentionWorkspaceId === props.workspaceId
    ? { workspaceId: props.workspaceId, decisionId: props.attentionDecisionId, requestId: props.attentionId }
    : undefined,
  active: () => decisionCardOpen.value
})

const card = useAgentCard({
  ...(props.cardApi ? { api: props.cardApi } : {}),
  model(clientKey) {
    const agent = agentByKey(clientKey)
    if (!agent) return undefined
    const tab = openTab(cardTabId) ?? openTab(target(agent))
    return agentCardModel(agent, {
      workspaceName: props.workspaceName || props.workspaceId || '',
      ...(props.attentionReason ? { attentionReason: props.attentionReason } : {}),
      ...(props.attentionId ? { attentionId: props.attentionId } : {}),
      ...(props.attentionDecision ? { attentionDecision: true } : {}),
      ...(props.attentionDecision && decisionAnswers.state.value ? { decision: decisionAnswers.state.value } : {}),
      follow: props.follow === true,
      showCursor: props.showCursor,
      pinLiveStatus: props.pinLiveStatus === true,
      allSteps: props.allSteps === true,
      ...(tab ? { tab } : {}),
      tabInView: tab?.id === props.activeTabId,
      agentControlLocked: props.agentControlLocked === true,
      color: color(agent),
      name: displayName(agent),
      ...(gone(agent) ? { gone: true } : {}),
      formatTime: (at) => formatTime(isSupportedLocale(locale.value) ? locale.value : 'en-US', at)
    }, t)
  },
  anchor: avatarElement,
  onAction(clientKey, action, key, note) {
    run(clientKey, action, key, note)
  },
  onClosed(clientKey, reason) {
    if (reason === 'blur') blurClosed = { clientKey, at: performance.now() }
    if (reason !== 'escape') return
    // Esc gives focus back to the avatar that opened the card, or to the first one once it has left.
    void nextTick(() => (avatarElement(clientKey) ?? root.value?.querySelector<HTMLElement>('.agent-avatar'))?.focus({ preventScroll: true }))
  }
})

function remember(agent: AgentPresence): void {
  cardAgent.value = { agent, index: Math.max(0, agents.value.indexOf(agent)) }
}

// Keep the open card's agent current while it is connected.
watch(liveAgents, (live) => {
  const kept = cardAgent.value
  if (!kept) return
  const index = live.findIndex((agent) => agent.clientKey === kept.agent.clientKey)
  if (index >= 0) cardAgent.value = { agent: live[index], index }
})
watch(card.openKey, (key) => {
  if (key) return
  cardAgent.value = undefined
  cardTabId = undefined
})
watchEffect(() => {
  const key = card.openKey.value
  const agent = key ? agentByKey(key) : undefined
  decisionCardOpen.value = agent?.state === 'needs-you' && !gone(agent)
})
// The card belongs to the workspace in view.
watch(() => props.workspaceId, () => card.close())

function run(clientKey: string, action: AgentCardAction, key?: string, note?: string): void {
  const agent = agentByKey(clientKey)
  const tab = agent && (openTab(cardTabId) ?? openTab(target(agent)))
  if (action === 'answer-check' || action === 'answer-resolve' || action === 'answer-reject') {
    // The decision checks the key against the revision the card showed; a tick names the reading it confirms.
    if (!key || !props.attentionDecision || agent?.state !== 'needs-you' || gone(agent)) return
    if (action === 'answer-check') decisionAnswers.confirm(key)
    else void decisionAnswers.answer(key, action === 'answer-resolve' ? 'resolve' : 'reject', note)
    return
  }
  if (action === 'follow-on' || action === 'follow-off') {
    emit('setFollow', action === 'follow-on')
    return
  }
  if (action === 'cursor-on' || action === 'cursor-off') {
    emit('setShowCursor', action === 'cursor-on')
    return
  }
  if (action === 'pin-on' || action === 'pin-off') {
    emit('setPinLiveStatus', action === 'pin-on')
    return
  }
  if (action === 'all-steps') {
    // The steps open over the page, so the card makes way.
    card.close()
    if (agent && !gone(agent) && props.allSteps && props.workspaceId) emit('showSteps', clientKey, props.workspaceId)
    return
  }
  if (action === 'hand-back' || action === 'dismiss' || action === 'review-decision') {
    // An answer applies only to the request the card showed, while this agent still asks it.
    if (!key || key !== props.attentionId || agent?.state !== 'needs-you' || gone(agent)) return
    if (action === 'review-decision') {
      card.close()
      if (props.workspaceId) emit('reviewDecision', props.workspaceId)
      return
    }
    if (props.attentionDecision) return
    emit('answerAttention', key, action === 'hand-back' ? 'resolved' : 'dismissed')
    return
  }
  if (!tab) return
  if (action === 'pause' || action === 'resume') {
    if (!props.agentControlLocked) emit('setPaused', tab.id, action === 'pause')
    return
  }
  // Showing the tab, or taking over on it, ends the card; the page takes focus.
  card.close()
  if (action === 'take-over') {
    if (!props.agentControlLocked) emit('takeOver', tab.id)
    return
  }
  if (tab.id !== props.activeTabId) emit('select', tab.id)
}

function toggle(agent: AgentPresence): void {
  const tabId = pressed?.clientKey === agent.clientKey ? pressed.tabId : target(agent)
  const wasOpen = pressed?.clientKey === agent.clientKey ? pressed.cardOpen : card.openKey.value === agent.clientKey
  pressed = undefined
  blurClosed = undefined
  if (wasOpen) {
    card.close()
    return
  }
  cardTabId = tabId
  remember(agent)
  card.open(agent.clientKey)
}

/**
 * Opens the card of the agent that needs you, or else the first agent's; for the keyboard shortcut.
 * With `reopen`, as from a button in the shell, an open card is shown again as a new card: pressing
 * the button takes focus from the card, which main closes, and that late close must not win.
 */
function openCard(options: { reopen?: boolean } = {}): boolean {
  const agent = shown.value.find((candidate) => candidate.state === 'needs-you') ?? shown.value[0]
  if (!agent) return false
  if (card.openKey.value === agent.clientKey) {
    if (!options.reopen) return true
    card.close()
  }
  cardTabId = target(agent)
  remember(agent)
  card.open(agent.clientKey)
  return true
}

/** Gives keyboard focus to the first avatar; false when there is none. */
function focus(): boolean {
  const avatar = root.value?.querySelector<HTMLElement>('.agent-avatar')
  avatar?.focus({ preventScroll: true })
  return Boolean(avatar)
}

// Whether a card is open under one of these avatars, so the full-page view keeps the toolbar in view.
const cardOpen = computed(() => card.openKey.value !== null)

defineExpose({ openCard, focus, cardOpen })
</script>

<template>
  <div
    v-if="agents.length"
    ref="root"
    class="agent-presence"
    role="group"
    data-testid="agent-presence"
    :aria-label="t('shell.agents.group')"
  >
    <UiButton
      v-for="agent in shown"
      :key="agent.clientKey"
      appearance="application"
      class="agent-avatar"
      type="button"
      :data-state="gone(agent) ? 'gone' : agent.state"
      :data-client-key="agent.clientKey"
      :style="{ '--agent-color': color(agent) }"
      :aria-label="label(agent)"
      aria-haspopup="dialog"
      :aria-expanded="card.openKey.value === agent.clientKey"
      v-tooltip="tooltip(agent)"
      @pointerdown="press(agent, $event)"
      @keydown.enter="press(agent)"
      @keydown.space="press(agent)"
      @pointerleave="release"
      @blur="release"
      @click="toggle(agent)"
    >
      <span class="agent-avatar-face" aria-hidden="true">
        <template v-if="agent.initial">{{ agent.initial }}</template>
        <IconSmartToy v-else />
      </span>
      <span v-if="agent.state === 'needs-you' && !gone(agent)" class="agent-avatar-badge" aria-hidden="true"><IconPriorityHigh /></span>
      <span v-else-if="takeOverBadgeFor(agent)" class="agent-avatar-badge take-over" :data-kind="takeOverBadgeFor(agent)" aria-hidden="true"><IconBackHand /></span>
    </UiButton>
    <span
      v-if="more.length"
      class="agent-avatar-more"
      role="img"
      :aria-label="moreLabel"
      v-tooltip="moreLabel"
    >+{{ more.length }}</span>
  </div>
</template>
