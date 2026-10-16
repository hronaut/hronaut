<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded'
import IconSmartToy from '~icons/material-symbols/smart-toy-outline-rounded'
import type { AgentCardAction, HronautAgentCardApi } from '../../../shared/agent-card.js'
import {
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_VISIBLE_LIMIT,
  type AgentPresence,
  type HronautAgentPresenceApi
} from '../../../shared/agent-presence.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { agentCardModel, useAgentCard } from '../composables/useAgentCard.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
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
  /** The open tabs, to find the one an agent acts on and whether agents are paused there. */
  tabs?: readonly { id: string; agentPaused?: boolean }[]
  follow?: boolean
  agentControlLocked?: boolean
  api?: HronautAgentPresenceApi
  cardApi?: HronautAgentCardApi
}>()

const emit = defineEmits<{
  select: [tabId: string]
  /** Pause or resume agents on this tab. */
  setPaused: [tabId: string, paused: boolean]
  /** Pause agents on this tab and show it, for you to carry on. */
  takeOver: [tabId: string]
  setFollow: [follow: boolean]
  /** Answer the open request for you: done and handed back, or dismissed. */
  answerAttention: [id: string, answer: 'resolved' | 'dismissed']
  /** Open the workspace where its waiting decisions are reviewed. */
  reviewDecision: [workspaceId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
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

function tooltip(agent: AgentPresence): string {
  const name = displayName(agent)
  if (gone(agent)) return t('shell.agents.gone', { name })
  if (agent.state === 'needs-you') {
    return props.attentionReason
      ? t('shell.agents.needsYouReason', { name, reason: props.attentionReason })
      : t('shell.agents.needsYou', { name })
  }
  if (agent.state === 'idle') return t('shell.agents.idle', { name })
  return t('shell.agents.tooltip', { name, step: t(`shell.agents.steps.${agent.step}`) })
}

function color(agent: AgentPresence): string {
  return BROWSER_TAB_GROUP_COLOR_HEX[AGENT_AVATAR_COLORS[agent.colorIndex] ?? 'gray']
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
      follow: props.follow === true,
      ...(tab ? { tab } : {}),
      tabInView: tab?.id === props.activeTabId,
      agentControlLocked: props.agentControlLocked === true,
      color: color(agent),
      name: displayName(agent),
      ...(gone(agent) ? { gone: true } : {})
    }, t)
  },
  anchor: avatarElement,
  onAction(clientKey, action, key) {
    run(clientKey, action, key)
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
// The card belongs to the workspace in view.
watch(() => props.workspaceId, () => card.close())

function run(clientKey: string, action: AgentCardAction, key?: string): void {
  const agent = agentByKey(clientKey)
  const tab = agent && (openTab(cardTabId) ?? openTab(target(agent)))
  if (action === 'follow-on' || action === 'follow-off') {
    emit('setFollow', action === 'follow-on')
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

/** Opens the card of the agent that needs you, or else the first agent's; for the keyboard shortcut. */
function openCard(): boolean {
  const agent = shown.value.find((candidate) => candidate.state === 'needs-you') ?? shown.value[0]
  if (!agent) return false
  if (card.openKey.value === agent.clientKey) return true
  cardTabId = target(agent)
  remember(agent)
  card.open(agent.clientKey)
  return true
}

defineExpose({ openCard })
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
