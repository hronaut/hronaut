<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconRemove from '~icons/material-symbols/remove-rounded'
import IconZoomIn from '~icons/material-symbols/zoom-in-rounded'
import type { BrowserState, BrowserTabState, HronautApi } from '../../../shared/types.js'

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

function availableTab(): BrowserTabState | undefined {
  const tab = props.activeTab
  return tab && !tab.url.startsWith('hronaut://home') ? tab : undefined
}

function close(): void {
  targetTabId = undefined
  open.value = false
}

function openForTab(tab: BrowserTabState | undefined = availableTab()): void {
  if (!tab || tab.url.startsWith('hronaut://home')) return
  targetTabId = tab.id
  open.value = true
}

async function setZoom(action: ZoomAction): Promise<void> {
  const tab = availableTab()
  if (!tab || busy.value) return
  if (open.value && targetTabId && targetTabId !== tab.id) {
    close()
    return
  }
  busy.value = true
  try {
    await props.acceptState(props.browser.setZoom({ tabId: tab.id, action }))
  } catch (error) {
    if (!disposed) emit('error', error)
  } finally {
    if (!disposed) busy.value = false
  }
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

watch([() => props.activeTab?.id, () => props.activeTab?.url], ([tabId, url]) => {
  if (open.value && targetTabId && (tabId !== targetTabId || !url || url.startsWith('hronaut://home'))) close()
})

onBeforeUnmount(() => {
  disposed = true
  close()
})
defineExpose({ close, openForTab, setZoom })
</script>

<template>
  <div v-if="open" class="zoom-bar" role="group" :aria-label="t('zoom.controls')" :aria-busy="busy">
    <span>{{ t('zoom.heading') }}</span>
    <UiButton appearance="application"
      type="button"
      :title="t('zoom.outTitle')"
      :aria-label="t('zoom.out')"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) <= 50"
      @click="setZoom('out')"
    ><IconRemove aria-hidden="true" /></UiButton>
    <output aria-live="polite">{{ formatPercent(activeTab?.zoomPercent ?? 100) }}</output>
    <UiButton appearance="application"
      type="button"
      :title="t('zoom.inTitle')"
      :aria-label="t('zoom.in')"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) >= 300"
      @click="setZoom('in')"
    ><IconZoomIn aria-hidden="true" /></UiButton>
    <UiButton appearance="application"
      class="zoom-reset"
      type="button"
      :disabled="busy || (activeTab?.zoomPercent ?? 100) === 100"
      @click="setZoom('reset')"
    >{{ t('zoom.reset') }}</UiButton>
    <UiButton appearance="application" type="button" :title="t('zoom.closeTitle')" :aria-label="t('zoom.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
  </div>
</template>
