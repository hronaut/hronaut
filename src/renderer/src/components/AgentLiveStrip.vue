<script setup lang="ts">
import { computed, onBeforeUnmount, onBeforeUpdate, onUpdated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconSmartToy from '~icons/material-symbols/smart-toy-outline-rounded'
import { agentAvatarColorHex, type AgentPresence, type HronautAgentPresenceApi } from '../../../shared/agent-presence.js'
import { agentStepText } from '../composables/agent-step-text.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  /** The workspace of the page in view. */
  workspaceId: string
  /** The reason of the current request for you, shown for the agent that made it. */
  attentionReason?: string
  /** That request's id, which Hand back answers. */
  attentionId?: string
  /** That request is a human-waiting decision, answered in the agent's card instead. */
  attentionDecision?: boolean
  /** The workspace and tab that request is about. */
  attentionWorkspaceId?: string
  attentionTabId?: string
  /** The open tabs, to find the one an agent acts on and whether agents are paused there. */
  tabs?: readonly { id: string; agentPaused?: boolean }[]
  agentControlLocked?: boolean
  api?: HronautAgentPresenceApi
}>()

const emit = defineEmits<{
  setPaused: [tabId: string, paused: boolean]
  takeOver: [tabId: string]
  /** The person finished what the agent asked for. */
  handBack: [id: string]
  /** Open the card of the agent that needs you, where a decision is answered. */
  openCard: []
  unpin: []
}>()

const { t } = useI18n({ useScope: 'global' })
const presence = useAgentPresence(props.api)
onBeforeUnmount(presence.dispose)

// Main orders a workspace's agents: needs you, working, idle. The strip shows the first; the
// toolbar's avatars show them all.
const agents = computed(() => presence.snapshot.value.workspaces[props.workspaceId] ?? [])
const agent = computed<AgentPresence | undefined>(() => agents.value[0])
const others = computed(() => agents.value.slice(1))
const needsYou = computed(() => agent.value?.state === 'needs-you')
// The request for you is this agent's only when it is about this workspace and the tab the agent asked
// about: main sends a new request before it publishes who made it.
const requestHere = computed(() => needsYou.value && Boolean(props.attentionId) && props.attentionWorkspaceId === props.workspaceId
  && (!props.attentionTabId || !agent.value?.attentionTabId || props.attentionTabId === agent.value.attentionTabId))
const name = computed(() => agent.value?.name || t('shell.agents.unnamed'))

const tab = computed(() => {
  const tabId = agent.value && (agent.value.attentionTabId ?? agent.value.lastTabId)
  const found = tabId ? props.tabs?.find((candidate) => candidate.id === tabId) : undefined
  return found && { id: found.id, agentPaused: found.agentPaused === true }
})

const detail = computed(() => {
  const current = agent.value
  if (!current) return ''
  // A decision's request carries a fixed English line; the card reads the decision and says it in your language.
  if (current.state === 'needs-you') {
    if (!requestHere.value) return t('shell.agents.steps.askYou')
    return props.attentionDecision ? t('shell.agentStrip.decision') : props.attentionReason || t('shell.agents.steps.askYou')
  }
  if (current.state === 'idle') return t('shell.agentCard.nowIdle')
  return agentStepText(t, current.step, current.target, 'now')
})

const moreLabel = computed(() => t('shell.agents.more', { names: others.value.map((other) => other.name || t('shell.agents.unnamed')).join(', ') }))
const canHandBack = computed(() => requestHere.value && !props.attentionDecision)
const canAnswer = computed(() => requestHere.value && props.attentionDecision === true)

function handBack(): void {
  if (canHandBack.value && props.attentionId) emit('handBack', props.attentionId)
}

function togglePause(): void {
  if (tab.value && !props.agentControlLocked) emit('setPaused', tab.value.id, !tab.value.agentPaused)
}

function takeOver(): void {
  if (tab.value && !props.agentControlLocked) emit('takeOver', tab.value.id)
}

// A control that leaves while it has focus, such as Hand back once the request is answered, hands
// focus to the strip's next control instead of dropping it.
const pill = ref<HTMLElement | null>(null)
let focusInside = false
onBeforeUpdate(() => {
  focusInside = pill.value?.contains(document.activeElement) === true
})
onUpdated(() => {
  if (!focusInside || (document.activeElement && document.activeElement !== document.body)) return
  pill.value?.querySelector<HTMLElement>('.agent-live-strip-actions button:not(:disabled), .agent-live-strip-unpin')?.focus({ preventScroll: true })
})
</script>

<template>
  <div class="agent-live-strip">
    <div
      ref="pill"
      class="agent-live-strip-pill"
      role="group"
      data-testid="agent-live-strip"
      :data-state="presence.loaded.value ? agent?.state ?? 'none' : 'loading'"
      :aria-label="t('shell.agentStrip.label')"
      :style="agent ? { '--agent-color': agentAvatarColorHex(agent.colorIndex) } : undefined"
    >
      <template v-if="agent">
        <span class="agent-live-strip-avatar" aria-hidden="true">
          <template v-if="agent.initial">{{ agent.initial }}</template>
          <IconSmartToy v-else />
        </span>
        <strong class="agent-live-strip-name">{{ name }}</strong>
        <span class="agent-live-strip-state">{{ t(`shell.agentCard.states.${needsYou ? 'needsYou' : agent.state}`) }}</span>
        <!-- Cut to fit; the tooltip and the agent's card have the whole text. -->
        <span class="agent-live-strip-detail" :data-tooltip="detail">{{ detail }}</span>
        <span v-if="others.length" class="agent-live-strip-more" role="img" :aria-label="moreLabel" v-tooltip="moreLabel">+{{ others.length }}</span>
        <div class="agent-live-strip-actions">
          <UiButton
            v-if="canHandBack"
            appearance="application"
            class="agent-live-strip-button primary"
            type="button"
            v-tooltip="t('shell.agentStrip.handBackDescription')"
            @click="handBack"
          >{{ t('shell.agentStrip.handBack') }}</UiButton>
          <UiButton
            v-else-if="canAnswer"
            appearance="application"
            class="agent-live-strip-button primary"
            type="button"
            v-tooltip="t('shell.agentStrip.answerDescription')"
            @click="emit('openCard')"
          >{{ t('shell.agentStrip.answer') }}</UiButton>
          <UiButton
            v-if="tab && !needsYou"
            appearance="application"
            class="agent-live-strip-button"
            type="button"
            :disabled="agentControlLocked"
            v-tooltip="t(tab.agentPaused ? 'shell.agentCard.resume' : 'shell.agentCard.pause')"
            @click="togglePause"
          >{{ t(tab.agentPaused ? 'shell.agentStrip.resume' : 'shell.agentStrip.pause') }}</UiButton>
          <UiButton
            v-if="tab"
            appearance="application"
            class="agent-live-strip-button"
            type="button"
            :disabled="agentControlLocked"
            @click="takeOver"
          >{{ t('shell.agentCard.takeOver') }}</UiButton>
        </div>
      </template>
      <!-- Until main's presence arrives the strip holds its place without claiming no one is working. -->
      <span v-else class="agent-live-strip-detail">{{ presence.loaded.value ? t('shell.agentStrip.empty') : '' }}</span>
      <UiButton
        appearance="application"
        class="agent-live-strip-unpin"
        type="button"
        :aria-label="t('shell.agentStrip.unpin')"
        v-tooltip="t('shell.agentStrip.unpin')"
        @click="emit('unpin')"
      ><IconKeyboardArrowUp aria-hidden="true" /></UiButton>
    </div>
  </div>
</template>
