<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconBedtime from '~icons/material-symbols/bedtime-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import {
  MEMORY_SAVER_TIMEOUT_MINUTES,
  type MemorySaverTimeoutMinutes
} from '../../../shared/memory-saver'
import type { PerformanceSettingsController } from '../composables/usePerformanceSettingsController'

const props = defineProps<{
  controller: PerformanceSettingsController
  formatNumber: (value: number) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  settings,
  busy,
  errorMessage,
  regularTabsCount,
  sleepingTabsCount,
  setEnabled,
  setTimeout,
  sleepNow
} = props.controller

function timeoutLabel(timeoutMinutes: number): string {
  if (timeoutMinutes < 60) {
    return t('runtimeActions.memory.minutes', { count: props.formatNumber(timeoutMinutes) }, timeoutMinutes)
  }
  const hours = timeoutMinutes / 60
  return t('runtimeActions.memory.hours', { count: props.formatNumber(hours) }, hours)
}

async function changeEnabled(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setEnabled(input.checked))) input.checked = settings.value.memorySaverEnabled
}

async function changeTimeout(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const minutes = Number(input.value) as MemorySaverTimeoutMinutes
  if (!(await setTimeout(minutes))) input.value = String(settings.value.memorySaverTimeoutMinutes)
}
</script>

<template>
  <div class="settings-content performance-settings" :aria-busy="busy">
    <div class="setting-copy">
      <h3>{{ t('settings.memory.heading') }}</h3>
      <p>{{ t('settings.memory.description') }}</p>
    </div>
    <div class="memory-saver-summary" aria-live="polite">
      <span class="settings-nav-icon" aria-hidden="true"><IconBedtime /></span>
      <span><strong>{{ sleepingTabsCount }} {{ t('settings.memory.sleeping') }}</strong><small>{{ t('settings.memory.of') }} {{ regularTabsCount }} {{ t('settings.memory.websiteTabs') }}</small></span>
    </div>
    <div class="settings-rows">
      <label class="settings-row" for="setting-memory-saver">
        <span>
          <strong>{{ t('settings.memory.auto') }}</strong>
          <small>{{ t('settings.memory.autoDescription') }}</small>
        </span>
        <input
          id="setting-memory-saver"
          type="checkbox"
          :checked="settings.memorySaverEnabled"
          :disabled="busy"
          @change="changeEnabled"
        />
      </label>
      <label class="settings-row" for="setting-memory-saver-timeout">
        <span>
          <strong>{{ t('settings.memory.sleepAfter') }}</strong>
          <small>{{ t('settings.memory.counted') }}</small>
        </span>
        <select
          id="setting-memory-saver-timeout"
          :value="settings.memorySaverTimeoutMinutes"
          :disabled="busy || !settings.memorySaverEnabled"
          @change="changeTimeout"
        >
          <option v-for="timeout in MEMORY_SAVER_TIMEOUT_MINUTES" :key="timeout" :value="timeout">
            {{ timeoutLabel(timeout) }}
          </option>
        </select>
      </label>
    </div>
    <div class="memory-saver-actions">
      <button class="secondary-button" type="button" :disabled="busy || !settings.memorySaverEnabled" @click="sleepNow">
        <IconBedtime aria-hidden="true" /> {{ t('settings.memory.sleepNow') }}
      </button>
    </div>
    <output v-if="errorMessage" class="site-controls-error" role="alert">{{ errorMessage }}</output>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.memory.help') }}</p>
    </div>
  </div>
</template>
