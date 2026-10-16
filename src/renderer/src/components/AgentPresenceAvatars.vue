<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded'
import IconSmartToy from '~icons/material-symbols/smart-toy-outline-rounded'
import {
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_VISIBLE_LIMIT,
  type AgentPresence,
  type HronautAgentPresenceApi
} from '../../../shared/agent-presence.js'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../../shared/tab-groups.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  /** The workspace of the page in view; no avatars without one. */
  workspaceId?: string
  activeTabId?: string
  /** The reason of the current request for you, shown for the agent that made it. */
  attentionReason?: string
  api?: HronautAgentPresenceApi
}>()

const emit = defineEmits<{
  select: [tabId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const presence = useAgentPresence(props.api)
onBeforeUnmount(presence.dispose)

const agents = computed(() => (props.workspaceId && presence.snapshot.value.workspaces[props.workspaceId]) || [])
const shown = computed(() => agents.value.slice(0, AGENT_AVATAR_VISIBLE_LIMIT))
const more = computed(() => agents.value.slice(AGENT_AVATAR_VISIBLE_LIMIT))
const moreLabel = computed(() => t('shell.agents.more', { names: more.value.map(displayName).join(', ') }))

function displayName(agent: AgentPresence): string {
  return agent.name || t('shell.agents.unnamed')
}

function stateKey(agent: AgentPresence): 'idle' | 'working' | 'needsYou' {
  return agent.state === 'needs-you' ? 'needsYou' : agent.state
}

function label(agent: AgentPresence): string {
  return t('shell.agents.avatarLabel', { name: displayName(agent), state: t(`shell.agents.states.${stateKey(agent)}`) })
}

function tooltip(agent: AgentPresence): string {
  const name = displayName(agent)
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

// Pressing anywhere in the shell answers a request for you, and that answer can
// arrive before the click. The click keeps the tab the avatar showed when pressed.
let pressed: { clientKey: string; tabId?: string } | undefined

function press(agent: AgentPresence): void {
  pressed = { clientKey: agent.clientKey, tabId: target(agent) }
}

function release(): void {
  pressed = undefined
}

// Shows the tab the agent asked about or last used, when it is not the one in view already.
function select(agent: AgentPresence): void {
  const tabId = pressed?.clientKey === agent.clientKey ? pressed.tabId : target(agent)
  pressed = undefined
  if (tabId && tabId !== props.activeTabId) emit('select', tabId)
}
</script>

<template>
  <div
    v-if="agents.length"
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
      :data-state="agent.state"
      :style="{ '--agent-color': color(agent) }"
      :aria-label="label(agent)"
      v-tooltip="tooltip(agent)"
      @pointerdown="press(agent)"
      @keydown.enter="press(agent)"
      @keydown.space="press(agent)"
      @pointerleave="release"
      @blur="release"
      @click="select(agent)"
    >
      <span class="agent-avatar-face" aria-hidden="true">
        <template v-if="agent.initial">{{ agent.initial }}</template>
        <IconSmartToy v-else />
      </span>
      <span v-if="agent.state === 'needs-you'" class="agent-avatar-badge" aria-hidden="true"><IconPriorityHigh /></span>
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
