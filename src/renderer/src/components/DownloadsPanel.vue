<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconDownloadDone from '~icons/material-symbols/download-done-rounded'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import type { BrowserDownloadState } from '../../../shared/types.js'
import { useDownloadsPanelController } from '../composables/useDownloadsPanelController.js'

const props = defineProps<{
  formatBytes: (bytes: number) => string
  formatPercent: (percent: number) => string
  cancelDownload: (downloadId: string) => Promise<BrowserDownloadState[]>
  clearFinished: () => Promise<BrowserDownloadState[]>
  showInFolder: (downloadId: string) => Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const downloads = defineModel<BrowserDownloadState[]>('downloads', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  error,
  pendingAction,
  finishedDownloads,
  downloadProgress,
  downloadMeta,
  cancel,
  clear,
  reveal,
  dispose
} = useDownloadsPanelController({
  open,
  downloads,
  translate: (key, parameters) => t(key, parameters ?? {}),
  formatBytes: props.formatBytes,
  formatPercent: props.formatPercent,
  cancelDownload: props.cancelDownload,
  clearFinished: props.clearFinished,
  showInFolder: props.showInFolder
})

onBeforeUnmount(dispose)
</script>

<template>
  <section v-if="open" class="downloads-panel" data-shell-side-panel role="dialog" aria-modal="false" aria-labelledby="downloads-title">
    <header>
      <div>
        <span class="eyebrow">{{ t('downloads.kicker') }}</span>
        <h2 id="downloads-title">{{ t('downloads.heading') }}</h2>
      </div>
      <div class="downloads-header-actions">
        <button type="button" :disabled="!finishedDownloads.length || pendingAction !== null" @click="clear">{{ t('downloads.clearFinished') }}</button>
        <button class="panel-close" type="button" :aria-label="t('downloads.close')" @click="open = false"><IconClose aria-hidden="true" /></button>
      </div>
    </header>
    <div v-if="!downloads.length" class="downloads-empty">
      <IconDownload aria-hidden="true" />
      <strong>{{ t('downloads.empty') }}</strong>
      <span>{{ t('downloads.emptyDescription') }}</span>
    </div>
    <div v-else class="downloads-list">
      <article v-for="download in downloads" :key="download.id" class="download-item" :class="download.state">
        <span class="download-state-icon" aria-hidden="true">
          <IconProgress v-if="download.state === 'progressing'" class="state-spinner" />
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
        <button v-if="download.state === 'progressing'" class="download-action" type="button" :disabled="pendingAction !== null" :aria-label="t('downloads.cancelAria', { filename: download.filename })" :title="t('downloads.cancel')" @click="cancel(download.id)"><IconClose aria-hidden="true" /></button>
        <button v-else-if="download.state === 'completed'" class="download-action" type="button" :disabled="pendingAction !== null" :aria-label="t('downloads.showAria', { filename: download.filename })" :title="t('downloads.show')" @click="reveal(download.id)"><IconFolderOpen aria-hidden="true" /></button>
      </article>
    </div>
    <p v-if="error" class="downloads-error" role="alert">{{ error }}</p>
  </section>
</template>
