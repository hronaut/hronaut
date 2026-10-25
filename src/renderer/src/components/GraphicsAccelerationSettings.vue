<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import UiCheckbox from '../ui/UiCheckbox.vue'
import SettingRestart from './SettingRestart.vue'
import { useSettingsStore } from '../stores/settings.js'

/**
 * Settings' Use graphics acceleration when available, as in Chrome's Settings > System: Chromium takes it only at
 * startup, so a change says that Hronaut applies it after a restart.
 */
const emit = defineEmits<{
  settingError: [error: unknown]
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useSettingsStore()
const { settings } = storeToRefs(store)
const ids = useId()
const headingId = `graphics-acceleration-heading-${ids}`
const switchId = `graphics-acceleration-switch-${ids}`

// What this run uses, from main. While it is unknown, or if main cannot say, no restart is asked for: nothing was saved
// then, so Settings shows no error for it either.
const inUse = ref<boolean>()
const restartRequired = computed(() => inUse.value !== undefined && inUse.value !== settings.value.graphicsAcceleration)

onMounted(async () => {
  try {
    inUse.value = await window.hronautSettings.graphicsAccelerationInUse()
  } catch {
    inUse.value = undefined
  }
})

async function changeEnabled(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  try {
    await store.setGraphicsAcceleration(input.checked)
  } catch (error) {
    input.checked = settings.value.graphicsAcceleration
    emit('settingError', error)
  }
}
</script>

<template>
  <section class="graphics-acceleration-settings" :aria-labelledby="headingId">
    <h3 :id="headingId" class="settings-group-heading">{{ t('settings.graphics.heading') }}</h3>
    <div class="settings-rows grouped">
      <label class="settings-row" :for="switchId">
        <span>
          <strong>{{ t('settings.graphics.use') }}</strong>
          <small>{{ t('settings.graphics.useDescription') }}</small>
        </span>
        <UiCheckbox
          :id="switchId"
          bare
          appearance="switch"
          :checked="settings.graphicsAcceleration"
          @change="changeEnabled"
        />
      </label>
      <SettingRestart :required="restartRequired" :message="t('settings.graphics.restart')" />
    </div>
  </section>
</template>
