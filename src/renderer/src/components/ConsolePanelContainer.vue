<script setup lang="ts">
import { onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserTabState, PanelDock, SupportedLocale } from '../../../shared/types'
import { useConsoleController } from '../composables/useConsoleController'
import ConsolePanel from './ConsolePanel.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  copyText: (text: string) => Promise<boolean>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
  keepsSeparatePanelOpen: () => boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  state,
  messages,
  error,
  search,
  level,
  copied,
  copiedEntryKey,
  filteredMessages,
  messageCounts,
  eventCount,
  filteredEventCount,
  reset,
  refresh,
  copyEntry,
  copyAll,
  copyFiltered,
  dispose
} = useConsoleController({
  activeTab: toRef(props, 'activeTab'),
  open,
  browser: window.hronaut,
  translate: (message, parameters) => t(message, parameters ?? {}),
  copyText: props.copyText,
  keepsSeparatePanelOpen: props.keepsSeparatePanelOpen
})

defineExpose({ reset, refresh })
onBeforeUnmount(dispose)
</script>

<template>
  <ConsolePanel
    v-model:open="open"
    v-model:dock="dock"
    v-model:search="search"
    v-model:level="level"
    :state="state"
    :messages="messages"
    :filtered-messages="filteredMessages"
    :error="error"
    :copied="copied"
    :copied-entry-key="copiedEntryKey"
    :message-counts="messageCounts"
    :event-count="eventCount"
    :filtered-event-count="filteredEventCount"
    :preserve-logs="activeTab?.preserveDiagnosticLogs ?? false"
    :preservation-busy="preservationBusy"
    :locale="locale"
    @preserve-change="updatePreservation"
    @clear="refresh(true)"
    @refresh="refresh()"
    @copy-entry="copyEntry"
    @copy-all="copyAll"
    @copy-filtered="copyFiltered"
  />
</template>
