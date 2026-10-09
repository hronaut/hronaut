<script setup lang="ts">
import { isActiveDownload } from '../../../shared/download-state.js'
import UiButton from "../ui/UiButton.vue"
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconDownloadDone from '~icons/material-symbols/download-done-rounded'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconPause from '~icons/material-symbols/pause-rounded'
import IconResume from '~icons/material-symbols/play-arrow-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import type { BrowserDownloadState } from '../../../shared/types.js'
import { useDownloadsPanelController } from '../composables/useDownloadsPanelController.js'

const props = defineProps<{
  formatBytes: (bytes: number) => string
  formatPercent: (percent: number) => string
  pauseDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  resumeDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  cancelDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  removeFinished: (downloadId: string) => Promise<BrowserDownloadState[]>
  clearFinished: () => Promise<BrowserDownloadState[]>
  showInFolder: (downloadId: string) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const downloads = defineModel<BrowserDownloadState[]>('downloads', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  query,
  statusFilter,
  filteredDownloads,
  error,
  pendingAction,
  finishedDownloads,
  downloadProgress,
  downloadMeta,
  pause,
  resume,
  cancel,
  remove,
  clear,
  reveal,
  dispose
} = useDownloadsPanelController({
  open,
  downloads,
  translate: (key, parameters) => t(key, parameters ?? {}),
  formatBytes: props.formatBytes,
  formatPercent: props.formatPercent,
  pauseDownload: props.pauseDownload,
  resumeDownload: props.resumeDownload,
  cancelDownload: props.cancelDownload,
  removeFinished: props.removeFinished,
  clearFinished: props.clearFinished,
  showInFolder: props.showInFolder
})

let removalFocusRow: Element | null = null
let focusGeneration = 0
const stopFocusSessionTracking = watch([open, query, statusFilter], () => { focusGeneration += 1 }, { flush: 'sync' })

async function changeTransfer(action: 'pause' | 'resume' | 'cancel' | 'remove', downloadId: string, event: MouseEvent): Promise<void> {
  const generation = focusGeneration
  const focused = event.currentTarget instanceof HTMLButtonElement
    && document.activeElement === event.currentTarget ? event.currentTarget : null
  const row = focused?.closest('.download-item')
  const panel = row?.closest('.downloads-panel')
  const next = action === 'remove' ? row?.nextElementSibling?.querySelector<HTMLButtonElement>('.download-remove') : null
  const previous = action === 'remove' ? row?.previousElementSibling?.querySelector<HTMLButtonElement>('.download-remove') : null
  // A published removal can arrive before its reply enables the other controls.
  // Leave this action responsible for focus instead of the live-list watcher.
  if (action === 'remove' && row) removalFocusRow = row
  try {
    await (action === 'pause' ? pause(downloadId) : action === 'resume' ? resume(downloadId) : action === 'remove' ? remove(downloadId) : cancel(downloadId))
    await nextTick()
  } finally {
    if (removalFocusRow === row) removalFocusRow = null
  }
  if (generation !== focusGeneration || !open.value || !panel?.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = [focused, row?.querySelector<HTMLButtonElement>('.download-action'), next, previous,
    !row?.isConnected ? panel.querySelector<HTMLInputElement>('.downloads-filters input') : null,
    panel.querySelector<HTMLButtonElement>('.panel-close')
  ].find(element => element?.isConnected && !element.matches(':disabled'))
  target?.focus()
}

// A live status update can remove a focused row from the active filter even
// when no panel action is pending. Capture focus before Vue removes the row.
const stopVisibleTracking = watch(() => filteredDownloads.value.map(download => download.id), async () => {
  const focused = document.activeElement
  const row = focused instanceof HTMLElement ? focused.closest('.download-item') : null
  const panel = row?.closest('.downloads-panel')
  if (!row || !panel || row === removalFocusRow) return
  await nextTick()
  if (!open.value || !panel.isConnected || row.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = panel.querySelector<HTMLInputElement>('.downloads-filters input')
    ?? panel.querySelector<HTMLButtonElement>('.panel-close')
  target?.focus()
}, { flush: 'pre' })

async function clearDownloads(event: MouseEvent): Promise<void> {
  const focused = event.currentTarget instanceof HTMLButtonElement
    && document.activeElement === event.currentTarget ? event.currentTarget : null
  const panel = focused?.closest('.downloads-panel')
  await clear()
  await nextTick()
  if (!open.value || !panel?.isConnected || !focused?.disabled) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  const target = panel.querySelector<HTMLInputElement>('.downloads-filters input')
    ?? panel.querySelector<HTMLButtonElement>('.panel-close')
  target?.focus()
}

onBeforeUnmount(() => { focusGeneration += 1; stopFocusSessionTracking(); stopVisibleTracking(); dispose() })
</script>

<template>
  <section v-if="open" class="downloads-panel" data-shell-side-panel role="dialog" aria-modal="false" aria-labelledby="downloads-title">
    <header>
      <div>
        <span class="eyebrow">{{ t('downloads.kicker') }}</span>
        <h2 id="downloads-title">{{ t('downloads.heading') }}</h2>
      </div>
      <div class="downloads-header-actions">
        <UiButton appearance="application" type="button" :disabled="!finishedDownloads.length || pendingAction !== null" aria-describedby="downloads-clear-hint" @click="clearDownloads">{{ t('downloads.clearFinished') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('downloads.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="downloads.length" class="downloads-filters">
      <input v-model="query" type="search" :aria-label="t('downloads.search')" :placeholder="t('downloads.search')" autocomplete="off" spellcheck="false" />
      <select v-model="statusFilter" :aria-label="t('downloads.filterStatus')">
        <option value="all">{{ t('downloads.filterAll') }}</option>
        <option value="active">{{ t('downloads.filterActive') }}</option>
        <option value="finished">{{ t('downloads.filterFinished') }}</option>
      </select>
    </div>
    <p v-if="downloads.length" class="downloads-filter-summary" role="status">{{ t('downloads.filterSummary', { visible: filteredDownloads.length, total: downloads.length }) }}</p>
    <p id="downloads-clear-hint" class="downloads-filter-summary">{{ t('downloads.clearFinishedHint') }}</p>
    <div v-if="!downloads.length" class="downloads-empty">
      <IconDownload aria-hidden="true" />
      <strong>{{ t('downloads.empty') }}</strong>
      <span>{{ t('downloads.emptyDescription') }}</span>
    </div>
    <div v-else-if="!filteredDownloads.length" class="downloads-empty">
      <IconDownload aria-hidden="true" />
      <strong>{{ t('downloads.noMatches') }}</strong>
      <span>{{ t('downloads.changeFilters') }}</span>
    </div>
    <div v-else class="downloads-list">
      <article v-for="download in filteredDownloads" :key="download.id" class="download-item" :class="[download.state, { paused: download.paused }]">
        <span class="download-state-icon" aria-hidden="true">
          <IconPause v-if="download.paused" />
          <IconProgress v-else-if="download.state === 'progressing'" class="state-spinner" />
          <IconDownloadDone v-else-if="download.state === 'completed'" />
          <IconWarning v-else />
        </span>
        <div class="download-copy">
          <strong :title="download.filename">{{ download.filename }}</strong>
          <span>{{ downloadMeta(download) }}</span>
          <div v-if="download.state === 'progressing'" class="download-progress" role="progressbar" :aria-label="t('downloads.downloading', { filename: download.filename })" :aria-valuenow="download.totalBytes > 0 ? downloadProgress(download) : undefined" aria-valuemin="0" aria-valuemax="100">
            <span :class="{ indeterminate: download.totalBytes <= 0 }" :style="download.totalBytes > 0 ? { width: `${downloadProgress(download)}%` } : undefined" />
          </div>
        </div>
        <div v-if="isActiveDownload(download)" class="download-actions">
          <!-- Keep the focused control mounted when native state changes after the action reply. -->
          <UiButton
            v-if="download.canResume || (download.state === 'progressing' && !download.paused)"
            appearance="application"
            class="download-action"
            type="button"
            :disabled="pendingAction !== null"
            :aria-label="t(download.canResume ? 'downloads.resumeAria' : 'downloads.pauseAria', { filename: download.filename })"
            :title="t(download.canResume ? 'downloads.resume' : 'downloads.pause')"
            @click="changeTransfer(download.canResume ? 'resume' : 'pause', download.id, $event)"
          ><IconResume v-if="download.canResume" aria-hidden="true" /><IconPause v-else aria-hidden="true" /></UiButton>
        <UiButton appearance="application" class="download-action" type="button" :disabled="pendingAction !== null" :aria-label="t('downloads.cancelAria', { filename: download.filename })" :title="t('downloads.cancel')" @click="changeTransfer('cancel', download.id, $event)"><IconClose aria-hidden="true" /></UiButton>
        </div>
        <div v-else class="download-actions">
          <UiButton appearance="application" v-if="download.state === 'completed'" class="download-action" type="button" :disabled="pendingAction !== null" :aria-label="t('downloads.showAria', { filename: download.filename })" :title="t('downloads.show')" @click="reveal(download.id)"><IconFolderOpen aria-hidden="true" /></UiButton>
          <UiButton appearance="application" class="download-action download-remove" type="button" :disabled="pendingAction !== null" :aria-label="t('downloads.removeAria', { filename: download.filename })" :title="t('downloads.removeHint')" @click="changeTransfer('remove', download.id, $event)"><IconClose aria-hidden="true" /></UiButton>
        </div>
      </article>
    </div>
    <p v-if="error" class="downloads-error" role="alert">{{ error }}</p>
  </section>
</template>
