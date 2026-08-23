<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import type { DownloadSettingsController } from '../composables/useDownloadSettingsController'

const props = defineProps<{
  controller: DownloadSettingsController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  settings,
  state,
  message,
  busy,
  effectiveDirectory,
  chooseDirectory,
  setAskWhereToSave,
  openDirectory
} = props.controller

async function changeAskWhereToSave(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setAskWhereToSave(input.checked))) {
    input.checked = settings.value.askWhereToSaveDownloads
  }
}
</script>

<template>
  <main class="settings-content downloads-settings">
    <div class="setting-copy">
      <h3>{{ t('settings.downloads.heading') }}</h3>
      <p>{{ t('settings.downloads.description') }}</p>
    </div>
    <div class="settings-rows">
      <div class="settings-row download-location-row">
        <span class="download-location-copy">
          <strong>{{ t('settings.downloads.location') }}</strong>
          <code :title="effectiveDirectory">{{ effectiveDirectory }}</code>
        </span>
        <div class="download-location-actions">
          <button class="secondary-button" type="button" :disabled="busy" @click="chooseDirectory">
            {{ t('settings.downloads.change') }}
          </button>
          <button class="secondary-button" type="button" :disabled="busy" @click="openDirectory">
            <IconFolderOpen aria-hidden="true" />
            {{ t('settings.downloads.open') }}
          </button>
        </div>
      </div>
      <label class="settings-row" for="setting-ask-download-location">
        <span>
          <strong>{{ t('settings.downloads.ask') }}</strong>
          <small>{{ t('settings.downloads.askDescription') }}</small>
        </span>
        <input
          id="setting-ask-download-location"
          type="checkbox"
          :checked="settings.askWhereToSaveDownloads"
          :disabled="busy"
          @change="changeAskWhereToSave"
        />
      </label>
    </div>
    <output class="download-settings-status" :class="state" aria-live="polite">{{ message }}</output>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.downloads.help') }}</p>
    </div>
  </main>
</template>
