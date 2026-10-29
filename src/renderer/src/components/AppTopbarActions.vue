<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconDownloadDone from '~icons/material-symbols/download-done-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import IconKeyboardCommandKey from '~icons/material-symbols/keyboard-command-key-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconLockOpen from '~icons/material-symbols/lock-open-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconSettings from '~icons/material-symbols/settings-rounded'
import IconTabSearch from '~icons/material-symbols/tab-search-rounded'
import IconVisibility from '~icons/material-symbols/visibility-rounded'
import IconVolumeOff from '~icons/material-symbols/volume-off-rounded'
import IconVolumeUp from '~icons/material-symbols/volume-up-rounded'
import type { AppUpdateState, BrowserDownloadState } from '../../../shared/types.js'
import type { McpStatusControlsController } from '../features/mcp/useMcpStatusController.js'
import McpStatusControls from '../features/mcp/McpStatusControls.vue'
import UpdateNotification from '../features/updates/UpdateNotification.vue'
import { vTooltip } from '../ui/tooltip.js'
import { ignoreHeldEnter } from '../held-enter.js'

const props = defineProps<{
  interactionPending?: boolean
  audioPending?: boolean
  commandPaletteOpen: boolean
  tabSearchOpen: boolean
  downloadsOpen: boolean
  historyOpen: boolean
  settingsOpen: boolean
  downloads: BrowserDownloadState[]
  activeDownloads: BrowserDownloadState[]
  downloadButtonLabel: string
  hasWebsiteTabs: boolean
  allTabsMuted: boolean
  allInteractionLocked: boolean
  allInteractionLockLabel: string
  followAgentActivity: boolean
  showUpdateStatus: boolean
  /** Agent access has ended and the license card under the toolbar was closed. */
  licenseReminderShown?: boolean
  updateState: AppUpdateState
  mcpStatusController: McpStatusControlsController
}>()

const emit = defineEmits<{
  toggleCommandPalette: []
  toggleTabSearch: []
  toggleDownloads: []
  toggleHistory: []
  toggleAllTabsMuted: []
  toggleAllInteraction: []
  toggleFollowAgentActivity: []
  openUpdateSettings: []
  openLicenseSettings: []
  toggleSettings: []
}>()

const { t } = useI18n({ useScope: 'global' })

const licenseReminder = ref<{ focus: () => void } | null>(null)
// The reminder appears when Not now closes the license card, which takes the focused button with it. The reminder
// takes the focus instead, so that the next Tab does not start from nowhere; it ignores a held Enter's repeats.
watch(() => props.licenseReminderShown, (shown) => {
  if (shown && document.activeElement === document.body && document.hasFocus()) licenseReminder.value?.focus()
}, { flush: 'post' })
</script>

