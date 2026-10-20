<script setup lang="ts">
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import UiButton from "../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconRemove from '~icons/material-symbols/remove-rounded'
import IconZoomIn from '~icons/material-symbols/zoom-in-rounded'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../shared/types.js'
import { vTooltip } from '../ui/tooltip.js'

type ZoomBrowserApi = Pick<HronautApi, 'setZoom'>
type ZoomAction = 'in' | 'out' | 'reset'

const props = defineProps<{
  activeTab?: BrowserTabState
  browser: ZoomBrowserApi
  acceptState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  formatPercent: (percent: number) => string
}>()

const emit = defineEmits<{
  error: [cause: unknown]
}>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n({ useScope: 'global' })
const busy = ref(false)
let targetTabId: string | undefined
let disposed = false
let operationSequence = 0

function availableTab(): BrowserTabState | undefined {
  const tab = props.activeTab
  return tab && !isHronautHomeUrl(tab.url) ? tab : undefined
}

function close(): void {
  targetTabId = undefined
  open.value = false
}

function openForTab(tab: BrowserTabState | undefined = availableTab()): void {
  if (!tab || isHronautHomeUrl(tab.url)) return
  targetTabId = tab.id
  open.value = true
}

async function setZoom(action: ZoomAction): Promise<void> {
  const tab = availableTab()
  if (disposed || !tab || busy.value) return
  if (open.value && targetTabId && targetTabId !== tab.id) {
    close()
    return
  }
  const operation = ++operationSequence
  busy.value = true
  try {
    await props.acceptState(props.browser.setZoom({ tabId: tab.id, action }))
  } catch (error) {
    if (!disposed && operation === operationSequence) emit('error', error)
  } finally {
    if (!disposed && operation === operationSequence) busy.value = false
  }
}

const bar = ref<HTMLElement | null>(null)

/**
 * Every zoom control is disabled while a change applies, so Chromium moves the focus of the one you used to the
 * document body. Give it back once that control is enabled again, or to the bar itself when it stays disabled, such as
 * Reset at 100%, unless you moved it meanwhile or the bar closed. Not to another control: a held Enter would run it.
 */
async function zoomFromControl(action: ZoomAction): Promise<void> {
  const group = bar.value
  const active = document.activeElement
  const focused = active instanceof HTMLElement && group?.contains(active) ? active : null
  await setZoom(action)
  await nextTick()
  if (!focused || !group || !open.value || group !== bar.value || !group.isConnected || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = focused.isConnected && !focused.matches(':disabled') ? focused : group
  target.focus()
}

// Escape typed anywhere in the bar closes Zoom itself, not the first panel in the shell's Escape order, such as Site
// storage in its own window.
function handleBarKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  close()
}

watch(open, (isOpen) => {
  if (!isOpen) {
    targetTabId = undefined
    return
  }
  const tab = availableTab()
  if (!tab) close()
  else if (!targetTabId) targetTabId = tab.id
}, { immediate: true })

watch(() => props.activeTab?.id, () => {
  operationSequence += 1
  busy.value = false
}, { flush: 'sync' })

watch([() => props.activeTab?.id, () => props.activeTab?.url], ([tabId, url]) => {
  if (open.value && targetTabId && (tabId !== targetTabId || !url || isHronautHomeUrl(url))) close()
})

onBeforeUnmount(() => {
  disposed = true
  close()
})
defineExpose({ close, openForTab, setZoom })
</script>

<template>
  <div v-if="open" ref="bar" class="zoom-bar" tabindex="-1" role="group" :aria-label="t('zoom.controls')" :aria-busy="busy" @keydown="handleBarKeydown">
    <span>{{ t('zoom.heading') }}</span>
    <span v-if="activeTab?.zoomIsolated" class="zoom-isolated" data-testid="zoom-isolated">{{ t('zoom.isolated') }}</span>
    <span v-if="activeTab?.defaultFontSize" class="zoom-isolated" data-testid="zoom-default-font-size">{{ t('zoom.defaultFontSize', { size: activeTab.defaultFontSize }) }}</span>
    <UiButton appearance="application"
      type="button"
      v-tooltip="t('zoom.outTitle')"
      :aria-label="t('zoom.out')"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) <= 50"
      @click="zoomFromControl('out')"
    ><IconRemove aria-hidden="true" /></UiButton>
    <output aria-live="polite">{{ formatPercent(activeTab?.zoomPercent ?? 100) }}</output>
    <UiButton appearance="application"
      type="button"
      v-tooltip="t('zoom.inTitle')"
      :aria-label="t('zoom.in')"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) >= 400"
      @click="zoomFromControl('in')"
    ><IconZoomIn aria-hidden="true" /></UiButton>
    <UiButton appearance="application"
      class="zoom-reset"
      type="button"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) === 100"
      @click="zoomFromControl('reset')"
    >{{ t('zoom.reset') }}</UiButton>
    <UiButton appearance="application" type="button" v-tooltip="t('zoom.closeTitle')" :aria-label="t('zoom.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
  </div>
</template>
