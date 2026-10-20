<script setup lang="ts">
import { UiButton, UiCheckbox } from '../ui/index.js'
import { nextTick } from 'vue'
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

/**
 * Every Memory Saver control is disabled while one change runs, so Chromium moves the focus of the one you used to the
 * document body. Give it back once that control is enabled again, unless you moved it meanwhile.
 */
async function keepFocusThrough(event: Event, action: () => Promise<unknown>): Promise<void> {
  const control = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  const panel = control?.closest('.performance-settings')
  await action()
  await nextTick()
  if (!control || !panel?.isConnected || !control.isConnected || control.matches(':disabled') || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== control) return
  control.focus()
}

async function changeEnabled(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await keepFocusThrough(event, async () => {
    if (!(await setEnabled(input.checked))) input.checked = settings.value.memorySaverEnabled
  })
}

async function changeTimeout(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const minutes = Number(input.value) as MemorySaverTimeoutMinutes
  await keepFocusThrough(event, async () => {
    if (!(await setTimeout(minutes))) input.value = String(settings.value.memorySaverTimeoutMinutes)
  })
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
      <span><strong>{{ sleepingTabsCount }} {{ t('settings.memory.sleeping', sleepingTabsCount) }}</strong><small>{{ t('settings.memory.ofWebsiteTabs', { count: regularTabsCount }, regularTabsCount) }}</small></span>
    </div>
    <div class="settings-rows">
      <label class="settings-row" for="setting-memory-saver">
        <span>
          <strong>{{ t('settings.memory.auto') }}</strong>
          <small>{{ t('settings.memory.autoDescription') }}</small>
        </span>
        <UiCheckbox
          bare
          appearance="switch"
          id="setting-memory-saver"
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
      <UiButton class="secondary-button" type="button" :disabled="busy || !settings.memorySaverEnabled" @click="keepFocusThrough($event, sleepNow)">
        <IconBedtime aria-hidden="true" /> {{ t('settings.memory.sleepNow') }}
      </UiButton>
    </div>
    <output v-if="errorMessage" class="site-controls-error" role="alert">{{ errorMessage }}</output>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.memory.help') }}</p>
    </div>
  </div>
</template>