<template>
  <div class="topbar-actions">
    <UiButton appearance="application"
      class="topbar-icon-button command-palette-button"
      type="button"
      v-tooltip="t('shell.actions.commandsTitle')"
      :aria-label="t('shell.actions.commands')"
      aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
      :aria-expanded="commandPaletteOpen"
      @keydown="ignoreHeldEnter"
      @click="emit('toggleCommandPalette')"
    >
      <IconKeyboardCommandKey aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button tab-search-button"
      type="button"
      v-tooltip="t('shell.actions.searchTabsTitle')"
      :aria-label="t('shell.actions.searchTabs')"
      aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
      :aria-expanded="tabSearchOpen"
      @keydown="ignoreHeldEnter"
      @click="emit('toggleTabSearch')"
    >
      <IconTabSearch aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button downloads-button"
      :class="{ active: activeDownloads.length, complete: !activeDownloads.length && downloads[0]?.state === 'completed' && !downloads[0].fileRemoved }"
      type="button"
      v-tooltip="downloadButtonLabel"
      :aria-label="downloadButtonLabel"
      :aria-expanded="downloadsOpen"
      @click="emit('toggleDownloads')"
    >
      <IconProgress v-if="activeDownloads.length" class="state-spinner" aria-hidden="true" />
      <IconDownloadDone v-else-if="downloads[0]?.state === 'completed' && !downloads[0].fileRemoved" aria-hidden="true" />
      <IconDownload v-else aria-hidden="true" />
      <span v-if="downloads.length" class="downloads-badge" aria-hidden="true">{{ Math.min(downloads.length, 99) }}</span>
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button history-button"
      type="button"
      v-tooltip="t('shell.actions.historyTitle')"
      :aria-label="t('shell.actions.history')"
      aria-keyshortcuts="Control+H Meta+Y"
      :aria-expanded="historyOpen"
      @click="emit('toggleHistory')"
    >
      <IconHistory aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button browser-lock-button all-lock-button"
      :class="{ locked: allInteractionLocked }"
      :aria-busy="Boolean(interactionPending)"
      :disabled="interactionPending"
      type="button"
      v-tooltip="interactionPending ? t('runtime.locks.waiting') : allInteractionLockLabel"
      :aria-label="interactionPending ? t('runtime.locks.waiting') + ': ' + (allInteractionLockLabel) : allInteractionLockLabel"
      :aria-pressed="allInteractionLocked"
      @click="emit('toggleAllInteraction')"
    >
      <IconProgress v-if="interactionPending" class="state-spinner" aria-hidden="true" />
      <IconLock v-else-if="allInteractionLocked" aria-hidden="true" />
      <IconLockOpen v-else aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button all-tabs-audio-button"
      :class="{ active: allTabsMuted }"
      :aria-busy="Boolean(audioPending)"
      :disabled="audioPending"
      type="button"
      v-tooltip="audioPending ? t('runtime.locks.waiting') : t(allTabsMuted ? 'shell.actions.unmuteAllTabs' : 'shell.actions.muteAllTabs')"
      :aria-label="audioPending ? t('runtime.locks.waiting') + ': ' + (t(allTabsMuted ? 'shell.actions.unmuteAllTabs' : 'shell.actions.muteAllTabs')) : t(allTabsMuted ? 'shell.actions.unmuteAllTabs' : 'shell.actions.muteAllTabs')"
      :aria-pressed="allTabsMuted"
      @click="emit('toggleAllTabsMuted')"
    >
      <IconProgress v-if="audioPending" class="state-spinner" aria-hidden="true" />
      <IconVolumeOff v-else-if="allTabsMuted" aria-hidden="true" />
      <IconVolumeUp v-else aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      class="topbar-icon-button browser-lock-button follow-agent-button"
      :class="{ active: followAgentActivity }"
      type="button"
      v-tooltip="t(followAgentActivity ? 'shell.actions.stopFollowingAgentActivityDescription' : 'shell.actions.followAgentActivityDescription')"
      :aria-label="t(followAgentActivity ? 'shell.actions.stopFollowingAgentActivityDescription' : 'shell.actions.followAgentActivityDescription')"
      :aria-pressed="followAgentActivity"
      @click="emit('toggleFollowAgentActivity')"
    >
      <IconVisibility aria-hidden="true" />
    </UiButton>
    <McpStatusControls :controller="mcpStatusController" />
    <UiButton appearance="application"
      class="topbar-icon-button settings-button"
      type="button"
      v-tooltip="t('shell.actions.settings')"
      :aria-label="t('shell.actions.settings')"
      :aria-pressed="settingsOpen"
      :aria-controls="settingsOpen ? 'settings-page' : undefined"
      :class="{ active: settingsOpen }"
      @click="emit('toggleSettings')"
    >
      <IconSettings aria-hidden="true" />
    </UiButton>
    <UpdateNotification
      v-if="showUpdateStatus"
      mode="pill"
      :state="updateState"
      @open="emit('openUpdateSettings')"
    />
    <UiButton appearance="application"
      v-if="licenseReminderShown"
      ref="licenseReminder"
      class="license-reminder-pill"
      type="button"
      v-tooltip="t('licenseNotice.reminderTitle')"
      @keydown="ignoreHeldEnter"
      @click="emit('openLicenseSettings')"
    >
      <IconKey aria-hidden="true" />
      <span class="license-reminder-label">{{ t('licenseNotice.reminder') }}</span>
    </UiButton>
  </div>
</template>
