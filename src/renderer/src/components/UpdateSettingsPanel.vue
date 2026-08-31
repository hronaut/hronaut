<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconInfo from '~icons/material-symbols/info-rounded'
import UpdateNotification from './UpdateNotification.vue'
import type { UpdateSettingsController } from '../composables/useUpdateSettingsController'
import type { ReleaseHistoryController } from '../composables/useReleaseHistoryController.js'

const props = defineProps<{
  controller: UpdateSettingsController
  releaseHistoryController: ReleaseHistoryController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  settings,
  state,
  busy,
  check,
  download,
  install,
  setCheckOnStartup
} = props.controller

async function changeStartupCheck(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setCheckOnStartup(input.checked))) input.checked = settings.value.checkForUpdatesOnStartup
}
</script>

<template>
  <div class="settings-content updates-settings" :aria-busy="busy">
    <div class="setting-copy">
      <h3>{{ t('settings.updates.heading') }}</h3>
      <p>{{ t('settings.updates.description') }}</p>
    </div>
    <UpdateNotification
      v-if="state.status !== 'idle'"
      mode="panel"
      :state="state"
      :disabled="busy"
      @check="check"
      @download="download"
      @install="install"
    />
    <div class="settings-rows">
      <label class="settings-row" for="setting-startup-update">
        <span>
          <strong>{{ t('settings.updates.startup') }}</strong>
          <small>{{ t('settings.updates.startupDescription') }}</small>
        </span>
        <input
          id="setting-startup-update"
          type="checkbox"
          :checked="settings.checkForUpdatesOnStartup"
          :disabled="busy"
          @change="changeStartupCheck"
        />
      </label>
      <div class="settings-row version-row">
        <span>
          <strong>{{ t('settings.updates.current') }}</strong>
          <small>{{ state.currentVersion || t('help.developmentBuild') }}</small>
        </span>
        <div class="update-settings-actions">
          <button class="secondary-button" type="button" @click="releaseHistoryController.openDialog">{{ t('updates.history.view') }}</button>
          <button class="secondary-button check-update-button" type="button" :disabled="busy" @click="check">{{ t('settings.updates.check') }}</button>
        </div>
      </div>
    </div>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.updates.help') }}</p>
    </div>
  </div>
</template>
