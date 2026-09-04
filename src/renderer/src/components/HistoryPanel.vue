<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { BrowserHistoryEntry } from '../../../shared/types.js'
import { useHistoryPanelController } from '../composables/useHistoryPanelController.js'

const props = defineProps<{
  formatDateTime: (value: Date | number | string) => string
  formatNumber: (value: number) => string
  listHistory: () => Promise<BrowserHistoryEntry[]>
  removeHistoryEntry: (id: string) => Promise<BrowserHistoryEntry[]>
  clearHistory: () => Promise<BrowserHistoryEntry[]>
  openHistoryEntry: (entry: BrowserHistoryEntry) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const entries = defineModel<BrowserHistoryEntry[]>('entries', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  query,
  error,
  pendingAction,
  filteredEntries,
  toggle,
  openEntry,
  remove,
  clear,
  entryMeta,
  dispose
} = useHistoryPanelController({
  open,
  entries,
  translate: (key, parameters, plural) => plural === undefined
    ? t(key, parameters ?? {})
    : t(key, parameters ?? {}, plural),
  formatDateTime: props.formatDateTime,
  formatNumber: props.formatNumber,
  listHistory: props.listHistory,
  removeHistoryEntry: props.removeHistoryEntry,
  clearHistory: props.clearHistory,
  openHistoryEntry: props.openHistoryEntry,
  confirmClear: () => window.confirm(t('privacyActions.clearHistory'))
})

defineExpose({ toggle })
onBeforeUnmount(dispose)
</script>

<template>
  <section
    v-if="open"
    class="history-panel"
    data-shell-side-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="history-title"
    :aria-busy="pendingAction !== null"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('history.kicker') }}</span>
        <h2 id="history-title">{{ t('history.heading') }}</h2>
      </div>
      <div class="history-header-actions">
        <UiButton native type="button" :disabled="!entries.length || pendingAction !== null" @click="clear">{{ t('history.clearAll') }}</UiButton>
        <UiButton native class="panel-close" type="button" :aria-label="t('history.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="entries.length" class="history-search-field">
      <IconSearch aria-hidden="true" />
      <input v-model="query" type="search" :aria-label="t('history.search')" autocomplete="off" spellcheck="false" :placeholder="t('history.placeholder')" />
    </div>
    <div v-if="!entries.length" class="history-empty">
      <IconHistory aria-hidden="true" />
      <strong>{{ t('history.empty') }}</strong>
      <span>{{ t('history.emptyDescription') }}</span>
    </div>
    <div v-else-if="!filteredEntries.length" class="history-empty compact">
      <IconSearch aria-hidden="true" />
      <strong>{{ t('history.noMatches') }}</strong>
      <span>{{ t('history.tryAnother') }}</span>
    </div>
    <div v-else class="history-list">
      <article v-for="entry in filteredEntries" :key="entry.id" class="history-item">
        <UiButton native class="history-open" type="button" :title="entry.url" :disabled="pendingAction !== null" @click="openEntry(entry)">
          <span class="history-site-icon" aria-hidden="true"><IconLanguage /></span>
          <span class="history-copy">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.url }}</span>
            <small>{{ entryMeta(entry) }}</small>
          </span>
        </UiButton>
        <UiButton native class="history-action danger" type="button" :disabled="pendingAction !== null" :aria-label="t('history.removeAria', { title: entry.title })" :title="t('history.remove')" @click="remove(entry.id)"><IconDelete aria-hidden="true" /></UiButton>
      </article>
    </div>
    <p class="history-retention"><IconPrivacy aria-hidden="true" /> {{ t('history.retention') }}</p>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
  </section>
</template>
