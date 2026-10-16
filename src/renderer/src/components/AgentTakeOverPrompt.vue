<script lang="ts">
/** Marks the agent's avatar when the toolbar has no room for the take-over prompt. */
export interface AgentTakeOverBadge {
  clientKey: string
  /** You can take over from this agent, or you already have its tab. */
  kind: 'offer' | 'control'
}
</script>

<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import {
  AGENT_TAKE_OVER_OFFER_MS,
  agentAvatarColorHex,
  type AgentPresence,
  type AgentTakeOverOffer,
  type HronautAgentPresenceApi
} from '../../../shared/agent-presence.js'
import { useAgentPresence } from '../composables/useAgentPresence.js'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  /** The workspace of the page in view. */
  workspaceId?: string
  activeTabId?: string
  /** The open tabs, for whether agents are paused on the one in view and whether you took it over. */
  tabs?: readonly { id: string; agentPaused?: boolean; takenOverAt?: number }[]
  agentControlLocked?: boolean
  api?: HronautAgentPresenceApi
}>()

const emit = defineEmits<{
  /** Pause the agent on this tab and give you control. */
  takeOver: [tabId: string]
  /** Resume the agent on this tab, which hears what changed. */
  handBack: [tabId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const api = props.api ?? window.hronautAgentPresence
const presence = useAgentPresence(api)

// Main offers a take-over each time you click or type in a page an agent is working on. The offer lasts
// a few seconds from your latest touch, and only while that agent still works on that tab.
const offer = shallowRef<AgentTakeOverOffer>()
let offerTimer: number | undefined
function endOffer(): void {
  window.clearTimeout(offerTimer)
  offerTimer = undefined
  offer.value = undefined
}
// Dismissing keeps that agent's offers for that tab away while it goes on working there, so you can keep typing.
const dismissed = shallowRef<AgentTakeOverOffer>()
function workingOn(target: AgentTakeOverOffer): boolean {
  return Object.values(presence.snapshot.value.workspaces).some((workspace) => workspace.some((agent) => (
    agent.clientKey === target.clientKey && agent.state === 'working' && agent.lastTabId === target.tabId
  )))
}
watch(() => dismissed.value && !workingOn(dismissed.value), (ended) => { if (ended) dismissed.value = undefined })
function dismiss(): void {
  dismissed.value = offer.value
  endOffer()
}
const stopOffers = api.onTakeOverOffer?.((next) => {
  const ignored = dismissed.value
  if (ignored?.tabId === next.tabId && ignored.clientKey === next.clientKey && workingOn(ignored)) return
  window.clearTimeout(offerTimer)
  offer.value = { tabId: next.tabId, clientKey: next.clientKey }
  offerTimer = window.setTimeout(endOffer, AGENT_TAKE_OVER_OFFER_MS)
})
onBeforeUnmount(() => {
  presence.dispose()
  stopOffers?.()
  endOffer()
})

const agents = computed(() => (props.workspaceId && presence.snapshot.value.workspaces[props.workspaceId]) || [])
const tab = computed(() => props.activeTabId ? props.tabs?.find((candidate) => candidate.id === props.activeTabId) : undefined)
const offeredBy = computed<AgentPresence | undefined>(() => {
  const current = offer.value
  if (!current || !tab.value || current.tabId !== tab.value.id || tab.value.agentPaused || props.agentControlLocked) return undefined
  return agents.value.find((agent) => agent.clientKey === current.clientKey && agent.state === 'working' && agent.lastTabId === current.tabId)
})
// The shortcut also takes over from an agent working on the page before an offer arrives.
const workingHere = computed<AgentPresence | undefined>(() => {
  const current = tab.value
  if (!current || current.agentPaused || props.agentControlLocked) return undefined
  return agents.value.find((agent) => agent.state === 'working' && agent.lastTabId === current.id)
})
const takenOver = computed(() => tab.value?.agentPaused === true && tab.value.takenOverAt !== undefined)
// The tab goes back to the agent that last used it, while it is still in the workspace.
const handBackTo = computed(() => takenOver.value ? agents.value.find((agent) => agent.lastTabId === tab.value?.id) : undefined)

function name(agent: AgentPresence): string {
  return agent.name || t('shell.agents.unnamed')
}

const offerText = computed(() => offeredBy.value ? t('shell.takeOver.offer', { name: name(offeredBy.value) }) : '')
const announcement = computed(() => offerText.value || (takenOver.value ? t('shell.takeOver.control') : ''))
const state = computed<'offer' | 'control' | undefined>(() => offeredBy.value ? 'offer' : takenOver.value ? 'control' : undefined)
const agent = computed(() => offeredBy.value ?? handBackTo.value)
const agentColor = computed(() => agent.value ? { '--agent-color': agentAvatarColorHex(agent.value.colorIndex) } : undefined)
const handBackLabel = computed(() => handBackTo.value ? t('shell.takeOver.handBackTo', { name: name(handBackTo.value) }) : t('shell.takeOver.handBack'))

// The prompt takes only room the toolbar leaves free: beside the commands when they share the address's row,
// before them when they have a row of their own. Without room for its words it keeps only its buttons, and
// without room for those the agent's avatar carries a badge instead, so the address field never narrows.
type Fit = 'full' | 'compact' | 'none'
const fit = ref<Fit>('none')
const root = ref<HTMLElement>()
const pill = ref<HTMLElement>()
const measureFull = ref<HTMLElement>()
const measureCompact = ref<HTMLElement>()

function px(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The width the toolbar can give the prompt without moving or narrowing anything else. */
function freeRoom(toolbar: HTMLElement, commands: HTMLElement, gap: number): number {
  const address = toolbar.querySelector<HTMLElement>('.address-form')
  const reload = toolbar.querySelector<HTMLElement>('.reload-button')
  if (!address || !reload) return 0
  const own = pill.value ? pill.value.getBoundingClientRect().width + gap : 0
  const commandsBox = commands.getBoundingClientRect()
  if (commandsBox.top >= reload.getBoundingClientRect().bottom) {
    // The commands have a row of their own, which the address field does not share.
    const style = getComputedStyle(toolbar)
    const row = toolbar.clientWidth - px(style.paddingLeft) - px(style.paddingRight) - px(getComputedStyle(commands).marginLeft)
    return row - (commandsBox.width - own)
  }
  // On the address's row only the space around a field at its widest is free.
  const style = getComputedStyle(address)
  const widest = style.maxWidth === 'none' ? Number.POSITIVE_INFINITY : px(style.maxWidth)
  return Math.max(0, address.getBoundingClientRect().width + px(style.marginLeft) + px(style.marginRight) + own - widest)
}

function measure(): void {
  const toolbar = root.value?.closest<HTMLElement>('.toolbar')
  const commands = root.value?.closest<HTMLElement>('.toolbar-commands')
  if (!state.value || !toolbar || !commands || !measureFull.value || !measureCompact.value) {
    fit.value = 'none'
    return
  }
  const gap = px(getComputedStyle(commands).columnGap)
  const room = freeRoom(toolbar, commands, gap) + 0.5
  fit.value = room >= measureFull.value.getBoundingClientRect().width + gap ? 'full'
    : room >= measureCompact.value.getBoundingClientRect().width + gap ? 'compact'
      : 'none'
}

useResizeObserver(() => {
  const toolbar = root.value?.closest<HTMLElement>('.toolbar')
  return [toolbar, toolbar?.querySelector<HTMLElement>('.address-form'), root.value?.closest<HTMLElement>('.toolbar-commands'), measureFull.value, measureCompact.value]
    .filter((element): element is HTMLElement => Boolean(element))
}, measure)
watch([state, agent, () => props.agentControlLocked], () => { void nextTick(measure) }, { immediate: true })

/** The avatar of the agent the prompt is about, marked when the toolbar has no room for the prompt. */
const badge = computed<AgentTakeOverBadge | undefined>(() => state.value && agent.value && fit.value === 'none'
  ? { clientKey: agent.value.clientKey, kind: state.value }
  : undefined)

/** Takes over from the agent working on the tab in view, as from the button or the keyboard shortcut. */
function takeOver(): boolean {
  if (!(offeredBy.value ?? workingHere.value) || !tab.value) return false
  const tabId = tab.value.id
  endOffer()
  emit('takeOver', tabId)
  return true
}

function handBack(): void {
  if (takenOver.value && tab.value && !props.agentControlLocked) emit('handBack', tab.value.id)
}

defineExpose({ takeOver, offerText, badge })
</script>

<template>
  <div ref="root" class="agent-take-over-slot">
    <span class="sr-only" role="status">{{ announcement }}</span>
    <!-- Unseen copies, with and without the words, to know which fits. -->
    <div v-if="state" class="agent-take-over-measure" aria-hidden="true" inert>
      <div ref="measureFull" class="agent-take-over" :style="agentColor">
        <span class="agent-take-over-text">{{ state === 'offer' ? offerText : t('shell.takeOver.control') }}</span>
        <UiButton appearance="application" class="agent-take-over-button" :class="{ primary: state === 'offer' }" type="button" tabindex="-1">{{ state === 'offer' ? t('shell.takeOver.takeOver') : handBackLabel }}</UiButton>
        <UiButton v-if="state === 'offer'" appearance="application" class="agent-take-over-dismiss" type="button" tabindex="-1"><IconClose /></UiButton>
      </div>
      <div ref="measureCompact" class="agent-take-over compact" :style="agentColor">
        <UiButton appearance="application" class="agent-take-over-button" :class="{ primary: state === 'offer' }" type="button" tabindex="-1">{{ state === 'offer' ? t('shell.takeOver.takeOver') : t('shell.takeOver.handBack') }}</UiButton>
        <UiButton v-if="state === 'offer'" appearance="application" class="agent-take-over-dismiss" type="button" tabindex="-1"><IconClose /></UiButton>
      </div>
    </div>
    <div
      v-if="state === 'offer' && offeredBy && fit !== 'none'"
      ref="pill"
      class="agent-take-over"
      :class="{ compact: fit === 'compact' }"
      role="group"
      data-testid="agent-take-over"
      data-state="offer"
      :data-fit="fit"
      :aria-label="offerText"
      :style="agentColor"
    >
      <span v-if="fit === 'full'" class="agent-take-over-text" aria-hidden="true">{{ offerText }}</span>
      <UiButton
        appearance="application"
        class="agent-take-over-button primary"
        type="button"
        aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
        v-tooltip="t('shell.takeOver.takeOverDescription', { name: name(offeredBy) })"
        @click="takeOver"
      >{{ t('shell.takeOver.takeOver') }}</UiButton>
      <UiButton
        appearance="application"
        class="agent-take-over-dismiss"
        type="button"
        :aria-label="t('shell.takeOver.dismiss')"
        v-tooltip="t('shell.takeOver.dismiss')"
        @click="dismiss"
      ><IconClose aria-hidden="true" /></UiButton>
    </div>
    <div
      v-else-if="state === 'control' && fit !== 'none'"
      ref="pill"
      class="agent-take-over"
      :class="{ compact: fit === 'compact' }"
      role="group"
      data-testid="agent-take-over"
      data-state="control"
      :data-fit="fit"
      :aria-label="t('shell.takeOver.control')"
      :style="agentColor"
    >
      <span v-if="fit === 'full'" class="agent-take-over-text" aria-hidden="true">{{ t('shell.takeOver.control') }}</span>
      <UiButton
        appearance="application"
        class="agent-take-over-button"
        type="button"
        :aria-label="handBackLabel"
        :disabled="agentControlLocked"
        v-tooltip="t('shell.takeOver.handBackDescription')"
        @click="handBack"
      >{{ fit === 'full' ? handBackLabel : t('shell.takeOver.handBack') }}</UiButton>
    </div>
  </div>
</template>
