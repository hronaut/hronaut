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
import UiButton from '../../ui/UiButton.vue'
import { vTooltip } from '../../ui/tooltip.js'
import type { BrowserTabState } from '../../../../shared/types.js'
import { tabTitleForDisplay } from '../../../../shared/tab-title.js'

// One tab of the tab strip or rail. It reads its own tab, name and agent command, and each other value it shows comes
// in as a prop that stays equal while it does not change, so a row draws again only when its own tab changed, and the
// strip around it does not draw again whenever a tab loads.
const props = defineProps<{
  tabId: string
  /** A tab of the latest browser state by its id. */
  readTab: (tabId: string) => BrowserTabState | undefined
  /** A tab's name with its states, as its tooltip shows them. */
  tabLabel: (tab: BrowserTabState) => string
  /** What a tab emulates, while it does. */
  describeEmulation: (tab: BrowserTabState) => string
  /** The tool an agent runs on a tab, while one does. */
  readAgentCommand: (tabId: string) => string | undefined
  /** The tab is the one in view, and Settings does not cover it. */
  active: boolean
  /** The tab is one of several selected with Ctrl, Cmd or Shift and a click, which its menu and a drag act on. */
  selected?: boolean
  dragging: boolean
  /** Where a dragged tab or link would land: before or after this tab, or a link on it. */
  dropPlacement?: 'before' | 'after' | 'onto'
  /** The browser-wide lock and mute show as pressed buttons, so a row does not repeat them. */
  allHumanInteractionLocked: boolean
  allTabsMuted: boolean
  /** How the split view shows this tab beside another, while it does or while it is put aside with it. */
  splitOrientation?: 'horizontal' | 'vertical'
  /** The split view holding this tab is put aside, so selecting the tab shows both again. */
  splitPaired?: boolean
  /** Why an agent needs you, while it asks on this tab. */
  attention?: string
  keyboardIndex: 0 | -1
  /** The color of the tab's workspace, while it is in one. */
  groupColor?: string
  workerCaptureError?: string
  formatNumber: (value: number) => string
}>()

const emit = defineEmits<{
  select: [tabId: string, event: MouseEvent]
  focused: [tabId: string]
  tabKeydown: [event: KeyboardEvent, tab: BrowserTabState]
  tabAuxclick: [event: MouseEvent, tab: BrowserTabState]
  contextMenu: [tabId: string]
  tabDragstart: [event: DragEvent, tab: BrowserTabState]
  tabDragenter: [event: DragEvent, tab: BrowserTabState]
  tabDragover: [event: DragEvent, tab: BrowserTabState]
  tabDrop: [event: DragEvent, tab: BrowserTabState]
  tabDragend: []
  toggleMuted: [tab: BrowserTabState]
  close: [tabId: string]
  stopWorkerCapture: [tabId: string]
}>()

const { t } = useI18n({ useScope: 'global' })
// Each of these is worked out again for each new browser state, and the row draws again only when one comes out
// different: a tab that did not change is the same object, and its name the same text.
const tab = computed(() => props.readTab(props.tabId))
const label = computed(() => tab.value ? props.tabLabel(tab.value) : '')
const emulationDescription = computed(() => tab.value?.emulation ? props.describeEmulation(tab.value) : undefined)
const agentCommand = computed(() => props.readAgentCommand(props.tabId))
/** Why an agent needs you, or that one is working, on this tab. */
const agentNote = computed(() => props.attention ?? (agentCommand.value !== undefined ? t('tabSearch.meta.agent') : undefined))
const tooltip = computed(() => agentNote.value !== undefined ? `${label.value}\n\n${agentNote.value}` : label.value)
const networkUnconfirmed = computed(() => Boolean(tab.value?.networkConditionState && tab.value.networkConditionState.application !== 'confirmed'))

/** A press on the tab chooses it, but not one on its mute or close control, which act on their click alone. */
function press(event: PointerEvent): void {
  if (!(event.target instanceof Element && event.target.closest('.tab-audio, .tab-close'))) emit('select', props.tabId, event)
}
</script>

<template>
  <!-- A closed tab's row goes in the same draw as the strip's, and reads no tab meanwhile. -->
  <template v-if="tab">
  <UiButton appearance="application"
    class="tab"
    :class="{
      active,
      selected,
      pinned: tab.pinned,
      sleeping: tab.sleeping,
      frozen: tab.pageLifecycleState === 'frozen',
      grouped: Boolean(tab.mcpGroupId),
      dragging,
      'drop-before': dropPlacement === 'before',
      'drop-after': dropPlacement === 'after',
      'drop-onto': dropPlacement === 'onto',
      locked: tab.humanInteractionInputLocked ?? (allHumanInteractionLocked || tab.humanInteractionLocked),
      'split-visible': splitOrientation !== undefined && !splitPaired,
      'mcp-active': agentCommand !== undefined,
      'needs-attention': attention !== undefined
    }"
    :style="groupColor ? { '--tab-group-color': groupColor } : undefined"
    v-tooltip="tooltip"
    :data-mcp-command="agentCommand"
    :aria-label="label"
    :aria-description="agentNote"
    type="button"
    role="tab"
    :tabindex="keyboardIndex"
    :aria-keyshortcuts="tab.audible || tab.muted ? 'Delete M' : 'Delete'"
    :data-tab-id="tab.id"
    draggable="true"
    :aria-selected="active || selected === true"
    :aria-current="active && selected ? 'page' : undefined"
    :data-active-tab="active ? 'true' : undefined"
    @focus="emit('focused', tab.id)"
    @keydown="emit('tabKeydown', $event, tab)"
    @pointerdown="press"
    @click="emit('select', tab.id, $event)"
    @auxclick="emit('tabAuxclick', $event, tab)"
    @contextmenu.prevent="emit('contextMenu', tab.id)"
    @dragstart="emit('tabDragstart', $event, tab)"
    @dragenter="emit('tabDragenter', $event, tab)"
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
    <IconHorizontalSplit
      v-if="splitOrientation === 'horizontal'"
      class="tab-split-mark"
      :class="{ paired: splitPaired }"
      :aria-label="t(splitPaired ? 'shell.tabs.stackedPaired' : 'shell.tabs.stackedVisible')"
    />
    <IconVerticalSplit
      v-else-if="splitOrientation === 'vertical'"
      class="tab-split-mark"
      :class="{ paired: splitPaired }"
      :aria-label="t(splitPaired ? 'shell.tabs.sidePaired' : 'shell.tabs.sideVisible')"
    />
    <IconSpeed v-if="tab.emulation" class="tab-emulation-mark" :aria-label="t('runtime.emulation.reset', { description: emulationDescription ?? '' })" />
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
</template>

<style scoped>
.tab-pwa-stop { flex-shrink: 0; width: 28px; }
</style>
