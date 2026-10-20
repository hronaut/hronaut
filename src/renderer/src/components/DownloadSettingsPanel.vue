<script setup lang="ts">
import { UiButton, UiCheckbox } from '../ui/index.js'
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import IconFolderOpen from '~icons/material-symbols/folder-open-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import type { DownloadSettingsController } from '../composables/useDownloadSettingsController'
import { vTooltip } from '../ui/tooltip.js'

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

/**
 * Every download control is disabled while one change runs, so Chromium moves the focus of the one you used to the
 * document body. Give it back once that control is enabled again, unless you moved it meanwhile.
 */
async function keepFocusThrough(event: Event, action: () => Promise<unknown>): Promise<void> {
  const control = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  const panel = control?.closest('.downloads-settings')
  await action()
  await nextTick()
  if (!control || !panel?.isConnected || !control.isConnected || control.matches(':disabled') || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== control) return
  control.focus()
}

async function changeAskWhereToSave(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await keepFocusThrough(event, async () => {
    if (!(await setAskWhereToSave(input.checked))) {
      input.checked = settings.value.askWhereToSaveDownloads
    }
  })
}
</script>

<template>
  <div class="settings-content downloads-settings">
    <div class="setting-copy">
      <h3>{{ t('settings.downloads.heading') }}</h3>
      <p>{{ t('settings.downloads.description') }}</p>
    </div>
    <div class="settings-rows">
      <div class="settings-row download-location-row">
        <span class="download-location-copy">
          <strong>{{ t('settings.downloads.location') }}</strong>
          <code v-tooltip="effectiveDirectory">{{ effectiveDirectory }}</code>
        </span>
        <div class="download-location-actions">
          <UiButton class="secondary-button" type="button" :disabled="busy" @click="keepFocusThrough($event, chooseDirectory)">
            {{ t('settings.downloads.change') }}
          </UiButton>
          <UiButton class="secondary-button" type="button" :disabled="busy" @click="keepFocusThrough($event, openDirectory)">
            <IconFolderOpen aria-hidden="true" />
            {{ t('settings.downloads.open') }}
          </UiButton>
        </div>
      </div>
      <label class="settings-row" for="setting-ask-download-location">
        <span>
          <strong>{{ t('settings.downloads.ask') }}</strong>
          <small>{{ t('settings.downloads.askDescription') }}</small>
        </span>
        <UiCheckbox
          bare
          appearance="switch"
          id="setting-ask-download-location"
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
  </div>
</template>
