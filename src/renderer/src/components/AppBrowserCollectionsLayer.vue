<script setup lang="ts">
import type {
  BrowserBookmark,
  PanelDock
} from '../../../shared/types.js'
import type { AppBrowserCollectionsFeatureController } from '../composables/useAppBrowserCollectionsFeatureController.js'
import BookmarksPanel from './BookmarksPanel.vue'
import DownloadsPanel from './DownloadsPanel.vue'
import HistoryPanel from './HistoryPanel.vue'

const props = defineProps<{
  controller: AppBrowserCollectionsFeatureController
  activeUrl: string | null
  activeTitle: string
  currentBookmark?: BrowserBookmark
  formatBytes: (bytes: number) => string
  formatPercent: (percent: number) => string
  formatDateTime: (value: Date | number | string) => string
  formatNumber: (value: number) => string
}>()

const dock = defineModel<PanelDock>('dock', { required: true })
const {
  browserCollectionsController,
  downloads,
  bookmarks,
  visitHistory,
  downloadsOpen,
  bookmarksOpen,
  bookmarksPanel,
  historyOpen,
  historyPanel,
  openBookmark,
  openBookmarkInBackground,
  openHistoryEntry,
  openHistoryEntryInBackground,
  copyHistoryAddress,
  copyBookmarkAddress
} = props.controller
</script>

<template>
  <DownloadsPanel
    v-model:open="downloadsOpen"
    v-model:downloads="downloads"
    :format-bytes="formatBytes"
    :format-percent="formatPercent"
    :pause-download="browserCollectionsController.pauseDownload"
    :resume-download="browserCollectionsController.resumeDownload"
    :cancel-download="browserCollectionsController.cancelDownload"
    :remove-finished="browserCollectionsController.removeFinishedDownload"
    :clear-finished="browserCollectionsController.clearFinishedDownloads"
    :show-in-folder="browserCollectionsController.revealDownload"
  />
  <BookmarksPanel
    ref="bookmarksPanel"
    v-model:open="bookmarksOpen"
    v-model:bookmarks="bookmarks"
    v-model:dock="dock"
    :collections-api="controller.bookmarkCollectionsApi"
    :active-url="activeUrl"
    :active-title="activeTitle"
    :current-bookmark="currentBookmark"
    :list-bookmarks="browserCollectionsController.refreshBookmarks"
    :add-bookmark="browserCollectionsController.addBookmark"
    :rename-bookmark="browserCollectionsController.renameBookmark"
    :update-bookmark-destination="browserCollectionsController.updateBookmarkDestination"
    :remove-bookmark="browserCollectionsController.removeBookmark"
    :open-bookmark="openBookmark"
    :copy-bookmark-address="copyBookmarkAddress"
    :open-bookmark-in-background="openBookmarkInBackground"
  />
  <HistoryPanel
    ref="historyPanel"
    v-model:open="historyOpen"
    v-model:entries="visitHistory"
    :format-date-time="formatDateTime"
    :format-number="formatNumber"
    :bookmarks="bookmarks"
    :save-history-bookmark="browserCollectionsController.saveHistoryBookmark"
    :list-history="browserCollectionsController.refreshHistory"
    :remove-history-entry="browserCollectionsController.removeHistoryEntry"
    :clear-history="browserCollectionsController.clearHistory"
    :open-history-entry="openHistoryEntry"
    :open-history-entry-in-background="openHistoryEntryInBackground"
    :copy-history-address="copyHistoryAddress"
  />
</template>
