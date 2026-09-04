<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded'
import IconArrowForward from '~icons/material-symbols/arrow-forward-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconStar from '~icons/material-symbols/star-rounded'
import IconStarOutline from '~icons/material-symbols/star-outline-rounded'
import IconStop from '~icons/material-symbols/stop-rounded'
import type { BrowserTabState } from '../../../shared/types.js'

const props = defineProps<{
  activeTab?: BrowserTabState
  zoomOpen: boolean
  bookmarksOpen: boolean
  currentBookmark: boolean
  formatPercent: (value: number) => string
}>()

const emit = defineEmits<{
  back: []
  forward: []
  reload: []
  stop: []
  find: []
  toggleZoom: []
  toggleBookmarks: []
}>()

const { t } = useI18n({ useScope: 'global' })

function refreshOrStop(): void {
  if (props.activeTab?.loading) emit('stop')
  else emit('reload')
}
</script>

<template>
  <UiButton native class="icon-button" type="button" :title="t('shell.toolbar.back')" :aria-label="t('shell.toolbar.back')" :disabled="!activeTab?.canGoBack" @click="emit('back')"><IconArrowBack aria-hidden="true" /></UiButton>
  <UiButton native class="icon-button" type="button" :title="t('shell.toolbar.forward')" :aria-label="t('shell.toolbar.forward')" :disabled="!activeTab?.canGoForward" @click="emit('forward')"><IconArrowForward aria-hidden="true" /></UiButton>
  <UiButton native class="icon-button" type="button" :title="t(activeTab?.loading ? 'runtime.tabs.stop' : 'runtime.tabs.reload')" :aria-label="t(activeTab?.loading ? 'runtime.tabs.stop' : 'runtime.tabs.reload')" :disabled="!activeTab" @click="refreshOrStop">
    <IconStop v-if="activeTab?.loading" aria-hidden="true" />
    <IconRefresh v-else aria-hidden="true" />
  </UiButton>
  <slot />
  <UiButton native
    class="icon-button find-button"
    type="button"
    :title="t('shell.toolbar.findTitle')"
    :aria-label="t('shell.toolbar.find')"
    aria-keyshortcuts="Control+F Meta+F"
    :disabled="!activeTab"
    @click="emit('find')"
  >
    <IconSearch aria-hidden="true" />
  </UiButton>
  <UiButton native
    class="zoom-button"
    type="button"
    :title="t('runtime.address.zoom', { percent: formatPercent(activeTab?.zoomPercent ?? 100) })"
    :aria-label="t('shell.toolbar.zoom')"
    :aria-expanded="zoomOpen"
    :disabled="!activeTab"
    @click="emit('toggleZoom')"
  >
    {{ activeTab?.zoomPercent ?? 100 }}%
  </UiButton>
  <UiButton native
    class="icon-button bookmarks-button"
    :class="{ bookmarked: currentBookmark }"
    type="button"
    :title="t(currentBookmark ? 'runtime.tabs.bookmarkSaved' : 'runtime.tabs.bookmarkSave')"
    :aria-label="t('shell.toolbar.bookmarks')"
    aria-keyshortcuts="Control+D Meta+D"
    :aria-expanded="bookmarksOpen"
    :disabled="!activeTab"
    @click="emit('toggleBookmarks')"
  >
    <IconStar v-if="currentBookmark" aria-hidden="true" />
    <IconStarOutline v-else aria-hidden="true" />
  </UiButton>
</template>
