<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconDownloadDone from '~icons/material-symbols/download-done-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconKeyboardCommandKey from '~icons/material-symbols/keyboard-command-key-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconLockOpen from '~icons/material-symbols/lock-open-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconSettings from '~icons/material-symbols/settings-rounded'
import IconTabSearch from '~icons/material-symbols/tab-search-rounded'
import IconVisibility from '~icons/material-symbols/visibility-rounded'
import type { AppUpdateState, BrowserDownloadState } from '../../../shared/types.js'
import type { McpStatusController } from '../composables/useMcpStatusController.js'
import McpStatusControls from './McpStatusControls.vue'
import UpdateNotification from './UpdateNotification.vue'

defineProps<{
  commandPaletteOpen: boolean
  tabSearchOpen: boolean
  downloadsOpen: boolean
  historyOpen: boolean
  settingsOpen: boolean
  downloads: BrowserDownloadState[]
  activeDownloads: BrowserDownloadState[]
  downloadButtonLabel: string
  allInteractionLocked: boolean
  allInteractionLockLabel: string
  followAgentActivity: boolean
  showUpdateStatus: boolean
  updateState: AppUpdateState
  mcpStatusController: McpStatusController
}>()

const emit = defineEmits<{
  toggleCommandPalette: []
  toggleTabSearch: []
  toggleDownloads: []
  toggleHistory: []
  toggleAllInteraction: []
  toggleFollowAgentActivity: []
  openUpdateSettings: []
  toggleSettings: []
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div class="topbar-actions">
    <button
      class="topbar-icon-button command-palette-button"
      type="button"
      :title="t('shell.actions.commandsTitle')"
      :aria-label="t('shell.actions.commands')"
      aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
      :aria-expanded="commandPaletteOpen"
      @click="emit('toggleCommandPalette')"
    >
      <IconKeyboardCommandKey aria-hidden="true" />
    </button>
    <button
      class="topbar-icon-button tab-search-button"
      type="button"
      :title="t('shell.actions.searchTabsTitle')"
      :aria-label="t('shell.actions.searchTabs')"
      aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
      :aria-expanded="tabSearchOpen"
      @click="emit('toggleTabSearch')"
    >
      <IconTabSearch aria-hidden="true" />
    </button>
    <button
      class="topbar-icon-button downloads-button"
      :class="{ active: activeDownloads.length, complete: !activeDownloads.length && downloads[0]?.state === 'completed' }"
      type="button"
      :title="downloadButtonLabel"
      :aria-label="downloadButtonLabel"
      :aria-expanded="downloadsOpen"
      @click="emit('toggleDownloads')"
    >
      <IconProgress v-if="activeDownloads.length" class="state-spinner" aria-hidden="true" />
      <IconDownloadDone v-else-if="downloads[0]?.state === 'completed'" aria-hidden="true" />
      <IconDownload v-else aria-hidden="true" />
      <span v-if="downloads.length" class="downloads-badge" aria-hidden="true">{{ Math.min(downloads.length, 99) }}</span>
    </button>
    <button
      class="topbar-icon-button history-button"
      type="button"
      :title="t('shell.actions.historyTitle')"
      :aria-label="t('shell.actions.history')"
      aria-keyshortcuts="Control+H Meta+Y"
      :aria-expanded="historyOpen"
      @click="emit('toggleHistory')"
    >
      <IconHistory aria-hidden="true" />
    </button>
    <span class="topbar-actions-divider" aria-hidden="true" />
    <button
      class="browser-lock-button all-lock-button"
      :class="{ locked: allInteractionLocked }"
      type="button"
      :title="allInteractionLockLabel"
      :aria-label="allInteractionLockLabel"
      :aria-pressed="allInteractionLocked"
      @click="emit('toggleAllInteraction')"
    >
      <IconLock v-if="allInteractionLocked" aria-hidden="true" />
      <IconLockOpen v-else aria-hidden="true" />
      {{ allInteractionLocked ? t('shell.tabs.locked') : t('shell.tabs.lock') }}
    </button>
    <button
      class="browser-lock-button follow-agent-button"
      :class="{ active: followAgentActivity }"
      type="button"
      :title="t(followAgentActivity ? 'shell.actions.stopFollowingAgentActivityDescription' : 'shell.actions.followAgentActivityDescription')"
      :aria-label="t(followAgentActivity ? 'shell.actions.stopFollowingAgentActivityDescription' : 'shell.actions.followAgentActivityDescription')"
      :aria-pressed="followAgentActivity"
      @click="emit('toggleFollowAgentActivity')"
    >
      <IconVisibility aria-hidden="true" />
      {{ t(followAgentActivity ? 'shell.actions.followingAgents' : 'shell.actions.followAgents') }}
    </button>
    <UpdateNotification
      v-if="showUpdateStatus"
      mode="pill"
      :state="updateState"
      @open="emit('openUpdateSettings')"
    />
    <McpStatusControls :controller="mcpStatusController" />
    <button
      class="topbar-icon-button settings-button"
      type="button"
      :title="t('shell.actions.settings')"
      :aria-label="t('shell.actions.settings')"
      :aria-expanded="settingsOpen"
      @click="emit('toggleSettings')"
    >
      <IconSettings aria-hidden="true" />
    </button>
  </div>
</template>
