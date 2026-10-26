<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconStopCircle from '~icons/material-symbols/stop-circle-rounded'
import IconRecord from '~icons/material-symbols/fiber-manual-record-rounded'
import IconBedtime from '~icons/material-symbols/bedtime-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconHelp from '~icons/material-symbols/help-outline-rounded'
import IconHorizontalSplit from '~icons/material-symbols/horizontal-split-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconPauseCircle from '~icons/material-symbols/pause-circle-rounded'
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconVerticalSplit from '~icons/material-symbols/vertical-split-rounded'
import IconVolumeOff from '~icons/material-symbols/volume-off-rounded'
import IconVolumeUp from '~icons/material-symbols/volume-up-rounded'
import UiButton from '../ui/UiButton.vue'
import { vTooltip } from '../ui/tooltip.js'
import type { BrowserTabState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'

// One tab of the tab strip or rail. Each value it shows comes in as a prop that stays equal while it does not change,
// so a row draws again only when its own tab changed, not whenever another tab loads.
const props = defineProps<{
  tab: BrowserTabState
  /** The tab is the one in view, and Settings does not cover it. */
  active: boolean
  dragging: boolean
  dropPlacement?: 'before' | 'after'
  /** The browser-wide lock and mute show as pressed buttons, so a row does not repeat them. */
  allHumanInteractionLocked: boolean
  allTabsMuted: boolean
  /** How the split view shows this tab beside another, while it does. */
  splitOrientation?: 'horizontal' | 'vertical'
  /** The tool an agent runs on this tab, while one does. */
  agentCommand?: string
  /** Why an agent needs you, while it asks on this tab. */
  attention?: string
  keyboardIndex: 0 | -1
  /** The color of the tab's workspace, while it is in one. */
  groupColor?: string
  workerCaptureError?: string
  formatNumber: (value: number) => string
  tabTooltip: (tab: BrowserTabState) => string
  describeEmulation: (tab: BrowserTabState) => string
}>()

const emit = defineEmits<{
  select: [tabId: string]
  focusTab: [tabId: string]
  tabKeydown: [event: KeyboardEvent, tab: BrowserTabState]
  tabAuxclick: [event: MouseEvent, tab: BrowserTabState]
  contextMenu: [tabId: string]
  tabDragstart: [event: DragEvent, tab: BrowserTabState]
  tabDragover: [event: DragEvent, tab: BrowserTabState]
  tabDrop: [event: DragEvent, tab: BrowserTabState]
  tabDragend: []
  toggleMuted: [tab: BrowserTabState]
  close: [tabId: string]
  stopWorkerCapture: [tabId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const tooltip = computed(() => props.attention !== undefined
  ? `${props.tabTooltip(props.tab)}\n\n${props.attention}`
  : props.agentCommand !== undefined ? `${props.tabTooltip(props.tab)}\n\n${t('tabSearch.meta.agent')}` : props.tabTooltip(props.tab))
const networkUnconfirmed = computed(() => Boolean(props.tab.networkConditionState && props.tab.networkConditionState.application !== 'confirmed'))
</script>

<template>
  <UiButton appearance="application"
    class="tab"
    :class="{
      active,
      pinned: tab.pinned,
      sleeping: tab.sleeping,
      frozen: tab.pageLifecycleState === 'frozen',
      grouped: Boolean(tab.mcpGroupId),
      dragging,
      'drop-before': dropPlacement === 'before',
      'drop-after': dropPlacement === 'after',
      locked: tab.humanInteractionInputLocked ?? (allHumanInteractionLocked || tab.humanInteractionLocked),
      'split-visible': splitOrientation !== undefined,
      'mcp-active': agentCommand !== undefined,
      'needs-attention': attention !== undefined
    }"
    :style="groupColor ? { '--tab-group-color': groupColor } : undefined"
    v-tooltip="tooltip"
    :data-mcp-command="agentCommand"
    :aria-label="tabTooltip(tab)"
    :aria-description="attention !== undefined ? attention : agentCommand !== undefined ? t('tabSearch.meta.agent') : undefined"
    type="button"
    role="tab"
    :tabindex="keyboardIndex"
    :aria-keyshortcuts="tab.audible || tab.muted ? 'Delete M' : 'Delete'"
    :data-tab-id="tab.id"
    draggable="true"
    :aria-selected="active"
    :data-active-tab="active ? 'true' : undefined"
    @focus="emit('focusTab', tab.id)"
    @keydown="emit('tabKeydown', $event, tab)"
    @click="emit('select', tab.id)"
    @auxclick="emit('tabAuxclick', $event, tab)"
    @contextmenu.prevent="emit('contextMenu', tab.id)"
    @dragstart="emit('tabDragstart', $event, tab)"
    @dragover="emit('tabDragover', $event, tab)"
    @drop="emit('tabDrop', $event, tab)"
    @dragend="emit('tabDragend')"
  >
    <span v-if="active" class="tab-active-indicator" aria-hidden="true" />
    <span v-if="attention !== undefined" class="tab-attention-badge" aria-hidden="true"><IconPriorityHigh /></span>
    <span v-if="tab.loading" class="spinner" :aria-label="t('shell.loading')" />
    <IconError v-else-if="tab.pageProblem" class="favicon-fallback tab-problem-icon" :aria-label="t('shell.tabs.pageAttention')" />
    <img v-else-if="tab.faviconDataUrl" class="favicon-image" :src="tab.faviconDataUrl" alt="" draggable="false" />
    <span v-else-if="tab.url === 'about:blank'" class="favicon-fallback" aria-hidden="true">✦</span>
    <IconLanguage v-else class="favicon-fallback" aria-hidden="true" />
    <IconRecord v-if="tab.videoRecording === 'recording'" style="color: #e5484d" :aria-label="t('video.status.recording')" />
    <IconRecord v-if="tab.pwaLifecycleActive" :aria-label="t('pwaLifecycle.active')" />
    <span class="tab-title">{{ tab.label || tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) }}</span>
    <IconBedtime v-if="tab.sleeping" class="tab-sleep-mark" :aria-label="t('shell.tabs.sleeping')" />
    <IconPauseCircle v-else-if="tab.pageLifecycleState === 'frozen'" class="tab-freeze-mark" :aria-label="t('shell.tabs.frozen')" />
    <IconHelp v-else-if="tab.pageLifecycleState === 'unknown'" class="tab-freeze-mark unknown" :aria-label="t('shell.tabs.freezeUnknown')" />
    <IconHorizontalSplit v-if="splitOrientation === 'horizontal'" class="tab-split-mark" :aria-label="t('shell.tabs.stackedVisible')" />
    <IconVerticalSplit v-else-if="splitOrientation === 'vertical'" class="tab-split-mark" :aria-label="t('shell.tabs.sideVisible')" />
    <IconSpeed v-if="tab.emulation" class="tab-emulation-mark" :aria-label="t('runtime.emulation.reset', { description: describeEmulation(tab) })" />
    <IconRoute v-if="tab.networkRouteCount || networkUnconfirmed" class="tab-network-route-mark" :aria-label="networkUnconfirmed ? t('network.conditions.unconfirmed') : t('runtime.tabs.routes', { count: formatNumber(tab.networkRouteCount ?? 0) }, tab.networkRouteCount ?? 0)" />
    <!-- The browser-wide lock and mute already show as pressed buttons, so a tab draws its own lock, and a muted tab
         its speaker while it plays sound, instead of repeating them on every row. Its name still says both. -->
    <IconLock v-if="!allHumanInteractionLocked && (tab.humanInteractionInputLocked ?? tab.humanInteractionLocked)" class="tab-lock-mark" :aria-label="t('shell.tabs.inputLocked')" />
    <span
      v-if="tab.audible || (tab.muted && !allTabsMuted)"
      class="tab-audio"
      :class="{ muted: tab.muted }"
      v-tooltip="t(tab.muted ? 'runtime.tabs.unmute' : 'runtime.tabs.mute', { title: tabTitleForDisplay(tab, t('tabSearch.newTabTitle')) })"
      aria-hidden="true"
      @click.stop="emit('toggleMuted', tab)"
    >
      <IconVolumeOff v-if="tab.muted" aria-hidden="true" />
      <IconVolumeUp v-else aria-hidden="true" />
    </span>
    <span
      class="tab-close"
      v-tooltip="t('runtime.locks.closeShortcut')"
      aria-hidden="true"
      @click.stop="emit('close', tab.id)"
    ><IconClose aria-hidden="true" /></span>
  </UiButton>
  <UiButton v-if="tab.pwaLifecycleActive" variant="ghost" size="small" class="tab-pwa-stop" :data-testid="`worker-capture-stop-${tab.id}`" :aria-label="t('pwaLifecycle.stop')" v-tooltip="workerCaptureError || t('pwaLifecycle.stop')" @click="emit('stopWorkerCapture', tab.id)"><IconStopCircle aria-hidden="true" /></UiButton>
</template>

<style scoped>
.tab-pwa-stop { flex-shrink: 0; width: 28px; }
</style>
